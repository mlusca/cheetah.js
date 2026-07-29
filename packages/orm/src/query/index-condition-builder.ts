import { FilterQuery } from '../driver/driver.interface';
import { ValueObject } from '../common/value-object';
import { extendsFrom, toSnakeCase } from '../utils';
import { escapeString } from '../utils/sql-escape';

const OPERATORS_SET = new Set([
  '$eq', '$ne', '$in', '$nin', '$like', '$notLike', '$ilike', '$notIlike',
  '$gt', '$gte', '$lt', '$lte',
  '$and', '$or', '$nor',
]);

const LOGICAL_OPERATORS_SET = new Set(['$or', '$and']);
const PRIMITIVES_SET = new Set(['string', 'number', 'boolean', 'bigint']);

export class IndexConditionBuilder<T> {
  private lastKeyNotOperator = '';

  constructor(private columnMap: Record<string, string>) {}

  build(condition: FilterQuery<T>): string {
    const sqlParts = this.processConditions(condition);

    if (sqlParts.length === 0) {
      return '';
    }

    return this.wrapWithLogicalOperator(sqlParts, 'AND');
  }

  private processConditions(condition: FilterQuery<T>): string[] {
    const entries = this.getEntries(condition);

    return this.processEntries(entries);
  }

  private getEntries(condition: FilterQuery<T>): [string, any][] {
    if (!condition || typeof condition !== 'object') {
      return [];
    }

    return Object.entries(condition);
  }

  private processEntries(entries: [string, any][]): string[] {
    const sqlParts: string[] = [];

    for (const [key, value] of entries) {
      const extractedValue = this.extractValueFromValueObject(value);
      const conditionSql = this.processEntry(key, extractedValue);

      if (conditionSql) {
        sqlParts.push(conditionSql);
      }
    }

    return sqlParts;
  }

  private processEntry(key: string, value: any): string {
    this.trackLastNonOperatorKey(key);

    if (this.isScalarValue(value)) {
      return this.handleScalarValue(key, value);
    }

    if (this.isArrayValue(key, value)) {
      return this.buildInCondition(key, value);
    }

    return this.handleObjectValue(key, value);
  }

  private handleScalarValue(key: string, value: any): string {
    if (key === '$eq') {
      return this.buildSimpleCondition(this.lastKeyNotOperator, value, '=');
    }

    return this.buildSimpleCondition(key, value, '=');
  }

  private handleObjectValue(key: string, value: any): string {
    if (this.isLogicalOperator(key)) {
      return this.buildLogicalOperatorCondition(key, value);
    }

    if (this.isNorOperator(key)) {
      return this.buildNorCondition(value);
    }

    return this.buildOperatorConditions(key, value);
  }

  private buildLogicalOperatorCondition(key: string, value: any[]): string {
    const conditions = value.map((cond: any) => this.build(cond));
    const operator = this.extractLogicalOperator(key);
    return this.wrapWithLogicalOperator(conditions, operator);
  }

  private buildOperatorConditions(key: string, value: any): string {
    const parts: string[] = [];

    for (const opKey in value) {
      if (OPERATORS_SET.has(opKey)) {
        const condition = this.buildOperatorCondition(key, opKey, value[opKey]);
        parts.push(condition);
      }
    }

    return parts.join(' AND ');
  }

  private buildOperatorCondition(key: string, operator: string, value: any): string {
    switch (operator) {
      case '$eq':
        return this.buildSimpleCondition(key, value, '=');
      case '$ne':
        return this.buildSimpleCondition(key, value, '!=');
      case '$in':
        return this.buildInCondition(key, value);
      case '$nin':
        return this.buildNotInCondition(key, value);
      case '$like':
        return this.buildLikeCondition(key, value);
      case '$notLike':
        return this.buildNotLikeCondition(key, value);
      case '$ilike':
        return this.buildILikeCondition(key, value);
      case '$notIlike':
        return this.buildNotILikeCondition(key, value);
      case '$gt':
        return this.buildComparisonCondition(key, value, '>');
      case '$gte':
        return this.buildComparisonCondition(key, value, '>=');
      case '$lt':
        return this.buildComparisonCondition(key, value, '<');
      case '$lte':
        return this.buildComparisonCondition(key, value, '<=');
      case '$and':
      case '$or':
        return this.buildNestedLogicalCondition(operator, value);
      case '$nor':
        return this.buildNorCondition(value);
      default:
        return '';
    }
  }

