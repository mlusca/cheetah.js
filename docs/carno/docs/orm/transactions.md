---
sidebar_position: 5
---

# Transactions

Transactions let you execute a group of database operations as one atomic unit. If every operation succeeds, the transaction is committed. If any operation throws, the transaction is rolled back and none of the changes are persisted.

Use transactions when the correctness of one write depends on another write:

- Creating an order and reserving stock.
- Moving balance between two accounts.
- Creating a user and its audit log.
- Updating a parent row and several child rows together.
- Running a multi-step workflow where partial persistence would corrupt state.

## Manual Transactions

Inject the `Orm` service and use `transaction()`.

```ts
import { Service } from '@carno.js/core';
import { Orm } from '@carno.js/orm';
import { UserRepository } from './user.repository';
import { AuditRepository } from './audit.repository';

@Service()
export class UserService {
  constructor(
    private orm: Orm,
    private users: UserRepository,
    private audits: AuditRepository,
  ) {}

  async activateUser(userId: number) {
    return this.orm.transaction(async () => {
      const user = await this.users.findByIdOrFail(userId);

      await this.users.updateById(user.id, { status: 'ACTIVE' });
      await this.audits.create({
        action: 'USER_ACTIVATED',
        userId: user.id,
      });

      return user;
    });
  }
}
```

Repository and Active Record methods automatically detect the running transaction context. You do not need to pass the transaction object into every repository call.

## Rollback Behavior

Throwing from the callback rolls back the transaction.

```ts
await orm.transaction(async () => {
  await orders.create({ id: 1, status: 'PAID' });

  throw new Error('Payment provider confirmation failed');
});

// The order insert is rolled back.
```

Catch errors outside the transaction when you want to translate them into HTTP responses or domain-specific errors.

```ts
try {
  await this.orm.transaction(async () => {
    await this.reserveStock(order);
    await this.chargeCard(order);
  });
} catch (error) {
  // Nothing inside the transaction was committed.
  throw error;
}
```

Avoid swallowing errors inside the transaction callback unless you intentionally want the transaction to continue and commit.

## Nested Transactions

Carno ORM reuses the current transaction context when `transaction()` is called while another transaction is already active.

```ts
await orm.transaction(async () => {
  await users.updateById(1, { status: 'ACTIVE' });

  await orm.transaction(async () => {
    await audits.create({ action: 'NESTED_CALL', userId: 1 });
  });
});
```

The inner call does not open an independent database transaction. If the inner operation throws, the error bubbles out and the outer transaction rolls back.

## Declarative Transactions

Use `@Transactional()` when a whole service method should run inside a transaction.

```ts
import { Service } from '@carno.js/core';
import { Transactional } from '@carno.js/orm';
import { UserRepository } from './user.repository';
import { AuditRepository } from './audit.repository';

@Service()
export class UserRegistrationService {
  constructor(
    private users: UserRepository,
    private audits: AuditRepository,
  ) {}

  @Transactional()
  async registerUser(name: string, email: string) {
    const user = await this.users.create({ name, email });

    await this.audits.create({
      action: 'USER_REGISTERED',
      userId: user.id,
    });

    return user;
  }
}
```

If the method resolves, the transaction commits. If the method throws, it rolls back.

`@Transactional()` supports both legacy TypeScript decorators and TS5 Stage 3 method decorators.

## Propagation With Decorators

Nested `@Transactional()` methods reuse the same active transaction.

```ts
import { Service } from '@carno.js/core';
import { Transactional } from '@carno.js/orm';

@Service()
export class UserService {
  constructor(private users: UserRepository) {}

  @Transactional()
  async updateStatus(userId: number, status: string) {
    await this.users.updateById(userId, { status });
  }
}

@Service()
export class SystemService {
  constructor(
    private users: UserService,
    private audits: AuditRepository,
  ) {}

  @Transactional()
  async processSystemAction(userId: number) {
    await this.users.updateStatus(userId, 'ACTIVE');

    await this.audits.create({
      action: 'ACTIVATE_USER',
      userId,
    });
  }
}
```

`processSystemAction()` opens the transaction. `updateStatus()` joins it. If the audit insert fails, the status update is rolled back too.

## Choosing Manual vs Declarative

Use manual transactions when:

- The transaction boundary is conditional.
- You want to return a value from a small inline workflow.
- You need the transaction boundary to be obvious at the call site.
- You are composing several lower-level operations in one method.

Use `@Transactional()` when:

- The whole method is naturally one unit of work.
- Multiple callers should always get the same transactional behavior.
- You want service code to stay focused on business operations.

Both styles use the same underlying transaction context.

## Transactions and Session

`Session.flush()` opens a transaction automatically. If it is called inside an existing transaction, it joins that transaction instead.

```ts
await orm.transaction(async () => {
  await withSession(async (session) => {
    session.queueInsert(User, { id: 1, name: 'Alice' });
    session.queueInsert(Profile, { id: 1, userId: 1 });
  });
});
```

Use [Session](./session) when you want to queue many operations across entity types and commit them in dependency-safe order. Use direct transactions when you want explicit step-by-step control.

## Practical Guidelines

- Keep transactions short. Do not wait for slow external APIs while holding a database transaction open unless it is unavoidable.
- Put all dependent writes inside the transaction boundary.
- Let errors bubble out when the operation should roll back.
- Prefer repository methods or Active Record methods inside the transaction; they already use the active context.
- Do not expect nested `transaction()` calls to commit independently.

## See Also

- [Session](./session) for Unit of Work batching.
- [Repository](./repository) for standard read and write methods.
- [Optimistic Locking](./optimistic-locking) for concurrent update protection.
