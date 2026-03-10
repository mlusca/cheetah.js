import { Statement, Relationship, FilterQuery, DriverInterface } from '../driver/driver.interface';
import { EntityStorage, Options } from '../domain/entities';
import { SqlConditionBuilder } from './sql-condition-builder';
import { SqlColumnManager } from './sql-column-manager';
import { ModelTransformer } from './model-transformer';
import type { Logger } from '../logger';

export class SqlJoinManager<T> {
  constructor(
    private entityStorage: EntityStorage,
    private statements: Statement<T>,
    private entity: Options,
    private model: new () => T,
    private driver: DriverInterface,
    private logger: Logger,
    private conditionBuilder: SqlConditionBuilder<T>,
    private columnManager: SqlColumnManager,
    private modelTransformer: ModelTransformer,
    private getOriginalColumnsCallback: () => string[],
    private getAliasCallback: (tableName: string) => string,
  ) { }

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

  addJoinForRelationshipPath(relationshipPath: string): void {
    const relationshipNames = relationshipPath.split('.');
    let currentEntity = this.entity;
    let currentAlias = this.statements.alias!;

    for (const relationshipName of relationshipNames) {
      const relationship = currentEntity.relations.find(
        (rel) => rel.propertyKey === relationshipName,
      );

      if (!relationship) {
        throw new Error(
          `Relationship "${relationshipName}" not found in entity "${currentEntity.tableName}"`,
        );
      }

      const statement =
        this.statements.strategy === 'joined'
          ? this.statements.join
          : this.statements.selectJoin;

      const nameAliasProperty =
        this.statements.strategy === 'joined' ? 'joinAlias' : 'alias';

      const existingJoin = statement?.find(
        (j) =>
          j.joinProperty === relationshipName && j.originAlias === currentAlias,
      );

      if (existingJoin) {
        currentAlias = existingJoin[nameAliasProperty];
        currentEntity = this.entityStorage.get(relationship.entity() as Function)!;
        continue;
      }

      this.applyJoin(relationship, {}, currentAlias);

      const newStatement =
        this.statements.strategy === 'joined'
          ? this.statements.join
          : this.statements.selectJoin;

      currentAlias = newStatement![newStatement!.length - 1][nameAliasProperty];
      currentEntity = this.entityStorage.get(relationship.entity() as Function)!;
    }
  }

  applyJoin(relationShip: Relationship<any>, value: FilterQuery<any>, alias: string): string {
    const normalizedValue = this.normalizeRelationFilterValue(relationShip, value);

    if (relationShip.relation === 'many-to-many') {
      return this.applyManyToManyJoin(relationShip, normalizedValue, alias);
    }

    const { tableName, schema } = this.getTableName();
    const {
      tableName: joinTableName,
      schema: joinSchema,
      hooks: joinHooks,
    } = this.entityStorage.get((relationShip.entity() as Function)) || {
      tableName: (relationShip.entity() as Function).name.toLowerCase(),
      schema: 'public',
    };

    const originPrimaryKey = this.getPrimaryKey();
    const joinAlias = this.getAliasCallback(joinTableName);
    const joinWhere = this.conditionBuilder.build(normalizedValue, joinAlias, relationShip.entity() as Function);
    const on = this.buildJoinOn(relationShip, alias, joinAlias, originPrimaryKey);

    if (this.statements.strategy === 'joined') {
      this.addJoinedJoin(relationShip, joinTableName, joinSchema, joinAlias, joinWhere, on, alias, schema, tableName, joinHooks);
    } else {
      this.addSelectJoin(relationShip, joinTableName, joinSchema, joinAlias, joinWhere, originPrimaryKey, alias, joinHooks);
    }

    return joinWhere;
  }

