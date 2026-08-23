---
sidebar_position: 3
---

# Angular SPA

This guide uses Angular CLI, Carno controllers, `@carno.js/client` and `@carno.js/static`.

Angular CLI owns the development server and HMR. Carno serves the API during development and serves the compiled Angular application in production.

## 1. Create the projects

Create an Angular application next to the Carno API:

```bash
mkdir apps
cd apps

ng new web --routing --style=scss
mkdir api
cd api
bun init
```

Install the API packages:

```bash
bun add @carno.js/core @carno.js/client @carno.js/static
```

Install the client package in the Angular project:

```bash
cd ../web
bun add @carno.js/client
```

## 2. Create an API controller

Keep browser-facing endpoints under `/api`:

```ts
// apps/api/src/users/users.controller.ts
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

## 3. Configure the Carno API

```ts
// apps/api/src/main.ts
import path from 'node:path';
import { Carno } from '@carno.js/core';
import { Client } from '@carno.js/client';
import { StaticPlugin } from '@carno.js/static';
import { UsersController } from './users/users.controller';

const production = process.env.NODE_ENV === 'production';

const app = new Carno()
  .use(Client({
    output: '../web/src/generated/app.ts',
  }))
  .controllers([UsersController]);

if (production) {
  app.use(await StaticPlugin.create({
    // Adjust this if angular.json uses dist/web/browser.
    root: path.resolve(process.cwd(), '../web/dist/web'),
    prefix: '/',
    index: 'index.html',
    spa: true,
    alwaysStatic: true,
    cacheControl: 'no-cache',
  }));
}

await app.listen(3000);
```

Angular CLI output paths can vary by Angular version and workspace configuration. Check `angular.json` and point `root` at the directory that directly contains `index.html`.

For example, if the build creates:

```text
apps/web/dist/web/browser/index.html
```

use:

```ts
root: path.resolve(process.cwd(), '../web/dist/web/browser')
```

If it creates `apps/web/dist/index.html`, use `../web/dist` instead.

## 4. Configure the Angular development proxy

Create `proxy.conf.json` in the Angular project:

```json
{
  "/api": {
    "target": "http://localhost:3000",
    "secure": false,
    "changeOrigin": true
  }
}
```

Start Angular with the proxy:

```bash
ng serve --proxy-config proxy.conf.json
```

The browser uses Angular's origin, usually `http://localhost:4200`. Requests to `/api/*` are forwarded to Carno. Carno does not need to serve Angular's development files.

## 5. Generate the API contract

Angular CLI does not use Vite, so it cannot use `carnoClient()` directly. The easiest option is to let the Carno API generate the file:

```ts
// apps/api/src/main.ts
const app = new Carno()
  .use(Client({
    output: '../web/src/generated/app.ts',
  }))
  .controllers([UsersController]);
```

Start Carno before Angular:

```bash
# terminal 1
cd apps/api
bun run src/main.ts

# terminal 2
cd apps/web
ng serve --proxy-config proxy.conf.json
```

While Carno is running in development, `Client()` watches the API sources and refreshes `src/generated/app.ts` when controllers or DTOs change.

If the frontend must start without the API process, generate the file as a separate build step:

```bash
bunx carno-client generate \
  --root ../api \
  --output ../web/src/generated/app.ts
```

Run that command from `apps/web`, or use an absolute output path. The output is resolved relative to `--root`, so `../web/src/generated/app.ts` points back into the Angular project. The generated file belongs to the Angular project because Angular's TypeScript compiler must be able to import it.

## 6. Create the typed client service

Use the browser HTTP entry. Do not import `Client()` or the code generator into Angular code.

```ts
// apps/web/src/app/api.ts
import { Injectable } from '@angular/core';
import { client } from '@carno.js/client/http';
import type { App } from '../generated/app';

const api = client<App>('');

@Injectable({ providedIn: 'root' })
export class ApiService {
  async listUsers() {
    const result = await api.api.users.get();

    if (result.error) {
      throw new Error(result.error.value.message);
    }

    return result.data;
  }
}
```

The empty base URL keeps the client same-origin. Angular's dev proxy handles `/api` during development, and Carno serves `/api` in production.

## 7. Use Signals for reactive state

Angular Signals provide a small reactive state layer for the page:

```ts
// apps/web/src/app/users/users.component.ts
import { Component, inject, signal } from '@angular/core';
import type { User } from '../../generated/app';
import { ApiService } from '../api';

@Component({
  selector: 'app-users',
  standalone: true,
  template: `
    @if (loading()) {
      <p>Loading...</p>
    } @else if (error()) {
      <p role="alert">{{ error() }}</p>
    } @else {
      <ul>
        @for (user of users(); track user.id) {
          <li>{{ user.name }}</li>
        }
      </ul>
    }
  `,
})
export class UsersComponent {
  private readonly api = inject(ApiService);

  readonly users = signal<User[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.users.set(await this.api.listUsers());
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Request failed');
    } finally {
      this.loading.set(false);
    }
  }
}
```

The UI updates because the component reads Signals and `ApiService` changes their values after the HTTP response. `@carno.js/client` remains responsible only for the typed request.

The same service can instead expose RxJS `Observable`s if that fits the application better.

## 8. Configure Angular routing

Use Angular Router for browser routes:

```ts
// apps/web/src/app/app.routes.ts
import { Routes } from '@angular/router';
import { UsersComponent } from './users/users.component';

export const routes: Routes = [
  { path: 'users', component: UsersComponent },
];
```

The production server must return `index.html` for `/users`, which is why the Carno static configuration uses `spa: true`.

## 9. Build and serve in production

Build Angular:

```bash
cd apps/web
ng build
```

Check the generated directory in `dist` and update the Carno `root` if necessary. Then start Carno in production mode:

```bash
cd apps/api
NODE_ENV=production bun run src/main.ts
```

On Windows PowerShell:

```powershell
$env:NODE_ENV = 'production'
bun run src/main.ts
```

Open `http://localhost:3000`. Carno serves both Angular's files and the `/api` controllers.

## 10. Angular-specific checks

Verify the following:

- `proxy.conf.json` forwards `/api` without removing the prefix.
- `@Controller('/api/...')` matches the proxy path.
- `root` points directly at the directory containing `index.html`.
- `GET /users` after a hard refresh returns Angular's `index.html`.
- `GET /api/users` returns JSON.
- The generated file is inside the Angular project or is included by its `tsconfig`.
- Browser code imports `client` from `@carno.js/client/http`, not `Client()`.

## Angular development commands

A typical Angular project can use:

```json
{
  "scripts": {
    "start": "ng serve --proxy-config proxy.conf.json",
    "build": "ng build"
  }
}
```

The Angular dev server is used in development. `StaticPlugin` is used when the compiled Angular output is ready for production.
