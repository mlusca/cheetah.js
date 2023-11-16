import {
  AutoPath,
  DriverInterface,
  FilterQuery,
  QueryOrderMap,
  Relationship,
  Statement,
} from './driver/driver.interface';
import { EntityStorage, Options } from './domain/entities';
import { Orm } from '../src';
import { LoggerService } from '@cheetah.js/core';

export class SqlBuilder<T> {
  private readonly driver: DriverInterface;

  private entityStorage: EntityStorage;
  private statements: Statement<T> = {};
  private entity!: Options;
  private model!: new () => T;

  private aliases: Set<string> = new Set();
  private lastKeyNotOperator = '';
  private logger: LoggerService;
  private updatedColumns: any[] = [];

  constructor(model: new () => T) {
    const orm = Orm.getInstance();
    this.driver = orm.driverInstance;
    this.logger = orm.logger;
    this.entityStorage = EntityStorage.getInstance()

    this.getEntity(model);
  }

  select(columns?: AutoPath<T, never, '*'>[]): SqlBuilder<T> {
    const tableName = this.entity.tableName || (this.model as Function).name.toLowerCase();
    const schema = this.entity.schema || 'public';

    this.statements.statement = 'select';

    this.statements.columns = columns;
    this.statements.alias = this.getAlias(tableName)
    this.statements.table = `"${schema}"."${tableName}"`;
    return this;
  }

  insert(values: Partial<T>): SqlBuilder<T> {
    const {tableName, schema} = this.getTableName();

    this.statements.statement = 'insert';
    this.statements.alias = this.getAlias(tableName)
    this.statements.table = `"${schema}"."${tableName}"`;
    this.statements.values = this.withUpdatedValues(this.withDefaultValues(values, this.entity), this.entity);
    return this;
  }

  update(values: Partial<T>): SqlBuilder<T> {
    const {tableName, schema} = this.getTableName();

    this.statements.statement = 'update';
    this.statements.alias = this.getAlias(tableName)
    this.statements.table = `${schema}.${tableName}`;
    this.statements.values = this.withUpdatedValues(values, this.entity);
    return this;
  }

  where(where: FilterQuery<T>): SqlBuilder<T> {
    if (typeof where === 'undefined' || Object.entries(where).length === 0) {
      return this;
    }

    this.statements.where = this.conditionToSql(where, this.statements.alias!);
    return this;
  }

