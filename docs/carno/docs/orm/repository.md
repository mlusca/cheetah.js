---
sidebar_position: 4
---

# Repositories

Repositories provide a dedicated abstraction layer for data access, promoting separation of concerns and cleaner code architecture.

## Repository Pattern vs Active Record

In Carno ORM, repositories are a separate way to work with persistence.

- `Repository` keeps query and write logic outside the entity class.
- `BaseEntity` is optional in this pattern.
- A plain class decorated with `@Entity()` is enough to use a repository.
- `save()`, `remove()`, `isPersisted()` and dirty tracking are **not** part of the Repository model unless you explicitly choose to also extend `BaseEntity`.

For most service-oriented applications, this is the recommended style.

## Defining the Entity

For Repository-oriented code, the most explicit shape is a plain entity:

```typescript
import { Entity, PrimaryKey, Property } from '@carno.js/orm';

@Entity()
export class User {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;

  @Property({ hidden: true })
  internalNotes: string;
}
```

Even without `BaseEntity`, the decorated class still has ORM-aware serialization behavior.

## Creating a Repository

To create a repository, extend the generic `Repository<T>` class and decorate it with `@Service()`.

```typescript
import { Service } from '@carno.js/core';
import { Repository } from '@carno.js/orm';
import { User } from '../entities/user.entity';

@Service()
export class UserRepository extends Repository<User> {
  constructor() {
    super(User);
  }

  // Custom method to find users by role
  async findByRole(role: string): Promise<User[]> {
    return this.find({
      where: { role }
    });
  }
}
```

## What Repositories Do and Do Not Provide

Using a repository with a plain entity gives you:

- `create`, `find`, `findOne`, `findAll`
- `findPage`
- `update`, `updateById`
- `delete`, `deleteById`
- `count`, `exists`
- rich serialization based on `@Entity()` metadata

It does **not** give you:

- `User.find()`
- `User.create()`
- `user.save()`
- `user.remove()`
- dirty tracking

If you need those behaviors, you are in Active Record territory and should extend `BaseEntity`.

## Using Repositories

Inject the repository into your services or controllers.

```typescript
@Service()
export class UserService {
  constructor(private userRepository: UserRepository) {}

  async getAllAdmins() {
    return this.userRepository.findByRole('admin');
  }
}
```

## Derived Query Methods

Repositories also support Spring Data-style derived methods. If a method is not explicitly defined on the repository class, Carno can derive a query from its name at runtime.

```typescript
const user = await userRepository.findByEmail('alice@example.com');
const activeUsers = await userRepository.findAllByStatusAndActive('active', true);
const adults = await userRepository.findAllByAgeGreaterThanEqual(18);
const exists = await userRepository.existsByEmail('alice@example.com');
```

`findBy...` and `findOneBy...` return a single entity or `undefined`. Use `findAllBy...` for lists.

See [Derived Query Methods](./derived-query-methods) for the full reference, including prefixes, operators, ordering, limits, TypeScript ergonomics, validation, and performance notes.

## Serialization in Repository Mode

`@Entity()`-decorated classes returned by a repository still serialize using ORM metadata.

That means:

- hidden fields are excluded
- computed fields are included
- loaded relations serialize consistently

This behavior is specific to ORM entities. Plain classes without `@Entity()` do not participate in ORM-aware serialization.

## Standard Methods

The `Repository` class comes with a comprehensive set of built-in methods for common operations.

### Reading

- **`find(options)`**: Finds multiple entities matching the criteria.
- **`findOne(options)`**: Finds a single entity. Returns `undefined` if not found.
- **`findOneOrFail(options)`**: Finds a single entity. Throws an error if not found.
- **`findAll(options)`**: Finds all entities (wrapper around `find` without required where).
- **`findPage(options)`**: Finds a page of entities and returns `{ data, total, page, pageSize, totalPages }`.
- **`findById(id)`**: Finds an entity by its primary key.
- **`findByIdOrFail(id)`**: Finds an entity by primary key or throws.
- **`exists(where)`**: Checks if at least one entity matches the criteria.
- **`count(where)`**: Returns the count of entities matching the criteria.

See [Pagination](./pagination) for the full `findPage()` reference, validation rules, and performance notes.

### Writing

- **`create(data)`**: Creates and persists a new entity instance immediately.
  ```typescript
  const user = await this.userRepository.create({
    name: 'Alice',
    email: 'alice@example.com'
  });
  ```

- **`update(where, data)`**: Updates entities matching the criteria.
  See [Querying & Operators](./querying) for details on the `where` argument.
  ```typescript
  await this.userRepository.update(
    { id: 1 },
    { name: 'Alice Smith' }
  );
  ```

  Computed updates are also supported with `expr(...)`.
  ```typescript
  import { expr } from '@carno.js/orm';

  await this.userRepository.update(
    { id: 1 },
    { experience: expr((prev) => prev.plus(100)) }
  );
  ```

  Use this when the new value depends on the current value already stored in the row and you want the database to do the calculation directly.
  The repository delegates this to the ORM query builder, so the operation is still executed as a single SQL `UPDATE`.

  For the example above, the SQL generated is:
  ```sql
  UPDATE "user" as u1
  SET experience = experience + 100
  WHERE (u1.id = 1)
  ```

  `prev` is not a loaded entity value. It is an expression builder for the current SQL column value.
  Available arithmetic helpers are `plus`, `minus`, `times`, and `div`.

- **`updateById(id, data)`**: Updates a specific entity by ID.

### Bulk Operations

For high-throughput batch workloads, the repository exposes `bulkCreate`, `bulkUpdate` and `bulkDelete`. Each one collapses N round-trips into a single SQL statement per chunk and (when multi-chunk) wraps the whole call in a transaction.

```typescript
await repo.bulkCreate(rows, { chunkSize: 500 });   // multi-row INSERT
await repo.bulkUpdate(rows, { chunkSize: 500 });   // CASE-based UPDATE
await repo.bulkDelete(ids,  { chunkSize: 500 });   // DELETE WHERE pk IN (...)
```

Measured speedups range from **~50× to ~180×** vs. naïve sequential calls. See [Bulk Operations](./bulk-operations) for full details and the [Session](./session) page for a Unit-of-Work API that batches across multiple entity types in a single transaction.

### Deleting Data

You can delete records using a specific criteria or by ID.

- **`delete(where)`**: Deletes entities matching the criteria.
  See [Querying & Operators](./querying) for supported filters.
  ```typescript
  // Delete all inactive users
  await this.userRepository.delete({ isActive: false });
  ```

- **`deleteById(id)`**: Deletes a specific entity by ID.
  ```typescript
  await this.userRepository.deleteById(5);
  ```

## Query Builder Access

If the standard methods aren't enough, you can access the underlying Query Builder from within a repository.

```typescript
async findRecentUsers() {
  return this.createQueryBuilder()
    .where({ createdAt: { $gt: new Date(Date.now() - 86400000) } })
    .orderBy({ createdAt: 'DESC' })
    .executeAndReturnAll();
}
```
