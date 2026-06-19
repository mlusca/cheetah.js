import { DriverInterface, FilterQuery, Relationship, Statement } from '../driver/driver.interface';
import { EntityStorage, Options } from '../domain/entities';
import { ValueObject } from '../common/value-object';
import { extendsFrom } from '../utils';
import { escapeString, assertSafeIdentifier } from '../utils/sql-escape';
import { SqlSubqueryBuilder } from './sql-subquery-builder';

type ApplyJoinCallback = (relationship: Relationship<any>, value: FilterQuery<any>, alias: string) => string;

const OPERATORS_SET = new Set([
  '$eq', '$ne', '$in', '$nin', '$like', '$notLike',
  '$gt', '$gte', '$lt', '$lte',
  '$and', '$or', '$exists', '$nexists',
]);

const LOGICAL_OPERATORS_SET = new Set(['$or', '$and']);
const PRIMITIVES_SET = new Set(['string', 'number', 'boolean', 'bigint']);

export class SqlConditionBuilder<T> {
  private lastKeyNotOperator = '';
  private subqueryBuilder?: SqlSubqueryBuilder;

  constructor(
    private entityStorage: EntityStorage,
    private applyJoinCallback: ApplyJoinCallback,
    private statements: Statement<T>,
    private driver: DriverInterface,
  ) {}

  setSubqueryBuilder(subqueryBuilder: SqlSubqueryBuilder): void {
    this.subqueryBuilder = subqueryBuilder;
  }

  build(condition: FilterQuery<T>, alias: string, model: Function): string {
    const sqlParts = this.processConditions(condition, alias, model);

    if (sqlParts.length === 0) {
      return '';
    }

    const result = this.wrapWithLogicalOperator(sqlParts, 'AND');
    return result;
  }

  private processConditions(condition: FilterQuery<T>, alias: string, model: Function): string[] {
    const sqlParts: string[] = [];

    for (let [key, value] of Object.entries(condition)) {
      const extractedValue = this.extractValueFromValueObject(value);
      const conditionSql = this.processEntry(key, extractedValue, alias, model);

      if (conditionSql) {
        sqlParts.push(conditionSql);
      }
    }

    return sqlParts;
  }

  private processEntry(key: string, value: any, alias: string, model: Function): string {
    this.trackLastNonOperatorKey(key, model);

    const relationship = this.findRelationship(key, model);
    
    if (relationship && !this.hasExistsOperator(value)) {
      return this.handleRelationship(relationship, value, alias);
    }

    if (this.isScalarValue(value)) {
      return this.handleScalarValue(key, value, alias, model);
    }

    if (this.isArrayValue(key, value)) {
      return this.buildInCondition(key, value, alias, model);
    }

    return this.handleObjectValue(key, value, alias, model);
  }

  private hasExistsOperator(value: any): boolean {
    return typeof value === 'object' && value !== null && ('$exists' in value || '$nexists' in value);
  }

  private handleRelationship(relationship: Relationship<any>, value: any, alias: string): string {
    const sql = this.applyJoinCallback(relationship, value, alias);

    if (this.statements.strategy === 'joined') {
      return sql;
    }

    return '';
  }

  private handleScalarValue(key: string, value: any, alias: string, model: Function): string {
    if (key === '$eq') {
      return this.buildSimpleCondition(this.lastKeyNotOperator, value, alias, '=', model);
    }

    return this.buildSimpleCondition(key, value, alias, '=', model);
  }

  private handleObjectValue(key: string, value: any, alias: string, model: Function): string {
    if (this.isLogicalOperator(key)) {
      return this.buildLogicalOperatorCondition(key, value, alias, model);
    }

    if (key === '$exists' || key === '$nexists') {
      return this.buildTopLevelExistsCondition(key, value, alias, model);
    }

    return this.buildOperatorConditions(key, value, alias, model);
  }

  private buildLogicalOperatorCondition(key: string, value: any[], alias: string, model: Function): string {
    const conditions = value.map((cond: any) => this.build(cond, alias, model));
    const operator = this.extractLogicalOperator(key);
    return this.wrapWithLogicalOperator(conditions, operator);
  }

