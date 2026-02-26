import { DriverInterface, FilterQuery, Relationship } from '../driver/driver.interface';
import { EntityStorage } from '../domain/entities';
import { SqlConditionBuilder } from './sql-condition-builder';

export class SqlSubqueryBuilder {
  private aliasCounter = 1;

  constructor(
    private entityStorage: EntityStorage,
    private getConditionBuilder: () => SqlConditionBuilder<any>,
    private driver: DriverInterface,
  ) {}

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

  buildExistsSubquery(
    relationship: Relationship<any>,
    filters: FilterQuery<any>,
    outerAlias: string,
    negate: boolean,
    outerModel?: Function,
  ): string {
    const prefix = negate ? 'NOT EXISTS' : 'EXISTS';
    const subquery = this.buildSubquery(relationship, filters, outerAlias, outerModel);
    return `${prefix} (${subquery})`;
  }

  private buildSubquery(
    relationship: Relationship<any>,
    filters: FilterQuery<any>,
    outerAlias: string,
    outerModel?: Function,
  ): string {
    const subqueryAlias = this.generateAlias();
    const tableName = this.resolveTableName(relationship);
    const whereClause = this.buildWhereClause(
      relationship,
      filters,
      outerAlias,
      subqueryAlias,
      outerModel,
    );
    return `SELECT 1 FROM ${tableName} ${subqueryAlias} WHERE ${whereClause}`;
  }

  private buildWhereClause(
    relationship: Relationship<any>,
    filters: FilterQuery<any>,
    outerAlias: string,
    subqueryAlias: string,
    outerModel?: Function,
  ): string {
    const correlation = this.buildCorrelation(
      relationship,
      outerAlias,
      subqueryAlias,
      outerModel,
    );
    const filterSql = this.buildFilterConditions(
      filters,
      subqueryAlias,
      relationship,
    );
    return this.combineConditions(correlation, filterSql);
  }

  private buildCorrelation(
    relationship: Relationship<any>,
    outerAlias: string,
    subqueryAlias: string,
    outerModel?: Function,
  ): string {
    const fkKey = this.getFkKey(relationship);
    const outerPkKey = this.getOuterPrimaryKey(relationship, outerModel);
    const relatedPkKey = this.getRelatedPrimaryKey(relationship);

    if (relationship.relation === 'one-to-many' || relationship.relation === 'one-to-one-inverse') {
      const fk = this.quoteId(fkKey);
      const pk = this.quoteId(outerPkKey);

      return `${subqueryAlias}.${fk} = ${outerAlias}.${pk}`;
    }

    if (relationship.relation === 'many-to-many') {
      return this.buildManyToManyCorrelation(relationship, outerAlias, subqueryAlias, outerPkKey);
    }

    const outerFk = this.quoteId(relationship.columnName as string);
    const relatedPk = this.quoteId(relatedPkKey);

    return `${outerAlias}.${outerFk} = ${subqueryAlias}.${relatedPk}`;
  }

  private buildManyToManyCorrelation(
    relationship: Relationship<any>,
    outerAlias: string,
    subqueryAlias: string,
    outerPkKey: string,
  ): string {
    const pivotTable = relationship.pivotTable!;
    const joinColumn = this.quoteId(relationship.joinColumn!);
    const inverseJoinColumn = this.quoteId(relationship.inverseJoinColumn!);
    const outerPk = this.quoteId(outerPkKey);
    const relatedPkKey = this.getRelatedPrimaryKey(relationship);
    const relatedPk = this.quoteId(relatedPkKey);

    const schema = this.getRelatedSchema(relationship);
    const qualifiedPivot = this.qualifyTable(schema, pivotTable);

    return `${subqueryAlias}.${relatedPk} IN (SELECT ${inverseJoinColumn} FROM ${qualifiedPivot} WHERE ${joinColumn} = ${outerAlias}.${outerPk})`;
  }

  private getRelatedSchema(relationship: Relationship<any>): string {
    const entity = this.entityStorage.get(relationship.entity() as Function);
    return entity?.schema || 'public';
  }

  private getOuterPrimaryKey(relationship: Relationship<any>, outerModel?: Function): string {
    if (!outerModel) {
      return 'id';
    }

    const entity = this.entityStorage.get(outerModel);
    if (!entity) {
      return 'id';
    }

    for (const prop in entity.properties) {
      if (entity.properties[prop].options.isPrimary) {
        return prop;
      }
    }

    return 'id';
  }

  private buildFilterConditions(
    filters: FilterQuery<any>,
    alias: string,
    relationship: Relationship<any>,
  ): string {
    if (!filters || Object.keys(filters).length === 0) {
      return '';
    }

    const conditionBuilder = this.getConditionBuilder();
    const entity = relationship.entity() as Function;
    return conditionBuilder.build(filters, alias, entity);
  }

  private combineConditions(correlation: string, filterSql: string): string {
    if (!filterSql) {
      return correlation;
    }

    return `${correlation} AND ${filterSql}`;
  }

  private resolveTableName(relationship: Relationship<any>): string {
    const entity = this.entityStorage.get(relationship.entity() as Function);

    if (!entity) {
      const name = (relationship.entity() as Function).name.toLowerCase();

      return this.qualifyTable('public', name);
    }

    const schema = entity.schema || 'public';
    const tableName = entity.tableName || (relationship.entity() as Function).name.toLowerCase();

    return this.qualifyTable(schema, tableName);
  }

  private generateAlias(): string {
    const alias = `sq${this.aliasCounter}`;
    this.aliasCounter++;
    return alias;
  }

  private getFkKey(relationship: Relationship<any>): string {
    if (typeof relationship.fkKey === 'undefined') {
      return 'id';
    }

    if (typeof relationship.fkKey === 'string') {
      return relationship.fkKey;
    }

    const match = /\.(?<propriedade>[\w]+)/.exec(relationship.fkKey.toString());
    const propertyKey = match ? match.groups!.propriedade : '';
    const entity = this.entityStorage.get(relationship.entity() as Function);

    if (!entity) {
      throw new Error(
        `Entity not found in storage for relationship. ` +
        `Make sure the entity ${(relationship.entity() as Function).name} is decorated with @Entity()`,
      );
    }

    const property = Object.entries(entity.properties).find(
      ([key, _value]) => key === propertyKey,
    )?.[1];

    if (property) {
      return property.options.columnName;
    }

    const relation = entity.relations.find((rel) => rel.propertyKey === propertyKey);

    if (relation && relation.columnName) {
      return relation.columnName;
    }

    throw new Error(
      `Property or relation "${propertyKey}" not found in entity "${entity.tableName}". ` +
      `Available properties: ${Object.keys(entity.properties).join(', ')}. ` +
      `Available relations: ${entity.relations.map((r) => r.propertyKey as string).join(', ')}`,
    );
  }

  private getRelatedPrimaryKey(relationship: Relationship<any>): string {
    const entity = this.entityStorage.get(relationship.entity() as Function);

    if (!entity) {
      return 'id';
    }

    for (const prop in entity.properties) {
      if (entity.properties[prop].options.isPrimary) {
        return prop;
      }
    }

    return 'id';
  }
}
