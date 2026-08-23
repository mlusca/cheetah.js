---
sidebar_position: 3
title: Coming from NestJS
description: Understand how familiar NestJS concepts map to the Bun-native Carno.js application model, and plan a safe migration.
keywords:
  - Carno.js
  - NestJS
  - Bun
  - TypeScript
  - dependency injection
  - migration
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Carno.js for developers coming from NestJS

If you are productive with NestJS, you already understand much of the architecture that Carno.js encourages. Controllers define the HTTP boundary, services hold application behavior, and dependency injection keeps object creation outside your business logic.

The important difference is not the vocabulary. It is **where the framework ends and your application begins**. NestJS organizes an application through decorated module classes and runs it through a Node-oriented platform abstraction. Carno.js makes composition explicit and owns a request path designed directly around Bun.

This guide explains that shift. It is not a promise of drop-in compatibility, and it is not a list of decorator replacements.

:::info The short version

Keep your architectural instincts. Reconsider your composition root and infrastructure integrations. Carno.js will feel familiar at the controller and service level, but it is a separate framework with its own runtime, container, lifecycle, and package ecosystem.

:::

## Start with the application model

In both frameworks, a well-structured request usually follows the same path:

**Request → controller → application service → repository or integration**

Each boundary still has a clear job:

- A **controller** translates HTTP input into an application call. It should remain thin.
- A **service** owns a use case or reusable application behavior.
- The **container** creates those objects and supplies their dependencies.
- A **module boundary** groups related behavior and controls what other parts of the application may use.

This is why a NestJS codebase does not feel foreign in Carno.js. The classes can retain their responsibilities even though the application is assembled differently.

The key rule in Carno.js is:

> A decorator describes what a class is. Registration decides whether that class belongs to the running application.

Adding `@Service()` makes a class injectable, but it does not silently activate it. The composition root must register the service. The same is true for controllers.

## The central shift: composition becomes explicit

NestJS stores composition in `@Module()` metadata. Carno.js expresses it through a configured `Carno` instance. The two examples below describe the same ownership boundary, not interchangeable syntax.

<Tabs groupId="framework-composition">
  <TabItem value="nestjs" label="NestJS">

```ts
@Module({
  imports: [DatabaseModule],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
```

  </TabItem>
  <TabItem value="carno" label="Carno.js" default>

```ts
export const UsersModule = new Carno({
  exports: [UsersService],
})
  .use(DatabaseModule)
  .services([UsersService, UsersRepository])
  .controllers([UsersController]);
```

  </TabItem>
</Tabs>

Read the Carno.js version from top to bottom:

1. `new Carno()` creates an isolated application boundary.
2. `exports` defines the small public surface of that boundary.
3. `.use()` composes another Carno.js plugin into it.
4. `.services()` lists the dependencies owned by the module.
5. `.controllers()` lists the HTTP entry points owned by the module.

Nothing is inferred from a directory name, and a decorated class does not become globally available by accident. When debugging an unfamiliar codebase, the registration chain tells you what is active and where it came from.

### Why Carno.js chooses this model

Explicit composition gives the application root a few useful properties:

- **Ownership is visible.** You can see which module creates a service or exposes a controller.
- **Encapsulation has a concrete boundary.** Internal services remain private unless they are exported.
- **Startup is easier to reason about.** The active graph comes from registration, not from scanning files.
- **Tests can assemble smaller graphs.** A test can register only the controllers and services required by the behavior under test.

This is not inherently better for every team. It is a deliberate trade: a little more visible registration in exchange for less hidden composition.

## A concept map, not a replacement table

The following map is useful when reading Carno.js documentation. “Closest concept” means the responsibilities overlap; it does not mean the APIs or runtime behavior are identical.

| NestJS concept | Closest Carno.js concept | Important distinction |
| :--- | :--- | :--- |
| `@Module()` | Configured `Carno` instance | Composition uses methods instead of module decorator metadata |
| Injectable provider | `@Service()` class | The service must also be registered with `.services()` |
| `controllers` metadata | `.controllers()` | Registration is part of the explicit composition chain |
| Module `imports` | `.use(plugin)` | Plugins are Carno instances with their own registrations |
| Module `exports` | `exports` configuration | Unexported plugin services remain private |
| Provider scopes | `Scope.SINGLETON`, `REQUEST`, `INSTANCE` | Request dependencies can cause scope bubbling |
| Pipes and DTO validation | `@Schema()` plus a validation adapter | Zod is available by default; Valibot is supported |
| Platform adapter | Bun-native HTTP layer | No Express or Fastify adapter sits in the request path |
| ORM integration | Optional `@carno.js/orm` package | The first-party ORM is available, but core does not require it |
| `@Render()` | Injected `ViewService` from `@carno.js/views` | There is no `@Render` decorator in v1; the controller injects the service and calls `html()` or `respond()` |