  private buildOperatorConditions(key: string, value: any, alias: string, model: Function): string {
    const parts: string[] = [];

    for (const opKey in value) {
      if (OPERATORS_SET.has(opKey)) {
        const condition = this.buildOperatorCondition(key, opKey, value[opKey], alias, model);
        parts.push(condition);
      }
    }

    return parts.join(' AND ');
  }

  private buildOperatorCondition(key: string, operator: string, value: any, alias: string, model: Function): string {
    switch (operator) {
      case '$eq':
        return this.buildSimpleCondition(key, value, alias, '=', model);
      case '$ne':
        return this.buildSimpleCondition(key, value, alias, '!=', model);
      case '$in':
        return this.buildInCondition(key, value, alias, model);
      case '$nin':
        return this.buildNotInCondition(key, value, alias, model);
      case '$like':
        return this.buildLikeCondition(key, value, alias, model);
      case '$notLike':
        return this.buildNotLikeCondition(key, value, alias, model);
      case '$gt':
        return this.buildComparisonCondition(key, value, alias, '>', model);
      case '$gte':
        return this.buildComparisonCondition(key, value, alias, '>=', model);
      case '$lt':
        return this.buildComparisonCondition(key, value, alias, '<', model);
      case '$lte':
        return this.buildComparisonCondition(key, value, alias, '<=', model);
      case '$and':
      case '$or':
        return this.buildNestedLogicalCondition(operator, value, alias, model);
      case '$exists':
        return this.buildExistsCondition(key, value, alias, model, false);
      case '$nexists':
        return this.buildExistsCondition(key, value, alias, model, true);
      default:
        return '';
    }
  }

  private buildSimpleCondition(key: string, value: any, alias: string, operator: string, model: Function): string {
    const column = this.resolveColumnName(key, model);
    if (this.isNullish(value)) return this.buildNullCondition(alias, column, operator);
    const formattedValue = this.formatValue(value);
    return `${alias}.${column} ${operator} ${formattedValue}`;
  }

  private buildInCondition(key: string, values: any[], alias: string, model: Function): string {
    const column = this.resolveColumnName(key, model);
    const formattedValues = values.map(val => this.formatValue(val)).join(', ');
    return `${alias}.${column} IN (${formattedValues})`;
  }

  private buildNotInCondition(key: string, values: any[], alias: string, model: Function): string {
    const column = this.resolveColumnName(key, model);
    const formattedValues = values.map(val => this.formatValue(val)).join(', ');
    return `${alias}.${column} NOT IN (${formattedValues})`;
  }

  private buildLikeCondition(key: string, value: string, alias: string, model: Function): string {
    const column = this.resolveColumnName(key, model);
    const escaped = escapeString(value);
    return `${alias}.${column} LIKE '${escaped}'`;
  }

  private buildNotLikeCondition(key: string, value: string, alias: string, model: Function): string {
    const column = this.resolveColumnName(key, model);
    const escaped = escapeString(value);
    return `${alias}.${column} NOT LIKE '${escaped}'`;
  }

  private buildComparisonCondition(key: string, value: any, alias: string, operator: string, model: Function): string {
    const column = this.resolveColumnName(key, model);
    if (this.isNullish(value)) return this.buildNullCondition(alias, column, operator);
    const formattedValue = this.formatValue(value);
    return `${alias}.${column} ${operator} ${formattedValue}`;
  }

  private buildNestedLogicalCondition(operator: string, value: any[], alias: string, model: Function): string {
    const conditions = value.map((cond: any) => this.build(cond, alias, model));
    const logicalOp = this.extractLogicalOperator(operator);
    return this.wrapWithLogicalOperator(conditions, logicalOp);
  }

  private wrapWithLogicalOperator(conditions: string[], operator: 'AND' | 'OR'): string {
    return `(${conditions.join(` ${operator} `)})`;
  }

  private extractValueFromValueObject(value: any): any {
    if (extendsFrom(ValueObject, value?.constructor?.prototype)) {
      return (value as ValueObject<any, any>).getValue();
    }
    return value;
  }

  private formatValue(value: any): string {
    if (value instanceof Date) return this.formatDate(value);

    if (this.isNullish(value)) return 'NULL';

    if (this.isPrimitive(value)) return this.formatPrimitive(value);

    return this.formatJson(value);
  }

