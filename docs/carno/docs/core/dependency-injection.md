---
sidebar_position: 4
---

# Dependency Injection

Dependency Injection is the mechanism Carno uses to create controllers, services, middleware classes and framework services with their dependencies already wired.

Instead of constructing dependencies manually inside every class, you describe what a class needs in its constructor. The container owns the creation process, caches instances according to their scope and gives each class the dependencies it asked for.

This keeps application code focused on behavior:

```ts
import { Service } from '@carno.js/core';

@Service()
export class UserService {
  constructor(private emails: EmailService) {}

  async inviteUser(email: string) {
    await this.emails.sendInvite(email);
  }
}
```

`UserService` does not need to know how `EmailService` is constructed. It only declares the dependency.

## Why Use DI?

DI matters as the application grows because it gives you one place to control object creation.

It helps with:

- Keeping controllers thin and moving business logic into services.
- Sharing expensive resources such as database clients, caches and loggers.
- Replacing implementations behind an abstract token.
- Testing services with smaller dependency graphs.
- Separating modules while still allowing explicit exports.

Without DI, classes tend to instantiate their own dependencies. That makes dependencies harder to replace, harder to test and harder to manage across modules.

## Defining Services

Use `@Service()` to mark a class as injectable.

```ts
import { Service } from '@carno.js/core';

@Service()
export class DatabaseService {
  async connect() {
    // connect to database
  }
}
```

Register services on the app or module with `.services()`.

```ts
import { Carno } from '@carno.js/core';
import { DatabaseService } from './database.service';
import { UserService } from './user.service';

const app = new Carno()
  .services([DatabaseService, UserService]);

app.listen(3000);
```

Controllers are also resolved through the same container, so constructor injection works there too.

```ts
import { Controller, Get } from '@carno.js/core';

@Controller('/users')
export class UserController {
  constructor(private users: UserService) {}

  @Get()
  findAll() {
    return this.users.findAll();
  }
}
```

## Constructor Injection

Carno uses TypeScript reflection metadata to read constructor parameter types. That means class dependencies can be inferred automatically:

```ts
@Service()
class LoggerService {
  info(message: string) {
    console.log(message);
  }
}

@Service()
class AuditService {
  constructor(private logger: LoggerService) {}

  record(action: string) {
    this.logger.info(action);
  }
}
```

Both `LoggerService` and `AuditService` must be registered. If a dependency is missing, the container throws a clear provider error when resolving the class.

## Provider Registration

The `.services()` method accepts classes and provider objects.

```ts
import { Carno } from '@carno.js/core';

const app = new Carno()
  .services([
    DatabaseService,
    UserService,
  ]);
```

For a class provider, the token and implementation are the same class.

```ts
app.services([UserService]);
```

That is equivalent to:

```ts
app.services([
  {
    token: UserService,
    useClass: UserService,
  },
]);
```

## Value Providers

Use `useValue` when the object already exists or when you want to inject configuration.

```ts
class AppConfig {
  constructor(
    public readonly apiUrl: string,
    public readonly apiKey: string,
  ) {}
}

const app = new Carno()
  .services([
    {
      token: AppConfig,
      useValue: new AppConfig(
        process.env.API_URL!,
        process.env.API_KEY!,
      ),
    },
  ]);
```

Any class that depends on `AppConfig` will receive that same instance.

```ts
@Service()
class ExternalApiClient {
  constructor(private config: AppConfig) {}
}
```

## Class Substitution

Use `useClass` when callers depend on one token but you want to provide another implementation.

```ts
abstract class PaymentGateway {
  abstract charge(amount: number): Promise<void>;
}

@Service()
class StripeGateway extends PaymentGateway {
  async charge(amount: number) {
    // call Stripe
  }
}

const app = new Carno()
  .services([
    {
      token: PaymentGateway,
      useClass: StripeGateway,
    },
  ]);
```

Now services can depend on `PaymentGateway` while the app decides the concrete implementation.

```ts
@Service()
class CheckoutService {
  constructor(private payments: PaymentGateway) {}
}
```

This is useful for environment-specific implementations, tests and integrations that should remain behind an application-level abstraction.

