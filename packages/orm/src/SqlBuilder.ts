import {
  AutoPath,
  ColumnMetadata,
  DriverInterface,
  FilterQuery,
  JoinStatement,
  QueryOrderMap,
  Relationship,
  Statement,
  ValueOrInstance,
} from './driver/driver.interface';
import { EntityStorage, Options } from './domain/entities';
import { Orm } from './orm';
import { ValueObject } from './common/value-object';
import { BaseEntity } from './domain/base-entity';
import { extendsFrom } from './utils';
import { ValueProcessor } from './utils/value-processor';
import { SqlConditionBuilder } from './query/sql-condition-builder';
import { SqlSubqueryBuilder } from './query/sql-subquery-builder';
import { ModelTransformer } from './query/model-transformer';
import { SqlColumnManager } from './query/sql-column-manager';
import { SqlJoinManager } from './query/sql-join-manager';
import { QueryCacheManager } from './cache/query-cache-manager';
import type { UpdateData } from './query/update-expression';
import type { Logger } from './logger';
import { tenantContext } from './tenant/tenant-context';
import { Metadata } from '@carno.js/core';
import { VERSION_PROPERTY, TENANT_PROPERTY, PROPERTIES_METADATA } from './constants';
import { OptimisticLockError } from './exceptions/optimistic-lock.error';
import { escapeString } from './utils/sql-escape';
import { statementObserver } from './live/statement-observer';

/**
 * Canonical SQL direction for every accepted `orderBy` value. The ORDER BY
 * direction is interpolated directly into SQL (it cannot be parameterized), so
 * it must be validated against this whitelist to prevent SQL injection through
 * a value like `orderBy: { name: 'ASC; DROP TABLE users; --' }`. Keys are the
 * upper-cased input; values are the literal SQL emitted. Covers the `QueryOrder`
 * enum (incl. `NULLS FIRST/LAST` and underscore key-name variants) and the
 * numeric `QueryOrderNumeric` (1 / -1) forms.
 */
const ORDER_DIRECTIONS: ReadonlyMap<string, string> = new Map([
  ['ASC', 'ASC'],
  ['DESC', 'DESC'],
  ['1', 'ASC'],
  ['-1', 'DESC'],
  ['ASC NULLS LAST', 'ASC NULLS LAST'],
  ['ASC NULLS FIRST', 'ASC NULLS FIRST'],
  ['DESC NULLS LAST', 'DESC NULLS LAST'],
  ['DESC NULLS FIRST', 'DESC NULLS FIRST'],
  ['ASC_NULLS_LAST', 'ASC NULLS LAST'],
  ['ASC_NULLS_FIRST', 'ASC NULLS FIRST'],
  ['DESC_NULLS_LAST', 'DESC NULLS LAST'],
  ['DESC_NULLS_FIRST', 'DESC NULLS FIRST'],
]);

function normalizeOrderDirection(value: unknown): string {
  const direction = ORDER_DIRECTIONS.get(String(value).trim().toUpperCase());

  if (!direction) {
    throw new Error(
      `Invalid ORDER BY direction: ${JSON.stringify(value)}. ` +
      `Expected one of ASC, DESC (optionally with NULLS FIRST/LAST) or 1 / -1.`,
    );
  }

  return direction;
}

export class SqlBuilder<T> {
  private readonly driver: DriverInterface;
  private entityStorage: EntityStorage;
  private statements: Statement<T> = {};
  private entity!: Options;
  private model!: new () => T;
  private aliases: Set<string> = new Set();
  private logger: Logger;
  private updatedColumns: any[] = [];
  private originalColumns: any[] = [];
  private conditionBuilder!: SqlConditionBuilder<T>;
  private columnManager!: SqlColumnManager;
  private cacheManager?: QueryCacheManager;

  // Lazy initialized - created only when joins/transforms are needed
  private _modelTransformer?: ModelTransformer;
  private _joinManager?: SqlJoinManager<T>;

  // Pre-bound callback to avoid closure allocation
  private readonly boundGetAlias: (tableName: string) => string;

  private quoteId(identifier: string): string {
    const q = this.driver.getIdentifierQuote();
    // Escape any embedded quote char so an identifier can't break out of the
    // quoting. Fast path: skip the split/join allocation when none is present.
    const safe = identifier.includes(q) ? identifier.split(q).join(q + q) : identifier;

    return `${q}${safe}${q}`;
  }

  private qualifyTable(schema: string, tableName: string): string {
    if (this.driver.dbType === 'mysql') {
      return this.quoteId(tableName);
    }

    return `${this.quoteId(schema)}.${this.quoteId(tableName)}`;
  }

