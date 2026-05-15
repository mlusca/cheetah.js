---
sidebar_position: 5
---

# Derived Query Methods

Derived Query Methods let repositories build queries from method names, using a Spring Data-style convention.

Instead of writing a small wrapper for every common lookup:

```typescript
async findByEmail(email: string) {
  return this.findOne({ where: { email } });
}
```

you can call the method directly:

```typescript
const user = await userRepository.findByEmail('alice@example.com');
```

Carno derives the query only when the method is missing from the repository class. If you define a real method with the same name, your method is used.

## Repository Setup

No decorator or factory is required. Any class that extends `Repository<T>` can use derived methods.

```typescript
import { Entity, PrimaryKey, Property, Repository } from '@carno.js/orm';
import { Service } from '@carno.js/core';

@Entity()
export class User {
  @PrimaryKey()
  id: number;

  @Property()
  email: string;

  @Property()
  name: string;

  @Property()
  status: string;

  @Property()
  age: number;

  @Property()
  active: boolean;

  @Property()
  createdAt: Date;
}

@Service()
export class UserRepository extends Repository<User> {
  constructor() {
    super(User);
  }
}
```

```typescript
const user = await userRepository.findByEmail('alice@example.com');
const active = await userRepository.findAllByStatusAndActive('active', true);
const adults = await userRepository.findAllByAgeGreaterThanEqual(18);
```

## Return Values

Derived methods choose the repository operation from the method prefix.

| Prefix | Returns | Delegates to |
| :--- | :--- | :--- |
| `findBy...` | one entity or `undefined` | `findOne()` |
| `findOneBy...` | one entity or `undefined` | `findOne()` |
| `findAllBy...` | entity array | `find()` |
| `findFirstBy...` | one entity or `undefined` | `findOne()` |
| `findTopBy...` | one entity or `undefined` | `findOne()` |
| `findFirst10By...` | entity array | `find()` with `limit: 10` |
| `findTop10By...` | entity array | `find()` with `limit: 10` |
| `countBy...` | number | `count()` |
| `existsBy...` | boolean | `exists()` |
| `deleteBy...` | void | `delete()` |

`findBy...` returns a single record. Use `findAllBy...` when you want a list.

```typescript
const oneUser = await userRepository.findByEmail('alice@example.com');
const manyUsers = await userRepository.findAllByStatus('active');
```

## Equality

A property name without an operator uses equality.

```typescript
await userRepository.findByEmail('alice@example.com');
await userRepository.findAllByStatus('active');
await userRepository.findAllByStatusAndActive('active', true);
```

Equivalent filters:

```typescript
{ email: 'alice@example.com' }
{ status: 'active' }
{ status: 'active', active: true }
```

You can also use `Is` or `Equals`.

```typescript
await userRepository.findByEmailIs('alice@example.com');
await userRepository.findByEmailEquals('alice@example.com');
```

## Logical Operators

Use `And` and `Or` between predicates.

```typescript
await userRepository.findAllByStatusAndActive('active', true);
await userRepository.findAllByStatusOrAgeLessThan('inactive', 18);
```

Equivalent filters:

```typescript
{ status: 'active', active: true }

{
  $or: [
    { status: 'inactive' },
    { age: { $lt: 18 } },
  ],
}
```

When multiple `Or` groups are used, each group is built from the predicates between `Or` connectors.

```typescript
await userRepository.findAllByStatusAndActiveOrAgeLessThan(
  'active',
  true,
  18,
);
```

Equivalent filter:

```typescript
{
  $or: [
    { status: 'active', active: true },
    { age: { $lt: 18 } },
  ],
}
```

## Comparison Operators

| Method operator | Filter operator | Example |
| :--- | :--- | :--- |
| `GreaterThan` | `$gt` | `findAllByAgeGreaterThan(18)` |
| `GreaterThanEqual` | `$gte` | `findAllByAgeGreaterThanEqual(18)` |
| `LessThan` | `$lt` | `findAllByAgeLessThan(65)` |
| `LessThanEqual` | `$lte` | `findAllByAgeLessThanEqual(65)` |
| `After` | `$gt` | `findAllByCreatedAtAfter(date)` |
| `Before` | `$lt` | `findAllByCreatedAtBefore(date)` |
| `Between` | `$gte` and `$lte` | `findAllByAgeBetween(18, 65)` |

```typescript
await userRepository.findAllByAgeGreaterThan(18);
await userRepository.findAllByCreatedAtBefore(new Date('2024-01-01'));
await userRepository.findAllByAgeBetween(18, 65);
```

