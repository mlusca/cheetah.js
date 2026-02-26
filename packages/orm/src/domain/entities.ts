import { Metadata, Service } from "@carno.js/core";
import { ormSessionContext } from "../orm-session-context";
import { PropertyOptions } from "../decorators/property.decorator";
import {
  ColumnsInfo,
  Relationship,
  SnapshotIndexInfo,
  SnapshotTable,
  SnapshotUniqueInfo,
} from "../driver/driver.interface";
import { IndexDefinition, IndexWhere } from "../decorators/index.decorator";
import { UniqueDefinition } from "../decorators/unique.decorator";
import { getDefaultLength, toSnakeCase } from "../utils";
import { IndexConditionBuilder } from "../query/index-condition-builder";

export type Property = {
  options: PropertyOptions;
  type: Function;
};

export type Options = {
  properties: { [key: string]: Property };
  hideProperties: string[];
  indexes?: SnapshotIndexInfo[];
  uniques?: SnapshotUniqueInfo[];
  relations: Relationship<any>[];
  tableName: string;
  hooks?: { type: string; propertyName: string }[];
  schema?: string;

  // Cache de metadata da primary key (computado uma vez no registro)
  _primaryKeyPropertyName?: string;  // Nome da propriedade TypeScript (ex: "uuid", "productId")
  _primaryKeyColumnName?: string;    // Nome da coluna no DB (ex: "user_uuid", "product_id")
};

type IndexColumnMap = Record<string, string>;

function buildIndexColumnMap(
  properties: { [key: string]: Property },
  relations: Relationship<any>[],
): IndexColumnMap {
  const map = mapPropertyColumns(properties);

  addRelationColumns(map, relations);

  return map;
}

function mapPropertyColumns(
  properties: { [key: string]: Property },
): IndexColumnMap {
  const map: IndexColumnMap = {};

  Object.entries(properties).forEach(([key, value]) => {
    map[key] = value.options.columnName;
  });

  return map;
}

function addRelationColumns(
  map: IndexColumnMap,
  relations: Relationship<any>[],
): void {
  relations.forEach((relation) => {
    map[String(relation.propertyKey)] = relation.columnName as string;
  });
}

function mapIndexDefinitions(
  indexes: IndexDefinition[],
  entityName: string,
  columnMap: IndexColumnMap,
): SnapshotIndexInfo[] {
  return indexes.map((index) => toSnapshotIndex(index, entityName, columnMap));
}

function toSnapshotIndex(
  index: IndexDefinition,
  entityName: string,
  columnMap: IndexColumnMap,
): SnapshotIndexInfo {
  const columns = resolveIndexColumns(index, columnMap);
  const indexName = resolveIndexName(index.name, entityName, columns);

  return {
    table: entityName,
    indexName,
    columnName: columns.join(","),
    where: resolveIndexWhere(index.where, columnMap),
  };
}

function resolveIndexColumns(
  index: IndexDefinition,
  columnMap: IndexColumnMap,
): string[] {
  return index.properties.map((propName) => resolveIndexColumn(propName, columnMap));
}

function resolveIndexColumn(
  propName: string,
  columnMap: IndexColumnMap,
): string {
  const mapped = columnMap[propName];

  if (mapped) {
    return mapped;
  }

  return toSnakeCase(propName);
}

function resolveIndexName(
  name: string,
  entityName: string,
  columns: string[],
): string {
  if (name.includes('_pkey') || name.includes('[TABLE]')) {
    return name.replace("[TABLE]", entityName);
  }

  return `${columns.join("_")}_index`;
}

function resolveIndexWhere(
  where: IndexWhere<any> | undefined,
  columnMap: IndexColumnMap,
): string | undefined {
  if (!where) {
    return undefined;
  }

  if (typeof where === "string") {
    return where;
  }

  if (typeof where === "function") {
    return where(columnMap as any);
  }

  return buildIndexWhere(where, columnMap);
}

function buildIndexWhere(
  where: IndexWhere<any>,
  columnMap: IndexColumnMap,
): string | undefined {
  const builder = new IndexConditionBuilder<any>(columnMap);

  return builder.build(where as any);
}

function mapUniqueDefinitions(
  uniques: UniqueDefinition[],
  entityName: string,
  columnMap: IndexColumnMap,
): SnapshotUniqueInfo[] {
  return uniques.map((unique) => toSnapshotUnique(unique, entityName, columnMap));
}

