import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import {
  BaseEntity,
  Entity,
  ManyToMany,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryKey,
  Property,
  Repository,
  type Ref,
} from '../../src';

const DDL_USER = `
  CREATE TABLE "sq_user" (
    "id" SERIAL PRIMARY KEY,
    "name" varchar(255) NOT NULL,
    "email" varchar(255) NOT NULL
  );
`;

const DDL_PROFILE = `
  CREATE TABLE "sq_profile" (
    "id" SERIAL PRIMARY KEY,
    "bio" varchar(255),
    "user_id" integer UNIQUE REFERENCES "sq_user" ("id")
  );
`;

const DDL_POST = `
  CREATE TABLE "sq_post" (
    "id" SERIAL PRIMARY KEY,
    "user_id" integer REFERENCES "sq_user" ("id"),
    "title" varchar(255) NOT NULL
  );
`;

const DDL_COMMENT = `
  CREATE TABLE "sq_comment" (
    "id" SERIAL PRIMARY KEY,
    "post_id" integer REFERENCES "sq_post" ("id"),
    "body" varchar(255) NOT NULL
  );
`;

const DDL_ARTICLE = `
  CREATE TABLE "sq_article" (
    "id" SERIAL PRIMARY KEY,
    "title" varchar(255) NOT NULL
  );
`;

const DDL_TAG = `
  CREATE TABLE "sq_tag" (
    "id" SERIAL PRIMARY KEY,
    "name" varchar(255) NOT NULL
  );
`;

const DDL_ARTICLE_TAG = `
  CREATE TABLE "sq_article_tag" (
    "article_id" integer REFERENCES "sq_article" ("id"),
    "tag_id" integer REFERENCES "sq_tag" ("id"),
    PRIMARY KEY ("article_id", "tag_id")
  );
`;

@Entity({ tableName: 'sq_user' })
class SmartUser extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;

  @Property()
  email: string;

  @OneToMany(() => SmartPost, (post) => post.userId)
  posts: SmartPost[];

  @OneToOne(() => SmartProfile, (profile) => profile.userId)
  profile: Ref<SmartProfile>;
}

@Entity({ tableName: 'sq_profile' })
class SmartProfile extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property({ nullable: true })
  bio: string;

  @Property({ columnName: 'user_id' })
  userId: number;

  @OneToOne(() => SmartUser)
  user: SmartUser;
}

@Entity({ tableName: 'sq_post' })
class SmartPost extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property({ columnName: 'user_id' })
  userId: number;

  @Property()
  title: string;

  @ManyToOne(() => SmartUser)
  user: SmartUser;

  @OneToMany(() => SmartComment, (comment) => comment.postId)
  comments: SmartComment[];
}

@Entity({ tableName: 'sq_comment' })
class SmartComment extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property({ columnName: 'post_id' })
  postId: number;

  @Property()
  body: string;

  @ManyToOne(() => SmartPost)
  post: SmartPost;
}

@Entity({ tableName: 'sq_article' })
class SmartArticle extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  title: string;

  @ManyToMany(() => SmartTag, {
    pivotTable: 'sq_article_tag',
    joinColumn: 'article_id',
    inverseJoinColumn: 'tag_id',
  })
  tags: SmartTag[];
}

@Entity({ tableName: 'sq_tag' })
class SmartTag extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;

  @ManyToMany(() => SmartArticle, {
    pivotTable: 'sq_article_tag',
    joinColumn: 'tag_id',
    inverseJoinColumn: 'article_id',
  })
  articles: SmartArticle[];
}

class SmartUserRepository extends Repository<SmartUser> {
  constructor() {
    super(SmartUser);
  }
}

class SmartPostRepository extends Repository<SmartPost> {
  constructor() {
    super(SmartPost);
  }
}

class SmartProfileRepository extends Repository<SmartProfile> {
  constructor() {
    super(SmartProfile);
  }
}

class SmartCommentRepository extends Repository<SmartComment> {
  constructor() {
    super(SmartComment);
  }
}

