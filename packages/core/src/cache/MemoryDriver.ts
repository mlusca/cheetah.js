import type { CacheDriver } from './CacheDriver';

interface CacheEntry<T> {
    value: T;
    expiresAt: number | null;
}

/**
 * Configuration for {@link MemoryDriver}.
 */
export interface MemoryDriverOptions {
    /**
     * Maximum number of entries retained in memory.
     * When the limit is reached, the least-recently-used entry is evicted
     * (expired entries are dropped first when possible).
     * @default 10_000
     */
    maxEntries?: number;

    /**
     * Interval in milliseconds for periodic removal of expired entries.
     * Set to `0` to disable the timer (lazy expiration on access only).
     * @default 60_000
     */
    cleanupIntervalMs?: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;

/**
 * In-Memory Cache Driver.
 * Ultra-fast, perfect for single-instance applications.
 *
 * Features:
 * - O(1) get/set/del operations
 * - Bounded capacity with LRU eviction (default 10_000 entries)
 * - Lazy expiration (checked on access)
 * - Periodic cleanup of expired entries (default every 60s, unref'd)
 */
export class MemoryDriver implements CacheDriver {
    readonly name = 'MemoryDriver';

    private cache = new Map<string, CacheEntry<any>>();
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;
    private readonly maxEntries: number;

    /**
     * @param cleanupIntervalMs Positional form for backward compatibility.
     *   When a number is passed, it sets `cleanupIntervalMs` and uses the
     *   default `maxEntries`. Prefer {@link MemoryDriverOptions} for new code.
     */
    constructor(cleanupIntervalMs?: number);
    constructor(options?: MemoryDriverOptions);
    constructor(optionsOrCleanupIntervalMs: MemoryDriverOptions | number = {}) {
        let maxEntries = DEFAULT_MAX_ENTRIES;
        let cleanupIntervalMs = DEFAULT_CLEANUP_INTERVAL_MS;

        if (typeof optionsOrCleanupIntervalMs === 'number') {
            cleanupIntervalMs = optionsOrCleanupIntervalMs;
        } else {
            if (optionsOrCleanupIntervalMs.maxEntries !== undefined) {
                maxEntries = optionsOrCleanupIntervalMs.maxEntries;
            }
            if (optionsOrCleanupIntervalMs.cleanupIntervalMs !== undefined) {
                cleanupIntervalMs = optionsOrCleanupIntervalMs.cleanupIntervalMs;
            }
        }

        if (!Number.isInteger(maxEntries) || maxEntries < 1) {
            throw new RangeError(
                `MemoryDriver maxEntries must be a positive integer, got ${String(maxEntries)}`
            );
        }

        if (
            typeof cleanupIntervalMs !== 'number' ||
            !Number.isFinite(cleanupIntervalMs) ||
            cleanupIntervalMs < 0
        ) {
            throw new RangeError(
                `MemoryDriver cleanupIntervalMs must be a non-negative finite number, got ${String(cleanupIntervalMs)}`
            );
        }

        this.maxEntries = maxEntries;

        if (cleanupIntervalMs > 0) {
            this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
            // Allow the process to exit while the timer is active (Node/Bun).
            const timer = this.cleanupTimer as { unref?: () => void };
            if (typeof timer.unref === 'function') {
                timer.unref();
            }
        }
    }

    async get<T>(key: string): Promise<T | null> {
        const entry = this.cache.get(key);

        if (!entry) {
            return null;
        }

        if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }

        // LRU: move to most-recently-used (Map insertion order).
        this.cache.delete(key);
        this.cache.set(key, entry);

        return entry.value;
    }

    async set<T>(key: string, value: T, ttl?: number): Promise<boolean> {
        const expiresAt = ttl ? Date.now() + ttl : null;

        if (this.cache.has(key)) {
            // Overwrite: delete first so re-insert becomes most recent.
            this.cache.delete(key);
        } else {
            this.ensureCapacity();
        }

        this.cache.set(key, { value, expiresAt });

        return true;
    }

    async del(key: string): Promise<boolean> {
        return this.cache.delete(key);
    }

    async has(key: string): Promise<boolean> {
        const entry = this.cache.get(key);

        if (!entry) {
            return false;
        }

        if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return false;
        }

        // LRU touch on successful existence check.
        this.cache.delete(key);
        this.cache.set(key, entry);

        return true;
    }

    async clear(): Promise<void> {
        this.cache.clear();
    }

    async close(): Promise<void> {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        this.cache.clear();
    }

    /**
     * Free a slot before inserting a new key.
     * Drops expired entries first, then evicts the least-recently-used key.
     */
    private ensureCapacity(): void {
        if (this.cache.size < this.maxEntries) {
            return;
        }

        this.cleanup();

        while (this.cache.size >= this.maxEntries) {
            const oldest = this.cache.keys().next().value as string | undefined;
            if (oldest === undefined) {
                break;
            }
            this.cache.delete(oldest);
        }
    }

    /**
     * Remove expired entries.
     */
    private cleanup(): void {
        const now = Date.now();

        for (const [key, entry] of this.cache) {
            if (entry.expiresAt !== null && now > entry.expiresAt) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * Get cache stats (for debugging).
     */
    stats(): { size: number; maxEntries: number } {
        return { size: this.cache.size, maxEntries: this.maxEntries };
    }
}
