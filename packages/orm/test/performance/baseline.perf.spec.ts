import { afterAll, beforeAll, describe, test } from 'bun:test';
import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import { BaseEntity, Entity, PrimaryKey, Property, ManyToOne } from '../../src';
import { bench, currentDriver, logResult, readBaseline, writeBaseline, compare, BenchResult } from './_perf-helper';

@Entity()
class PerfCompany extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;
}

@Entity()
class PerfUser extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;

  @Property()
  email: string;

  @Property()
  age: number;

  @Property()
  companyId: number;

  @ManyToOne(() => PerfCompany)
  company: PerfCompany;
}

const SUITE = 'baseline';
const RECORD_BASELINE = process.env.RECORD_BASELINE === '1';
const REGRESSION_THRESHOLD_PCT = Number(process.env.PERF_REGRESSION_THRESHOLD || '15');

describe('ORM Performance Baseline', () => {
  const results: BenchResult[] = [];

  beforeAll(async () => {
    await startDatabase();

    await execute(`
      CREATE TABLE "perf_company" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar(255) NOT NULL
      );
    `);

    await execute(`
      CREATE TABLE "perf_user" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar(255) NOT NULL,
        "email" varchar(255) NOT NULL,
        "age" integer NOT NULL,
        "company_id" integer REFERENCES "perf_company"("id")
      );
    `);

    // Seed: 5 companies, 200 users (40 per company) — enough for joined finds without
    // dominating runtime with massive setup.
    for (let c = 1; c <= 5; c += 1) {
      await PerfCompany.create({ id: c, name: `Company ${c}` });
    }
    for (let u = 1; u <= 200; u += 1) {
      await PerfUser.create({
        id: u,
        name: `User ${u}`,
        email: `user${u}@example.com`,
        age: 20 + (u % 50),
        companyId: ((u - 1) % 5) + 1,
      });
    }
  });

  afterAll(async () => {
    const driver = currentDriver();

    // Compare against stored baseline (if any).
    const baseline = readBaseline(SUITE, driver);
    if (baseline) {
      for (const r of results) {
        const prev = baseline.results[r.name];
        if (!prev) continue;
        compare(r.name, prev.avgMs, r.avgMs);
      }
    } else {
      // eslint-disable-next-line no-console
      console.log(`[perf] No baseline stored for suite=${SUITE} driver=${driver}. Run with RECORD_BASELINE=1 to create one.`);
    }

    if (RECORD_BASELINE) {
      writeBaseline(SUITE, driver, results);
      // eslint-disable-next-line no-console
      console.log(`[perf] Baseline saved for suite=${SUITE} driver=${driver}`);
    }

    await purgeDatabase();
    await app?.disconnect();
  });

  test('findOne by id x 200', async () => {
    const r = await bench('findOne-by-id', async () => {
      const id = 1 + ((Math.random() * 200) | 0);
      await PerfUser.findOne({ id });
    }, { iterations: 200, warmup: 20 });
    results.push(r);
    logResult(r);
  });

  test('findAll(200) x 30', async () => {
    const r = await bench('findAll-200', async () => {
      await PerfUser.findAll({});
    }, { iterations: 30, warmup: 5 });
    results.push(r);
    logResult(r);
  });

  test('findAll with 1 join x 30', async () => {
    const r = await bench('findAll-with-join', async () => {
      await PerfUser.findAll({ load: ['company'] });
    }, { iterations: 30, warmup: 5 });
    results.push(r);
    logResult(r);
  });

  test('find with where x 100', async () => {
    const r = await bench('find-where', async () => {
      await PerfUser.find({ age: 25 });
    }, { iterations: 100, warmup: 10 });
    results.push(r);
    logResult(r);
  });

  test('create x 100 (sequential)', async () => {
    let next = 10000;
    const r = await bench('create-sequential', async () => {
      const id = next++;
      await PerfUser.create({
        id,
        name: `seq ${id}`,
        email: `seq${id}@example.com`,
        age: 30,
        companyId: 1,
      });
    }, { iterations: 100, warmup: 5 });
    results.push(r);
    logResult(r);
  });

  test('update x 100 (sequential)', async () => {
    const r = await bench('update-sequential', async () => {
      const id = 1 + (Math.random() * 200) | 0;
      await PerfUser.update({ id }, { age: 30 + (id % 20) });
    }, { iterations: 100, warmup: 5 });
    results.push(r);
    logResult(r);
  });
});