  private applyManyToManyJoin(relationShip: Relationship<any>, value: FilterQuery<any>, alias: string): string {
    const { schema } = this.getTableName();
    const relatedEntityOptions = this.entityStorage.get(relationShip.entity() as Function) || {
      tableName: (relationShip.entity() as Function).name.toLowerCase(),
      schema: 'public',
    };
    const relatedTableName = relatedEntityOptions.tableName;
    const relatedSchema = relatedEntityOptions.schema || 'public';

    const pivotTable = relationShip.pivotTable!;
    const joinColumn = relationShip.joinColumn!;
    const inverseJoinColumn = relationShip.inverseJoinColumn!;
    const originPrimaryKey = this.getPrimaryKey();

    const relatedPkName = (relatedEntityOptions as any)._primaryKeyColumnName || 'id';

    if (this.statements.strategy === 'joined') {
      // First JOIN: entity -> pivot table
      const pivotAlias = this.getAliasCallback(pivotTable);
      const pivotOn = `${alias}.${this.quoteId(originPrimaryKey)} = ${pivotAlias}.${this.quoteId(joinColumn)}`;

      this.statements.join = this.statements.join || [];
      this.statements.join.push({
        joinAlias: pivotAlias,
        joinTable: pivotTable,
        joinSchema: schema || 'public',
        joinWhere: '',
        joinProperty: `__pivot_${relationShip.propertyKey as string}`,
        originAlias: alias,
        originSchema: schema || 'public',
        originTable: this.entity.tableName,
        propertyKey: `__pivot_${relationShip.propertyKey as string}`,
        type: 'LEFT',
        on: pivotOn,
        originalEntity: relationShip.originalEntity as Function,
        hooks: undefined,
      });

      // Second JOIN: pivot table -> related entity
      const relatedAlias = this.getAliasCallback(relatedTableName);
      const relatedOn = `${pivotAlias}.${this.quoteId(inverseJoinColumn)} = ${relatedAlias}.${this.quoteId(relatedPkName)}`;
      const joinWhere = this.conditionBuilder.build(value, relatedAlias, relationShip.entity() as Function);

      this.statements.join.push({
        joinAlias: relatedAlias,
        joinTable: relatedTableName,
        joinSchema: relatedSchema,
        joinWhere: joinWhere,
        joinProperty: relationShip.propertyKey as string,
        originAlias: alias,
        originSchema: schema || 'public',
        originTable: this.entity.tableName,
        propertyKey: relationShip.propertyKey,
        joinEntity: relationShip.entity() as Function,
        type: 'LEFT',
        on: relatedOn,
        originalEntity: relationShip.originalEntity as Function,
        hooks: (relatedEntityOptions as any).hooks,
      });

      return joinWhere;
    } else {
      // Select strategy: use subquery through pivot
      const relatedAlias = this.getAliasCallback(relatedTableName);
      const joinWhere = this.conditionBuilder.build(value, relatedAlias, relationShip.entity() as Function);

      this.statements.selectJoin = this.statements.selectJoin || [];
      this.statements.selectJoin.push({
        statement: 'select',
        columns: [],
        table: this.qualifyTable(relatedSchema, relatedTableName),
        alias: relatedAlias,
        where: joinWhere,
        joinProperty: relationShip.propertyKey as string,
        fkKey: relatedPkName,
        primaryKey: originPrimaryKey,
        originAlias: alias,
        originProperty: relationShip.propertyKey as string,
        joinEntity: relationShip.entity() as Function,
        originEntity: relationShip.originalEntity as Function,
        hooks: (relatedEntityOptions as any).hooks,
        // Store pivot info for select strategy processing
        customSchema: `pivot:${pivotTable}:${joinColumn}:${inverseJoinColumn}`,
      });

      return joinWhere;
    }
  }

  private normalizeRelationFilterValue(
    relationShip: Relationship<any>,
    value: FilterQuery<any>,
  ): FilterQuery<any> {
    const relatedEntity = this.entityStorage.get(relationShip.entity() as Function);
    const primaryKey = relatedEntity?._primaryKeyPropertyName || 'id';

    return this.wrapImplicitPrimaryKeyOperators(value, primaryKey);
  }

  private wrapImplicitPrimaryKeyOperators(value: any, primaryKey: string): any {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }

    const entries = Object.entries(value);

    if (entries.length === 0) {
      return value;
    }

