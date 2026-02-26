import { PROPERTIES_RELATIONS } from '../constants';
import { EntityName, Relationship } from '../driver/driver.interface';
import { Metadata } from '@carno.js/core';
import { toSnakeCase } from '../utils';
import { PropertyOptions } from './property.decorator';
import { Index } from './index.decorator';

type OneToOneOptions = Partial<PropertyOptions>;

/**
 * OneToOne relationship decorator.
 *
 * **Owner side** (creates FK column with UNIQUE constraint):
 * ```typescript
 * @OneToOne(() => Profile)
 * profile: Ref<Profile>;
 * ```
 *
 * **Inverse side** (references FK in related entity):
 * ```typescript
 * @OneToOne(() => User, (user) => user.profileId)
 * user: Ref<User>;
 * ```
 */
export function OneToOne<T>(
  entity: () => EntityName<T>,
  fkKeyOrOptions?: (string & keyof T) | ((e: T) => any) | OneToOneOptions,
  maybeOptions?: OneToOneOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    const existing: Relationship<T>[] = Metadata.get(PROPERTIES_RELATIONS, target.constructor) || [];

    const hasFkKey = typeof fkKeyOrOptions === 'string' || typeof fkKeyOrOptions === 'function';
    const fkKey = hasFkKey ? (fkKeyOrOptions as (string & keyof T) | ((e: T) => any)) : undefined;
    const options = (hasFkKey ? maybeOptions : fkKeyOrOptions as OneToOneOptions) || {};

    if (fkKey) {
      // Inverse side: like OneToMany but single entity
      const relationOptions = {
        relation: 'one-to-one-inverse' as const,
        propertyKey,
        isRelation: true,
        entity,
        fkKey,
        type: Metadata.getType(target, propertyKey),
        originalEntity: target.constructor,
        columnName: `${toSnakeCase(propertyKey as string)}_id`,
      };

      existing.push(relationOptions as Relationship<T>);
    } else {
      // Owner side: like ManyToOne but with unique constraint
      const columnName = options.columnName || `${toSnakeCase(propertyKey as string)}_id`;
      const relationOptions = {
        relation: 'one-to-one-owner' as const,
        propertyKey,
        isRelation: true,
        entity,
        type: Metadata.getType(target, propertyKey),
        originalEntity: target.constructor,
        columnName,
        unique: true,
        ...options,
      };

      if (options.index) {
        Index({ properties: [propertyKey as string] })(target, propertyKey);
      }

      existing.push(relationOptions as Relationship<T>);
    }

    Metadata.set(PROPERTIES_RELATIONS, existing, target.constructor);
  };
}
