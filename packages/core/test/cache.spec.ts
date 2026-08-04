import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { CacheService } from '../src/cache/CacheService';
import { MemoryDriver } from '../src/cache/MemoryDriver';
import { RedisDriver } from '../src/cache/RedisDriver';
import type { CacheDriver } from '../src/cache/CacheDriver';

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

describe('CacheService / MemoryDriver TTL (milliseconds)', () => {
    let now = 1_000_000;
    let originalDateNow: () => number;
    let drivers: MemoryDriver[] = [];

    beforeEach(() => {
        now = 1_000_000;
        originalDateNow = Date.now;
        Date.now = () => now;
        drivers = [];
    });

    afterEach(async () => {
        Date.now = originalDateNow;
        for (const d of drivers) {
            await d.close();
        }
    });

    test('MemoryDriver keeps value before TTL and expires after', async () => {
        const driver = new MemoryDriver({ cleanupIntervalMs: 0 });
        drivers.push(driver);

        await driver.set('k', 'v', 5000);

        now = 1_000_000 + 4999;
        expect(await driver.get('k')).toBe('v');
        expect(await driver.has('k')).toBe(true);

        now = 1_000_000 + 5001;
        expect(await driver.get('k')).toBeNull();
        expect(await driver.has('k')).toBe(false);
    });

    test('MemoryDriver treats omitted / falsy TTL as no automatic expiration', async () => {
        const driver = new MemoryDriver({ cleanupIntervalMs: 0 });
        drivers.push(driver);

        await driver.set('forever', 1);
        await driver.set('zero', 2, 0);

        now = 1_000_000 + 60_000_000;
        expect(await driver.get('forever')).toBe(1);
        expect(await driver.get('zero')).toBe(2);
    });

    test('CacheService defaultTtl is forwarded in milliseconds', async () => {
        const setCalls: Array<{ key: string; value: unknown; ttl?: number }> = [];
        const driver: CacheDriver = {
            name: 'RecordingDriver',
            async get() {
                return null;
            },
            async set(key, value, ttl) {
                setCalls.push({ key, value, ttl });
                return true;
            },
            async del() {
                return true;
            },
            async has() {
                return false;
            },
            async clear() {},
        };

        const cache = new CacheService({ driver, defaultTtl: 60_000, prefix: 'app' });
        await cache.set('user', { id: 1 });
        await cache.set('session', 'x', 5_000);

        expect(setCalls).toEqual([
            { key: 'app:user', value: { id: 1 }, ttl: 60_000 },
            { key: 'app:session', value: 'x', ttl: 5_000 },
        ]);
    });

    test('getOrSet uses millisecond TTL on miss', async () => {
        const setCalls: number[] = [];
        const store = new Map<string, unknown>();
        const driver: CacheDriver = {
            name: 'MapDriver',
            async get(key) {
                return (store.get(key) as any) ?? null;
            },
            async set(key, value, ttl) {
                setCalls.push(ttl as number);
                store.set(key, value);
                return true;
            },
            async del() {
                return true;
            },
            async has() {
                return false;
            },
            async clear() {},
        };

        const cache = new CacheService({ driver });
        const first = await cache.getOrSet('k', async () => 'computed', 30_000);
        const second = await cache.getOrSet('k', async () => 'other', 30_000);

        expect(first).toBe('computed');
        expect(second).toBe('computed');
        expect(setCalls).toEqual([30_000]);
    });
});

describe('RedisDriver TTL conversion (ms → seconds, ceil)', () => {
    function attachMockClient(driver: RedisDriver) {
        const setex = mock(async (_key: string, _ttl: number, _value: string) => 'OK');
        const set = mock(async (_key: string, _value: string) => 'OK');
        const get = mock(async () => null);
        const del = mock(async () => 1);
        const exists = mock(async () => 0);
        const flushdb = mock(async () => 'OK');
        const quit = mock(async () => 'OK');

        (driver as any).client = { setex, set, get, del, exists, flushdb, quit };
        (driver as any).connected = true;

        return { setex, set, get, del, exists, flushdb, quit };
    }

    test('converts exact second boundaries without padding', async () => {
        const driver = new RedisDriver();
        const client = attachMockClient(driver);

        await driver.set('k', { a: 1 }, 1000);

        expect(client.setex).toHaveBeenCalledTimes(1);
        expect(client.setex.mock.calls[0]).toEqual(['k', 1, JSON.stringify({ a: 1 })]);
        expect(client.set).not.toHaveBeenCalled();
    });

    test('rounds fractional seconds up so Redis never expires early', async () => {
        const driver = new RedisDriver();
        const client = attachMockClient(driver);

        await driver.set('k', 'v', 1500);

        expect(client.setex.mock.calls[0][1]).toBe(2);
    });

    test('rounds sub-second positive TTL up to 1 second', async () => {
        const driver = new RedisDriver();
        const client = attachMockClient(driver);

        await driver.set('k', 'v', 1);

        expect(client.setex.mock.calls[0][1]).toBe(1);
    });

    test('omits setex when TTL is absent or falsy', async () => {
        const driver = new RedisDriver();
        const client = attachMockClient(driver);

        await driver.set('a', '1');
        await driver.set('b', '2', 0);

        expect(client.setex).not.toHaveBeenCalled();
        expect(client.set).toHaveBeenCalledTimes(2);
        expect(client.set.mock.calls[0]).toEqual(['a', '1']);
        expect(client.set.mock.calls[1]).toEqual(['b', '2']);
    });
});
