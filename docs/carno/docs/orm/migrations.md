---
sidebar_position: 9
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Migrations

Migrations are versioned database changes. They let you evolve a schema deliberately, review SQL before it reaches production and keep every developer, test environment and deployment using the same database structure.

In Carno ORM, entity metadata is the source of truth for generated migrations. The CLI compares your decorated entity classes with the current database schema and creates SQL for the difference.

## Why Migrations Matter

Entity classes describe what the application expects. The database describes what is actually available at runtime. Migrations are the bridge between those two states.

Use migrations to:

- Create tables for new entities.
- Add, rename or remove columns.
- Add indexes and unique constraints.
- Add foreign keys for relations.
- Change nullability, defaults, lengths, precision and scale.
- Keep production schema changes auditable in Git.

Avoid changing production schemas manually. Manual changes are hard to review, hard to reproduce and easy to forget in another environment.

## Configuration

Set `migrationPath` in `carno.config.ts`. This is where generated migration files are written and where pending migration files are read from.

```ts
import { BunPgDriver, type ConnectionSettings } from '@carno.js/orm';

const config: ConnectionSettings = {
  driver: BunPgDriver,
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'password',
  database: 'my_app',
  migrationPath: './src/migrations',
};

export default config;
```

If your entities are not in the default discovery paths, also configure `entities`:

```ts
const config: ConnectionSettings = {
  driver: BunPgDriver,
  // ...connection settings
  entities: './src/**/*.entity.ts',
  migrationPath: './src/migrations',
};
```

The ORM service can import entity files from the `entities` glob before it builds metadata. This is important because migrations can only reflect entities that have been loaded.

## Installing the CLI

Install the Carno CLI as a dev dependency.

<Tabs groupId="os">
  <TabItem value="mac" label="macOS / Linux">
    ```bash
    bun install -d @carno.js/cli
    ```
  </TabItem>
  <TabItem value="windows" label="Windows">
    ```bash
    bun install -d "@carno.js/cli"
    ```
  </TabItem>
</Tabs>

See the [CLI documentation](../cli.md) for general command usage.

## Generating Migrations

Run:

```bash
bunx carno migration:generate
```

Generation uses schema reflection:

1. The CLI loads `carno.config.ts`.
2. The ORM loads entity metadata from your decorators.
3. The current database schema is inspected.
4. The two schemas are compared.
5. A migration file is written with the SQL needed to make the database match your entities.

For example, adding a property can produce an `ALTER TABLE ... ADD COLUMN ...` statement. Adding `@Index()` or `@Unique()` can produce index or constraint statements. Adding a relation can produce a foreign key column and constraint.

## Reviewing Generated SQL

Always read generated migrations before running them.

Pay special attention to:

- Destructive changes such as `DROP COLUMN` or `DROP TABLE`.
- Type changes that can fail if existing data cannot be cast.
- New `NOT NULL` columns on tables that already contain rows.
- Unique constraints on existing data that may have duplicates.
- Foreign keys where old rows might not satisfy the relation.
- Large table changes that can lock production tables.

Generated migrations are a starting point. Editing the SQL before committing it is normal when production data needs a staged rollout.

## Running Migrations

Apply pending migrations with:

```bash
bunx carno migration:run
```

Run migrations against the same database settings defined in `carno.config.ts`. In CI and production, provide credentials through environment variables and keep the same config shape.

```ts
const config: ConnectionSettings = {
  driver: BunPgDriver,
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  migrationPath: './dist/migrations',
};
```

## Recommended Workflow

1. Change your entity classes.
2. Run `bunx carno migration:generate`.
3. Review and edit the generated SQL if necessary.
4. Run the migration locally.
5. Run tests against the migrated schema.
6. Commit the entity changes and migration file together.
7. Run migrations during deployment before starting the new application version.

## Safe Production Patterns

For simple additions, one migration is often enough:

```ts
@Property({ nullable: true })
nickname?: string;
```

For risky changes, prefer multiple deployable steps:

1. Add the new nullable column.
2. Deploy code that writes both old and new columns.
3. Backfill existing rows.
4. Deploy code that reads the new column.
5. Add `NOT NULL`, unique constraints or remove old columns in a later migration.

This avoids forcing data migration, application release and schema enforcement into one fragile deployment.

## Entity Changes That Affect Migrations

These decorators and options are reflected into schema changes:

| Entity code | Schema effect |
| :--- | :--- |
| `@Entity({ tableName })` | Table name |
| `@PrimaryKey()` | Primary key |
| `@Property()` | Column |
| `nullable`, `default`, `length`, `precision`, `scale`, `dbType` | Column definition |
| `unique` or `@Unique()` | Unique constraint |
| `index` or `@Index()` | Index |
| `@ManyToOne()` and owning `@OneToOne()` | Foreign key column |
| `@ManyToMany()` | Pivot table metadata |
| Value Object `max`, `precision`, `scale` | Column length or numeric metadata |

Changing business logic inside methods does not affect migrations unless it changes decorators or property metadata.

## Best Practices

- Commit migration files to version control.
- Do not edit old migrations after they have been applied in shared environments.
- Prefer a new migration for every schema change after merge.
- Keep migrations small enough to review.
- Run migrations locally before opening a pull request.
- Keep `carno.config.ts` aligned with the environment where the CLI runs.
- Make entity discovery explicit with `entities` when your project structure is unusual.

## See Also

- [Entities](./entities) for schema-related decorators.
- [Relations](./relations) for foreign key and pivot-table mapping.
- [Value Objects](./value-objects) for scalar domain types that influence column metadata.
