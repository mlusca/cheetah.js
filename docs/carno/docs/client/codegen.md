---
sidebar_position: 3
---

# How Routes Become a Contract

The scanner walks TypeScript, not the running router. Anything you want in the client has to be visible in a decorator argument or in a type position. This page is the mapping from Carno controllers to the generated `App` type.

If a route is missing from the client, the cause is almost always here: a path the type checker could not reduce to a string, a file outside `include`, or a programmatic `app.route()` that the scanner does not read.

## What Is Scanned

| Source | Extracted |
| :--- | :--- |
| `@Controller(path)` / `@Controller({ path, children })` | Prefix and nested tree |
| `@Get` / `@Post` / `@Put` / `@Patch` / `@Delete` / `@Head` / `@Options` | Method and relative path |
| `@Param` / `@Query` / `@Body` / `@Header` | Request slots and the TypeScript type of the parameter |
| Handler return type | Success payload (`Promise<User>` becomes `User`) |

Not scanned:

- `app.route()` and `app.addRoutes()`
- `@Req()`, `@Ctx()`, `@Locals()` (server-only)
- WebSocket gateways
- Internal framework routes

Discovery is a glob (`src/**/*.ts` by default). The app is not constructed. Database connections and environment variables are irrelevant to the scan.

## How the Final Path Is Built

The URL written into `App` is the same one Carno registers:

`parent controller path + this controller path + method path`

then the same normalization as `compileController`:

- a leading `/` is added when missing,
- a trailing `/` is stripped unless the path is exactly `/`,
- duplicate slashes are collapsed.

```ts
@Controller('/users')
class UserController {
  @Get()
  list() {
    return [];
  }

  @Get('/:id')
  findOne(@Param('id') id: string) {
    return { id };
  }
}
```

`list` is `GET /users`. `findOne` is `GET /users/:id`. On the client those become `api.users.get()` and `api.users({ id }).get()`.

A method decorator with no argument is treated as `'/'`, so it sits on the controller prefix. That matches the runtime.

## Literal Paths

A string literal in the decorator is the simplest case and always resolves:

```ts
@Controller('/health')
class HealthController {
  @Get()
  check() {
    return { ok: true as const };
  }
}
```

The generated leaf is `health.get` with `response: { ok: true }`.

## Route Constants

Teams often keep paths in an `as const` object so the backend can reuse them in tests, redirects or docs. The scanner evaluates those expressions. It does not require the value to appear as a literal in the decorator.

Supported forms:

- string literals and no-substitution templates,
- `const` / `as const` aliases,
- property access (`UserRoutes.base`, `Routes.users.byId`),
- concatenations whose parts are themselves resolvable (`'/api' + '/users'`),
- `as` / parentheses wrapping any of the above.

```ts
export const UserRoutes = {
  base: '/users',
  byId: '/:id',
  search: '/search',
} as const;

export const ApiUsers = '/api' + '/users';

@Controller(UserRoutes.base)
class UserController {
  @Get(UserRoutes.byId)
  findOne(@Param('id') id: string): Promise<User> {
    return this.users.findById(id);
  }

  @Get(UserRoutes.search)
  search(@Query() query: { q: string }) {
    return [];
  }
}
```

The generated client sees `/users/:id` and `/users/search`, not the identifiers `UserRoutes.byId` or `UserRoutes.search`. `paths.users.findOne` is the resolved string `'/users/:id'`.

### What cannot be resolved

The scanner will not execute your code. These stay unresolved and the route is skipped, with a warning that includes file and line:

- a function call (`@Get(dynamicPath())`),
- `process.env.SOME_ROUTE`,
- a computed property (`Routes[kind]`),
- a value whose type is only `string`, with no initializer the scanner can follow.

The rest of the client is still generated. In development this does not take the server down. If a route you expected is absent, read the `[@carno.js/client]` warning first.

## Nested Controllers