class SmartArticleRepository extends Repository<SmartArticle> {
  constructor() {
    super(SmartArticle);
  }
}

async function seedGraph() {
  const alice = await SmartUser.create({
    name: 'Alice',
    email: 'alice@acme.test',
  });
  const bob = await SmartUser.create({
    name: 'Bob',
    email: 'bob@acme.test',
  });

  await SmartProfile.create({
    bio: 'Team Lead',
    userId: alice.id,
  });
  await SmartProfile.create({
    bio: 'Product Designer',
    userId: bob.id,
  });

  const aliceIntro = await SmartPost.create({
    userId: alice.id,
    title: 'Intro to ORM',
  });
  const aliceAdvanced = await SmartPost.create({
    userId: alice.id,
    title: 'Advanced ORM',
  });
  const bobPost = await SmartPost.create({
    userId: bob.id,
    title: 'Frontend Patterns',
  });

  await SmartComment.create({
    postId: aliceIntro.id,
    body: 'Helpful content',
  });
  await SmartComment.create({
    postId: bobPost.id,
    body: 'Nice examples',
  });

  const ormTag = await SmartTag.create({
    name: 'ORM',
  });
  const uiTag = await SmartTag.create({
    name: 'UI',
  });

  const articleA = await SmartArticle.create({
    title: 'Database Internals',
  });
  const articleB = await SmartArticle.create({
    title: 'Design Systems',
  });

  await execute(`
    INSERT INTO "sq_article_tag" ("article_id", "tag_id")
    VALUES
      (${articleA.id}, ${ormTag.id}),
      (${articleB.id}, ${uiTag.id});
  `);

  return {
    alice,
    bob,
    aliceIntro,
    aliceAdvanced,
    bobPost,
    ormTag,
    uiTag,
    articleA,
    articleB,
  };
}

