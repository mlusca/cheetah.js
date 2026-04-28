import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import { adaptSqlForCurrentDriver, getSerial } from '../test-sql-helper';
import { BaseEntity, Entity, PrimaryKey, Property, Repository } from '../../src';
import { bench, currentDriver, logResult, readBaseline, writeBaseline, compare, type BenchResult } from './_perf-helper';

@Entity()
class BulkDelPerfUser extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;
}

class BulkDelPerfRepo extends Repository<BulkDelPerfUser> {
  constructor() { super(BulkDelPerfUser); }
}

const SUITE = 'bulk-delete';
const RECORD_BASELINE = process.env.RECORD_BASELINE === '1';
const ROWS = 500;
const CHUNK = 250;

async function seed(repo: BulkDelPerfRepo, n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `User ${i + 1}` }));
  await repo.bulkCreate(rows, { chunkSize: 500 });
}

describe('Bulk delete performance', () => {
  const results: BenchResult[] = [];
  const repo = new BulkDelPerfRepo();

  beforeAll(async () => {
    await startDatabase();
    await execute(adaptSqlForCurrentDriver(`
      CREATE TABLE "bulk_del_perf_user" (
        ${getSerial('id')},
        "name" varchar(255) NOT NULL
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

  test(`sequential deleteById x ${ROWS}`, async () => {
    await seed(repo, ROWS);
    const r = await bench('sequential-delete', async () => {
      for (let i = 1; i <= ROWS; i += 1) {
        await repo.deleteById(i);
      }
    }, { iterations: 1, warmup: 0, perIteration: true });
    results.push(r);
    logResult(r);
  }, 60000);

  test(`bulkDelete x ${ROWS} (chunkSize=${CHUNK})`, async () => {
    await seed(repo, ROWS);
    const r = await bench('bulk-delete', async () => {
      const ids = Array.from({ length: ROWS }, (_, i) => i + 1);
      const n = await repo.bulkDelete(ids, { chunkSize: CHUNK });
      if (n !== ROWS) throw new Error(`expected ${ROWS} deletes, got ${n}`);
      // Re-seed for next iteration.
      await seed(repo, ROWS);
    }, { iterations: 3, warmup: 1, perIteration: true });
    results.push(r);
    logResult(r);
  }, 60000);

  test('speedup: bulkDelete vs sequential >= 5x', () => {
    const seq = results.find((r) => r.name === 'sequential-delete');
    const bulk = results.find((r) => r.name === 'bulk-delete');
    expect(seq).toBeDefined();
    expect(bulk).toBeDefined();
    const speedup = seq!.avgMs / bulk!.avgMs;
    // eslint-disable-next-line no-console
    console.log(`[perf] bulkDelete speedup vs sequential: ${speedup.toFixed(2)}x (seq=${seq!.avgMs.toFixed(1)}ms bulk=${bulk!.avgMs.toFixed(1)}ms for ${ROWS} rows)`);
    expect(speedup).toBeGreaterThan(5);
  });
});
