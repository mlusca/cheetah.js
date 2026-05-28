---
sidebar_position: 8
---

# Value Objects

Value Objects are small domain types identified by their value, not by a database identity. They are useful when a primitive value such as `string`, `number` or `Date` is not expressive enough to carry the business rule by itself.

An email address is not "just a string" in most systems. A price is not "just a number". A tenant code, CPF, slug, percentage, latitude, money amount or status transition token often has formatting rules, size limits, comparison behavior and validation rules that should live in one place. A Value Object gives that concept a name and keeps invalid values from moving through the application.

## Why Use Value Objects?

Without Value Objects, validation usually spreads across controllers, services, DTOs and persistence code:

```ts
if (!email.includes('@')) {
  throw new Error('Invalid email');
}
```

That kind of validation is easy to forget and hard to reuse. With a Value Object, the rule is attached to the type:

```ts
const email = new Email('alice@example.com');
```

If the value is invalid, the object cannot be created. That means the rest of the code can depend on `Email` representing a valid email instead of checking the same primitive repeatedly.

Use a Value Object when:

- The value has a business meaning beyond its primitive type.
- The value needs validation or normalization before it enters the domain.
- Equality should be based on the contained value.
- The value should be persisted as a normal column, not as a separate table.
- You want entity code to communicate intent clearly.

Avoid a Value Object when the value is purely incidental and has no reusable rule. Not every string needs its own class.

## Value Objects vs Entities

Entities have identity. Two `User` instances can represent the same user if they share the same primary key, even if some fields changed.

Value Objects do not have identity. Two `Email` instances with the same raw value are equal because the value is the whole object.

```ts
const a = new Email('alice@example.com');
const b = new Email('alice@example.com');

console.log(a.equals(b)); // true
```

In Carno ORM, a Value Object is stored inside an entity property. It does not create a new table, does not get a primary key and does not have lifecycle methods like `save()` or `remove()`.

## Creating a Value Object

Create a custom Value Object by extending `ValueObject<T, Vo>`.

The first generic is the raw value type. The second generic is the Value Object class itself, which keeps `from()` and `equals()` typed correctly.

```ts
import { ValueObject } from '@carno.js/orm';

export class Email extends ValueObject<string, Email> {
  protected max = 255;

  protected validate(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
}
```

The `validate()` method should return `true` for valid values and `false` for invalid values. When validation fails, the constructor throws an `HttpException` with status `400`.

## Built-In Email Value Object

Carno ORM also exports a simple `Email` Value Object:

```ts
import { Email } from '@carno.js/orm';

const email = Email.from('user@example.com');
```

Use it when its regular expression is enough for your domain. Create your own `Email` class when you need stricter rules, provider-specific restrictions, normalization or custom error handling.

## Numeric Value Objects

Numeric Value Objects are useful for ages, percentages, quantities, ratings and money-like values.

```ts
import { ValueObject } from '@carno.js/orm';

export class Age extends ValueObject<number, Age> {
  protected min = 0;
  protected max = 150;

  protected validate(value: number): boolean {
    return Number.isInteger(value);
  }
}
```

`min` and `max` are checked automatically after your `validate()` method. For numbers, they mean minimum and maximum numeric value. For strings, they mean minimum and maximum length.

## Decimal Precision and Scale

For decimal-like values, you can declare `precision` and `scale`.

```ts
import { ValueObject } from '@carno.js/orm';

export class Percentage extends ValueObject<number, Percentage> {
  protected min = 0;
  protected max = 100;
  protected precision = 5;
  protected scale = 2;

  protected validate(value: number): boolean {
    return Number.isFinite(value);
  }
}
```

`precision` is the total number of digits. `scale` is the number of digits after the decimal point. A value like `99.99` has precision `4` and scale `2`.

## Creating Instances

You can instantiate a Value Object directly or through the static `from()` factory.

```ts
const direct = new Email('user@example.com');
const factory = Email.from('user@example.com');

console.log(direct.getValue()); // 'user@example.com'
console.log(direct.equals(factory)); // true
```

