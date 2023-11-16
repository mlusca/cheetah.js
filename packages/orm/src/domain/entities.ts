import { Metadata, Service } from '@cheetah.js/core';
import { PropertyOptions } from '../decorators/property.decorator';
import { ColumnsInfo, Relationship, SnapshotIndexInfo, SnapshotTable } from '../driver/driver.interface';
import { getDefaultLength } from '../utils';

export type Property = {
  options: PropertyOptions;
  type: Function;
}

export type Options = {
  showProperties: { [key: string]: Property };
  hideProperties: string[];
  indexes?: SnapshotIndexInfo[];
  relations: Relationship<any>[];
  tableName: string;
  schema?: string;
}

@Service()
export class EntityStorage {
  static instance: EntityStorage;

  private entities: Map<Function, Options> = new Map();

  constructor() {
    EntityStorage.instance = this;
  }

  add(entity: { target: Function, options: any }, properties: {[key: string]: Property}, relations: Relationship<any>[]) {
    const entityName = entity.options?.tableName || entity.target.name.toLowerCase();
    const indexes = Metadata.get('indexes', entity.target) || [];
    this.entities.set(entity.target, {
      showProperties: properties,
      hideProperties: [],
      relations,
      indexes: indexes.map((index: {name: string, properties: string[]}) => {
        return {
          table: entityName,
          indexName: index.name.replace('[TABLE]', entityName),
          columnName: index.properties.join(','),
        }
      }),
      tableName: entityName,
      ...entity.options
    })
  }

  get(entity: Function) {
    return this.entities.get(entity);
  }

  entries() {
    return this.entities.entries();
  }

  static getInstance() {
    return EntityStorage.instance;
  }

  async snapshot(values: Options): Promise<SnapshotTable> {
    return {
      tableName: values.tableName,
      schema: values.schema || 'public',
      indexes: values.indexes || [],
      columns: this.snapshotColumns(values),
    }
  }

  private snapshotColumns(values: Options): ColumnsInfo[] {

    let properties: ColumnsInfo[] = Object.entries(values.showProperties).map(([key, value]) => {
      return {
        name: key,
        type: value.type.name,
        nullable: value.options?.nullable,
        default: value.options?.default,
        primary: value.options?.isPrimary,
        unique: value.options?.unique,
        length: value.options?.length,
      }
    })
    // @ts-ignore
    let relations: ColumnsInfo[] = values.relations && values.relations.map((relation) => {
      const type = this.getFkType(relation)

      return {
        name: relation.propertyKey as string,
        type,
        nullable: relation.nullable,
        unique: relation.unique,
        length: relation.length || getDefaultLength(type),
        default: relation.default,
        primary: relation.isPrimary,
        foreignKeys: [
          {
            referencedColumnName: this.getFkKey(relation),
            referencedTableName: this.get(relation.entity() as any)!.tableName,
          }
        ]
      }
    })

    if (!relations) {
      relations = []
    }
    if (!properties) {
      properties = []
    }

    return [...properties, ...relations]
  }

  private snapshotIndexes(values: Options): SnapshotIndexInfo[] {
    return Object.entries(values.showProperties).map(([key, value]) => {
      return {
        indexName: key,
        columnName: key,
        table: values.tableName,
      }
    })
  }

  private getFkType(relation: Relationship<any>): any {
    const entity = this.get(relation.entity() as any)
    if (!entity) {
      return 'unknown'
    }

    return entity.showProperties[this.getFkKey(relation)].type.name
  }

  /**
   * If fkKey is null, return the primary key of the entity
   * @private
   * @param relationShip
   */
  private getFkKey(relationShip: Relationship<any>): string | number {
    // se for nullable, deverá retornar o primary key da entidade target
    if (typeof relationShip.fkKey === 'undefined') {
      const entity = this.entities.get(relationShip.entity() as any);
      const property = Object.entries(entity!.showProperties).find(([key, value]) => value.options.isPrimary === true);
      if (!property) {
        throw new Error(`Entity ${entity!.tableName} does not have a primary key`);
      }

      return property[0];
    }

    // se o fkKey é uma função, ele retornará a propriedade da entidade que é a chave estrangeira
    // precisamos pegar o nome dessa propriedade
    if (typeof relationShip.fkKey === 'string') {
      return relationShip.fkKey;
    }

    const match = /\.(?<propriedade>[\w]+)/.exec(relationShip.fkKey.toString());
    return match ? match.groups!.propriedade : '';
  }
}