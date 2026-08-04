import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { CacheService, MemoryDriver, RedisDriver } from '../src';
import type { CacheDriver } from '../src';

describe('CacheService / MemoryDriver TTL (milliseconds)', () => {
  let now = 1_000_000;
  let originalDateNow: () => number;

  beforeEach(() => {
    now = 1_000_000;
    originalDateNow = Date.now;
    Date.now = () => now;
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  test('MemoryDriver keeps value before TTL and expires after', async () => {
    const driver = new MemoryDriver();

    await driver.set('k', 'v', 5000);

    now = 1_000_000 + 4999;
    expect(await driver.get('k')).toBe('v');
    expect(await driver.has('k')).toBe(true);

    now = 1_000_000 + 5001;
    expect(await driver.get('k')).toBeNull();
    expect(await driver.has('k')).toBe(false);
  });

  test('MemoryDriver treats omitted / falsy TTL as no automatic expiration', async () => {
    const driver = new MemoryDriver();

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