Invalid values fail immediately:

```ts
new Email('not-an-email'); // throws HttpException(400)
new Age(-1); // throws HttpException(400)
```

The raw value is private. Use `getValue()` when you need to pass it to an external API, serialize it manually or compare it with primitives.

## Using Value Objects in Entities

Use the normal `@Property()` decorator. The ORM detects that the property type extends `ValueObject`.

```ts
import { BaseEntity, Entity, PrimaryKey, Property } from '@carno.js/orm';
import { Email } from './values/email.vo';
import { Age } from './values/age.vo';

@Entity()
export class User extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  email: Email;

  @Property()
  age: Age;
}
```

Saving an entity extracts the raw value:

```ts
await User.create({
  email: Email.from('user@example.com'),
  age: Age.from(32),
});
```

Loading an entity creates the Value Object again:

```ts
const user = await User.findOneOrFail({ id: 1 });

console.log(user.email instanceof Email); // true
console.log(user.email.getValue()); // 'user@example.com'
```

The rehydration step runs the Value Object constructor, so invalid data already stored in the database is rejected when the ORM tries to materialize the entity.

## Querying With Value Objects

You can use Value Objects in query filters. The ORM extracts `getValue()` when building SQL conditions.

```ts
const user = await User.findOne({
  email: Email.from('user@example.com'),
});
```

This behaves like querying by the primitive column value, while keeping the calling code typed and validated.

## Database Mapping

Value Objects are persisted as scalar columns.

When saving:

1. The ORM detects the Value Object instance.
2. It calls `getValue()`.
3. It stores the raw primitive in the mapped column.

When loading:

1. The ORM reads the scalar column value.
2. It creates a new instance of the Value Object class.
3. The constructor validates the value.
4. The entity property receives the Value Object instance.

This means the database schema stays simple, while the application model stays expressive.

## Database Constraints

The base `ValueObject` supports declarative database-related limits:

| Field | String behavior | Number behavior | Used for schema metadata |
| :--- | :--- | :--- | :--- |
| `min` | Minimum length | Minimum value | No |
| `max` | Maximum length | Maximum value | Yes, as column `length` |
| `precision` | Not applicable | Total digits | Yes |
| `scale` | Not applicable | Decimal digits | Yes |

These constraints are also validated at runtime. For example, a string longer than `max` throws before it is persisted.

## Common Patterns

### Keep Value Objects Focused

Prefer small Value Objects that enforce one concept well:

```ts
export class Slug extends ValueObject<string, Slug> {
  protected max = 80;

  protected validate(value: string): boolean {
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
  }
}
```

Avoid putting database access, service calls or entity mutation inside a Value Object. It should validate and represent a value, not coordinate a workflow.

### Normalize Before Construction

The base class does not provide a hook that transforms the value before storing it. Normalize input before creating the instance:

```ts
const email = Email.from(input.trim().toLowerCase());
```

If normalization is part of your domain contract, expose a named factory on the Value Object:

```ts
export class NormalizedEmail extends ValueObject<string, NormalizedEmail> {
  protected max = 255;

  static normalize(value: string): NormalizedEmail {
    return new NormalizedEmail(value.trim().toLowerCase());
  }

  protected validate(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
}
```

### Keep Error Messages in Mind

The default constructor throws `Invalid value for ClassName` when `validate()` returns `false`. Constraint errors such as `max`, `min`, `precision` and `scale` have more specific messages.

If you need user-facing, localized or field-specific messages, catch `HttpException` at the application boundary and translate it there.

## Limitations

- Value Objects map to one scalar column. They are not embedded multi-column objects.
- `equals()` compares the raw value with strict equality.
- The raw value should be treated as immutable after construction.
- `refById()` and relation helpers are for entities, not Value Objects.

## See Also

- [Entities](./entities) for entity registration and property mapping.
- [Querying & Operators](./querying) for filter syntax.
- [Repository](./repository) for repository-oriented persistence.