  constructor(model: new () => T) {
    const orm = Orm.getInstance();
    this.driver = orm.driverInstance;
    this.logger = orm.logger;
    this.entityStorage = EntityStorage.getInstance();
    this.cacheManager = orm.queryCacheManager;

    this.getEntity(model);
    this.statements.hooks = this.entity.hooks;

    // Pre-bind once
    this.boundGetAlias = this.getAlias.bind(this);

    this.columnManager = new SqlColumnManager(
      this.entityStorage,
      this.statements,
      this.entity,
      this.driver,
    );

    const applyJoinWrapper = (relationship: Relationship<any>, value: FilterQuery<any>, alias: string) => {
      return this.joinManager.applyJoin(relationship, value, alias);
    };

    this.conditionBuilder = new SqlConditionBuilder(
      this.entityStorage,
      applyJoinWrapper,
      this.statements,
      this.driver,
    );

    const subqueryBuilder = new SqlSubqueryBuilder(
      this.entityStorage,
      () => this.conditionBuilder,
      this.driver,
    );

    this.conditionBuilder.setSubqueryBuilder(subqueryBuilder);
  }

  // Lazy getter for modelTransformer - only created when transform is needed
  private get modelTransformer(): ModelTransformer {
    if (!this._modelTransformer) {
      this._modelTransformer = new ModelTransformer(this.entityStorage);
    }
    return this._modelTransformer;
  }

  // Lazy getter for joinManager - only created when joins are needed
  private get joinManager(): SqlJoinManager<T> {
    if (!this._joinManager) {
      this._joinManager = new SqlJoinManager(
        this.entityStorage,
        this.statements,
        this.entity,
        this.model,
        this.driver,
        this.logger,
        this.conditionBuilder,
        this.columnManager,
        this.modelTransformer,
        () => this.originalColumns,
        this.boundGetAlias,
      );
    }
    return this._joinManager;
  }

  select(columns?: AutoPath<T, never, '*'>[]): SqlBuilder<T> {
    const tableName = this.entity.tableName || (this.model as Function).name.toLowerCase();
    const schema = this.entity.schema || 'public';
    this.statements.statement = 'select';
    this.statements.columns = columns
    this.originalColumns = columns || [];
    this.statements.alias = this.getAlias(tableName);
    this.statements.table = this.qualifyTable(schema, tableName);
    return this;
  }

  setStrategy(strategy: 'joined' | 'select' = 'joined'): SqlBuilder<T> {
    this.statements.strategy = strategy;
    return this;
  }

  setInstance(instance: T): SqlBuilder<T> {
    this.statements.instance = instance;
    return this;
  }

  insert(values: Partial<{ [K in keyof T]: ValueOrInstance<T[K]> }>): SqlBuilder<T> {
    const { tableName, schema } = this.getTableName();
    const processedValues = ValueProcessor.processForInsert(values, this.entity);
    this.statements.statement = 'insert';
    this.statements.instance = ValueProcessor.createInstance(processedValues, this.model, 'insert');
    this.statements.alias = this.getAlias(tableName);
    this.statements.table = this.qualifyTable(schema, tableName);
    this.statements.values = this.withUpdatedValues(
      this.withDefaultValues(processedValues, this.entity),
      this.entity,
    );
    // Store primary key column name for drivers that need it (e.g., MySQL)
    this.statements.primaryKeyColumnName = this.entity._primaryKeyColumnName || 'id';
    this.reflectToValues();
    return this;
  }

  /**
   * Multi-row INSERT. Builds a single `INSERT ... VALUES (...), (...), ...`
   * statement and executes it as one round-trip. Driver implementations are
   * responsible for resolving generated IDs (PG via `RETURNING`, MySQL via
   * `LAST_INSERT_ID()`).
   *
   * Per-row hooks (`@BeforeCreate`, `@AfterCreate`) and `default`/`onInsert`
   * are applied to every row, so the produced rows are equivalent to N
   * sequential `insert()` calls.
   *
   * Note: column shape is normalized using row 0. If subsequent rows omit a
   * column present in row 0, `null` is used so the SQL stays well-formed.
   */
  insertMany(rows: Array<Partial<{ [K in keyof T]: ValueOrInstance<T[K]> }>>): SqlBuilder<T> {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('insertMany requires a non-empty array of rows');
    }

    const { tableName, schema } = this.getTableName();
    this.statements.statement = 'insert';
    this.statements.bulk = true;
    this.statements.alias = this.getAlias(tableName);
    this.statements.table = this.qualifyTable(schema, tableName);
    this.statements.primaryKeyColumnName = this.entity._primaryKeyColumnName || 'id';

