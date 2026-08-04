---
sidebar_position: 8
---

# Lifecycle Events

Lifecycle hooks let services and controllers react to application startup and shutdown. They are useful for work that belongs to the application boundary rather than to a single request.

Use lifecycle hooks for:

- Opening and closing external connections.
- Loading configuration.
- Warming caches.
- Starting background schedulers.
- Flushing logs.
- Releasing resources on shutdown.

## Application Lifecycle

Carno has three application-level lifecycle moments.

| Decorator | When it runs | Typical use |
| :--- | :--- | :--- |
| `@OnApplicationInit()` | During bootstrap, after providers are registered and before the server starts listening | Connect databases, load config, prepare clients |
| `@OnApplicationBoot()` | After the server has started | Startup logs, health checks, post-boot notifications |
| `@OnApplicationShutdown()` | After `SIGTERM` or `SIGINT` during graceful shutdown | Close connections, flush buffers, stop timers |

```ts
import {
  OnApplicationBoot,
  OnApplicationInit,
  OnApplicationShutdown,
  Service,
} from '@carno.js/core';

@Service()
export class DatabaseService {
  @OnApplicationInit()
  async connect() {
    // connect before traffic is served
  }

  @OnApplicationBoot()
  reportReady() {
    console.log('Database service ready');
  }

  @OnApplicationShutdown()
  async disconnect() {
    // close connection during shutdown
  }
}
```

## Hook Priority

All application lifecycle decorators accept an optional priority. Higher priority runs first.

```ts
@Service()
export class ConfigService {
  @OnApplicationInit(100)
  loadConfig() {
    // runs first
  }
}

@Service()
export class DatabaseService {
  @OnApplicationInit(50)
  connect() {
    // runs after ConfigService
  }
}
```

Use priority when one setup step must happen before another.

## Startup Flow

At a high level, startup works like this:

1. Services and controllers are registered in the DI container.
2. Singleton services are resolved.
3. `@OnApplicationInit()` hooks run.
4. Controllers are compiled into route handlers.
5. Bun starts listening.
6. `@OnApplicationBoot()` hooks run.

`@OnApplicationInit()` is the right hook for dependencies that must be ready before requests are served.

Promises returned from `@OnApplicationInit()` and `@OnApplicationShutdown()` are awaited. `app.listen()` does not resolve until every init hook has finished, and the HTTP server is only started after that barrier. `@OnApplicationBoot()` may still return a promise, but listen does not wait for it.

## Shutdown Flow

When the process receives `SIGTERM` or `SIGINT`:

1. `@OnApplicationShutdown()` hooks run.
2. Container destruction runs `@PreDestroy()` hooks for held singleton instances.
3. The server stops and the registered `CacheService` is closed (cancels `MemoryDriver` cleanup timers, etc.).

Calling `await app.stop()` also stops the server and closes `CacheService`. Prefer awaiting `stop()` so driver cleanup finishes before the process exits.
4. The process exits.

Promises returned from shutdown hooks and `@PreDestroy()` methods are awaited.

## Bean Lifecycle Hooks

Bean lifecycle hooks are tied to individual instances created by the DI container.

### `@PostConstruct()`

`@PostConstruct()` runs after the container creates an instance and resolves constructor dependencies.

```ts
import { PostConstruct, Service } from '@carno.js/core';

@Service()
export class SearchIndex {
  @PostConstruct()
  prepare() {
    // local setup after dependencies exist
  }
}
```

If `@PostConstruct()` returns a promise, Carno starts it and logs errors, but container resolution is not blocked. Use `@OnApplicationInit()` when the application must wait for the work before serving traffic.

### `@PreDestroy()`

`@PreDestroy()` runs during container destruction for singleton instances currently held by the container.

```ts
import { PreDestroy, Service } from '@carno.js/core';

@Service()
export class MetricsBuffer {
  @PreDestroy()
  async flush() {
    // flush pending metrics
  }
}
```

Use it for cleanup owned by the service itself.

## Choosing the Right Hook

| Need | Use |
| :--- | :--- |
| Must prepare app before traffic | `@OnApplicationInit()` |
| Log or notify after server is listening | `@OnApplicationBoot()` |
| Clean up because the process is stopping | `@OnApplicationShutdown()` |
| Initialize one service instance after injection | `@PostConstruct()` |
| Clean up one service instance during container destruction | `@PreDestroy()` |

## Practical Guidelines

- Keep constructors lightweight; put setup in lifecycle hooks.
- Use `@OnApplicationInit()` for async setup that must complete before serving requests.
- Use priorities sparingly and document why an order matters.
- Make shutdown hooks idempotent; they may run while the process is already failing.
- Close timers, sockets and clients in shutdown or pre-destroy hooks.

## See Also

- [Dependency Injection](./dependency-injection) for service creation.
- [Caching](./caching) for cache driver cleanup.
- [Logging](./logging) for buffered log flushing.
