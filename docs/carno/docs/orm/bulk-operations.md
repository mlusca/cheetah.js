---
sidebar_position: 16
---

# Bulk Operations

Carno ORM provides batch APIs that collapse N round-trips into ⌈N/chunkSize⌉ statements, dramatically reducing the cost of large insert/update/delete workloads.

| API                          | When to use                                                  |
| ---------------------------- | ------------------------------------------------------------ |
| `BaseEntity.createMany`      | Active-record style bulk insert.                             |
| `Repository.bulkCreate`      | Repository style bulk insert with chunking + auto-transaction. |
| `Repository.bulkUpdate`      | Update many rows by primary key in a single CASE statement.  |
| `Repository.bulkDelete`      | Delete many ids in a single `IN (...)` statement.            |
| [`Session`](./session)       | Cross-entity unit of work — atomic graph commit.             |

## Multi-row INSERT

`createMany` and `bulkCreate` emit a single `INSERT INTO t (cols) VALUES (...), (...), ...` per chunk. Per-row hooks (`@BeforeCreate`/`@AfterCreate`), `default`, and `onInsert` are applied to **every** row, so the result is equivalent to N sequential `create()` calls — just dramatically faster.

### Active record

```typescript
const users = await User.createMany([
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob',   email: 'bob@example.com' },
  { name: 'Carol', email: 'carol@example.com' },
]);
// users[0].id, users[1].id, users[2].id are populated
```

`createMany([])` returns `[]` without emitting SQL.

### Repository

```typescript
@Service()
class UserRepository extends Repository<User> {
  constructor() { super(User); }
}

const repo = container.get(UserRepository);

await repo.bulkCreate(
  largeArrayOfRows,
  { chunkSize: 500 } // default 500
);
```

When `rows.length > chunkSize`, `bulkCreate` automatically wraps the chunks in a transaction so a partial failure rolls back every chunk. If the call already runs inside a `transaction(...)`, it reuses that transaction instead of opening a nested one.

### Heterogeneous rows

Rows that omit a column present in another row are padded with `null`. SQL stays well-formed regardless of input shape.

```typescript
await User.createMany([
  { name: 'Alice', email: 'alice@x.com', age: 30 },
  { name: 'Bob',   email: 'bob@x.com'              }, // age becomes NULL
]);
```

### Driver behavior

- **Postgres**: ids are returned via `RETURNING *`.
- **MySQL**: with no explicit ids, `LAST_INSERT_ID()` is used and consecutive ids are assumed (valid under the default `innodb_autoinc_lock_mode = 1`). When all rows have explicit ids, those are used directly.

### Performance

Measured on Bun 1.3, 500 rows, single connection:

| Driver   | Sequential `create()` | `bulkCreate` (chunkSize=250) | Speedup |
| -------- | ---------------------- | ---------------------------- | ------- |
| Postgres | ~462 ms                | ~10 ms                       | **~48×** |
| MySQL    | ~1717 ms               | ~15 ms                       | **~114×** |

## Bulk UPDATE (CASE strategy)

`Repository.bulkUpdate(rows, { chunkSize? })` builds a single CASE-based statement per chunk:

```sql
UPDATE "user"
SET
  "name"  = CASE "id" WHEN 1 THEN 'Alice2' WHEN 3 THEN 'Carol2' ELSE "name"  END,
  "email" = CASE "id" WHEN 1 THEN 'a2@...' ELSE "email" END
WHERE "id" IN (1, 3);
```

- Every row **must** contain the entity's primary key.
- Columns omitted on a given row keep their existing value (`ELSE col`).
- `@onUpdate` hooks (e.g. an automatic `updatedAt`) apply to every row.
- Returns the total `affectedRows` across chunks.

```typescript
await repo.bulkUpdate([
  { id: 1, name: 'Alice2', age: 31 },
  { id: 2, name: 'Bob2'              }, // age unchanged
  { id: 3, age: 33                   }, // name unchanged
]);
```

If `rows.length > chunkSize` (default 500), the operation is wrapped in a transaction.

### Performance

| Driver   | Sequential `updateById()` | `bulkUpdate` | Speedup |
| -------- | -------------------------- | ------------ | ------- |
| Postgres | ~496 ms                    | ~7 ms        | **~71×** |
| MySQL    | ~1532 ms                   | ~8 ms        | **~182×** |

## Bulk DELETE

`Repository.bulkDelete(ids[], { chunkSize? })` chunks the id list and emits one `DELETE WHERE pk IN (...)` per chunk.

```typescript
const deletedCount = await repo.bulkDelete([1, 2, 3, /* ... */]);
```

Non-existent ids are silently ignored (the returned count reflects actual deletes).

### Performance

| Driver   | Sequential `deleteById()` | `bulkDelete` | Speedup |
| -------- | -------------------------- | ------------ | ------- |
| Postgres | ~458 ms                    | ~9 ms        | **~53×** |
| MySQL    | ~1614 ms                   | ~17 ms       | **~94×** |

## When to prefer the [`Session`](./session)

Use `Session` when you have a graph of changes across multiple entity types that must commit atomically with FK-safe ordering. `Repository.bulk*` are the right tool for a single homogeneous batch you want to persist eagerly.
