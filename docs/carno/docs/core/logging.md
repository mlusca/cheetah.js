---
sidebar_position: 6
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Logging

Logging is provided by the dedicated `@carno.js/logger` package. The core package stays small, while the logger package provides a structured `LoggerService` that can be registered through the same plugin and dependency injection system used by the rest of Carno.

Use logging for operational visibility:

- Request and background job flow.
- Important business events.
- Integration failures.
- Debug information during development.
- Startup and shutdown diagnostics.

## Installation

<Tabs groupId="os">
  <TabItem value="mac" label="macOS / Linux">
    ```bash
    bun add @carno.js/logger
    ```
  </TabItem>
  <TabItem value="windows" label="Windows">
    ```bash
    bun add "@carno.js/logger"
    ```
  </TabItem>
</Tabs>

## Registering the Logger

Use the ready-made `CarnoLogger` plugin when the default configuration is enough.

```ts
import { Carno } from '@carno.js/core';
import { CarnoLogger } from '@carno.js/logger';

const app = new Carno()
  .use(CarnoLogger);

app.listen(3000);
```

This registers `LoggerService` in the DI container.

## Injecting `LoggerService`

```ts
import { Service } from '@carno.js/core';
import { LoggerService } from '@carno.js/logger';

@Service()
class UserService {
  constructor(private logger: LoggerService) {}

  createUser(email: string) {
    this.logger.info('Creating user', { email });

    try {
      // create user
      this.logger.debug('User created successfully', { email });
    } catch (error) {
      this.logger.error('Failed to create user', {
        email,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
```

The logger accepts a message and optional structured data.

## Log Levels

`LoggerService` supports these levels:

| Level | Use for |
| :--- | :--- |
| `DEBUG` | Detailed diagnostics for development and troubleshooting |
| `INFO` | Normal operational events |
| `WARN` | Recoverable problems or suspicious conditions |
| `ERROR` | Failed operations that need attention |
| `FATAL` | Critical failures; flushes immediately |
| `SILENT` | Disable output |

## Custom Configuration

Use `createCarnoLogger(config)` to create a configured logger plugin.

```ts
import { Carno } from '@carno.js/core';
import { createCarnoLogger, LogLevel } from '@carno.js/logger';

const LoggerModule = createCarnoLogger({
  level: LogLevel.DEBUG,
  format: process.env.NODE_ENV === 'production' ? 'json' : 'pretty',
  pretty: process.env.NODE_ENV !== 'production',
  timestamp: true,
  prefix: 'api',
  flushInterval: 10,
});

const app = new Carno()
  .use(LoggerModule);
```

Configuration options:

| Option | Description |
| :--- | :--- |
| `level` | Minimum log level to output |
| `pretty` | Pretty-print structured data |
| `format` | `'pretty'` (default) preserves the current human-readable output; `'json'` emits valid JSON Lines |
| `timestamp` | Include timestamp in each line |
| `timestampFormat` | Custom timestamp formatter |
| `prefix` | Prefix added to every log line |
| `flushInterval` | Buffer flush interval in milliseconds. `0` writes synchronously |
| `httpInstrumentation` | Enables automatic logs, `x-request-id`, and HTTP context. Defaults to `true` when the plugin is registered |

## HTTP Observability and JSON Lines

When the plugin is registered, every request receives an `x-request-id`. A valid incoming value is preserved; otherwise, Carno generates a UUID and returns it in the response header. The ID is also available as `ctx.requestId` and is automatically included in logs emitted during the request.

In JSON mode, each line is an independent object:

```json
{"timestamp":"12:34:56.789","level":"info","message":"HTTP request completed","context":{"requestId":"...","kind":"http","method":"GET","route":"/users/:id","status":200,"durationMs":1.24}}
```

The logger never captures request bodies, query strings, or headers automatically. For unhandled errors, the error event contains `error.name`, `error.message`, and `error.stack`, while the HTTP response remains the framework's safe 500 response.

## Context for Jobs and Scheduled Tasks

Jobs created during a request carry the originating `requestId` in the internal `__carno_observability` namespace. The worker restores that context even when processing jobs concurrently. Every cron, interval, and timeout invocation receives a new context. Inject `LoggerService` and the queue or schedule fields are added to its logs automatically.

## Standalone Logger

Use `createLogger()` when you need a logger outside a Carno app.

```ts
import { createLogger, LogLevel } from '@carno.js/logger';

const logger = createLogger({
  level: LogLevel.INFO,
  prefix: 'worker',
});

logger.info('Worker started');
```

## Buffering and Shutdown

By default, `LoggerService` buffers log lines briefly and flushes them on an interval. This reduces write overhead in hot paths.

The service also listens for application shutdown and process exit to flush remaining logs.

Call `logger.close()` manually only when you create a standalone logger and control its lifecycle yourself.

## Practical Guidelines

- Log events that help operate the system, not every internal branch.
- Put high-cardinality details in structured data instead of the message.
- Avoid logging secrets, tokens, passwords or full request bodies.
- Use `debug` for noisy development details and raise the level in production.
- Use request IDs from middleware when correlating logs across services.

## See Also

- [Dependency Injection](./dependency-injection) for service registration.
- [Middleware](./middleware) for request logging and correlation IDs.
- [Lifecycle Events](./lifecycle) for startup and shutdown hooks.
