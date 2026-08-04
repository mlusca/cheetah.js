import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { CacheService } from '../src/cache/CacheService';
import { MemoryDriver } from '../src/cache/MemoryDriver';

describe('MemoryDriver', () => {
    let driver: MemoryDriver;

    afterEach(async () => {
        if (driver) {
            await driver.close();
        }
    });

    test('default maxEntries is 10_000', async () => {
        driver = new MemoryDriver({ cleanupIntervalMs: 0 });
        expect(driver.stats().maxEntries).toBe(10_000);
    });

    test('evicts least-recently-used entry when capacity is exceeded', async () => {
        driver = new MemoryDriver({ maxEntries: 3, cleanupIntervalMs: 0 });

        await driver.set('a', 1);
        await driver.set('b', 2);
        await driver.set('c', 3);
        expect(driver.stats().size).toBe(3);

        // Touch "a" so it becomes most recent; order becomes b, c, a
        expect(await driver.get('a')).toBe(1);

        await driver.set('d', 4);

        expect(driver.stats().size).toBe(3);
        expect(await driver.get('b')).toBeNull();
        expect(await driver.get('c')).toBe(3);
        expect(await driver.get('a')).toBe(1);
        expect(await driver.get('d')).toBe(4);
    });

    test('overwrite makes the key most recently used', async () => {
        driver = new MemoryDriver({ maxEntries: 3, cleanupIntervalMs: 0 });

        await driver.set('a', 1);
        await driver.set('b', 2);
        await driver.set('c', 3);
        // Overwrite a → order: b, c, a
        await driver.set('a', 10);

        await driver.set('d', 4);

        expect(await driver.get('b')).toBeNull();
        expect(await driver.get('a')).toBe(10);
        expect(await driver.get('c')).toBe(3);
        expect(await driver.get('d')).toBe(4);
    });

    test('has() touches entry for LRU and removes expired on access', async () => {
        driver = new MemoryDriver({ maxEntries: 3, cleanupIntervalMs: 0 });

        await driver.set('a', 1);
        await driver.set('b', 2);
        await driver.set('c', 3);

        expect(await driver.has('a')).toBe(true);

        await driver.set('d', 4);
        expect(await driver.get('b')).toBeNull();
        expect(await driver.has('a')).toBe(true);

        await driver.set('expiring', 'x', 20);
        await Bun.sleep(40);
        expect(await driver.has('expiring')).toBe(false);
        expect(await driver.get('expiring')).toBeNull();
    });

    test('lazy expiration removes entry on get', async () => {
        driver = new MemoryDriver({ maxEntries: 100, cleanupIntervalMs: 0 });

        await driver.set('short', 'value', 15);
        expect(await driver.get('short')).toBe('value');
        await Bun.sleep(40);
        expect(await driver.get('short')).toBeNull();
        expect(driver.stats().size).toBe(0);
    });

    test('periodic cleanup removes expired keys never accessed again', async () => {
        driver = new MemoryDriver({ maxEntries: 100, cleanupIntervalMs: 40 });

        await driver.set('orphan', 'gone', 15);
        expect(driver.stats().size).toBe(1);

        await Bun.sleep(100);

        expect(driver.stats().size).toBe(0);
    });

    test('cleanupIntervalMs: 0 disables periodic cleanup', async () => {
        driver = new MemoryDriver({ maxEntries: 100, cleanupIntervalMs: 0 });

        await driver.set('stale', 'still-here', 10);
        await Bun.sleep(50);

        // Not removed without access when timer is off
        expect(driver.stats().size).toBe(1);
        expect(await driver.get('stale')).toBeNull();
        expect(driver.stats().size).toBe(0);
    });

    test('positional constructor still configures cleanup interval', async () => {
        driver = new MemoryDriver(0);
        expect(driver.stats().maxEntries).toBe(10_000);

        await driver.set('x', 1, 10);
        await Bun.sleep(40);
        expect(driver.stats().size).toBe(1);
    });

    test('close() cancels the cleanup interval and clears storage', async () => {
        driver = new MemoryDriver({ maxEntries: 10, cleanupIntervalMs: 30 });
        await driver.set('k', 'v');
        expect(driver.stats().size).toBe(1);

        await driver.close();
        expect(driver.stats().size).toBe(0);

        // After close, further sets still work but timer is gone (no throw)
        await driver.set('after', 1);
        expect(driver.stats().size).toBe(1);
        await driver.close();
    });

    test('rejects invalid maxEntries', () => {
        expect(() => new MemoryDriver({ maxEntries: 0 })).toThrow(RangeError);
        expect(() => new MemoryDriver({ maxEntries: -1 })).toThrow(RangeError);
        expect(() => new MemoryDriver({ maxEntries: 1.5 })).toThrow(RangeError);
    });

    test('rejects invalid cleanupIntervalMs', () => {
        expect(() => new MemoryDriver({ cleanupIntervalMs: -1 })).toThrow(RangeError);
        expect(() => new MemoryDriver({ cleanupIntervalMs: Number.POSITIVE_INFINITY })).toThrow(
            RangeError
        );
    });

    test('evicts expired entries before LRU when capacity is full', async () => {
        driver = new MemoryDriver({ maxEntries: 2, cleanupIntervalMs: 0 });

        await driver.set('old', 'expired', 15);
        await driver.set('keep', 'live');
        await Bun.sleep(40);

        // Inserting should drop expired "old" rather than live "keep"
        await driver.set('new', 'value');

        expect(await driver.get('old')).toBeNull();
        expect(await driver.get('keep')).toBe('live');
        expect(await driver.get('new')).toBe('value');
    });
});