describe('Smart Query Relationships', () => {
  let userRepo: SmartUserRepository;
  let postRepo: SmartPostRepository;
  let profileRepo: SmartProfileRepository;
  let commentRepo: SmartCommentRepository;
  let articleRepo: SmartArticleRepository;

  beforeEach(async () => {
    await startDatabase();
    await execute(DDL_USER);
    await execute(DDL_PROFILE);
    await execute(DDL_POST);
    await execute(DDL_COMMENT);
    await execute(DDL_ARTICLE);
    await execute(DDL_TAG);
    await execute(DDL_ARTICLE_TAG);

    userRepo = new SmartUserRepository();
    postRepo = new SmartPostRepository();
    profileRepo = new SmartProfileRepository();
    commentRepo = new SmartCommentRepository();
    articleRepo = new SmartArticleRepository();
  });

  afterEach(async () => {
    await purgeDatabase();
    await app?.disconnect();
  });

  test('active record should implicitly join and hydrate ManyToOne relations', async () => {
    const { alice } = await seedGraph();

    const posts = await SmartPost.find({
      user: { id: alice.id },
    });

    expect(posts).toHaveLength(2);
    expect(posts.every((post) => post.user instanceof SmartUser)).toBe(true);
    expect(posts.every((post) => post.user.id === alice.id)).toBe(true);
    expect(posts.map((post) => post.user.name)).toEqual(['Alice', 'Alice']);
  });

  test('repository should support nested logical filters on ManyToOne and hydrate the relation', async () => {
    await seedGraph();

    const posts = await postRepo.find({
      where: {
        user: {
          $or: [
            { name: 'Alice' },
            { email: 'bob@acme.test' },
          ],
        },
      },
      orderBy: { title: 'ASC' },
    });

    expect(posts).toHaveLength(3);
    expect(posts.every((post) => post.user instanceof SmartUser)).toBe(true);
    expect(posts.map((post) => post.user.name)).toEqual(['Advanced ORM', 'Frontend Patterns', 'Intro to ORM'].map((title) =>
      title === 'Frontend Patterns' ? 'Bob' : 'Alice'
    ));
  });

  test('active record should support nested multi-level relation filters and hydrate the full path', async () => {
    await seedGraph();

    const comments = await SmartComment.find({
      post: {
        user: {
          name: 'Alice',
        },
      },
    });

    expect(comments).toHaveLength(1);
    expect(comments[0].post).toBeInstanceOf(SmartPost);
    expect(comments[0].post.user).toBeInstanceOf(SmartUser);
    expect(comments[0].post.user.name).toBe('Alice');
    expect(comments[0].body).toBe('Helpful content');
  });

  test('repository should implicitly join and hydrate OneToMany relations', async () => {
    const { alice } = await seedGraph();

    const users = await userRepo.find({
      where: {
        posts: {
          title: 'Intro to ORM',
        },
      },
    });

    expect(users).toHaveLength(1);
    expect(users[0].id).toBe(alice.id);
    expect(Array.isArray(users[0].posts)).toBe(true);
    expect(users[0].posts).toHaveLength(1);
    expect(users[0].posts[0].title).toBe('Intro to ORM');
  });

  test('active record should implicitly join and hydrate OneToOne owner relations', async () => {
    const { alice } = await seedGraph();

    const profiles = await SmartProfile.find({
      user: {
        email: alice.email,
      },
    });

    expect(profiles).toHaveLength(1);
    expect(profiles[0].user).toBeInstanceOf(SmartUser);
    expect(profiles[0].user.email).toBe(alice.email);
    expect(profiles[0].bio).toBe('Team Lead');
  });

  test('repository should implicitly join and hydrate OneToOne inverse relations', async () => {
    await seedGraph();

    const users = await userRepo.find({
      where: {
        profile: {
          bio: {
            $like: 'Team%',
          },
        },
      },
    });

    expect(users).toHaveLength(1);
    expect(users[0].profile).toBeInstanceOf(SmartProfile);
    expect(users[0].profile.bio).toBe('Team Lead');
    expect(users[0].name).toBe('Alice');
  });

  test('active record should implicitly join and hydrate ManyToMany relations', async () => {
    const { articleA } = await seedGraph();

    const articles = await SmartArticle.find({
      tags: {
        name: 'ORM',
      },
    });

    expect(articles).toHaveLength(1);
    expect(articles[0].id).toBe(articleA.id);
    expect(Array.isArray(articles[0].tags)).toBe(true);
    expect(articles[0].tags).toHaveLength(1);
    expect(articles[0].tags[0].name).toBe('ORM');
  });

  test('repository should implicitly join and hydrate ManyToMany relations', async () => {
    await seedGraph();

    const articles = await articleRepo.find({
      where: {
        tags: {
          name: {
            $in: ['ORM'],
          },
        },
      },
    });

    expect(articles).toHaveLength(1);
    expect(Array.isArray(articles[0].tags)).toBe(true);
    expect(articles[0].tags[0].name).toBe('ORM');
    expect(articles[0].title).toBe('Database Internals');
  });

  test('repository should support smart query filtering on OneToOne owner relations without explicit load', async () => {
    const { bob } = await seedGraph();

    const profile = await profileRepo.findOne({
      where: {
        user: {
          id: bob.id,
        },
      },
    });

    expect(profile).toBeDefined();
    expect(profile!.user).toBeInstanceOf(SmartUser);
    expect(profile!.user.id).toBe(bob.id);
    expect(profile!.bio).toBe('Product Designer');
  });

  test('repository should support smart query filtering on nested ManyToOne paths without explicit load', async () => {
    await seedGraph();

    const comment = await commentRepo.findOne({
      where: {
        post: {
          user: {
            email: 'alice@acme.test',
          },
        },
      },
    });

    expect(comment).toBeDefined();
    expect(comment!.post).toBeInstanceOf(SmartPost);
    expect(comment!.post.user).toBeInstanceOf(SmartUser);
    expect(comment!.post.user.email).toBe('alice@acme.test');
    expect(comment!.body).toBe('Helpful content');
  });
});
