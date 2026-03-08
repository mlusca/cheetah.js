import { describe, expect, test } from 'bun:test';
import { withDatabase } from '../../src/testing';
import { BaseEntity } from '../../src/domain/base-entity';
import { Entity } from '../../src/decorators/entity.decorator';
import { Property } from '../../src/decorators/property.decorator';
import { PrimaryKey } from '../../src/decorators/primary-key.decorator';
import { Repository } from '../../src/repository/Repository';

const USER_TABLE = `
  CREATE TABLE "test_user" (
    "id" SERIAL PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL
  );
`;

const ORDER_TABLE = `
  CREATE TABLE "test_order" (
    "id" SERIAL PRIMARY KEY,
    "user_id" INTEGER NOT NULL,
    "total" NUMERIC(10,2) NOT NULL
  );
`;

const REPOSITORY_USER_TABLE = `
  CREATE TABLE "repository_user" (
    "id" SERIAL PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL
  );
`;

@Entity({ tableName: 'test_user' })
class TestUser extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;

  @Property()
  email: string;
}

@Entity({ tableName: 'test_order' })
class TestOrder extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  userId: number;

  @Property()
  total: number;
}

@Entity({ tableName: 'repository_user' })
class RepositoryUser {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;

  @Property()
  email: string;
}

class RepositoryUserRepository extends Repository<RepositoryUser> {
  constructor() {
    super(RepositoryUser);
  }
}

describe('Transaction System', () => {
  test('Given - Active Record com Entity.save dentro de transação / When - Executar save / Then - Deve usar contexto transacional', async () => {
    await withDatabase(
      [USER_TABLE],
      async (context) => {
        // Given
        const user = new TestUser();
        user.id = 1;
        user.name = 'John';
        user.email = 'john@test.com';

        // When
        await context.orm.transaction(async (tx) => {
          await user.save();
        });

        // Then
        const saved = await context.executeSql('SELECT * FROM "test_user" WHERE id = 1');
        expect(saved.rows).toHaveLength(1);
        expect(saved.rows[0].name).toBe('John');
        expect(saved.rows[0].email).toBe('john@test.com');
      },
      {
        entityFile: 'packages/orm/test/transaction/transaction.spec.ts',
      }
    );
  });

  test('Given - Active Record com múltiplas operações em transação / When - Uma falha / Then - Todas devem fazer rollback', async () => {
    await withDatabase(
      [USER_TABLE],
      async (context) => {
        // Given
        const user1 = new TestUser();
        user1.id = 1;
        user1.name = 'User 1';
        user1.email = 'user1@test.com';

        // When / Then
        try {
          await context.orm.transaction(async (tx) => {
            await user1.save(); // Sucesso
            throw new Error('Simulated error'); // Forced error
          });

          // Should not reach here
          expect(true).toBe(false);
        } catch (error: any) {
          expect(error.message).toBe('Simulated error');
        }

        // Then - Verify the user was NOT saved (rollback)
        const result = await context.executeSql('SELECT * FROM "test_user" WHERE id = 1');
        expect(result.rows).toHaveLength(0);
      },
      {
        entityFile: 'packages/orm/test/transaction/transaction.spec.ts',
      }
    );
  });

  test('Given - Active Record com Entity.save e static create na mesma transação / When - Executar ambos / Then - Devem usar mesmo contexto transacional', async () => {
    await withDatabase(
      [USER_TABLE],
      async (context) => {
        // Given
        const user1 = new TestUser();
        user1.id = 1;
        user1.name = 'John';
        user1.email = 'john@test.com';

        // When
        await context.orm.transaction(async (tx) => {
          await user1.save(); // Usando instance method
          await TestUser.create({ id: 2, name: 'Jane', email: 'jane@test.com' }); // Usando static method
        });

        // Then
        const users = await context.executeSql('SELECT * FROM "test_user" ORDER BY id');
        expect(users.rows).toHaveLength(2);
        expect(users.rows[0].name).toBe('John');
        expect(users.rows[1].name).toBe('Jane');
      },
      {
        entityFile: 'packages/orm/test/transaction/transaction.spec.ts',
      }
    );
  });

  test('Given - Repository com entidade plain dentro de transação / When - Criar e buscar no mesmo contexto / Then - Deve usar o contexto transacional', async () => {
    await withDatabase(
      [REPOSITORY_USER_TABLE],
      async (context) => {
        const repository = new RepositoryUserRepository();

        await context.orm.transaction(async () => {
          await repository.create({
            id: 1,
            name: 'Repository User',
            email: 'repository@test.com',
          });

          const created = await repository.findById(1);

          expect(created).toBeDefined();
          expect(created).toBeInstanceOf(RepositoryUser);
          expect(created?.name).toBe('Repository User');
        });

        const saved = await context.executeSql('SELECT * FROM "repository_user" WHERE id = 1');
        expect(saved.rows).toHaveLength(1);
        expect(saved.rows[0].name).toBe('Repository User');
      },
      {
        entityFile: 'packages/orm/test/transaction/transaction.spec.ts',
      }
    );
  });

  test('Given - Repository com entidade plain em transação / When - O callback falha / Then - Deve fazer rollback', async () => {
    await withDatabase(
      [REPOSITORY_USER_TABLE],
      async (context) => {
        const repository = new RepositoryUserRepository();

        try {
          await context.orm.transaction(async () => {
            await repository.create({
              id: 1,
              name: 'Repository User',
              email: 'repository@test.com',
            });

            throw new Error('Simulated repository error');
          });

          expect(true).toBe(false);
        } catch (error: any) {
          expect(error.message).toBe('Simulated repository error');
        }

        const saved = await context.executeSql('SELECT * FROM "repository_user" WHERE id = 1');
        expect(saved.rows).toHaveLength(0);
      },
      {
        entityFile: 'packages/orm/test/transaction/transaction.spec.ts',
      }
    );
  });

  test('Given - Transação bem-sucedida / When - Não houver erros / Then - Deve fazer commit automaticamente', async () => {
    await withDatabase(
      [USER_TABLE],
      async (context) => {
        // Given
        const user = new TestUser();
        user.id = 1;
        user.name = 'Test User';
        user.email = 'test@test.com';

        // When
        await context.orm.transaction(async (tx) => {
          await user.save();
        });

        // Then
        const saved = await context.executeSql('SELECT * FROM "test_user" WHERE id = 1');
        expect(saved.rows).toHaveLength(1);
        expect(saved.rows[0].name).toBe('Test User');
      },
      {
        entityFile: 'packages/orm/test/transaction/transaction.spec.ts',
      }
    );
  });

  test('Given - Múltiplas entidades em transação / When - Salvar em ordem / Then - Devem compartilhar contexto', async () => {
    await withDatabase(
      [USER_TABLE, ORDER_TABLE],
      async (context) => {
        // Given
        const user = new TestUser();
        user.id = 1;
        user.name = 'Customer';
        user.email = 'customer@test.com';

        const order = new TestOrder();
        order.id = 1;
        order.userId = 1;
        order.total = 100.50;

        // When
        await context.orm.transaction(async (tx) => {
          await user.save();
          await order.save();
        });

        // Then
        const savedUser = await context.executeSql('SELECT * FROM "test_user" WHERE id = 1');
        const savedOrder = await context.executeSql('SELECT * FROM "test_order" WHERE id = 1');

        expect(savedUser.rows).toHaveLength(1);
        expect(savedOrder.rows).toHaveLength(1);
        expect(savedOrder.rows[0].user_id).toBe(1);
      },
      {
        entityFile: 'packages/orm/test/transaction/transaction.spec.ts',
      }
    );
  });
});
