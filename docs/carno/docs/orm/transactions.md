---
sidebar_position: 5
---

# Transactions

Execute multiple operations within a single database transaction.

## Usage

Inject the `Orm` service and use the `.transaction()` method.

```ts
import { Service, Orm } from '@carno.js/orm';

@Service()
export class PaymentService {
  constructor(private orm: Orm) {}

  async processPayment() {
    await this.orm.transaction(async (tx) => {
      // Operations inside here share the same transaction context
      // If any error is thrown, the transaction is rolled back automatically.
      
      const user = await this.userRepository.findById(1);
      // ... modify user
      await user.save();
    });
  }
}
```

Note: The `Repository` methods automatically detect the running transaction context.

## Declarative Transactions (`@Transactional`)

Carno.js also provides a declarative way to manage transactions using the `@Transactional()` decorator. Applying this decorator to a method ensures that the entire method executes inside a transaction.

If the method completes successfully, the transaction is committed automatically. If the method throws an error, the transaction is rolled back.

### Usage

Decorate any class method (typically in services or repositories).

```ts
import { Service } from '@carno.js/core';
import { Transactional } from '@carno.js/orm';
import { UserRepository } from './UserRepository';
import { LogRepository } from './LogRepository';

@Service()
export class UserRegistrationService {
  constructor(
    private userRepo: UserRepository,
    private logRepo: LogRepository
  ) {}

  @Transactional()
  async registerUser(name: string, email: string) {
    const user = await this.userRepo.create({ name, email });
    
    // If this throws an error, the user created above will not be saved (rolled back)
    await this.logRepo.logAction('register', `User ${name} registered successfully`);
    
    return user;
  }
}
```

### Transaction Propagation

Nested `@Transactional()` calls automatically detect and reuse the existing transaction context. If an outer transaction has already started, nested methods will run within that same transaction rather than opening a new one.

If any nested operation throws an error, the entire outer transaction is rolled back.

```ts
@Service()
export class UserService {
  constructor(private userRepo: UserRepository) {}

  @Transactional()
  async updateStatus(userId: number, status: string) {
    await this.userRepo.update(userId, { status });
  }
}

@Service()
export class SystemService {
  constructor(private userService: UserService, private auditRepo: AuditRepository) {}

  @Transactional()
  async processSystemAction(userId: number) {
    // Reuses the outer transaction started here
    await this.userService.updateStatus(userId, 'ACTIVE'); 
    
    await this.auditRepo.create({ action: 'ACTIVATE_USER', userId });
  }
}
```