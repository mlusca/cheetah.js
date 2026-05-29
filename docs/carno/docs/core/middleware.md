---
sidebar_position: 5
---

# Middleware

Middleware runs between the incoming request and the route handler. It is the right place for cross-cutting behavior that should not live inside every controller method.

Use middleware for:

- Authentication and authorization gates.
- Request IDs and correlation IDs.
- Logging and request timing.
- Response headers.
- Compression.
- Per-request context setup.
- Short-circuiting requests before they reach a handler.

Carno uses the onion middleware pattern for class-based middleware.

## The Onion Pattern

In an onion chain, each middleware can run code before and after the next layer.

```txt
Request -> Middleware A -> Middleware B -> Handler -> Middleware B -> Middleware A -> Response
              before          before       execute      after          after
```

Calling `await next()` continues to the next middleware or handler. Code after `await next()` runs after the downstream layer has produced a response.

## Function Middleware

The simplest middleware is a function.

```ts
import type { Context } from '@carno.js/core';

const requestIdMiddleware = (ctx: Context) => {
  ctx.locals.requestId = crypto.randomUUID();
};
```

Function middleware can return a `Response` to stop the chain.

```ts
const authMiddleware = (ctx: Context) => {
  const token = ctx.headers.get('authorization');

  if (!token) {
    return new Response('Unauthorized', { status: 401 });
  }
};
```

If a function middleware returns `void`, Carno continues to the next layer.

## Class-Based Middleware

Use a class when the middleware needs dependencies or before/after behavior.

```ts
import {
  type CarnoClosure,
  type CarnoMiddleware,
  type Context,
  Service,
} from '@carno.js/core';

@Service()
export class TimingMiddleware implements CarnoMiddleware {
  async handle(ctx: Context, next: CarnoClosure): Promise<void> {
    const start = Date.now();

    await next();

    const duration = Date.now() - start;
    console.log(`${ctx.method} ${ctx.path} ${duration}ms`);
  }
}
```

Class middleware must implement `handle(ctx, next)`.

## Returning Early

To block a request, return a `Response` and do not call `next()`.

```ts
@Service()
export class AuthMiddleware implements CarnoMiddleware {
  async handle(ctx: Context, next: CarnoClosure): Promise<Response | void> {
    const token = ctx.headers.get('authorization');

    if (!token) {
      return new Response('Unauthorized', { status: 401 });
    }

    await next();
  }
}
```

If a class middleware does not call `next()` and does not return a `Response`, the framework returns an empty `200` response. In most guard middleware, returning an explicit response is clearer.

## Transforming Responses

Because `next()` resolves to the downstream `Response`, middleware can transform response headers or body.

```ts
@Service()
export class SecurityHeadersMiddleware implements CarnoMiddleware {
  async handle(ctx: Context, next: CarnoClosure): Promise<Response> {
    const response = await next();
    const headers = new Headers(response.headers);

    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
```

## Sharing State With `ctx.locals`

`ctx.locals` is the per-request scratchpad shared by middleware and handlers.

```ts
const currentUserMiddleware = (ctx: Context) => {
  ctx.locals.user = { id: '42', role: 'admin' };
};
```

```ts
import { Controller, Ctx, Get, type Context } from '@carno.js/core';

@Controller('/me')
class MeController {
  @Get()
  me(@Ctx() ctx: Context) {
    return ctx.locals.user;
  }
}
```

You can also read values with `@Locals()`.

```ts
import { Locals } from '@carno.js/core';

@Get('/dashboard')
dashboard(@Locals('user') user: any) {
  return { user };
}
```

## Applying Middleware

### Global Middleware

Global middleware applies to every route.

```ts
import { Carno } from '@carno.js/core';

const app = new Carno({
  globalMiddlewares: [requestIdMiddleware],
})
  .services([TimingMiddleware])
  .middlewares([TimingMiddleware])
  .controllers([UsersController]);

app.listen(3000);
```

You can pass function middleware, middleware classes or pre-created middleware instances.

### Controller Middleware

Use `@Middleware()` on a controller to apply middleware to all routes in that controller.

```ts
import { Controller, Middleware } from '@carno.js/core';

@Controller('/users')
@Middleware(AuthMiddleware)
export class UsersController {}
```

### Route Middleware

Use `@Middleware()` on a route method when only one endpoint needs the middleware.

```ts
import { Get, Middleware } from '@carno.js/core';

class UsersController {
  @Get('/admin')
  @Middleware(AuthMiddleware)
  adminOnly() {
    return [];
  }
}
```

## Execution Order

Middleware runs in this order:

1. `globalMiddlewares` from app configuration.
2. Middlewares registered with `.middlewares()`.
3. Controller-level middleware.
4. Route-level middleware.
5. Route handler.

For class-based middleware, the after phase runs in reverse order.

## Dependency Injection

Class middleware is resolved through the DI container, so constructor injection works.

```ts
@Service()
export class LoggerMiddleware implements CarnoMiddleware {
  constructor(private logger: LoggerService) {}

  async handle(ctx: Context, next: CarnoClosure): Promise<void> {
    this.logger.info(`-> ${ctx.method} ${ctx.path}`);

    await next();

    this.logger.info(`<- ${ctx.method} ${ctx.path}`);
  }
}
```

Register the middleware class as a service when it has dependencies.

```ts
const app = new Carno()
  .services([LoggerService, LoggerMiddleware])
  .middlewares([LoggerMiddleware]);
```

## Built-In Compression Middleware

`CompressionMiddleware` compresses eligible responses with Brotli, gzip or deflate.

It checks:

- `Accept-Encoding` from the request.
- Existing `Content-Encoding` on the response.
- Response `Content-Type`.
- Response size threshold.
- Whether compressed output is smaller than the original.

```ts
import { Carno, CompressionMiddleware } from '@carno.js/core';

const app = new Carno()
  .middlewares([new CompressionMiddleware()])
  .controllers([MyController]);

app.listen(3000);
```

### Compression Configuration

```ts
new CompressionMiddleware({
  threshold: 512,
  encodings: ['br', 'gzip'],
  gzipLevel: 6,
  brotliQuality: 4,
  compressibleTypes: [
    'text/',
    'application/json',
    'application/javascript',
    'application/xml',
    'image/svg+xml',
  ],
});
```

| Option | Default | Description |
| :--- | :--- | :--- |
| `threshold` | `1024` | Minimum response size in bytes |
| `encodings` | `['br', 'gzip']` | Preferred encoding order |
| `gzipLevel` | `6` | Gzip level from `-1` to `9` |
| `brotliQuality` | `4` | Brotli quality from `0` to `11` |
| `compressibleTypes` | text, JSON, JavaScript, XML, SVG | Content-Type fragments eligible for compression |

## Practical Guidelines

- Return `Response` for guard failures instead of mutating context only.
- Use `ctx.locals` for request-scoped data that handlers need.
- Keep middleware focused on cross-cutting concerns.
- Prefer class middleware when dependencies or after-response behavior are needed.
- Register class middleware as services when it uses constructor injection.
- Be careful when consuming `response.body`; create a new `Response` if you transform it.

## See Also

- [Context](./context) for request data and response helpers.
- [Dependency Injection](./dependency-injection) for class middleware dependencies.
- [Controllers & Routing](./controllers) for route-level middleware.
