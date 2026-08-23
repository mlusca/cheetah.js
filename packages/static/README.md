# @carno.js/static

High-performance static file serving plugin for the [Carno.js](https://github.com/carnojs/carno) framework, built on top of Bun.

Designed with a dual-mode architecture to provide the best developer experience in development and maximum performance in production.

## Features

- 🚀 **Zero-I/O Production Mode**: Pre-loads files into memory and serves them directly using Bun's native router (SIMD-accelerated).
- 🛠️ **Developer Friendly**: Hot-reloading support (on-demand file reading) in development.
- 🔒 **Secure by Default**: Built-in protection against path traversal attacks and dotfile access.
- 📱 **SPA Support**: Automatic fallback to `index.html` for Single Page Applications (React, Vue, etc.).
- 📦 **Multi-Instance**: Support for multiple static folders with different prefixes.
- ⚡ **Cache Control**: Configurable HTTP caching headers.

## Installation

```bash
bun add @carno.js/static
```

Requires `@carno.js/core` to be installed.

## Usage

### Basic Usage

Register the plugin in your Carno application:

```typescript
import { Carno } from '@carno.js/core';
import { StaticPlugin } from '@carno.js/static';

const app = new Carno();

app.use(await StaticPlugin.create({
    root: './public',      // Path to your static files
    prefix: '/assets'      // URL prefix (optional)
}));

app.listen(3000);
```

### Production Mode (Recommended)

In production, you should enable `alwaysStatic: true`. This tells the plugin to pre-load all files into memory during startup.

This completely eliminates disk I/O during requests, offering **extreme performance** for assets like CSS, JS, and images.

```typescript
app.use(await StaticPlugin.create({
    root: './dist',
    prefix: '/',
    // Automatically enable in production
    alwaysStatic: process.env.NODE_ENV === 'production',
    // Optional: Cache-Control header (defaults to 1 hour)
    cacheControl: 'public, max-age=31536000'
}));
```

### SPA Mode (Single Page Applications)

If you are serving a frontend app (React, Vue, Angular) that uses client-side routing, enable `spa: true`. This will serve `index.html` for unknown browser routes that don't match a static file. Requests with a file extension (`/missing-file.js`) and unknown `/api/*` paths return `404` instead of the SPA shell.

```typescript
app.use(await StaticPlugin.create({
    root: './dist',
    prefix: '/',
    spa: true,
    index: 'index.html' // default
}));
```

### Multiple Static Directories

You can register the plugin multiple times to serve different directories under different prefixes.

```typescript
// Serve public assets
app.use(await StaticPlugin.create({
    root: './public',
    prefix: '/'
}));

// Serve admin panel assets
app.use(await StaticPlugin.create({
    root: './admin/dist',
    prefix: '/admin'
}));
```

## Configuration

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `root` | `string` | `'public'` | Root directory containing static files (relative to CWD). |
| `prefix` | `string` | `'/'` | URL prefix to serve files under. |
| `alwaysStatic` | `boolean` | `NODE_ENV === 'production'` | If `true`, pre-loads files into memory. If `false`, reads from disk on every request. |
| `spa` | `boolean` | `false` | Enable SPA fallback (returns `index.html` on 404). |
| `index` | `string \| string[]` | `'index.html'` | Filename(s) to look for when a directory is requested. |
| `extensions` | `string[]` | `[]` | Whitelist of allowed file extensions (e.g. `['html', 'css']`). Empty = all allowed. |
| `dotFiles` | `boolean` | `false` | Allow access to dotfiles (e.g. `.env`, `.git`). **Keep false for security.** |
| `cacheControl` | `string` | `'public, max-age=3600'` | `Cache-Control` header value sent with responses. |
| `staticLimit` | `number` | `1024` | Max number of files to pre-load in production mode. If exceeded, falls back to dynamic serving. |
| `ignorePatterns` | `(string \| RegExp)[]` | `['.DS_Store', '.git', '.env']` | Files to ignore during scanning. |

## Performance Architecture

The plugin uses a dual-strategy approach:

### 1. Development Mode (`alwaysStatic: false`)
- Uses a **Controller** with a wildcard route.
- Reads files from disk on every request.
- Changes to files are reflected immediately (Hot Reloading friendly).

### 2. Production Mode (`alwaysStatic: true`)
- **Pre-loads** files into RAM at startup.
- Registers **individual routes** for every file using `app.route()` (Carno Core API).
- Routes are handled directly by **Bun's native optimized router** (Zig).
- **Zero Disk I/O** = Maximum Throughput.
- Best for deployments with reasonable asset sizes (e.g., frontend builds).

> **Note:** If `staticLimit` is exceeded (default 1024 files), the plugin safely falls back to dynamic serving even in production to prevent excessive memory usage.

## Security

- **Path Traversal**: Prevents access to files outside `root` using `path.relative()` checks.
- **Dotfiles**: Access to files starting with `.` is blocked by default.
- **Whitelist**: Optionally restrict serving to specific file extensions.

## License

MIT
