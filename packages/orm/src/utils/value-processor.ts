import { ValueObject } from '../common/value-object';
import { BaseEntity } from '../domain/base-entity';
import { EntityStorage, Options } from '../domain/entities';
import { Relationship } from '../driver/driver.interface';
import { ValueOrInstance } from '../driver/driver.interface';
import { extendsFrom } from '../utils';
import { isUpdateExpression, type UpdateData } from '../query/update-expression';

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
    const newValue = {};

    for (const value in values) {
      const columnName = ValueProcessor.getColumnName(value, options);
      const rawValue = values[value];
      const relation = ValueProcessor.getOwningRelation(value, options);

      if (ValueProcessor.isValueObject(rawValue)) {
        newValue[columnName] = (rawValue as ValueObject<any, any>).getValue();
        continue;
      }

      if (relation && ValueProcessor.isEntityInstance(rawValue)) {
        newValue[columnName] = ValueProcessor.extractPrimaryKeyValue(rawValue);
        continue;
      }

      newValue[columnName] = rawValue;
    }

    return newValue;
  }

  static getColumnName(propertyKey: string, entity: Options): string {
    if (propertyKey.startsWith('$')) {
      return propertyKey;
    }

    const property = entity.properties[propertyKey];
    const relation = entity.relations?.find(rel => rel.propertyKey === propertyKey);

    if (!property) {
      if (!relation) {
        throw new Error('Property not found');
      }
      return relation.columnName || propertyKey;
    }

    return property.options.columnName || propertyKey;
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

    const property = Object.entries(entityOptions.properties);
    const relations = entityOptions.relations;

    property.forEach(([key, property]) => {
      if (property.options.onInsert && moment === 'insert') {
        instance[key] = property.options.onInsert!();
      }

      if (property.options.onUpdate && moment === 'update') {
        instance[key] = property.options.onUpdate!();
      }

      const columnName = property.options.columnName;
      if (columnName in values && !isUpdateExpression(values[columnName])) {
        instance[key] = values[columnName];
      }
    });

    if (relations) {
      for (const relation of relations) {
        if (relation.relation === 'many-to-one' && !isUpdateExpression(values[relation.columnName])) {
          instance[relation.propertyKey] = values[relation.columnName];
        }
      }
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

  private static getOwningRelation(propertyKey: string, options: Options): Relationship<any> | undefined {
    return options.relations?.find((relation) =>
      relation.propertyKey === propertyKey &&
      (relation.relation === 'many-to-one' || relation.relation === 'one-to-one-owner')
    );
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
