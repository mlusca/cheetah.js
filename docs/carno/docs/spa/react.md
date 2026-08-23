---
sidebar_position: 2
---

# React SPA

This guide uses React with Vite, Carno controllers, `@carno.js/client` and `@carno.js/static`.

The recommended development setup is:

```text
Vite :5173  ── /api proxy ──>  Carno :3000
```

The recommended production setup is:

```text
Carno :3000
├── /api/*       controllers
└── /*           React dist with SPA fallback
```

## 1. Create the projects

For a monorepo, create an API and a Vite React app next to each other:

```bash
mkdir apps
cd apps

bun create vite web --template react-ts
mkdir api
cd api
bun init
```

Install the API packages:

```bash
bun add @carno.js/core @carno.js/client @carno.js/static
```

Install the frontend client package in `apps/web`:

```bash
cd ../web
bun add @carno.js/client
```

## 2. Create an API controller

Use an `/api` prefix so API URLs do not collide with React Router URLs.

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
    root: path.resolve(process.cwd(), '../web/dist'),
    prefix: '/',
    index: 'index.html',
    spa: true,
    alwaysStatic: true,
    cacheControl: 'no-cache',
  }));
}

await app.listen(3000);
```

Run the API from `apps/api`, so the relative `output` and frontend paths resolve as shown:

```bash
bun run src/main.ts
```

`Client()` generates `apps/web/src/generated/app.ts` and watches API changes while the API is running in development.

## 4. Configure Vite development

The Vite plugin is useful when the frontend is started without starting the API first. It generates the same contract file and watches the API sources.

```ts
// apps/web/vite.config.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { carnoClient } from '@carno.js/client/vite';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(webRoot, '../api');

export default defineConfig({
  plugins: [
    react(),
    carnoClient({
      root: apiRoot,
      output: path.resolve(webRoot, 'src/generated/app.ts'),
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

The absolute `output` path is intentional. When `root` points at the API project, relative output paths are resolved from that API root.

Start both processes:

```bash
# terminal 1
cd apps/api
bun run src/main.ts

# terminal 2
cd apps/web
bun run dev
```

Open `http://localhost:5173`. Vite serves the page and forwards `/api/*` to Carno.

## 5. Create the typed client

Import the browser-only HTTP entry and the generated type:

```ts
// apps/web/src/api.ts
import { client } from '@carno.js/client/http';
import type { App } from './generated/app';

export const api = client<App>('');
```

The empty base URL means that requests use the current browser origin. In development, that is Vite, whose `/api` proxy forwards to Carno. In production, that is Carno itself.

## 6. Use the client from a React component

```tsx
// apps/web/src/UsersPage.tsx
import { useEffect, useState } from 'react';
import type { User } from './generated/app';
import { api } from './api';

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void api.api.users.get().then(result => {
      if (!active) return;

      if (result.error) {
        setError(result.error.value.message);
        setLoading(false);
        return;
      }

      setUsers(result.data);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  if (loading) return <p>Loading...</p>;
  if (error) return <p role="alert">{error}</p>;

  return (
    <ul>
      {users.map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}
```

The data becomes reactive because `setUsers()` updates React state. The HTTP client only performs the typed request.

For larger applications, the same client can be used with React Query, SWR, Zustand or another state/data library.

## 7. Add client-side routes

React Router can handle `/dashboard`, `/users` and other browser routes. The server must return `index.html` when a user refreshes one of those URLs.

```tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { UsersPage } from './UsersPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/users" element={<UsersPage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

This is why the production static configuration includes `spa: true`.

## 8. Build and serve in production

Build the React application:

```bash
cd apps/web
bun run build
```

Vite writes the result to `apps/web/dist`. Start the API with production mode:

```bash
cd apps/api
NODE_ENV=production bun run src/main.ts
```

On Windows PowerShell:

```powershell
$env:NODE_ENV = 'production'
bun run src/main.ts
```

Now use `http://localhost:3000` for both the React application and `/api`.

## 9. React-specific checks

Verify the following before deployment:

- `GET /` returns the built `index.html`.
- `GET /users` also returns `index.html` after a hard refresh.
- `GET /assets/...` returns a JavaScript or CSS asset, not HTML.
- `GET /api/users` returns JSON.
- The client imports `App` with `import type`.
- The browser does not import `Client()` or `@carno.js/client/codegen`.
- The API and Vite proxy use the same `/api` prefix.

## React development commands

A typical `apps/web/package.json` contains:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

The API and frontend remain separate processes in development. The static plugin is used after the frontend has produced `dist`.
