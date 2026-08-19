---
sidebar_position: 2
---

# Enabling the Plugin

The primary API is the same plugin pattern as logger and static files: `Client()` returns a `Carno` instance, and `.use()` imports its service. Nothing in `@carno.js/core` is patched. There is no `getRoutes()` hook and no new lifecycle event.

This page covers what the plugin does on boot, how development differs from production, and when to leave the defaults.

## Registering the Plugin

```ts
import { Carno } from '@carno.js/core';
import { Client } from '@carno.js/client';
import { UserController } from './users.controller';

const app = new Carno()
  .use(Client())
  .controllers([UserController]);

await app.listen(3000);
```

You do not pass controllers to `Client()`. The plugin never inspects the live router. It globs TypeScript sources (see [How Routes Become a Contract](./codegen)) so nested `children` and files that are not in `.controllers([...])` still appear in the client if they are decorated.

Order relative to other plugins does not matter for generation. The plugin does not register HTTP routes of its own.

## What `listen()` Actually Does

`listen()` already awaits `@OnApplicationInit` before the server accepts traffic. Client registers a service on that hook. During bootstrap it:

1. Collects TypeScript files under `include`.
2. Builds a compiler program, using your `tsconfig` plus the decorator flags Carno already requires.
3. Finds `@Controller` classes, HTTP method decorators and parameter decorators.
4. Resolves path arguments to string literals when it can.
5. Writes `App` and `paths` to `output`.
6. Starts a file watcher when the process is not in production.

`@OnApplicationShutdown` stops the watcher. The watcher is not on the request hot path. A first boot pays for one TypeScript program; later boots reuse a mtime cache and skip the write when the file contents did not change.

### Failures

In **development**, a scan or write error is printed as `[@carno.js/client] …` and the server keeps running. You still have a process to fix the controller.

In **production**, a failed generate throws out of init. Shipping an API whose client contract could not be produced is worse than failing the boot. The usual production setup avoids that path entirely by committing the file or generating it in CI, so `listen()` finds it already there.

## Development Versus Production

| Environment | Generate on boot | Watch sources | If the file already exists |
| :--- | :--- | :--- | :--- |
| Development (`NODE_ENV` is not `production`) | Always | Yes, debounce 150ms | Overwrite only when the contract changed |
| Production | Only if the file is missing | No | Use the committed or CI-built file |

The watcher observes the directories implied by `include` (typically `src/`). It ignores:

- the generated file itself, so a write cannot loop,
- spec and declaration files,
- `node_modules` and `dist`.

Identical output is not rewritten. That keeps Vite HMR quiet when a save in the API did not change the public contract.

Do not add `carno-client generate --watch` to `package.json`. Watch is an internal detail of the plugin (and of the Vite plugin). The CLI exists only for CI images that never start the app; see [Frontend and CI Generation](./generation).

## Options

Defaults match a typical application whose sources live in `src/` and whose frontend can import `src/generated/app.ts` from the same package. Override them when the UI lives next door, or when controllers are not under `src/`.

```ts
app.use(Client({
  output: '../web/src/generated/app.ts',
  include: ['src/**/*.ts'],
}));
```

| Option | Default | Meaning |
| :--- | :--- | :--- |
| `root` | `process.cwd()` | Directory used to resolve `include`, `output` and `tsconfig` |
| `include` | `['src/**/*.ts']` | Source globs, relative to `root` |
| `exclude` | spec files, `generated`, `node_modules`, `dist` | Always applied on top of any extra `exclude` you pass |
| `output` | `src/generated/app.ts` | Generated file, relative to `root`, or an absolute path |
| `watch` | `true` outside production | Internal watcher. `false` disables it. `true` forces it even in production |
| `tsconfig` | nearest `tsconfig.json` | Compiler options for the scan |
| `silent` | `false` | Suppress the success log |
| `debounceMs` | `150` | Delay after a file change before regenerating |
| `force` | `false` | Generate even when production already has an output file |

`nodeEnv` exists so tests can pin the environment. Application code should rely on `NODE_ENV`.

### Choosing `output`

Put the file where the frontend typechecks, not where it is convenient for the API:

```ts
// API and web as sibling packages
app.use(Client({
  root: process.cwd(),
  output: '../web/src/generated/app.ts',
}));
```

The API process then owns generation while it is running. If developers often start only Vite, let the [Vite plugin](./generation#vite) own `output` instead. Having both watch the same path is safe: unchanged contents are not written again.

### Choosing `include`

Widen `include` when route constants or DTOs live outside `src/`, for example `['src/**/*.ts', 'packages/contracts/**/*.ts']`. Narrow it if a large `src/` tree makes the first scan slow and your controllers sit in a known folder.

Excluded globs always include `**/*.spec.ts`, `**/*.test.ts`, `**/*.d.ts`, `**/generated/**`, `**/node_modules/**` and `**/dist/**`. You do not need to repeat those.

### `silent` and logs

On a successful write the plugin logs:

```text
[@carno.js/client] Generated src/generated/app.ts (12 routes)
```

Unresolved path expressions become warnings with file and line. Those warnings are the first place to look when a route is missing from `App`.

## What the Plugin Is Not

- It is not a second router. Removing `.use(Client())` does not change HTTP behavior.
- It is not OpenAPI. The artifact is a TypeScript module.
- It is not required for the API to boot in development if generate fails; it *is* required for the frontend to typecheck against the current controllers.

## See Also

- [HTTP Client](./overview) for the mental model.
- [How Routes Become a Contract](./codegen) for what the scanner reads.
- [Lifecycle Events](../core/lifecycle) for the hooks the plugin uses.
