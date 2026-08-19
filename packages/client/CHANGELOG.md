# Changelog

## 1.6.3

- Relative bases such as `client('')` and `client('/api')` resolve as paths instead of throwing `Invalid URL`.
- Void and `undefined` handlers generate `response: null`, matching the `204` / empty-body runtime value.
- `@carno.js/client/vite` resolves to compiled JS under Node so `vite` / `vite build` can load the plugin.
- Initial release of `@carno.js/client`.
- `Client()` plugin generates a typed HTTP client on `listen()` and watches sources in development.
- Vite plugin and optional Bun preload generate the same client at compile time.
- `carno-client generate` is available as a CI escape hatch.
