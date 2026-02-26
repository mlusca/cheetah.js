import { PROPERTIES_RELATIONS } from '../constants';
import { EntityName, Relationship } from '../driver/driver.interface';
import { Metadata } from '@carno.js/core';
import { toSnakeCase } from '../utils';

export type ManyToManyOptions = {
  pivotTable?: string;
  joinColumn?: string;
  inverseJoinColumn?: string;
};

/**
 * ManyToMany relationship decorator with pivot table.
 *
 * ```typescript
 * @ManyToMany(() => Tag, {
 *   pivotTable: 'post_tags',       // Optional: auto-generated
 *   joinColumn: 'post_id',         // Optional: auto-generated
 *   inverseJoinColumn: 'tag_id',   // Optional: auto-generated
 * })
 * tags: Tag[];
 * ```
 */
export function ManyToMany<T>(
  entity: () => EntityName<T>,
  options?: ManyToManyOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    const existing: Relationship<T>[] = Metadata.get(PROPERTIES_RELATIONS, target.constructor) || [];

    const ownerTableName = toSnakeCase(target.constructor.name);
    const joinColumn = options?.joinColumn || `${ownerTableName}_id`;
    const inverseJoinColumn = options?.inverseJoinColumn;

    const relationOptions: Relationship<T> = {
      relation: 'many-to-many',
      propertyKey,
      isRelation: true,
      entity,
      type: Array,
      originalEntity: target.constructor,
      columnName: '',
      pivotTable: options?.pivotTable,
      joinColumn,
      inverseJoinColumn,
    };

    existing.push(relationOptions);
    Metadata.set(PROPERTIES_RELATIONS, existing, target.constructor);
  };
}
