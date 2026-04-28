import { afterAll, beforeAll, describe, test, expect } from 'bun:test';
import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import { adaptSqlForCurrentDriver, getSerial } from '../test-sql-helper';
import { BaseEntity, Entity, PrimaryKey, Property, Repository } from '../../src';
import { bench, currentDriver, logResult, readBaseline, writeBaseline, compare, type BenchResult } from './_perf-helper';

@Entity()
class BulkPerfUser extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;

  @Property()
  email: string;

  @Property()
  age: number;

  @Property({ default: () => 'active' })
  status: string;
}

class BulkPerfUserRepo extends Repository<BulkPerfUser> {
  constructor() { super(BulkPerfUser); }
}

const SUITE = 'bulk-create';
const RECORD_BASELINE = process.env.RECORD_BASELINE === '1';

const ROWS = 500;
const CHUNK = 250;

describe('Bulk create performance', () => {
  const results: BenchResult[] = [];
  const repo = new BulkPerfUserRepo();
  let nextId = 100000;

  function makeRows(n: number): any[] {
    const out = new Array(n);
    for (let i = 0; i < n; i += 1) {
      const id = nextId++;
      out[i] = { id, name: `User ${id}`, email: `u${id}@x.com`, age: 20 + (id % 50) };
    }
    return out;
  }

  beforeAll(async () => {
    await startDatabase();
    await execute(adaptSqlForCurrentDriver(`
      CREATE TABLE "bulk_perf_user" (
        ${getSerial('id')},
        "name" varchar(255) NOT NULL,
        "email" varchar(255) NOT NULL,
        "age" integer NOT NULL,
        "status" varchar(50) NOT NULL
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

  test(`sequential create x ${ROWS}`, async () => {
    const r = await bench('sequential-create', async () => {
      const rows = makeRows(ROWS);
      for (let i = 0; i < rows.length; i += 1) {
        await BulkPerfUser.create(rows[i]);
      }
    }, { iterations: 1, warmup: 0, perIteration: true });
    results.push(r);
    logResult(r);
    // Cleanup
    await execute('DELETE FROM "bulk_perf_user"');
  }, 60000);

  test(`bulkCreate x ${ROWS} (chunkSize=${CHUNK})`, async () => {
    let bulkInserted = 0;
    const r = await bench('bulk-create', async () => {
      const rows = makeRows(ROWS);
      const out = await repo.bulkCreate(rows, { chunkSize: CHUNK });
      bulkInserted = out.length;
    }, { iterations: 3, warmup: 1, perIteration: true });
    expect(bulkInserted).toBe(ROWS);
    results.push(r);
    logResult(r);
    await execute('DELETE FROM "bulk_perf_user"');
  }, 60000);

  test(`speedup: bulk vs sequential >= 5x`, () => {
    const seq = results.find((r) => r.name === 'sequential-create');
    const bulk = results.find((r) => r.name === 'bulk-create');
    expect(seq).toBeDefined();
    expect(bulk).toBeDefined();
    const speedup = seq!.avgMs / bulk!.avgMs;
    // eslint-disable-next-line no-console
    console.log(`[perf] bulkCreate speedup vs sequential: ${speedup.toFixed(2)}x (seq=${seq!.avgMs.toFixed(1)}ms bulk=${bulk!.avgMs.toFixed(1)}ms for ${ROWS} rows)`);
    // Conservative threshold; in practice we observe 20-50x.
    expect(speedup).toBeGreaterThan(5);
  });
});
