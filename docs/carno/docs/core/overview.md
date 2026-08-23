---
sidebar_position: 1
---

# Core Overview

`@carno.js/core` is the foundation of a Carno application. It provides the HTTP server integration, routing decorators, request context, dependency injection container, middleware pipeline, validation integration, cache service and lifecycle hooks.

The core package is intentionally small. Features that are not required by every application, such as ORM, queues, scheduling, static files, views, websockets, logging and the optional typed HTTP client, live in first-party packages that can be added as plugins.

Developers translating an existing NestJS architecture can start with [Coming from NestJS](../coming-from-nestjs.md) for a concept map and an incremental migration path.

## What Core Owns

Core is responsible for:

- Creating and starting the Bun HTTP server.
- Registering controllers and compiling route handlers.
- Resolving constructor dependencies through the DI container.
- Running middleware around handlers.
- Parsing request data through `Context`.
- Validating DTOs when a validation schema is present.
- Managing lifecycle hooks.
- Providing a default `CacheService`.
- Importing plugin controllers, services, middleware and routes.

## Application Entry Point

Every app starts with a `Carno` instance.

```ts
import { Carno } from '@carno.js/core';
import { UserController } from './user.controller';
import { UserService } from './user.service';

const app = new Carno()
  .services([UserService])
  .controllers([UserController]);

app.listen(3000);
```

`listen()` bootstraps the container, compiles routes and starts Bun's server.

## Configuration

The `Carno` constructor accepts framework-level configuration.

```ts
import { Carno, ZodAdapter } from '@carno.js/core';

const app = new Carno({
  validation: ZodAdapter,
  globalMiddlewares: [],
  cors: {
    origins: ['https://app.example.com'],
    credentials: true,
  },
  cache: {
    prefix: 'my-app',
    defaultTtl: 60_000,
  },
});
```

Common options:

| Option | Description |
| :--- | :--- |
| `exports` | Services exported by a plugin module |
| `globalMiddlewares` | Middleware applied to every route |
| `disableStartupLog` | Disable the startup console message |
| `cors` | CORS configuration |
| `validation` | Validation adapter, `true`, `false` or adapter instance |
| `cache` | CacheService configuration |

## Controllers and Routes

Controllers group route handlers behind a base path.

```ts
import { Controller, Get, Param } from '@carno.js/core';

@Controller('/users')
export class UserController {
  constructor(private users: UserService) {}

  @Get('/:id')
  findOne(@Param('id') id: string) {
    return this.users.findById(id);
  }
}
```

At startup, Carno reads route metadata, resolves the controller from the container and registers handlers with Bun's native route table.

## Dependency Injection

Services and controllers are created by the container.

```ts
import { Service } from '@carno.js/core';

@Service()
export class UserService {
  constructor(private repository: UserRepository) {}
}
```

The container supports singleton, request and instance scopes, plus `useClass` and `useValue` providers. See [Dependency Injection](./dependency-injection) for the full model.

## Request Context

Each handler receives a `Context` internally. You can access it with `@Ctx()` or use parameter decorators such as `@Body()`, `@Param()` and `@Query()`.

```ts
import { Body, Controller, Ctx, Post, type Context } from '@carno.js/core';

@Controller('/posts')
class PostController {
  @Post()
  create(@Ctx() ctx: Context, @Body() body: any) {
    return ctx.json({ created: true, body }, 201);
  }
}
```

`Context` lazily parses URL, query, body and locals only when they are accessed.

## Middleware Pipeline

Middleware wraps route handlers and is used for cross-cutting concerns.

```ts
import { Middleware } from '@carno.js/core';

@Controller('/admin')
@Middleware(AuthMiddleware)
class AdminController {}
```

Middleware can return early, add data to `ctx.locals` or transform the final `Response`.

## Validation

Validation is enabled by default with Zod. Add `@Schema()` to DTO classes and use them with `@Body()`.

```ts
import { Body, Post, Schema } from '@carno.js/core';
import { z } from 'zod';

const CreateUserSchema = z.object({
  email: z.string().email(),
});

@Schema(CreateUserSchema)
class CreateUserDto {
  email!: string;
}

@Post()
create(@Body() body: CreateUserDto) {
  return body;
}
```

Invalid requests return `400 Bad Request` before reaching the handler.

## Plugins and Modules

A plugin is another `Carno` instance that contributes routes, services, middleware or framework integration.

```ts
export const AuthModule = new Carno({
  exports: [AuthService],
});

AuthModule.services([AuthService, PasswordHasher]);
AuthModule.controllers([AuthController]);
```

```ts
const app = new Carno()
  .use(AuthModule);
```

Encapsulation rules:

- Controllers from a plugin are imported into the main router.
- Plugin services are private unless listed in `exports`.
- Middleware registered by the plugin is merged into the app.
- Programmatic routes registered by the plugin are copied into the app.

## Lifecycle Hooks

Lifecycle hooks let services react to startup and shutdown.

```ts
import { OnApplicationInit, Service } from '@carno.js/core';

@Service()
class DatabaseService {
  @OnApplicationInit()
  async connect() {
    // connect before serving traffic
  }
}
```

Use lifecycle hooks for application-level setup and cleanup, not for per-request logic.

## Recommended Reading Order

1. [Controllers & Routing](./controllers)
2. [Context](./context)
3. [Validation](./validation)
4. [Dependency Injection](./dependency-injection)
5. [Middleware](./middleware)
6. [Lifecycle Events](./lifecycle)
7. [Caching](./caching)
