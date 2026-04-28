/**
 * Pure CPU micro-benchmarks for ORM hot paths that are normally dominated
 * by DB latency in end-to-end tests. These directly exercise the in-memory
 * code paths (ValueProcessor, SqlBuilder fragments, EntityMetadataIndex).
 *
 * Run with `bun test packages/orm/test/performance/cpu-microbench.perf.spec.ts`.
 */
import { afterAll, beforeAll, describe, test } from 'bun:test';
import { BaseEntity, Entity, PrimaryKey, Property, ManyToOne, EntityStorage } from '../../src';
import { ValueProcessor } from '../../src/utils/value-processor';
import { bench, logResult, readBaseline, writeBaseline, compare, type BenchResult } from './_perf-helper';

@Entity()
class CpuCompany extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;
}

@Entity()
class CpuUser extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  firstName: string;

  @Property()
  lastName: string;

  @Property()
  email: string;

  @Property()
  age: number;

  @Property({ default: () => true })
  active: boolean;

  @Property({ onInsert: () => new Date('2026-01-01T00:00:00Z') })
  createdAt: Date;

  @Property({ onUpdate: () => new Date('2026-01-01T00:00:00Z') })
  updatedAt: Date;

  @Property()
  companyId: number;

  @ManyToOne(() => CpuCompany)
  company: CpuCompany;
}

const SUITE = 'cpu-microbench';
const RECORD_BASELINE = process.env.RECORD_BASELINE === '1';

describe('ORM CPU micro-benchmarks', () => {
  const results: BenchResult[] = [];
  let userOptions: any;

  beforeAll(() => {
    // Force decorators to run by referencing the classes.
    void CpuCompany;
    void CpuUser;

    // Manually register entities into a fresh EntityStorage. We don't need
    // the OrmService here — the storage is the only thing ValueProcessor
    // and SqlBuilder consume on the hot paths under test.
    const storage = new EntityStorage();
    // Trigger registration via the global decorator side effects + add()
    // by invoking the same path OrmService does. Easiest: just construct
    // the metadata storage manually using Reflect.
    const Metadata = require('@carno.js/core').Metadata;
    const entities = (Metadata.get('carno:entities', Reflect) || []) as any[];

    for (const entry of entities) {
      const target = entry.target;
      const properties = Metadata.get('carno:properties:metadata', target) || {};
      // Default columnNames if missing (mirrors what OrmService does).
      for (const k of Object.keys(properties)) {
        const opts = properties[k].options;
        if (!opts.columnName) {
          opts.columnName = k.replace(/[A-Z]/g, (m: string, i: number) => (i ? '_' : '') + m.toLowerCase());
        }
      }
      const relations = Metadata.get('carno:properties:relations', target) || [];
      for (const r of relations) {
        if (!r.columnName) {
          r.columnName = String(r.propertyKey).replace(/[A-Z]/g, (m: string, i: number) => (i ? '_' : '') + m.toLowerCase()) + '_id';
        }
      }
      storage.add({ target, options: entry.options || {} }, properties, relations, []);
    }

    userOptions = storage.get(CpuUser);
    if (!userOptions) {
      throw new Error('Failed to register CpuUser for micro-benchmark');
    }
  });

  afterAll(() => {
    const baseline = readBaseline(SUITE, 'cpu');
    if (baseline) {
      for (const r of results) {
        const prev = baseline.results[r.name];
        if (!prev) continue;
        compare(r.name, prev.avgMs, r.avgMs);
      }
    }
    if (RECORD_BASELINE) {
      writeBaseline(SUITE, 'cpu', results);
    }
  });

  test('ValueProcessor.processForInsert (10 fields) x 10000', async () => {
    const sample: any = {
      id: 1,
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@example.com',
      age: 30,
      companyId: 1,
    };

    const r = await bench('processForInsert-10k', () => {
      ValueProcessor.processForInsert(sample, userOptions);
    }, { iterations: 10000, warmup: 500, perIteration: false });
    results.push(r);
    logResult(r);
  });

  test('ValueProcessor.processForUpdate (3 fields) x 10000', async () => {
    const sample: any = { firstName: 'Alice', age: 31, lastName: 'Smith' };

    const r = await bench('processForUpdate-10k', () => {
      ValueProcessor.processForUpdate(sample, userOptions);
    }, { iterations: 10000, warmup: 500, perIteration: false });
    results.push(r);
    logResult(r);
  });

  test('ValueProcessor.createInstance (insert moment) x 10000', async () => {
    const dbRow: any = {
      id: 1,
      first_name: 'Alice',
      last_name: 'Smith',
      email: 'alice@example.com',
      age: 30,
      active: true,
      company_id: 1,
    };

    const r = await bench('createInstance-10k', () => {
      ValueProcessor.createInstance(dbRow, CpuUser, 'insert');
    }, { iterations: 10000, warmup: 500, perIteration: false });
    results.push(r);
    logResult(r);
  });

  test('ValueProcessor.getColumnName x 100000', async () => {
    const r = await bench('getColumnName-100k', () => {
      ValueProcessor.getColumnName('firstName', userOptions);
      ValueProcessor.getColumnName('lastName', userOptions);
      ValueProcessor.getColumnName('email', userOptions);
      ValueProcessor.getColumnName('companyId', userOptions);
    }, { iterations: 100000, warmup: 1000, perIteration: false });
    results.push(r);
    logResult(r);
  });
});
