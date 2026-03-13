---
sidebar_position: 10
---

# Tenant Isolation

Multi-tenancy is the practice of serving multiple isolated customers (tenants) from the same application instance and database. Carno ORM supports a row-level multi-tenancy strategy: all tenants share the same tables, but every row carries a `tenant_id` column. The ORM automatically injects the correct tenant filter into every query so that tenants never see each other's data.

## The Problem It Solves

Without tenant isolation helpers, you would need to manually add `WHERE tenant_id = ?` to every query in your codebase. This is tedious, error-prone, and easy to forget. A missing `tenant_id` filter exposes data from all tenants to any single tenant.

Carno ORM centralizes this concern. You declare which column is the tenant column once, on the entity. Then you tell the ORM which tenant is active for the current request. From that point onwards, every query — reads, writes, updates, deletes — is automatically scoped to that tenant.

## The `@Tenant()` Decorator

Mark the tenant discriminator field with `@Tenant()`. It must be combined with `@Property()` so the ORM knows about the column.

```typescript
import { Entity, PrimaryKey, Property, BaseEntity } from '@carno.js/orm';
import { Tenant } from '@carno.js/orm';

@Entity()
export class Invoice extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  amount: number;

  @Property({ columnName: 'tenant_id' })
  @Tenant()
  tenantId: number;
}
```

The `@Tenant()` decorator just registers the property name in metadata. It does not change column mapping — that is still done by `@Property()`. You can use any property name and any column name; `@Tenant()` is the ORM's signal saying "this is the tenant discriminator."

### String-Based Tenant IDs

Tenant IDs can be integers or strings. A common real-world pattern is to use a short organization slug or a UUID.

```typescript
@Entity()
export class Document extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  title: string;

  @Property({ columnName: 'org_id' })
  @Tenant()
  orgId: string; // can be 'acme-corp', 'stellar-inc', etc.
}
```

## Setting the Active Tenant: `tenantContext`

The active tenant is communicated to the ORM through `tenantContext`, a singleton that uses Node's `AsyncLocalStorage` under the hood. This means the tenant scope is automatically bound to the current asynchronous execution context — it does not leak between concurrent requests.

```typescript
import { tenantContext } from '@carno.js/orm';
```

### `tenantContext.run(tenantId, callback)`

Wrap any code that should run in a specific tenant's scope inside `tenantContext.run()`. The callback receives no arguments — the context is implicit.

```typescript
await tenantContext.run('acme-corp', async () => {
  // Every query in here is automatically scoped to tenant 'acme-corp'
  const invoices = await invoiceRepository.find({ where: {} });
  // SQL: SELECT ... FROM invoice i1 WHERE i1.org_id = 'acme-corp'
});
```

### Why `AsyncLocalStorage`?

`AsyncLocalStorage` is the Node.js (and Bun) primitive for request-scoped state. When a web server handles many concurrent requests, each request can have its own tenant context without interfering with others. The scope is:

- **Set** when `run()` is called
- **Active** for the entire async call tree spawned inside the callback
- **Cleared** automatically when the callback resolves or rejects

There is no cleanup step: once the callback returns, the tenant context is gone. You cannot accidentally carry a tenant from one request to another.

## Connection with HTTP Middleware

The most common setup is a middleware that reads the tenant from the request and establishes the context before your controller runs.

```typescript
import { Middleware, Context, NextFn } from '@carno.js/core';
import { tenantContext } from '@carno.js/orm';

@Middleware()
export class TenantMiddleware {
  async handle(ctx: Context, next: NextFn) {
    // Tenant ID might come from a JWT claim, a subdomain, a header, etc.
    const tenantId = ctx.user?.organizationId ?? ctx.headers['x-tenant-id'];

    if (!tenantId) {
      return ctx.status(401);
    }

    // Wrap the rest of the request in the tenant context
    return tenantContext.run(tenantId, () => next());
  }
}
```

With this middleware in place, every repository call inside your controllers and services automatically uses the right tenant, with no further code changes.

## How Queries Are Modified

When `tenantContext` has an active tenant, the ORM applies the tenant condition differently depending on the type of operation.

### SELECT

A tenant condition is appended to the WHERE clause. If there is already a WHERE, the tenant condition is combined with it using `AND`.

