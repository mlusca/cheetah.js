---
sidebar_position: 6
---

# Identity Map

An Identity Map keeps one in-memory object instance per entity identity inside a scope. If the same row is materialized more than once in that scope, the ORM can reuse the same object instead of creating competing copies of the same database record.

The pattern matters because application code often passes entities through services, hooks and relation loading. Without an Identity Map, two queries for `User#1` can produce two separate `User` objects. Mutating one object would not affect the other, even though both represent the same database row.

With an Identity Map, both reads can point to the same object:

```ts
const first = await users.findByIdOrFail(1);
const second = await users.findByIdOrFail(1);

console.log(first === second); // true, when both run in the same identity map context
```

## What It Solves

Identity Map is about object consistency, not only performance.

- It prevents duplicate in-memory instances for the same row in one request or workflow.
- It keeps relation graphs coherent when the same entity is reached through different paths.
- It preserves local changes when a cached instance is encountered again during hydration.
- It can avoid redundant materialization work for repeated reads of the same primary key.

It does not replace database transactions, cache invalidation or optimistic locking. It only controls object identity inside an application scope.

## Request Scope

Carno ORM uses `AsyncLocalStorage` to hold the current Identity Map.

Each call to `identityMapContext.run()` creates a new map for that async execution path. Concurrent requests get isolated maps, so one request cannot see another request's entity instances.

```ts
import { identityMapContext } from '@carno.js/orm';

await identityMapContext.run(async () => {
  const a = await users.findByIdOrFail(1);
  const b = await users.findByIdOrFail(1);

  console.log(a === b); // true
});

const c = await users.findByIdOrFail(1);
// Outside the context, identity map lookup is disabled.
```

## Registering the Middleware

`CarnoOrm` exports `IdentityMapMiddleware`, but request-scoped Identity Map behavior depends on the middleware being part of the request pipeline.

Register it as a global middleware when you want each HTTP request to get its own Identity Map context:

```ts
import { Carno } from '@carno.js/core';
import { CarnoOrm, IdentityMapMiddleware } from '@carno.js/orm';

const app = new Carno()
  .use(CarnoOrm)
  .middlewares(IdentityMapMiddleware);

await app.listen(3000);
```

The middleware wraps `next()` in `identityMapContext.run()`, creating a fresh map for the request and disposing of it when the request finishes.

## How Hydration Uses It

When the ORM transforms query rows into entities, it checks the current Identity Map by entity class and primary key.

If an instance is already present:

1. The existing object is reused.
2. The ORM skips repopulating it from the row.
3. Local in-memory changes are preserved.

If no instance is present:

1. The ORM creates the entity.
2. It populates scalar properties and loaded relations.
3. It registers the instance in the current Identity Map.

This behavior applies during normal model transformation. If there is no active identity map context, the ORM simply creates objects normally.

## Example With Relations

```ts
await identityMapContext.run(async () => {
  const post = await posts.findOneOrFail(
    { id: 10 },
    { load: ['author'] },
  );

  const author = await users.findByIdOrFail(post.author.id);

  console.log(post.author === author); // true
});
```

Both paths refer to the same `User` row, so they resolve to the same `User` instance inside the context.

## Manual Access

Most application code should not need direct access, but it is available for advanced cases and tests.

```ts
import { identityMapContext } from '@carno.js/orm';

await identityMapContext.run(async () => {
  const map = identityMapContext.getIdentityMap();

  map?.set(user);
  const sameUser = map?.get(User, user.id);
});
```

The map supports `get`, `set`, `setByKey`, `has`, `remove` and `clear`.

## When To Use It

Enable Identity Map for normal HTTP request handling when:

- Services load and pass the same entities through multiple layers.
- You load relation graphs and want object references to stay consistent.
- You mutate loaded objects before saving and want later reads in the same request to see those changes.

Use `identityMapContext.run()` manually for background jobs, queue workers, tests or scripts that do not go through Carno middleware but still need one coherent unit of work.

## Boundaries and Limitations

- The scope is in-memory and per async context.
- It is not shared across requests, processes or servers.
- It is not a second-level cache.
- It does not make stale database rows fresh.
- It only works when the entity has a primary key value.
- It does not replace transactions for atomic writes.

## See Also

- [Transactions](./transactions) for atomic write boundaries.
- [Session](./session) for batching multiple writes in one transaction.
- [Relations](./relations) for relation loading behavior.
