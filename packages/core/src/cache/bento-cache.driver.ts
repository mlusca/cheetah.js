import { Service } from '../commons/decorators/service.decorator';
import { LoggerService } from '../services/logger.service';
import { CachePort } from './cache.port';
import { BentoCache, bentostore } from 'bentocache';
// @ts-ignore
import { memoryDriver } from 'bentocache/drivers/memory';

@Service({ provide: CachePort })
export class BentoCacheDriver extends CachePort {
  private cache: BentoCache<any>

  constructor(private readonly logger: LoggerService) {
    super();
    this.cache = new BentoCache({
      //@ts-ignore
      logger: this.logger.getLogger(),
      default: 'defaultCache',
      stores: {
        defaultCache: bentostore().useL1Layer((memoryDriver({ maxSize: 10_000}))), // TODO: Not default, custom with properties.
      }
    })
  }

  set(key: string, value: any, ttl?: number): Promise<boolean> {
    return this.cache.set(key, value, {ttl: ttl ?? '1h'})
  }

  get(key: string): Promise<any> {
    return this.cache.get(key)
  }

  del(key: string): Promise<boolean> {
    return this.cache.delete(key)
  }

  has(key: string): Promise<boolean> {
    return this.cache.has(key)
  }

  getOrSet(key: string, cb: () => Promise<any>, ttl?: number): Promise<any> {
    return this.cache.getOrSet(key, cb, {ttl: ttl ?? '1h'})
  }
}