  private buildSimpleCondition(key: string, value: any, operator: string): string {
    const column = this.resolveColumnName(key);
    if (this.isNullish(value)) return this.buildNullCondition(column, operator);
    const formattedValue = this.formatValue(value);
    return `${column} ${operator} ${formattedValue}`;
  }

  private buildInCondition(key: string, values: any[]): string {
    const column = this.resolveColumnName(key);
    const formattedValues = values.map((val) => this.formatValue(val)).join(', ');
    return `${column} IN (${formattedValues})`;
  }

  private buildNotInCondition(key: string, values: any[]): string {
    const column = this.resolveColumnName(key);
    const formattedValues = values.map((val) => this.formatValue(val)).join(', ');
    return `${column} NOT IN (${formattedValues})`;
  }

  private buildLikeCondition(key: string, value: string): string {
    const column = this.resolveColumnName(key);
    const escaped = escapeString(value);
    return `${column} LIKE '${escaped}'`;
  }

  private buildNotLikeCondition(key: string, value: string): string {
    const column = this.resolveColumnName(key);
    const escaped = escapeString(value);
    return `${column} NOT LIKE '${escaped}'`;
  }

  private buildILikeCondition(key: string, value: string): string {
    const column = this.resolveColumnName(key);
    const escaped = escapeString(value);
    return `${column} ILIKE '${escaped}'`;
  }

  private buildNotILikeCondition(key: string, value: string): string {
    const column = this.resolveColumnName(key);
    const escaped = escapeString(value);
    return `${column} NOT ILIKE '${escaped}'`;
  }

  private buildComparisonCondition(key: string, value: any, operator: string): string {
    const column = this.resolveColumnName(key);
    if (this.isNullish(value)) return this.buildNullCondition(column, operator);
    const formattedValue = this.formatValue(value);
    return `${column} ${operator} ${formattedValue}`;
  }

  private buildNestedLogicalCondition(operator: string, value: any[]): string {
    const conditions = value.map((cond: any) => this.build(cond));
    const logicalOp = this.extractLogicalOperator(operator);
    return this.wrapWithLogicalOperator(conditions, logicalOp);
  }

  private buildNorCondition(value: any[]): string {
    const conditions = value.map((cond: any) => this.build(cond));
    const wrapped = this.wrapWithLogicalOperator(conditions, 'OR');
    return `NOT ${wrapped}`;
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
    return `'${value.toISOString()}'`;
  }

  private isNullish(value: any): boolean {
    return value === null || value === undefined;
  }

  private isPrimitive(value: any): boolean {
    return PRIMITIVES_SET.has(typeof value);
  }

  private formatPrimitive(value: string | number | boolean | bigint): string {
    if (typeof value === 'string') {
      return `'${escapeString(value)}'`;
    }

    return `${value}`;
  }

  private formatJson(value: any): string {
    return `'${escapeString(JSON.stringify(value))}'`;
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

  private isNorOperator(key: string): boolean {
    return key === '$nor';
  }

  private extractLogicalOperator(key: string): 'AND' | 'OR' {
    return key.toUpperCase().replace('$', '') as 'AND' | 'OR';
  }

  private trackLastNonOperatorKey(key: string): void {
    if (!OPERATORS_SET.has(key)) {
      this.lastKeyNotOperator = key;
    }
  }

  private resolveColumnName(property: string): string {
    if (property.startsWith('$')) {
      return property;
    }

    const column = this.columnMap[property];
    if (column) {
      return column;
    }

    return toSnakeCase(property);
  }

  private buildNullCondition(column: string, operator: string): string {
    if (operator === '!=' || operator === '<>') return `${column} IS NOT NULL`;
    return `${column} IS NULL`;
  }
}
