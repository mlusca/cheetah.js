# Community Plugins

Carno.js is designed to be extended through **Plugins**. Besides the official `@carno.js/*` packages, the community builds and maintains plugins that integrate Carno.js with other tools and libraries.

This page lists community-maintained plugins. As the ecosystem grows, this list may move to a dedicated repository.

:::info
Community plugins are maintained by their respective authors, not by the Carno.js core team. Always review a plugin's documentation, license, and maintenance status before using it in production.
:::

## Available Plugins

| Plugin | Description | Author |
| :--- | :--- | :--- |
| [`carnojs-better-auth`](https://github.com/dark1zinn/carnojs-better-auth) | [Better Auth](https://www.better-auth.com/) integration for Carno.js. Mounts Better Auth HTTP routes on your app, exposes a DI-friendly `BetterAuthService`, and ships middleware for protecting controllers with session cookies. | [@dark1zinn](https://github.com/dark1zinn) |

## Submitting Your Plugin

Built a plugin for Carno.js? We'd love to feature it here! Open a pull request adding it to this page, or open an issue on the [Carno.js repository](https://github.com/carnojs/carno.js).

A good community plugin usually:

- Follows the Carno.js [Plugin pattern](../core/overview.md) (`app.use(...)`);
- Documents its configuration options and requirements;
- Declares compatible `@carno.js/*` versions in its `peerDependencies`.
