import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import { adaptSqlForCurrentDriver, getSerial } from '../test-sql-helper';
import {
  BaseEntity,
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
  Session,
  withSession,
} from '../../src';

@Entity()
class UowAuthor extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;
}

@Entity()
class UowBook extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  title: string;

  @Property()
  authorId: number;

  @ManyToOne(() => UowAuthor)
  author: UowAuthor;
}

describe('Session (Unit of Work)', () => {
  beforeEach(async () => {
    await startDatabase();
    await execute(adaptSqlForCurrentDriver(`
      CREATE TABLE "uow_author" (
        ${getSerial('id')},
        "name" varchar(255) NOT NULL
      );
    `));
    await execute(adaptSqlForCurrentDriver(`
      CREATE TABLE "uow_book" (
        ${getSerial('id')},
        "title" varchar(255) NOT NULL,
        "author_id" integer NOT NULL
      );
    `));
  });

  afterEach(async () => {
    await purgeDatabase();
    await app?.disconnect();
  });

  test('flush() with no work returns zero counters', async () => {
    const s = new Session();
    const r = await s.flush();
    expect(r).toEqual({ inserted: 0, updated: 0, deleted: 0 });
  });

  test('inserts run in topological order (parents first)', async () => {
    const s = new Session();
    // Intentionally queue child before parent — flush must reorder.
    s.queueInsert(UowBook,   { id: 10, title: 'Book A', authorId: 1 });
    s.queueInsert(UowAuthor, { id: 1, name: 'Ada' });
    s.queueInsert(UowBook,   { id: 11, title: 'Book B', authorId: 1 });

    const r = await s.flush();
    expect(r.inserted).toBe(3);

    const authors = await UowAuthor.find({});
    expect(authors).toHaveLength(1);
    const books = await UowBook.find({});
    expect(books).toHaveLength(2);
  });

  test('updates by PK apply to every queued row', async () => {
    await UowAuthor.createMany([
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
    ]);

    const s = new Session();
    s.queueUpdate(UowAuthor, { id: 1, name: 'A2' });
    s.queueUpdate(UowAuthor, { id: 2, name: 'B2' });
    const r = await s.flush();
    expect(r.updated).toBe(2);

    const rows = await UowAuthor.find({});
    const byId = new Map(rows.map((x) => [x.id, x]));
    expect(byId.get(1)!.name).toBe('A2');
    expect(byId.get(2)!.name).toBe('B2');
  });

  test('deletes run children-first (reverse topological)', async () => {
    await UowAuthor.create({ id: 1, name: 'Ada' });
    await UowBook.createMany([
      { id: 1, title: 'A', authorId: 1 },
      { id: 2, title: 'B', authorId: 1 },
    ]);

    const s = new Session();
    // Even when queued in declaration order, delete order must be reversed.
    s.queueDelete(UowAuthor, 1);
    s.queueDelete(UowBook, 1);
    s.queueDelete(UowBook, 2);

    const r = await s.flush();
    expect(r.deleted).toBe(3);
    expect((await UowBook.find({})).length).toBe(0);
    expect((await UowAuthor.find({})).length).toBe(0);
  });

  test('mixed insert+update+delete in one flush is atomic on failure', async () => {
    await UowAuthor.create({ id: 1, name: 'Ada' });

    const s = new Session();
    s.queueInsert(UowAuthor, { id: 2, name: 'Babbage' });
    s.queueUpdate(UowAuthor, { id: 1, name: 'Ada Lovelace' });
    // Trigger a delete that targets a non-existent id (no error) *and*
    // then an update with a malformed key to force a SQL error.
    s.queueDelete(UowAuthor, 999);
    s.queueUpdate(UowAuthor, { id: 1, nonExistentColumn: 'boom' } as any);

    await expect(s.flush()).rejects.toBeDefined();

    // Transaction rolled back: original row 1 still 'Ada', no row 2 inserted.
    const rows = await UowAuthor.find({});
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Ada');
  });

  test('clear() drops all queued operations without executing them', async () => {
    const s = new Session();
    s.queueInsert(UowAuthor, { id: 5, name: 'Ghost' });
    expect(s.pendingCount().inserts).toBe(1);
    s.clear();
    expect(s.pendingCount().inserts).toBe(0);
    const r = await s.flush();
    expect(r.inserted).toBe(0);
    expect((await UowAuthor.find({})).length).toBe(0);
  });

  test('withSession() auto-flushes on success', async () => {
    const r = await withSession(async (s) => {
      s.queueInsert(UowAuthor, { id: 7, name: 'Auto' });
      s.queueInsert(UowBook, { id: 70, title: 'Auto Book', authorId: 7 });
    });
    expect(r).toEqual({ inserted: 2, updated: 0, deleted: 0 });
    const authors = await UowAuthor.find({});
    expect(authors).toHaveLength(1);
  });

  test('withSession() does not flush on thrown error', async () => {
    await expect(withSession(async (s) => {
      s.queueInsert(UowAuthor, { id: 8, name: 'NoCommit' });
      throw new Error('boom');
    })).rejects.toBeDefined();
    expect((await UowAuthor.find({})).length).toBe(0);
  });

  test('reusing a Session after flush is allowed (queues cleared)', async () => {
    const s = new Session();
    s.queueInsert(UowAuthor, { id: 1, name: 'A' });
    await s.flush();
    expect(s.pendingCount().inserts).toBe(0);

    s.queueInsert(UowAuthor, { id: 2, name: 'B' });
    await s.flush();
    expect((await UowAuthor.find({})).length).toBe(2);
  });
});
