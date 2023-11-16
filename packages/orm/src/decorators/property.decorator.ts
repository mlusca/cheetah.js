import { PROPERTIES, PROPERTIES_METADATA } from '../constants';
import { getDefaultLength } from '../utils';
import { Metadata } from '@cheetah.js/core';

export type PropertyOptions = {
  isPrimary?: boolean;
  nullable?: boolean;
  default?: any;
  length?: number;
  unique?: boolean;
  autoIncrement?: boolean;
  onUpdate?: () => any;
  onInsert?: () => any;
}

export type Prop = { propertyKey: any, options: PropertyOptions | undefined };

export function Property(options?: PropertyOptions): PropertyDecorator {
  return (target, propertyKey) => {
    const properties: Prop[] = Metadata.get(PROPERTIES, target.constructor) || [];
    const type = Metadata.getType(target, propertyKey);
    const length = (options && options.length) || getDefaultLength(type.name);
    options = {length, ...options};
    properties.push({propertyKey, options});
    Metadata.set(PROPERTIES, properties, target.constructor);

    if (options.isPrimary) {
      const indexes: {name: string, properties: string[]}[] = Metadata.get('indexes', target.constructor) || [];
      indexes.push({name: `[TABLE]_pkey`, properties: [propertyKey as string]});
      Metadata.set('indexes', indexes, target.constructor);
    }

    properties.forEach((property: Prop) => {
      const types = Metadata.get(PROPERTIES_METADATA, target.constructor) || {};
      const type = Metadata.getType(target, property.propertyKey);
      types[property.propertyKey] = {type, options: property.options};
      Metadata.set(PROPERTIES_METADATA, types, target.constructor);
    });
  };
}