`children` inherit the parent prefix, matching [Controllers & Routing](../core/controllers#nested-controllers).

```ts
@Controller('/:id/posts')
class UserPostsController {
  @Get()
  list(@Param('id') id: string): Post[] {
    return [];
  }

  @Post()
  create(@Param('id') id: string, @Body() body: { title: string }): Post {
    return { id: '1', userId: id, title: body.title };
  }
}

@Controller({
  path: '/users',
  children: [UserPostsController],
})
class UserController {}
```

The child list handler is `GET /users/:id/posts`. The client nests the same way: `api.users({ id }).posts.get()`.

A child is not also emitted at its own unprefixed path. Only trees that start from controllers which are not anyone's child are flattened. That matches how Carno compiles the router when you register the parent and let `children` do the rest.

Imported child identifiers are followed through the type checker, including re-exports.

## Request Slots

Parameter decorators become fields on the generated route type.

| Decorator | Client field | Notes |
| :--- | :--- | :--- |
| `@Param('id')` | `params` | Also inferred from `:id` segments in the path. Default type is `string` |
| `@Query('page')` | `query` | Named keys are merged into one object type |
| `@Query()` | `query` | The parameter's TypeScript type is used as the whole query object |
| `@Body()` | `body` | Usually a DTO class; emitted as a structural type |
| `@Body('name')` | `body` | Named keys are merged into one object type |
| `@Header('authorization')` | `headers` | Same merging rules as query |
| `@Req()` / `@Ctx()` / `@Locals()` | *(omitted)* | Server-only. They never appear on the client |

Two styles of `@Query` are equivalent on the client when they describe the same keys:

```ts
@Get()
list(@Query('page') page?: string) {}

@Get('/search')
search(@Query() query: { q: string; limit?: number }) {}
```

`list` generates `query: { page?: string }`. `search` generates `query: { q: string; limit?: number }`.

Today the Carno runtime validates `@Body()` when the DTO has `@Schema()`. Query and param types in the SDK come from TypeScript alone. Writing `@Query('page') page?: string` is enough for the client to require that field, even though the server does not schema-validate the query string.

### DTO classes

```ts
export class CreateUserDto {
  name: string;
  email: string;
  age?: number;
}

@Post()
create(@Body() dto: CreateUserDto): User {
  return this.users.create(dto);
}
```

`CreateUserDto` is emitted as a local alias in the generated file:

```ts
export type CreateUserDto = { name: string; email: string; age?: number };
```

Private, protected and static members are dropped. Methods are dropped. The frontend sees the data shape, not the class.

## Return Types

The success payload is the handler's return type, with `Promise` unwrapped.

| Handler return | Generated `response` |
| :--- | :--- |
| `User` / `Promise<User>` | `User` (inlined or a local alias) |
| `User[]` | `User[]` |
| `{ ok: true }` | `{ ok: true }` |
| `void` / `undefined` | `null` (the server sends `204`; the client puts `null` in `data`) |
| `User \| undefined` | `User \| null` (a missing value is also `204` / empty body) |
| `Response` / `ctx.json(...)` typed as `Response` | `unknown` |
| Missing annotation | Whatever TypeScript infers from the body |

Annotating the return type is the most reliable way to give the frontend a stable contract. Inference works, but it follows the implementation. `users.find(…)` infers `User | undefined`. `return ctx.json(user)` often infers `Response`, which collapses to `unknown`.

Prefer:

```ts
@Get('/:id')
findOne(@Param('id') id: string): Promise<User> {
  return this.users.findById(id);
}
```

over an unannotated method that happens to return the repository result.

`Date` is emitted as `string`. `JSON.stringify` on the wire does not revive dates, and the HTTP client parses JSON with `JSON.parse`.

## The Generated File

By default the file is `src/generated/app.ts`. Treat it as build output that happens to be TypeScript: you import it, you do not edit it. The banner at the top is a reminder that the next `listen()`, Vite start or CI generate will overwrite it.

### The `App` type

`App` is a nested object that mirrors URL segments. Static segments are keys. Param segments are keys like `":id"`. HTTP methods are the leaves.

```ts
// Generated by @carno.js/client. Do not edit.
export type User = { id: string; name: string; email: string };
export type CreateUserDto = { name: string; email: string };

export type App = {
  users: {
    get: { query: { page?: string }; response: User[] };
    post: { body: CreateUserDto; response: User };
    ':id': {
      get: { params: { id: string }; response: User };
      delete: { params: { id: string }; response: null };
      posts: {
        get: { params: { id: string }; response: Post[] };
      };
    };
  };
};
```

A leaf always has `response`. `params`, `query`, `headers` and `body` appear only when the handler uses them.

Declared interfaces, type aliases and DTO classes become local `export type` names in the same file. The frontend can import `User` from the generated module. It still does not import `UserController`.

Anonymous object types (`{ title: string }`) stay inline.

### The `paths` object

`paths` is a runtime value, grouped by the first static segment of the URL and keyed by the handler name:

```ts
export const paths = {
  users: {
    list: '/users',
    findOne: '/users/:id',
    create: '/users',
  },
} as const;
```

Use it when you need the string — logging, docs, a plain `fetch` — without duplicating `'/users/:id'` by hand. Colliding handler names in the same group get a suffix such as `list_get`.

### Why types are inlined

`importTypes` defaults to `false`. If the generated file imported `CreateUserDto` from `../users/users.dto`, the frontend would compile against server files and, in many setups, pull validation libraries or ORM types with them.

Inlining (and local aliases) keeps the contract portable. A React app, a Vite app and a second Bun service can all import the same file.

## Experimental and Stage 3 Decorators

The scanner reads both AST shapes:

- `experimentalDecorators` (what Carno documents and what the monorepo uses),
- TypeScript 5 Stage 3 method decorators.

You do not configure this. As long as the project's `tsconfig` is the one the scanner loads, both forms on `@Get` / `@Post` are visible.

## See Also

- [Enabling the Plugin](./plugin) for `include`, `output` and watch.
- [The HTTP Client](./http) for how `App` becomes `api.users({ id }).get()`.
- [Controllers & Routing](../core/controllers) for the runtime path rules the client mirrors.
