/**
 * Read Replica Routing Tests
 *
 * These tests verify that the driver correctly routes:
 *  - SELECT/COUNT statements → read replica (Round-Robin)
 *  - INSERT/UPDATE/DELETE statements → primary
 *  - All statements → primary when _replicas is empty
 *  - All statements within a transaction → primary (regardless of type)
 *
 * Because we cannot spin up a real second DB in this environment, replicas are
 * replaced with thin mocks that record every SQL string passed to `.unsafe()`.
 * The real primary connection is kept alive so that DDL / writes still succeed.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { SQL } from 'bun';
import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import {
  BaseEntity,
  Entity,
  PrimaryKey,
  Property,
  Repository,
} from '../../src';
import { ConnectionSettings } from '../../src/driver/driver.interface';

// ─── Helper: thin SQL mock that tracks calls ──────────────────────────────────

interface MockSql {
  calls: string[];
  unsafe(sql: string): Promise<any>;
  close(): Promise<void>;
}

function createMockReplica(name: string): MockSql & SQL {
  const calls: string[] = [];

  // Return an array-like object with `.count` for DML results (mirrors Bun SQL DML return)
  const emptyResult = Object.assign([], { count: 0 });

  return {
    name,
    calls,
    async unsafe(sql: string) {
      calls.push(sql);
      return emptyResult;
    },
    async close() {},
  } as unknown as MockSql & SQL;
}

// Expose protected fields for testing — use `any` casting to bypass private access
type DriverInternals = {
  _replicas: (MockSql & SQL)[];
  _replicaIndex: number;
  sql: SQL & { calls?: string[] };
  disconnect(): Promise<void>;
  connect(): Promise<void>;
};

// ─── DDL ─────────────────────────────────────────────────────────────────────

const DDL_ARTICLES = `
  CREATE TABLE "replica_article" (
    "id" SERIAL PRIMARY KEY,
    "title" varchar(255) NOT NULL
  );
`;

// ─── Entity & Repository ─────────────────────────────────────────────────────

@Entity({ tableName: 'replica_article' })
class ReplicaArticle extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  title: string;
}

class ArticleRepository extends Repository<ReplicaArticle> {
  constructor() {
    super(ReplicaArticle);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Read Replica Routing', () => {
  let repo: ArticleRepository;
  let driver: DriverInternals;

  beforeEach(async () => {
    await startDatabase();
    await execute(DDL_ARTICLES);
    repo = new ArticleRepository();
    driver = app.driverInstance as unknown as DriverInternals;
  });

  afterEach(async () => {
    // Guard against driver being undefined if beforeEach threw
    if (driver) driver._replicas = [];
    await purgeDatabase();
    await app?.disconnect();
  });

  // ── ConnectionSettings type accepts replicas ──────────────────────────────

  describe('ConnectionSettings', () => {
    test('replicas field is accepted as a partial ConnectionSettings array', () => {
      const settings: ConnectionSettings = {
        host: 'localhost',
        port: 5433,
        username: 'postgres',
        password: 'postgres',
        database: 'postgres',
        driver: (app.driverInstance as any).constructor,
        replicas: [
          { host: 'replica-1', port: 5434 },
          { host: 'replica-2', port: 5435 },
        ],
      };

      expect(settings.replicas).toHaveLength(2);
      expect(settings.replicas?.[0].host).toBe('replica-1');
      expect(settings.replicas?.[1].host).toBe('replica-2');
    });

    test('replicas field is optional', () => {
      const settings: ConnectionSettings = {
        host: 'localhost',
        port: 5433,
        username: 'postgres',
        password: 'postgres',
        database: 'postgres',
        driver: (app.driverInstance as any).constructor,
      };

      expect(settings.replicas).toBeUndefined();
    });
  });

  // ── No replicas configured ────────────────────────────────────────────────

  describe('No replicas configured (primary only)', () => {
    test('_replicas is empty after normal startDatabase()', () => {
      expect(driver._replicas).toHaveLength(0);
    });

    test('SELECT goes to primary when _replicas is empty', async () => {
      await execute(`INSERT INTO "replica_article" ("title") VALUES ('Article 1')`);

      // Spy on the primary SQL instance
      const primarySpy = spyOn(driver.sql, 'unsafe');

      const results = await repo.find({ where: {} as any });

      // Should have called the primary directly
      expect(primarySpy).toHaveBeenCalled();
      expect(results).toHaveLength(1);
    });

    test('INSERT goes to primary when _replicas is empty', async () => {
      const primarySpy = spyOn(driver.sql, 'unsafe');

      await repo.create({ title: 'Primary write' });

      expect(primarySpy).toHaveBeenCalled();
    });
  });

  // ── SELECT routing to replica ─────────────────────────────────────────────

  describe('SELECT routing', () => {
    test('find() routes SELECT to replica when replica is configured', async () => {
      const replica = createMockReplica('replica-0');
      driver._replicas = [replica];

      await repo.find({ where: {} as any });

      expect(replica.calls).toHaveLength(1);
      expect(replica.calls[0]).toMatch(/SELECT/i);
    });

    test('findOne() routes SELECT to replica', async () => {
      const replica = createMockReplica('replica-0');
      driver._replicas = [replica];

      await repo.findOne({ where: {} as any });

      expect(replica.calls.some(c => /SELECT/i.test(c))).toBe(true);
    });

    test('count() routes COUNT to replica', async () => {
      const replica = createMockReplica('replica-0');
      driver._replicas = [replica];

      await repo.count({} as any);

      expect(replica.calls).toHaveLength(1);
      expect(replica.calls[0]).toMatch(/COUNT/i);
    });
  });

  // ── Write routing stays on primary ───────────────────────────────────────

  describe('Write routing (INSERT / UPDATE / DELETE → primary)', () => {
    test('create() (INSERT) goes to primary even when replicas exist', async () => {
      const replica = createMockReplica('replica-0');
      driver._replicas = [replica];

      const primarySpy = spyOn(driver.sql, 'unsafe');

      await repo.create({ title: 'New article' });

      // Primary was called for the INSERT
      expect(primarySpy).toHaveBeenCalled();
      const calls = primarySpy.mock.calls.map((c: any) => c[0] as string);
      expect(calls.some(s => /INSERT/i.test(s))).toBe(true);

      // Replica was NOT used for INSERT
      expect(replica.calls.some(s => /INSERT/i.test(s))).toBe(false);
    });

    test('update() goes to primary even when replicas exist', async () => {
      await execute(`INSERT INTO "replica_article" ("title") VALUES ('Old')`);

      const replica = createMockReplica('replica-0');
      driver._replicas = [replica];

      const primarySpy = spyOn(driver.sql, 'unsafe');

      await repo.update({} as any, { title: 'New' });

      const calls = primarySpy.mock.calls.map((c: any) => c[0] as string);
      expect(calls.some(s => /UPDATE/i.test(s))).toBe(true);
      expect(replica.calls.some(s => /UPDATE/i.test(s))).toBe(false);
    });

    test('delete() goes to primary even when replicas exist', async () => {
      await execute(`INSERT INTO "replica_article" ("title") VALUES ('To delete')`);

      const replica = createMockReplica('replica-0');
      driver._replicas = [replica];

      const primarySpy = spyOn(driver.sql, 'unsafe');

      await repo.delete({} as any);

      const calls = primarySpy.mock.calls.map((c: any) => c[0] as string);
      expect(calls.some(s => /DELETE/i.test(s))).toBe(true);
      expect(replica.calls.some(s => /DELETE/i.test(s))).toBe(false);
    });
  });

  // ── Round-Robin across multiple replicas ──────────────────────────────────

  describe('Round-Robin distribution', () => {
    test('requests are distributed Round-Robin across 2 replicas', async () => {
      const replica0 = createMockReplica('replica-0');
      const replica1 = createMockReplica('replica-1');
      driver._replicas = [replica0, replica1];
      driver._replicaIndex = 0;

      // Execute 4 SELECTs → should alternate r0, r1, r0, r1
      for (let i = 0; i < 4; i++) {
        await repo.find({ where: {} as any });
      }

      expect(replica0.calls).toHaveLength(2);
      expect(replica1.calls).toHaveLength(2);
    });

    test('Round-Robin index wraps around correctly for 3 replicas', async () => {
      const replicas = [
        createMockReplica('r0'),
        createMockReplica('r1'),
        createMockReplica('r2'),
      ];
      driver._replicas = replicas;
      driver._replicaIndex = 0;

      // 9 SELECT requests → 3 per replica
      for (let i = 0; i < 9; i++) {
        await repo.find({ where: {} as any });
      }

      for (const r of replicas) {
        expect(r.calls).toHaveLength(3);
      }
    });

    test('_replicaIndex is correctly advanced by getExecutionContext', async () => {
      const replica0 = createMockReplica('r0');
      const replica1 = createMockReplica('r1');
      driver._replicas = [replica0, replica1];
      driver._replicaIndex = 0;

      await repo.find({ where: {} as any }); // uses replica0
      expect(driver._replicaIndex).toBe(1);

      await repo.find({ where: {} as any }); // uses replica1
      expect(driver._replicaIndex).toBe(0); // wraps back to 0
    });
  });

  // ── Transaction context pins to primary ───────────────────────────────────

  describe('Transaction pinning', () => {
    test('SELECT inside a transaction goes to primary, not replica', async () => {
      await execute(`INSERT INTO "replica_article" ("title") VALUES ('TX article')`);

      const replica = createMockReplica('replica-0');
      driver._replicas = [replica];

      // Use app.transaction() which wraps the callback in transactionContext,
      // so getExecutionContext() sees the transaction and bypasses replica routing.
      // Using repo.find() avoids driver-specific raw SQL quoting ("..." vs `...`).
      await app.transaction(async () => {
        await repo.find({ where: {} as any });
      });

      // Replica should have 0 calls: transactionContext.getContext() returns the
      // primary's transaction connection, which short-circuits replica selection.
      expect(replica.calls).toHaveLength(0);
    });
  });

  // ── disconnect() cleans up replicas ──────────────────────────────────────

  describe('Cleanup', () => {
    test('disconnect() empties the _replicas array', async () => {
      // Use a separate, short-lived driver so the shared test app is not disrupted
      const { getDriverClass, getDriverType, getDefaultConnectionSettings } =
        await import('../../src/driver/driver-factory');
      const driverType = getDriverType();
      const DriverClass = getDriverClass(driverType);
      const settings = getDefaultConnectionSettings(driverType);

      const freshDriver = new DriverClass({ ...settings, driver: DriverClass } as any) as unknown as DriverInternals;
      await (freshDriver as any).connect();

      const r0 = createMockReplica('r0');
      const r1 = createMockReplica('r1');
      freshDriver._replicas = [r0, r1];
      expect(freshDriver._replicas).toHaveLength(2);

      await (freshDriver as any).disconnect();

      expect(freshDriver._replicas).toHaveLength(0);
    });
  });
});