  orderBy(orderBy: (QueryOrderMap<T> & {
    0?: never;
  }) | QueryOrderMap<T>[]): SqlBuilder<T> {
    if (typeof orderBy === 'undefined') {
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

  async executeAndReturnFirst(): Promise<T | undefined> {
    this.statements.limit = 1;

    const result = await this.execute();

    if (result.query.rows.length === 0) {
      return undefined;
    }

    return this.transformToModel(result.query.rows[0]);
  }

  async executeAndReturnFirstOrFail(): Promise<T> {
    this.statements.limit = 1;

    const result = await this.execute();

    if (result.query.rows.length === 0) {
      throw new Error('Result not found')
    }

    return this.transformToModel(result.query.rows[0]);
  }

  // TODO: Corrigir tipagem do retorno de acordo com o driver
  async executeAndReturnAll(): Promise<T[]> {
    const result = await this.execute()

    if (result.query.rows.length === 0) {
      return [];
    }

    return result.query.rows.map((row: any) => this.transformToModel(row));
  }

  async execute(): Promise<{ query: any, startTime: number, sql: string }> {
    if (!this.statements.columns) {
      let columns: any[] = [
        ...this.getColumnsEntity((this.model as Function), this.statements.alias!),
      ];

      if (this.statements.join) {
        columns = [
          ...columns,
          ...this.statements.join.flatMap(join => this.getColumnsEntity(join.joinEntity!, join.joinAlias)),
        ]
      }

      this.statements.columns = columns
    } else {
      // @ts-ignore
      this.statements.columns = this.statements.columns.map((column: string) => {
        return this.discoverColumnAlias(column)
      }).flat();
    }

    this.statements.columns!.push(...this.updatedColumns)

    const result = await this.driver.executeStatement(this.statements);
    // console.log(result.query.rows);
    this.logger.debug(`SQL: ${result.sql} [${Date.now() - result.startTime}ms]`)

    return result;
  }

  startTransaction(): Promise<void> {
    return this.driver.startTransaction();
  }

  commit(): Promise<void> {
    return this.driver.commitTransaction();
  }

  rollback(): Promise<void> {
    return this.driver.rollbackTransaction();
  }

  // TODO: transform transaction queries into just 1 query
  async inTransaction<T>(callback: (builder: SqlBuilder<T>) => Promise<T>): Promise<T> {
    await this.startTransaction();
    try {
      // @ts-ignore
      const result = await callback(this);
      await this.commit();
      return result;
    } catch (e) {
      await this.rollback();
      throw e;
    }
  }

  private objectToStringMap(obj: any, parentKey: string = ''): string[] {
    let result: string[] = [];

    for (let key in obj) {
      if (obj.hasOwnProperty(key)) {
        let fullKey = parentKey ? `${parentKey}.${key}` : key;
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          result = result.concat(this.objectToStringMap(obj[key], fullKey));
        } else {
          result.push(`${this.discoverColumnAlias(fullKey, true)} ${obj[key]}`);
        }
      }
    }

    return result;
  }

  private discoverColumnAlias(column: string, onlyAlias = false): string {
    if (!column.includes('.')) {
      if (onlyAlias) {
        return `${this.statements.alias!}."${column}"`
      }
      return `${this.statements.alias!}."${column}" as ${this.statements.alias!}_${column}`;
    }

    if (typeof this.statements.join === 'undefined') {
      throw new Error('Join not found');
    }

    const entities = column.split('.');
    let lastEntity = this.model as Function;
    let lastAlias = this.statements.alias!;

    const relationsMap = new Map(this.entity.relations.map(rel => [rel.propertyKey, rel]));
    const joinMap = new Map(this.statements.join!.map(join => [join.joinProperty, join]));

    for (let i = 0; i < entities.length; i++) {
      if (i === 0) {
        const relation = relationsMap.get(entities[i]);
        lastEntity = relation?.entity() as Function;
        // @ts-ignore
        lastAlias = joinMap.get(entities[i])?.joinAlias;
      } else {
        if ((i + 1) === entities.length) {
          if (onlyAlias) {
            return `${lastAlias}."${entities[i]}"`
          }
          return `${lastAlias}."${entities[i]}" as ${lastAlias}_${entities[i]}`;
        }

        const lastStatement = joinMap.get(entities[i]);
        lastEntity = lastStatement?.joinEntity as Function;
        // @ts-ignore
        lastAlias = lastStatement?.joinAlias;
      }
    }

    return '';
  }

  private getTableName() {
    const tableName = this.entity.tableName || (this.model as Function).name.toLowerCase();
    const schema = this.entity.schema || 'public';
    return {tableName, schema};
  }

  private addSimpleConditionToSql(key: string, value: any, alias: string | null = null, operator: string = '='): string {
    const aliasToUse = alias || this.statements.alias;
    const valueByType = (typeof value === 'string') ? `'${value}'` : value;

    return `${aliasToUse}.${key} ${operator} ${valueByType}`;
  }

  private addInConditionToSql(key: string, values: any[], alias: string | null = null): string {
    const aliasToUse = alias || this.statements.alias;
    return `${aliasToUse}.${key} IN (${values.map(val => (typeof val === 'string') ? `'${val}'` : val).join(", ")})`;
  }

  private addLogicalOperatorToSql(conditions: string[], operator: 'AND' | 'OR'): string {
    return `(${conditions.join(` ${operator} `)})`;
  }

  private conditionToSql(condition: FilterQuery<T>, alias: string): string {
    const sqlParts = [];
    const operators = ['$eq', '$ne', '$in', '$nin', '$like', '$gt', '$gte', '$lt', '$lte', '$and', '$or'];

    for (let [key, value] of Object.entries(condition)) {

      if (!operators.includes(key)) {
        this.lastKeyNotOperator = key;
      }

      const relationShip = this.entity.relations?.find(rel => rel.propertyKey === key);
      if (relationShip) {
        sqlParts.push(this.applyJoin(relationShip, value, alias));
      } else if (typeof value !== 'object' || value === null) {
        if (key === '$eq') {
          sqlParts.push(this.addSimpleConditionToSql(this.lastKeyNotOperator, value, alias, '='));
          continue;
        }

        sqlParts.push(this.addSimpleConditionToSql(key, value, alias));
      } else if (!(operators.includes(key)) && Array.isArray(value)) {
        sqlParts.push(this.addInConditionToSql(key, value, alias));
      } else {
        if (['$or', '$and'].includes(key)) {
          sqlParts.push(this.addLogicalOperatorToSql(value.map((cond: any) => this.conditionToSql(cond, alias)), key.toUpperCase().replace('$', '') as 'AND' | 'OR'));
        }

        for (const operator of operators) {
          if (operator in value) {
            switch (operator) {
              case '$eq':
                sqlParts.push(this.addSimpleConditionToSql(key, value['$eq'], alias, '='));
                break;
              case '$ne':
                sqlParts.push(this.addSimpleConditionToSql(key, value['$ne'], alias, '!='));
                break;
              case '$in':
                sqlParts.push(this.addInConditionToSql(key, value['$in'], alias));
                break;
              case '$nin':
                sqlParts.push(`${alias}.${key} NOT IN (${value['$nin'].map((val: any) => this.t(val)).join(", ")})`);
                break;
              case '$like':
                sqlParts.push(`${alias}.${key} LIKE '${value['$like']}'`);
                break;
              case '$gt':
                sqlParts.push(`${alias}.${key} > ${value['$gt']}`);
                break;
              case '$gte':
                sqlParts.push(`${alias}.${key} >= ${value['$gte']}`);
                break;
              case '$lt':
                sqlParts.push(`${alias}.${key} < ${value['$lt']}`);
                break;
              case '$lte':
                sqlParts.push(`${alias}.${key} <= ${value['$lte']}`);
                break;
              case '$and':
              case '$or':
                const parts = value[operator].map((cond: any) => this.conditionToSql(cond, alias))
                sqlParts.push(this.addLogicalOperatorToSql(parts, operator.toUpperCase().replace('$', '') as 'AND' | 'OR'));
                break;
            }
          }
        }
      }
    }

    return this.addLogicalOperatorToSql(sqlParts, 'AND');
  }

  private t(value: any) {
    return (typeof value === 'string') ? `'${value}'` : value;
  }

  private applyJoin(relationShip: Relationship<any>, value: FilterQuery<any>, alias: string) {
    const {tableName, schema} = this.getTableName();
    const {
      tableName: joinTableName,
      schema: joinSchema,
    } = this.entityStorage.get((relationShip.entity() as Function)) || {
      tableName: (relationShip.entity() as Function).name.toLowerCase(),
      schema: 'public',
    };
    let originPrimaryKey = 'id';
    for (const prop in this.entity.showProperties) {
      if (this.entity.showProperties[prop].options.isPrimary) {
        originPrimaryKey = prop;
        break;
      }
    }
    const joinAlias = `${this.getAlias(joinTableName)}`;
    const joinWhere = this.conditionToSql(value, joinAlias)
    this.statements.join = this.statements.join || [];
    let on = '';

    switch (relationShip.relation) {
      case "one-to-many":
        on = `${joinAlias}.${this.getFkKey(relationShip)} = ${alias}.${originPrimaryKey}`;
        break;
      case "many-to-one":
        on = `${alias}.${relationShip.propertyKey as string} = ${joinAlias}.${this.getFkKey(relationShip)}`;
        break;
    }

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
      // @ts-ignore
      on,
      originalEntity: relationShip.originalEntity as Function,
    })

