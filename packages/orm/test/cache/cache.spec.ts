import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { app, cacheService, execute, mockLogger, purgeDatabase, startDatabase } from '../node-database';
import {
  BaseEntity,
  Entity,
  Orm,
  PrimaryKey,
  Property,
  Repository,
} from '../../src';

describe('ORM Cache System', () => {
  const DDL_PRODUCT = `
    CREATE TABLE "product" (
      "id" SERIAL PRIMARY KEY,
      "name" varchar(255) NOT NULL,
      "price" decimal(10, 2) NOT NULL,
      "is_available" boolean DEFAULT true,
      "created_at" timestamp DEFAULT NOW()
    );
  `;

  @Entity()
  class Product extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    name: string;

    @Property()
    price: number;

    @Property()
    isAvailable: boolean;

    @Property()
    createdAt: Date;
  }

  class ProductRepository extends Repository<Product> {
    constructor() {
      super(Product);
    }
  }

  let productRepo: ProductRepository;
  let initialCallCount: number;

  const resetQueryCounter = () => {
    initialCallCount = mockLogger.mock.calls.length;
  };

  const getQueryCount = () => {
    return mockLogger.mock.calls.length - initialCallCount;
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const waitFor = async (
    condition: () => Promise<boolean>,
    timeoutMs: number,
    intervalMs: number = 200,
  ): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await condition()) {
        return true;
      }
      await sleep(intervalMs);
    }

    return false;
  };

  beforeEach(async () => {
    await cacheService.clear();
    expect(cacheService.getDriver().name).toBe('MemoryDriver');
    await startDatabase();
    await execute(DDL_PRODUCT);
    productRepo = new ProductRepository();
    resetQueryCounter();
  });

  afterEach(async () => {
    await purgeDatabase();
    await app?.disconnect();
  });

  describe('Cache with TTL (cache: number)', () => {
    test('should cache query result with TTL', async () => {
      // Given
      resetQueryCounter();
      const product = await productRepo.create({
        name: 'Laptop',
        price: 1000,
        isAvailable: true,
      });
      resetQueryCounter();

      // When - First call (should hit database)
      const firstCall = await productRepo.find({
        where: { name: 'Laptop' },
        cache: 5000,
      });

      const queriesAfterFirst = getQueryCount();

      // When - Second call (should return from cache)
      const secondCall = await productRepo.find({
        where: { name: 'Laptop' },
        cache: 5000,
      });

      const queriesAfterSecond = getQueryCount();

      // Then
      expect(firstCall).toBeDefined();
      expect(firstCall.length).toBe(1);
      expect(firstCall[0].name).toBe('Laptop');
      expect(secondCall).toBeDefined();
      expect(secondCall.length).toBe(1);
      expect(secondCall[0].id).toBe(product.id);
      expect(queriesAfterFirst).toBe(1);
      expect(queriesAfterSecond).toBe(1);
    });

    test('should expire cache after TTL', async () => {
      // Given
      const product = await productRepo.create({
        name: 'Mouse',
        price: 50,
      });
      const currentApp = app;
      const ttl = 1000;

      // When - First call (should cache "Mouse")
      Orm.instance = currentApp;
      const firstCall = await productRepo.findById(product.id, {
        cache: ttl,
      });

      // Update data directly in DB to avoid ORM cache invalidation on write
      await currentApp.driverInstance.executeSql(
        `UPDATE product SET name = 'Mouse Updated' WHERE id = ${product.id};`
      );

      // Still before TTL expiry - should return cached value
      Orm.instance = currentApp;
      const secondCall = await productRepo.findById(product.id, {
        cache: ttl,
      });

      let thirdCall = secondCall;
      const expired = await waitFor(async () => {
        Orm.instance = currentApp;
        thirdCall = await productRepo.findById(product.id, {
          cache: ttl,
        });
        return thirdCall?.name === 'Mouse Updated';
      }, 7000);

      // Then
      expect(firstCall).toBeDefined();
      expect(firstCall!.name).toBe('Mouse');
      expect(secondCall).toBeDefined();
      expect(secondCall!.name).toBe('Mouse');
      expect(expired).toBe(true);
      expect(thirdCall).toBeDefined();
      expect(thirdCall!.name).toBe('Mouse Updated');
    });

    test('should cache findOne with TTL', async () => {
      // Given
      resetQueryCounter();
      const product = await productRepo.create({
        name: 'Keyboard',
        price: 100,
      });
      resetQueryCounter();

      // When - First call
      const firstCall = await productRepo.findOne({
        where: { id: product.id },
        cache: 5000,
      });

      const queriesAfterFirst = getQueryCount();

      // When - Second call (cached)
      const secondCall = await productRepo.findOne({
        where: { id: product.id },
        cache: 5000,
      });

      const queriesAfterSecond = getQueryCount();

      // Then
      expect(firstCall).toBeDefined();
      expect(firstCall!.name).toBe('Keyboard');
      expect(secondCall).toBeDefined();
      expect(secondCall!.id).toBe(product.id);
      expect(queriesAfterFirst).toBe(1);
      expect(queriesAfterSecond).toBe(1);
    });

    test('should cache findById with TTL', async () => {
      // Given
      resetQueryCounter();
      const product = await productRepo.create({
        name: 'Monitor',
        price: 300,
      });
      resetQueryCounter();

      // When - First call
      const firstCall = await productRepo.findById(product.id, {
        cache: 5000,
      });

      const queriesAfterFirst = getQueryCount();

      // When - Second call (cached)
      const secondCall = await productRepo.findById(product.id, {
        cache: 5000,
      });

      const queriesAfterSecond = getQueryCount();

      // Then
      expect(firstCall).toBeDefined();
      expect(firstCall!.name).toBe('Monitor');
      expect(secondCall).toBeDefined();
      expect(secondCall!.id).toBe(product.id);
      expect(queriesAfterFirst).toBe(1);
      expect(queriesAfterSecond).toBe(1);
    });

    test('should respect different cache keys for different queries', async () => {
      // Given
      resetQueryCounter();
      await productRepo.create({ name: 'Product A', price: 100 });
      await productRepo.create({ name: 'Product B', price: 200 });
      resetQueryCounter();

      // When - Two different queries
      const resultA = await productRepo.find({
        where: { name: 'Product A' },
        cache: 5000,
      });

      const queriesAfterA = getQueryCount();

      const resultB = await productRepo.find({
        where: { name: 'Product B' },
        cache: 5000,
      });

      const queriesAfterB = getQueryCount();

      // Then - Each query should execute once (different cache keys)
      expect(resultA.length).toBe(1);
      expect(resultA[0].name).toBe('Product A');
      expect(resultB.length).toBe(1);
      expect(resultB[0].name).toBe('Product B');
      expect(queriesAfterA).toBe(1);
      expect(queriesAfterB).toBe(2);
    });
  });


  describe('Cache with Date (cache: Date)', () => {
    test('should cache query result until Date expires', async () => {
      // Given
      const product = await productRepo.create({ name: 'Keyboard', price: 200 });
      const currentApp = app;
      const expireAt = new Date(Date.now() + 2000);

      // When - First call (should cache original value)
      Orm.instance = currentApp;
      const firstCall = await productRepo.findById(product.id, {
        cache: expireAt,
      });

      // Update data directly in DB to avoid ORM cache invalidation on write
      await currentApp.driverInstance.executeSql(
        `UPDATE product SET name = 'Keyboard Updated' WHERE id = ${product.id};`
      );

      // Before expiry, should still return cached value
      Orm.instance = currentApp;
      const secondCall = await productRepo.findById(product.id, {
        cache: expireAt,
      });

      let thirdCall = secondCall;
      const expired = await waitFor(async () => {
        Orm.instance = currentApp;
        thirdCall = await productRepo.findById(product.id, {
          cache: expireAt,
        });
        return thirdCall?.name === 'Keyboard Updated';
      }, 7000);

      // Then
      expect(firstCall).toBeDefined();
      expect(firstCall!.name).toBe('Keyboard');
      expect(secondCall).toBeDefined();
      expect(secondCall!.name).toBe('Keyboard');
      expect(expired).toBe(true);
      expect(thirdCall).toBeDefined();
      expect(thirdCall!.name).toBe('Keyboard Updated');
    });

    test('should not cache when Date is in the past', async () => {
      // Given
      resetQueryCounter();
      await productRepo.create({ name: 'Old', price: 10 });
      resetQueryCounter();

      const past = new Date(Date.now() - 1000);

      // When - First call (should hit database)
      await productRepo.find({
        where: { name: 'Old' },
        cache: past,
      });

      const queriesAfterFirst = getQueryCount();

      // When - Second call (should hit database again, no cache)
      await productRepo.find({
        where: { name: 'Old' },
        cache: past,
      });

      const queriesAfterSecond = getQueryCount();

      // Then
      expect(queriesAfterFirst).toBe(1);
      expect(queriesAfterSecond).toBe(2);
    });
  });

  describe('Cache infinite (cache: true)', () => {
    test('should cache query result infinitely', async () => {
      // Given
      resetQueryCounter();
      const product = await productRepo.create({
        name: 'Tablet',
        price: 500,
      });
      resetQueryCounter();

      // When - First call
      const firstCall = await productRepo.find({
        where: { name: 'Tablet' },
        cache: true,
      });

      const queriesAfterFirst = getQueryCount();

      // Wait some time
      await new Promise((resolve) => setTimeout(resolve, 100));

      // When - Second call (should still be cached)
      const secondCall = await productRepo.find({
        where: { name: 'Tablet' },
        cache: true,
      });

      const queriesAfterSecond = getQueryCount();

      // Then
      expect(firstCall.length).toBe(1);
      expect(firstCall[0].name).toBe('Tablet');
      expect(secondCall.length).toBe(1);
      expect(secondCall[0].id).toBe(product.id);
      expect(queriesAfterFirst).toBe(1);
      expect(queriesAfterSecond).toBe(1);
    });

    test('should cache findOne infinitely', async () => {
      // Given
      resetQueryCounter();
      const product = await productRepo.create({
        name: 'Phone',
        price: 800,
      });
      resetQueryCounter();

      // When
      const firstCall = await productRepo.findOne({
        where: { id: product.id },
        cache: true,
      });

      const queriesAfterFirst = getQueryCount();

      const secondCall = await productRepo.findOne({
        where: { id: product.id },
        cache: true,
      });

      const queriesAfterSecond = getQueryCount();

      // Then
      expect(firstCall).toBeDefined();
      expect(firstCall!.name).toBe('Phone');
      expect(secondCall).toBeDefined();
      expect(secondCall!.id).toBe(product.id);
      expect(queriesAfterFirst).toBe(1);
      expect(queriesAfterSecond).toBe(1);
    });

    test('should cache findById infinitely', async () => {
      // Given
      resetQueryCounter();
      const product = await productRepo.create({
        name: 'Headphones',
        price: 150,
      });
      resetQueryCounter();

      // When
      const firstCall = await productRepo.findById(product.id, {
        cache: true,
      });

      const queriesAfterFirst = getQueryCount();

      const secondCall = await productRepo.findById(product.id, {
        cache: true,
      });

      const queriesAfterSecond = getQueryCount();

      // Then
      expect(firstCall).toBeDefined();
      expect(firstCall!.name).toBe('Headphones');
      expect(secondCall).toBeDefined();
      expect(secondCall!.id).toBe(product.id);
      expect(queriesAfterFirst).toBe(1);
      expect(queriesAfterSecond).toBe(1);
    });
  });

  describe('Cache Invalidation', () => {
    test('should invalidate cache on create', async () => {
      // Given - First query to cache empty result
      resetQueryCounter();
      const firstQuery = await productRepo.find({
        where: { isAvailable: true },
        cache: 5000,
      });

      expect(firstQuery.length).toBe(0);
      const queriesAfterFirst = getQueryCount();

      // When - Create new product (cache IS invalidated)
      await productRepo.create({
        name: 'New Product',
        price: 250,
        isAvailable: true,
      });

      resetQueryCounter();

      // Then - Should return fresh result
      const secondQuery = await productRepo.find({
        where: { isAvailable: true },
        cache: 5000,
      });

      const queriesAfterSecond = getQueryCount();

      expect(secondQuery.length).toBe(1);
      expect(queriesAfterFirst).toBe(1);
      expect(queriesAfterSecond).toBe(1);
    });

    test('should invalidate cache on update', async () => {
      // Given
      resetQueryCounter();
      const product = await productRepo.create({
        name: 'Original Name',
        price: 100,
      });
      resetQueryCounter();

      // Cache the query
      const firstQuery = await productRepo.findById(product.id, {
        cache: 5000,
      });

      expect(firstQuery!.name).toBe('Original Name');
      const queriesAfterFirst = getQueryCount();

      // When - Update product (cache IS invalidated)
      await productRepo.updateById(product.id, {
        name: 'Updated Name',
      });

      resetQueryCounter();

      // Then - Should return cached result (stale data)
      const secondQuery = await productRepo.findById(product.id, {
        cache: 5000,
      });

      const queriesAfterSecond = getQueryCount();

      expect(secondQuery).toBeDefined();
      expect(secondQuery!.name).toBe('Updated Name');
      expect(queriesAfterFirst).toBe(1);
      expect(queriesAfterSecond).toBe(1);
    });

    test('should invalidate cache on delete', async () => {
      // Given
      resetQueryCounter();
      const product = await productRepo.create({
        name: 'To Delete',
        price: 75,
      });
      resetQueryCounter();

      // Cache the query
      const firstQuery = await productRepo.findById(product.id, {
        cache: 5000,
      });

      expect(firstQuery).toBeDefined();
      const queriesAfterFirst = getQueryCount();

      // When - Delete product (cache IS invalidated)
      await productRepo.deleteById(product.id);

      resetQueryCounter();

      // Then - Should return cached result (stale data)
      const secondQuery = await productRepo.findById(product.id, {
        cache: 5000,
      });

      const queriesAfterSecond = getQueryCount();

      expect(secondQuery).toBeUndefined();
      expect(queriesAfterFirst).toBe(1);
      expect(queriesAfterSecond).toBe(1);
    });
  });

  describe('Cache with complex queries', () => {
    test('should cache queries with orderBy', async () => {
      // Given
      resetQueryCounter();
      await productRepo.create({ name: 'Z Product', price: 100 });
      await productRepo.create({ name: 'A Product', price: 200 });
      resetQueryCounter();

      // When
      const firstCall = await productRepo.find({
        orderBy: { name: 'ASC' },
        cache: 5000,
      });

      const queriesAfterFirst = getQueryCount();

      const secondCall = await productRepo.find({
        orderBy: { name: 'ASC' },
        cache: 5000,
      });

      const queriesAfterSecond = getQueryCount();

      // Then
      expect(firstCall[0].name).toBe('A Product');
      expect(secondCall[0].name).toBe('A Product');
      expect(queriesAfterFirst).toBe(1);
      expect(queriesAfterSecond).toBe(1);
    });

    test('should cache queries with limit and offset', async () => {
      // Given
      resetQueryCounter();
      for (let i = 1; i <= 5; i++) {
        await productRepo.create({
          name: `Product ${i}`,
          price: i * 100,
        });
      }
      resetQueryCounter();

      // When - First call with limit/offset
      const firstCall = await productRepo.find({
        limit: 2,
        offset: 1,
        orderBy: { id: 'ASC' },
        cache: 5000,
      });

      const queriesAfterFirst = getQueryCount();

      // Insert new product (cache IS invalidated)
      await productRepo.create({
        name: `Product 10`,
        price: 10,
      });

      resetQueryCounter();

      // Second call - should return fresh result
      const secondCall = await productRepo.find({
        limit: 2,
        offset: 1,
        orderBy: { id: 'ASC' },
        cache: 5000,
      });

      const queriesAfterSecond = getQueryCount();

      // Then - Should return fresh data (3 items now)
      expect(firstCall.length).toBe(2);
      expect(secondCall.length).toBe(2);
      expect(secondCall[1].id).toBe(3); // offset 1, so 2, 3
      // Wait, limit is 2, offset 1.
      // IDs: 1, 2, 3, 4, 5.
      // First call (offset 1, limit 2): [2, 3]
      // Add 10. IDs: 1, 2, 3, 4, 5, 10.
      // Second call (offset 1, limit 2): [2, 3] -> Actually order by ID ASC, so it should be same unless the insert affects the window.
      // Insert ID will be auto-incremented.
      // If we insert a new product, it will have a higher ID.
      // If we query with limit/offset on ID ASC, the new item appears at the end.
      // So the result set for offset 1 limit 2 (items 2 and 3) might NOT change if we just add one at the end.
      // However, the CACHE KEY should be invalidated.
      // So queriesAfterSecond should be 1.
      expect(queriesAfterFirst).toBe(1);
      expect(queriesAfterSecond).toBe(1);
    });

    test('should respect different cache keys for different limits', async () => {
      // Given
      resetQueryCounter();
      await productRepo.create({ name: 'P1', price: 100 });
      await productRepo.create({ name: 'P2', price: 200 });
      await productRepo.create({ name: 'P3', price: 300 });
      resetQueryCounter();

      // When
      const limit2 = await productRepo.find({
        limit: 2,
        cache: 5000,
      });

      const queriesAfterLimit2 = getQueryCount();

      const limit3 = await productRepo.find({
        limit: 3,
        cache: 5000,
      });

      const queriesAfterLimit3 = getQueryCount();

      // Then
      expect(limit2.length).toBe(2);
      expect(limit3.length).toBe(3);
      expect(queriesAfterLimit2).toBe(1);
      expect(queriesAfterLimit3).toBe(2);
    });
  });

  describe('Cache disabled (no cache option)', () => {
    test('should not cache when cache option is not provided', async () => {
      // Given
      resetQueryCounter();
      const product = await productRepo.create({
        name: 'No Cache',
        price: 100,
      });
      resetQueryCounter();

      // When - Without cache option
      const firstCall = await productRepo.find({
        where: { name: 'No Cache' },
      });

      const queriesAfterFirst = getQueryCount();

      // Update between calls
      await productRepo.updateById(product.id, {
        name: 'Updated Without Cache',
      });

      const secondCall = await productRepo.find({
        where: { name: 'Updated Without Cache' },
      });

      const queriesAfterSecond = getQueryCount();

      // Then - Should execute queries each time (no cache)
      expect(firstCall[0].name).toBe('No Cache');
      expect(secondCall[0].name).toBe('Updated Without Cache');
      expect(queriesAfterFirst).toBe(1);
      expect(queriesAfterSecond).toBe(3);
    });
  });
});
