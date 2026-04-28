import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import { adaptSqlForCurrentDriver, getSerial } from '../test-sql-helper';
import { BaseEntity, Entity, PrimaryKey, Property, Repository } from '../../src';
import { bench, currentDriver, logResult, readBaseline, writeBaseline, compare, type BenchResult } from './_perf-helper';

@Entity()
class BulkUpdPerfUser extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;

  @Property()
  email: string;

  @Property()
  age: number;
}

class BulkUpdPerfRepo extends Repository<BulkUpdPerfUser> {
  constructor() { super(BulkUpdPerfUser); }
}

const SUITE = 'bulk-update';
const RECORD_BASELINE = process.env.RECORD_BASELINE === '1';
const ROWS = 500;
const CHUNK = 250;

describe('Bulk update performance', () => {
  const results: BenchResult[] = [];
  const repo = new BulkUpdPerfRepo();

  beforeAll(async () => {
    await startDatabase();
    await execute(adaptSqlForCurrentDriver(`
      CREATE TABLE "bulk_upd_perf_user" (
        ${getSerial('id')},
        "name" varchar(255) NOT NULL,
        "email" varchar(255) NOT NULL,
        "age" integer NOT NULL
      );
    `));
    // Seed.
    const seed = Array.from({ length: ROWS }, (_, i) => ({
      id: i + 1,
      name: `User ${i + 1}`,
      email: `u${i + 1}@x.com`,
      age: 20 + (i % 50),
    }));
    await repo.bulkCreate(seed, { chunkSize: 500 });
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

  test(`sequential update x ${ROWS}`, async () => {
    const r = await bench('sequential-update', async () => {
      for (let i = 1; i <= ROWS; i += 1) {
        await repo.updateById(i, { age: 99 } as any);
      }
    }, { iterations: 1, warmup: 0, perIteration: true });
    results.push(r);
    logResult(r);
  }, 60000);

  test(`bulkUpdate x ${ROWS} (chunkSize=${CHUNK})`, async () => {
    let runIdx = 0;
    const r = await bench('bulk-update', async () => {
      runIdx += 1;
      const updates = Array.from({ length: ROWS }, (_, i) => ({
        id: i + 1,
        age: 100 + (i % 50) + runIdx * 1000, // vary across iterations so MySQL reports affectedRows
      }));
      await repo.bulkUpdate(updates, { chunkSize: CHUNK });
    }, { iterations: 3, warmup: 1, perIteration: true });
    results.push(r);
    logResult(r);
  }, 60000);

  test('speedup: bulkUpdate vs sequential >= 5x', () => {
    const seq = results.find((r) => r.name === 'sequential-update');
    const bulk = results.find((r) => r.name === 'bulk-update');
    expect(seq).toBeDefined();
    expect(bulk).toBeDefined();
    const speedup = seq!.avgMs / bulk!.avgMs;
    // eslint-disable-next-line no-console
    console.log(`[perf] bulkUpdate speedup vs sequential: ${speedup.toFixed(2)}x (seq=${seq!.avgMs.toFixed(1)}ms bulk=${bulk!.avgMs.toFixed(1)}ms for ${ROWS} rows)`);
    expect(speedup).toBeGreaterThan(5);
  });
});
