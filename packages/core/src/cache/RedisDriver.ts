import type { CacheDriver } from './CacheDriver';

/**
 * Redis Cache Driver Configuration.
 */
export interface RedisConfig {
    host?: string;
    port?: number;
    password?: string;
    db?: number;
    url?: string;
}

/**
 * Redis Cache Driver.
 * For distributed caching in multi-instance deployments.
 * 
 * Uses Bun's native Redis client for maximum performance.
 */
export class RedisDriver implements CacheDriver {
    readonly name = 'RedisDriver';

    private client: any = null;
    private connected = false;

    constructor(private config: RedisConfig = {}) { }

    /**
     * Connect to Redis (lazy - connects on first use).
     */
    private async ensureConnected(): Promise<void> {
        if (this.connected) return;

        const url = this.config.url ||
            `redis://${this.config.host || 'localhost'}:${this.config.port || 6379}`;

        // Use Bun's native Redis client if available
        if (typeof Bun !== 'undefined' && (Bun as any).redis) {
            this.client = new (Bun as any).redis(url);
        } else {
            // Fallback to ioredis
            try {
                const Redis = require('ioredis');
                this.client = new Redis({
                    host: this.config.host || 'localhost',
                    port: this.config.port || 6379,
                    password: this.config.password,
                    db: this.config.db || 0
                });
            } catch {
                throw new Error('Redis client not available. Install ioredis or use Bun with Redis support.');
            }
        }

        this.connected = true;
    }

    async get<T>(key: string): Promise<T | null> {
        await this.ensureConnected();

        const value = await this.client.get(key);

        if (value === null) {
            return null;
        }

        try {
            return JSON.parse(value);
        } catch {
            return value as T;
        }
    }

    async set<T>(key: string, value: T, ttl?: number): Promise<boolean> {
        await this.ensureConnected();

        const serialized = typeof value === 'string' ? value : JSON.stringify(value);

        if (ttl) {
            // Public API uses milliseconds; Redis SETEX expects whole seconds.
            // Round up so entries never expire before the requested instant.
            const ttlSeconds = Math.ceil(ttl / 1000);
            await this.client.setex(key, ttlSeconds, serialized);
        } else {
            await this.client.set(key, serialized);
        }

        return true;
    }

    async del(key: string): Promise<boolean> {
        await this.ensureConnected();

        const result = await this.client.del(key);

        return result > 0;
    }

    async has(key: string): Promise<boolean> {
        await this.ensureConnected();

        const result = await this.client.exists(key);

        return result > 0;
    }

    async clear(): Promise<void> {
        await this.ensureConnected();

        await this.client.flushdb();
    }

    async close(): Promise<void> {
        if (this.client && this.connected) {
            await this.client.quit?.();
            this.connected = false;
        }
    }
}
