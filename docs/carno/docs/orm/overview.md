---
sidebar_position: 1
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# ORM Overview

`@carno.js/orm` is a lightweight, Data Mapper-style ORM built for Bun. It supports PostgreSQL and MySQL.

## Two Ways to Work

Carno ORM supports two distinct ways to work with entities. Both use `@Entity()`, but they have different responsibilities.

| Pattern | Entity shape | Main API | Best for |
| :--- | :--- | :--- | :--- |
| Active Record | `class User extends BaseEntity` | `User.find()`, `user.save()` | Smaller domains, direct entity-centric persistence |
| Repository | `class User` or `class User extends BaseEntity` | `userRepository.find()`, `userRepository.create()` | Service-oriented code, separation of concerns, larger applications |

### Important Rule

Choose the pattern per entity based on how you want to access persistence:

- If you want `save()`, `remove()`, `isPersisted()` and static methods like `User.find()`, extend `BaseEntity`.
- If you want to keep persistence logic in repositories, `BaseEntity` is optional.
- A class decorated with `@Entity()` still gets ORM metadata in both cases.
- Rich serialization works in both cases as long as the class is decorated with `@Entity()`.

### What `BaseEntity` Adds

`BaseEntity` is not what makes a class an entity. The `@Entity()` decorator does that.

`BaseEntity` only adds the Active Record behavior:

- Static query methods such as `find`, `findOne`, `findAll` and `create`
- Instance persistence methods such as `save` and `remove`
- Persistence state helpers such as `isPersisted()`
- Dirty tracking for instance-based updates

If you do not need those behaviors, you can use a plain decorated class and access the database exclusively through a repository.

## Why Carno ORM?

Unlike many other Node.js ORMs, Carno ORM **does not rely on external query builder kernels** (like Knex.js). instead, it is built directly on top of Bun's native `bun:sqlite` (compatible interfaces) and optimized drivers for PostgreSQL and MySQL. This architecture allows for raw performance, lower overhead, and zero legacy Node.js dependencies.

## Installation

<Tabs groupId="os">
  <TabItem value="mac" label="macOS / Linux">
    ```bash
    bun install @carno.js/orm
    ```
  </TabItem>
  <TabItem value="windows" label="Windows">
    ```bash
    bun install "@carno.js/orm"
    ```
  </TabItem>
</Tabs>

## Configuration

Register the `CarnoOrm` plugin in your application.

```ts
import { Carno } from '@carno.js/core';
import { CarnoOrm } from '@carno.js/orm';

const app = new Carno()
  .use(CarnoOrm);

await app.listen(3000);
```

## Recommended Reading Order

If you are starting from scratch:

1. Read [Entities](./entities) to understand what `@Entity()` does.
2. Read [Repository](./repository) if you want a service/repository-oriented architecture.
3. Read [Active Record](./active-record) only if you want persistence methods directly on the entity class.

## Connection Settings

You need to provide connection settings via `carno.config.ts` in your project root or programmatically (though `carno.config.ts` is preferred for tools).

### carno.config.ts

```ts
import { ConnectionSettings, BunPgDriver } from '@carno.js/orm';

const config: ConnectionSettings = {
  driver: BunPgDriver, // or BunMysqlDriver
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'password',
  database: 'my_db',
  // Optional:
  migrationPath: './migrations',
};

export default config;
```

## Debugging SQL

To see executed SQL queries, enable the `debug` flag in your `carno.config.ts`:

```ts
import { BunPgDriver } from '@carno.js/orm';

export default {
  driver: BunPgDriver,
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'password',
  database: 'my_db',

  // Enable SQL logging
  debug: true,
};
```

When `debug: true` is set, the ORM will log all SQL queries with execution time:

```
[DEBUG] SQL: SELECT u1."id" as "u1_id", u1."name" as "u1_name" FROM "public"."users" u1 WHERE (u1.id = 1) [2ms]
```

### Logger Integration

The ORM automatically detects if `@carno.js/logger` is installed:

- **With `@carno.js/logger`**: Uses the full-featured LoggerService with colors and formatting
- **Without `@carno.js/logger`**: Falls back to `console.log`

To use the enhanced logger:

```bash
bun install @carno.js/logger
```

### Programmatic Control

You can also enable/disable debug mode programmatically:

```ts
import { setDebugEnabled } from '@carno.js/orm';

// Enable debug logging
setDebugEnabled(true);

// Disable debug logging
setDebugEnabled(false);
```
