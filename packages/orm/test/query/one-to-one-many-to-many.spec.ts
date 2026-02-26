import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import {
  BaseEntity,
  Entity,
  OneToOne,
  ManyToMany,
  OneToMany,
  ManyToOne,
  PrimaryKey,
  Property,
  Repository,
  type Ref,
} from '../../src';

describe('OneToOne Owner Side (Profile -> User)', () => {
  const DDL_USER = `
    CREATE TABLE "oto_user" (
      "id" SERIAL PRIMARY KEY,
      "name" varchar(255) NOT NULL
    );
  `;

  const DDL_PROFILE = `
    CREATE TABLE "oto_profile" (
      "id" SERIAL PRIMARY KEY,
      "bio" varchar(255),
      "user_id" integer UNIQUE REFERENCES "oto_user" ("id")
    );
  `;

  @Entity({ tableName: 'oto_user' })
  class OwnerUser extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    name: string;
  }

  @Entity({ tableName: 'oto_profile' })
  class OwnerProfile extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property({ nullable: true })
    bio: string;

    @Property({ columnName: 'user_id' })
    userId: number;

    @OneToOne(() => OwnerUser)
    user: Ref<OwnerUser>;
  }

  class OwnerUserRepo extends Repository<OwnerUser> {
    constructor() { super(OwnerUser); }
  }

  class OwnerProfileRepo extends Repository<OwnerProfile> {
    constructor() { super(OwnerProfile); }
  }

  let userRepo: OwnerUserRepo;
  let profileRepo: OwnerProfileRepo;

  beforeEach(async () => {
    await startDatabase();
    await execute(DDL_USER);
    await execute(DDL_PROFILE);
    userRepo = new OwnerUserRepo();
    profileRepo = new OwnerProfileRepo();
  });

  afterEach(async () => {
    await purgeDatabase();
    await app?.disconnect();
  });

  test('should load one-to-one owner relationship with joined strategy', async () => {
    const user = await userRepo.create({ name: 'Alice' });
    await profileRepo.create({ bio: 'Hello', userId: user.id });

    const profile = await profileRepo.findOne({
      where: { userId: user.id },
      load: ['user'],
      loadStrategy: 'joined',
    });

    expect(profile).toBeDefined();
    expect(profile!.user).toBeDefined();
    expect(profile!.user.name).toBe('Alice');
  });

  test('should load one-to-one owner relationship with select strategy', async () => {
    const user = await userRepo.create({ name: 'Bob' });
    await profileRepo.create({ bio: 'World', userId: user.id });

    const profile = await profileRepo.findOne({
      where: { userId: user.id },
      load: ['user'],
      loadStrategy: 'select',
    });

    expect(profile).toBeDefined();
    expect(profile!.user).toBeDefined();
    expect(profile!.user.name).toBe('Bob');
  });
});

describe('OneToOne Inverse Side (User -> Profile)', () => {
  const DDL_USER = `
    CREATE TABLE "inv_user" (
      "id" SERIAL PRIMARY KEY,
      "name" varchar(255) NOT NULL
    );
  `;

  const DDL_PROFILE = `
    CREATE TABLE "inv_profile" (
      "id" SERIAL PRIMARY KEY,
      "bio" varchar(255),
      "user_id" integer UNIQUE REFERENCES "inv_user" ("id")
    );
  `;

  @Entity({ tableName: 'inv_profile' })
  class InvProfile extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property({ nullable: true })
    bio: string;

    @Property({ columnName: 'user_id' })
    userId: number;
  }

  @Entity({ tableName: 'inv_user' })
  class InvUser extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    name: string;

    @OneToOne(() => InvProfile, (profile) => profile.userId)
    profile: Ref<InvProfile>;
  }

  class InvUserRepo extends Repository<InvUser> {
    constructor() { super(InvUser); }
  }

  class InvProfileRepo extends Repository<InvProfile> {
    constructor() { super(InvProfile); }
  }

  let userRepo: InvUserRepo;
  let profileRepo: InvProfileRepo;

  beforeEach(async () => {
    await startDatabase();
    await execute(DDL_USER);
    await execute(DDL_PROFILE);
    userRepo = new InvUserRepo();
    profileRepo = new InvProfileRepo();
  });

  afterEach(async () => {
    await purgeDatabase();
    await app?.disconnect();
  });

  test('should load one-to-one inverse relationship with joined strategy', async () => {
    const user = await userRepo.create({ name: 'Charlie' });
    await profileRepo.create({ bio: 'Dev', userId: user.id });

    const found = await userRepo.findById(user.id, {
      load: ['profile'],
      loadStrategy: 'joined',
    });

    expect(found).toBeDefined();
    expect(found!.profile).toBeDefined();
    expect(found!.profile.bio).toBe('Dev');
  });

  test('should load one-to-one inverse relationship with select strategy', async () => {
    const user = await userRepo.create({ name: 'Diana' });
    await profileRepo.create({ bio: 'Designer', userId: user.id });

    const found = await userRepo.findById(user.id, {
      load: ['profile'],
      loadStrategy: 'select',
    });

    expect(found).toBeDefined();
    expect(found!.profile).toBeDefined();
    expect(found!.profile.bio).toBe('Designer');
  });

  test('should handle null one-to-one inverse relationship', async () => {
    const user = await userRepo.create({ name: 'Eve' });

    const found = await userRepo.findById(user.id, {
      load: ['profile'],
    });

    expect(found).toBeDefined();
  });
});