```typescript
// Application code
const invoices = await invoiceRepository.find({
  where: { status: 'paid' }
});

// SQL generated
// SELECT ... FROM "invoice" i1 WHERE (i1.status = 'paid') AND i1.tenant_id = 5
```

If there is no WHERE condition in the query, the tenant condition becomes the entire WHERE:

```typescript
// Application code
const all = await invoiceRepository.find({ where: {} });

// SQL generated
// SELECT ... FROM "invoice" i1 WHERE i1.tenant_id = 5
```

### INSERT

When inserting, the ORM injects the tenant ID value into the row's values. If your application already sets the `tenantId` field manually, the context injection is skipped (the existing value is preserved). This ensures you never accidentally overwrite an explicitly set value.

```typescript
// Application code — tenantId is not explicitly set
await invoiceRepository.create({ amount: 150 });

// The ORM fills tenant_id = 5 from the context automatically
// SQL: INSERT INTO "invoice" (amount, tenant_id) VALUES (150, 5)
```

### UPDATE

The tenant condition is appended to the WHERE clause, preventing updates from crossing tenant boundaries.

```typescript
// Application code
await invoiceRepository.update({ status: 'pending' }, { status: 'overdue' });

// SQL generated
// UPDATE "invoice" as i1 SET status = 'overdue' WHERE (i1.status = 'pending') AND i1.tenant_id = 5
```

Even if someone passes a filter like `{ id: 100 }` targeting a row that belongs to a different tenant, the tenant condition in the WHERE clause will make the update a no-op for that row.

### DELETE

Works the same way as UPDATE — the tenant condition is appended to the WHERE clause.

```typescript
// Application code
await invoiceRepository.delete({ status: 'cancelled' });

// SQL generated
// DELETE FROM "invoice" AS i1 WHERE (i1.status = 'cancelled') AND i1.tenant_id = 5
```

### COUNT

The tenant condition is applied to COUNT queries as well.

```typescript
const unpaidCount = await invoiceRepository.count({ status: 'unpaid' });
// WHERE (i1.status = 'unpaid') AND i1.tenant_id = 5
```

## Queries Without Context

If no tenant context is active (i.e., you call a repository method outside of `tenantContext.run()`), the ORM does **not** inject any tenant condition. Queries return rows from all tenants.

This is the correct and safe behavior for:

- Administrative operations that need cross-tenant access
- Background jobs that aggregate data across all tenants
- Health checks or migration scripts

```typescript
// No tenantContext.run() wrapping → returns all invoices from all tenants
const allInvoices = await invoiceRepository.find({ where: {} });
```

Use this consciously. If you need to ensure that only tenant-scoped code can execute certain operations, that enforcement is the responsibility of your application's authorization layer — not the ORM.

## Checking the Active Tenant Programmatically

You can inspect the tenant context at runtime if needed:

```typescript
import { tenantContext } from '@carno.js/orm';

const currentTenant = tenantContext.getTenantId();
// returns the active tenant ID, or undefined if outside a context

const isActive = tenantContext.hasContext();
// returns true if tenantContext.run() is active in the current async context
```

## Nested Contexts

`tenantContext.run()` can be nested. Inner calls override the outer tenant for their own scope and restore the outer tenant when they complete. This is useful for admin operations that temporarily switch to a target tenant:

```typescript
await tenantContext.run('tenant-a', async () => {
  // Queries here -> tenant-a

  await tenantContext.run('tenant-b', async () => {
    // Queries here -> tenant-b (inner scope overrides)
  });

  // Queries here -> tenant-a again (outer scope is restored)
});
```

## Important Considerations

**The entity must declare `@Tenant()`.** If an entity does not have `@Tenant()`, the ORM does not add any tenant condition to its queries, even when a context is active. This is correct — not all tables need a tenant discriminator (e.g., a shared `country` or `currency` table).

**One `@Tenant()` per entity.** Declaring `@Tenant()` on multiple fields is not supported.

**Tenant column must be NOT NULL.** The ORM always injects the tenant value as an equality condition. If the column allows NULL, rows with NULL would not match and would be invisible in tenant-scoped queries even though they are valid rows.

**Migrations** — When adding multi-tenancy to an existing table, you must add the tenant column, backfill existing rows with their correct tenant ID, and then add a NOT NULL constraint. The ORM cannot do this for you.
