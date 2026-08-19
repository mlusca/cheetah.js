# @carno.js/client

Typed HTTP client for Carno.js.

Carno routes live in decorators, so `typeof app` is not a contract. This package scans your controllers at startup, writes a frontend-safe `App` type, and lets the UI call `api.users({ id }).get()` with `fetch` underneath.

The current Carno development contract does not change. Installing this package is opt-in. There is no daily `generate --watch` command.

## Enable it

```ts
import { Carno } from '@carno.js/core'
import { Client } from '@carno.js/client'

const app = new Carno()
  .use(Client())
  .controllers([UserController])

await app.listen(3000)
```

`listen()` writes `src/generated/app.ts`. In development a watcher keeps that file in sync.

## Call it from the frontend

```ts
import { client } from '@carno.js/client'
import type { App } from './generated/app'

const api = client<App>('http://localhost:3000')

const { data, error } = await api.users.get({ query: { page: '1' } })
const { data: user } = await api.users({ id: '42' }).get()
```

If Vite starts without the API process, add `carnoClient()` to `vite.config.ts`.

Full guide:

- [Why this package exists](https://carnojs.github.io/carno.js/docs/client/overview)
- [Enabling the plugin](https://carnojs.github.io/carno.js/docs/client/plugin)
- [How routes become a contract](https://carnojs.github.io/carno.js/docs/client/codegen)
- [HTTP client](https://carnojs.github.io/carno.js/docs/client/http)
- [Frontend and CI generation](https://carnojs.github.io/carno.js/docs/client/generation)
