import { describe, expect, test } from 'bun:test';
import { withDatabase } from '../../src/testing';
import { BaseEntity } from '../../src/domain/base-entity';
import { Entity } from '../../src/decorators/entity.decorator';
import { Property } from '../../src/decorators/property.decorator';
import { PrimaryKey } from '../../src/decorators/primary-key.decorator';
import { Transactional } from '../../src/decorators/transactional.decorator';
import { transactionContext } from '../../src/transaction/transaction-context';

const USER_TABLE = `
  CREATE TABLE "transactional_test_user" (
    "id" SERIAL PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL
  );
`;

@Entity({ tableName: 'transactional_test_user' })
class TransactionalTestUser extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;
}

class UserService {
  @Transactional()
  async createUser(id: number, name: string) {
    if (!transactionContext.hasContext()) {
      throw new Error('Not in transaction context');
    }
    const user = new TransactionalTestUser();
    user.id = id;
    user.name = name;
    await user.save();
    return user;
  }

  @Transactional()
  async createUserAndThrow(id: number, name: string) {
    const user = new TransactionalTestUser();
    user.id = id;
    user.name = name;
    await user.save();
    throw new Error('Simulated transactional error');
  }

  @Transactional()
  async outerMethod(id1: number, name1: string, id2: number, name2: string) {
    const parentTx = transactionContext.getContext();
    if (!parentTx) {
      throw new Error('No transaction context in outerMethod');
    }

    await this.innerMethod(id1, name1);

    const afterInnerTx = transactionContext.getContext();
    expect(afterInnerTx).toBe(parentTx);

    const user2 = new TransactionalTestUser();
    user2.id = id2;
    user2.name = name2;
    await user2.save();
  }

  @Transactional()
  async innerMethod(id: number, name: string) {
    if (!transactionContext.hasContext()) {
      throw new Error('No transaction context in innerMethod');
    }
    const user = new TransactionalTestUser();
    user.id = id;
    user.name = name;
    await user.save();
  }

  @Transactional()
  async outerMethodWithThrow(id1: number, name1: string, id2: number, name2: string) {
    await this.innerMethod(id1, name1);
    const user2 = new TransactionalTestUser();
    user2.id = id2;
    user2.name = name2;
    await user2.save();
    throw new Error('Simulated outer error');
  }
}

describe('@Transactional decorator', () => {
  test('Given a method annotated with @Transactional() / When executed / Then it should run inside a transaction and commit successfully', async () => {
    await withDatabase(
      [USER_TABLE],
      async (context) => {
        const service = new UserService();
        await service.createUser(1, 'Alice');

        const saved = await context.executeSql('SELECT * FROM "transactional_test_user" WHERE id = 1');
        expect(saved.rows).toHaveLength(1);
        expect(saved.rows[0].name).toBe('Alice');
      },
      {
        entityFile: 'packages/orm/test/transaction/transactional.spec.ts',
      }
    );
  });

  test('Given a method annotated with @Transactional() / When an error is thrown / Then it should rollback the transaction', async () => {
    await withDatabase(
      [USER_TABLE],
      async (context) => {
        const service = new UserService();
        let threw = false;
        try {
          await service.createUserAndThrow(2, 'Bob');
        } catch (err: any) {
          expect(err.message).toBe('Simulated transactional error');
          threw = true;
        }
        expect(threw).toBe(true);

        const saved = await context.executeSql('SELECT * FROM "transactional_test_user" WHERE id = 2');
        expect(saved.rows).toHaveLength(0);
      },
      {
        entityFile: 'packages/orm/test/transaction/transactional.spec.ts',
      }
    );
  });

  test('Given nested @Transactional() methods / When executed / Then they should propagate and reuse the existing transaction context', async () => {
    await withDatabase(
      [USER_TABLE],
      async (context) => {
        const service = new UserService();
        await service.outerMethod(3, 'Charlie', 4, 'Dave');

        const saved3 = await context.executeSql('SELECT * FROM "transactional_test_user" WHERE id = 3');
        const saved4 = await context.executeSql('SELECT * FROM "transactional_test_user" WHERE id = 4');

        expect(saved3.rows).toHaveLength(1);
        expect(saved3.rows[0].name).toBe('Charlie');
        expect(saved4.rows).toHaveLength(1);
        expect(saved4.rows[0].name).toBe('Dave');
      },
      {
        entityFile: 'packages/orm/test/transaction/transactional.spec.ts',
      }
    );
  });

  test('Given nested @Transactional() methods / When outer throws an error / Then all nested operations should rollback', async () => {
    await withDatabase(
      [USER_TABLE],
      async (context) => {
        const service = new UserService();
        let threw = false;
        try {
          await service.outerMethodWithThrow(5, 'Eve', 6, 'Frank');
        } catch (err: any) {
          expect(err.message).toBe('Simulated outer error');
          threw = true;
        }
        expect(threw).toBe(true);

        const saved5 = await context.executeSql('SELECT * FROM "transactional_test_user" WHERE id = 5');
        const saved6 = await context.executeSql('SELECT * FROM "transactional_test_user" WHERE id = 6');

        expect(saved5.rows).toHaveLength(0);
        expect(saved6.rows).toHaveLength(0);
      },
      {
        entityFile: 'packages/orm/test/transaction/transactional.spec.ts',
      }
    );
  });

  test('Given a Stage 3 method decorator / When executed / Then it should wrap properly and run in transaction', async () => {
    await withDatabase(
      [USER_TABLE],
      async (context) => {
        const originalMethod = async function(this: any, id: number, name: string) {
          if (!transactionContext.hasContext()) {
            throw new Error('Not in transaction context');
          }
          const user = new TransactionalTestUser();
          user.id = id;
          user.name = name;
          await user.save();
        };

        // Call the TS5 Stage 3 decorator manually
        const decoratedMethod = Transactional()(originalMethod, {
          kind: 'method',
          name: 'testStage3',
        } as any);

        await decoratedMethod(7, 'Grace');

        const saved = await context.executeSql('SELECT * FROM "transactional_test_user" WHERE id = 7');
        expect(saved.rows).toHaveLength(1);
        expect(saved.rows[0].name).toBe('Grace');
      },
      {
        entityFile: 'packages/orm/test/transaction/transactional.spec.ts',
      }
    );
  });
});
