import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import { Entity, PrimaryKey, Property, Repository } from '../../src';
import type { Page } from '../../src';

describe('Repository pagination', () => {
  const DDL_USER = `
    CREATE TABLE "paged_user" (
      "id" SERIAL PRIMARY KEY,
      "name" varchar(255) NOT NULL,
      "status" varchar(50) NOT NULL,
      "age" integer NOT NULL,
      "created_at" timestamp DEFAULT NOW()
    );
  `;

  @Entity({ tableName: 'paged_user' })
  class PagedUser {
    @PrimaryKey()
    id: number;

    @Property()
    name: string;

    @Property()
    status: string;

    @Property()
    age: number;

    @Property()
    createdAt: Date;
  }

  class PagedUserRepository extends Repository<PagedUser> {
    constructor() {
      super(PagedUser);
    }
  }

  let repo: PagedUserRepository;

  beforeEach(async () => {
    await startDatabase();
    await execute(DDL_USER);
    repo = new PagedUserRepository();

    for (let i = 1; i <= 25; i += 1) {
      await repo.create({
        name: `User ${String(i).padStart(2, '0')}`,
        status: i <= 12 ? 'active' : 'inactive',
        age: 20 + i,
        createdAt: new Date(`2024-01-${String(i).padStart(2, '0')}T00:00:00.000Z`),
      });
    }
  });

  afterEach(async () => {
    await purgeDatabase();
    await app?.disconnect();
  });

  test('returns the default first page with total metadata', async () => {
    const page = await repo.findPage({ orderBy: { id: 'ASC' } });

    expectPageShape(page);
    expect(page.total).toBe(25);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(20);
    expect(page.totalPages).toBe(2);
    expect(page.data).toHaveLength(20);
    expect(page.data[0].name).toBe('User 01');
    expect(page.data[19].name).toBe('User 20');
  });

  test('applies where, orderBy, page, and pageSize', async () => {
    const page = await repo.findPage({
      where: { status: 'active' },
      orderBy: { id: 'ASC' },
      page: 2,
      pageSize: 5,
    });

    expect(page.total).toBe(12);
    expect(page.page).toBe(2);
    expect(page.pageSize).toBe(5);
    expect(page.totalPages).toBe(3);
    expect(page.data.map((user) => user.name)).toEqual([
      'User 06',
      'User 07',
      'User 08',
      'User 09',
      'User 10',
    ]);
  });

  test('returns an empty data array when the requested page is out of range', async () => {
    const page = await repo.findPage({
      where: { status: 'active' },
      orderBy: { id: 'ASC' },
      page: 4,
      pageSize: 5,
    });

    expect(page.total).toBe(12);
    expect(page.page).toBe(4);
    expect(page.pageSize).toBe(5);
    expect(page.totalPages).toBe(3);
    expect(page.data).toEqual([]);
  });

  test('returns zero total pages when no rows match', async () => {
    const page = await repo.findPage({
      where: { status: 'missing' },
      page: 1,
      pageSize: 10,
    });

    expect(page.total).toBe(0);
    expect(page.totalPages).toBe(0);
    expect(page.data).toEqual([]);
  });

  test('uses page and pageSize instead of runtime limit and offset values', async () => {
    const options = {
      orderBy: { id: 'ASC' },
      page: 2,
      pageSize: 3,
      limit: 99,
      offset: 99,
    } as any;

    const page = await repo.findPage(options);

    expect(page.data.map((user) => user.name)).toEqual(['User 04', 'User 05', 'User 06']);
    expect(options.limit).toBe(99);
    expect(options.offset).toBe(99);
  });

  test('validates page and pageSize', async () => {
    await expect(repo.findPage({ page: 0 })).rejects.toThrow(/"page" must be a positive safe integer/);
    await expect(repo.findPage({ page: 1.5 })).rejects.toThrow(/"page" must be a positive safe integer/);
    await expect(repo.findPage({ pageSize: 0 })).rejects.toThrow(/"pageSize" must be a positive safe integer/);
    await expect(repo.findPage({ page: Number.MAX_SAFE_INTEGER, pageSize: 2 })).rejects.toThrow(/unsafe offset/);
  });
});

function expectPageShape<T>(page: Page<T>): void {
  expect(Array.isArray(page.data)).toBe(true);
  expect(typeof page.total).toBe('number');
  expect(typeof page.page).toBe('number');
  expect(typeof page.pageSize).toBe('number');
  expect(typeof page.totalPages).toBe('number');
}
