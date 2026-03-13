import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import {
  BaseEntity,
  Entity,
  PrimaryKey,
  Property,
  Repository,
} from '../../src';
import { Version } from '../../src/decorators/version.decorator';
import { OptimisticLockError } from '../../src/exceptions/optimistic-lock.error';

// ─── DDL ────────────────────────────────────────────────────────────────────

const DDL_PRODUCTS = `
  CREATE TABLE "versioned_product" (
    "id" SERIAL PRIMARY KEY,
    "name" varchar(255) NOT NULL,
    "price" integer NOT NULL DEFAULT 0,
    "lock_version" integer NOT NULL DEFAULT 0
  );
`;

const DDL_ORDERS = `
  CREATE TABLE "versioned_order" (
    "id" SERIAL PRIMARY KEY,
    "product_id" integer NOT NULL,
    "quantity" integer NOT NULL DEFAULT 1,
    "row_version" integer NOT NULL DEFAULT 0
  );
`;

// ─── Entities ────────────────────────────────────────────────────────────────

@Entity({ tableName: 'versioned_product' })
class VersionedProduct extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  name: string;

  @Property()
  price: number;

  @Property({ columnName: 'lock_version' })
  @Version()
  lockVersion: number;
}

@Entity({ tableName: 'versioned_order' })
class VersionedOrder extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property({ columnName: 'product_id' })
  productId: number;

  @Property()
  quantity: number;

  @Property({ columnName: 'row_version' })
  @Version()
  rowVersion: number;
}

class ProductRepository extends Repository<VersionedProduct> {
  constructor() {
    super(VersionedProduct);
  }
}

