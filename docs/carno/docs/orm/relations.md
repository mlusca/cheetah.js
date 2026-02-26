---
sidebar_position: 8
---

# Relations

Relations define how entities are connected to each other.

## Defining Relations

To define a relationship, you use decorators like `@OneToMany`, `@ManyToOne`, `@OneToOne` or `@ManyToMany`.

Below is an example of a `User` entity that has many `Post` entities.

### Parent Entity (User)

```ts
import { Entity, Property, OneToMany, BaseEntity } from '@carno.js/orm';
import { Post } from './Post';

@Entity()
export class User extends BaseEntity {
  @Property({ isPrimary: true, autoIncrement: true })
  id: number;

  @Property()
  name: string;

  // Defines that one user has many posts
  @OneToMany(() => Post, (post) => post.user)
  posts: Post[];
}
```

### Child Entity (Post)

```ts
import { Entity, Property, ManyToOne, BaseEntity } from '@carno.js/orm';
import { User } from './User';

@Entity()
export class Post extends BaseEntity {
  @Property({ isPrimary: true, autoIncrement: true })
  id: number;

  @Property()
  title: string;

  // Defines that many posts belong to one user
  @ManyToOne(() => User, (user) => user.posts)
  user: User;
}
```

## OneToOne

A one-to-one relationship connects one entity to exactly one instance of another entity. Use the `@OneToOne` decorator.

Every OneToOne relationship has two sides:

- **Owner side** — holds the foreign key column (with a UNIQUE constraint).
- **Inverse side** — references the FK in the related entity.

### Owner Side

The owner side creates the FK column. Use `@OneToOne` with just the entity reference:

```ts
import { Entity, Property, OneToOne, BaseEntity } from '@carno.js/orm';
import type { Ref } from '@carno.js/orm';
import { Profile } from './Profile';

@Entity()
export class User extends BaseEntity {
  @Property({ isPrimary: true, autoIncrement: true })
  id: number;

  @Property()
  name: string;

  // Owner: creates `profile_id` column with UNIQUE constraint
  @OneToOne(() => Profile)
  profile: Ref<Profile>;
}
```

This generates a `profile_id` column in the `users` table with a UNIQUE constraint.

### Inverse Side

The inverse side references the FK in the related entity. Pass the FK accessor as the second argument:

```ts
import { Entity, Property, OneToOne, BaseEntity } from '@carno.js/orm';
import type { Ref } from '@carno.js/orm';
import { User } from './User';

@Entity()
export class Profile extends BaseEntity {
  @Property({ isPrimary: true, autoIncrement: true })
  id: number;

  @Property()
  bio: string;

  // Inverse: references the `profile_id` FK in User
  @OneToOne(() => User, (user) => user.profileId)
  user: Ref<User>;
}
```

### Querying OneToOne

```typescript
// Load user with profile (joined strategy - default)
const users = await User.find({
  load: ['profile'],
});

// users[0].profile → Profile instance (single object, not array)

// Load with select strategy
const users = await User.find({
  load: ['profile'],
  loadStrategy: 'select',
});

// Filter by related entity field
const users = await User.find({
  where: {
    profile: { bio: 'Developer' },
  },
});
```

## ManyToMany

A many-to-many relationship connects multiple entities to multiple entities through a **pivot table** (junction table). Use the `@ManyToMany` decorator.

### Basic Usage

```ts
import { Entity, Property, ManyToMany, BaseEntity } from '@carno.js/orm';
import { Tag } from './Tag';

@Entity()
export class Post extends BaseEntity {
  @Property({ isPrimary: true, autoIncrement: true })
  id: number;

  @Property()
  title: string;

  @ManyToMany(() => Tag)
  tags: Tag[];
}
```

```ts
import { Entity, Property, ManyToMany, BaseEntity } from '@carno.js/orm';
import { Post } from './Post';

@Entity()
export class Tag extends BaseEntity {
  @Property({ isPrimary: true, autoIncrement: true })
  id: number;

  @Property()
  name: string;

  @ManyToMany(() => Post)
  posts: Post[];
}
```

By default, the ORM auto-generates:
- **Pivot table name**: alphabetically sorted `{tableA}_{tableB}` (e.g., `posts_tags`)
- **Join columns**: `{table}_id` (e.g., `post_id`, `tag_id`)

### Custom Pivot Configuration

You can override the auto-generated names:

```ts
@ManyToMany(() => Tag, {
  pivotTable: 'post_tags',
  joinColumn: 'post_id',
  inverseJoinColumn: 'tag_id',
})
tags: Tag[];
```

### Querying ManyToMany

```typescript
// Load posts with tags (joined strategy - default)
const posts = await Post.find({
  load: ['tags'],
});

// posts[0].tags → Tag[] array

// Load with select strategy
const posts = await Post.find({
  load: ['tags'],
  loadStrategy: 'select',
});

// Filter by related entity field
const posts = await Post.find({
  where: {
    tags: { name: 'typescript' },
  },
});
```

## Loading Strategies

When loading relations, you can choose between two strategies: `joined` (default) or `select`.

- **Joined**: Loads the relation in the same query using a `JOIN`.
- **Select**: Loads the relation in a separate query (`N+1` protection is handled by `IN` clause optimization where possible).

You can specify the strategy in the query options.

```typescript
const users = await User.find({
  load: ['posts'],
  loadStrategy: 'select' // or 'joined'
});
```

## Nested Relationship Filtering

When you query based on a field of a related entity, Carno ORM **automatically** joins the required table to perform the filter.

This happens regardless of whether you requested the relation to be loaded in the result set or not.

```typescript
// Finds users who have posts with title "Hello World"
const users = await User.find({
  where: {
    posts: { title: 'Hello World' }
  }
});
```

The ORM will automatically generate a `JOIN` to the `posts` table and apply the condition.

> **Note**: This behavior defaults to using the `joined` strategy logic for the purpose of the WHERE clause, ensuring the filter is applied efficiently in the database using a single query structure.

## Relationship Summary

| Decorator | FK Location | Returns | Example |
|-----------|-------------|---------|---------|
| `@OneToMany` | Child entity | `T[]` | User → Post[] |
| `@ManyToOne` | Current entity | `T` | Post → User |
| `@OneToOne` (owner) | Current entity (UNIQUE) | `T` | User → Profile |
| `@OneToOne` (inverse) | Related entity | `T` | Profile → User |
| `@ManyToMany` | Pivot table | `T[]` | Post → Tag[] |