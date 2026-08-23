---
sidebar_position: 6
---

# Static Files

The `@carno.js/static` package is a high-performance static file serving plugin built specifically for the Carno.js and Bun ecosystem.

It features a unique **dual-mode architecture** that optimizes for developer experience in development and raw throughput in production.

## Installation

```bash
bun add @carno.js/static
```

## Setup

Register the plugin in your main application file:

```typescript
import { Carno } from '@carno.js/core';
import { StaticPlugin } from '@carno.js/static';

const app = new Carno();

app.use(await StaticPlugin.create({
    root: './public',      // Path to your static files (relative to CWD)
    prefix: '/assets'      // URL prefix to serve files under
}));

app.listen(3000);
```

## Architecture & Performance

### Development Mode
When `alwaysStatic` is `false` (default in development):
- Files are read **on-demand** from the disk.
- You can modify files that are written to the static root and see changes on the next request without restarting the server.
- Uses a wildcard controller internally.

For React and Angular, the normal HMR workflow uses Vite or Angular CLI as the development file server and proxies `/api` to Carno. `StaticPlugin` can still be used in development with `alwaysStatic: false` when Vite or Angular writes a build to disk with `vite build --watch` or `ng build --watch`, but that mode requires a browser reload and does not provide framework HMR.

### Production Mode 🚀
When `alwaysStatic` is `true` (recommended for production):
- **Zero I/O**: All files are pre-loaded into memory during startup.
- **Native Routing**: Each file is registered as a direct route in Bun's native SIMD-accelerated router.
- **Cache Control**: Automatic `Cache-Control` headers are applied.
- **Performance**: Provides extremely low latency (< 0.2ms) and high throughput, as requests never touch the disk.

> **Note:** If the number of files exceeds `staticLimit` (default 1024), the plugin safely falls back to dynamic serving to prevent excessive memory usage.

```typescript
// Production Configuration
app.use(await StaticPlugin.create({
    root: './dist',
    prefix: '/',
    alwaysStatic: process.env.NODE_ENV === 'production', // Enable memory cache
    cacheControl: 'public, max-age=31536000'
}));
```

## Features

### Single Page Applications (SPA)
If you are building a SPA (React, Vue, Angular), enable `spa: true` to automatically serve `index.html` for any route that doesn't match a static file or API route.

```typescript
app.use(await StaticPlugin.create({
    root: './dist',
    spa: true
}));
```

For the complete development and production workflow, including Vite and Angular CLI proxies, see the [SPA guide](../spa/overview).

The static plugin serves files that already exist on disk. In development, Vite and Angular CLI should normally serve their own development bundles and proxy `/api` to Carno. Use `StaticPlugin` for the compiled frontend directory in production.

### Multiple Static Directories
You can use the plugin multiple times to serve different folders.

```typescript
app.use(await StaticPlugin.create({ root: './public', prefix: '/' }));
app.use(await StaticPlugin.create({ root: './uploads', prefix: '/uploads' }));
```

### Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `root` | `string` | `'public'` | Root directory containing static files. |
| `prefix` | `string` | `'/'` | URL prefix. |
| `alwaysStatic` | `boolean` | `NODE_ENV === 'production'` | Pre-load files into memory. |
| `spa` | `boolean` | `false` | Enable SPA fallback to `index.html`. |
| `index` | `string` | `'index.html'` | Default file for directories. |
| `extensions` | `string[]` | `[]` | Whitelist of allowed extensions. |
| `dotFiles` | `boolean` | `false` | Allow access to dotfiles (e.g. `.env`). |
| `cacheControl` | `string` | `'public, max-age=3600'` | HTTP caching header. |