class OrderRepository extends Repository<VersionedOrder> {
  constructor() {
    super(VersionedOrder);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('@Version / Optimistic Locking', () => {
  let productRepo: ProductRepository;
  let orderRepo: OrderRepository;

  beforeEach(async () => {
    await startDatabase();
    await execute(DDL_PRODUCTS);
    await execute(DDL_ORDERS);
    productRepo = new ProductRepository();
    orderRepo = new OrderRepository();
  });

  afterEach(async () => {
    await purgeDatabase();
    await app?.disconnect();
  });

  // ── Decorator Unit behaviour (metadata level) ────────────────────────────

  describe('Metadata', () => {
    test('VersionedProduct should have @Version metadata registered on lockVersion', async () => {
      const { Metadata } = await import('@carno.js/core');
      const { VERSION_PROPERTY } = await import('../../src/constants');
      const prop = Metadata.get(VERSION_PROPERTY, VersionedProduct);
      expect(prop).toBe('lockVersion');
    });

    test('VersionedOrder should have @Version metadata registered on rowVersion', async () => {
      const { Metadata } = await import('@carno.js/core');
      const { VERSION_PROPERTY } = await import('../../src/constants');
      const prop = Metadata.get(VERSION_PROPERTY, VersionedOrder);
      expect(prop).toBe('rowVersion');
    });
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  describe('Happy path', () => {
    test('should create a product with version = 0', async () => {
      const product = await productRepo.create({
        name: 'Widget',
        price: 100,
        lockVersion: 0,
      });

      expect(product.id).toBeGreaterThan(0);
      expect(product.lockVersion).toBe(0);
    });

    test('should auto-increment version on update and succeed', async () => {
      // Arrange
      await execute(`INSERT INTO "versioned_product" ("name", "price", "lock_version") VALUES ('Gadget', 200, 0)`);
      const product = await productRepo.findOne({ where: { name: 'Gadget' } });
      expect(product).toBeDefined();
      expect(product!.lockVersion).toBe(0);

      // Act – update with the current version (0). The ORM should set WHERE lock_version = 0 and SET lock_version = 1
      await productRepo.update(
        { id: product!.id },
        { name: 'Gadget v2', lockVersion: product!.lockVersion },
      );

      // Assert – row in DB should now have version 1
      const dbRow = await execute(`SELECT lock_version FROM "versioned_product" WHERE id = ${product!.id}`);
      expect(Number(dbRow.rows[0].lock_version)).toBe(1);
    });

    test('should allow sequential updates, each incrementing version', async () => {
      // Arrange
      await execute(`INSERT INTO "versioned_product" ("name","price","lock_version") VALUES ('Seq', 10, 0)`);

      for (let round = 0; round < 3; round++) {
        const current = await productRepo.findOne({ where: { name: 'Seq' } });
        expect(current!.lockVersion).toBe(round);

        await productRepo.update(
          { id: current!.id },
          { price: (round + 1) * 10, lockVersion: current!.lockVersion },
        );
      }

      const final = await productRepo.findOne({ where: { name: 'Seq' } });
      expect(final!.lockVersion).toBe(3);
    });

    test('should work independently per entity: VersionedOrder increments rowVersion', async () => {
      await execute(`INSERT INTO "versioned_order" ("product_id","quantity","row_version") VALUES (1, 5, 0)`);
      const order = await orderRepo.findOne({ where: { productId: 1 } });

      await orderRepo.update(
        { id: order!.id },
        { quantity: 10, rowVersion: order!.rowVersion },
      );

      const updated = await orderRepo.findOne({ where: { id: order!.id } });
      expect(updated!.rowVersion).toBe(1);
      expect(updated!.quantity).toBe(10);
    });
  });

  // ── Optimistic lock conflicts ────────────────────────────────────────────

  describe('OptimisticLockError', () => {
    test('should throw OptimisticLockError when version is stale (concurrent update)', async () => {
      // Arrange: create a product at version 0
      await execute(`INSERT INTO "versioned_product" ("name","price","lock_version") VALUES ('Conflict', 50, 0)`);
      const product = await productRepo.findOne({ where: { name: 'Conflict' } });
      expect(product!.lockVersion).toBe(0);

      // Simulate "first client" updates successfully → DB version becomes 1
      await productRepo.update(
        { id: product!.id },
        { price: 60, lockVersion: product!.lockVersion },
      );

      // "Second client" still holds the stale version (0) and tries to update
      await expect(
        productRepo.update(
          { id: product!.id },
          { price: 999, lockVersion: 0 /* stale version */ },
        )
      ).rejects.toBeInstanceOf(OptimisticLockError);
    });

    test('OptimisticLockError should carry a meaningful message', async () => {
      await execute(`INSERT INTO "versioned_product" ("name","price","lock_version") VALUES ('MsgTest', 1, 5)`);
      const p = await productRepo.findOne({ where: { name: 'MsgTest' } });

      // Move version forward without going through the ORM (simulating out-of-band mutation)
      await execute(`UPDATE "versioned_product" SET lock_version = 6 WHERE id = ${p!.id}`);

      try {
        await productRepo.update({ id: p!.id }, { price: 2, lockVersion: 5 });
        throw new Error('Expected OptimisticLockError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(OptimisticLockError);
        expect(err.message).toContain('VersionedProduct');
        expect(err.name).toBe('OptimisticLockError');
      }
    });

    test('should throw OptimisticLockError when version mismatch in VersionedOrder', async () => {
      await execute(`INSERT INTO "versioned_order" ("product_id","quantity","row_version") VALUES (1, 1, 0)`);
      const order = await orderRepo.findOne({ where: { productId: 1 } });

      // Advance version externally
      await execute(`UPDATE "versioned_order" SET row_version = 1 WHERE id = ${order!.id}`);

      await expect(
        orderRepo.update({ id: order!.id }, { quantity: 99, rowVersion: 0 })
      ).rejects.toBeInstanceOf(OptimisticLockError);
    });

    test('should NOT throw when update matches no rows for a non-versioned entity', async () => {
      // When lockVersion is NOT included in the update payload, version locking is
      // skipped entirely — even if the entity class declares @Version.
      // Therefore zero-affected-rows must NOT throw OptimisticLockError.
      await expect(
        productRepo.update({ id: 99999 } as any, { price: 999 })
        // Note: no lockVersion provided → version locking not applied → silent no-op
      ).resolves.toBeUndefined();
    });
  });

  // ── OptimisticLockError class ────────────────────────────────────────────

  describe('OptimisticLockError class', () => {
    test('should be an instance of Error', () => {
      const err = new OptimisticLockError('MyEntity', 42);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(OptimisticLockError);
    });

    test('should have correct name', () => {
      const err = new OptimisticLockError('MyEntity', 42);
      expect(err.name).toBe('OptimisticLockError');
    });

    test('should include entity name and id in message', () => {
      const err = new OptimisticLockError('Product', 7);
      expect(err.message).toContain('Product');
      expect(err.message).toContain('7');
    });

    test('should work with string IDs', () => {
      const err = new OptimisticLockError('UserAccount', 'uuid-abc-123');
      expect(err.message).toContain('uuid-abc-123');
    });
  });
});
