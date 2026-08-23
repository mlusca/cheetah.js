---
sidebar_position: 1
---

# Single-Page Applications

Carno.js can serve a React, Angular, Vue, Svelte or any other frontend that produces a browser build. The simplest setup uses two existing packages:

- `@carno.js/client` generates a type-safe frontend client from Carno controllers.
- `@carno.js/static` serves the frontend build and provides the SPA fallback in production.

The frontend framework owns reactivity. Carno owns the HTTP API, authentication, business rules and data access.

```text
development:

React/Vite or Angular CLI  ── proxy ──>  Carno API
       localhost:5173                    localhost:3000

production:

Browser ──> Carno ──> frontend/dist/index.html and assets
             └──────> /api/* controllers
```

## Development and production are different

There are two valid development workflows. The choice is about HMR and browser origin, not about whether `StaticPlugin` is allowed to run.

### Development with HMR (recommended)

Vite or Angular CLI serves the frontend from memory and owns HMR. Carno runs the API and the frontend dev server proxies `/api` requests to it:

1. Carno runs the API on port `3000`.
2. Vite or Angular CLI runs the frontend dev server.
3. The frontend dev server proxies `/api` requests to Carno.

In this mode, `StaticPlugin` is not needed because the frontend dev server is serving the application. This is the best workflow for React and Angular development because component and style changes update without a production build.

### Development through Carno (optional)

`StaticPlugin` can serve the frontend in development when a build is written to disk:

```ts
app.use(await StaticPlugin.create({
  root: '../web/dist',
  spa: true,
  alwaysStatic: false,
  cacheControl: 'no-cache',
}));
```

Run a build watcher alongside Carno:

```bash
# React/Vite
bunx vite build --watch

# Angular
ng build --watch
```

This gives a single Carno origin, usually `http://localhost:3000`, but it does not provide the same HMR experience as `vite` or `ng serve`. The browser must reload after a build changes. Use this mode for a production-like smoke test or when serving the frontend from Carno is more important than HMR.

### Production

Build the frontend first and point `StaticPlugin` at the generated directory with `alwaysStatic: true`. Carno then serves both the browser application and the API from the same origin.

The framework does not currently start Vite or Angular CLI as a child process. A future integrated dev proxy could make Carno the browser origin, but it would also need to forward the frontend dev server's HMR WebSocket. Keeping the frontend dev server as the HMR owner is the smaller and more reliable design.

## Recommended project layout

```text
apps/
├── api/
│   ├── src/
│   │   ├── main.ts
│   │   ├── users/
│   │   │   └── users.controller.ts
│   │   └── generated/
│   │       └── app.ts
│   └── package.json
└── web/
    ├── src/
    │   ├── generated/
    │   │   └── app.ts
    │   └── ...
    ├── dist/
    └── package.json
```

The generated `App` type must be available to the frontend package. In a split API/web project, make the web package the owner of the generated file by configuring the Vite plugin, or have the API write to the web package. Do not import backend controllers into browser code.

## API route convention

Give browser-facing API routes an explicit `/api` prefix. This keeps API endpoints separate from client-side routes such as `/users`, `/settings` and `/dashboard`.

```ts
import { Controller, Get } from '@carno.js/core';

export interface User {
  id: string;
  name: string;
}

@Controller('/api/users')
export class UsersController {
  @Get()
  list(): User[] {
    return [
      { id: '1', name: 'Ada' },
      { id: '2', name: 'Grace' },
    ];
  }
}
```

The generated client will expose this route under `api.api.users`. The first `api` is the route segment; the second is the `users` segment:

```ts
const result = await api.api.users.get();
```

If you prefer `api.users.get()`, keep the controller at `/users` and use an external reverse proxy or a consistent deployment prefix. The important rule is to use one URL convention in development and production.

## Backend setup

Install the packages in the API project:

```bash
bun add @carno.js/core @carno.js/client @carno.js/static
```

Register `Client()` for code generation. Register `StaticPlugin` only when Carno is serving the production frontend build:

```ts
// apps/api/src/main.ts
import path from 'node:path';
import { Carno } from '@carno.js/core';
import { Client } from '@carno.js/client';
import { StaticPlugin } from '@carno.js/static';
import { UsersController } from './users/users.controller';

const isProduction = process.env.NODE_ENV === 'production';

const app = new Carno()
  .use(Client({
    // Resolve this from the API project root.
    output: '../web/src/generated/app.ts',
  }))
  .controllers([UsersController]);

if (isProduction) {
  app.use(await StaticPlugin.create({
    root: path.resolve(process.cwd(), '../web/dist'),
    prefix: '/',
    index: 'index.html',
    spa: true,
    alwaysStatic: true,
    // Safe default for index.html. See the caching section below.
    cacheControl: 'no-cache',
  }));
}

await app.listen(3000);
```

