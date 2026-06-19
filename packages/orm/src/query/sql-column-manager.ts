import { DriverInterface, JoinStatement, Statement } from '../driver/driver.interface';
import { EntityStorage, Options } from '../domain/entities';
import { assertSafeIdentifier } from '../utils/sql-escape';

export class SqlColumnManager {
  constructor(
    private entityStorage: EntityStorage,
    private statements: Statement<any>,
    private entity: Options,
    private driver: DriverInterface,
  ) {}

  private quoteId(identifier: string): string {
    const q = this.driver.getIdentifierQuote();
    // Escape any embedded quote char so an identifier can't break out of the
    // quoting. Fast path: skip the split/join allocation when none is present.
    const safe = identifier.includes(q) ? identifier.split(q).join(q + q) : identifier;

    return `${q}${safe}${q}`;
  }

  generateColumns(model: Function, updatedColumns: string[]): string[] {
    const baseColumns = this.getColumnsForEntity(model, this.statements.alias!);
    const joinColumns = this.getJoinColumns();
    const allColumns = [...baseColumns, ...joinColumns];

    return [...allColumns, ...updatedColumns];
  }

  processUserColumns(columns: string[]): string[] {
    const aliasedColumns = this.extractAliases(columns);
    return this.filterValid(aliasedColumns);
  }

  getColumnsForEntity(entity: Function, alias: string): string[] {
    const entityOptions = this.entityStorage.get(entity);

    if (!entityOptions) {
      throw new Error('Entity not found');
    }

    const propertyColumns = this.getPropertyColumns(entityOptions, alias);
    const relationColumns = this.getRelationColumns(entityOptions, alias);

    return [...propertyColumns, ...relationColumns];
  }

  discoverAlias(column: string, onlyAlias = false): string | undefined {
    if (!this.isNestedColumn(column)) {
      return this.buildSimpleColumnAlias(column, this.statements.alias!, onlyAlias);
    }

    return this.buildNestedColumnAlias(column, onlyAlias);
  }

  private getJoinColumns(): string[] {
    if (!this.statements.join) {
      return [];
    }

    return this.statements.join
      .filter(join => join.joinEntity)
      .flatMap(join =>
        this.getColumnsForEntity(join.joinEntity!, join.joinAlias),
      );
  }

  private getPropertyColumns(entityOptions: Options, alias: string): string[] {
    return Object.keys(entityOptions.properties).map(key => {
      const columnName = entityOptions.properties[key].options.columnName;
      const col = this.quoteId(columnName);
      const aliasedCol = this.quoteId(`${alias}_${columnName}`);

      return `${alias}.${col} as ${aliasedCol}`;
    });
  }

  private getRelationColumns(entityOptions: Options, alias: string): string[] {
    if (!entityOptions.relations) {
      return [];
    }

    return entityOptions.relations
      .filter(relation => relation.relation === 'many-to-one' || relation.relation === 'one-to-one-owner')
      .map(relation => {
        const col = this.quoteId(relation.columnName);
        const aliasedCol = this.quoteId(`${alias}_${relation.columnName}`);

        return `${alias}.${col} as ${aliasedCol}`;
      });
  }

  private extractAliases(columns: string[]): string[] {
    return columns
      .map(column => this.discoverAlias(column))
      .flat()
      .filter((col): col is string => col !== undefined);
  }

  private filterValid(columns: string[]): string[] {
    return columns.filter(Boolean);
  }

  private isNestedColumn(column: string): boolean {
    return column.includes('.');
  }

  private buildSimpleColumnAlias(column: string, alias: string, onlyAlias: boolean): string {
    const columnName = this.getColumnNameFromProperty(column);
    const col = this.quoteId(columnName);

    if (onlyAlias) {
      return `${alias}.${col}`;
    }

    return `${alias}.${col} as ${alias}_${columnName}`;
  }

  private buildNestedColumnAlias(column: string, onlyAlias: boolean): string | undefined {
    this.validateJoinsExist();

    const parts = column.split('.');
    const aliasInfo = this.resolveNestedAlias(parts);

    if (!aliasInfo) {
      return undefined;
    }

    return this.formatColumnWithAlias(
      aliasInfo.alias,
      parts[parts.length - 1],
      onlyAlias,
    );
  }

  private validateJoinsExist(): void {
    if (!this.statements.join && !this.statements.selectJoin) {
      throw new Error('Join not found');
    }
  }

  private resolveNestedAlias(parts: string[]): { alias: string } | null {
    const joinMaps = this.buildJoinMaps();
    let currentAlias = this.statements.alias!;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLastPart = i === parts.length - 1;

      if (isLastPart) {
        return { alias: currentAlias };
      }

      const nextAlias = this.findNextAlias(part, joinMaps, i === 0);

      if (!nextAlias) {
        return null;
      }

      currentAlias = nextAlias;
    }

    return { alias: currentAlias };
  }

  private buildJoinMaps(): {
    joinMap: Map<string, JoinStatement<any>>;
    selectJoinMap: Map<string, Statement<any>>;
    relationsMap: Map<string | symbol, any>;
  } {
    const relationsMap = new Map(
      this.entity.relations.map(rel => [rel.propertyKey, rel]),
    );

    const joinMap = new Map<string, JoinStatement<any>>();
    this.statements.join?.forEach(join => joinMap.set(join.joinProperty, join));

    const selectJoinMap = new Map<string, Statement<any>>();
    this.statements.selectJoin?.forEach(join =>
      selectJoinMap.set(join.joinProperty, join),
    );

    return { joinMap, selectJoinMap, relationsMap };
  }

  private findNextAlias(
    part: string,
    maps: ReturnType<typeof this.buildJoinMaps>,
    isFirstPart: boolean,
  ): string | null {
    if (maps.joinMap.has(part)) {
      return maps.joinMap.get(part)!.joinAlias;
    }

    if (maps.selectJoinMap.has(part)) {
      return null;
    }

    return null;
  }

  private formatColumnWithAlias(
    alias: string,
    propertyName: string,
    onlyAlias: boolean,
  ): string {
    const entity = this.getEntityFromAlias(alias);
    const columnName = this.getColumnNameFromPropertyForEntity(propertyName, entity);
    const col = this.quoteId(columnName);

    if (onlyAlias) {
      return `${alias}.${col}`;
    }

    return `${alias}.${col} as ${alias}_${columnName}`;
  }

  private getColumnNameFromProperty(propertyName: string): string {
    return this.getColumnNameFromPropertyForEntity(propertyName, this.entity);
  }

  private getColumnNameFromPropertyForEntity(propertyName: string, entity: Options): string {
    if (entity.properties[propertyName]) {
      return entity.properties[propertyName].options.columnName;
    }

    const relation = entity.relations?.find(rel => rel.propertyKey === propertyName);
    if (relation) {
      return relation.columnName;
    }

    return assertSafeIdentifier(propertyName);
  }

  private getEntityFromAlias(alias: string): Options {
    if (alias === this.statements.alias) {
      return this.entity;
    }

    const join = this.statements.join?.find(j => j.joinAlias === alias);
    if (join?.joinEntity) {
      const entity = this.entityStorage.get(join.joinEntity);
      if (entity) {
        return entity;
      }
    }

    return this.entity;
  }
}