`Between` consumes two arguments: lower bound first, upper bound second.

## Negation

| Method operator | Filter operator | Example |
| :--- | :--- | :--- |
| `Not` | `$ne` | `findAllByStatusNot('archived')` |
| `IsNot` | `$ne` | `findAllByStatusIsNot('archived')` |

```typescript
await userRepository.findAllByStatusNot('archived');
await userRepository.findAllByStatusIsNot('inactive');
```

## Set Operators

| Method operator | Filter operator | Example |
| :--- | :--- | :--- |
| `In` | `$in` | `findAllByStatusIn(['active', 'pending'])` |
| `NotIn` | `$nin` | `findAllByStatusNotIn(['archived'])` |
| `IsNotIn` | `$nin` | `findAllByStatusIsNotIn(['archived'])` |

```typescript
await userRepository.findAllByStatusIn(['active', 'pending']);
await userRepository.findAllByStatusNotIn(['deleted', 'archived']);
```

## Pattern Matching

Pattern matching delegates to SQL `LIKE` and `NOT LIKE`.

| Method operator | Filter operator | Pattern produced |
| :--- | :--- | :--- |
| `Like` | `$like` | Uses the argument exactly |
| `NotLike` | `$notLike` | Uses the argument exactly |
| `Containing` | `$like` | `%value%` |
| `Contains` | `$like` | `%value%` |
| `NotContaining` | `$notLike` | `%value%` |
| `StartingWith` | `$like` | `value%` |
| `EndingWith` | `$like` | `%value` |

```typescript
await userRepository.findAllByEmailLike('%@example.com');
await userRepository.findAllByNameContaining('ali');
await userRepository.findAllByNameStartingWith('A');
await userRepository.findAllByNameEndingWith('son');
await userRepository.findAllByNameNotContaining('test');
```

`Like` and `NotLike` do not add `%` automatically. Use them when you want to control the pattern yourself.

## Null and Boolean Operators

Null and boolean operators do not consume an argument.

| Method operator | Filter produced | Example |
| :--- | :--- | :--- |
| `IsNull` | `property: null` | `findAllByDeletedAtIsNull()` |
| `Null` | `property: null` | `findAllByDeletedAtNull()` |
| `IsNotNull` | `property: { $ne: null }` | `findAllByDeletedAtIsNotNull()` |
| `NotNull` | `property: { $ne: null }` | `findAllByDeletedAtNotNull()` |
| `True` | `property: true` | `findAllByActiveTrue()` |
| `IsTrue` | `property: true` | `findAllByActiveIsTrue()` |
| `False` | `property: false` | `findAllByActiveFalse()` |
| `IsFalse` | `property: false` | `findAllByActiveIsFalse()` |

```typescript
await userRepository.findAllByDeletedAtIsNull();
await userRepository.findAllByDeletedAtIsNotNull();
await userRepository.findAllByActiveTrue();
await userRepository.findAllByActiveIsFalse();
```

## Ordering

Append `OrderBy<Property>Asc` or `OrderBy<Property>Desc` after the predicate.

```typescript
await userRepository.findAllByStatusOrderByCreatedAtDesc('active');
await userRepository.findAllByStatusOrderByNameAsc('active');
```

Multiple order fields are supported.

```typescript
await userRepository.findAllByStatusOrderByActiveDescCreatedAtDesc('active');
```

Equivalent option:

```typescript
{
  orderBy: {
    active: 'DESC',
    createdAt: 'DESC',
  },
}
```

If you pass `orderBy` in the final options argument, the explicit option takes precedence over the derived `OrderBy`.

## Limiting Results

Use `First` or `Top`.

```typescript
const newest = await userRepository.findFirstByStatusOrderByCreatedAtDesc('active');
const newestAlso = await userRepository.findTopByStatusOrderByCreatedAtDesc('active');
const newestFive = await userRepository.findTop5ByStatusOrderByCreatedAtDesc('active');
const firstTen = await userRepository.findFirst10ByActiveIsTrueOrderByCreatedAtDesc();
```

`findFirstBy...` and `findTopBy...` return one entity. `findFirstNBy...` and `findTopNBy...` return an array with `limit: N`.

`N` must be a positive integer.

## Count, Exists, and Delete

Derived methods are not limited to reads.

