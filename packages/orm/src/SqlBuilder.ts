import {
  AutoPath,
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
import type { Logger } from './logger';

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

    return `${q}${identifier}${q}`;
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

  update(values: Partial<{ [K in keyof T]: ValueOrInstance<T[K]> }>): SqlBuilder<T> {
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
      this.statements.join = this.statements.join?.reverse()
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

  async execute(): Promise<{ query: any; startTime: number; sql: string }> {
    this.prepareColumns();
    this.statements.join = this.statements.join?.reverse();

    if (this.shouldUseCache()) {
      const cached = await this.getCachedResult();

      if (cached) {
        return cached;
      }
    }

    this.beforeHooks();
    const result = await this.driver.executeStatement(this.statements);
    this.logExecution(result);

    if (this.shouldUseCache()) {
      await this.setCachedResult(result);
    }

    if (this.isWriteOperation()) {
      await this.invalidateCache();
    }

    return result;
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
      return [`${this.columnManager.discoverAlias(columnPath, true)} ${obj[key]}`];
    }

    const columnName = ValueProcessor.getColumnName(key, this.entity);
    return [`${this.columnManager.discoverAlias(columnName, true)} ${obj[key]}`];
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
    const defaultProperties = Object.entries(entityOptions.properties).filter(([_, value]) => value.options.default);

    for (const [key, property] of defaultProperties) {
      this.setDefaultValue(values, key, property);
    }
  }

  private setDefaultValue(values: any, key: string, property: any): void {
    const columnName = property.options.columnName;
    if (typeof values[columnName] !== 'undefined') return;

    values[columnName] = typeof property.options.default === 'function'
      ? property.options.default()
      : property.options.default;
  }

  private applyOnInsertProperties(values: any, entityOptions: Options): void {
    const properties = Object.entries(entityOptions.properties).filter(([_, value]) => value.options.onInsert);
    properties.forEach(([key, property]) => this.applyOnInsert(values, key, property));
  }

  private applyOnInsert(values: any, key: string, property: any): void {
    const columnName = property.options.columnName;
    values[columnName] = property.options.onInsert!();
    const col = this.quoteId(columnName);
    const aliasedCol = this.quoteId(`${this.statements.alias}_${columnName}`);
    this.updatedColumns.push(`${this.statements.alias}.${col} as ${aliasedCol}`);
  }

  private withUpdatedValues(values: any, entityOptions: Options) {
    const properties = Object.entries(entityOptions.properties).filter(([_, value]) => value.options.onUpdate);
    properties.forEach(([key, property]) => this.applyOnUpdate(values, property));
    return values;
  }

  private applyOnUpdate(values: any, property: any): void {
    const columnName = property.options.columnName;
    values[columnName] = property.options.onUpdate!();
    const col = this.quoteId(columnName);
    const aliasedCol = this.quoteId(`${this.statements.alias}_${columnName}`);
    this.updatedColumns.push(`${this.statements.alias}.${col} as ${aliasedCol}`);
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