`Client()` and the Vite plugin can safely target the same output file because generation skips identical content. In a team project, choose one as the primary owner:

- API owns generation when developers normally start Carno first.
- Vite owns generation when developers normally start only the frontend.

## What `spa: true` does

`spa: true` is a history API fallback. If a browser requests `/dashboard` and there is no physical `dashboard` file, the static plugin returns `index.html`. The frontend router then interprets `/dashboard`.

It does not:

- run React or Angular on the server;
- fetch API data;
- manage frontend state;
- provide HMR;
- make a template engine reactive.

Those responsibilities belong to the frontend dev server and framework runtime.

## Development request flow

During development, use the frontend dev server as the browser origin. A request looks like this:

```text
Browser GET http://localhost:5173/dashboard
  └─> Vite or Angular CLI returns the application shell

Browser GET http://localhost:5173/api/users
  └─> dev-server proxy forwards to http://localhost:3000/api/users
```

The HMR workflow uses the frontend dev server as the browser origin. The browser can use a relative client base URL:

```ts
import { client } from '@carno.js/client/http';
import type { App } from './generated/app';

export const api = client<App>('');
```

Because both the page and `/api` requests use the frontend dev-server origin, development normally does not require CORS.

In the Carno-served workflow, the browser origin is Carno and no proxy is needed:

```text
Browser GET http://localhost:3000/dashboard
  └─> StaticPlugin returns dist/index.html

Browser GET http://localhost:3000/api/users
  └─> Carno controller returns JSON
```

The `client<App>('')` code is identical in both workflows.

## Production request flow

Build the frontend:

```bash
bun run build
```

Then start Carno with `NODE_ENV=production`. The static plugin serves:

| Request | Result |
| :--- | :--- |
| `/` | `dist/index.html` |
| `/dashboard` | `dist/index.html` through SPA fallback |
| `/assets/app-abc123.js` | The generated JavaScript asset |
| `/api/users` | The Carno controller response |
| `/missing-file.js` | `404`, because it is an asset request and not a client route |

Use the same relative client base URL in production:

```ts
const api = client<App>('');
```

The API and frontend now share the same origin, so there is no frontend-to-API CORS boundary.

## Client-side reactivity

`@carno.js/client` is a typed `fetch` client. It does not replace React state, Angular Signals, RxJS or a data-fetching library.

The general loop is:

```text
component starts
  └─> client calls GET /api/...
       └─> response is stored in framework state
            └─> framework renders the new state

user submits a form
  └─> client calls POST/PUT/DELETE /api/...
       └─> state is updated or queried again
            └─> framework renders the new state
```

For server-pushed changes, add WebSocket or SSE separately. Static files and the HTTP client do not create a persistent subscription.

## Caching

There are three separate caches to consider:

### Frontend dev server cache

Vite and Angular CLI manage their own development bundles and HMR state. Carno does not serve these files in the recommended development workflow.

### Static asset cache

`alwaysStatic: true` preloads files into server memory during production startup. `cacheControl` controls the browser and intermediary HTTP cache.

The current static plugin applies one `Cache-Control` value to all served files. For a safe SPA deployment, use `no-cache` for the whole bundle unless you have a reverse proxy that can apply different policies. The most useful long-term policy is:

- `index.html`: `no-cache`;
- hashed JS/CSS/assets: `public, max-age=31536000, immutable`.

### View template cache

The `cache` option in `@carno.js/views` is unrelated to SPA assets. It caches server-side templates and compiled view functions. A React or Angular SPA does not use that cache.

## API errors and SPA fallback

Keep the API under `/api` and test both of these URLs after enabling SPA mode:

```text
GET /api/users        → JSON from the controller
GET /api/does-not-exist → API 404, not the SPA shell
```

The current fallback is based on whether a path looks like a browser route rather than an asset. Unknown `/api/*` paths and requests with a file extension (`/missing-file.js`) return `404` instead of `index.html`. If the API lives under another prefix, add an `Accept: text/html` guard or an explicit fallback exclusion for that prefix before relying on the fallback in production.

## Troubleshooting

### The page works in production but not in development

This usually means the frontend dev server is not running. Start Carno and the frontend separately. Do not point `StaticPlugin` at a Vite or Angular development server port.

### The browser returns HTML for an API call

Check that API controllers use `/api` and that the frontend proxy forwards `/api` without removing the prefix.

### The browser gets a CORS error

Use a dev-server proxy, or configure Carno CORS for the frontend origin. Same-origin production deployments do not need CORS for this setup.

### The frontend uses an old build after deployment

Set `cacheControl: 'no-cache'` for the current static plugin, or configure your reverse proxy so `index.html` is never cached while hashed assets remain cacheable.

## Next guides

- [React SPA](./react)
- [Angular SPA](./angular)
- [Static Files](../static/overview)
- [HTTP Client](../client/overview)
- [Frontend and CI Generation](../client/generation)
