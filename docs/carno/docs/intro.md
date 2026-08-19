---
sidebar_position: 1
---

# Introduction

Carno.js is an **enterprise-ready application framework for Bun and TypeScript**.

It is inspired by the structured developer experience of NestJS and the enterprise application patterns popularized by Spring in the Java ecosystem. Carno.js brings that style to Bun: decorators, dependency injection, controllers, services, lifecycle hooks, validation, and modular packages that keep large codebases easier to reason about.

Performance remains part of the contract. Carno.js is built on Bun's runtime and keeps the HTTP layer lightweight, while the primary product focus is maintainability: clear boundaries, explicit dependencies, testable services, and an application model that remains predictable as teams and features grow.

## Design Goals

- **Enterprise Application Architecture**: Controllers, services, providers, lifecycle hooks, and modules are first-class concepts.
- **Familiar for NestJS and Spring developers**: Carno.js uses a proven, decorator-driven, dependency-injected programming model without forcing a Node-first runtime.
- **Bun Native Performance**: Built specifically to use Bun's HTTP server and runtime capabilities, with benchmarks available for comparison and regression tracking.
- **TypeScript First**: Decorators, strong typing, and DTO validation are core to the framework.
- **Modular**: The core stays focused. You only install what you need (`@carno.js/orm`, `@carno.js/queue`, etc.).
- **Dependency Injection**: A DI container manages application components and scopes (Singleton, Request, Instance).

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
| **`@carno.js/client`** | Type-safe HTTP client generated from controllers. | `bun add @carno.js/client` |

> **Windows:** Wrap scoped package names in double quotes, for example `bun install "@carno.js/core"`.

Beyond the official packages, the community also maintains integrations — see [Community Plugins](./community/plugins.md).

## Modularity & Clean Code

Carno.js is built with modularity in mind. Instead of a large monolithic configuration, you are encouraged to split your logic into independent **Plugins**. This keeps your codebase organized, your features decoupled, and your business logic easier to test and maintain.

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
- **HTTP Client**: Why codegen exists, the `Client()` plugin, the HTTP client, and generation from Vite or CI.
- **Testing**: Utilities for integration testing your application.
