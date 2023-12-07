export abstract class CachePort {
  abstract set(key: string, value: any, ttl?: number): Promise<boolean>;
  abstract get(key: string): Promise<any>;
  abstract del(key: string): Promise<boolean>;
  abstract has(key: string): Promise<boolean>;
  abstract getOrSet<T>(key: string, cb: () => Promise<T>, ttl?: number): Promise<T>;
}