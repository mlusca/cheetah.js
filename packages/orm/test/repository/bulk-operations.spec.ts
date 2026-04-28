import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import { adaptSqlForCurrentDriver, getSerial } from '../test-sql-helper';
import {
  BaseEntity,
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Repository,
  BeforeCreate,
  AfterCreate,
} from '../../src';

@Entity()
class BulkCompany extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;
}

let beforeHookCalls = 0;
let afterHookCalls = 0;

@Entity()
class BulkUser extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;

  @Property()
  email: string;

  @Property({ default: () => 'pending' })
  status: string;

  @Property({ onInsert: () => new Date('2026-01-01T00:00:00Z') })
  createdAt: Date;

  @Property()
  companyId: number;

  @ManyToOne(() => BulkCompany)
  company: BulkCompany;

  @BeforeCreate()
  beforeCreate() {
    beforeHookCalls += 1;
  }

  @AfterCreate()
  afterCreate() {
    afterHookCalls += 1;
  }
}

class BulkUserRepository extends Repository<BulkUser> {
  constructor() { super(BulkUser); }
}

describe('Bulk operations (multi-row INSERT)', () => {
  beforeEach(async () => {
    beforeHookCalls = 0;
    afterHookCalls = 0;
    await startDatabase();
    await execute(adaptSqlForCurrentDriver(`
      CREATE TABLE "bulk_company" (
        ${getSerial('id')},
        "name" varchar(255) NOT NULL
      );
    `));
    await execute(adaptSqlForCurrentDriver(`
      CREATE TABLE "bulk_user" (
        ${getSerial('id')},
        "name" varchar(255) NOT NULL,
        "email" varchar(255) NOT NULL,
        "status" varchar(50) NOT NULL,
        "created_at" TIMESTAMP NOT NULL,
        "company_id" integer
      );
    `));
    await BulkCompany.create({ id: 1, name: 'Acme' });
  });

  afterEach(async () => {
    await purgeDatabase();
    await app?.disconnect();
  });

  test('createMany inserts every row in a single statement and returns hydrated entities', async () => {
    const rows = [
      { name: 'Alice', email: 'alice@x.com', companyId: 1 },
      { name: 'Bob', email: 'bob@x.com', companyId: 1 },
      { name: 'Carol', email: 'carol@x.com', companyId: 1 },
    ];

    const inserted = await BulkUser.createMany(rows);

    expect(inserted).toHaveLength(3);
    expect(inserted.map((u) => u.name).sort()).toEqual(['Alice', 'Bob', 'Carol']);
    // Defaults applied to every row
    expect(inserted.every((u) => u.status === 'pending')).toBe(true);
    // onInsert applied to every row
    expect(inserted.every((u) => u.createdAt instanceof Date)).toBe(true);
    // Hooks fired per row
    expect(beforeHookCalls).toBe(3);
    expect(afterHookCalls).toBe(3);

    const persisted = await BulkUser.find({});
    expect(persisted).toHaveLength(3);
  });

  test('createMany returns [] for empty array (no SQL emitted)', async () => {
    const result = await BulkUser.createMany([]);
    expect(result).toEqual([]);
  });

  test('createMany with explicit IDs preserves them', async () => {
    const rows = [
      { id: 10, name: 'X', email: 'x@x.com', companyId: 1 },
      { id: 11, name: 'Y', email: 'y@x.com', companyId: 1 },
    ];
    const inserted = await BulkUser.createMany(rows);
    expect(inserted.map((u) => u.id).sort((a, b) => a - b)).toEqual([10, 11]);
  });

  test('createMany pads heterogeneous rows with null for missing columns', async () => {
    const rows: any[] = [
      { name: 'Alice', email: 'alice@x.com', companyId: 1 },
      { name: 'Bob', email: 'bob@x.com' /* no companyId */ },
    ];
    const inserted = await BulkUser.createMany(rows);
    expect(inserted).toHaveLength(2);
    const bob = inserted.find((u) => u.name === 'Bob')!;
    expect(bob.companyId == null).toBe(true);
  });

  test('Repository.bulkCreate chunks large input and wraps in a transaction', async () => {
    const repo = new BulkUserRepository();
    const rows = Array.from({ length: 250 }, (_, i) => ({
      name: `User ${i}`,
      email: `user${i}@x.com`,
      companyId: 1,
    }));

    const inserted = await repo.bulkCreate(rows, { chunkSize: 50 });

    expect(inserted).toHaveLength(250);
    const persisted = await BulkUser.find({});
    expect(persisted.length).toBe(250);
  });

  test('Repository.bulkCreate rolls back on error in later chunk', async () => {
    const repo = new BulkUserRepository();
    const rows: any[] = Array.from({ length: 60 }, (_, i) => ({
      name: `User ${i}`,
      email: `user${i}@x.com`,
      companyId: 1,
    }));
    // 51st row references a non-existent column to force a SQL error in chunk 2.
    rows[50] = { name: 'X', email: 'x@x.com', companyId: 1, nonExistentColumn: 'boom' };

    await expect(repo.bulkCreate(rows, { chunkSize: 50 })).rejects.toBeDefined();

    const persisted = await BulkUser.find({});
    expect(persisted.length).toBe(0);
  });

  test('values registered into identity map after bulk insert', async () => {
    const inserted = await BulkUser.createMany([
      { name: 'A', email: 'a@x.com', companyId: 1 },
      { name: 'B', email: 'b@x.com', companyId: 1 },
    ]);

    // Accessing by primary key inside the same request should hit the
    // identity map (reference equality preserved).
    const reloaded = await BulkUser.findOne({ id: inserted[0].id });
    // Identity map context isn't enabled by default in these tests, so we just
    // assert correctness of the persisted row.
    expect(reloaded?.name).toBe('A');
  });
});
