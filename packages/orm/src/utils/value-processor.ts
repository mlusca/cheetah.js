import { ValueObject } from '../common/value-object';
import { BaseEntity } from '../domain/base-entity';
import { EntityStorage, Options } from '../domain/entities';
import { buildEntityMetadataIndex, EntityMetadataIndex } from '../domain/entity-metadata-index';
import { Relationship } from '../driver/driver.interface';
import { ValueOrInstance } from '../driver/driver.interface';
import { extendsFrom } from '../utils';
import type { UpdateData } from '../query/update-expression';

function getMetadataIndex(options: Options): EntityMetadataIndex {
  // Should always be present after registration via EntityStorage.add(),
  // but rebuild lazily if a caller constructs Options manually (defensive).
  if (!options._metadataIndex) {
    options._metadataIndex = buildEntityMetadataIndex(options.properties, options.relations);
  }
  return options._metadataIndex;
}

export class ValueProcessor {
  static processForInsert<T>(
    values: Partial<{ [K in keyof T]: ValueOrInstance<T[K]> }>,
    options: Options,
  ): Record<string, any> {
    return ValueProcessor.processValues(values, options);
  }

  static processForUpdate<T>(
    values: UpdateData<T>,
    options: Options,
  ): Record<string, any> {
    return ValueProcessor.processValues(values, options);
  }

  private static processValues<T>(
    values: Partial<{ [K in keyof T]: ValueOrInstance<T[K]> }> | UpdateData<T>,
    options: Options,
  ): Record<string, any> {
    const index = getMetadataIndex(options);
    const { columnByProperty, owningRelationByProperty } = index;
    const newValue: Record<string, any> = {};

    for (const value in values) {
      let columnName: string;
      if (value.charCodeAt(0) === 36 /* '$' */) {
        columnName = value;
      } else {
        const mapped = columnByProperty.get(value);
        if (mapped === undefined) {
          throw new Error('Property not found');
        }
        columnName = mapped;
      }
      const rawValue = (values as any)[value];

      if (ValueProcessor.isValueObject(rawValue)) {
        newValue[columnName] = (rawValue as ValueObject<any, any>).getValue();
        continue;
      }

      const relation = owningRelationByProperty.get(value);
      if (relation && ValueProcessor.isEntityInstance(rawValue)) {
        newValue[columnName] = ValueProcessor.extractPrimaryKeyValue(rawValue);
        continue;
      }

      newValue[columnName] = rawValue;
    }

    return newValue;
  }

  static getColumnName(propertyKey: string, entity: Options): string {
    if (propertyKey.charCodeAt(0) === 36 /* '$' */) {
      return propertyKey;
    }

    const index = getMetadataIndex(entity);
    const mapped = index.columnByProperty.get(propertyKey);
    if (mapped !== undefined) {
      return mapped;
    }
    throw new Error('Property not found');
  }

  static createInstance(
    values: any,
    entity: Function,
    moment: 'insert' | 'update' | undefined = undefined,
  ): any {
    const entityStorage = EntityStorage.getInstance();
    const entityOptions = entityStorage.get(entity);
    const instance = new (entity as any)();

    if (!entityOptions) {
      throw new Error('Entity not found');
    }

    const index = getMetadataIndex(entityOptions);
    const allProps = index.allProperties;

    if (moment === 'insert') {
      for (let i = 0; i < index.onInsertProperties.length; i += 1) {
        const p = index.onInsertProperties[i];
        instance[p.key] = p.options.onInsert!();
      }
    } else if (moment === 'update') {
      for (let i = 0; i < index.onUpdateProperties.length; i += 1) {
        const p = index.onUpdateProperties[i];
        instance[p.key] = p.options.onUpdate!();
      }
    }

    for (let i = 0; i < allProps.length; i += 1) {
      const p = allProps[i];
      if (p.columnName in values) {
        instance[p.key] = values[p.columnName];
      }
    }

    const m2o = index.manyToOneRelations;
    for (let i = 0; i < m2o.length; i += 1) {
      const rel = m2o[i];
      instance[rel.propertyKey as any] = values[rel.columnName as string];
    }

    return instance;
  }

  private static isValueObject(value: any): boolean {
    return extendsFrom(ValueObject, value?.constructor?.prototype);
  }

  private static isEntityInstance(value: any): boolean {
    if (!value || typeof value !== 'object') {
      return false;
    }

    if (value instanceof BaseEntity) {
      return true;
    }

    const entityStorage = EntityStorage.getInstance();
    return !!entityStorage.get(value.constructor);
  }

  /**
   * Extracts the primary key value from an entity using cached metadata.
   * Supports custom primary keys that are not named 'id'.
   */
  private static extractPrimaryKeyValue(entity: object): any {
    const entityStorage = EntityStorage.getInstance();
    const options = entityStorage.get((entity as any).constructor);
    const pkName = options?._primaryKeyPropertyName || 'id';
    return (entity as any)[pkName];
  }
}