Use this table to orient yourself, then learn the Carno.js behavior on its own terms. Copying assumptions from NestJS is where most migration surprises begin.

## Dependency injection: familiar surface, explicit graph

Constructor injection remains the normal way to express dependencies. With decorator metadata enabled, Carno.js can infer class tokens from constructor parameter types. Most services therefore remain straightforward: decorate the class, declare its dependencies, and register it in the owning module.

The registration step is important because it answers two different questions:

1. **Can the container construct this class?** `@Service()` supplies the injectable metadata.
2. **Does this application own this class?** `.services()` includes it in the active graph.

Start with concrete class dependencies. Reach for explicit provider objects only when the application genuinely needs an abstraction, a pre-built value, or an implementation selected by environment.

| Need | Registration approach |
| :--- | :--- |
| A normal application service | Register the decorated class directly |
| One implementation behind an abstract token | Use `useClass` |
| Configuration or an already-created client | Use `useValue` |
| A fresh object for every resolution | Use `Scope.INSTANCE` |
| State tied to one HTTP request | Use `Scope.REQUEST` |

Request scope deserves special attention during migration. If a service depends on request-scoped state, Carno.js bubbles that scope through the dependency chain so a singleton cannot retain data from an earlier request. That protection is useful, but it can change how often parent services are created. Review services that carry current-user, tenant, or correlation data rather than assuming their old lifecycle.

The complete provider model is documented in [Dependency Injection](./core/dependency-injection).

## Bun is not just the executable

Running a Node-oriented framework with the Bun executable and using a framework designed around Bun are different architectural choices.

Carno.js registers compiled handlers with Bun's native route table. Its request context parses URL, query, body, and locals lazily, and its lifecycle coordinates first-party packages through the same application model. There is no Express or Fastify compatibility layer between the controller and Bun's server.

That distinction has practical consequences:

### HTTP middleware must match the platform

Middleware written against Express request and response objects cannot be moved unchanged. Preserve the behavior—authentication, tracing, rate limiting—but implement it against the Carno.js `Context` and middleware contract.

### Platform-specific packages need review

A package that only uses standard Web APIs may work naturally. A package that patches Express, depends on Node HTTP internals, or expects NestJS discovery metadata probably needs an adapter or a Carno.js-native replacement.

### Response behavior should be tested at the boundary

Do not validate a migration only by compiling controllers. Verify status codes, headers, serialization, validation errors, and exception responses with HTTP-level tests. These are the places where platform assumptions become observable.

:::tip Migrate behavior, not framework plumbing

Write down what an integration accomplishes before replacing it. “Reject unauthenticated requests” is portable behavior. “Run this Express middleware” is an implementation detail tied to the previous platform.

:::

## Modules become application boundaries

A Carno.js plugin is a complete, composable `Carno` instance. Thinking of it only as a NestJS module replacement undersells the model: the same primitive can contribute controllers, services, middleware, programmatic routes, lifecycle behavior, or a framework integration.

The `exports` list is the boundary's contract. Suppose `UsersModule` owns `PasswordHasher` and `UsersService`, but only other modules need `UsersService`. Exporting the service while keeping the hasher private prevents consumers from coupling themselves to an internal implementation detail.

When designing a module, ask three questions:

1. Which controllers enter this boundary?
2. Which services are implementation details of this boundary?
3. What is the smallest service surface another boundary genuinely needs?

This produces modules that can evolve internally without turning the dependency container into a global service locator.

## Plan a migration around one vertical slice

Avoid beginning with the largest module or replacing every decorator at once. Choose a feature with a controller, a small service graph, and limited infrastructure. A health, profile, or internal settings feature is usually a better first slice than authentication or billing.

Imagine a `UsersModule` that contains controllers, services, validation, persistence, and authentication. Move it in the following order.

### 1. Inventory the boundary

List the module's controllers, providers, exports, middleware, guards, database access, and lifecycle hooks. Mark anything coupled to Express, Fastify, NestJS discovery, or a specific ORM integration.

The result should be a dependency map, not changed code. This prevents a platform dependency from appearing halfway through the migration as a surprise.

