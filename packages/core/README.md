# @carno.js/core

Opinionated application framework core for Bun and TypeScript.

Carno core is designed for teams that like the structured programming model of NestJS and the enterprise architecture patterns common in Spring applications: controllers, services, dependency injection, lifecycle hooks, middleware, and validation as first-class concepts. It keeps performance close to the metal by building on Bun's native HTTP runtime instead of layering an enterprise API over a Node-first design.

## Installation

```bash
bun add @carno.js/core
```

## Prerequisites

Enable decorators in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

## Quick Start

```typescript
import { Carno, Controller, Get, Service, Param } from '@carno.js/core';

@Service()
class GreetService {
  greet(name: string) {
    return `Hello, ${name}!`;
  }
}

@Controller('/greet')
class GreetController {
  constructor(private greetService: GreetService) {}

  @Get('/:name')
  greet(@Param('name') name: string) {
    return { message: this.greetService.greet(name) };
  }
}

const app = new Carno();
app.services([GreetService]);
app.controllers([GreetController]);
app.listen(3000);
```

## API Overview

### Application

```typescript
const app = new Carno(config?: CarnoConfig);

app.controllers([...]);     // Register controllers
app.services([...]);        // Register services
app.middlewares([...]);     // Register global middlewares
app.use(plugin);            // Use a plugin/module
await app.listen(3000);     // Start server
await app.stop();           // Stop server
```

### Decorators

#### Controllers & Routes

| Decorator | Description |
| :--- | :--- |
| `@Controller(path?)` | Define a controller with optional base path |
| `@Get(path?)` | Handle GET requests |
| `@Post(path?)` | Handle POST requests |
| `@Put(path?)` | Handle PUT requests |
| `@Delete(path?)` | Handle DELETE requests |
| `@Patch(path?)` | Handle PATCH requests |

#### Parameters

| Decorator | Description |
| :--- | :--- |
| `@Param(key?)` | Route parameters |
| `@Query(key?)` | Query string parameters |
| `@Body(key?)` | Request body |
| `@Header(key?)` | Request headers |
| `@Req()` | Raw Request object |
| `@Ctx()` | Full Context object |

#### Dependency Injection

| Decorator | Description |
| :--- | :--- |
| `@Service(options?)` | Mark class as injectable service |
| `@Inject(token)` | Inject by token (for interfaces) |

#### Middleware

| Decorator | Description |
| :--- | :--- |
| `@Middleware(middleware)` | Apply middleware to controller/route |

#### Lifecycle

| Decorator | Description |
| :--- | :--- |
| `@OnApplicationInit()` | Called after DI container is ready |
| `@OnApplicationBoot()` | Called when server starts listening |
| `@OnApplicationShutdown()` | Called when server is stopping |

### Validation

```typescript
import { z } from 'zod';
import { Schema, ZodAdapter } from '@carno.js/core';

@Schema(z.object({
  name: z.string().min(2),
  email: z.string().email(),
}))
class CreateUserDto {
  name!: string;
  email!: string;
}

const app = new Carno({ validation: new ZodAdapter() });
```

### CORS

```typescript
const app = new Carno({
  cors: {
    origins: '*',           // or specific origin(s)
    methods: ['GET', 'POST'],
    headers: ['Content-Type'],
    credentials: true,
    maxAge: 86400,
  }
});
```

### Exceptions

```typescript
import {
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@carno.js/core';

throw new NotFoundException('User not found');
```

### Testing

```typescript
import { withTestApp } from '@carno.js/core';

await withTestApp(
  async (harness) => {
    const res = await harness.get('/users');
    expect(res.status).toBe(200);
  },
  { controllers: [UserController], listen: true }
);
```

## Configuration

```typescript
interface CarnoConfig {
  exports?: (Token | ProviderConfig)[];
  globalMiddlewares?: MiddlewareHandler[];
  disableStartupLog?: boolean;
  cors?: CorsConfig;
  validation?: ValidatorAdapter | boolean;
  cache?: CacheConfig | boolean;
}
```

## License

MIT
