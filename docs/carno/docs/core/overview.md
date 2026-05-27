---
sidebar_position: 1
---

# Core Overview

The `@carno.js/core` package provides the fundamental building blocks of your application: the HTTP server, Dependency Injection container, and lifecycle management.

## The Carno Application

The `Carno` class is the entry point. It manages configuration, plugins, and the server lifecycle.

```ts
import { Carno } from '@carno.js/core';

const app = new Carno();
await app.listen(3000);
```

### Configuration

You can pass a configuration object to the constructor:

```ts
const app = new Carno({
  // Global middlewares
  globalMiddlewares: [],
  
  // Validation (Zod by default)
  validation: true, 
  
  // CORS Settings
  cors: { origins: '*' }
});
```

## Lifecycle & Controllers

Controllers in Carno.js are **Singletons by default**. They are instantiated once during application startup, giving the application a predictable dependency graph and a stable route model before traffic starts.

When a controller is instantiated, all its dependencies are resolved from the DI container. This keeps request handlers thin and pushes business logic into services that are easier to test, replace, and maintain.

### Lifecycle Hooks
Components can hook into the application lifecycle:
- `@OnApplicationInit()`: Called after the DI container is fully built.
- `@OnApplicationBoot()`: Called when the server starts listening (port binding).
- `@OnApplicationShutdown()`: Called on graceful shutdown (SIGTERM/SIGINT).

## Plugins & Modules

Carno.js allows you to split your application into independent modules (plugins). Each plugin is a `Carno` instance that can have its own controllers, services, and middlewares.

### Encapsulation Rules

- **Controllers**: Controllers defined in a plugin are automatically registered with the main application's router. **Their routes are publicly accessible.** You do not need to export controllers.
- **Services**: Are **private** by default. To share a service with another module (e.g. valid for injection in the root app or other plugins), you must strictly add it to the `exports` array.
- **Middlewares**: Global middlewares defined in a plugin are merged into the main pipeline.

```ts
// auth.module.ts
export const AuthModule = new Carno({
  exports: [AuthService] // AuthService can now be injected elsewhere
});
AuthModule.services([AuthService, PrivateStrategy]); // PrivateStrategy is internal
AuthModule.controllers([AuthController]);
```

```ts
// index.ts
import { Carno } from '@carno.js/core';
import { AuthModule } from './auth.module';

const app = new Carno();
app.use(AuthModule); // Imports routes and exported services
```
