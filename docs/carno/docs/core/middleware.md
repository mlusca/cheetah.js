---
sidebar_position: 5
---

# Middleware

Carno uses the **onion middleware** pattern. Each middleware wraps around the next, allowing you to execute code before and after the route handler.

## The Onion Pattern

```
Request → Middleware 1 → Middleware 2 → Handler → Middleware 2 → Middleware 1 → Response
              ↓              ↓            ↓           ↑              ↑
           before         before       execute      after          after
```

Calling `next()` passes control to the next middleware. Code after `next()` runs after the handler completes.

## Creating Middleware

Implement the `CarnoMiddleware` interface with the `handle(ctx, next)` method:

```ts
import { Service, CarnoMiddleware, Context, CarnoClosure } from '@carno.js/core';

@Service()
export class AuthMiddleware implements CarnoMiddleware {
  async handle(ctx: Context, next: CarnoClosure): Promise<void> {
    // Before: runs before the route handler
    const token = ctx.headers.get('authorization');

    if (!token) {
      ctx.setResponseStatus(401);
      return; // Stop execution (don't call next)
    }

    // Pass control to next middleware/handler
    await next();

    // After: runs after the route handler (optional)
  }
}
```

## The `next` Function

The `next` function (`CarnoClosure`) is crucial for the onion pattern:

| Action | Effect |
|--------|--------|
| `await next()` | Continue to next middleware, wait for completion |
| `next()` (no await) | Continue without waiting |
| Don't call `next()` | Stop the chain (early return) |

### Example: Request Timing

```ts
@Service()
export class TimingMiddleware implements CarnoMiddleware {
  async handle(ctx: Context, next: CarnoClosure): Promise<void> {
    const start = Date.now();

    await next(); // Wait for handler to complete

    const duration = Date.now() - start;
    console.log(`${ctx.req.method} ${ctx.req.url} - ${duration}ms`);
  }
}
```

### Example: Error Handling

```ts
@Service()
export class ErrorMiddleware implements CarnoMiddleware {
  async handle(ctx: Context, next: CarnoClosure): Promise<void> {
    try {
      await next();
    } catch (error) {
      console.error('Request failed:', error);
      ctx.setResponseStatus(500);
    }
  }
}
```

### Example: Request Context

```ts
@Service()
export class RequestIdMiddleware implements CarnoMiddleware {
  async handle(ctx: Context, next: CarnoClosure): Promise<void> {
    ctx.locals.requestId = crypto.randomUUID();

    await next();
  }
}
```

## Applying Middleware

### Controller Level

Apply to all routes in a controller:

```ts
import { Controller, Middleware } from '@carno.js/core';
import { AuthMiddleware } from './auth.middleware';

@Controller()
@Middleware(AuthMiddleware)
export class UsersController {
  // All routes require authentication
}
```

### Route Level

Apply to a specific route:

```ts
import { Get, Middleware } from '@carno.js/core';

export class UsersController {
  @Get()
  @Middleware(AuthMiddleware)
  findAll() {
    return [];
  }
}
```

### Global Middleware

Apply to every route in the application:

```ts
import { Carno } from '@carno.js/core';

const app = new Carno()
  .services([AuthMiddleware, LoggerMiddleware])
  .middlewares([AuthMiddleware, LoggerMiddleware]);

app.listen(3000);
```

## Execution Order

Middleware executes in this order:

1. **Global Middleware** - First, in array order
2. **Controller Middleware** - Next
3. **Route Middleware** - Last, before handler

For the onion pattern, the **after** phase runs in reverse order.

## Dependency Injection

Middleware classes support constructor injection:

```ts
@Service()
export class LoggerMiddleware implements CarnoMiddleware {
  constructor(private logger: LoggerService) {}

  async handle(ctx: Context, next: CarnoClosure): Promise<void> {
    this.logger.info(`→ ${ctx.req.method} ${ctx.req.url}`);

    await next();

    this.logger.info(`← ${ctx.req.method} ${ctx.req.url}`);
  }
}
```

## Response Transformation

Middlewares can transform the response by capturing the return value of `next()`:

```ts
@Service()
export class ResponseTransformerMiddleware implements CarnoMiddleware {
  async handle(ctx: Context, next: CarnoClosure): Promise<Response> {
    const response = await next();

    // Modify headers, body, etc.
    const headers = new Headers(response.headers);
    headers.set('X-Custom-Header', 'value');

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  }
}
```

## Built-in Middleware

### CompressionMiddleware

Automatically compresses HTTP responses using **gzip**, **brotli** or **deflate**. Uses Bun's native compression APIs — zero external dependencies.

Only responses that exceed a size threshold and match compressible content types are compressed.

```ts
import { Carno, CompressionMiddleware } from '@carno.js/core';

const app = new Carno()
  .middlewares([new CompressionMiddleware()])
  .controllers([MyController]);

app.listen(3000);
```

#### Custom Configuration

```ts
new CompressionMiddleware({
  threshold: 512,           // Min bytes to compress (default: 1024)
  encodings: ['gzip'],      // Encoding preference (default: ['br', 'gzip'])
  gzipLevel: 9,             // Gzip level 0-9 (default: 6)
  brotliQuality: 6,         // Brotli quality 0-11 (default: 4)
  compressibleTypes: [       // Content-Type patterns (default: text/*, json, xml, svg)
    'text/',
    'application/json',
  ],
})
```

| Option | Default | Description |
|--------|---------|-------------|
| `threshold` | `1024` | Minimum response size in bytes to trigger compression |
| `encodings` | `['br', 'gzip']` | Preferred encoding order (matched against `Accept-Encoding`) |
| `gzipLevel` | `6` | Gzip compression level (-1 to 9) |
| `brotliQuality` | `4` | Brotli compression quality (0-11) |
| `compressibleTypes` | `['text/', 'application/json', ...]` | Content-Type patterns to compress |