    return joinWhere;
  }

  private getFkKey(relationShip: Relationship<any>): string | number {
    // se for nullable, deverá retornar o primary key da entidade target
    if (typeof relationShip.fkKey === 'undefined') {
      return 'id'; // TODO: Pegar dinamicamente o primary key da entidade target
    }

    // se o fkKey é uma função, ele retornará a propriedade da entidade que é a chave estrangeira
    // precisamos pegar o nome dessa propriedade
    if (typeof relationShip.fkKey === 'string') {
      return relationShip.fkKey;
    }

    const match = /\.(?<propriedade>[\w]+)/.exec(relationShip.fkKey.toString());
    return match ? match.groups!.propriedade : '';
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

  private transformToModel<T>(data: any): T {
    const instance = new (this.model as any)()

    instance.$_isPersisted = true;
    const entitiesByAlias: { [key: string]: Function } = {
      [this.statements.alias!]: instance,
    }
    const entitiesOptions: Map<string, Options> = new Map();
    entitiesOptions.set(this.statements.alias!, this.entityStorage.get(instance.constructor)!)

    if (this.statements.join) {
      this.statements.join.forEach(join => {
        const joinInstance = new (join.joinEntity! as any)();
        joinInstance.$_isPersisted = true;
        entitiesByAlias[join.joinAlias] = joinInstance;
        entitiesOptions.set(join.joinAlias, this.entityStorage.get(joinInstance.constructor)!)
      })
    }

    Object.entries(data).forEach(([key, value]) => {
      const [alias, prop] = key.split('_');
      const entity = entitiesByAlias[alias];
      if (!entity) {
        return;
      }

      const entityProperty = entitiesOptions.get(alias)!.showProperties[prop]
      if (entityProperty) {
        console.log(typeof value, entityProperty.type)
        // @ts-ignore
        entity[prop] = value;
      }
    });

    if (this.statements.join) {
      this.statements.join.forEach(join => {
        const {joinAlias, originAlias, propertyKey} = join;
        const originEntity = entitiesByAlias[originAlias];
        const joinEntity = entitiesByAlias[joinAlias];
        const property = entitiesOptions.get(originAlias)!.relations.find(rel => rel.propertyKey === propertyKey);

        if (!originEntity || !joinEntity) {
          return;
        }

        // @ts-ignore
        originEntity[propertyKey] = (property.type === Array) ? (originEntity[propertyKey]) ? [...originEntity[propertyKey], joinEntity] : [joinEntity] : joinEntity;
      })
    }

    return instance;
  }

  /**
   * Retrieves an alias for a given table name.
   *
   * @param {string} tableName - The name of the table.
   * @private
   * @returns {string} - The alias for the table name.
   */
  private getAlias(tableName: string): string {
    const alias = tableName.split('').shift() || '';

    let counter = 1;
    let uniqueAlias = `${alias}${counter}`;

    while (this.aliases.has(uniqueAlias)) {
      counter++;
      uniqueAlias = `${alias}${counter}`;
    }

    this.aliases.add(uniqueAlias);
    return uniqueAlias;
  }

  private getColumnsEntity(entity: Function, alias: string): string [] {
    const e = this.entityStorage.get(entity);
    if (!e) {
      throw new Error('Entity not found');
    }

    return Object.keys(e.showProperties).map(key => `${alias}."${key}" as "${alias}_${key}"`);
  }

  private withDefaultValues(values: any, entityOptions: Options) {
    const property = Object.entries(entityOptions.showProperties).filter(([_, value]) => value.options.onInsert);
    const defaultProperties = Object.entries(entityOptions.showProperties).filter(([_, value]) => value.options.default);

    for (const [key, property] of defaultProperties) {
      if (typeof values[key] === 'undefined') {
        if (typeof property.options.default === 'function') {
          values[key] = eval(property.options.default());
        } else {
          values[key] = eval(property.options.default);
        }
      }
    }

    property.forEach(([key, property]) => {
      values[key] = property.options.onInsert!();
      this.updatedColumns.push(`${this.statements.alias}."${key}" as "${this.statements.alias}_${key}"`)
    });

    return values;
  }

  private withUpdatedValues(values: any, entityOptions: Options) {
    const property = Object.entries(entityOptions.showProperties).filter(([_, value]) => value.options.onUpdate);

    property.forEach(([key, property]) => {
      values[key] = property.options.onUpdate!();
      this.updatedColumns.push(`${this.statements.alias}."${key}" as "${this.statements.alias}_${key}"`)
    });

    return values;
  }
}