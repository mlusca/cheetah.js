import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import {
  BaseEntity,
  Entity,
  PrimaryKey,
  Property,
  Repository,
} from '../../src';
import { Tenant } from '../../src/decorators/tenant.decorator';
import { tenantContext } from '../../src/tenant/tenant-context';

// ─── DDL ────────────────────────────────────────────────────────────────────

const DDL_POSTS = `
  CREATE TABLE "tenant_post" (
    "id" SERIAL PRIMARY KEY,
    "title" varchar(255) NOT NULL,
    "tenant_id" integer NOT NULL
  );
`;

const DDL_INVOICES = `
  CREATE TABLE "tenant_invoice" (
    "id" SERIAL PRIMARY KEY,
    "amount" integer NOT NULL DEFAULT 0,
    "tenant_id" varchar(64) NOT NULL
  );
`;

// This table has NO tenant_id column intentionally.
const DDL_SHARED = `
  CREATE TABLE "shared_config" (
    "id" SERIAL PRIMARY KEY,
    "key" varchar(255) NOT NULL,
    "value" varchar(255) NOT NULL
  );
`;

// ─── Entities ────────────────────────────────────────────────────────────────

@Entity({ tableName: 'tenant_post' })
class TenantPost extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  title: string;

  @Property({ columnName: 'tenant_id' })
  @Tenant()
  tenantId: number;
}

// Entity WITHOUT @Tenant — should never have tenant conditions injected
@Entity({ tableName: 'shared_config' })
class SharedConfig extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  key: string;

  @Property()
  value: string;
}

class SharedConfigRepository extends Repository<SharedConfig> {
  constructor() {
    super(SharedConfig);
  }
}

@Entity({ tableName: 'tenant_invoice' })
class TenantInvoice extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  amount: number;

  @Property({ columnName: 'tenant_id' })
  @Tenant()
  tenantId: string;
}

class PostRepository extends Repository<TenantPost> {
  constructor() {
    super(TenantPost);
  }
}

