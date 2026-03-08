import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import { BaseEntity, Entity, ManyToOne, OneToMany, PrimaryKey, Property, Repository } from '../../src';
import { identityMapContext } from '../../src/identity-map';

describe('Identity Map Integration', () => {
  const DDL_USER = `
    CREATE TABLE "user" (
      "id" SERIAL PRIMARY KEY,
      "email" varchar(255) NOT NULL
    );
  `;

  const DDL_POST = `
    CREATE TABLE "post" (
      "id" SERIAL PRIMARY KEY,
      "title" varchar(255) NOT NULL,
      "user_id" integer REFERENCES "user" ("id")
    );
  `;

  const DDL_REPOSITORY_USER = `
    CREATE TABLE "repository_identity_user" (
      "id" SERIAL PRIMARY KEY,
      "email" varchar(255) NOT NULL
    );
  `;

  @Entity()
  class User extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    email: string;

    @OneToMany(() => Post, (post) => post.userId)
    posts: Post[];
  }

  @Entity()
  class Post extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    title: string;

    @Property()
    userId: number;

    @ManyToOne(() => User)
    user: User;
  }

  @Entity({ tableName: 'repository_identity_user' })
  class RepositoryIdentityUser {
    @PrimaryKey()
    id: number;

    @Property()
    email: string;
  }

  class RepositoryIdentityUserRepository extends Repository<RepositoryIdentityUser> {
    constructor() {
      super(RepositoryIdentityUser);
    }
  }

  beforeEach(async () => {
    await startDatabase();
    await execute(DDL_USER);
    await execute(DDL_POST);
    await execute(DDL_REPOSITORY_USER);
  });

  afterEach(async () => {
    await purgeDatabase();
    await app?.disconnect();
  });

  describe('Given an identity map context', () => {
    test('When querying same entity twice through Active Record, Then returns same instance', async () => {
      await identityMapContext.run(async () => {
        // Given
        await User.create({ id: 1, email: 'test@test.com' });

        // When
        const user1 = await User.findOne({ id: 1 });
        const user2 = await User.findOne({ id: 1 });

        // Then
        expect(user1).toBeDefined();
        expect(user2).toBeDefined();
        expect(user1).toBe(user2); // Same instance
        expect(user1 === user2).toBe(true);
      });
    });

    test('When querying same entity twice through Repository, Then returns same instance', async () => {
      await identityMapContext.run(async () => {
        const repository = new RepositoryIdentityUserRepository();
        await repository.create({ id: 1, email: 'repo@test.com' });

        const user1 = await repository.findById(1);
        const user2 = await repository.findById(1);

        expect(user1).toBeDefined();
        expect(user2).toBeDefined();
        expect(user1).toBeInstanceOf(RepositoryIdentityUser);
        expect(user1).toBe(user2);
      });
    });

    test('When querying different entities, Then returns different instances', async () => {
      await identityMapContext.run(async () => {
        // Given
        await User.create({ id: 1, email: 'user1@test.com' });
        await User.create({ id: 2, email: 'user2@test.com' });

        // When
        const user1 = await User.findOne({ id: 1 });
        const user2 = await User.findOne({ id: 2 });

        // Then
        expect(user1).toBeDefined();
        expect(user2).toBeDefined();
        expect(user1).not.toBe(user2);
        expect(user1?.email).toBe('user1@test.com');
        expect(user2?.email).toBe('user2@test.com');
      });
    });

    test('When loading relationships, Then uses cached instances', async () => {
      await identityMapContext.run(async () => {
        // Given
        const user = await User.create({ id: 1, email: 'user@test.com' });
        await Post.create({ id: 1, title: 'Post 1', userId: 1 });

        // When
        const queriedUser = await User.findOne({ id: 1 });
        const post = await Post.findOne({ id: 1 }, { load: ['user'] });

        // Then
        expect(post?.user).toBeDefined();
        expect(queriedUser).toBeDefined();
        expect(post?.user).toBe(queriedUser); // Same instance from cache
      });
    });

    test('When updating entity, Then all references reflect changes', async () => {
      await identityMapContext.run(async () => {
        // Given
        await User.create({ id: 1, email: 'original@test.com' });

        // When
        const user1 = await User.findOne({ id: 1 });
        const user2 = await User.findOne({ id: 1 });

        // Modify user1
        user1!.email = 'modified@test.com';

        // Then
        // Both references should reflect the change because they're the same instance
        expect(user2?.email).toBe('modified@test.com');
        expect(user1).toBe(user2); // Same instance
      });
    });

    test('When querying multiple entities, Then caches all of them', async () => {
      await identityMapContext.run(async () => {
        // Given
        await User.create({ id: 1, email: 'user1@test.com' });
        await User.create({ id: 2, email: 'user2@test.com' });
        await User.create({ id: 3, email: 'user3@test.com' });

        // When
        const allUsers = await User.findAll({});
        const user1 = await User.findOne({ id: 1 });
        const user2 = await User.findOne({ id: 2 });

        // Then
        expect(allUsers[0]).toBe(user1);
        expect(allUsers[1]).toBe(user2);
      });
    });

    test('When using joined loading strategy, Then caches entities', async () => {
      await identityMapContext.run(async () => {
        // Given
        await User.create({ id: 1, email: 'user@test.com' });
        await Post.create({ id: 1, title: 'Post 1', userId: 1 });

        // When
        const post = await Post.findOne(
          { id: 1 },
          { load: ['user'], loadStrategy: 'joined' }
        );
        const user = await User.findOne({ id: 1 });
        // Then
        expect(post?.user).toBe(user);
      });
    });

    test('When using select loading strategy, Then caches entities', async () => {
      await identityMapContext.run(async () => {
        // Given
        await User.create({ id: 1, email: 'user@test.com' });
        await Post.create({ id: 1, title: 'Post 1', userId: 1 });

        // When
        const post = await Post.findOne(
          { id: 1 },
          { load: ['user'], loadStrategy: 'select' }
        );
        const user = await User.findOne({ id: 1 });

        // Then
        expect(post?.user).toBe(user);
      });
    });
  });

  describe('Given no identity map context', () => {
    test('When querying same entity twice through Active Record, Then returns different instances', async () => {
      // Given
      await User.create({ id: 1, email: 'test@test.com' });

      // When
      const user1 = await User.findOne({ id: 1 });
      const user2 = await User.findOne({ id: 1 });

      // Then
      expect(user1).toBeDefined();
      expect(user2).toBeDefined();
      expect(user1).not.toBe(user2); // Different instances
      expect(user1 === user2).toBe(false);
    });

    test('When querying same entity twice through Repository, Then returns different instances', async () => {
      const repository = new RepositoryIdentityUserRepository();
      await repository.create({ id: 1, email: 'repo@test.com' });

      const user1 = await repository.findById(1);
      const user2 = await repository.findById(1);

      expect(user1).toBeDefined();
      expect(user2).toBeDefined();
      expect(user1).toBeInstanceOf(RepositoryIdentityUser);
      expect(user1).not.toBe(user2);
    });
  });

  describe('Given multiple contexts', () => {
    test('When using separate contexts, Then entities are isolated', async () => {
      // Given
      await User.create({ id: 1, email: 'test@test.com' });

      let user1: User | null = null;
      let user2: User | null = null;

      // When
      await identityMapContext.run(async () => {
        user1 = await User.findOne({ id: 1 });
      });

      await identityMapContext.run(async () => {
        user2 = await User.findOne({ id: 1 });
      });

      // Then
      expect(user1).toBeDefined();
      expect(user2).toBeDefined();
      expect(user1).not.toBe(user2); // Different contexts = different instances
    });

    test('When using same context, Then entities are shared', async () => {
      await identityMapContext.run(async () => {
        // Given
        await User.create({ id: 1, email: 'test@test.com' });

        // When
        const user1 = await User.findOne({ id: 1 });
        const user2 = await User.findOne({ id: 1 });
        
        // Then
        expect(user1).toBe(user2); // Same context = same instance
      });
    });
  });

  describe('Performance', () => {
    test('Should reduce database queries for duplicate entities', async () => {
      await identityMapContext.run(async () => {
        // Given
        await User.create({ id: 1, email: 'test@test.com' });

        // When
        const user1 = await User.findOne({ id: 1 });
        const user2 = await User.findOne({ id: 1 });
        const user3 = await User.findOne({ id: 1 });

        // Then
        // All should be the same instance (cached)
        expect(user1).toBe(user2);
        expect(user2).toBe(user3);
      });
    });
  });
});
