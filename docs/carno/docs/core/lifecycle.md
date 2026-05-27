---
sidebar_position: 8
---

# Lifecycle Events

Carno.js allows you to hook into key moments of the application lifecycle using decorators.

## Available Hooks

| Decorator | Trigger |
| :--- | :--- |
| `@OnApplicationInit()` | Called when the DI container initializes, before the server starts. |
| `@OnApplicationBoot()` | Called right after the application is fully bootstrapped. |
| `@OnApplicationShutdown()` | Called when the application receives a termination signal (`SIGTERM`, `SIGINT`). |

## Usage

Decorate any method in your `@Service` or `@Controller` classes.

### Execution Priority

All lifecycle decorators accept an optional `priority` parameter (default is `0`). Hooks with a **higher priority number** are executed first. This is crucial when one service depends on another being initialized first.

```ts
import { Service, OnApplicationInit } from '@carno.js/core';

@Service()
export class ConfigService {
  @OnApplicationInit(100) // Runs first
  async loadConfig() {
    console.log('Loading configuration...');
  }
}

@Service()
export class DatabaseService {
  @OnApplicationInit(50) // Runs after ConfigService
  async connect() {
    console.log('Connecting to database...');
  }
}
```

## Available Hooks

1. **Init**: Providers are loaded. `@OnApplicationInit` hooks run.
2. **Boot**: Server starts. `@OnApplicationBoot` hooks run.
3. **Runtime**: Requests are handled.
4. **Shutdown**: Signal received. `@OnApplicationShutdown` hooks run.

## Bean Lifecycle Hooks

Unlike application-wide lifecycle events, **Bean Lifecycle Hooks** are scoped to individual services/beans managed by the Dependency Injection (DI) container.

### `@PostConstruct()`

Marks a method to execute immediately after the container has instantiated the service and resolved all of its dependencies. This is ideal for performing initialization that requires injected dependencies (e.g., establishing a client connection, warming caches, preparing files).

- **Execution**: Run once per instance creation.
- **Async support**: If the method returns a `Promise`, it executes asynchronously in the background. The container's `get` retrieval remains non-blocking.

```ts
import { Service, PostConstruct } from '@carno.js/core';
import { DatabaseService } from './DatabaseService';

@Service()
export class CacheWarmupService {
  constructor(private db: DatabaseService) {}

  @PostConstruct()
  async initializeCache() {
    console.log('Warming up query cache...');
    const data = await this.db.query('SELECT * FROM config');
    // ... cache data
  }
}
```

### `@PreDestroy()`

Marks a method to execute when the application is shutting down. It is triggered during the `EventType.SHUTDOWN` lifecycle event. This is ideal for cleaning up resources, releasing connections, and ending intervals.

- **Execution**: Executed for all singleton instances currently held by the container.
- **Graceful Shutdown**: The framework awaits any returned promises from `@PreDestroy` methods before completely stopping the server.

```ts
import { Service, PreDestroy } from '@carno.js/core';
import { RedisClient } from 'redis';

@Service()
export class MemoryStore {
  private client: RedisClient;

  @PreDestroy()
  async cleanup() {
    console.log('Closing Redis connection...');
    await this.client.quit();
  }
}
```