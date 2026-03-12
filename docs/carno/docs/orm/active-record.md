---
sidebar_position: 5
---

# Active Record

The Active Record pattern allows you to interact with the database directly through your entity classes. Each entity instance represents a row in the database, and static methods on the class allow you to query the table.

## When to Use It

Choose Active Record when you want the entity itself to own persistence behavior.

This pattern is appropriate when:

- you want very direct CRUD code
- you want to call `User.find()` and `user.save()`
- you are comfortable coupling persistence logic to the entity class

If you prefer repositories and service-layer orchestration, use the [Repository](./repository) pattern instead. In that model, extending `BaseEntity` is not required.

## Defining an Active Record Entity

To use the Active Record pattern, your entities must extend the `BaseEntity` class.

```typescript
import { Entity, PrimaryKey, Property, BaseEntity } from '@carno.js/orm';

@Entity()
export class User extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;

  @Property()
  email: string;

  @Property()
  isActive: boolean;
}
```

## What You Get From `BaseEntity`

By extending `BaseEntity`, the entity gains:

- static methods like `find`, `findOne`, `findAll` and `create`
- instance methods like `save`, `remove` and `isPersisted()`
- dirty tracking for `save()` on already-loaded instances

These capabilities belong to Active Record. They are not part of the Repository-only model.

## Creating and Saving

You can create a new instance of an entity, set its properties, and save it to the database.

```typescript
const user = new User();
user.name = 'John Doe';
user.email = 'john@example.com';
user.isActive = true;

await user.save(); // Inserts the user into the database
console.log(user.id); // ID is automatically populated
```

Alternatively, you can use the static `create` method to create and save in one step:

```typescript
const user = await User.create({
  name: 'Jane Doe',
  email: 'jane@example.com',
  isActive: true
});
```

## Reading Entities

The `BaseEntity` provides several static methods to query data.

### Find All

```typescript
// Find all users
const users = await User.findAll({});

// Find all active users
const activeUsers = await User.find({ isActive: true });
```

### Find One

```typescript
// Find a user by email
const user = await User.findOne({ email: 'john@example.com' });

// Find a user or throw an error if not found
const userOrFail = await User.findOneOrFail({ email: 'john@example.com' });
```

### Advanced Finding

You can pass options to filter, sort, and limit results. See [Querying & Operators](./querying) for a full list of supported filters.

```typescript
const users = await User.find(
  { isActive: true }, // Where clause
  {
    orderBy: { name: 'ASC' },
    limit: 10,
    offset: 0
  }
);
```

## Updating Entities

To update a loaded entity, fetch it, modify its properties, and call `save()`.

```typescript
const user = await User.findOneOrFail({ id: 1 });
user.name = 'Updated Name';
await user.save(); // Updates the record
```

For bulk updates, Active Record also exposes a static `update(where, data)`.
This is the Active Record equivalent of doing a repository bulk update without first loading each entity instance.

```typescript
await User.update(
  { isActive: true },
  { isActive: false }
);
```

You can also use computed updates with `expr(...)`.

```typescript
import { expr } from '@carno.js/orm';

await User.update(
  { id: 1 },
  { experience: expr((prev) => prev.plus(50)) }
);
```

Why use this:

- when the update affects many rows
- when the new value depends on the current database value
- when you want to avoid `find -> mutate -> save` for a simple arithmetic change

What it turns into:

```sql
UPDATE "user" as u1
SET experience = experience + 50
WHERE (u1.id = 1)
```

`prev` is not the in-memory property value from an entity instance.
It is a builder for the current SQL column value, so `prev.plus(50)` becomes `column = column + 50`.

Supported arithmetic helpers:

- `prev.plus(value)`
- `prev.minus(value)`
- `prev.times(value)`
- `prev.div(value)`

Current limitation:

- Use the explicit helper methods above.
- The ORM does not parse arbitrary JavaScript like `prev => prev + 50`.

## Deleting Entities

You can delete a loaded entity instance with `remove()`.

```typescript
const user = await User.findOneOrFail({ id: 1 });
await user.remove();
```

For bulk deletion, use the static `delete(where)`.

```typescript
await User.delete({ id: 1 });
```

That becomes a direct SQL delete similar to:

```sql
DELETE FROM "user" AS u1
WHERE (u1.id = 1)
```

If deletion through repository fits your code organization better, it is fine to mix Active Record entities with repositories. What matters is that `BaseEntity` is required only for the Active Record API itself.

## Checking Persistence

You can check if an entity instance is already saved in the database using `isPersisted()`.

```typescript
const user = new User();
console.log(user.isPersisted()); // false

await user.save();
console.log(user.isPersisted()); // true
```
