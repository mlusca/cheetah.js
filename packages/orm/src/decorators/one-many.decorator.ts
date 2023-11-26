import { PROPERTIES_RELATIONS } from '../constants';
import { EntityName, Relationship } from '../driver/driver.interface';
import { Metadata } from '@cheetah.js/core';
import { toSnakeCase } from '../utils';

export function OneToMany<T>(entity: () => EntityName<T>, fkKey: (string & keyof T) | ((e: T) => any)): PropertyDecorator {
  return (target, propertyKey) => {
    const existing: Relationship<T>[] = Metadata.get(PROPERTIES_RELATIONS, target.constructor) || [];
    const options = {relation: 'one-to-many', propertyKey, isRelation: true, entity, fkKey, type: Metadata.getType(target, propertyKey), originalEntity: target.constructor}
    options['columnName'] = `${toSnakeCase(propertyKey as string)}_id`;
    // @ts-ignore
    existing.push(options);
    Metadata.set(PROPERTIES_RELATIONS, existing, target.constructor);
  };
}

export function ManyToOne<T>(entity: () => EntityName<T>): PropertyDecorator {
  return (target, propertyKey) => {
    const existing: Relationship<T>[] = Metadata.get(PROPERTIES_RELATIONS, target.constructor) || [];
    const options = {relation: 'many-to-one', propertyKey, isRelation: true, entity, type: Metadata.getType(target, propertyKey), originalEntity: target.constructor}
    options['columnName'] = `${toSnakeCase(propertyKey as string)}_id`;
    // @ts-ignore
    existing.push(options);
    Metadata.set(PROPERTIES_RELATIONS, existing, target.constructor);
  };
}