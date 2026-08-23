---
sidebar_position: 1
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Views

`@carno.js/views` is an optional MVC view adapter. The HTTP core still returns whatever a controller produces: `ctx.html(string)` already builds a `text/html` `Response`, and `buildResponse` forwards any `Response` unchanged. This package adds template compilation on top of that path.

There is no `@Render()` decorator. Controllers inject `ViewService` and call `html()` or `respond()`.

## Installation

<Tabs groupId="os">
  <TabItem value="mac" label="macOS / Linux">
    ```bash
    bun install @carno.js/views
    ```
  </TabItem>
  <TabItem value="windows" label="Windows">
    ```bash
    bun install "@carno.js/views"
    ```
  </TabItem>
</Tabs>

Install only the engine you select. Official engines are optional peer dependencies and are loaded with dynamic `import()` on first render:

```bash
bun add handlebars
# or
bun add ejs
# or
bun add pug
```

## Setup

`engine` is required. Omitting it is a configuration error so an optional library is never loaded by accident.

```ts
import { Carno } from '@carno.js/core';
import { CarnoViews } from '@carno.js/views';

const app = new Carno()
  .use(CarnoViews({
    engine: 'handlebars',
    views: './views',
    layout: 'layouts/main',
    partials: 'partials',
    helpers: {
      shout: (value: string) => String(value).toUpperCase(),
    },
  }));

await app.listen(3000);
```

When `views` is omitted it resolves to `path.resolve(process.cwd(), './views')`.

## Rendering from a controller

```ts
import { Controller, Ctx, Get, type Context } from '@carno.js/core';
import { ViewService } from '@carno.js/views';

@Controller('/pages')
export class PagesController {
  constructor(private views: ViewService) {}

  @Get('/about')
  async about() {
    return this.views.html('about', { title: 'About' });
  }

  @Get('/profile')
  async profile(@Ctx() ctx: Context) {
    return this.views.respond(ctx, 'profile', { name: 'Ada' });
  }
}
```

`html()` and `respond()` return promises. Mark the controller method `async` so Carno awaits the `Response`.

- `html(name, data)` always returns `Content-Type: text/html`.
- `respond(ctx, name, data)` inspects `Accept`, sets `Vary: Accept`, and chooses HTML or JSON. When both formats are refused, it returns `406 Not Acceptable`.

| Accept | Result |
| :--- | :--- |
| `text/html` | Rendered template |
| `application/json` | `Response.json(data)` without reading a template |
| `text/*` / `application/*` | HTML or JSON respectively |
| a format listed with `q=0` | Never selected, even when it is `negotiate.default` or covered by `*/*` |
| both HTML and JSON listed with `q=0` | `406 Not Acceptable` without reading a template |
| missing, `*/*`, unmatched, or a html/json tie | `negotiate.default` (`html` unless configured otherwise) |

```ts
CarnoViews({
  engine: 'handlebars',
  negotiate: { default: 'html' },
});
```

Helpers from `options.helpers` are registered before the first render. Call `views.registerHelper(name, fn)` later to add or replace one.

## Engines

| `engine` | Extensions | Notes |
| :--- | :--- | :--- |
| `'handlebars'` | `.hbs`, `.handlebars` | Compile + cache, global helpers, partials from `partials` |
| `'ejs'` | `.ejs` | Passes `filename`, `root` and `views` so `<%- include(...) %>` works; includes cannot leave the views root |
| `'pug'` | `.pug`, `.jade` | Passes `filename` (current template) and `basedir` (views root) so `extends` / `include` work; nested files cannot leave the views root |
| custom `ViewEngine` | adapter `extensions` | No official package is loaded |

A missing official library fails only when that engine is selected:

```txt
Unable to load the "handlebars" view engine. Install it with: bun add handlebars
```

### Custom adapter

The service reads files, enforces the views root, and caches compiled templates. The adapter receives source and filename:

```ts
import type { ViewEngine } from '@carno.js/views';

const markdown: ViewEngine = {
  name: 'plain',
  extensions: ['.html'],
  compile(source) {
    return source;
  },
  render(template, data) {
    return String(template).replace('{{name}}', String(data.name ?? ''));
  },
};

CarnoViews({ engine: markdown, views: './views' });
```

`compile(source, filename, options?)` is optional and returns an opaque template. `render(template, data, options?)` returns `string | Promise<string>`. When `compile` is omitted, `render` receives the source string.

## Layouts

When `layout` is set, the service renders the page first and then renders the layout with that HTML as trusted `body`. `body` is output from your own templates, not request input.

| Engine | Layout marker |
| :--- | :--- |
| Handlebars | `{{{body}}}` |
| EJS | `<%- body %>` |
| Pug | `!= body` |

Pug templates can still use native `extends` / `include` without the `layout` option; `filename` identifies the current template and `basedir` is the views root.

## Cache

`cache` defaults to `true` when `NODE_ENV === 'production'`, otherwise `false`.

- `cache: true` stores compiled templates (and file contents) by absolute path. Official engines receive the same flag, so EJS `include`s stay frozen too. Editing a file on disk does not change the next response until the process restarts.
- `cache: false` re-reads and recompiles on every render, including EJS partials pulled in with `include`. Handlebars partials that disappear from disk are unregistered so they are not still rendered.

## Security

View names are resolved only under the configured `views` directory:

- Absolute names and `..` segments are rejected with HTTP 403.
- Resolved paths, including `realpath` after a successful lookup, must stay inside the root (symlink escape is 403).
- EJS `include()` and Pug `include` / `extends` are confined the same way: relative `../` escapes, absolute filesystem paths, and symlinks that leave `views` throw `ViewForbiddenError` (HTTP 403). The public message never includes absolute paths. Pug `/`-prefixed paths stay basedir-relative (`include /layout` → `${views}/layout`).
- A missing template throws `ViewNotFoundError`, which extends `NotFoundException` and becomes HTTP 404. Tried paths stay on the error object and are not included in the public message.

## Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `engine` | `'handlebars' \| 'ejs' \| 'pug' \| ViewEngine` | required | Official engine name or custom adapter |
| `views` | `string` | `'./views'` | Template root, resolved from `process.cwd()` |
| `cache` | `boolean` | `NODE_ENV === 'production'` | Cache compiled templates and file contents |
| `layout` | `string` | none | Layout view name resolved like any other template |
| `partials` | `string` | none | Partials directory, relative to `views` unless absolute |
| `helpers` | `Record<string, Function>` | `{}` | Helpers available from the first render |
| `negotiate.default` | `'html' \| 'json'` | `'html'` | Fallback when Accept is missing, `*/*`, unmatched, or tied. Not used for a format listed with `q=0`. When both HTML and JSON are refused, `respond()` returns 406 instead |
