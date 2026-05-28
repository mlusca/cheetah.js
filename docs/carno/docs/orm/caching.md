# Caching

Carno ORM can cache query results for read-heavy paths. The ORM cache is built on top of `CacheService` from `@carno.js/core`; when the ORM has access to that service, it can store and retrieve query results by a generated cache key.

Use query caching for data that is read often and can tolerate a short delay before reflecting writes, such as settings, catalogs, dashboards and expensive filtered lists.

Avoid query caching for data that must always be freshly read after every write unless you keep the TTL very short or rely on automatic invalidation.

## Configuration

Caching is controlled from your ORM connection settings in `carno.config.ts`.

```ts
import { BunPgDriver, type ConnectionSettings } from '@carno.js/orm';

const config: ConnectionSettings = {
  driver: BunPgDriver,
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'password',
  database: 'my_app',
  cache: {
    maxKeysPerTable: 10000,
    invalidateCacheOnWrite: true,
  },
};

export default config;
```

`maxKeysPerTable` limits how many query cache keys the ORM tracks per table. `invalidateCacheOnWrite` controls whether writes clear cached reads for the affected table. It defaults to `true`.

Register the ORM plugin normally:

```ts
import { Carno } from '@carno.js/core';
import { CarnoOrm } from '@carno.js/orm';

const app = new Carno()
  .use(CarnoOrm);
```

## Enabling Cache Per Query

Caching is opt-in per query. Repository methods, Active Record methods and the Query Builder all support it.

### Repository and Active Record

`find`, `findOne`, `findAll` and `findOneOrFail` accept a `cache` option.

```ts
// Cache for 1 minute.
const users = await userRepository.find({
  where: { isActive: true },
  cache: 60000,
});

// Cache until evicted or invalidated.
const settings = await Settings.findOne({
  where: { key: 'site_title' },
  cache: true,
});

// Cache until a specific time.
const promo = await Promotion.findOne({
  where: { code: 'SUMMER2026' },
  cache: new Date('2026-09-01'),
});
```

### Query Builder

Use `.cache()` on the query builder.

```ts
const topProducts = await Product.createQueryBuilder()
  .where({ rating: { $gt: 4.5 } })
  .orderBy({ sales: 'DESC' })
  .limit(10)
  .cache(30000)
  .executeAndReturnAll();
```

## Cache Option Values

| Value | Behavior |
| :--- | :--- |
| `number` | TTL in milliseconds |
| `true` | Cache without a TTL, until eviction or invalidation |
| `Date` | Cache until that date/time |
| `false` | Explicitly bypass cache |
| `undefined` | Do not cache |

## How Query Caching Works

When caching is enabled:

1. The ORM builds the SQL statement and parameters.
2. A cache key is generated from the query shape and values.
3. The cache is checked before the database is queried.
4. A cache hit returns the stored result.
5. A cache miss executes the query and stores the result with the configured TTL.

The cache key includes query details, so different filters, ordering, limits and selected fields produce different cached entries.

## Invalidation

By default, write statements invalidate cached reads for the table they affect.

This applies to:

- `INSERT`
- `UPDATE`
- `DELETE`
- Repository writes
- Active Record writes
- Query Builder writes

Disable automatic invalidation only when you are intentionally accepting stale results until TTL expiry or you have another invalidation strategy.

```ts
const config: ConnectionSettings = {
  driver: BunPgDriver,
  // ...connection settings
  cache: {
    invalidateCacheOnWrite: false,
  },
};
```

## Practical Guidelines

- Prefer short TTLs for user-facing data that changes often.
- Use longer TTLs for reference data, public catalogs and expensive reports.
- Keep cache enabled per query instead of caching every read by default.
- Do not cache queries whose result depends on external state not represented in the SQL.
- Be careful when caching tenant-scoped queries; make sure the tenant condition is part of the query.
- Use write invalidation unless you have measured that it is too aggressive.

## See Also

- [Querying & Operators](./querying) for filter syntax.
- [Repository](./repository) for repository query options.
- [Tenant Isolation](./tenant-isolation) for tenant-scoped reads.