describe('ManyToMany Relationship', () => {
  const DDL_POST = `
    CREATE TABLE "post" (
      "id" SERIAL PRIMARY KEY,
      "title" varchar(255) NOT NULL
    );
  `;

  const DDL_TAG = `
    CREATE TABLE "tag" (
      "id" SERIAL PRIMARY KEY,
      "name" varchar(255) NOT NULL
    );
  `;

  const DDL_PIVOT = `
    CREATE TABLE "post_tag" (
      "post_id" integer REFERENCES "post" ("id"),
      "tag_id" integer REFERENCES "tag" ("id"),
      PRIMARY KEY ("post_id", "tag_id")
    );
  `;

  @Entity()
  class Post extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    title: string;

    @ManyToMany(() => Tag, {
      pivotTable: 'post_tag',
      joinColumn: 'post_id',
      inverseJoinColumn: 'tag_id',
    })
    tags: Tag[];
  }

  @Entity()
  class Tag extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    name: string;

    @ManyToMany(() => Post, {
      pivotTable: 'post_tag',
      joinColumn: 'tag_id',
      inverseJoinColumn: 'post_id',
    })
    posts: Post[];
  }

  class PostRepository extends Repository<Post> {
    constructor() {
      super(Post);
    }
  }

  class TagRepository extends Repository<Tag> {
    constructor() {
      super(Tag);
    }
  }

  let postRepo: PostRepository;
  let tagRepo: TagRepository;

  beforeEach(async () => {
    await startDatabase();
    await execute(DDL_POST);
    await execute(DDL_TAG);
    await execute(DDL_PIVOT);
    postRepo = new PostRepository();
    tagRepo = new TagRepository();
  });

  afterEach(async () => {
    await purgeDatabase();
    await app?.disconnect();
  });

  async function createPostWithTags(title: string, tagNames: string[]) {
    const post = await postRepo.create({ title });
    const tags: any[] = [];

    for (const name of tagNames) {
      const tag = await tagRepo.create({ name });
      tags.push(tag);
      await execute(`INSERT INTO "post_tag" ("post_id", "tag_id") VALUES (${post.id}, ${tag.id})`);
    }

    return { post, tags };
  }

  describe('Joined Strategy', () => {
    test('should load many-to-many relationship from owner side', async () => {
      const { post } = await createPostWithTags('My Post', ['TypeScript', 'ORM']);

      const found = await postRepo.findById(post.id, {
        load: ['tags'],
        loadStrategy: 'joined',
      });

      expect(found).toBeDefined();
      expect(found!.tags).toBeDefined();
      expect(found!.tags.length).toBe(2);
      expect(found!.tags.map(t => t.name).sort()).toEqual(['ORM', 'TypeScript']);
    });

    test('should load many-to-many relationship from inverse side', async () => {
      const { tags } = await createPostWithTags('Post A', ['JavaScript']);
      await createPostWithTags('Post B', []);
      // Link Post B to JavaScript tag
      const postB = await postRepo.findOne({ where: { title: 'Post B' } });
      await execute(`INSERT INTO "post_tag" ("post_id", "tag_id") VALUES (${postB!.id}, ${tags[0].id})`);

      const found = await tagRepo.findById(tags[0].id, {
        load: ['posts'],
        loadStrategy: 'joined',
      });

      expect(found).toBeDefined();
      expect(found!.posts).toBeDefined();
      expect(found!.posts.length).toBe(2);
    });

    test('should handle empty many-to-many relationship', async () => {
      const post = await postRepo.create({ title: 'No Tags' });

      const found = await postRepo.findById(post.id, {
        load: ['tags'],
        loadStrategy: 'joined',
      });

      expect(found).toBeDefined();
      expect(found!.tags).toBeDefined();
      expect(found!.tags.length).toBe(0);
    });

    test('should deduplicate entities in many-to-many', async () => {
      const { post } = await createPostWithTags('Dedup Test', ['Tag1', 'Tag2', 'Tag3']);

      const found = await postRepo.findById(post.id, {
        load: ['tags'],
        loadStrategy: 'joined',
      });

      expect(found).toBeDefined();
      const tagIds = found!.tags.map(t => t.id);
      const uniqueIds = new Set(tagIds);
      expect(uniqueIds.size).toBe(tagIds.length);
    });
  });

  describe('Select Strategy', () => {
    test('should load many-to-many relationship with select strategy', async () => {
      const { post } = await createPostWithTags('Select Test', ['React', 'Vue']);

      const found = await postRepo.findById(post.id, {
        load: ['tags'],
        loadStrategy: 'select',
      });

      expect(found).toBeDefined();
      expect(found!.tags).toBeDefined();
      expect(found!.tags.length).toBe(2);
    });
  });

  describe('Multiple Items', () => {
    test('should load many-to-many for multiple entities', async () => {
      await createPostWithTags('Post 1', ['Tag A', 'Tag B']);
      await createPostWithTags('Post 2', ['Tag C']);

      const posts = await postRepo.find({
        load: ['tags'],
        loadStrategy: 'joined',
      });

      expect(posts.length).toBe(2);

      const post1 = posts.find(p => p.title === 'Post 1');
      const post2 = posts.find(p => p.title === 'Post 2');

      expect(post1!.tags.length).toBe(2);
      expect(post2!.tags.length).toBe(1);
    });
  });
});
