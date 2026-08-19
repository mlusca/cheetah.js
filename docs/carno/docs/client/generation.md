---
sidebar_position: 5
---

# Frontend and CI Generation

`.use(Client())` covers the common case: you boot the Carno app, `src/generated/app.ts` appears, a watcher keeps it current. That is not enough when:

- the Vite dev server starts before the API,
- a frontend package is built in CI without running `listen()`,
- a Bun-only script compiles the client without constructing `Carno`.

Those flows still must not require a manual watch command. They hook into a tool you already run.

Pick **one** owner of generation-at-start so you are not scanning the same tree twice. Watch from two sides of a monorepo is harmless — identical contents are not rewritten — but a single owner is easier to reason about.

## Vite

Add the plugin to the Vite config the frontend already has.

```ts
import { defineConfig } from 'vite';
import { carnoClient } from '@carno.js/client/vite';

export default defineConfig({
  plugins: [
    carnoClient({
      root: '../api',
      output: 'src/generated/app.ts',
    }),
  ],
});
```

`vite` and `vite build` generate during `buildStart`. In `vite` (dev), the same shared watcher used by `Client()` observes the API sources and regenerates. `vite build` fails if generate throws, which is what you want in a release pipeline.

### Options

`carnoClient()` accepts the same options as `Client()`, with one emphasis: `root` is the **Carno app directory**, not the Vite project, whenever the two are separate packages.

| Typical layout | `root` | `output` |
| :--- | :--- | :--- |
| API and Vite in the same package | omit (cwd) | `src/generated/app.ts` |
| `apps/api` + `apps/web` | `'../api'` | `src/generated/app.ts` (inside the web package) |

The frontend then writes:

```ts
import type { App } from './generated/app';
```

and never reaches into `apps/api/src`.

If the API already runs `.use(Client({ output: '../web/src/generated/app.ts' }))`, the Vite plugin is optional. Use Vite when people start the UI without the API.

## Bun Preload

For a Bun app without Vite, a one-time preload generates at compile time:

```toml
# bunfig.toml
preload = ["@carno.js/client/register"]
```

`bun run src/main.ts` and `bun build` then write the file before your code runs. The preload does **not** start a watcher. `.use(Client())` still owns watch on `listen()`.

If the process already uses `.use(Client())`, the preload is redundant. Use it for `bun build` of a frontend, or for a worker that imports `App` but never constructs `Carno`.

### Environment variables

All optional. Useful when the same preload is reused across packages.

| Variable | Meaning |
| :--- | :--- |
| `CARNO_CLIENT_ROOT` | Project root (default: cwd) |
| `CARNO_CLIENT_OUTPUT` | Output path |
| `CARNO_CLIENT_INCLUDE` | Comma-separated globs |
| `CARNO_CLIENT_SILENT` | `1` to suppress the success log |

```bash
CARNO_CLIENT_ROOT=../api CARNO_CLIENT_OUTPUT=src/generated/app.ts bun run dev
```

## Monorepo Layout

A typical split is `apps/api` and `apps/web`. The generated file has to live in the package that typechecks the UI.

### API owns the file

```ts
// apps/api/src/main.ts
app.use(Client({
  output: '../../apps/web/src/generated/app.ts',
  include: ['src/**/*.ts'],
}));
```

Developers who run only the API still refresh the web types. Developers who run only Vite need the Vite plugin as well, or they typecheck against a stale file.

### Web owns the file

```ts
// apps/web/vite.config.ts
carnoClient({
  root: '../api',
  output: 'src/generated/app.ts',
});
```

Developers who run only Vite get a fresh contract. A production API `listen()` can skip generate entirely because the file is not in the API package.

### Commit or ignore

Either commit `src/generated/app.ts` so clones typecheck before the first boot, or generate it in CI before `tsc` / `vite build`. Production `listen()` will not refresh a file that already exists, so a committed stale file in production is a real footgun — refresh it in the pipeline.

## Continuous Integration

`carno-client generate` is an escape hatch for images that never start the app and never run Vite. It is not the documented daily workflow and it has no `--watch` mode.

```bash
bunx carno-client generate --root . --output src/generated/app.ts
```

| Flag | Meaning |
| :--- | :--- |
| `--root <dir>` | Project root (default: cwd) |
| `--output <file>` | Generated file |
| `--include <globs>` | Comma-separated globs |
| `--tsconfig <file>` | tsconfig path |
| `--silent` | No success log |

A frontend pipeline that already runs `vite build` does not need the CLI: the Vite plugin generates during `buildStart` and fails the job if it cannot.

An API-only image that typechecks the generated file without booting can run the CLI as a step before `tsc`.

## Choosing a Trigger

| Situation | Use |
| :--- | :--- |
| People run the Carno app during development | `.use(Client())` only |
| People often start Vite without the API | Vite plugin (and optionally `Client()` with the same `output`) |
| Bun frontend / `bun build` without Vite | `preload = ["@carno.js/client/register"]` |
| CI image with neither Vite nor `listen()` | `carno-client generate` |

There is no supported path that is "run a watch script in `package.json`". If generation is not happening, a trigger above is missing — not a forgotten CLI flag.

## What This Version Does Not Generate

These are intentional omissions, not missing configuration:

- programmatic `app.route()` / `app.addRoutes()`,
- a WebSocket client for `@carno.js/websocket`,
- OpenAPI documents,
- per-handler unions of thrown `HttpException` classes,
- any new decorator on `@carno.js/core`.

## See Also

- [Enabling the Plugin](./plugin) for `output`, `include` and production skip rules.
- [The HTTP Client](./http) for importing `App` after the file exists.
- The `examples/client` package (`bun run build:web` exercises the Vite plugin end to end).
