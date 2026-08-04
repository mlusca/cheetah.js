---
sidebar_position: 7
---

# Caching

`CacheService` provides a small driver-based cache API for application code and first-party packages. The core package includes an in-memory driver by default and a Redis driver for distributed deployments.

Use caching when a value is expensive to compute or fetch and can be reused safely for a period of time.

Common examples:

- Configuration loaded from a database.
- Public product catalogs.
- Expensive aggregate queries.
- Feature flag snapshots.
- External API responses.

Avoid caching values that must reflect every write immediately unless you have a clear invalidation strategy.

## Default Cache Service

Carno registers a `CacheService` automatically during application bootstrap.

```ts
import { CacheService, Service } from '@carno.js/core';

@Service()
export class ProductService {
  constructor(private cache: CacheService) {}
}
```

By default, `CacheService` uses `MemoryDriver`.

## Basic Operations

```ts
await this.cache.set('product:1', { id: 1, name: 'Phone' }, 60000);

const product = await this.cache.get<{ id: number; name: string }>('product:1');

if (await this.cache.has('product:1')) {
  await this.cache.del('product:1');
}
```

Methods:

| Method | Description |
| :--- | :--- |
| `get<T>(key)` | Returns a cached value or `null` |
| `set<T>(key, value, ttl?)` | Stores a value |
| `del(key)` | Deletes one key |
| `has(key)` | Checks whether a non-expired key exists |
| `clear()` | Clears the driver |
| `getMany(keys)` | Reads many keys |
| `setMany(entries)` | Stores many keys |
| `delMany(keys)` | Deletes many keys |
| `getOrSet(key, cb, ttl?)` | Cache-aside helper |
| `close()` | Closes the driver if it has resources |

## TTL Units

TTL values are numbers in milliseconds.

```ts
await this.cache.set('profile:42', profile, 30_000); // 30 seconds
await this.cache.set('settings', settings, 3_600_000); // 1 hour
```

If no TTL is provided, the value uses the service default TTL. If no default TTL exists, the value does not expire automatically.

## Cache-Aside With `getOrSet`

`getOrSet()` implements the common cache-aside pattern:

1. Try to read from cache.
2. If present, return the cached value.
3. If missing, compute it.
4. Store it.
5. Return it.

```ts
async getProduct(id: string) {
  return this.cache.getOrSet(
    `product:${id}`,
    async () => {
      return this.products.findById(id);
    },
    30_000,
  );
}
```

This keeps controller and service code from repeating the same check-then-fetch boilerplate.

### Singleflight (same process only)

When several callers miss the same key at the same time, `getOrSet` runs the callback **once** and shares the result with every concurrent waiter on that `CacheService` instance.

- Coordination is **local to the process** (an in-memory map of in-flight promises).
- Multi-instance deployments with Redis still run **one computation per process** on a shared miss; there is no distributed lock.
- If the callback rejects, all concurrent waiters see the error and a later call may retry.

## Key Prefixing

Use a prefix to isolate environments, modules or tenants.

```ts
import { CacheService } from '@carno.js/core';

const cache = new CacheService({
  prefix: 'my-app',
});

await cache.set('settings', settings);
// Stored as my-app:settings in the driver.
```

Prefixing is especially useful when multiple applications share the same Redis database.

## Memory Driver

`MemoryDriver` stores values in the current process. Capacity and cleanup defaults protect against unbounded growth:

| Option | Default | Description |
| :--- | :--- | :--- |
| `maxEntries` | `10_000` | Maximum keys retained; least-recently-used entries are evicted when full |
| `cleanupIntervalMs` | `60_000` | Periodic scan that drops expired keys never read again. Use `0` to disable |

Reads and overwrites refresh LRU order (via `Map` insertion order). Expired entries are still removed lazily on `get`/`has`. The cleanup timer is `unref`'d so it does not keep the process alive by itself. `app.stop()` and graceful shutdown (`SIGTERM`/`SIGINT`) call `CacheService.close()` so the timer and in-memory storage are released with the application.

```ts
import { CacheService, MemoryDriver } from '@carno.js/core';

// Defaults: maxEntries=10_000, cleanup every 60s
const cache = new CacheService({
  driver: new MemoryDriver(),
});

// Custom capacity and cleanup
const bounded = new CacheService({
  driver: new MemoryDriver({
    maxEntries: 50_000,
    cleanupIntervalMs: 30_000,
  }),
});

// Opt out of the timer (lazy expiration only)
const lazyOnly = new CacheService({
  driver: new MemoryDriver({ cleanupIntervalMs: 0 }),
});
```

The positional form `new MemoryDriver(cleanupIntervalMs)` remains supported for compatibility; prefer the options object for new code.

Use it for:

- Local development.
- Tests.
- Single-instance applications.
- Short-lived process-local values.

Do not use memory cache as your only shared cache when the application runs multiple instances. Each process has its own isolated memory.

:::note Known risk: TTL units with Redis
Documentation and `MemoryDriver` treat TTL as **milliseconds**. `RedisDriver` currently passes the value to `setex`, which expects **seconds**. Mixing `defaultTtl: 60_000` across drivers is therefore inconsistent. This divergence is intentional until a dedicated compatibility release; prefer driver-specific TTLs when using Redis.
:::

## Redis Driver

Use `RedisDriver` when cached values must be shared across application instances.

```ts
import { CacheService, RedisDriver } from '@carno.js/core';

const cache = new CacheService({
  driver: new RedisDriver({
    host: 'localhost',
    port: 6379,
  }),
  prefix: 'carno',
  defaultTtl: 60_000,
});
```

Register it as the app-level `CacheService`:

```ts
import { Carno, CacheService, RedisDriver } from '@carno.js/core';

const app = new Carno()
  .services([
    {
      token: CacheService,
      useValue: new CacheService({
        driver: new RedisDriver({ url: process.env.REDIS_URL }),
        prefix: 'my-app',
        defaultTtl: 60_000,
      }),
    },
  ]);
```

The Redis driver uses Bun's native Redis client when available and falls back to `ioredis` if installed.

## Custom Drivers

Implement `CacheDriver` to integrate another backend.

```ts
import type { CacheDriver } from '@carno.js/core';

class CustomDriver implements CacheDriver {
  readonly name = 'CustomDriver';

  async get<T>(key: string): Promise<T | null> {
    // read from backend
    return null;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<boolean> {
    // write to backend
    return true;
  }

  async del(key: string): Promise<boolean> {
    return true;
  }

  async has(key: string): Promise<boolean> {
    return false;
  }

  async clear(): Promise<void> {}

  async close(): Promise<void> {}
}
```

Then pass the driver to `CacheService`.

## Practical Guidelines

- Use stable, namespaced keys such as `product:${id}`.
- Choose TTLs based on business tolerance for stale data.
- Delete or overwrite keys after writes when stale data would be harmful.
- Use Redis for multi-instance deployments.
- Avoid caching huge objects unless you know the memory and serialization costs.
- Keep cache failures from becoming data correctness bugs; the database should remain the source of truth.

## See Also

- [Dependency Injection](./dependency-injection) for registering custom cache services.
- [Middleware](./middleware) for request-level cache headers.
- [ORM Caching](../orm/caching) for query result caching.
