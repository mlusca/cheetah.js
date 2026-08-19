---
sidebar_position: 1
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# HTTP Client

`@carno.js/client` gives a Carno application a typed HTTP client for the frontend: you call `api.users({ id }).get()` and TypeScript already knows the path, the body, the query and the success payload.

It does that without asking the frontend to import controllers, services, the DI container or Bun. The package is opt-in. If you never install it, Carno behaves exactly as it does today.

This page is the map. Use it to understand why this package exists, what stays the same in your app, and the smallest path from `app.use(Client())` to a typed `fetch`. The other pages in this section go into the plugin lifecycle, the scanner, the HTTP client and frontend/CI generation.

## Why This Package Exists

### `typeof app` is not a contract

Fluent routers can expose a typed client without generating files because each `.get()` / `.post()` call extends the type of `app`. `typeof app` already is the HTTP contract.

Carno does not build that type. Routes live on classes, in decorators:

```ts
@Controller('/users')
class UserController {
  @Get('/:id')
  findOne(@Param('id') id: string): Promise<User> {
    return this.users.findById(id);
  }
}
```

`typeof new Carno()` is just `Carno`. The route table is stored with `Reflect` at runtime. `emitDecoratorMetadata` does not preserve interfaces, unions or `as const` path objects. There is nothing for `client()` to infer from `typeof app`.

### The frontend cannot import the server

Even if the types were somehow recoverable from the running app, a frontend bundle must not import a controller. That pull would drag the container, services, Bun types and often the ORM into the browser.

The contract has to be a **generated TypeScript file** that contains only structural types and path constants. The runtime client is a generic `Proxy`. Generation is the feature; the Proxy is how you call it.

### Generation is automatic

Because codegen is required, the daily workflow still has to feel like a plugin, not like a code generator. You do not add a `generate --watch` script. You install the package and register it the same way you register the logger.

`listen()` generates the file. In development a watcher keeps it in sync. Vite and an optional Bun preload cover the case where the frontend starts without the API process. Details live in [Enabling the Plugin](./plugin) and [Frontend and CI Generation](./generation).

## What Does Not Change

The package is additive. Existing applications, examples and first-party plugins keep working without it.

These stay exactly as they are:

- How you write `@Controller`, HTTP methods, `@Body`, `@Param`, `@Query`, `@Schema`, middleware and services.
- The signatures of `new Carno()`, `.use()`, `.controllers()` and `.listen()`.
- Path normalization, nested `children`, and route constants you already use.
- The `tsconfig` Carno already requires (`experimentalDecorators` and `emitDecoratorMetadata`).

These are not required:

- A new decorator such as `@Returns`.
- Annotating every return type (an annotation helps the SDK; the app runs the same without it).
- A `package.json` script that watches files to regenerate the client.
- Any change to `@carno.js/core`.

If the package is not installed, nothing in the framework notices.

## Mental Model

Three pieces, with a hard boundary between backend sources and the frontend bundle:

1. **Your controllers** remain the source of truth. Paths, params, query, body and return types are read from TypeScript, not from a running `Carno` instance.
2. **A generated file** (`src/generated/app.ts` by default) holds an `App` type and a `paths` object. It does not import your server.
3. **`client<App>(url)`** is a typed Proxy. It issues `fetch` calls. It never opens a TypeScript program.

```
controllers, DTOs, route constants
        │
        │  TypeScript compiler API (scan)
        ▼
   src/generated/app.ts     ← App type + paths
        │
        │  import type only
        ▼
   client<App>(baseUrl)     ← Proxy + fetch
```

`.use(Client())` is the **trigger**, not the type source. The plugin does not read `Reflect` metadata from the live app. Doing that would lose interfaces, unions and the values of `UserRoutes.base`. It starts a compiler program against your sources instead.

How that scan interprets decorators, constants and nested controllers is documented in [How Routes Become a Contract](./codegen). How the Proxy maps those types onto `fetch` is documented in [The HTTP Client](./http).

## Installation

<Tabs groupId="os">
  <TabItem value="mac" label="macOS / Linux">
    ```bash
    bun add @carno.js/client
    ```
  </TabItem>
  <TabItem value="windows" label="Windows">
    ```bash
    bun add "@carno.js/client"
    ```
  </TabItem>
</Tabs>

The package depends on TypeScript for the scanner. `@carno.js/core` is a peer dependency of the plugin. The HTTP client used in the browser does not load the compiler or the Carno runtime.

## The Smallest Working Setup

### Backend

```ts
import { Carno } from '@carno.js/core';
import { Client } from '@carno.js/client';
import { UserController } from './users.controller';

const app = new Carno()
  .use(Client())
  .controllers([UserController]);

await app.listen(3000);
```

You do not pass the controller list to `Client()`. Discovery is a glob over sources (`src/**/*.ts` by default). After `listen()`, `src/generated/app.ts` exists. In development, editing a controller, DTO or route-constant file regenerates it. You do not run `--watch`.

### Frontend

```ts
import { client } from '@carno.js/client';
import type { App } from './generated/app';

const api = client<App>('http://localhost:3000');

const { data, error } = await api.users.get({ query: { page: '1' } });
const { data: user } = await api.users({ id: '42' }).get();
const { data: created } = await api.users.post({
  name: 'Ada',
  email: 'ada@example.com',
});
```

`data` is the handler return type. `error` is filled when `response.ok` is false, using the usual Carno body (`statusCode`, `message`, optional `errors`). Always pass `App` as the generic. Without it the Proxy is untyped and a typo such as `api.user.get()` will not fail at compile time.

### If the frontend starts alone

`.use(Client())` only runs when the Carno process boots. When Vite or `bun build` starts without that process, generate still has to happen by itself. Add `carnoClient()` to the Vite config you already have, or an optional Bun preload. See [Frontend and CI Generation](./generation).

## What to Read Next

| Page | Read it when |
| :--- | :--- |
| [Enabling the Plugin](./plugin) | You need options, `output` in another package, or the exact boot/watch/production rules |
| [How Routes Become a Contract](./codegen) | You keep paths in `as const` objects, nest `children`, or a route is missing from `App` |
| [The HTTP Client](./http) | You need query, headers, `onError: 'throw'`, a custom `fetcher`, or the `/http` entry |
| [Frontend and CI Generation](./generation) | Vite starts before the API, you have a monorepo, or CI never calls `listen()` |

The runnable sketch in the repository is `examples/client`.

## Practical Guidelines

- Register `Client()` next to your other plugins and forget about generate scripts.
- Keep route paths in `as const` objects if the backend already shares those constants; the scanner will follow them.
- Annotate handler return types when the frontend should not see `T | undefined` inferred from the implementation.
- Import `client` from `@carno.js/client/http` in frontend packages if you want a hard module boundary.
- Point `output` at the package that typechecks the UI, rather than copying `app.ts` by hand.
- In production, generate during `vite build` or CI and treat the file as a build artifact.
- Read scan warnings. A function used as a path is the usual reason a route is missing from `App`.

## See Also

- [Controllers & Routing](../core/controllers) for path rules, nested controllers and parameter decorators.
- [Validation](../core/validation) for `@Schema` on `@Body()` DTOs.
- [Lifecycle Events](../core/lifecycle) for `@OnApplicationInit` / `@OnApplicationShutdown`, which the plugin uses.
