---
sidebar_position: 3
---

# Context

The `Context` object is the central hub for handling HTTP requests in Carno.js. It provides access to request data, response helpers, and shared state between middlewares and handlers.

Carno keeps `Context` lightweight. URL parsing, query parsing, body parsing and `locals` allocation happen lazily, so simple handlers do not pay for data they never read.

## Accessing the Context

Use the `@Ctx()` decorator to inject the context into your handler:

```ts
import { Controller, Get, Ctx, Context } from '@carno.js/core';

@Controller('/example')
class ExampleController {
  @Get()
  handler(@Ctx() ctx: Context) {
    return ctx.json({ message: 'Hello World' });
  }
}
```

## Properties

### Request Properties

| Property | Type | Description |
| :--- | :--- | :--- |
| `req` | `Request` | The raw Web API Request object |
| `method` | `string` | HTTP method (GET, POST, etc.) |
| `path` | `string` | URL pathname |
| `url` | `URL` | Parsed URL object (lazy-loaded) |
| `headers` | `Headers` | Request headers |
| `params` | `Record<string, string>` | Route parameters (e.g., `/users/:id`) |
| `query` | `Record<string, string>` | Query string parameters (lazy-loaded) |
| `body` | `any` | Parsed request body (after `parseBody()`) |

### Response Properties

| Property | Type | Description |
| :--- | :--- | :--- |
| `status` | `number` | Response status code (default: 200) |

### Shared State

| Property | Type | Description |
| :--- | :--- | :--- |
| `locals` | `Record<string, any>` | Shared data between middlewares and handlers |

## Response Helpers

Carno.js provides convenient methods to create responses with proper headers and status codes.

### `ctx.json(data, status?)`

Returns a JSON response with `Content-Type: application/json`.

```ts
@Get('/user')
getUser(@Ctx() ctx: Context) {
  return ctx.json({ id: 1, name: 'John' });
}

// With custom status code
@Post('/user')
createUser(@Ctx() ctx: Context) {
  return ctx.json({ id: 1, created: true }, 201);
}
```

**Parameters:**
- `data: any` - The data to serialize as JSON
- `status?: number` - Optional HTTP status code (default: 200)

**Returns:** `Response` with JSON body

---

### `ctx.text(data, status?)`

Returns a plain text response with `Content-Type: text/plain`.

```ts
@Get('/health')
healthCheck(@Ctx() ctx: Context) {
  return ctx.text('OK');
}

// With custom status code
@Get('/error')
error(@Ctx() ctx: Context) {
  return ctx.text('Service Unavailable', 503);
}
```

**Parameters:**
- `data: string` - The text content
- `status?: number` - Optional HTTP status code (default: 200)

**Returns:** `Response` with plain text body

---

### `ctx.html(data, status?)`

Returns an HTML response with `Content-Type: text/html`.

```ts
@Get('/page')
renderPage(@Ctx() ctx: Context) {
  return ctx.html('<html><body><h1>Hello World</h1></body></html>');
}

// Dynamic HTML with status
@Get('/not-found')
notFound(@Ctx() ctx: Context) {
  return ctx.html('<html><body><h1>Page Not Found</h1></body></html>', 404);
}
```

**Parameters:**
- `data: string` - The HTML content
- `status?: number` - Optional HTTP status code (default: 200)

**Returns:** `Response` with HTML body

---

### `ctx.redirect(url, status?)`

Returns a redirect response.

```ts
@Get('/old-page')
redirectOld(@Ctx() ctx: Context) {
  return ctx.redirect('/new-page');
}

// Permanent redirect (301)
@Get('/legacy')
redirectPermanent(@Ctx() ctx: Context) {
  return ctx.redirect('/modern', 301);
}
```

**Parameters:**
- `url: string` - The URL to redirect to
- `status?: number` - HTTP redirect status (default: 302)

**Returns:** `Response` with redirect headers

**Common status codes:**
- `301` - Moved Permanently
- `302` - Found (Temporary Redirect) - **default**
- `303` - See Other
- `307` - Temporary Redirect
- `308` - Permanent Redirect

---

## Body Parsing

### `ctx.parseBody()`

Parses the request body based on the `Content-Type` header. This is an async method.

```ts
@Post('/data')
async handleData(@Ctx() ctx: Context) {
  const body = await ctx.parseBody();
  return ctx.json({ received: body });
}
```

**Content-Type handling:**
- `application/json` -> Parses as JSON object
- `application/x-www-form-urlencoded` or `multipart/form-data` -> Parses form data and returns a plain object
- `text/*` -> Parses as string
- Other -> Returns as `ArrayBuffer`

:::tip
When using the `@Body()` decorator, the body is automatically parsed for you. Use `parseBody()` only when you need manual control.
:::

---

## Setting Status Code

You can set the status code before returning a response:

```ts
@Get('/created')
create(@Ctx() ctx: Context) {
  ctx.status = 201;
  return ctx.json({ created: true });
}
```

Or pass the status directly to the helper methods:

```ts
@Get('/created')
create(@Ctx() ctx: Context) {
  return ctx.json({ created: true }, 201);
}
```

---

## Using Locals for Shared State

The `locals` object allows sharing data between middlewares and handlers:

```ts
import { Controller, Ctx, Get, Middleware, type Context } from '@carno.js/core';

// Middleware that adds user info
const authMiddleware = (ctx: Context) => {
  ctx.locals.user = { id: 1, role: 'admin' };
};

@Controller('/dashboard')
@Middleware(authMiddleware)
class DashboardController {
  @Get()
  dashboard(@Ctx() ctx: Context) {
    const user = ctx.locals.user;
    return ctx.json({ welcome: `Hello, user #${user.id}` });
  }
}
```

You can also use the `@Locals()` decorator to access specific values:

```ts
import { Locals } from '@carno.js/core';

@Get()
dashboard(@Locals('user') user: any) {
  return { welcome: `Hello, user #${user.id}` };
}
```

---

## Custom Responses

For full control, you can return a native `Response` object:

```ts
@Get('/custom')
custom(@Ctx() ctx: Context) {
  return new Response(JSON.stringify({ custom: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Custom-Header': 'value',
      'Cache-Control': 'max-age=3600'
    }
  });
}
```

### Streaming Response

```ts
@Get('/stream')
stream(@Ctx() ctx: Context) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('chunk1'));
      controller.enqueue(encoder.encode('chunk2'));
      controller.close();
    }
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain' }
  });
}
```

### Binary Response

```ts
@Get('/image')
image(@Ctx() ctx: Context) {
  const imageData = new Uint8Array([/* PNG bytes */]);
  return new Response(imageData, {
    headers: { 'Content-Type': 'image/png' }
  });
}
```

### Server-Sent Events

```ts
@Get('/events')
sse(@Ctx() ctx: Context) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"message": "hello"}\n\n'));
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}
```

---

## API Reference

```ts
class Context {
  // Request
  readonly req: Request;
  params: Record<string, string>;
  readonly query: Record<string, string>;
  readonly body: any;
  readonly method: string;
  readonly path: string;
  readonly url: URL;
  readonly headers: Headers;

  // Response
  status: number;

  // Shared state
  locals: Record<string, any>;

  // Methods
  parseBody(): Promise<any>;
  json(data: any, status?: number): Response;
  text(data: string, status?: number): Response;
  html(data: string, status?: number): Response;
  redirect(url: string, status?: number): Response;
}
```