  private formatDate(value: Date): string {
    const formatted = this.driver.dbType === 'mysql'
      ? this.formatDateForMysql(value)
      : value.toISOString();

    return `'${formatted}'`;
  }

  private formatDateForMysql(value: Date): string {
    return value
      .toISOString()
      .replace('T', ' ')
      .replace('Z', '')
      .replace(/\.\d{3}/, '');
  }

  private isNullish(value: any): boolean {
    return value === null || value === undefined;
  }

  private buildNullCondition(alias: string, column: string, operator: string): string {
    if (operator === '!=' || operator === '<>') return `${alias}.${column} IS NOT NULL`;
    return `${alias}.${column} IS NULL`;
  }

  private isPrimitive(value: any): boolean {
    return PRIMITIVES_SET.has(typeof value);
  }

  private formatPrimitive(value: string | number | boolean | bigint): string {
    if (typeof value === 'string') {
      return `'${escapeString(value, this.escapeBackslash())}'`;
    }

    return `${value}`;
  }

  private formatJson(value: any): string {
    return `'${escapeString(JSON.stringify(value), this.escapeBackslash())}'`;
  }

  private escapeBackslash(): boolean {
    return this.driver.dbType === 'mysql';
  }

  private findRelationship(key: string, model: Function): Relationship<any> | undefined {
    const entity = this.entityStorage.get(model);
    return entity?.relations?.find(rel => rel.propertyKey === key);
  }

  private isScalarValue(value: any): boolean {
    const isDate = value instanceof Date;

    return typeof value !== 'object' || value === null || isDate;
  }

  private isArrayValue(key: string, value: any): boolean {
    return !OPERATORS_SET.has(key) && Array.isArray(value);
  }

  private isLogicalOperator(key: string): boolean {
    return LOGICAL_OPERATORS_SET.has(key);
  }

  private extractLogicalOperator(key: string): 'AND' | 'OR' {
    return key.toUpperCase().replace('$', '') as 'AND' | 'OR';
  }

  private trackLastNonOperatorKey(key: string, model: Function): void {
    if (!OPERATORS_SET.has(key)) {
      this.lastKeyNotOperator = key;
    }
  }

  private buildExistsCondition(
    key: string,
    filters: FilterQuery<any>,
    alias: string,
    model: Function,
    negate: boolean,
  ): string {
    const relationship = this.findRelationship(key, model);

    if (!relationship) {
      const entity = this.entityStorage.get(model);
      const availableRelations = entity?.relations
        ?.map((r) => r.propertyKey as string)
        .join(', ') || 'none';

      throw new Error(
        `Cannot use $${negate ? 'nexists' : 'exists'} on non-relationship field '${key}'. ` +
        `Available relationships: ${availableRelations}`,
      );
    }

    if (!this.subqueryBuilder) {
      throw new Error(
        'SqlSubqueryBuilder not initialized. This is an internal error.',
      );
    }

    return this.subqueryBuilder.buildExistsSubquery(
      relationship,
      filters,
      alias,
      negate,
      model,
    );
  }

  private buildTopLevelExistsCondition(
    operator: string,
    value: Record<string, any>,
    alias: string,
    model: Function,
  ): string {
    const negate = operator === '$nexists';
    const conditions: string[] = [];

    for (const [relationshipKey, filters] of Object.entries(value)) {
      const condition = this.buildExistsCondition(
        relationshipKey,
        filters,
        alias,
        model,
        negate,
      );

      conditions.push(condition);
    }

    const result = this.wrapWithLogicalOperator(conditions, 'AND');
    return result;
  }

  private resolveColumnName(property: string, model: Function): string {
    if (property.startsWith('$')) {
      return property;
    }

    const entity = this.entityStorage.get(model);
    if (!entity) {
      return assertSafeIdentifier(property);
    }

    const column = entity.properties?.[property]?.options.columnName;
    if (column) {
      return column;
    }

    return this.resolveRelationColumn(property, entity) ?? assertSafeIdentifier(property);
  }

  private resolveRelationColumn(property: string, entity: Options): string | undefined {
    const relation = entity.relations?.find(rel => rel.propertyKey === property);
    const column = relation?.columnName;
    return typeof column === 'string' ? column : undefined;
  }
}
