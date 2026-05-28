---
sidebar_position: 11
---

# Read Replicas

Most production databases run with at least one replica: one primary database that accepts all writes and one or more replica databases that replicate those writes asynchronously and serve read traffic. This architecture reduces load on the primary and allows your application to scale read operations independently.

Carno ORM has built-in support for routing queries to read replicas automatically. You declare the replicas in the connection settings, and the ORM handles the rest.

## How the Routing Works

The ORM classifies every statement by type:

| Statement type | Routed to |
| :--- | :--- |
| `SELECT` | Replica (if any replicas are configured) |
| `COUNT` | Replica (if any replicas are configured) |
| `INSERT` | Primary |
| `UPDATE` | Primary |
| `DELETE` | Primary |

### Replica selection

When multiple replicas are configured, the ORM distributes read traffic using a **Round-Robin** strategy. Each SELECT or COUNT query goes to the next replica in the list, cycling back to the first after the last one is used. This spreads the read load evenly across all replicas.

### Transactions always use the primary

If a query is executed inside a `transaction()` block, it always goes to the primary — regardless of statement type. This is correct and essential: a transaction must be fully consistent, and replicas may lag behind the primary by one or more seconds. Reading from a replica inside a write transaction could cause you to read values that do not yet include the writes earlier in the same transaction.

### No replicas configured

If you do not configure any replicas, all queries go to the primary. There is no overhead.

## Configuration

Replicas are declared in the `replicas` array inside your connection settings, usually in `carno.config.ts`.

Each replica entry is a *partial* `ConnectionSettings`. Any field you omit is inherited from the primary connection settings. This means you typically only need to specify `host` and, optionally, `port`.

```typescript
import { BunPgDriver, type ConnectionSettings } from '@carno.js/orm';

const config: ConnectionSettings = {
  host: 'db-primary.internal',
  port: 5432,
  username: 'app',
  password: process.env.DB_PASSWORD,
  database: 'my_app',
  driver: BunPgDriver,
  replicas: [
    { host: 'db-replica-1.internal' },
    { host: 'db-replica-2.internal' },
  ],
};

export default config;
```

In this example, both replicas inherit `port: 5432`, `username`, `password`, and `database` from the primary. You only override `host`.

### Overriding individual replica settings

You can fully override any setting per replica. For example, if a replica uses a different port or a read-only user:

```typescript
replicas: [
  {
    host: 'db-replica-1.internal',
    port: 5433,
    username: 'readonly_user',
    password: process.env.REPLICA_PASSWORD,
  },
]
```

Fields you specify explicitly take precedence over the inherited primary settings.

## Connection Lifecycle

When `connect()` is called (which happens automatically on application startup via `OrmService`), the ORM:

1. Creates and validates the primary connection pool.
2. Iterates over the `replicas` array and creates a separate `SQL` connection pool for each replica, validating each one with a `SELECT 1`.

If a replica is unreachable at startup, `connect()` will throw, preventing the application from starting in a misconfigured state.

When `disconnect()` is called (e.g., on graceful shutdown), the ORM closes all replica pools in addition to the primary.

## Example: Application with Two Replicas

The following is a complete setup demonstrating a primary and two replicas for a PostgreSQL application:

```typescript
import { BunPgDriver, type ConnectionSettings } from '@carno.js/orm';

const config: ConnectionSettings = {
  host: 'db-primary.internal',
  port: 5432,
  username: 'myapp',
  password: process.env.DB_PASSWORD,
  database: 'production',
  driver: BunPgDriver,
  max: 20, // Connection pool size for primary
  replicas: [
    {
      host: 'db-replica-eu.internal',
      max: 10, // Smaller pool for this replica
    },
    {
      host: 'db-replica-us.internal',
      max: 10,
    },
  ],
};

export default config;
```

From this point on, `find()`, `findOne()`, `count()`, and any other read operations will be automatically distributed Round-Robin between `db-replica-eu` and `db-replica-us`. Writes go to `db-primary`.

## Interaction with Transactions

As described above, transactions are always pinned to the primary connection. This is important to understand if you mix reads and writes in the same transaction:

```typescript
await this.orm.transaction(async () => {
  // This INSERT goes to the primary
  const order = await orderRepository.create({ userId: 1, total: 99.99 });

  // This SELECT also goes to the primary (we are inside a transaction)
  const user = await userRepository.findById(order.userId);

  // This UPDATE goes to the primary
  await userRepository.update({ id: user.id }, { orderCount: user.orderCount + 1 });
});
```

If the `SELECT` above were routed to a replica, there would be a risk of the replica not yet having replicated the freshly inserted `order` row, leading to an inconsistent view. The transaction-pinning rule prevents this entirely.

Outside of transactions, reads go to replicas as usual.

## Replication Lag Considerations

All replicas in a typical async setup lag behind the primary by some amount. This is usually between a few milliseconds and a second, depending on network and load. This means a SELECT executed immediately after an INSERT may not yet see the inserted row if it is routed to a replica.

The most common pattern to handle this:

- **Writes followed by a redirect**: After a user submits a form (write), redirect them to a page that issues a read. The few milliseconds that elapse between the redirect and the next page load are usually sufficient for the replica to catch up.
- **Read your own write inside a transaction**: If you must read the data you just wrote immediately, do it within the same transaction. The transaction pins all queries to the primary, so lag is irrelevant.
- **Use primary for specific queries**: If you have a query that must absolutely return fresh data, execute it directly with `executeSql` on the ORM's driver instance — though this is seldom necessary in practice.

## Pool Size Recommendations

- **Primary**: Size the pool for write concurrency. A starting point is `max: 20`.
- **Each replica**: Can often be smaller if writes are less frequent but reads are spread across multiple replicas. `max: 10–15` per replica is a common starting point.
- **Adjust under load**: Monitor wait times and pool exhaustion metrics; tune `max`, `idleTimeout`, and `maxLifetime` accordingly.
