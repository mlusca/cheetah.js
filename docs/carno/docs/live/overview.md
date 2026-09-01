---
sidebar_position: 1
---

# Live resources

Live resources connect a normal Carno.js read route (`GET` or `POST`) to a
server-owned subscription. The route still works over HTTP, but a client can
also subscribe to its result over WebSocket, SSE, or conditional polling and
receive updates when the data it read changes.

The important distinction is that a live resource is not a second version of a
controller method. It is the same read operation with a lifecycle around it:

1. The server runs the handler and sends a `snapshot` to the subscriber.
2. The ORM records which tables, rows, and columns the handler read.
3. A later ORM write emits an invalidation for the affected dependency.
4. The server recomputes the handler.
5. If the result changed, the server sends a keyed patch or a replacement.

This keeps the database and the handler as the source of truth. The client does
not decide what changed and does not need broadcast code in every mutation.

## What Live resources are for

Live resources are useful when a screen should reflect server changes without
polling or manually wiring an event for every write:

- task lists and dashboards;
- counters and status panels;
- filtered collections;
- detail views that should follow one row;
- public catalogues shared by many connections;
- tenant-scoped data shared by users of the same tenant.

The feature is designed for server-owned state. Selection, focus, open dialogs,
form drafts, and other interaction state should remain local to the UI. A live
patch updates the server data; it does not replace the component's local state.