class InvoiceRepository extends Repository<TenantInvoice> {
  constructor() {
    super(TenantInvoice);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Tenant Isolation', () => {
  let postRepo: PostRepository;
  let invoiceRepo: InvoiceRepository;
  let sharedRepo: SharedConfigRepository;

  beforeEach(async () => {
    await startDatabase();
    await execute(DDL_POSTS);
    await execute(DDL_INVOICES);
    await execute(DDL_SHARED);
    postRepo = new PostRepository();
    invoiceRepo = new InvoiceRepository();
    sharedRepo = new SharedConfigRepository();
  });

  afterEach(async () => {
    await purgeDatabase();
    await app?.disconnect();
  });

  // ── TenantContext unit tests ──────────────────────────────────────────────

  describe('TenantContextManager', () => {
    test('getTenantId returns undefined when no context is active', () => {
      // Outside any tenantContext.run() call
      expect(tenantContext.getTenantId()).toBeUndefined();
    });

    test('hasContext returns false when no context is active', () => {
      expect(tenantContext.hasContext()).toBe(false);
    });

    test('getTenantId returns the tenant ID inside run()', async () => {
      let capturedId: string | number | undefined;

      await tenantContext.run(42, async () => {
        capturedId = tenantContext.getTenantId();
      });

      expect(capturedId).toBe(42);
    });

    test('hasContext returns true inside run()', async () => {
      let hasCtx: boolean = false;

      await tenantContext.run(1, async () => {
        hasCtx = tenantContext.hasContext();
      });

      expect(hasCtx).toBe(true);
    });

    test('getTenantId returns undefined AFTER run() completes (no leak)', async () => {
      await tenantContext.run(10, async () => {
        // Inside: context is active
      });

      // Outside: context must be cleared
      expect(tenantContext.getTenantId()).toBeUndefined();
    });

    test('nested tenantContext.run() uses the inner value', async () => {
      let inner: string | number | undefined;
      let outer: string | number | undefined;

      await tenantContext.run(1, async () => {
        outer = tenantContext.getTenantId();

        await tenantContext.run(2, async () => {
          inner = tenantContext.getTenantId();
        });
      });

      expect(outer).toBe(1);
      expect(inner).toBe(2);
    });

    test('supports string tenant IDs', async () => {
      let id: string | number | undefined;

      await tenantContext.run('org-abc', async () => {
        id = tenantContext.getTenantId();
      });

      expect(id).toBe('org-abc');
    });
  });

  // ── SELECT isolation ─────────────────────────────────────────────────────

  describe('SELECT isolation', () => {
    test('SELECT returns only rows belonging to the active tenant', async () => {
      // Seed data for two different tenants
      await execute(`INSERT INTO "tenant_post" ("title","tenant_id") VALUES ('Post A1',1),('Post A2',1),('Post B1',2)`);

      const postsForTenant1 = await tenantContext.run(1, () => postRepo.find({ where: {} as any }));
      const postsForTenant2 = await tenantContext.run(2, () => postRepo.find({ where: {} as any }));

      expect(postsForTenant1).toHaveLength(2);
      expect(postsForTenant1.every(p => p.tenantId === 1)).toBe(true);

      expect(postsForTenant2).toHaveLength(1);
      expect(postsForTenant2[0].tenantId).toBe(2);
    });

    test('SELECT without any tenantContext returns ALL rows', async () => {
      await execute(`INSERT INTO "tenant_post" ("title","tenant_id") VALUES ('X',1),('Y',2),('Z',3)`);

      // No tenantContext → no injection
      const all = await postRepo.find({ where: {} as any });

      expect(all).toHaveLength(3);
    });

    test('findOne respects tenant isolation', async () => {
      await execute(`INSERT INTO "tenant_post" ("title","tenant_id") VALUES ('Private',5),('Also private',5),('Other',9)`);

      const found = await tenantContext.run(5, () => postRepo.findOne({ where: {} as any }));

      expect(found).toBeDefined();
      expect(found!.tenantId).toBe(5);

      const notFound = await tenantContext.run(9, () => postRepo.findOne({ where: { title: 'Private' } as any }));
      expect(notFound).toBeUndefined();
    });

    test('count respects tenant isolation', async () => {
      await execute(`INSERT INTO "tenant_post" ("title","tenant_id") VALUES ('X',10),('Y',10),('Z',11)`);

      const countFor10 = await tenantContext.run(10, () => postRepo.count({} as any));
      const countFor11 = await tenantContext.run(11, () => postRepo.count({} as any));

      expect(countFor10).toBe(2);
      expect(countFor11).toBe(1);
    });
  });

  // ── INSERT isolation ──────────────────────────────────────────────────────

  describe('INSERT isolation', () => {
    test('INSERT auto-assigns tenantId from context when not provided', async () => {
      await tenantContext.run(7, async () => {
        // No tenantId in the create payload → context should inject it
        await postRepo.create({ title: 'Auto-tenant post' } as any);
      });

      // Verify the DB row got the correct tenant_id
      const result = await execute(`SELECT tenant_id FROM "tenant_post" WHERE title = 'Auto-tenant post'`);

      expect(result.rows).toHaveLength(1);
      expect(Number(result.rows[0].tenant_id)).toBe(7);
    });

    test('INSERT uses provided tenantId when it matches context', async () => {
      // When tenant explicitly provided, it should also be stored correctly
      await tenantContext.run(3, async () => {
        await postRepo.create({ title: 'Explicit tenant', tenantId: 3 });
      });

      const result = await execute(`SELECT tenant_id FROM "tenant_post" WHERE title = 'Explicit tenant'`);
      expect(Number(result.rows[0].tenant_id)).toBe(3);
    });
  });

  // ── UPDATE isolation ──────────────────────────────────────────────────────

  describe('UPDATE isolation', () => {
    test('UPDATE restricts to current tenant — does not affect another tenant\'s rows', async () => {
      await execute(`INSERT INTO "tenant_post" ("title","tenant_id") VALUES ('Owned',20),('Foreign',21)`);

      // Tenant 20 tries to update all posts
      await tenantContext.run(20, () =>
        postRepo.update({} as any, { title: 'Changed' }),
      );

      const rows = await execute(`SELECT id, title, tenant_id FROM "tenant_post" ORDER BY id`);

      // Only tenant 20's post should have changed
      const owned = rows.rows.find((r: any) => Number(r.tenant_id) === 20);
      const foreign = rows.rows.find((r: any) => Number(r.tenant_id) === 21);

      expect(owned?.title).toBe('Changed');
      expect(foreign?.title).toBe('Foreign');
    });

    test('UPDATE without tenantContext affects all matching rows', async () => {
      await execute(`INSERT INTO "tenant_post" ("title","tenant_id") VALUES ('A',30),('B',31)`);

      // No tenant context → no filter injected
      await postRepo.update({} as any, { title: 'Updated' });

      const rows = await execute(`SELECT title FROM "tenant_post"`);
      expect(rows.rows.every((r: any) => r.title === 'Updated')).toBe(true);
    });
  });

  // ── DELETE isolation ──────────────────────────────────────────────────────

  describe('DELETE isolation', () => {
    test('DELETE restricts to current tenant', async () => {
      await execute(`INSERT INTO "tenant_post" ("title","tenant_id") VALUES ('Del me',40),('Keep me',41)`);

      await tenantContext.run(40, () => postRepo.delete({} as any));

      const remaining = await execute(`SELECT id FROM "tenant_post"`);
      expect(remaining.rows).toHaveLength(1);
      expect(Number((remaining.rows[0] as any).tenant_id ?? await execute(`SELECT tenant_id FROM "tenant_post"`).then(r => r.rows[0].tenant_id))).not.toBe(40);
    });
  });

  // ── String tenant IDs ─────────────────────────────────────────────────────

  describe('String tenant IDs (TenantInvoice)', () => {
    test('should work with string tenant IDs in SELECT', async () => {
      await execute(`INSERT INTO "tenant_invoice" ("amount","tenant_id") VALUES (100,'org-a'),(200,'org-a'),(300,'org-b')`);

      const orgA = await tenantContext.run('org-a', () => invoiceRepo.find({ where: {} as any }));
      const orgB = await tenantContext.run('org-b', () => invoiceRepo.find({ where: {} as any }));

      expect(orgA).toHaveLength(2);
      expect(orgA.every(i => i.tenantId === 'org-a')).toBe(true);
      expect(orgB).toHaveLength(1);
      expect(orgB[0].tenantId).toBe('org-b');
    });

    test('should isolate string-tenant UPDATE', async () => {
      await execute(`INSERT INTO "tenant_invoice" ("amount","tenant_id") VALUES (10,'shop-1'),(20,'shop-2')`);

      await tenantContext.run('shop-1', () =>
        invoiceRepo.update({} as any, { amount: 999 }),
      );

      const row1 = await execute(`SELECT amount FROM "tenant_invoice" WHERE tenant_id = 'shop-1'`);
      const row2 = await execute(`SELECT amount FROM "tenant_invoice" WHERE tenant_id = 'shop-2'`);

      expect(Number(row1.rows[0].amount)).toBe(999);
      expect(Number(row2.rows[0].amount)).toBe(20); // unchanged
    });
  });

  // ── Entities without @Tenant are unaffected by tenantContext ───────────────

  describe('Entity without @Tenant inside tenantContext', () => {
    test('SELECT on a non-tenant entity returns ALL rows even inside tenantContext.run()', async () => {
      await execute(`INSERT INTO "shared_config" ("key","value") VALUES ('theme','dark'),('lang','en')`);

      // Even with an active tenant context, entities without @Tenant must not receive
      // any tenant condition — they are global/shared tables.
      const rows = await tenantContext.run(99, () => sharedRepo.find({ where: {} as any }));

      expect(rows).toHaveLength(2);
    });

    test('INSERT on a non-tenant entity does NOT inject a tenant column', async () => {
      await tenantContext.run(99, async () => {
        await sharedRepo.create({ key: 'feature_flag', value: 'on' });
      });

      const result = await execute(`SELECT * FROM "shared_config"`);
      // Row must exist and must not have any unexpected extra columns
      expect(result.rows).toHaveLength(1);
      expect((result.rows[0] as any).key).toBe('feature_flag');
    });

    test('UPDATE on a non-tenant entity affects all matching rows, not just one tenant', async () => {
      await execute(`INSERT INTO "shared_config" ("key","value") VALUES ('mode','a'),('mode','b')`);

      // Tenant context is active, but SharedConfig has no @Tenant → no WHERE tenant filter
      await tenantContext.run(42, () =>
        sharedRepo.update({ key: 'mode' } as any, { value: 'updated' }),
      );

      const rows = await execute(`SELECT value FROM "shared_config"`);
      expect(rows.rows.every((r: any) => r.value === 'updated')).toBe(true);
    });

    test('count on a non-tenant entity is not scoped', async () => {
      await execute(`INSERT INTO "shared_config" ("key","value") VALUES ('a','1'),('b','2'),('c','3')`);

      const total = await tenantContext.run(7, () => sharedRepo.count({} as any));

      expect(total).toBe(3);
    });
  });

  // ── @Tenant decorator metadata ────────────────────────────────────────────

  describe('@Tenant decorator metadata', () => {
    test('TenantPost should have TENANT_PROPERTY metadata', async () => {
      const { Metadata } = await import('@carno.js/core');
      const { TENANT_PROPERTY } = await import('../../src/constants');
      expect(Metadata.get(TENANT_PROPERTY, TenantPost)).toBe('tenantId');
    });

    test('TenantInvoice should have TENANT_PROPERTY metadata', async () => {
      const { Metadata } = await import('@carno.js/core');
      const { TENANT_PROPERTY } = await import('../../src/constants');
      expect(Metadata.get(TENANT_PROPERTY, TenantInvoice)).toBe('tenantId');
    });
  });
});
