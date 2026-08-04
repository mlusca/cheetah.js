import type { CacheDriver, CacheConfig } from './CacheDriver';
import { MemoryDriver } from './MemoryDriver';

/**
 * CacheService - High-performance caching with driver pattern.
 *
 * Features:
 * - In-memory (default) or Redis backend
 * - getOrSet for cache-aside pattern with per-process singleflight
 * - Key prefixing for namespacing
 * - Configurable default TTL
 *
 * TTL values are always in milliseconds (including `defaultTtl`). Drivers that
 * only support second precision (e.g. Redis SETEX) convert at the driver boundary.
 *
 * Usage:
 * ```typescript
 * const cache = new CacheService();
 *
 * // Basic operations (TTL in milliseconds)
 * await cache.set('user:123', { name: 'John' }, 3_600_000); // 1 hour
 * const user = await cache.get<User>('user:123');
 *
 * // Cache-aside pattern
 * const user = await cache.getOrSet('user:123',
 *   async () => db.findUser(123),
 *   3_600_000
 * );
 * ```
 */
export class CacheService {
    private driver: CacheDriver;
    private prefix: string;
    private defaultTtl: number | undefined;
    /**
     * In-flight getOrSet computations keyed by the fully prefixed cache key.
     * Deduplicates concurrent misses within this process/instance only.
     */
    private inflight = new Map<string, Promise<unknown>>();

    constructor(config: CacheConfig = {}) {
        this.driver = config.driver || new MemoryDriver();
        this.prefix = config.prefix || '';
        this.defaultTtl = config.defaultTtl;
    }

    /**
     * Get the full key with prefix.
     */
    private key(key: string): string {
        return this.prefix ? `${this.prefix}:${key}` : key;
    }

    /**
     * Get a value from cache.
     */
    async get<T>(key: string): Promise<T | null> {
        return this.driver.get<T>(this.key(key));
    }

    /**
     * Set a value in cache.
     * @param ttl Time to live in milliseconds. Falls back to `defaultTtl` when omitted.
     */
    async set<T>(key: string, value: T, ttl?: number): Promise<boolean> {
        return this.driver.set(this.key(key), value, ttl ?? this.defaultTtl);
    }

    /**
     * Delete a value from cache.
     */
    async del(key: string): Promise<boolean> {
        return this.driver.del(this.key(key));
    }

    /**
     * Check if key exists.
     */
    async has(key: string): Promise<boolean> {
        return this.driver.has(this.key(key));
    }

    /**
     * Clear all cached values.
     */
    async clear(): Promise<void> {
        return this.driver.clear();
    }

    /**
     * Get value from cache or compute and store it.
     * This is the cache-aside pattern - most commonly used method.
     *
     * Concurrent callers for the same key (same process and CacheService
     * instance) share a single in-flight computation (singleflight). This
     * does not coordinate across processes or Redis instances.
     *
     * @param key Cache key
     * @param cb Callback to compute value if not cached
     * @param ttl Time to live in milliseconds. Falls back to `defaultTtl` when omitted.
     */
    async getOrSet<T>(key: string, cb: () => Promise<T>, ttl?: number): Promise<T> {
        const flightKey = this.key(key);

        const cached = await this.get<T>(key);

        if (cached !== null) {
            return cached;
        }

        const existing = this.inflight.get(flightKey);
        if (existing) {
            return existing as Promise<T>;
        }

        // Defer the callback so a synchronous throw cannot run `finally`
        // before this promise is registered in `inflight` (which would leave
        // a permanently rejected entry and block retries for the key).
        const promise = Promise.resolve()
            .then(() => cb())
            .then(async (value) => {
                await this.set(key, value, ttl);
                return value;
            })
            .finally(() => {
                this.inflight.delete(flightKey);
            });

        this.inflight.set(flightKey, promise);
        return promise;
    }

    /**
     * Get multiple values at once.
     */
    async getMany<T>(keys: string[]): Promise<(T | null)[]> {
        return Promise.all(keys.map(key => this.get<T>(key)));
    }

    /**
     * Set multiple values at once.
     */
    async setMany<T>(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<boolean[]> {
        return Promise.all(
            entries.map(entry => this.set(entry.key, entry.value, entry.ttl))
        );
    }

    /**
     * Delete multiple values at once.
     */
    async delMany(keys: string[]): Promise<boolean[]> {
        return Promise.all(keys.map(key => this.del(key)));
    }

    /**
     * Close the cache driver connection.
     */
    async close(): Promise<void> {
        await this.driver.close?.();
    }

    /**
     * Get the underlying driver (for advanced use).
     */
    getDriver(): CacheDriver {
        return this.driver;
    }
}
