---
sidebar_position: 2
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# CLI

The Carno.js CLI provides essential tools for managing your application, including database migrations, seeders, and route inspection.

## Installation

The CLI is distributed as a separate package. You can install it as a development dependency.

### Using Bun (Recommended)

<Tabs groupId="os">
  <TabItem value="mac" label="macOS / Linux">
    ```bash
    bun add -d @carno.js/cli
    ```
  </TabItem>
  <TabItem value="windows" label="Windows">
    ```bash
    bun add -d "@carno.js/cli"
    ```
  </TabItem>
</Tabs>

### Using npm

<Tabs groupId="os">
  <TabItem value="mac" label="macOS / Linux">
    ```bash
    npm install -D @carno.js/cli
    ```
  </TabItem>
  <TabItem value="windows" label="Windows">
    ```bash
    npm install -D "@carno.js/cli"
    ```
  </TabItem>
</Tabs>


## Usage

Once installed, you can run the CLI using `bunx` or `npx`.

```bash
bunx carno --help
```

### Common Commands

#### Routes

To list all registered routes in your application:

```bash
# Analyze carno.config.ts and list routes
bunx carno routes

# Or point to your entry file if config is not enough
bunx carno routes src/index.ts
```

For more details on routing, see the [Controllers & Routing](./core/controllers.md) documentation.

#### Migrations

To manage database migrations:

```bash
# Generate a new migration based on entity changes
bunx carno migration:generate

# Apply pending migrations
bunx carno migration:run
```

For a comprehensive guide on migrations, refer to the [Migrations](./orm/migrations.md) documentation.

#### Seeders

Seeders let you insert or update data through executable classes.

```bash
# Generate a seeder (name is required)
bunx carno seeder:generate UserSeeder

# Run one specific seeder class
bunx carno seeder:run UserSeeder

# Run all seeders in registry order
bunx carno seeder:run --all
```

When the first seeder is generated, Carno creates a `seeders.ts` registry file in your seeder directory.
Each new generated seeder is appended to the end of the exported `seeders` array.
You can manually reorder this array, and that order is exactly what `seeder:run --all` will execute.

Generated seeder template:

```ts
import type { Orm } from "@carno.js/orm";

export default class UserSeeder {
  async run(orm: Orm<any>) {
    // Example:
    // await orm.driverInstance.executeSql("INSERT INTO users (email) VALUES ('admin@example.com')");
  }
}
```

You can also configure a custom seeder directory in `carno.config.ts`:

```ts
import { ConnectionSettings, BunPgDriver } from '@carno.js/orm';

const config: ConnectionSettings = {
  driver: BunPgDriver,
  migrationPath: './src/migrations',
  seederPath: './src/seeders',
};

export default config;
```