function toSnapshotUnique(
  unique: UniqueDefinition,
  entityName: string,
  columnMap: IndexColumnMap,
): SnapshotUniqueInfo {
  const columns = resolveUniqueColumns(unique, columnMap);
  const uniqueName = resolveUniqueName(unique.name, entityName, columns);

  return {
    table: entityName,
    uniqueName,
    columnName: columns.join(","),
  };
}

function resolveUniqueColumns(
  unique: UniqueDefinition,
  columnMap: IndexColumnMap,
): string[] {
  return unique.properties.map((propName) => resolveUniqueColumn(propName, columnMap));
}

function resolveUniqueColumn(
  propName: string,
  columnMap: IndexColumnMap,
): string {
  const mapped = columnMap[propName];

  if (mapped) {
    return mapped;
  }

  return toSnakeCase(propName);
}

function resolveUniqueName(
  name: string,
  entityName: string,
  columns: string[],
): string {
  return `${columns.join("_")}_unique`;
}

@Service()
export class EntityStorage {
  static instance: EntityStorage;

  private entities: Map<Function, Options> = new Map();

  constructor() {
    EntityStorage.instance = this;
  }

  add(
    entity: { target: Function; options: any },
    properties: {
      [key: string]: Property;
    },
    relations: Relationship<any>[],
    hooks: { type: string; propertyName: string }[]
  ) {
    const entityName = entity.options?.tableName || toSnakeCase(entity.target.name);

    const indexes: IndexDefinition[] = Metadata.get("indexes", entity.target) || [];
    const uniques: UniqueDefinition[] = Metadata.get("uniques", entity.target) || [];
    const columnMap = buildIndexColumnMap(properties, relations);

    // Compute primary key cache once during registration
    const pkInfo = this.computePrimaryKeyInfo(properties);

    this.entities.set(entity.target, {
      properties: properties,
      hideProperties: Object.entries(properties)
        .filter(([_key, value]) => value.options.hidden)
        .map(([key]) => key),
      relations,
      indexes: mapIndexDefinitions(indexes, entityName, columnMap),
      uniques: mapUniqueDefinitions(uniques, entityName, columnMap),
      hooks,
      tableName: entityName,
      ...entity.options,
      _primaryKeyPropertyName: pkInfo.propertyName,
      _primaryKeyColumnName: pkInfo.columnName,
    });
  }

  get(entity: Function) {
    return this.entities.get(entity);
  }

  entries() {
    return this.entities.entries();
  }

  /**
   * Computa metadados da primary key a partir das propriedades da entidade.
   * Chamado uma vez durante o registro da entidade para lookups O(1).
   * @private
   */
  private computePrimaryKeyInfo(properties: { [key: string]: Property }): {
    propertyName: string;
    columnName: string;
  } {
    for (const prop in properties) {
      if (properties[prop].options.isPrimary) {
        return {
          propertyName: prop,
          columnName: properties[prop].options.columnName,
        };
      }
    }

    // Fallback para 'id' (backward compatibility)
    return {
      propertyName: 'id',
      columnName: 'id',
    };
  }

  static getInstance() {
    const scoped = ormSessionContext.getStorage();
    if (scoped) {
      return scoped;
    }

    return EntityStorage.instance;
  }

  async snapshot(values: Options): Promise<SnapshotTable> {
    return {
      tableName: values.tableName,
      schema: values.schema || "public",
      indexes: values.indexes || [],
      uniques: values.uniques || [],
      columns: this.snapshotColumns(values),
    };
  }

  /**
   * Generates snapshot tables for all ManyToMany pivot tables in the given entity.
   */
  snapshotPivotTables(values: Options): SnapshotTable[] {
    if (!values.relations) {
      return [];
    }

    return values.relations
      .filter((rel) => rel.relation === 'many-to-many')
      .map((rel) => this.buildPivotSnapshot(values, rel));
  }

  private buildPivotSnapshot(values: Options, relation: Relationship<any>): SnapshotTable {
    const relatedEntity = this.get(relation.entity() as any);
    const pivotTable = relation.pivotTable!;
    const schema = values.schema || "public";
    const joinColumn = relation.joinColumn!;
    const inverseJoinColumn = relation.inverseJoinColumn!;

    const ownerPkType = this.getFkType({ ...relation, relation: 'many-to-one' } as any);
    const inversePkType = relatedEntity
      ? this.getRelatedPkType(relatedEntity)
      : 'int';

    return {
      tableName: pivotTable,
      schema,
      columns: [
        {
          name: joinColumn,
          type: ownerPkType,
          nullable: false,
          length: getDefaultLength(ownerPkType),
          foreignKeys: [{
            referencedTableName: values.tableName,
            referencedColumnName: this.getOwnerPkColumnName(values),
          }],
        },
        {
          name: inverseJoinColumn,
          type: inversePkType,
          nullable: false,
          length: getDefaultLength(inversePkType),
          foreignKeys: [{
            referencedTableName: relatedEntity!.tableName,
            referencedColumnName: relatedEntity!._primaryKeyColumnName || 'id',
          }],
        },
      ],
      indexes: [
        {
          table: pivotTable,
          indexName: `${joinColumn}_index`,
          columnName: joinColumn,
        },
        {
          table: pivotTable,
          indexName: `${inverseJoinColumn}_index`,
          columnName: inverseJoinColumn,
        },
      ],
    };
  }

