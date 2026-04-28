---
sidebar_position: 17
---

# Session (Unit of Work)

The `Session` is a unit of work that lets you queue inserts, updates and deletes across multiple entity types and commit them all at once in a single transaction with FK-safe ordering.

```typescript
import { Session, withSession } from '@carno.js/orm';
```

## Why Session?

- **One transaction**, many statements: insert parents, then children, then run all updates, then deletes — atomically.
- **FK-safe order**: `flush()` topologically sorts queued entity classes by their many-to-one relations. Parents are inserted first; deletes run children-first.
- **Per-chunk batching**: each entity's queued rows are routed through `bulkCreate`/`bulkUpdate`/`bulkDelete`, so a `flush()` of 1000 mixed rows can run as a handful of statements instead of 1000 round-trips.

## Basic usage

```typescript
const session = new Session();

session.queueInsert(Author, { id: 1, name: 'Ada' });
session.queueInsert(Book,   { id: 1, title: 'Analytical Engine', authorId: 1 });
session.queueUpdate(Book,   { id: 99, title: 'Renamed' });
session.queueDelete(Stale,  42);

const result = await session.flush();
// { inserted: 2, updated: 1, deleted: 1 }
```

The session is automatically cleared after a successful `flush()`. To discard pending work without committing, call `session.clear()`.

## API

| Method                                      | Description                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `queueInsert(EntityClass, row)`             | Append a row to the insert bucket for `EntityClass`.                       |
| `queueUpdate(EntityClass, row)`             | Append a row (must include PK) to the update bucket for `EntityClass`.     |
| `queueDelete(EntityClass, id)`              | Append an id to the delete bucket for `EntityClass`.                       |
| `flush({ chunkSize? })`                     | Execute everything in one transaction. Returns `{ inserted, updated, deleted }`. |
| `clear()`                                   | Drop all queued operations without executing.                              |
| `pendingCount()`                            | `{ inserts, updates, deletes }` counts currently queued.                   |

## Topological order

For each queued entity class, `flush()` inspects its `@ManyToOne` relations and produces a dependency graph. The ordering is:

1. **Inserts** — parents before children. If `Book` is queued and references `Author`, `Author` rows are inserted first.
2. **Updates** — bucket order is irrelevant; updates run per-class via `bulkUpdate`.
3. **Deletes** — children before parents (reverse of the insert order), so FK constraints stay satisfied.

If a cycle is detected (rare; only happens with self-referencing graphs), the session falls back to insertion order. In that case you should commit the cycle in two phases or rely on deferred constraints (database-level).

## Atomicity

`flush()` opens a transaction (or reuses the current one) and runs every queued statement inside it. Any error rolls back **everything** — inserts, updates, and deletes. The session is left clear so you can re-queue and retry.

```typescript
try {
  await session.flush();
} catch (err) {
  // Nothing was committed; session is empty.
}
```

If `flush()` is invoked while already inside `Orm.getInstance().transaction(...)`, it joins that transaction instead of opening a new one.

## `withSession()` helper

For ergonomic auto-flush:

```typescript
import { withSession } from '@carno.js/orm';

await withSession(async (s) => {
  s.queueInsert(Author, { name: 'Ada' });
  s.queueInsert(Book,   { title: 'X', authorId: 1 });
});
// Auto-flushed; throws if work failed (no commit).
```

If the callback throws, the session is cleared and the error is rethrown. Pass `{ autoFlush: false }` to disable the auto-flush and call `session.flush()` yourself.

## Performance

`Session.flush()` measured against an equivalent series of sequential `create()` calls (50 authors + 500 books, mixed graph):

| Driver   | Sequential | `flush()` | Speedup |
| -------- | ---------- | --------- | ------- |
| Postgres | ~538 ms    | ~9 ms     | **~57×**  |
| MySQL    | ~1930 ms   | ~18 ms    | **~106×** |

## When NOT to use Session

- Single homogeneous batch → use `Repository.bulkCreate / bulkUpdate / bulkDelete` directly.
- You need the inserted ids inside the same call to chain further work — `Session` returns counters, not entities. Use `Repository.bulkCreate` (which returns the hydrated rows) and then queue follow-up work by id.

## See also

- [Bulk Operations](./bulk-operations) — the primitives `Session` is built on.
- [Transactions](./transactions) — manual transaction control.