## Scopes

Carno supports three lifecycle scopes.

| Scope | Behavior | Use for |
| :--- | :--- | :--- |
| `Scope.SINGLETON` | One instance shared by the app. This is the default. | Stateless services, clients, repositories, loggers |
| `Scope.REQUEST` | One instance per request context when request-local resolution is available. | Request state, current user, correlation data |
| `Scope.INSTANCE` | A new instance every time the token is resolved. | Short-lived objects that must never be shared |

```ts
import { Scope, Service } from '@carno.js/core';

@Service({ scope: Scope.INSTANCE })
export class RandomIdGenerator {
  readonly id = crypto.randomUUID();
}
```

You can also set scope in the provider registration:

```ts
app.services([
  {
    token: RandomIdGenerator,
    useClass: RandomIdGenerator,
    scope: Scope.INSTANCE,
  },
]);
```

## Singleton Scope

Singleton is the default. The first resolution creates the instance and subsequent resolutions reuse it.

```ts
@Service()
class ProductCatalog {
  private loaded = false;
}
```

Use singleton services for dependencies that are safe to share across requests. Do not put per-request mutable state on singleton services.

## Instance Scope

Instance scope creates a new object for every resolution.

```ts
app.services([
  {
    token: UnitOfWork,
    useClass: UnitOfWork,
    scope: Scope.INSTANCE,
  },
]);
```

Use it when each consumer needs a fresh object and sharing would be incorrect.

## Request Scope and Scope Bubbling

Request-scoped services are designed for data tied to a specific request, such as authenticated user context or request metadata.

```ts
@Service({ scope: Scope.REQUEST })
class CurrentUser {
  id?: string;
}
```

Carno also applies scope bubbling. If a singleton depends on a request-scoped dependency, the parent effectively becomes request-scoped for that resolution. This prevents a singleton from keeping a stale request object.

```ts
@Service({ scope: Scope.REQUEST })
class CurrentUser {}

@Service()
class UserPolicy {
  constructor(private currentUser: CurrentUser) {}
}
```

`UserPolicy` is declared as singleton, but because it depends on `CurrentUser`, it cannot safely be reused across requests. Scope bubbling protects that boundary.

## Circular Dependencies

The container detects circular dependency resolution and throws an error.

```ts
@Service()
class A {
  constructor(private b: B) {}
}

@Service()
class B {
  constructor(private a: A) {}
}
```

Cycles usually indicate that responsibilities should be split or that one side should depend on a smaller abstraction instead of the concrete service.

## Modules and Exports

Plugins are also `Carno` instances. Their controllers are imported when the plugin is used, but services are private unless exported.

```ts
export const AuthModule = new Carno({
  exports: [AuthService],
});

AuthModule.services([
  AuthService,
  PasswordHasher,
]);
```

```ts
const app = new Carno()
  .use(AuthModule)
  .controllers([UsersController]);
```

Only `AuthService` is available outside the module. `PasswordHasher` remains internal to `AuthModule`.

## Post-Construction Hooks

Use `@PostConstruct()` when a service needs initialization after constructor injection.

```ts
import { PostConstruct, Service } from '@carno.js/core';

@Service()
class SearchIndex {
  @PostConstruct()
  warm() {
    // prepare local index
  }
}
```

The hook runs when the instance is created. If it returns a promise, Carno starts it and logs errors, but container resolution itself remains non-blocking.

Use application lifecycle hooks when startup must wait for initialization.

## Practical Guidelines

- Register every injectable service explicitly with `.services()` or through a plugin export.
- Keep constructors simple; avoid doing network work in constructors.
- Put per-request data in request-scoped services or `ctx.locals`, not in singleton fields.
- Prefer `useClass` for replaceable implementations and `useValue` for already-created objects.
- Avoid circular dependencies by extracting smaller services or interfaces.
- Use `@PostConstruct()` for local setup and `@OnApplicationInit()` for startup work that must be coordinated.

## See Also

- [Controllers & Routing](./controllers) for controller injection.
- [Middleware](./middleware) for class-based middleware injection.
- [Lifecycle Events](./lifecycle) for startup and shutdown hooks.
