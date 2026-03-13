---
sidebar_position: 9
---

# Optimistic Locking

Optimistic locking is a concurrency control strategy that protects records from being silently overwritten when two parts of your application try to update the same row at the same time. Unlike pessimistic locking (which locks the row in the database), optimistic locking does not hold any lock. Instead, it detects a conflict at update time and refuses to apply the stale change.

## Why This Matters

Consider a typical scenario in a multi-user or multi-request environment:

1. User A loads a product record at version `3`.
2. User B independently loads the same product, also at version `3`.
3. User A saves a change. The version in the database is now `4`.
4. User B tries to save their own change, still holding version `3`.

Without optimistic locking, step 4 would silently overwrite User A's change. With optimistic locking, step 4 is rejected because the version in the database (`4`) no longer matches the version User B is trying to update from (`3`). This is called a **stale version** or **stale read** conflict.

Optimistic locking is the right choice when:

- Conflicts are rare, and re-trying the operation is acceptable
- You do not want the overhead of row-level database locks
- You want to detect and surface conflicts in application logic

## The `@Version()` Decorator

Add a version field to your entity with the `@Version()` decorator. This field must also be decorated with `@Property()` so that the ORM maps it to a database column.

```typescript
import { Entity, PrimaryKey, Property, BaseEntity } from '@carno.js/orm';
import { Version } from '@carno.js/orm';

@Entity()
export class Product extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;

  @Property()
  price: number;

  @Property({ default: 0 })
  @Version()
  version: number;
}
```

The column name follows the standard `@Property()` conventions. Use `columnName` if you want a different column in the database:

```typescript
@Property({ columnName: 'lock_version', default: 0 })
@Version()
lockVersion: number;
```

### What `@Version()` Does

When the entity has a `@Version()` field, the ORM intercepts every UPDATE operation and does two things automatically:

1. **Adds a version condition to the WHERE clause.** The update only matches the row if its current version in the database is equal to the version you hold in memory. If another request has already updated the row (and incremented the version), the WHERE condition will match zero rows.

2. **Increments the version in the SET clause.** If the row is found and updated, the version column is automatically set to `currentVersion + 1`. You do not need to manage this yourself.

The version increment and the WHERE condition are applied in the same SQL statement, making the whole check-and-update atomic at the database level.

## How to Use It

### Creating a Record

When creating a new entity, initialize the version to `0`. The ORM does not set a default automatically — you should use the `default` option in `@Property()` so the database inserts `0` when the field is not provided.

```typescript
const product = await productRepository.create({
  name: 'Widget',
  price: 29.99,
  version: 0,
});

console.log(product.version); // 0
```

### Updating a Record

To trigger the version check, include the version field in the **update data** (the second argument). The value you pass is the version you currently hold in memory. The ORM does not use it as the new value — it uses it to:

1. Build a `WHERE version = <your value>` condition to verify the row has not changed since you loaded it.
2. Rewrite the SET clause to `SET version = <your value> + 1` automatically.

You never compute `version + 1` yourself. You just pass what you read.

```typescript
// Load the entity — its current version is 0
const product = await productRepository.findById(1);
console.log(product.version); // 0

// Pass the version you hold in memory.
// The ORM translates this into the SQL below — you do not set the new value.
await productRepository.update(
  { id: product.id },
  { price: 34.99, version: product.version } // version: 0 → "I hold version 0"
);

// SQL executed:
// UPDATE "product" AS p1
// SET price = 34.99, version = 1          ← ORM incremented it
// WHERE (p1.id = 1) AND p1.version = 0   ← ORM added the guard
```

After the update, the database row has `version = 1`. If you load the entity again and update it again, you pass `version: 1` — and the ORM sets `version = 2` and checks `WHERE version = 1`.

If you do not include the version field in the update payload at all, version locking is skipped entirely for that call. This is intentional — it lets you make administrative updates (e.g., a data fix script) without going through the conflict check.

### Sequential Updates

Because each update increments the version, successive updates work naturally as long as you always reload or carry the most recent version:

```typescript
for (let i = 0; i < 3; i++) {
  const product = await productRepository.findOne({ where: { name: 'Widget' } });
  await productRepository.update(
    { id: product.id },
    { price: (i + 1) * 10, version: product.version }
  );
}

// After 3 rounds, product.version in the DB is 3
```

## Conflict Detection: `OptimisticLockError`

If the version in the database has already been advanced (by another request or process) when you submit your update, the ORM throws an `OptimisticLockError`.

```typescript
import { OptimisticLockError } from '@carno.js/orm';

try {
  await productRepository.update(
    { id: 1 },
    { price: 99.99, version: 0 } // stale — database already has version 3
  );
} catch (err) {
  if (err instanceof OptimisticLockError) {
    // Handle the conflict: reload the entity and retry, or inform the user
    console.error(err.message);
    // "Optimistic lock failed for entity Product with ID ..."
  }
}
```

### What `OptimisticLockError` Contains

| Property | Description |
| :--- | :--- |
| `name` | Always `'OptimisticLockError'` |
| `message` | A human-readable description including the entity class name |

### Common Conflict Patterns

**Concurrent user edits** — Two API requests loaded the same record and both try to save. The second one will always get `OptimisticLockError`. You can catch it, reload the entity, and surface a message like "This record was modified by another user. Please review and try again."

**Background jobs** — A scheduled job updates a record, but a user simultaneously edits it through a UI. The same conflict logic applies.

**Retry on conflict** — For automated pipelines where conflicts are rare, you can wrap the update in a retry loop:

```typescript
async function updateWithRetry(id: number, changes: Partial<Product>, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const product = await productRepository.findById(id);
      await productRepository.update(
        { id: product.id },
        { ...changes, version: product.version }
      );
      return; // success
    } catch (err) {
      if (err instanceof OptimisticLockError && attempt < retries - 1) {
        // Reload and retry
        continue;
      }
      throw err;
    }
  }
}
```

## Active Record Style

`@Version()` works equally in Active Record mode. The version check is applied regardless of whether you use a repository or a direct entity method.

```typescript
@Entity()
export class Order extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  status: string;

  @Property({ default: 0 })
  @Version()
  version: number;
}

// Active record usage:
const order = await Order.findById(1);
await Order.update({ id: order.id }, { status: 'shipped', version: order.version });
```

## Important Rules

- **One `@Version()` per entity.** Defining `@Version()` on multiple fields is not supported.
- **Always pass the version in the update payload.** If you omit the version field from your update data, no version check is performed.
- **The version is managed by the ORM, not the database.** Do not add `DEFAULT` auto-increment triggers on this column — the integer value is incremented in application code via the SQL `SET` clause.
- **Version fields are read-only from the application's perspective.** Do not set `version = someArbitraryValue` manually. Always read the version from the loaded entity and pass it back unchanged.
