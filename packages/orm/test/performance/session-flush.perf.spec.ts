import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import { adaptSqlForCurrentDriver, getSerial } from '../test-sql-helper';
import {
  BaseEntity,
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
  Session,
} from '../../src';
import { bench, currentDriver, logResult, readBaseline, writeBaseline, compare, type BenchResult } from './_perf-helper';

@Entity()
class FlushAuthor extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;
}

@Entity()
class FlushBook extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  title: string;

  @Property()
  authorId: number;

  @ManyToOne(() => FlushAuthor)
  author: FlushAuthor;
}

const SUITE = 'session-flush';
const RECORD_BASELINE = process.env.RECORD_BASELINE === '1';
const AUTHORS = 50;
const BOOKS_PER_AUTHOR = 10;

describe('Session.flush() performance', () => {
  const results: BenchResult[] = [];
  let nextAuthor = 1;
  let nextBook = 1;

  beforeAll(async () => {
    await startDatabase();
    await execute(adaptSqlForCurrentDriver(`
      CREATE TABLE "flush_author" (
        ${getSerial('id')},
        "name" varchar(255) NOT NULL
      );
    `));
    await execute(adaptSqlForCurrentDriver(`
      CREATE TABLE "flush_book" (
        ${getSerial('id')},
        "title" varchar(255) NOT NULL,
        "author_id" integer NOT NULL
      );
    `));
  });

  afterAll(async () => {
    const driver = currentDriver();
    const baseline = readBaseline(SUITE, driver);
    if (baseline) {
      for (const r of results) {
        const prev = baseline.results[r.name];
        if (!prev) continue;
        compare(r.name, prev.avgMs, r.avgMs);
      }
    }
    if (RECORD_BASELINE) writeBaseline(SUITE, driver, results);
    await purgeDatabase();
    await app?.disconnect();
  });

  test(`sequential per-row create x ${AUTHORS} authors + ${AUTHORS * BOOKS_PER_AUTHOR} books`, async () => {
    const r = await bench('sequential-mixed', async () => {
      for (let a = 0; a < AUTHORS; a += 1) {
        const aid = nextAuthor++;
        await FlushAuthor.create({ id: aid, name: `A${aid}` });
        for (let b = 0; b < BOOKS_PER_AUTHOR; b += 1) {
          const bid = nextBook++;
          await FlushBook.create({ id: bid, title: `B${bid}`, authorId: aid });
        }
      }
    }, { iterations: 1, warmup: 0, perIteration: true });
    results.push(r);
    logResult(r);
  }, 120000);

  test(`Session.flush() x ${AUTHORS} authors + ${AUTHORS * BOOKS_PER_AUTHOR} books`, async () => {
    const r = await bench('session-flush', async () => {
      const s = new Session();
      const baseAuthor = nextAuthor;
      const baseBook = nextBook;
      for (let a = 0; a < AUTHORS; a += 1) {
        const aid = baseAuthor + a;
        s.queueInsert(FlushAuthor, { id: aid, name: `A${aid}` });
        for (let b = 0; b < BOOKS_PER_AUTHOR; b += 1) {
          const bid = baseBook + a * BOOKS_PER_AUTHOR + b;
          // Intentionally enqueue books before authors finish — flush
          // will reorder by FK.
          s.queueInsert(FlushBook, { id: bid, title: `B${bid}`, authorId: aid });
        }
      }
      nextAuthor = baseAuthor + AUTHORS;
      nextBook = baseBook + AUTHORS * BOOKS_PER_AUTHOR;
      await s.flush();
    }, { iterations: 3, warmup: 1, perIteration: true });
    results.push(r);
    logResult(r);
  }, 60000);

  test('speedup: Session.flush vs sequential >= 5x', () => {
    const seq = results.find((r) => r.name === 'sequential-mixed');
    const flush = results.find((r) => r.name === 'session-flush');
    expect(seq).toBeDefined();
    expect(flush).toBeDefined();
    const speedup = seq!.avgMs / flush!.avgMs;
    // eslint-disable-next-line no-console
    console.log(`[perf] Session.flush speedup vs sequential: ${speedup.toFixed(2)}x (seq=${seq!.avgMs.toFixed(1)}ms flush=${flush!.avgMs.toFixed(1)}ms)`);
    expect(speedup).toBeGreaterThan(5);
  });
});