    const keys = entries.map(([key]) => key);
    const hasFieldKeys = keys.some((key) => !key.startsWith('$'));
    const isImplicitPrimaryKeyOperatorObject =
      !hasFieldKeys &&
      keys.every((key) => key !== '$and' && key !== '$or' && key !== '$exists' && key !== '$nexists');

    if (isImplicitPrimaryKeyOperatorObject) {
      return {
        [primaryKey]: value,
      };
    }

    const normalized: Record<string, any> = {};

    for (const [key, nestedValue] of entries) {
      if ((key === '$and' || key === '$or') && Array.isArray(nestedValue)) {
        normalized[key] = nestedValue.map((branch) =>
          this.wrapImplicitPrimaryKeyOperators(branch, primaryKey),
        );
        continue;
      }

      normalized[key] = nestedValue;
    }

    return normalized;
  }

  async handleSelectJoin(entities: any, models): Promise<void> {
    if (!this.statements.selectJoin || this.statements.selectJoin.length === 0) {
      return;
    }

    for (const join of this.statements.selectJoin.reverse()) {
      await this.processSelectJoin(join, entities, models);
    }

    return models as any;
  }

  async handleSelectJoinBatch(entities: any[], models: any[]): Promise<void> {
    if (!this.statements.selectJoin || this.statements.selectJoin.length === 0) {
      return;
    }

    for (const join of this.statements.selectJoin.reverse()) {
      await this.processSelectJoinBatch(join, entities, models);
    }
  }

  getPathForSelectJoin(selectJoin: Statement<any>): string[] | null {
    const path = this.getPathForSelectJoinRecursive(selectJoin);
    return path.reverse();
  }

  private buildJoinOn(relationShip: Relationship<any>, alias: string, joinAlias: string, originPrimaryKey: string): string {
    let on = '';
    const fkKey = this.quoteId(this.getFkKey(relationShip));
    const pk = this.quoteId(originPrimaryKey);

    switch (relationShip.relation) {
      case "one-to-many":
      case "one-to-one-inverse":
        on = `${joinAlias}.${fkKey} = ${alias}.${pk}`;
        break;
      case "many-to-one":
      case "one-to-one-owner":
        const col = this.quoteId(relationShip.columnName as string);
        on = `${alias}.${col} = ${joinAlias}.${fkKey}`;
        break;
    }

    return on;
  }

  private addJoinedJoin(
    relationShip: Relationship<any>,
    joinTableName: string,
    joinSchema: string,
    joinAlias: string,
    joinWhere: string,
    on: string,
    alias: string,
    schema: string,
    tableName: string,
    joinHooks: any,
  ): void {
    this.statements.join = this.statements.join || [];

    this.statements.join.push({
      joinAlias: joinAlias,
      joinTable: joinTableName,
      joinSchema: joinSchema || 'public',
      joinWhere: joinWhere,
      joinProperty: relationShip.propertyKey as string,
      originAlias: alias,
      originSchema: schema,
      originTable: tableName,
      propertyKey: relationShip.propertyKey,
      joinEntity: (relationShip.entity() as Function),
      type: 'LEFT',
      on,
      originalEntity: relationShip.originalEntity as Function,
      hooks: joinHooks,
    });
  }

  private addSelectJoin(
    relationShip: Relationship<any>,
    joinTableName: string,
    joinSchema: string,
    joinAlias: string,
    joinWhere: string,
    originPrimaryKey: string,
    alias: string,
    joinHooks: any,
  ): void {
    this.statements.selectJoin = this.statements.selectJoin || [];

    this.statements.selectJoin.push({
      statement: 'select',
      columns: this.getOriginalColumnsCallback().filter(column => column.startsWith(`${relationShip.propertyKey as string}`)).map(column => column.split('.')[1]) || [],
      table: this.qualifyTable(joinSchema || 'public', joinTableName),
      alias: joinAlias,
      where: joinWhere,
      joinProperty: relationShip.propertyKey as string,
      fkKey: this.getFkKey(relationShip),
      primaryKey: originPrimaryKey,
      originAlias: alias,
      originProperty: relationShip.propertyKey as string,
      joinEntity: (relationShip.entity() as Function),
      originEntity: relationShip.originalEntity as Function,
      hooks: joinHooks,
    });
  }

  private async processSelectJoin(join: any, entities: any, models: any): Promise<void> {
    let ids = this.getIds(join, entities, models);

    if (Array.isArray(ids)) {
      ids = ids.map((id: any) => this.formatValue(id)).join(', ');
    }

    // ManyToMany select strategy: use pivot table subquery
    if (join.customSchema && typeof join.customSchema === 'string' && join.customSchema.startsWith('pivot:')) {
      this.updateManyToManyJoinWhere(join, ids);
    } else {
      this.updateJoinWhere(join, ids);
    }

    this.updateJoinColumns(join);

    const child = await this.driver.executeStatement(join);
    this.logger.debug(`SQL: ${child.sql} [${Date.now() - child.startTime}ms]`);

    this.attachJoinResults(join, child, models);
  }

  private updateManyToManyJoinWhere(join: any, ids: any): void {
    const parts = join.customSchema.split(':');
    const pivotTable = parts[1];
    const joinColumn = parts[2];
    const inverseJoinColumn = parts[3];
    const schema = join.originEntity ? (this.entityStorage.get(join.originEntity)?.schema || 'public') : 'public';
    const qualifiedPivot = this.qualifyTable(schema, pivotTable);
    const fkCol = this.quoteId(join.fkKey);

    const subquery = `${join.alias}.${fkCol} IN (SELECT ${this.quoteId(inverseJoinColumn)} FROM ${qualifiedPivot} WHERE ${this.quoteId(joinColumn)} IN (${ids}))`;

    if (join.where) {
      join.where = `${join.where} AND ${subquery}`;
    } else {
      join.where = subquery;
    }
  }

  private async processSelectJoinBatch(join: any, entities: any[], models: any[]): Promise<void> {
    const allIds = new Set<any>();

    for (let i = 0; i < entities.length; i++) {
      const ids = this.getIds(join, entities[i], models[i]);

      if (Array.isArray(ids)) {
        ids.forEach(id => {
          if (id !== undefined && id !== null) {
            allIds.add(id);
          }
        });
      } else if (ids !== undefined && ids !== null) {
        allIds.add(ids);
      }
    }

    if (allIds.size === 0) {
      return;
    }
    const idsString = Array.from(allIds)
      .map((id: any) => this.formatValue(id))
      .join(', ');

    // ManyToMany select strategy: use pivot table subquery
    if (join.customSchema && typeof join.customSchema === 'string' && join.customSchema.startsWith('pivot:')) {
      this.updateManyToManyJoinWhere(join, idsString);
    } else {
      this.updateJoinWhere(join, idsString);
    }

    this.updateJoinColumns(join);

    const result = await this.driver.executeStatement(join);
    this.logger.debug(`SQL (BATCHED): ${result.sql} [${Date.now() - result.startTime}ms]`);

    for (let i = 0; i < entities.length; i++) {
      this.attachJoinResults(join, result, models[i]);
    }
  }

  private getIds(join: any, entities: any, models: any): any {
    let ids = entities[`${join.originAlias}_${join.primaryKey}`];

    if (typeof ids === 'undefined') {
      const selectJoined = this.statements.selectJoin.find(j => j.joinEntity === join.originEntity);

      if (!selectJoined) {
        return undefined;
      }

      ids = this.findIdRecursively(models, selectJoined, join);
    }

    return ids;
  }

  private updateJoinWhere(join: any, ids: any): void {
    const fkCol = this.quoteId(join.fkKey);

    if (join.where) {
      join.where = `${join.where} AND ${join.alias}.${fkCol} IN (${ids})`;
    } else {
      join.where = `${join.alias}.${fkCol} IN (${ids})`;
    }
  }

  private updateJoinColumns(join: any): void {
    if (join.columns && join.columns.length > 0) {
      join.columns = (join.columns.map((column: string) => {
        const col = this.quoteId(column);
        const aliasedCol = this.quoteId(`${join.alias}_${column}`);

        return `${join.alias}.${col} as ${aliasedCol}`;
      }) as any[]);
    } else {
      join.columns = this.columnManager.getColumnsForEntity(join.joinEntity, join.alias) as any;
    }
  }

  private attachJoinResults(join: any, child: any, models: any): void {
    const property = this.entityStorage.get(this.model)!.relations.find(
      (rel) => rel.propertyKey === join.joinProperty,
    );

    const values = child.query.rows.map((row: any) =>
      this.modelTransformer.transform(join.joinEntity, join, row),
    );

    const path = this.getPathForSelectJoin(join);
    this.setValueByPath(models, path, property?.type === Array ? [...values] : values[0]);
  }

  private setValueByPath(obj: any, path: string[], value: any): void {
    let currentObj = obj;

    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      currentObj[key] = currentObj[key] || {};
      currentObj = currentObj[key];
    }

    currentObj[path[path.length - 1]] = value;
  }

  private getPathForSelectJoinRecursive(selectJoin: Statement<any>): string[] | null {
    const originJoin = this.statements.selectJoin.find(j => j.joinEntity === selectJoin.originEntity);
    let pathInJoin = [];

    if (!originJoin) {
      return [selectJoin.joinProperty];
    }

    if (originJoin.originEntity !== this.statements.originEntity) {
      pathInJoin = this.getPathForSelectJoinRecursive(originJoin);
    }

    return [selectJoin.joinProperty, ...pathInJoin];
  }

  private findIdRecursively(models: any, selectJoined: any, join: any): any {
    let ids = models[selectJoined.originProperty][join.primaryKey];

    if (typeof ids === 'undefined') {
      const nextSelectJoined = this.statements.selectJoin.find(j => j.joinEntity === selectJoined.originEntity);

      if (nextSelectJoined) {
        ids = this.findIdRecursively(models, nextSelectJoined, join);
      }
    }

    return ids;
  }

  private getFkKey(relationShip: Relationship<any>): string {
    if (typeof relationShip.fkKey === 'undefined') {
      // Use cached primary key column name from the related entity instead of hardcoded 'id'
      const relatedEntity = this.entityStorage.get(relationShip.entity() as Function);
      if (relatedEntity) {
        return relatedEntity._primaryKeyColumnName || 'id';
      }
      return 'id';
    }

    if (typeof relationShip.fkKey === 'string') {
      return relationShip.fkKey;
    }

    const match = /\.(?<propriedade>[\w]+)/.exec(relationShip.fkKey.toString());
    const propertyKey = match ? match.groups!.propriedade : '';
    const entity = this.entityStorage.get(relationShip.entity() as Function);

    if (!entity) {
      throw new Error(
        `Entity not found in storage for relationship. ` +
        `Make sure the entity ${(relationShip.entity() as Function).name} is decorated with @Entity()`
      );
    }

    const property = Object.entries(entity.properties).find(([key, _value]) => key === propertyKey)?.[1];

    if (property) {
      return property.options.columnName;
    }

    const relation = entity.relations.find(rel => rel.propertyKey === propertyKey);

    if (relation && relation.columnName) {
      return relation.columnName;
    }

    throw new Error(
      `Property or relation "${propertyKey}" not found in entity "${entity.tableName}". ` +
      `Available properties: ${Object.keys(entity.properties).join(', ')}. ` +
      `Available relations: ${entity.relations.map(r => r.propertyKey as string).join(', ')}`
    );
  }

  private getTableName(): { tableName: string; schema: string } {
    const tableName = this.entity.tableName || (this.model as Function).name.toLowerCase();
    const schema = this.entity.schema || 'public';
    return { tableName, schema };
  }

  private getPrimaryKey(): string {
    return this.entity._primaryKeyPropertyName || 'id';
  }

  private formatValue(value: any): string {
    return (typeof value === 'string') ? `'${value}'` : value;
  }
}
