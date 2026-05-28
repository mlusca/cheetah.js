---
sidebar_position: 7
---

# References (Ref)

`Ref<T>` is Carno ORM's type-level way to say "this property points to another entity".

At runtime, `Ref<T>` is just `T`. It does not wrap the entity, create a proxy or trigger lazy loading. It exists to make relation properties explicit in TypeScript and to make helper functions such as `refById()` read clearly.

## When To Use `Ref<T>`

Use `Ref<T>` on relation properties:

```ts
import { BaseEntity, Entity, ManyToOne, PrimaryKey, Property, type Ref } from '@carno.js/orm';
import { User } from './user.entity';

@Entity()
export class Post extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  title: string;

  @ManyToOne(() => User)
  author: Ref<User>;
}
```

This tells readers and TypeScript that `author` is a relation, not a scalar embedded object.

The relation decorator still needs to know which entity class it targets. In most cases, pass a lazy callback such as `() => User`. The callback delays resolving the class until the ORM reads metadata, which helps with common module ordering issues.

## `Ref<T>` Is Not Lazy Loading

`Ref<T>` does not mean the related entity is loaded. The value depends on how you queried or assigned the relation.

If you load the relation:

```ts
const post = await Post.findOneOrFail(
  { id: 1 },
  { load: ['author'] },
);

console.log(post.author.name);
```

If you do not load the relation, relation values may be represented by the foreign key value or by an entity object with only an id, depending on how the entity was created or hydrated.

Use `load` when application code needs fields from the related entity.

## Creating References By Id

Use `refById(EntityClass, id)` when you already know the foreign key and do not want to fetch the related row just to create or update a relation.

```ts
import { BaseEntity, Entity, ManyToOne, PrimaryKey, type Ref, refById } from '@carno.js/orm';
import { Course } from './course.entity';
import { User } from './user.entity';

@Entity()
export class UserLibrary extends BaseEntity {
  @PrimaryKey()
  id: number;

  @ManyToOne(() => User)
  user: Ref<User>;

  @ManyToOne(() => Course)
  course: Ref<Course>;
}

await UserLibrary.create({
  user: refById(User, userId),
  course: refById(Course, courseId),
});
```

The helper creates a lightweight entity instance and sets its `id` property. During insert or update, the ORM extracts that primary key value and writes it to the relation column.

This is useful for:

- Assigning a many-to-one relation from a request body.
- Updating a relation without loading both sides.
- Bulk or queue workflows where ids are already known.

## Important `refById()` Limitation

`refById()` currently sets the `id` property. It is designed for entities that use the default primary key property name.

```ts
const userRef = refById(User, 123);
console.log(userRef.id); // 123
```

If your entity uses a custom primary key property, create a lightweight instance manually for now:

```ts
const product = new Product();
product.productUuid = productUuid;

await orderItems.create({
  product,
});
```

The ORM can persist custom primary keys in normal entity operations, but `refById()` itself follows the `id` convention.

## Updating Relations

You can also use `refById()` when changing an existing relation.

```ts
const library = await UserLibrary.findByIdOrFail(1);

library.user = refById(User, newUserId);
library.course = refById(Course, newCourseId);

await library.save();
```

The generated update writes the new foreign key values without requiring a prior select for the new `User` or `Course`.

## Checking Loaded Values

`isLoaded(ref)` is a small type guard that checks for `null` or `undefined`.

```ts
import { isLoaded } from '@carno.js/orm';

if (isLoaded(post.author)) {
  console.log(post.author);
}
```

It does not verify that all fields of the related entity were loaded from the database. It only narrows the type away from `null` and `undefined`.

## `ref()` and `unwrap()`

`ref(entity)` and `unwrap(reference)` are identity functions. They return the same object they receive.

```ts
import { ref, unwrap } from '@carno.js/orm';

const userRef = ref(user);
const userAgain = unwrap(userRef);

console.log(userRef === user); // true
console.log(userAgain === user); // true
```

They are mainly useful when you want code to make relation intent explicit.

## Relation Loading Example

```ts
const created = await UserLibrary.create({
  user: refById(User, userId),
  course: refById(Course, courseId),
});

const loaded = await UserLibrary.findOneOrFail(
  { id: created.id },
  { load: ['user', 'course'] },
);

console.log(loaded.user.email);
console.log(loaded.course.name);
```

Use ids for writes when ids are enough. Use `load` for reads when you need the related data.

## See Also

- [Relations](./relations) for relation decorators and loading strategies.
- [Entities](./entities) for primary key conventions.
- [Querying & Operators](./querying) for filtering by relation fields.
