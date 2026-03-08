import {describe, expect, test} from 'bun:test';
import {withDatabase, DatabaseTestContext} from '../../src/testing';
import {BaseEntity} from '../../src/domain/base-entity';
import {Entity} from '../../src/decorators/entity.decorator';
import {ManyToOne} from '../../src/decorators/one-many.decorator';
import {Property} from '../../src/decorators/property.decorator';
import {PrimaryKey} from '../../src/decorators/primary-key.decorator';
import {Repository} from '../../src/repository/Repository';

const USER_TABLE = `
  CREATE TABLE "user" (
    "id" SERIAL PRIMARY KEY,
    "first_name" VARCHAR(255) NOT NULL,
    "last_name" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
  );
`;

const REPOSITORY_ROLE_TABLE = `
  CREATE TABLE "repository_role" (
    "id" SERIAL PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL
  );
`;

const REPOSITORY_MEMBER_TABLE = `
  CREATE TABLE "repository_member" (
    "id" SERIAL PRIMARY KEY,
    "role_id" INTEGER NOT NULL REFERENCES "repository_role" ("id"),
    "name" VARCHAR(255) NOT NULL
  );
`;

@Entity()
class User extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  firstName: string;

  @Property()
  lastName: string;

  @Property()
  isActive: boolean;

  @Property()
  createdAt: Date;
}

class UserRepository extends Repository<User> {
  constructor() {
    super(User);
  }
}

@Entity({ tableName: 'repository_role' })
class RepositoryRole {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;
}

@Entity({ tableName: 'repository_member' })
class RepositoryMember {
  @PrimaryKey()
  id: number;

  @Property()
  roleId: number;

  @Property()
  name: string;

  @ManyToOne(() => RepositoryRole)
  role: RepositoryRole;
}

class RepositoryRoleRepository extends Repository<RepositoryRole> {
  constructor() {
    super(RepositoryRole);
  }
}

class RepositoryMemberRepository extends Repository<RepositoryMember> {
  constructor() {
    super(RepositoryMember);
  }
}

describe('withDatabase with Repository and camelCase properties', () => {
  test('should convert camelCase to snake_case when creating user', async () => {
    await withDatabase(
      [USER_TABLE],
      async (context) => {
        // Given
        const repository = new UserRepository();
        const userData = {
          firstName: 'John',
          lastName: 'Doe',
          isActive: true,
          createdAt: new Date('2024-01-01'),
        };

        // When
        const user = await repository.create(userData);

        // Then
        expect(user).toBeDefined();
        expect(user.firstName).toBe('John');
        expect(user.lastName).toBe('Doe');
        expect(user.isActive).toBe(true);
      },
      {
        entityFile: 'packages/orm/test/testing/with-database-repository.spec.ts',
      }
    );
  });

  test('should find user by camelCase properties', async () => {
    await withDatabase(
      [USER_TABLE],
      async (context) => {
        // Given
        const repository = new UserRepository();
        await repository.create({
          firstName: 'Jane',
          lastName: 'Smith',
          isActive: true,
          createdAt: new Date('2024-01-15'),
        });

        // When
        const users = await repository.find({
          where: {isActive: true},
        });

        // Then
        expect(users).toHaveLength(1);
        expect(users[0].firstName).toBe('Jane');
        expect(users[0].isActive).toBe(true);
      },
      {
        entityFile: 'packages/orm/test/testing/with-database-repository.spec.ts',
      }
    );
  });

  test('should update user using camelCase properties', async () => {
    await withDatabase(
      [USER_TABLE],
      async (context) => {
        // Given
        const repository = new UserRepository();
        const user = await repository.create({
          firstName: 'Bob',
          lastName: 'Johnson',
          isActive: true,
          createdAt: new Date(),
        });

        // When
        user.isActive = false;
        user.firstName = 'Robert';
        await user.save();

        const updatedUser = await repository.findOne({
          where: {id: user.id},
        });

        // Then
        expect(updatedUser).toBeDefined();
        expect(updatedUser!.firstName).toBe('Robert');
        expect(updatedUser!.isActive).toBe(false);
      },
      {
        entityFile: 'packages/orm/test/testing/with-database-repository.spec.ts',
      }
    );
  });

  test('should verify snake_case columns in database', async () => {
    await withDatabase(
      [USER_TABLE],
      async (context) => {
        // Given
        await context.executeSql(`
          INSERT INTO "user" ("first_name", "last_name", "is_active", "created_at")
          VALUES ('Direct', 'Insert', true, NOW());
        `);

        // When
        const repository = new UserRepository();
        const users = await repository.find({where: {}});

        // Then
        expect(users).toHaveLength(1);
        expect(users[0].firstName).toBe('Direct');
        expect(users[0].lastName).toBe('Insert');
        expect(users[0].isActive).toBe(true);
      },
      {
        entityFile: 'packages/orm/test/testing/with-database-repository.spec.ts',
      }
    );
  });

  test('should persist ManyToOne foreign keys when repository-only entities receive related instances', async () => {
    await withDatabase(
      [REPOSITORY_ROLE_TABLE, REPOSITORY_MEMBER_TABLE],
      async (context) => {
        const roleRepository = new RepositoryRoleRepository();
        const memberRepository = new RepositoryMemberRepository();

        const role = await roleRepository.create({
          name: 'Admin',
        });

        const member = await memberRepository.create({
          name: 'Alice',
          role,
        });

        expect(member.roleId).toBe(role.id);

        const rows = await context.executeSql(`
          SELECT "role_id" FROM "repository_member" WHERE "id" = ${member.id}
        `);

        expect(rows.rows).toHaveLength(1);
        expect((rows.rows[0] as any).role_id).toBe(role.id);
      },
      {
        entityFile: 'packages/orm/test/testing/with-database-repository.spec.ts',
      }
    );
  });

  test('should update ManyToOne foreign keys when repository-only entities receive related instances', async () => {
    await withDatabase(
      [REPOSITORY_ROLE_TABLE, REPOSITORY_MEMBER_TABLE],
      async (context) => {
        const roleRepository = new RepositoryRoleRepository();
        const memberRepository = new RepositoryMemberRepository();

        const adminRole = await roleRepository.create({
          name: 'Admin',
        });
        const editorRole = await roleRepository.create({
          name: 'Editor',
        });

        const member = await memberRepository.create({
          name: 'Alice',
          roleId: adminRole.id,
        });

        await memberRepository.updateById(member.id, {
          role: editorRole,
        });

        const rows = await context.executeSql(`
          SELECT "role_id" FROM "repository_member" WHERE "id" = ${member.id}
        `);

        expect(rows.rows).toHaveLength(1);
        expect((rows.rows[0] as any).role_id).toBe(editorRole.id);
      },
      {
        entityFile: 'packages/orm/test/testing/with-database-repository.spec.ts',
      }
    );
  });
});
