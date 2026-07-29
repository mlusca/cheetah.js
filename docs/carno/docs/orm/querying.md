---
sidebar_position: 7
---

# Querying & Operators

Carno ORM utilizes a unified, object-based syntax for filtering data. This syntax is consistent across **Repositories**, **Active Record** methods, and the **Query Builder**.

The goal is to provide a type-safe and intuitive way to construct complex SQL queries using simple JavaScript objects.

## Basic Concepts

### Implicit Equality (AND)

The simplest form of filtering is passing an object where keys correspond to your entity properties and values correspond to the exact value you want to match.

If you pass multiple keys, they are combined using an implicit **AND** operator.

```typescript
// SELECT * FROM users WHERE role = 'admin' AND is_active = true
const users = await User.find({
  role: 'admin',
  isActive: true
});
```

### Explicit Operators

To perform more complex comparisons (like "greater than", "contains", or "one of"), you use **operators**. Operators in Carno ORM start with a `$` prefix.

```typescript
// SELECT * FROM users WHERE age > 18
const users = await User.find({
  age: { $gt: 18 }
});
```

## Comparison Operators

These operators compare a column against a value.

| Operator | SQL Equivalent | Description |
| :--- | :--- | :--- |
| **`$eq`** | `=` | Checks if values are equal. Default behavior for primitives. |
| **`$ne`** | `!=` or `<>` | Checks if values are **not** equal. |
| **`$gt`** | `>` | Greater than. |
| **`$gte`** | `>=` | Greater than or equal to. |
| **`$lt`** | `<` | Less than. |
| **`$lte`** | `<=` | Less than or equal to. |
| **`$like`** | `LIKE` | Pattern matching (case sensitivity depends on DB/Collation). |
| **`$ilike`** | `ILIKE` | Case-insensitive pattern matching (`ILIKE` on Postgres, `LOWER()+LIKE` on MySQL). |
| **`$notIlike`** | `NOT ILIKE` | Negated case-insensitive pattern matching. |

### Examples

**Greater Than / Less Than**
```typescript
// Products with price between 50 and 200
await Product.find({
  price: { 
    $gte: 50,
    $lte: 200
  }
});
```

**Not Equal**
```typescript
// Users who are not 'guests'
await User.find({
  role: { $ne: 'guest' }
});
```

**Like (Pattern Matching)**
Use `%` as a wildcard.
```typescript
// Users with gmail emails
await User.find({
  email: { $like: '%@gmail.com' }
});
```

## Set Operators

These operators check if a value exists within a list of values.

| Operator | SQL Equivalent | Description |
| :--- | :--- | :--- |
| **`$in`** | `IN (...)` | Matches any value in the provided array. |
| **`$nin`** | `NOT IN (...)` | Matches values **not** in the provided array. |

### Examples

**In Array**
```typescript
// Find users with status 'active' OR 'pending'
await User.find({
  status: { $in: ['active', 'pending'] }
});
```

**Not In Array**
```typescript
// Exclude specific IDs
await User.find({
  id: { $nin: [1, 5, 99] }
});
```

## Logical Operators

Logical operators combine multiple conditions.

| Operator | Description |
| :--- | :--- |
| **`$and`** | Requires **all** conditions to be true. (Implicit in object keys, but can be explicit). |
| **`$or`** | Requires **at least one** condition to be true. |

### Using `$or`
This is commonly used to find records that match one condition OR another.

```typescript
// Find users who are either admins OR have a VIP subscription
await User.find({
  $or: [
    { role: 'admin' },
    { isVip: true }
  ]
});
```

### Explicit `$and`
While object properties are implicitly ANDed, you might need an explicit `$and` for complex nested groups or when combining `$or` logic.

```typescript
// (isActive = true) AND ((role = 'admin') OR (credits > 1000))
await User.find({
  $and: [
    { isActive: true },
    {
      $or: [
        { role: 'admin' },
        { credits: { $gt: 1000 } }
      ]
    }
  ]
});
```

## Relationship Operators

You can filter entities based on the existence of related records using `$exists` and `$nexists`. This generates a subquery (e.g., `EXISTS (SELECT 1 FROM ...)`).

| Operator | Description |
| :--- | :--- |
| **`$exists`** | Checks if a related record exists matching the criteria. |
| **`$nexists`** | Checks if a related record does **not** exist matching the criteria. |

### Examples

**Has Related Records**
```typescript
// Find Users who have at least one Post
await User.find({
  posts: { $exists: {} } // Empty object implies "any post"
});
```

**Has Specific Related Records**
```typescript
// Find Users who have posted a comment with "spam" content
await User.find({
  comments: { 
    $exists: { 
      content: { $like: '%spam%' } 
    } 
  }
});
```

**Does Not Have Related Records**
```typescript
// Find Products that have never been ordered
await Product.find({
  orders: { $nexists: {} }
});
```

## Null Handling

Handling `NULL` values in databases often requires specific SQL syntax (`IS NULL` vs `= NULL`). Carno ORM abstracts this for you.

### Checking for Null
Pass `null` as the value to check for `IS NULL`.

```typescript
// users WHERE deleted_at IS NULL
await User.find({
  deletedAt: null
});
```

### Checking for Not Null
Use the `$ne` operator with `null` to check for `IS NOT NULL`.

```typescript
// users WHERE avatar_url IS NOT NULL
await User.find({
  avatarUrl: { $ne: null }
});
```

## Type Safety

When using TypeScript, the query interface is fully typed.
- keys must be valid properties of the Entity.
- values must match the type of the property (e.g., you cannot compare a `string` property with a `number`).
- operators are suggested by your IDE.