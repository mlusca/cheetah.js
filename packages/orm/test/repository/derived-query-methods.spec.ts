import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import { Entity, PrimaryKey, Property, Repository } from '../../src';

describe('Derived Query Methods', () => {
  const DDL_USER = `
    CREATE TABLE "derived_user" (
      "id" SERIAL PRIMARY KEY,
      "email" varchar(255) NOT NULL,
      "name" varchar(255) NOT NULL,
      "status" varchar(50) NOT NULL,
      "age" integer NOT NULL,
      "score" integer,
      "active" boolean DEFAULT true,
      "created_at" timestamp DEFAULT NOW(),
      "deleted_at" timestamp NULL
    );
  `;

  @Entity({ tableName: 'derived_user' })
  class DerivedUser {
    @PrimaryKey()
    id: number;

    @Property()
    email: string;

    @Property()
    name: string;

    @Property()
    status: string;

    @Property()
    age: number;

    @Property()
    score: number;

    @Property()
    active: boolean;

    @Property()
    createdAt: Date;

    @Property()
    deletedAt: Date;
  }

  class DerivedUserRepository extends Repository<DerivedUser> {
    constructor() {
      super(DerivedUser);
    }

    async findByStatus(status: string): Promise<string> {
      return `concrete:${status}`;
    }
  }

  let repo: DerivedUserRepository;
  let derived: any;

  beforeEach(async () => {
    await startDatabase();
    await execute(DDL_USER);
    repo = new DerivedUserRepository();
    derived = repo as any;

    await repo.create({
      email: 'alice@example.com',
      name: 'Alice',
      status: 'active',
      age: 30,
      score: 10,
      active: true,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    });

    await repo.create({
      email: 'bob@example.com',
      name: 'Bob',
      status: 'inactive',
      age: 17,
      score: 20,
      active: false,
      createdAt: new Date('2024-02-01T00:00:00.000Z'),
    });

    await repo.create({
      email: 'alicia@example.com',
      name: 'Alicia',
      status: 'active',
      age: 22,
      score: 30,
      active: true,
      createdAt: new Date('2024-03-01T00:00:00.000Z'),
    });

    await repo.create({
      email: 'joanna@example.com',
      name: 'Joanna',
      status: 'active',
      age: 41,
      score: 40,
      active: true,
      createdAt: new Date('2024-04-01T00:00:00.000Z'),
      deletedAt: new Date('2024-05-01T00:00:00.000Z'),
    });

    await repo.create({
      email: 'john@example.com',
      name: 'John',
      status: 'pending',
      age: 25,
      score: null as any,
      active: true,
      createdAt: new Date('2024-05-01T00:00:00.000Z'),
    });
  });

  afterEach(async () => {
    await purgeDatabase();
    await app?.disconnect();
  });

  test('findBy returns a single entity and concrete methods keep precedence', async () => {
    const found = await derived.findByEmail('alice@example.com');
    const foundOne = await derived.findOneByEmail('alice@example.com');
    const concrete = await derived.findByStatus('active');

    expect(found?.name).toBe('Alice');
    expect(foundOne?.name).toBe('Alice');
    expect(concrete).toBe('concrete:active');
  });

  test('supports equality, And, Or, and comparison operators', async () => {
    const activeAlice = await derived.findAllByNameAndStatus('Alice', 'active');
    const adultsOrInactive = await derived.findAllByAgeGreaterThanEqualOrStatus(30, 'inactive');
    const younger = await derived.findAllByAgeLessThan(25);

    expect(activeAlice.map((user: DerivedUser) => user.email)).toEqual(['alice@example.com']);
    expect(adultsOrInactive.map((user: DerivedUser) => user.email).sort()).toEqual([
      'alice@example.com',
      'bob@example.com',
      'joanna@example.com',
    ]);
    expect(younger.map((user: DerivedUser) => user.email).sort()).toEqual([
      'alicia@example.com',
      'bob@example.com',
    ]);
  });

  test('supports Between, In, NotIn, boolean, and null operators', async () => {
    const between = await derived.findAllByAgeBetween(20, 30);
    const inStatus = await derived.findAllByStatusIn(['active', 'pending']);
    const notInactive = await derived.findAllByStatusNotIn(['inactive']);
    const active = await derived.findAllByActiveIsTrue();
    const deleted = await derived.findAllByDeletedAtIsNotNull();
    const notDeleted = await derived.findAllByDeletedAtIsNull();

    expect(between.map((user: DerivedUser) => user.email).sort()).toEqual([
      'alice@example.com',
      'alicia@example.com',
      'john@example.com',
    ]);
    expect(inStatus.length).toBe(4);
    expect(notInactive.length).toBe(4);
    expect(active.length).toBe(4);
    expect(deleted.map((user: DerivedUser) => user.email)).toEqual(['joanna@example.com']);
    expect(notDeleted.length).toBe(4);
  });

  test('supports Like variants and NotLike variants', async () => {
    const like = await derived.findAllByEmailLike('%@example.com');
    const notLike = await derived.findAllByEmailNotLike('jo%');
    const containing = await derived.findAllByNameContaining('lic');
    const contains = await derived.findAllByNameContains('lic');
    const starting = await derived.findAllByEmailStartingWith('jo');
    const ending = await derived.findAllByEmailEndingWith('example.com');
    const notContaining = await derived.findAllByNameNotContaining('li');

    expect(like.length).toBe(5);
    expect(notLike.map((user: DerivedUser) => user.email).sort()).toEqual([
      'alice@example.com',
      'alicia@example.com',
      'bob@example.com',
    ]);
    expect(containing.map((user: DerivedUser) => user.name).sort()).toEqual(['Alice', 'Alicia']);
    expect(contains.map((user: DerivedUser) => user.name).sort()).toEqual(['Alice', 'Alicia']);
    expect(starting.map((user: DerivedUser) => user.email).sort()).toEqual([
      'joanna@example.com',
      'john@example.com',
    ]);
    expect(ending.length).toBe(5);
    expect(notContaining.map((user: DerivedUser) => user.name).sort()).toEqual([
      'Bob',
      'Joanna',
      'John',
    ]);
  });

  test('supports OrderBy, Top/First limits, and final read options', async () => {
    const topTwo = await derived.findTop2ByStatusOrderByAgeAsc('active');
    const topOne = await derived.findTopByStatusOrderByAgeAsc('active');
    const first = await derived.findFirstByStatusOrderByAgeDesc('active');
    const firstTwo = await derived.findFirst2ByStatusOrderByAgeDesc('active');
    const optionLimited = await derived.findAllByStatus('active', {
      orderBy: { age: 'DESC' },
      limit: 1,
    });

    expect(topTwo.map((user: DerivedUser) => user.age)).toEqual([22, 30]);
    expect(topOne?.email).toBe('alicia@example.com');
    expect(first?.email).toBe('joanna@example.com');
    expect(firstTwo.map((user: DerivedUser) => user.age)).toEqual([41, 30]);
    expect(optionLimited.map((user: DerivedUser) => user.email)).toEqual(['joanna@example.com']);
  });

  test('supports countBy, existsBy, and deleteBy', async () => {
    const activeCount = await derived.countByStatus('active');
    const exists = await derived.existsByEmail('bob@example.com');

    await derived.deleteByStatus('pending');

    expect(activeCount).toBe(3);
    expect(exists).toBe(true);
    expect(await repo.count()).toBe(4);
    expect(await derived.existsByEmail('john@example.com')).toBe(false);
  });

  test('validates argument arity', async () => {
    await expect(derived.findAllByNameAndStatus('Alice')).rejects.toThrow(/expects 2 parameter/);
    await expect(derived.countByStatus('active', 'extra')).rejects.toThrow(/expects 1 parameter/);
  });
});
