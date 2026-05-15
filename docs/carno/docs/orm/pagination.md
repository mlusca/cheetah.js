---
sidebar_position: 5
---

# Pagination

Repositories expose `findPage(options)` for offset-based pagination with total metadata.

Use it when an endpoint or UI needs both the current slice of rows and enough information to render page controls.

```typescript
const page = await userRepository.findPage({
  where: { status: 'active' },
  orderBy: { createdAt: 'DESC' },
  page: 2,
  pageSize: 25,
});

page.data;       // User[]
page.total;      // total matching rows
page.page;       // 2
page.pageSize;   // 25
page.totalPages; // Math.ceil(total / pageSize)
```

## Return Shape

`findPage()` returns:

```typescript
export interface Page<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
```

| Field | Description |
| :--- | :--- |
| `data` | The entities for the requested page. |
| `total` | Total rows matching the `where` filter, ignoring pagination. |
| `page` | The normalized 1-based page number used by the query. |
| `pageSize` | The normalized page size used as SQL `LIMIT`. |
| `totalPages` | `0` when `total` is `0`; otherwise `Math.ceil(total / pageSize)`. |

## Options

`findPage()` accepts the same read options as `find()`, except `limit` and `offset` are controlled by `page` and `pageSize`.

```typescript
await userRepository.findPage({
  where: { role: 'admin' },
  orderBy: { id: 'ASC' },
  fields: ['id', 'email'],
  load: ['profile'],
  loadStrategy: 'select',
  cache: 30_000,
  page: 1,
  pageSize: 50,
});
```

| Option | Description |
| :--- | :--- |
| `where` | Filter using the same object syntax as `find()`. |
| `orderBy` | Sort order for stable pagination. Strongly recommended. |
| `fields` | Optional projection for the page data query. |
| `load` | Optional relation loading for the page data query. |
| `loadStrategy` | Relation load strategy for the page data query. |
| `cache` | Applies to the page data query. |
| `page` | 1-based page number. Defaults to `1`. |
| `pageSize` | Number of rows per page. Defaults to `20`. |

`page` and `pageSize` must be positive safe integers. Invalid values throw before any SQL is executed.

## Basic Usage

```typescript
const firstPage = await userRepository.findPage({
  orderBy: { id: 'ASC' },
});
```

With no explicit `page` or `pageSize`, Carno uses:

```typescript
{
  page: 1,
  pageSize: 20
}
```

## Filtering

The `where` option is used for both the data query and the total count query.

```typescript
const activeUsers = await userRepository.findPage({
  where: {
    status: 'active',
    age: { $gte: 18 },
  },
  orderBy: { createdAt: 'DESC' },
  page: 1,
  pageSize: 25,
});
```

If no rows match, `data` is an empty array, `total` is `0`, and `totalPages` is `0`.

## Out-of-Range Pages

Requesting a page greater than `totalPages` is valid. Carno returns an empty `data` array while preserving the requested page number and the total metadata.

```typescript
const result = await userRepository.findPage({
  where: { status: 'active' },
  page: 999,
  pageSize: 25,
});

result.data;       // []
result.total;      // total active users
result.page;       // 999
result.totalPages; // actual last page
```

## Stable Ordering

Always provide an `orderBy` for user-facing pagination.

```typescript
await userRepository.findPage({
  orderBy: [
    { createdAt: 'DESC' },
    { id: 'DESC' },
  ],
  page: 1,
  pageSize: 20,
});
```

Without an explicit order, the database is free to return matching rows in any physical order. That can cause duplicated or skipped rows when users move between pages while data is changing.

## Performance

`findPage()` executes two optimized queries:

- one `SELECT` using `LIMIT` and `OFFSET` for `data`
- one `SELECT COUNT(*)` using the same `where` filter for `total`

The two queries run in parallel, so the method does not wait for the page data before starting the count. The count query does not hydrate entities, does not load relations, and does not apply projections.

For best performance:

- index columns used in `where`
- index columns used in `orderBy`
- keep `pageSize` bounded for API endpoints
- avoid very deep offset pagination for high-volume feeds

Offset pagination is simple and works well for admin screens, search results, tables, and moderate page depths. For infinite feeds over very large tables, cursor pagination may be a better fit.

## TypeScript

The exported types are:

```typescript
import type {
  Page,
  RepositoryFindPageOptions,
} from '@carno.js/orm';
```

Example service method:

```typescript
async listActiveUsers(page = 1): Promise<Page<User>> {
  return this.userRepository.findPage({
    where: { status: 'active' },
    orderBy: { createdAt: 'DESC' },
    page,
    pageSize: 50,
  });
}
```

`RepositoryFindPageOptions<T>` intentionally omits `limit` and `offset`. Use `page` and `pageSize` so the returned metadata always describes the executed query.