The live engine is process-local by design, with optional PostgreSQL
`LISTEN/NOTIFY` invalidation and a distributed bus for carrying invalidation
events between nodes. The exact current boundaries are listed in
[Current boundaries](#current-boundaries).

For clusters and writes made outside the application, see
[Scaling live resources](./scaling.md). For typed subscriptions and optimistic
updates, see [Typed subscriptions](./typed-client.md).

## Installation and application setup

Install the package alongside the Carno packages already used by the
application:

```bash
bun install "@carno.js/live"
```

Register `LivePlugin` once during application setup. The plugin receives the
controller classes that contain live handlers:

```ts
import { LivePlugin } from '@carno.js/live';

app.use(LivePlugin.create({
    controllers: [TasksController, NotificationsController]
}));
```

The plugin registers the live WebSocket gateway at `/live`, attaches the ORM
observer, and starts the live engine when the application's WebSocket handler
is built. A controller is not live merely because it has an `@Live()`
decorator; its class must also be included in `controllers`.

### Applications with their own gateways

Pass application gateways to the same plugin call:

```ts
app.use(LivePlugin.create({
    controllers: [TasksController],
    gateways: [ChatGateway, PresenceGateway]
}));
```

Do not register a second `WebSocketPlugin` for those gateways. The current core
keeps one WebSocket handler builder; registering another plugin can replace the
builder that serves the live gateway. `LivePlugin` combines its own gateway
with the gateway classes supplied in `gateways`.

### Scope resolution

The default scope resolver treats every WebSocket connection as its own
principal. This is a safe default, but it means that two connections from the
same user do not share a `private` instance.

Applications that authenticate the WebSocket handshake can provide a resolver:

```ts
import type { LiveScopeResolver } from '@carno.js/live';

const scopeResolver: LiveScopeResolver = {
    async resolve({ connectionId, token }) {
        const session = await sessions.verify(token);

        return {
            principal: session?.userId ?? connectionId,
            tenant: session?.tenantId
        };
    }
};

app.use(LivePlugin.create({
    controllers: [TasksController],
    scopeResolver
}));
```

The client sends `token` in the `hello` message. The token is opaque to
`@carno.js/live`; the resolver decides how to verify it and which `principal`
and `tenant` it represents. Those values are server-side scope dimensions,
not client-controlled query inputs.

## Declaring a live resource

Decorate an existing `@Get()` handler with `@Live()`:

```ts
import { Controller, Get, Query } from '@carno.js/core';
import { BaseEntity, Entity, PrimaryKey, Property } from '@carno.js/orm';
import { Live } from '@carno.js/live';

@Entity({ tableName: 'tasks' })
class Task extends BaseEntity<Task> {
    @PrimaryKey()
    id!: number;

    @Property()
    title!: string;

    @Property()
    tenant!: string;
}

@Controller('/tasks')
export class TasksController {
    @Get('/')
    @Live({ key: 'id' })
    async list(@Query('tenant') tenant: string) {
        const tasks = await Task.find(
            { tenant },
            { fields: ['id', 'title'] as any }
        );

        return tasks.map(task => ({
            id: task.id,
            title: task.title
        }));
    }
}
```

This handler now has two compatible uses:

- `GET /tasks?tenant=acme` returns the current JSON response.
- A live client subscribes to `TasksController.list` and receives the same
  data followed by patches when it changes.

The resource identifier is derived from the controller class and method name:
`TasksController.list`. Clients may use that string directly, or use the typed
route descriptors emitted by `@carno.js/client`.

### Handler rules

A live handler must be safe to execute more than once. Treat it as a read-only,
recomputable function of its declared inputs:

- `@Get()` and `@Post()` may be live. The criterion is idempotence, not the
  verb: subscribing re-runs the handler whenever the data changes, and
  re-running a write duplicates its effect. A `PUT`, `PATCH`, or `DELETE` that
  only reads is an abuse of the protocol and is rejected.
- `@Param()` and `@Query()` are the supported handler inputs on both.
- `@Param('id')` and `@Query('status')` receive one value.
- `@Param()` and `@Query()` receive the complete parameter or query object.
- `@Body()` is a first-class input on a live `@Post()`, for the read whose
  filters do not fit in a query string. It is part of the instance identity, so
  two clients posting different filters get two instances and never share data.
  `@Body()` on a live `@Get()` is rejected: a `GET` subscription carries none.
- `@Req()`, `@Ctx()`, `@Header()`, and `@Locals()` are rejected because those
  request-specific values are not available when the server recomputes a
  resource after an invalidation.
- The handler must not write to the database or perform an irreversible side
  effect. A write through the Carno ORM during a live compute raises
  `WriteDuringComputeError`.

The result should be a plain JSON-compatible value: objects, arrays, strings,
numbers, booleans, and `null`. Avoid returning `Date`, `Map`, `Set`, `BigInt`,
functions, or class instances directly. If a database entity contains a date,
map it to the string representation that the client should receive.

The result is hashed to detect whether an invalidation actually changed the
screen. A recompute whose content is equal to the previous content produces no
network message.

## Inputs and resource identity

The live protocol separates route inputs from server-side scope:

```ts
{
    params: { id: '42' },
    query: { status: 'active', tag: ['backend', 'urgent'] }
}
```

Inputs are canonicalized before they are used to identify a subscription. The
canonical form sorts object keys, preserves array order, drops `undefined`
object properties, and normalizes negative zero. This means equivalent objects
with different property insertion order map to the same instance.

The effective server identity is conceptually:

```text
resource + scope + hash(canonical(params, query))
```

The client never sends the internal instance identifier. A connection can only
choose the resource and its route inputs; the server supplies the scope. The
canonicalized input is also bounded by `maxInputBytes`, so an oversized
subscription is rejected instead of creating an unbounded instance key.

Do not use query inputs as an authorization mechanism. Inputs are untrusted in
the same way as HTTP query strings. Authentication and tenant identity belong
in the handshake and the `LiveScopeResolver`.

## Sharing and isolation

`shared` controls which connections may reuse one computed instance:

| Value | Instance boundary | Use it for |
| --- | --- | --- |
| `private` (default) | One instance per resolved principal | User-specific data |
| `tenant` | One instance per resolved tenant | Tenant dashboards and shared tenant data |
| `public` | One instance for the whole process | Data that is genuinely public |

For example:

```ts
@Get('/:id')
@Live({ shared: 'private' })
get(@Param('id') id: string) {
    return this.orders.findForCurrentUser(id);
}
```

The default `ConnectionScopeResolver` uses the connection ID as the principal,
so the default is private even when no authentication integration has been
configured. A custom resolver is required for `tenant` resources; if it does
not return a tenant, the subscription fails rather than falling back to a
shared bucket.

Sharing is an optimization, not an authorization policy. A `public` resource
must return the same authorized content for every connection that can receive
it. Do not mark user-specific or permission-sensitive data as public.

## How invalidation works

The live engine does not compare every subscription against every write. Each
compute records dependencies, and each write emits invalidation keys. The
dependency graph matches exact keys and their table ancestors.

### Automatic ORM invalidation

Reads and writes made through `@carno.js/orm` are observed automatically:

- a row lookup can register `orm:tasks#42`;
- a collection read registers `orm:tasks` when individual rows cannot be
  proven safely;
- `UPDATE tasks WHERE id = 42` emits `orm:tasks#42`;
- a bulk or non-primary-key write emits `orm:tasks`;
- inserts with known primary keys emit row keys;
- joined reads register a dependency for every joined table.

The row key has the table key as an ancestor. Therefore a write to
`orm:tasks#42` wakes both a detail resource that depends on row 42 and a list
resource that depends on the whole `tasks` table.

The graph also tracks columns when the ORM can provide an exact column list.
For the example above, a resource that selects only `id` and `title` does not
recompute when another request updates only `touched_at`. If a query uses a
wildcard or an expression whose columns cannot be determined, the dependency
becomes a column wildcard and may recompute more broadly.

The `maxKeysPerRead` setting prevents a query that reads many individually
identifiable rows from creating an oversized graph entry. Once the limit is
exceeded, the read safely falls back to its table key. This can cost more
recomputation, but it does not miss an update.

### Manual invalidation

Use `LiveService` for data sources that the ORM cannot observe, such as a
rebuilt report, webhook, external cache, or third-party API:

```ts
import { Service } from '@carno.js/core';
import { LiveService } from '@carno.js/live';

@Service()
export class ReportJob {
    constructor(private readonly live: LiveService) {}

    async rebuild() {
        await this.rebuildReport();
        this.live.invalidate('app:reports:current');
    }
}
```

Declare the same key on the resource so every instance created by that
resource depends on it:

```ts
@Get('/current')
@Live({ dependsOn: ['app:reports:current'] })
currentReport() {
    return this.reportStore.current();
}
```

For ORM-shaped manual keys, the package also exports `tableKey()` and
`rowKey()`:

```ts
import { rowKey, tableKey } from '@carno.js/live';

this.live.invalidate(tableKey('tasks'));
this.live.invalidate(rowKey('tasks', taskId));
```

`dependsOn` is especially important for direct driver calls. SQL executed
outside the ORM `SqlBuilder` does not produce a statement event, so the live
engine cannot infer its table or columns. Declare an explicit dependency for
that data source.

### Timing and transactions

Invalidations are coalesced for `coalesceMs` milliseconds. Several writes in
one short window normally become one recompute per affected instance.

The application emitter records a write after its SQL statement succeeds. When
the write belongs to an ORM transaction, the statement is queued until the
driver confirms the transaction's commit. A rollback discards the queued
invalidation, so clients never receive a patch for data that was not committed.
Writes outside a transaction remain immediate.

## Keyed updates and patches

Set `key` to a stable, unique field on the items of a returned collection:

```ts
@Live({ key: 'id' })
```

When the result changes, the patch engine can represent a collection update as
small operations:

- `upsert` inserts or replaces one keyed row;
- `remove` removes one keyed row;
- `order` describes the final order of the keys;
- `set` replaces a value at a path;
- `unset` removes an object property.

For example, inserting a new task at the beginning of a list is represented by
an `upsert` and an `order`, rather than replacing the entire array. The React
component should use the same stable key:

```tsx
{data?.map(task => (
    <TaskRow key={task.id} task={task} />
))}
```

This lets React preserve the identity of untouched rows, including focus and
local row state, while the changed row is replaced. The patch engine also uses
structural sharing: containers on the changed path are copied, while untouched
objects and rows retain their references.

If `key` is omitted, or if a returned item does not contain a string or number
at that key, the engine falls back to a whole-array `set`. A key should be
stable across recomputes and unique within the array; it should normally be the
database primary key.

## React client

The framework-agnostic client lives in `@carno.js/live/client`. The React
adapter in `@carno.js/live/react` wraps it with `useSyncExternalStore`.

Create one `LiveClient` for the application and provide it near the root of
the React tree:

```tsx
import { LiveClient } from '@carno.js/live/client';
import { LiveProvider, useLive } from '@carno.js/live/react';

const liveClient = new LiveClient({
    url: 'ws://localhost:3000/live',
    token: authToken
});

function TaskList() {
    const { data, pending, error, stale } = useLive<
        { id: number; title: string }[]
    >('TasksController.list', {
        query: { tenant: 'acme' }
    });

    if (pending) {
        return <p>Loading tasks...</p>;
    }

    if (error) {
        return <p role="alert">Unable to subscribe: {error}</p>;
    }

    return (
        <section data-stale={stale || undefined}>
            {stale && <p>Showing the last confirmed data.</p>}
            {data?.map(task => (
                <TaskRow key={task.id} task={task} />
            ))}
        </section>
    );
}

function App() {
    return (
        <LiveProvider client={liveClient}>
            <TaskList />
        </LiveProvider>
    );
}
```

`useLive` receives the resource identifier or a typed descriptor and the same
`params`/`query` shape used by the server. A string resource can use a generic
type supplied by the caller; a generated descriptor carries the handler's
input and response types.

### The `LiveState` value

Every store exposes the following state:

| Field | Meaning |
| --- | --- |
| `data` | The latest confirmed server value, or `undefined` before the first value |
| `pending` | No snapshot or `current` response has completed yet |
| `error` | The server rejected the subscription, or `null` when there is no error |
| `stale` | The last recompute failed; the client keeps displaying the previous data |

When a patch does not change a particular row, that row keeps its object
reference. This is useful with `React.memo` and avoids rerendering unaffected
parts of a list.

### Local state remains local

Live data and interaction state can be used together normally:

```tsx
function TaskList() {
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const { data } = useLive<Task[]>('TasksController.list', {
        query: { tenant: 'acme' }
    });

    return data?.map(task => (
        <button
            key={task.id}
            onClick={() => setSelectedId(task.id)}
            aria-pressed={selectedId === task.id}
        >
            {task.title}
        </button>
    ));
}
```

Selecting a row does not travel to the server, and a server patch does not
reset `selectedId`. Only the handler's returned value is synchronized.

### Reference counting and cleanup

`LiveClient.store()` deduplicates stores by resource and canonical inputs. The
React adapter retains the store while a component is subscribed and releases
it on unmount. When the reference count reaches zero, the client waits for
`unsubGraceMs` before sending `unsub`, which prevents a quick navigation from
tearing down and recreating the same subscription.

Call `liveClient.close()` when the application is permanently disposing the
client. Closing a socket during a temporary network failure is handled by the
client's reconnect loop.

### Hydration and reconnects

The client accepts an optional `hydrate` map. A server-rendered page can place
the initial value and its content hash in that map, keyed by the resource and
canonical inputs. The first subscription then sends the hash of the value it
already displays:

```ts
import { LiveClient, storeKey } from '@carno.js/live/client';

const inputs = { params: {}, query: { tenant: 'acme' } };

const liveClient = new LiveClient({
    url: 'ws://localhost:3000/live',
    hydrate: {
        [storeKey('TasksController.list', inputs)]: {
            data: initialTasks,
            hash: initialTasksHash
        }
    }
});
```

If the server's current content has the same hash, it sends `current` without
resending the data. If the content differs, it sends a full `snapshot`.

After a disconnect, the client reconnects with exponential backoff and full
jitter, sends `hello`, and resubscribes active stores with their current hash.
The hash handshake is safe because a patch is only valid against a specific
revision, while a full snapshot can establish state on a newly connected
session. A distributed invalidation bus can notify another process, but each
process recomputes its own process-local instance and sends updates to its own
connections.

## WebSocket protocol

Applications normally use `LiveClient`, not the protocol directly. The
protocol is documented here for transport adapters and debugging.

### Client messages

| Message | Purpose |
| --- | --- |
| `hello` | Announces protocol version and optional opaque token |
| `sub` | Subscribes a client-side `sid` to a resource and its inputs; may include a content hash |
| `unsub` | Releases a `sid` |
| `resync` | Requests a fresh state after a revision gap; may include the current hash |

The server never exposes its internal instance ID. The client chooses `sid` so
one connection can address its own subscriptions without knowing how the
server shares instances.

### Server messages

| Message | Purpose |
| --- | --- |
| `snapshot` | Full state, content hash, and current revision |
| `current` | The client's hash already matches; no data body is sent |
| `patch` | Operations from revision `from` to revision `to` |
| `stale` | Recompute failed; the last client value remains visible but is marked stale |
| `error` | The resource or subscription is invalid, unauthorized, or over a configured limit |

Revisions are monotonic within a live instance. If the client receives a patch
whose `from` revision is not its current revision, it requests `resync` rather
than applying a patch to an unknown base. A snapshot is also used when socket
backpressure becomes excessive, so pending patch traffic cannot grow without
bound.

The content hash is an equality and hydration mechanism, not an authorization
or integrity signature. Authorization remains the responsibility of the
application's handshake and scope resolver.

## Configuration

Pass partial overrides to `LivePlugin.create({ config })`:

```ts
app.use(LivePlugin.create({
    controllers: [TasksController],
    config: {
        coalesceMs: 25,
        maxInstancesPerConnection: 100
    }
}));
```

The defaults are starting points for a single process. Measure recompute cost,
fan-out, patch size, and connection counts before changing them in production.

| Option | Default | What it controls |
| --- | ---: | --- |
| `coalesceMs` | `16` | Time window for grouping invalidations before recomputing |
| `maxKeysPerRead` | `64` | Maximum row keys recorded by one read before falling back to its table key |
| `maxInputBytes` | `8192` | Maximum UTF-8 size of canonicalized subscription inputs |
| `unsubGraceMs` | `5000` | Delay before an unused server instance is dropped |
| `maxPendingPatches` | `32` | Consecutive backpressured sends before sending a snapshot |
| `fanoutQueueThreshold` | `500` | Number of instances processed in one recompute slice before yielding |
| `maxInstancesPerConnection` | `64` | Maximum live instances held by one connection |
| `maxInstancesPerNode` | `50000` | Maximum live instances held by the process |

The client has separate reconnect settings:

```ts
const liveClient = new LiveClient({
    url: 'ws://localhost:3000/live',
    reconnect: {
        initialMs: 250,
        maxMs: 30_000
    }
});
```

The client applies full jitter between the initial delay and the current
exponential ceiling. This matters during deploys, when many browsers can lose
their sockets at once.

## Validation and troubleshooting

Live resources are validated when the plugin registers their controllers. A
bad declaration fails startup rather than waiting for the first user to
subscribe. Common validation errors are:

- `@Live()` on anything other than `@Get()` or `@Post()`;
- use of `@Body()` on a `@Get()`;
- use of `@Req()`, `@Ctx()`, `@Header()`, or `@Locals()`;
- an empty `key` value;
- duplicate resource identifiers.

When a subscription fails at runtime, inspect the `error` message and code
sent for its `sid`. Typical causes are an unknown resource, a missing tenant or
principal for the selected sharing mode, oversized inputs, or a process at its
configured instance limit.

The code `forbidden` means a `LiveAuthorizer` refused this connection. The
decision is taken when the subscription is created and re-taken whenever
`LiveService.invalidate('auth:principal#<id>')` fires, so revoking access ends
that connection's subscriptions without disturbing the other subscribers of a
shared instance.

### No `snapshot` arrives

Check the following in order:

1. The controller class is in `LivePlugin.create({ controllers })`.
2. The resource string matches `ControllerClass.methodName`, for example
   `TasksController.list`.
3. The client is connected to `/live`, not to an application gateway path.
4. The client sent `hello` before `sub` when using the raw protocol.
5. The handler's route is a `GET` and uses only supported parameters.

### A write does not update a resource

Confirm that the write went through the Carno ORM. Direct driver SQL and
external writers are not visible to the in-process `AppEmitter`; add a matching
`dependsOn` key and call `LiveService.invalidate()` when that source changes.
Also check whether the resource selected the changed column. A dependency with
an exact column list intentionally ignores writes to unrelated columns.

### The client receives `current` instead of data

This is expected when the client's content hash matches the server's current
hash. `current` confirms that the hydrated or previously displayed data is
still correct and intentionally has no data body.

### The client is marked stale

`stale` means a recompute failed after the client already had valid data. The
client keeps showing that last value so the UI can degrade visibly instead of
silently presenting a potentially old value as current. Fix the underlying
handler or data-source error; a later invalidation can make the resource
current again.

## Current boundaries

The following boundaries are intentional:

- `@Get()` and `@Post()` handlers may be live. The conditional-polling fallback
  is limited to live `GET` routes;
- ORM writes are observed automatically. Direct SQL, external APIs, Redis,
  files, and other non-ORM sources require explicit invalidation;
- PostgreSQL notification and distributed-bus integrations carry invalidation
  events, but instances and dependency graphs remain local to each process;
- the client core supports React, Angular, Vue, and vanilla adapters; none of
  them owns the DOM or component-local state;
- server-rendered islands, SSE, conditional polling, and generated route
  descriptors are available, with their requirements documented in the linked
  guides;
- a reconnect can recover state through a hash or snapshot, but a process does
  not share its in-memory instance cache with another process.

## Public API reference

### `LiveOptions`

```ts
interface LiveOptions {
    key?: string;
    shared?: 'private' | 'tenant' | 'public';
    dependsOn?: string[];
}
```

| Option | Description |
| --- | --- |
| `key` | Stable property used to produce keyed collection patches |
| `shared` | Scope bucket used to share the computed instance; defaults to `private` |
| `dependsOn` | Additional invalidation keys for data the ORM cannot observe |

### `LivePluginOptions`

| Option | Required | Description |
| --- | --- | --- |
| `controllers` | Yes | Controller classes containing `@Live()` handlers |
| `gateways` | No | Application gateway classes combined with the live gateway |
| `scopeResolver` | No | Resolves principal and tenant from a WebSocket handshake |
| `config` | No | Partial `LiveConfig` overrides |
| `websocket` | No | Configuration forwarded to `WebSocketPlugin` |

### Useful exports

The server entry point exports `Live`, `LivePlugin`, `LiveService`, the scope
resolver types, configuration helpers, invalidation key helpers, protocol
types, and `PatchEngine`. The client entry point exports `LiveClient`,
`LiveStore`, `LiveState`, `storeKey`, and the socket seam used by custom
transports. The React entry point exports `LiveProvider` and `useLive`.

## Testing a live resource

The package's acceptance tests exercise the full path with a real database and
a real WebSocket: an ORM write reaches a subscriber without broadcast code,
keyed patches are emitted, unrelated columns do not produce a patch, the hash
handshake returns `current`, the same route still answers HTTP JSON, and
different tenant inputs remain isolated.

For an application-level smoke test, keep one browser subscribed to the route,
make a write through the ORM in another request, and verify both the network
message and the rendered row. Then repeat the test with a write to a column the
resource does not select; there should be no patch.
