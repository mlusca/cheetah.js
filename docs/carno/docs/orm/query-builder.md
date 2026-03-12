---
sidebar_position: 6
---

# Query Builder

The Query Builder is a powerful tool for constructing complex SQL queries programmatically. It provides a fluent interface for selecting, inserting, updating, and deleting data.

## Creating a Query Builder

You can access the Query Builder from an entity class, a repository, or directly from the `Orm` service.

```typescript
// From Entity (Active Record)
const qb = User.createQueryBuilder();

// From Repository
const qb = this.repository.createQueryBuilder();

// From Orm Service
import { Orm } from '@carno.js/orm';
const qb = orm.createQueryBuilder(User);
```

## Selecting Data

### Basic Select

```typescript
const users = await User.createQueryBuilder()
  .select() // Select all columns
  .where({ isActive: true })
  .executeAndReturnAll();
```

### Filtering with Where

The `where` method accepts a filter object. You can use direct values or operators.
For a comprehensive list of operators and examples, see [Querying & Operators](./querying).

```typescript
// Simple equality
.where({ isActive: true, role: 'admin' })

// Using Operators
.where({
  age: { $gt: 18 },       // Greater than
  score: { $lte: 100 },   // Less than or equal
  name: { $like: 'Jo%' }, // Like
  status: { $in: ['active', 'pending'] } // In array
})
```

Supported operators:
- `$eq`: Equal
- `$ne`: Not equal
- `$gt`: Greater than
- `$gte`: Greater than or equal
- `$lt`: Less than
- `$lte`: Less than or equal
- `$like`: SQL LIKE
- `$in`: In array
- `$nin`: Not in array

### Ordering, Limiting, and Offsetting

```typescript
.orderBy({ name: 'ASC', createdAt: 'DESC' })
.limit(20)
.offset(10)
```

### Loading Relations

You can eagerly load relations using the `load` method.

```typescript
const users = await User.createQueryBuilder()
  .select()
  .load(['posts', 'posts.comments']) // Load nested relations
  .executeAndReturnAll();
```

> **Implicit Loading**: If you filter by a relationship property in the `where` clause (e.g., `.where({ posts: { title: 'Hello' } })`), the ORM automatically joins that relationship to perform the filter. You do not need to explicitly `load` it unless you also want the related data returned in the result set.


## Update Operations

```typescript
await User.createQueryBuilder()
  .update({ isActive: false })
  .where({ lastLogin: { $lt: new Date('2023-01-01') } })
  .execute();
```

For fields whose new value depends on the current value stored in the database, use `expr(...)`.

This is useful when you want the database itself to perform the math in a single `UPDATE`, instead of:

1. loading the row
2. changing the value in JavaScript
3. saving it back

That pattern is slower and easier to race under concurrent writes. `expr(...)` keeps the calculation inside SQL.

```typescript
import { expr } from '@carno.js/orm';

await User.createQueryBuilder()
  .update({ experience: expr((prev) => prev.plus(25)) })
  .where({ id: 1 })
  .execute();
```

That produces SQL in this shape:

```sql
UPDATE "user" as u1
SET experience = experience + 25
WHERE (u1.id = 1)
```

Important details:

- The callback parameter is **not** the current JavaScript value from the entity.
- `prev` is a small expression builder that tells the ORM to reference the current column in SQL.
- In other words, `prev.plus(25)` becomes `column = column + 25`.
- The callback is used only to build SQL; it does not read the row into memory.

Available arithmetic helpers:

- `prev.plus(value)`
- `prev.minus(value)`
- `prev.times(value)`
- `prev.div(value)`

Example with more than one formula:

```typescript
await User.createQueryBuilder()
  .update({
    experience: expr((prev) => prev.plus(100)),
    coins: expr((prev) => prev.minus(5)),
  })
  .where({ id: 1 })
  .execute();
```

Which becomes:

```sql
UPDATE "user" as u1
SET experience = experience + 100,
    coins = coins - 5
WHERE (u1.id = 1)
```

Current limitation:

- The ORM does **not** parse arbitrary JavaScript like `prev => prev + 25`.
- Use the explicit helpers above so the ORM can safely generate SQL and keep autocomplete intact.

## Delete Operations

```typescript
await User.createQueryBuilder()
  .delete()
  .where({ isActive: false })
  .execute();
```

## Count

```typescript
const count = await User.createQueryBuilder()
  .where({ isActive: true })
  .count()
  .executeCount();
```

## Caching

You can cache the results of a query.

```typescript
.cache(60000) // Cache for 1 minute
```

## Execution Methods

- `execute()`: Executes the query and returns the raw result.
- `executeAndReturnAll()`: Executes and returns an array of entity instances.
- `executeAndReturnFirst()`: Executes and returns the first entity instance (or undefined).
- `executeAndReturnFirstOrFail()`: Executes and returns the first entity instance, throws if not found.
- `executeCount()`: Executes a count query and returns the number.