    const processed: Array<Record<string, any>> = new Array(rows.length);
    const instances: any[] = new Array(rows.length);

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const pv = ValueProcessor.processForInsert(row, this.entity);
      this.applyDefaultProperties(pv, this.entity);
      this.applyOnInsertProperties(pv, this.entity, i === 0);
      processed[i] = pv;
      instances[i] = ValueProcessor.createInstance(pv, this.model, 'insert');
    }

    // Normalize column shape to a single super-set, padding missing keys with null.
    const allKeys = new Set<string>();
    for (let i = 0; i < processed.length; i += 1) {
      const keys = Object.keys(processed[i]);
      for (let k = 0; k < keys.length; k += 1) allKeys.add(keys[k]);
    }
    if (allKeys.size > 0) {
      const ordered = Array.from(allKeys);
      for (let i = 0; i < processed.length; i += 1) {
        const r = processed[i];
        for (let k = 0; k < ordered.length; k += 1) {
          const key = ordered[k];
          if (!(key in r)) r[key] = null;
        }
      }
    }

    this.statements.values = processed;
    this.statements.instances = instances;
    // Set first row as `instance` so existing single-instance hook plumbing
    // (e.g. updatedColumns reflection) keeps working for the SQL build.
    this.statements.instance = instances[0];

    return this;
  }

  update(values: UpdateData<T>): SqlBuilder<T> {
    const { tableName, schema } = this.getTableName();
    const processedValues = ValueProcessor.processForUpdate(values, this.entity);
    this.statements.statement = 'update';
    this.statements.alias = this.getAlias(tableName);
    this.statements.table = this.qualifyTable(schema, tableName);
    this.statements.values = this.withUpdatedValues(processedValues, this.entity);
    this.statements.instance = ValueProcessor.createInstance(processedValues, this.model, 'update');
    return this;
  }

  delete(): SqlBuilder<T> {
    const { tableName, schema } = this.getTableName();

    this.statements.statement = 'delete';
    this.statements.alias = this.getAlias(tableName);
    this.statements.table = this.qualifyTable(schema, tableName);

    return this;
  }

  where(where: FilterQuery<T>): SqlBuilder<T> {
    if (!where || Object.keys(where).length === 0) {
      return this;
    }

    const newWhere = {};
    for (const key in where) {
      if (where[key] instanceof Object) {
        newWhere[key] = where[key];
        continue;
      }
      newWhere[ValueProcessor.getColumnName(key, this.entity)] = where[key];
    }
    where = newWhere;
    this.statements.where = this.conditionBuilder.build(where, this.statements.alias!, this.model);
    return this;
  }

  orderBy(orderBy: (QueryOrderMap<T> & { 0?: never }) | QueryOrderMap<T>[]): SqlBuilder<T> {
    if (!orderBy) {
      return this;
    }

    this.statements.orderBy = this.objectToStringMap(orderBy);
    return this;
  }

  limit(limit: number | undefined): SqlBuilder<T> {
    this.statements.limit = limit;
    return this;
  }

  offset(offset: number | undefined): SqlBuilder<T> {
    this.statements.offset = offset;
    return this;
  }

  cache(cache: boolean | number | Date | undefined): SqlBuilder<T> {
    this.statements.cache = cache;

    return this;
  }

  load(load: string[]): SqlBuilder<T> {
    load?.forEach(relationshipPath => {
      this.joinManager.addJoinForRelationshipPath(relationshipPath);
    });
    if (this.statements.join) {
      this.statements.join = this.normalizeJoinOrder(this.statements.join);
    }

    if (this.statements.selectJoin) {
      this.statements.selectJoin = this.statements.selectJoin?.reverse()
    }

    return this;
  }

  count(): SqlBuilder<T> {
    const { tableName, schema } = this.getTableName();
    this.statements.statement = 'count';
    this.statements.alias = this.getAlias(tableName);
    this.statements.table = this.qualifyTable(schema, tableName);
    return this;
  }


  private shouldUseCache(): boolean {
    if (this.statements.statement !== 'select') {
      return false;
    }

    if (this.statements.cache === false) {
      return false;
    }

    if (this.statements.cache instanceof Date) {
      return this.statements.cache.getTime() > Date.now();
    }

    return this.statements.cache !== undefined;
  }

  private getCacheTtl(): number | undefined {
    if (this.statements.cache === true) {
      return undefined;
    }

    if (this.statements.cache instanceof Date) {
      const diff = this.statements.cache.getTime() - Date.now();

      return diff > 0 ? diff : 0;
    }

    return this.statements.cache as number;
  }

  private async getCachedResult(): Promise<any> {
    if (!this.cacheManager) {
      return undefined;
    }

    return this.cacheManager.get(this.statements);
  }

  private async setCachedResult(result: any): Promise<void> {
    if (!this.cacheManager) {
      return;
    }

    const ttl = this.getCacheTtl();

    if (ttl === 0) {
      return;
    }

    await this.cacheManager.set(this.statements, result, ttl);
  }

  async execute(): Promise<{ query: any; startTime: number; sql: string; affectedRows?: number }> {
    this.prepareColumns();
    this.statements.join = this.normalizeJoinOrder(this.statements.join);

    const isWrite = this.isWriteOperation();

    if (isWrite) {
      // Throws when a live resource compute is on the stack: a resource reads,
      // an action writes. Runs before execution so the side effect is aborted,
      // not merely reported.
      statementObserver.notifyWriteAttempt(this.statements);
    } else {
      // Deliberately before the cache check: a read served from cache still has
      // to register its dependency, or a resource whose first compute hit the
      // cache would never be invalidated.
      statementObserver.notifyRead(this.statements);
    }

    if (this.shouldUseCache()) {
      const cached = await this.getCachedResult();

      if (cached) {
        return cached;
      }
    }

    this.beforeHooks();
    this.applyTenantIsolation();
    const versionLockApplied = this.applyVersionLocking();

    const result = await this.driver.executeStatement(this.statements);
    this.logExecution(result);

    if (versionLockApplied && result.affectedRows === 0) {
      throw new OptimisticLockError(this.model.name, this.statements.where);
    }

    if (this.shouldUseCache()) {
      await this.setCachedResult(result);
    }

    if (isWrite) {
      await this.invalidateCache();
      // After execution, so a failed write does not invalidate. A write rolled
      // back later by its transaction still notifies: the recompute produces
      // the same data and therefore no patch, so it costs CPU, never
      // correctness.
      statementObserver.notifyWrite(this.statements);
    }

    return result;
  }

  private applyTenantIsolation(): void {
    const tenantId = tenantContext.getTenantId();
    if (tenantId !== undefined) {
      const tenantField = Metadata.get(TENANT_PROPERTY, this.model) as string | undefined;
      if (tenantField) {
        const metadata = Metadata.get(PROPERTIES_METADATA, this.model) || {};
        const column = metadata[tenantField]?.options?.columnName || tenantField;

        const tenantValue = typeof tenantId === 'string'
          ? `'${escapeString(tenantId, this.driver.dbType === 'mysql')}'`
          : tenantId;
        const tenantCondition = `${this.statements.alias}.${column} = ${tenantValue}`;
        
        if (this.statements.statement === 'insert' && this.statements.values) {
          if (this.statements.values[column] === undefined) {
             this.statements.values[column] = tenantId;
          }
        } else {
          if (this.statements.where) {
            this.statements.where = `(${this.statements.where}) AND ${tenantCondition}`;
          } else {
            this.statements.where = tenantCondition;
          }
        }
      }
    }
  }

  private applyVersionLocking(): boolean {
    if (this.statements.statement === 'update') {
      const versionField = Metadata.get(VERSION_PROPERTY, this.model) as string | undefined;
      if (versionField) {
        const metadata = Metadata.get(PROPERTIES_METADATA, this.model) || {};
        const column = metadata[versionField]?.options?.columnName || versionField;

        // Values have been through processForUpdate which converts property names to column names,
        // so we must check using the DB column name, not the JS property name.
        if (this.statements.values && this.statements.values[column] !== undefined) {
          const currentVersion = Number(this.statements.values[column]);

          if (!Number.isFinite(currentVersion)) {
            throw new Error('Optimistic lock version must be a finite number');
          }

          // Auto-increment the version in the SET clause
          this.statements.values[column] = currentVersion + 1;

          const versionCondition = `${this.statements.alias}.${column} = ${currentVersion}`;
          if (this.statements.where) {
            this.statements.where = `(${this.statements.where}) AND ${versionCondition}`;
          } else {
            this.statements.where = versionCondition;
          }

          return true; // version locking was applied
        }
      }
    }
    return false;
  }

  private isWriteOperation(): boolean {
    const writeOps = ['insert', 'update', 'delete'];
    return writeOps.includes(this.statements.statement || '');
  }

  private async invalidateCache(): Promise<void> {
    if (!this.cacheManager) {
      return;
    }

    const cacheConfig = Orm.getInstance().connection.cache;
    const shouldInvalidate = cacheConfig?.invalidateCacheOnWrite ?? true;

    if (!shouldInvalidate) {
      return;
    }

    await this.cacheManager.invalidate(this.statements);
  }

  private prepareColumns(): void {
    if (!this.statements.columns) {
      this.statements.columns = this.columnManager.generateColumns(
        this.model,
        this.updatedColumns
      );
      return;
    }

    this.statements.columns = [
      ...this.columnManager.processUserColumns(this.statements.columns),
      ...this.updatedColumns
    ];
  }

  private beforeHooks() {
    if (this.statements.statement === 'update') {
      this.callHook('beforeUpdate', this.statements.instance);
      return;
    }

    if (this.statements.statement === 'insert') {
      if (this.statements.bulk && this.statements.instances) {
        for (let i = 0; i < this.statements.instances.length; i += 1) {
          this.callHook('beforeCreate', this.statements.instances[i]);
        }
        return;
      }
      this.callHook('beforeCreate');
      return;
    }
  }

  private afterHooks(model?: any) {
    if (this.statements.statement === 'update') {
      this.callHook('afterUpdate', this.statements.instance);
      return;
    }

    if (this.statements.statement === 'insert') {
      this.callHook('afterCreate', model);
      return;
    }
  }

  async executeAndReturnFirst(): Promise<T | undefined> {
    const hasOneToManyJoinedJoin = this.hasOneToManyJoinedJoin();

    if (!hasOneToManyJoinedJoin) {
      this.statements.limit = 1;
    }

    const result = await this.execute();

    if (result.query.rows.length === 0) {
      return undefined;
    }

    if (hasOneToManyJoinedJoin) {
      return this.processOneToManyJoinedResult(result.query.rows);
    }

    const entities = result.query.rows[0];
    const model = await this.modelTransformer.transform(this.model, this.statements, entities);
    this.afterHooks(model);
    await this.joinManager.handleSelectJoin(entities, model);

    return model as any;
  }

  async executeAndReturnFirstOrFail(): Promise<T> {
    const hasOneToManyJoinedJoin = this.hasOneToManyJoinedJoin();

    if (!hasOneToManyJoinedJoin) {
      this.statements.limit = 1;
    }

    const result = await this.execute();

    if (result.query.rows.length === 0) {
      throw new Error('Result not found');
    }

    if (hasOneToManyJoinedJoin) {
      const model = await this.processOneToManyJoinedResult(result.query.rows);
      if (!model) {
        throw new Error('Result not found');
      }
      return model;
    }

    const entities = result.query.rows[0];
    const model = await this.modelTransformer.transform(this.model, this.statements, entities);
    this.afterHooks(model);
    await this.joinManager.handleSelectJoin(entities, model);
    return model as any;
  }

  /**
   * Execute a bulk INSERT and return the resulting entity instances. The
   * driver layer (PG via `RETURNING`, MySQL via `LAST_INSERT_ID()` + SELECT)
   * is responsible for shaping the rows; this method only hydrates them.
   */
  async executeAndReturnMany(): Promise<T[]> {
    const result = await this.execute();

    if (result.query.rows.length === 0) {
      return [];
    }

    const rows = result.query.rows;
    const results: T[] = [];

    for (let i = 0; i < rows.length; i += 1) {
      const model = this.modelTransformer.transform(this.model, this.statements, rows[i]);
      this.afterHooks(model);
      results.push(model as T);
    }

    return results;
  }

  async executeAndReturnAll(): Promise<T[]> {
    const result = await this.execute();

    if (result.query.rows.length === 0) {
      return [];
    }

    const rows = result.query.rows;
    const hasOneToManyJoinedJoin = this.hasOneToManyJoinedJoin();

    if (hasOneToManyJoinedJoin) {
      return this.processAllOneToManyJoinedResults(rows);
    }

    const results = [];

    for (const row of rows) {
      const models = this.modelTransformer.transform(this.model, this.statements, row);
      this.afterHooks(models);
      results.push(models);
    }

    await this.joinManager.handleSelectJoinBatch(rows, results);

    return results as any;
  }

  private hasOneToManyJoinedJoin(): boolean {
    if (!this.statements.join || this.statements.join.length === 0) {
      return false;
    }

    if (this.statements.strategy !== 'joined') {
      return false;
    }

    return this.statements.join.some(join => {
      const originEntity = this.getOriginEntityForJoin(join);

      if (!originEntity) {
        return false;
      }

      const relationship = originEntity.relations.find(
        rel => rel.propertyKey === join.joinProperty
      );

      return relationship?.relation === 'one-to-many' || relationship?.relation === 'many-to-many';
    });
  }


  private getOriginEntityForJoin(join: any): any {
    const rootAlias = this.statements.alias!;

    if (join.originAlias === rootAlias) {
      return this.entity;
    }

    const parentJoin = this.statements.join.find(j => j.joinAlias === join.originAlias);

    if (parentJoin && parentJoin.joinEntity) {
      return this.entityStorage.get(parentJoin.joinEntity);
    }

    return null;
  }


  private findNestedModel(model: any, targetAlias: string): any {
    if (!this.statements.join) {
      return null;
    }

    for (const join of this.statements.join) {
      if (join.joinAlias === targetAlias) {
        const parentModel = join.originAlias === this.statements.alias!
          ? model
          : this.findNestedModel(model, join.originAlias);

        return parentModel?.[join.joinProperty];
      }
    }

    return null;
  }

  private async processOneToManyJoinedResult(rows: any[]): Promise<T | undefined> {
    const primaryKey = this.getPrimaryKeyName();
    const alias = this.statements.alias!;
    const primaryKeyColumn = `${alias}_${primaryKey}`;

    const firstRowPrimaryKeyValue = rows[0][primaryKeyColumn];
    const relatedRows = rows.filter(row => row[primaryKeyColumn] === firstRowPrimaryKeyValue);

    const model = this.modelTransformer.transform(this.model, this.statements, relatedRows[0]);
    this.afterHooks(model);

    this.attachOneToManyRelations(model, relatedRows);

    return model as any;
  }


  private async processAllOneToManyJoinedResults(rows: any[]): Promise<T[]> {
    const primaryKey = this.getPrimaryKeyName();
    const alias = this.statements.alias!;
    const primaryKeyColumn = `${alias}_${primaryKey}`;

    const groupedRows = new Map<any, any[]>();

    for (const row of rows) {
      const pkValue = row[primaryKeyColumn];

      if (!groupedRows.has(pkValue)) {
        groupedRows.set(pkValue, []);
      }

      groupedRows.get(pkValue)!.push(row);
    }

    const results: T[] = [];

    for (const [, relatedRows] of groupedRows) {
      const model = this.modelTransformer.transform(this.model, this.statements, relatedRows[0]);
      this.afterHooks(model);
      this.attachOneToManyRelations(model, relatedRows);
      results.push(model as any);
    }

    return results;
  }

  private attachOneToManyRelations(model: any, rows: any[]): void {
    if (!this.statements.join) {
      return;
    }

    for (const join of this.statements.join) {
      const originEntity = this.getOriginEntityForJoin(join);

      if (!originEntity) {
        continue;
      }

      const relationship = originEntity.relations.find(
        rel => rel.propertyKey === join.joinProperty
      );

      if (relationship?.relation === 'one-to-many' || relationship?.relation === 'many-to-many') {
        const joinedModels = rows.map(row =>
          this.modelTransformer.transform(join.joinEntity, { alias: join.joinAlias }, row)
        );

        const uniqueModels = this.removeDuplicatesByPrimaryKey(joinedModels, join.joinEntity);

        const targetModel = join.originAlias === this.statements.alias!
          ? model
          : this.findNestedModel(model, join.originAlias);

        if (targetModel) {
          targetModel[join.joinProperty] = uniqueModels;
        }
      }
    }
  }

  private removeDuplicatesByPrimaryKey(models: any[], entityClass: Function): any[] {
    const entity = this.entityStorage.get(entityClass);
    if (!entity) {
      return models;
    }

    const primaryKey = entity._primaryKeyPropertyName || 'id';
    const seen = new Set();
    const unique: any[] = [];

    for (const model of models) {
      const id = model[primaryKey];
      if (id && !seen.has(id)) {
        seen.add(id);
        unique.push(model);
      }
    }

    return unique;
  }

  private getPrimaryKeyName(): string {
    return this.entity._primaryKeyPropertyName || 'id';
  }


  async executeCount(): Promise<number> {
    const result = await this.execute();

    if (result.query.rows.length === 0) {
      return 0;
    }

    return parseInt(result.query.rows[0].count);
  }

  private logExecution(result: { query: any, startTime: number, sql: string }): void {
    this.logger.debug(`SQL: ${result.sql} [${Date.now() - result.startTime}ms]`);
  }

  private normalizeJoinOrder(joins: Statement<T>['join']): Statement<T>['join'] {
    if (!joins || joins.length <= 1) {
      return joins;
    }

    // Pre-compute dependencies (regex scan) once per join — the previous
    // implementation re-ran the regex on every iteration of the outer loop.
    const n = joins.length;
    const deps: string[][] = new Array(n);
    for (let i = 0; i < n; i += 1) {
      deps[i] = this.getJoinDependencies(joins[i].on, joins[i].joinAlias);
    }

    const placed: boolean[] = new Array(n).fill(false);
    const available = new Set<string>([this.statements.alias!]);
    const ordered: NonNullable<Statement<T>['join']> = [];

    let progress = true;
    while (progress && ordered.length < n) {
      progress = false;
      for (let i = 0; i < n; i += 1) {
        if (placed[i]) continue;
        const d = deps[i];
        let ready = true;
        for (let k = 0; k < d.length; k += 1) {
          if (!available.has(d[k])) { ready = false; break; }
        }
        if (ready) {
          ordered.push(joins[i]);
          available.add(joins[i].joinAlias);
          placed[i] = true;
          progress = true;
        }
      }
    }

    // Cycle / unresolvable dependency fallback — preserve original order.
    if (ordered.length < n) {
      for (let i = 0; i < n; i += 1) {
        if (!placed[i]) ordered.push(joins[i]);
      }
    }

    return ordered;
  }

  private getJoinDependencies(on: string, joinAlias: string): string[] {
    const aliases = new Set<string>();
    const pattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\./g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(on)) !== null) {
      const alias = match[1];

      if (alias !== joinAlias) {
        aliases.add(alias);
      }
    }

    return [...aliases];
  }

  async inTransaction<T>(callback: (builder: SqlBuilder<T>) => Promise<T>): Promise<T> {
    return await this.driver.transaction(async (tx) => {
      // @ts-ignore
      return await callback(this);
    });
  }

  private objectToStringMap(obj: any, parentKey: string = ''): string[] {
    return Object.keys(obj)
      .filter(key => obj.hasOwnProperty(key))
      .flatMap(key => this.mapObjectKey(obj, key, parentKey));
  }

  private mapObjectKey(obj: any, key: string, parentKey: string): string[] {
    const fullKey = parentKey ? `${parentKey}.${key}` : key;

    if (this.isNestedObject(obj[key])) {
      return this.objectToStringMap(obj[key], fullKey);
    }

    if (parentKey) {
      const columnPath = this.buildColumnPath(fullKey);
      return [`${this.columnManager.discoverAlias(columnPath, true)} ${normalizeOrderDirection(obj[key])}`];
    }

    const columnName = ValueProcessor.getColumnName(key, this.entity);
    return [`${this.columnManager.discoverAlias(columnName, true)} ${normalizeOrderDirection(obj[key])}`];
  }

  private isNestedObject(value: any): boolean {
    return typeof value === 'object' && value !== null;
  }

  private buildColumnPath(path: string): string {
    const segments = this.splitPath(path);
    const entity = this.resolvePathEntity(segments.parents);
    const column = this.resolveColumn(segments.column, entity);
    return this.joinSegments(segments.parents, column);
  }

  private splitPath(path: string): { parents: string[]; column: string } {
    const parts = path.split('.');
    const column = parts.pop() ?? path;
    return { parents: parts, column };
  }

  private resolvePathEntity(parents: string[]): Options {
    let current = this.entity;

    for (const relation of parents) {
      current = this.nextEntity(current, relation);
    }

    return current;
  }

  private nextEntity(entity: Options, relation: string): Options {
    const relations = entity.relations ?? [];
    const meta = relations.find(rel => rel.propertyKey === relation);

    if (!meta) {
      throw new Error(`Relationship "${relation}" not found for ORDER BY path`);
    }

    const next = this.entityStorage.get(meta.entity() as Function);

    if (!next) {
      throw new Error(`Entity metadata not found for relation "${relation}"`);
    }

    return next;
  }

  private resolveColumn(column: string, entity: Options): string {
    return ValueProcessor.getColumnName(column, entity);
  }

  private joinSegments(parents: string[], column: string): string {
    if (parents.length === 0) {
      return column;
    }

    return `${parents.join('.')}.${column}`;
  }

  private getTableName() {
    const tableName = this.entity.tableName || (this.model as Function).name.toLowerCase();
    const schema = this.entity.schema || 'public';
    return { tableName, schema };
  }

  private t(value: any) {
    return (typeof value === 'string') ? `'${value}'` : value;
  }

  // private conditionLogicalOperatorToSql<T extends typeof BaseEntity>(conditions: Condition<T>[], operator: 'AND' | 'OR'): string {
  //   const sqlParts = conditions.map(cond => this.conditionToSql(cond));
  //   return this.addLogicalOperatorToSql(sqlParts, operator);
  // }

  private getEntity(model: new () => T) {
    const entity = this.entityStorage.get((model as Function));
    this.model = model;

    if (!entity) {
      throw new Error('Entity not found');
    }

    this.entity = entity;
    this.statements.columnMetadata = this.buildColumnMetadata(entity);
  }

  private buildColumnMetadata(entity: Options): Record<string, ColumnMetadata> {
    const metadata: Record<string, ColumnMetadata> = {};
    const properties = entity._metadataIndex?.allProperties || [];

    for (let i = 0; i < properties.length; i += 1) {
      const property = properties[i];
      metadata[property.columnName] = {
        dbType: property.options.dbType,
        array: property.options.array,
        type: property.type,
      };
    }

    return metadata;
  }

  /**
   * Retrieves an alias for a given table name.
   *
   * @param {string} tableName - The name of the table.
   * @private
   * @returns {string} - The alias for the table name.
   */
  private getAlias(tableName: string): string {
    const baseAlias = tableName.split('').shift() || '';
    const uniqueAlias = this.generateUniqueAlias(baseAlias);
    this.aliases.add(uniqueAlias);
    return uniqueAlias;
  }

  private generateUniqueAlias(baseAlias: string): string {
    let counter = 1;
    let candidate = `${baseAlias}${counter}`;

    while (this.aliases.has(candidate)) {
      counter++;
      candidate = `${baseAlias}${counter}`;
    }

    return candidate;
  }

  private withDefaultValues(values: any, entityOptions: Options) {
    this.applyDefaultProperties(values, entityOptions);
    this.applyOnInsertProperties(values, entityOptions);
    return values;
  }

  private applyDefaultProperties(values: any, entityOptions: Options): void {
    const list = entityOptions._metadataIndex?.defaultProperties;
    if (!list || list.length === 0) return;

    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      if (typeof values[p.columnName] !== 'undefined') continue;
      values[p.columnName] = typeof p.options.default === 'function'
        ? (p.options.default as () => any)()
        : p.options.default;
    }
  }

  private applyOnInsertProperties(values: any, entityOptions: Options, trackColumns = true): void {
    const list = entityOptions._metadataIndex?.onInsertProperties;
    if (!list || list.length === 0) return;

    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      values[p.columnName] = p.options.onInsert!();
      if (trackColumns) {
        const col = this.quoteId(p.columnName);
        const aliasedCol = this.quoteId(`${this.statements.alias}_${p.columnName}`);
        this.updatedColumns.push(`${this.statements.alias}.${col} as ${aliasedCol}`);
      }
    }
  }

  private withUpdatedValues(values: any, entityOptions: Options) {
    const list = entityOptions._metadataIndex?.onUpdateProperties;
    if (!list || list.length === 0) return values;

    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      values[p.columnName] = p.options.onUpdate!();
      const col = this.quoteId(p.columnName);
      const aliasedCol = this.quoteId(`${this.statements.alias}_${p.columnName}`);
      this.updatedColumns.push(`${this.statements.alias}.${col} as ${aliasedCol}`);
    }
    return values;
  }

  public callHook(type: string, model?: any) {
    const hooks = this.statements.hooks?.filter(hook => hook.type === type) || [];
    const instance = model || this.statements.instance;
    hooks.forEach(hook => this.executeHook(hook, instance, !model));
  }

  private executeHook(hook: any, instance: any, shouldReflect: boolean): void {
    instance[hook.propertyName]();
    if (shouldReflect) this.reflectToValues();
  }

  private reflectToValues() {
    for (const key in this.statements.instance as any) {
      if (this.shouldSkipKey(key)) continue;
      this.reflectKey(key);
    }
  }

  private shouldSkipKey(key: string): boolean {
    return key.startsWith('$') || key.startsWith('_');
  }

  private reflectKey(key: string): void {
    if (this.entity.properties[key]) {
      this.reflectProperty(key);
      return;
    }

    this.reflectRelation(key);
  }

  private reflectProperty(key: string): void {
    const columnName = this.entity.properties[key].options.columnName;
    this.statements.values[columnName] = this.statements.instance[key];
  }

  private reflectRelation(key: string): void {
    const rel = this.entity.relations.find(rel => rel.propertyKey === key);
    if (rel && (rel.relation === 'many-to-one' || rel.relation === 'one-to-one-owner')) {
      this.statements.values[rel.columnName] = this.statements.instance[key];
    }
  }
}
