import { CacheSettings, ConnectionSettings, DriverInterface } from './driver/driver.interface';
import { Service, CacheService } from '@carno.js/core';
import { SqlBuilder } from './SqlBuilder';
import { QueryCacheManager } from './cache/query-cache-manager';
import { transactionContext } from './transaction/transaction-context';
import { ormSessionContext } from './orm-session-context';
import { createLogger, type Logger } from './logger';
import { statementObserver } from './live/statement-observer';

const DEFAULT_MAX_KEYS_PER_TABLE = 10000;

@Service()
export class Orm<T extends DriverInterface = DriverInterface> {
  driverInstance: T;
  static instance: Orm<any>
  public connection: ConnectionSettings<T>
  public queryCacheManager?: QueryCacheManager;
  public logger: Logger;

  constructor(public cacheService?: CacheService) {
    this.logger = createLogger();
    Orm.instance = this;
  }

  private initializeQueryCacheManager(cacheSettings?: CacheSettings): void {
    if (!this.cacheService) {
      return;
    }

    const maxKeys = cacheSettings?.maxKeysPerTable ?? DEFAULT_MAX_KEYS_PER_TABLE;
    this.queryCacheManager = new QueryCacheManager(this.cacheService, maxKeys);
  }

  static getInstance(): Orm<any> {
    const scoped = ormSessionContext.getOrm();
    if (scoped) {
      return scoped;
    }

    return Orm.instance
  }

  public setConnection(connection: ConnectionSettings<T>) {
    this.connection = connection
    // @ts-ignore
    this.driverInstance = new this.connection.driver(connection)
    this.initializeQueryCacheManager(connection.cache);
  }

  createQueryBuilder<Model>(model: new() => Model): SqlBuilder<Model> {
    return new SqlBuilder<Model>(model)
  }

  connect(): Promise<void> {
    return this.driverInstance.connect()
  }

  disconnect(): Promise<void> {
    return this.driverInstance.disconnect()
  }

  async transaction<ResultType>(operation: (tx: unknown) => Promise<ResultType>): Promise<ResultType> {
    if (!this.driverInstance) {
      throw new Error('Driver instance not initialized')
    }

    if (transactionContext.hasContext()) {
      return operation(transactionContext.getContext());
    }

    let transaction: unknown;
    let result: ResultType;

    try {
      result = await this.driverInstance.transaction(async (tx) => {
        transaction = tx;
        return transactionContext.run(tx as any, () => operation(tx));
      });
    } catch (error) {
      if (transaction) {
        statementObserver.rollbackTransaction(transaction);
      }

      throw error;
    }

    if (transaction) {
      // The driver's transaction promise resolves only after COMMIT. Releasing
      // notifications here prevents readers from observing rolled-back state.
      statementObserver.commitTransaction(transaction);
    }

    return result;
  }
}
