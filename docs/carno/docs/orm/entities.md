---
sidebar_position: 2
---

# Entities

Entities are classes that map to database tables.

## Defining an Entity

Use the `@Entity()` decorator. By default, the table name is derived from the class name (`snake_case`).
Extending `BaseEntity` is optional and is only required if you want to use the Active Record API.

```ts
import { Entity, PrimaryKey, Property, BaseEntity } from '@carno.js/orm';

@Entity()
export class User extends BaseEntity {
  @PrimaryKey({ autoIncrement: true })
  id: number;

  @Property()
  name: string;

  @Property({ unique: true })
  email: string;

  @Property({ default: true })
  isActive: boolean;
}
```

If you want to customize the table name, pass `tableName` to `@Entity()`:

```ts
import { Entity, PrimaryKey, Property } from '@carno.js/orm';

@Entity({ tableName: 'app_user' })
export class User {
  @PrimaryKey()
  id: number;

  @Property()
  username: string;
}
```

## Primary Keys

Use `@PrimaryKey()` to define the entity identifier. Internally it is a shorthand for `@Property({ isPrimary: true })`, but `@PrimaryKey()` is the preferred and clearer form in entity definitions.

### Auto-increment Primary Key

```ts
import { Entity, PrimaryKey, Property } from '@carno.js/orm';

@Entity()
export class User {
  @PrimaryKey({ autoIncrement: true })
  id: number;

  @Property()
  name: string;
}
```

### Custom Primary Key

`@PrimaryKey()` also supports string or UUID-style keys and custom database column names.

```ts
import { Entity, PrimaryKey, Property } from '@carno.js/orm';

@Entity()
export class Product {
  @PrimaryKey({ columnName: 'product_uuid', dbType: 'uuid' })
  productUuid: string;

  @Property()
  name: string;
}
```

## Property Options

The `@Property()` decorator accepts options to define column behavior.

| Option | Type | Description |
| :--- | :--- | :--- |
| `isPrimary` | `boolean` | Mark as primary key. |
| `autoIncrement` | `boolean` | Auto-incrementing value. |
| `unique` | `boolean` | Add unique constraint. |
| `index` | `boolean` | Add a single-column index. |
| `nullable` | `boolean` | Allow NULL values. |
| `default` | `any` | Default value. |
| `columnName` | `string` | Custom DB column name. |
| `dbType` | `'varchar' \| 'text' \| 'int' \| 'bigint' \| 'float' \| 'double' \| 'decimal' \| 'date' \| 'datetime' \| 'time' \| 'timestamp' \| 'boolean' \| 'json' \| 'jsonb' \| 'enum' \| 'array' \| 'uuid'` | Explicit DB type. |
| `length` | `number` | Column length, usually for string columns. |
| `precision` | `number` | Total digits for decimal/numeric values. |
| `scale` | `number` | Decimal digits for decimal/numeric values. |
| `hidden` | `boolean` | Hide the property from serialization output. |
| `array` | `boolean` | Mark the column as an array type. |
| `isEnum` | `boolean` | Mark the property as an enum column. Usually handled by `@Enum()`. |
| `enumItems` | `string[] \| number[] \| '__AUTO_DETECT__'` | Explicit enum values. Usually handled by `@Enum()`. |
| `onInsert` | `() => any` | Compute a value before insert. |
| `onUpdate` | `() => any` | Compute a value before update. |

`columnName` defaults to the property name converted to `snake_case`. For most columns, the ORM also infers the column type from the TypeScript type.

For enum fields, prefer the dedicated `@Enum()` decorator. For calculated non-persisted fields, see `@Computed()`.

## Indexes and Unique Constraints

You can define indexes and unique constraints in three ways: via the `@Property` shorthand, property decorators, or class decorators (for composite keys).

### Shorthand

For simple, single-column indexes, use the options in `@Property`.

```ts
@Entity()
export class User {
  @Property({ unique: true })
  email: string;

  @Property({ index: true })
  status: string;
}
```

### Property Decorators

You can use specific decorators on the properties.

```ts
import { Entity, Property, Index, Unique } from '@carno.js/orm';

@Entity()
export class User {
  @Index()
  @Property()
  createdAt: Date;

  @Unique()
  @Property()
  username: string;
}
```

### Composite (Multi-Column)

To define indexes or unique constraints that span **multiple columns**, apply the decorator to the **class**.
These decorators are type-safe and accept a list of property names (`keyof T`).

```ts
import { Entity, Property, Index, Unique } from '@carno.js/orm';

@Entity()
@Unique(['email', 'organizationId']) // Composite Unique
@Index({ properties: ['lastName', 'firstName'] }) // Composite Index
export class User {
  @Property()
  email: string;

  @Property()
  organizationId: number;

  @Property()
  firstName: string;

  @Property()
  lastName: string;
}
```

### Partial Indexes (Where Clause)

You can create partial indexes by specifying a `where` condition. This follows the same syntax as find queries, allowing you to use complex filters and operators. For more details on supported operators, see [Querying & Operators](./querying).

```ts
@Entity()
@Index({ 
  properties: ['email'], 
  where: { isActive: true } // Only index active users
})
export class User {
  // ...
}
```

## Nested Relationship Filtering

You can filter entities based on properties of their relations. The ORM handles the necessary joins automatically. For detailed information on how this works, see the [Relations](./relations#nested-relationship-filtering) documentation.
