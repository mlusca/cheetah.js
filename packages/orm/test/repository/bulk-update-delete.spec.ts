import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import { adaptSqlForCurrentDriver, getSerial } from '../test-sql-helper';
import {
  BaseEntity,
  Entity,
  PrimaryKey,
  Property,
  Repository,
} from '../../src';

@Entity()
class BulkUpdUser extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;

  @Property()
  email: string;

  @Property()
  age: number;

  @Property({ onUpdate: () => new Date('2027-06-15T12:00:00Z') })
  updatedAt: Date;
}

class BulkUpdUserRepo extends Repository<BulkUpdUser> {
  constructor() { super(BulkUpdUser); }
}

describe('Bulk update / delete (CASE + IN strategies)', () => {
  let repo: BulkUpdUserRepo;

  beforeEach(async () => {
    await startDatabase();
    await execute(adaptSqlForCurrentDriver(`
      CREATE TABLE "bulk_upd_user" (
        ${getSerial('id')},
        "name" varchar(255) NOT NULL,
        "email" varchar(255) NOT NULL,
        "age" integer NOT NULL,
        "updated_at" TIMESTAMP NOT NULL
      );
    `));
    repo = new BulkUpdUserRepo();

    // Seed 6 deterministic rows.
    await BulkUpdUser.createMany([
      { id: 1, name: 'Alice',   email: 'a@x.com', age: 20, updatedAt: new Date('2020-01-01T00:00:00Z') },
      { id: 2, name: 'Bob',     email: 'b@x.com', age: 21, updatedAt: new Date('2020-01-01T00:00:00Z') },
      { id: 3, name: 'Carol',   email: 'c@x.com', age: 22, updatedAt: new Date('2020-01-01T00:00:00Z') },
      { id: 4, name: 'David',   email: 'd@x.com', age: 23, updatedAt: new Date('2020-01-01T00:00:00Z') },
      { id: 5, name: 'Eve',     email: 'e@x.com', age: 24, updatedAt: new Date('2020-01-01T00:00:00Z') },
      { id: 6, name: 'Frank',   email: 'f@x.com', age: 25, updatedAt: new Date('2020-01-01T00:00:00Z') },
    ]);
  });

  afterEach(async () => {
    await purgeDatabase();
    await app?.disconnect();
  });

  describe('bulkUpdate', () => {
    test('returns 0 for empty input (no SQL)', async () => {
      const n = await repo.bulkUpdate([]);
      expect(n).toBe(0);
    });

    test('updates each row by its PK using a single CASE statement', async () => {
      await repo.bulkUpdate([
        { id: 1, name: 'Alice2', age: 100 },
        { id: 3, name: 'Carol2', age: 102 },
      ]);

      const rows = await BulkUpdUser.find({});
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(1)!.name).toBe('Alice2');
      expect(byId.get(1)!.age).toBe(100);
      expect(byId.get(3)!.name).toBe('Carol2');
      expect(byId.get(3)!.age).toBe(102);
      // Untouched rows must keep original values.
      expect(byId.get(2)!.name).toBe('Bob');
      expect(byId.get(2)!.age).toBe(21);
    });

    test('rows omitting a column keep their original value (ELSE col)', async () => {
      await repo.bulkUpdate([
        { id: 1, name: 'NewAlice', age: 99 },
        { id: 2, name: 'NewBob' /* no age */ },
      ]);

      const rows = await BulkUpdUser.find({});
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(1)!.name).toBe('NewAlice');
      expect(byId.get(1)!.age).toBe(99);
      expect(byId.get(2)!.name).toBe('NewBob');
      // Bob's age must stay at 21 even though row 1 changed age.
      expect(byId.get(2)!.age).toBe(21);
    });

    test('applies onUpdate property to every updated row', async () => {
      await repo.bulkUpdate([
        { id: 1, name: 'A1' },
        { id: 2, name: 'B1' },
      ]);

      const rows = await BulkUpdUser.find({});
      const byId = new Map(rows.map((r) => [r.id, r]));
      const expected = new Date('2027-06-15T12:00:00Z').getTime();
      expect(byId.get(1)!.updatedAt.getTime()).toBe(expected);
      expect(byId.get(2)!.updatedAt.getTime()).toBe(expected);
      // Row 3 was not in the bulk update — its updatedAt must be untouched.
      expect(byId.get(3)!.updatedAt.getTime()).toBe(new Date('2020-01-01T00:00:00Z').getTime());
    });

    test('chunks large input and wraps in a transaction', async () => {
      // 6 rows, chunkSize 2 → 3 chunks → wrapped in transaction.
      const updates = [
        { id: 1, age: 1000 },
        { id: 2, age: 1001 },
        { id: 3, age: 1002 },
        { id: 4, age: 1003 },
        { id: 5, age: 1004 },
        { id: 6, age: 1005 },
      ];
      await repo.bulkUpdate(updates, { chunkSize: 2 });

      const rows = await BulkUpdUser.find({});
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (let i = 1; i <= 6; i += 1) {
        expect(byId.get(i)!.age).toBe(999 + i);
      }
    });

    test('throws when a row is missing the primary key', async () => {
      await expect(
        // @ts-expect-error - intentionally missing id
        repo.bulkUpdate([{ name: 'no-id' }]),
      ).rejects.toBeDefined();
    });
  });

  describe('bulkDelete', () => {
    test('returns 0 for empty input', async () => {
      const n = await repo.bulkDelete([]);
      expect(n).toBe(0);
      const rows = await BulkUpdUser.find({});
      expect(rows.length).toBe(6);
    });

    test('deletes each id and returns the count', async () => {
      const n = await repo.bulkDelete([1, 3, 5]);
      expect(n).toBe(3);

      const rows = await BulkUpdUser.find({});
      const ids = rows.map((r) => r.id).sort();
      expect(ids).toEqual([2, 4, 6]);
    });

    test('chunks large id lists', async () => {
      const n = await repo.bulkDelete([1, 2, 3, 4, 5, 6], { chunkSize: 2 });
      expect(n).toBe(6);

      const rows = await BulkUpdUser.find({});
      expect(rows.length).toBe(0);
    });

    test('non-existent ids are ignored (count reflects actual deletes)', async () => {
      const n = await repo.bulkDelete([1, 999, 1000]);
      expect(n).toBe(1);
      const rows = await BulkUpdUser.find({});
      expect(rows.length).toBe(5);
    });
  });
});
