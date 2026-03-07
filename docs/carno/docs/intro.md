---
sidebar_position: 1
---

# Introduction

Carno.js is the **fastest framework for Bun**.

It combines a small, expressive core with opt-in modules for data access, background jobs, and scheduling.
The framework relies heavily on TypeScript decorators to provide a declarative and clean API.

## Design Goals

- **Blazing Fast**: 40% faster than Elysia. [See benchmarks](/docs/benchmark).
- **Bun Native**: Built specifically to leverage Bun's HTTP server and runtime capabilities.
- **TypeScript First**: Decorators and strong typing are first-class citizens.
- **Modular**: The core is lightweight. You only install what you need (`@carno.js/orm`, `@carno.js/queue`, etc.).
- **Dependency Injection**: A robust DI container manages your application's components and scopes (Singleton, Request, Instance).

## Ecosystem

| Package | Description | Installation |
| :--- | :--- | :--- |
| **`@carno.js/core`** | The heart of the framework. HTTP server, DI, Middleware, Validation, Logging. | `bun install @carno.js/core` |
| **`@carno.js/orm`** | Lightweight Object-Relational Mapper for Postgres and MySQL. | `bun install @carno.js/orm` |
| **`@carno.js/queue`** | Background job processing powered by BullMQ. | `bun install @carno.js/queue` |
| **`@carno.js/schedule`** | Task scheduling (Cron, Interval, Timeout). | `bun install @carno.js/schedule` |
| **`@carno.js/websocket`** | Native WebSocket support with rooms, namespaces, and broadcasting. | `bun install @carno.js/websocket` |
| **`@carno.js/cli`** | Command Line Interface for migrations and tools. | `bun install -d @carno.js/cli` |
| **`@carno.js/logger`**| Fast and flexible logging solution. | `bun install @carno.js/logger` |

> **Windows:** Wrap scoped package names in double quotes, for example `bun install "@carno.js/core"`.

## Modularity & Clean Code

Carno.js is built with modularity in mind. Instead of a large monolithic configuration, you are encouraged to split your logic into independent **Plugins**. This keeps your codebase organized and your features decoupled.

```ts
// feature.module.ts
import { Carno } from '@carno.js/core';

export const FeatureModule = new Carno({
  exports: [FeatureService] // Make FeatureService available to the parent app
});
FeatureModule.controllers([FeatureController]);
FeatureModule.services([FeatureService]);

// index.ts
import { Carno } from '@carno.js/core';
import { FeatureModule } from './feature.module';

const app = new Carno();
app.use(FeatureModule);
app.listen(3000);
```

## Documentation Structure

- **Getting Started**: Installation and basic setup.
- **Core**: Deep dive into Controllers, Providers, Middleware, and the runtime lifecycle.
- **ORM**: Managing database connections, entities, relationships, and transactions.
- **Queue**: Handling asynchronous jobs and events.
- **Schedule**: Defining recurring tasks.
- **WebSocket**: Real-time communication with rooms, namespaces, and broadcasting.
- **Testing**: Utilities for integration testing your application.
