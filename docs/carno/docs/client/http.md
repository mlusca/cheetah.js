---
sidebar_position: 4
---

# The HTTP Client

The generated file is only a type (plus `paths`). The runtime client is `client<App>(url)`: a `Proxy` that builds a URL and calls `fetch`. This page is the frontend API.

Read [How Routes Become a Contract](./codegen) if you need to know why a method or field is or is not on `App`.

## Creating the Client

```ts
import { client } from '@carno.js/client';
import type { App } from './generated/app';
import { paths } from './generated/app';

const api = client<App>('http://localhost:3000');
```

`client` is generic over `App`. If you omit the type argument, calls type-check as a loose Proxy and you lose the contract. Always pass `App`.

The first argument is the origin. A trailing slash is stripped. Relative URLs work in the browser when the frontend is reverse-proxied onto the API:

```ts
const api = client<App>('');
const apiUnderPrefix = client<App>('/api');
```

`paths` is a runtime object. Use it when you need the string itself (`paths.users.findOne === '/users/:id'`).

## How a Path Becomes a Call

Property access appends a static segment. Calling the proxy with an object appends path-parameter values. `get` / `post` / `put` / `patch` / `delete` / `head` / `options` are terminal and perform the request.

| Carno route | Client call |
| :--- | :--- |
| `GET /users` | `api.users.get()` |
| `GET /users/:id` | `api.users({ id: '42' }).get()` |
| `POST /users` | `api.users.post({ name, email })` |
| `PUT /users/:id` | `api.users({ id }).put(body)` |
| `DELETE /users/:id` | `api.users({ id }).delete()` |
| `GET /users/:id/posts` | `api.users({ id }).posts.get()` |
| `POST /users/:id/posts` | `api.users({ id }).posts.post({ title })` |
| `GET /health` | `api.health.get()` |

The Proxy does not need the generated type at runtime. The type only constrains which calls TypeScript allows. `api.user.get()` is a compile error once `App` is passed in.

Nested param segments are separate calls:

```ts
await api.users({ id: '42' }).posts({ postId: '9' }).get();
// GET /users/42/posts/9
```

## Methods Without a Body

`get`, `head` and `options` take a single optional argument: query, headers and per-request `fetch` init.

```ts
const { data, error } = await api.users.get({
  query: { page: '1' },
  headers: { 'X-Request-Id': '…' },
});
```

There is no request body. Passing an object is always interpreted as options, never as JSON.

## Methods With a Body

`post`, `put`, `patch` and `delete` take the body first and the same options object second.

```ts
const { data, error } = await api.users.post(
  { name: 'Ada', email: 'ada@example.com' },
  { headers: { Authorization: 'Bearer …' } },
);
```

JSON bodies are serialized with `JSON.stringify` and sent as `application/json` unless you already set `Content-Type`. `Blob`, `FormData`, `URLSearchParams` and `ArrayBuffer` are passed through as-is, so file uploads do not get double-encoded.

`delete` is treated as a body method so `api.users({ id }).delete()` still works with no arguments. If you need only options and no body, pass `undefined` first:

```ts
await api.users({ id: '42' }).delete(undefined, {
  headers: { Authorization: 'Bearer …' },
});
```

## Path Parameters

Pass an object whose keys match the `:name` segments of the *next* param node:

```ts
await api.users({ id: '42' }).get();
await api.users({ id: '42' }).posts.get();
```

Values are stringified and `encodeURIComponent`'d. The generated type accepts `string | number`, because application code often holds numeric ids even though they travel as URL text.

The object form is the supported way to fill params. Reading `api.users[':id']` exists on the type so TypeScript can walk the tree; at runtime the call form is what produces `/users/42`.

## Query Strings

`query` becomes `URLSearchParams`. `undefined` and `null` entries are dropped. Arrays append the same key multiple times.

```ts
await api.users.get({
  query: { page: '1', tags: ['a', 'b'] },
});
// GET /users?page=1&tags=a&tags=b
```

The type of `query` is whatever the scanner extracted from `@Query()`. If the handler has no query decorator, the options object simply has no `query` field.

## The Result Object

Every call returns a Promise of a discriminated union. Success and failure share `status`, `headers` and `response`. They differ on `data` and `error`:

```ts
type ClientResult<T> =
  | {
      data: T;
      error: null;
      status: number;
      headers: Headers;
      response: Response;
    }
  | {
      data: null;
      error: {
        status: number;
        value: {
          statusCode: number;
          message: string;
          errors?: unknown[];
        };
      };
      status: number;
      headers: Headers;
      response: Response;
    };
```

On success, `data` is:

- the JSON-parsed body when the response is JSON,
- the raw text when it is not,
- `null` for `204` or an empty body.

Handlers that return `void` or `undefined` generate `response: null`, so a successful `204` is typed as `data: null` — the same value the runtime returns. A union such as `User | undefined` becomes `User | null` on the client.

On failure (`response.ok === false`), `error.value` follows the Carno exception shape. Validation failures from `@Schema()` typically look like:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [{ "path": "email", "message": "Invalid email address" }]
}
```

Narrow by checking `error`:

```ts
const result = await api.users({ id: '42' }).get();

if (result.error) {
  console.error(result.error.value.message);
  return;
}

result.data.name;
```

This version does not infer a per-handler union of thrown `HttpException` subclasses. Every failed response uses the common shape above.

## Throwing Instead of Returning Errors

The default `{ data, error }` union forces the caller to handle failure. If you prefer exceptions:

```ts
const api = client<App>('http://localhost:3000', {
  onError: 'throw',
});

try {
  const { data } = await api.users.post({
    name: 'Ada',
    email: 'ada@example.com',
  });
} catch (error) {
  // Error with `.message`, `.status` and `.value` from the JSON body
}
```

`onError` defaults to `'return'`.

## Default Headers and a Custom Fetcher

Headers on the client are merged into every request. A function (sync or async) is useful for tokens that change between calls:

```ts
const api = client<App>('http://localhost:3000', {
  headers: () => ({
    Authorization: `Bearer ${localStorage.getItem('token') ?? ''}`,
  }),
  fetcher: (input, init) =>
    fetch(input, { ...init, credentials: 'include' }),
});
```

Per-request `headers` override client defaults. Per-request `fetch` is merged into the `RequestInit` (method, body and the combined headers still win).

`fetcher` replaces `globalThis.fetch` entirely. Tests should pass a fake:

```ts
const api = client<App>('http://example.test', {
  fetcher: async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json({ id: '1' });
  },
});
```

## Keeping the Compiler Out of the Bundle

`import { client } from '@carno.js/client'` is enough in Vite: the `browser` export condition points at the client entry, and `Client()` is tree-shaken.

If you want the boundary to be explicit — for example a frontend package that must not resolve `@carno.js/core` — import the client entry:

```ts
import { client } from '@carno.js/client/http';
import type { App } from './generated/app';
```

`@carno.js/client/http` never imports `@carno.js/core` or the TypeScript compiler API.

Do **not** import `@carno.js/client/codegen` from application UI. That entry is the scanner, for the plugin, Vite and CI.

## Type-Only Import of `App`

Always import `App` as a type:

```ts
import type { App } from './generated/app';
import { paths } from './generated/app';
```

`import type` is erased at compile time. `paths` is a real object and stays in the bundle. Mixing the two in one value import also works, but a type-only import makes the intent obvious to both people and bundlers.

## See Also

- [How Routes Become a Contract](./codegen) for the shape of `App`.
- [Frontend and CI Generation](./generation) when Vite starts without the API.
- [Validation](../core/validation) for the error payload on failed `@Schema()` bodies.