```typescript
const activeCount = await userRepository.countByStatus('active');
const alreadyExists = await userRepository.existsByEmail('alice@example.com');

await userRepository.deleteByStatus('archived');
```

These methods support the same predicate operators as read methods.

```typescript
await userRepository.countByAgeGreaterThanEqual(18);
await userRepository.existsByEmailAndActiveIsTrue('alice@example.com');
await userRepository.deleteByDeletedAtIsNotNull();
```

## Read Options

Read methods can receive repository read options as the final argument.

```typescript
await userRepository.findAllByStatus('active', {
  orderBy: { createdAt: 'DESC' },
  limit: 20,
  offset: 40,
  cache: 60_000,
});
```

The final options argument is supported for:

- `findBy...`
- `findOneBy...`
- `findAllBy...`
- `findFirst...`
- `findTop...`

It is not accepted by `countBy`, `existsBy`, or `deleteBy`.

Supported options are the same read options used by `find()` and `findOne()`:

- `fields`
- `load`
- `loadStrategy`
- `orderBy`
- `limit`
- `offset`
- `cache`

For single-result methods, `limit` and `offset` are not part of `findOne()` semantics.

## TypeScript Ergonomics

Derived methods are generated at runtime. TypeScript cannot infer every possible method name directly from a class declaration.

For common one-property methods, use `DerivedRepository<T>`.

```typescript
import type { DerivedRepository } from '@carno.js/orm';

const users = userRepository as DerivedRepository<User>;

const user = await users.findByEmail('alice@example.com');
const allActive = await users.findAllByStatus('active');
const count = await users.countByStatus('active');
```

For multi-property or advanced method names, you can declare the method signature in your repository class when you want strict TypeScript checking. You do not need to implement the method body; the runtime proxy handles it as long as the property is not actually defined.

```typescript
type UserRepositoryWithDerived = UserRepository & {
  findAllByStatusAndActive(status: string, active: boolean): Promise<User[]>;
  findTop5ByStatusOrderByCreatedAtDesc(status: string): Promise<User[]>;
};

const users = userRepository as UserRepositoryWithDerived;
```

## Validation and Errors

Carno validates derived methods before executing the query.

It throws when:

- The method has no predicate after the prefix.
- A property does not exist on the entity metadata.
- `OrderBy` does not include a valid property and `Asc` or `Desc`.
- The number of arguments does not match the parsed predicates.
- `Top0` or `First0` is used.

Examples:

```typescript
await userRepository.findAllByMissingField('x');
// Error: No matching property exists on entity

await userRepository.findAllByNameAndStatus('Alice');
// Error: expects 2 parameters, received 1

await userRepository.findTop0ByStatus('active');
// Error: Top/First limit must be positive
```

## Performance

Derived methods are designed to keep runtime overhead low.

- The repository proxy only handles unknown method names with a derived-query prefix.
- Existing methods are returned directly and are not parsed.
- A method name is parsed once per entity class and cached.
- The generated function is cached per repository instance.
- Execution delegates to the existing optimized repository methods: `findOne`, `find`, `count`, `exists`, and `delete`.
- SQL generation still goes through the same query builder and driver path as hand-written repository methods.

This means the main extra cost is paid on the first call to a derived method. Later calls reuse the cached plan and cached function.

## Current Scope

Derived methods currently target direct entity properties and relation properties that exist in entity metadata.

Nested property paths such as `findByProfileEmail(...)` are not part of this feature. Use `find({ where: ... })` or the query builder for nested relationship queries.

Case-insensitive keywords such as `IgnoreCase` and `AllIgnoreCase` are also not included yet, because they require driver-specific SQL policy.

## Operator Reference

| Category | Keywords |
| :--- | :--- |
| Equality | default, `Is`, `Equals` |
| Negation | `Not`, `IsNot` |
| Comparison | `GreaterThan`, `GreaterThanEqual`, `LessThan`, `LessThanEqual`, `After`, `Before`, `Between` |
| Sets | `In`, `NotIn`, `IsNotIn` |
| Pattern matching | `Like`, `NotLike`, `Containing`, `Contains`, `NotContaining`, `StartingWith`, `EndingWith` |
| Null checks | `IsNull`, `Null`, `IsNotNull`, `NotNull` |
| Booleans | `True`, `IsTrue`, `False`, `IsFalse` |
| Composition | `And`, `Or` |
| Ordering | `OrderBy<Property>Asc`, `OrderBy<Property>Desc` |
| Limits | `First`, `Top`, `First<N>`, `Top<N>` |