  private getOwnerPkColumnName(entity: Options): string {
    return entity._primaryKeyColumnName || 'id';
  }

  private getRelatedPkType(entity: Options): string {
    const pkProp = entity._primaryKeyPropertyName || 'id';
    const property = entity.properties[pkProp];
    if (!property) return 'int';
    return property.options?.dbType || property.type?.name || 'int';
  }

  private snapshotColumns(values: Options): ColumnsInfo[] {
    let properties: ColumnsInfo[] = Object.entries(values.properties).map(([_key, value]) => {
      return {
        name: value.options.columnName,
        type: value.options.dbType ?? value.type.name,
        nullable: value.options?.nullable,
        default: value.options?.default,
        autoIncrement: value.options?.autoIncrement,
        primary: value.options?.isPrimary,
        unique: value.options?.unique,
        length: value.options?.length,
        isEnum: value.options?.isEnum,
        precision: value.options?.precision,
        scale: value.options?.scale,
        enumItems: value.options?.enumItems,
      };
    });
    // @ts-ignore
    let relations: ColumnsInfo[] =
      values.relations &&
      values.relations
        .filter((relation) => relation.relation === 'many-to-one' || relation.relation === 'one-to-one-owner')
        .map((relation) => {
          const type = this.getFkType(relation);

          return {
            name: relation.columnName as string,
            type,
            nullable: relation.nullable,
            unique: relation.unique,
            length: relation.length || getDefaultLength(type),
            default: relation.default,
            autoIncrement: relation.autoIncrement,
            primary: relation.isPrimary,
            precision: relation.precision,
            scale: relation.scale,
            foreignKeys: [
              {
                referencedColumnName: this.getFkKey(relation),
                referencedTableName: this.get(relation.entity() as any)!.tableName,
              },
            ],
          };
        });

    if (!relations) {
      relations = [];
    }
    if (!properties) {
      properties = [];
    }

    return [...properties, ...relations];
  }

  private snapshotIndexes(values: Options): SnapshotIndexInfo[] {
    return Object.entries(values.properties).map(([key, _value]) => {
      return {
        indexName: key,
        columnName: key,
        table: values.tableName,
      };
    });
  }

  private getFkType(relation: Relationship<any>): any {
    const entity = this.get(relation.entity() as any);
    if (!entity) {
      return "unknown";
    }

    const foreignKey = this.getFkKey(relation);
    const property = entity.properties[foreignKey];

    if (!property) {
      return "unknown";
    }

    if (property.options?.dbType) {
      return property.options.dbType;
    }

    return property.type?.name ?? "unknown";
  }

  private getFkIncrement(relation: Relationship<any>): any {
    const entity = this.get(relation.entity() as any);
    if (!entity) {
      return "unknown";
    }

    return entity.properties[this.getFkKey(relation)].options.autoIncrement;
  }

  /**
   * If fkKey is null, return the primary key of the entity
   * @private
   * @param relationShip
   */
  private getFkKey(relationShip: Relationship<any>): string | number {
    // if nullable, it should return the primary key of the target entity
    if (typeof relationShip.fkKey === "undefined") {
      const entity = this.entities.get(relationShip.entity() as any);
      const property = Object.entries(entity!.properties).find(([_key, value]) => value.options.isPrimary === true);
      if (!property) {
        throw new Error(`Entity ${entity!.tableName} does not have a primary key`);
      }

      return property[0];
    }

    // if fkKey is a function, it will return the property that is the foreign key
    // precisamos pegar o nome dessa propriedade
    if (typeof relationShip.fkKey === "string") {
      return relationShip.fkKey;
    }

    const match = /\.(?<propriedade>[\w]+)/.exec(relationShip.fkKey.toString());
    return match ? match.groups!.propriedade : "";
  }
}