### 2. Move application behavior first

Port services that contain business rules before the HTTP layer. Keep constructors explicit and replace framework-specific dependencies with application-level abstractions where useful.

At the end of this phase, the feature's core behavior should be testable without starting a server.

### 3. Rebuild the composition boundary

Create a `Carno` instance for the feature, register its services and controllers, and export only what the rest of the application needs. Missing registrations will surface here, before traffic reaches the module.

### 4. Adapt the HTTP edge

Move controllers, parameter decorators, validation schemas, middleware, and error translation. Test actual requests rather than relying only on unit tests.

### 5. Replace infrastructure deliberately

Choose whether to keep an existing portable database client, adopt `@carno.js/orm`, or place persistence behind a repository abstraction. Do the same for queues, schedules, logging, views, and WebSockets. These packages are modular; adopting Carno.js core does not force an all-at-once ecosystem migration.

### 6. Verify lifecycle and failure behavior

Test startup with unavailable dependencies, graceful shutdown, request-scoped state, validation failures, and integration cleanup. A successful happy-path request is necessary, but it does not prove that a production service has migrated safely.

Only then choose the next vertical slice.

## Common migration mistakes

### Treating decorators as registration

A decorated class that is absent from `.services()` or `.controllers()` is not part of the active application graph. Keep registration close to the module that owns the class.

### Carrying framework-specific abstractions into the domain

If business services depend directly on NestJS helpers, Express objects, or transport-specific exceptions, extract the business decision from the delivery mechanism before moving it.

### Migrating the ORM at the same time by default

The Carno.js ORM is optional. Replacing persistence and the HTTP framework in one step increases the number of moving parts. Migrate both together only when the feature boundary is small and the benefit is clear.

### Ignoring service scope

Review mutable singleton fields and every dependency that represents a current request, user, or tenant. Scope bugs are difficult to see in local happy-path testing and expensive to discover under concurrent traffic.

### Expecting package compatibility from TypeScript compatibility

A package being written in TypeScript does not make it runtime-neutral. Inspect whether it relies on Node HTTP APIs, Express middleware contracts, NestJS metadata, or process-level behavior that differs under Bun.

## Is Carno.js the right move?

Carno.js is strongest when Bun is a deliberate platform decision and the team wants explicit application architecture, constructor injection, lifecycle coordination, and modular first-party capabilities.

Staying with NestJS can be the better engineering choice when the application depends heavily on its mature ecosystem, must preserve Express or Fastify integrations, or has no meaningful reason to change its runtime. Familiar concepts make evaluation easier; they do not remove migration cost.

| Carno.js is a strong candidate when… | Keeping NestJS is reasonable when… |
| :--- | :--- |
| Bun-native execution is a product requirement | Existing Node integrations are business-critical |
| Explicit composition fits the team's architecture | The current application is stable and runtime change adds little value |
| First-party ORM, queues, schedules, or WebSockets reduce integration work | Required ecosystem packages have no Bun-native equivalent |
| The migration can proceed feature by feature | The system cannot be divided into safe migration boundaries |

The goal of this guide is not to make Carno.js look like NestJS. It is to help you use knowledge you already have while recognizing where a new runtime and application model require new decisions.

## Server-rendered views

NestJS often renders templates with `@Render('name')` on a controller method. Carno.js v1 does not ship that decorator. Install `@carno.js/views`, register `CarnoViews({ engine: 'handlebars' })` (or `ejs` / `pug` / a custom `ViewEngine`), inject `ViewService`, and return `views.html(name, data)` or `views.respond(ctx, name, data)`.

Content negotiation is explicit on `respond()`: `text/html` renders the template, `application/json` returns `Response.json(data)`, and a missing or `*/*` Accept header uses HTML by default. When Accept refuses both HTML and JSON (`q=0`), `respond()` returns `406 Not Acceptable`.

## Continue with Carno.js

1. Follow [Installation & Setup](./installation) to start a minimal Bun application.
2. Read [Core Overview](./core/overview) to understand the request and composition model.
3. Study [Dependency Injection](./core/dependency-injection) before introducing custom providers or request scope.
4. Review [Lifecycle Events](./core/lifecycle) before moving database clients, workers, or long-lived resources.
5. Evaluate the optional [ORM](./orm/overview), [Queue](./queue/overview), [Schedule](./schedule/overview), and [Views](./views/overview) packages independently. There is no `@Render()` equivalent: inject `ViewService` and call `html()` or `respond()`.