describe('CacheService.getOrSet singleflight', () => {
    let cache: CacheService;

    beforeEach(() => {
        cache = new CacheService({
            driver: new MemoryDriver({ maxEntries: 100, cleanupIntervalMs: 0 }),
        });
    });

    afterEach(async () => {
        await cache.close();
    });

    test('concurrent misses share a single callback execution', async () => {
        let calls = 0;

        const run = () =>
            cache.getOrSet('shared', async () => {
                calls += 1;
                await Bun.sleep(40);
                return 'computed';
            });

        const [a, b, c] = await Promise.all([run(), run(), run()]);

        expect(a).toBe('computed');
        expect(b).toBe('computed');
        expect(c).toBe('computed');
        expect(calls).toBe(1);
        expect(await cache.get('shared')).toBe('computed');
    });

    test('failed computation unblocks the key for a later retry', async () => {
        let calls = 0;

        const failing = cache.getOrSet('retry-key', async () => {
            calls += 1;
            await Bun.sleep(20);
            throw new Error('boom');
        });

        const alsoFailing = cache.getOrSet('retry-key', async () => {
            calls += 1;
            return 'should-not-run';
        });

        // Attach both handlers before the shared promise settles to avoid unhandled rejection.
        const settled = await Promise.allSettled([failing, alsoFailing]);
        expect(settled[0].status).toBe('rejected');
        expect(settled[1].status).toBe('rejected');
        if (settled[0].status === 'rejected') {
            expect((settled[0].reason as Error).message).toBe('boom');
        }
        expect(calls).toBe(1);

        const value = await cache.getOrSet('retry-key', async () => {
            calls += 1;
            return 'recovered';
        });

        expect(value).toBe('recovered');
        expect(calls).toBe(2);
    });

    test('synchronous throw still unblocks the key for a later retry', async () => {
        let calls = 0;

        await expect(
            cache.getOrSet('sync-throw', () => {
                calls += 1;
                throw new Error('sync-boom');
            })
        ).rejects.toThrow('sync-boom');
        expect(calls).toBe(1);

        const value = await cache.getOrSet('sync-throw', async () => {
            calls += 1;
            return 'after-sync-throw';
        });

        expect(value).toBe('after-sync-throw');
        expect(calls).toBe(2);
    });

    test('hit path does not invoke the callback', async () => {
        await cache.set('ready', 'cached');
        let calls = 0;

        const value = await cache.getOrSet('ready', async () => {
            calls += 1;
            return 'fresh';
        });

        expect(value).toBe('cached');
        expect(calls).toBe(0);
    });

    test('singleflight keys are isolated by prefix', async () => {
        const a = new CacheService({
            prefix: 'ns-a',
            driver: new MemoryDriver({ maxEntries: 100, cleanupIntervalMs: 0 }),
        });
        const b = new CacheService({
            prefix: 'ns-b',
            driver: new MemoryDriver({ maxEntries: 100, cleanupIntervalMs: 0 }),
        });

        let aCalls = 0;
        let bCalls = 0;

        const [va, vb] = await Promise.all([
            a.getOrSet('same', async () => {
                aCalls += 1;
                await Bun.sleep(20);
                return 'from-a';
            }),
            b.getOrSet('same', async () => {
                bCalls += 1;
                await Bun.sleep(20);
                return 'from-b';
            }),
        ]);

        expect(va).toBe('from-a');
        expect(vb).toBe('from-b');
        expect(aCalls).toBe(1);
        expect(bCalls).toBe(1);

        await a.close();
        await b.close();
    });
});
