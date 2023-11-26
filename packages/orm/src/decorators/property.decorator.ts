import { PROPERTIES, PROPERTIES_METADATA } from '../constants';
import { getDefaultLength, toSnakeCase } from '../utils';
import { Metadata } from '@cheetah.js/core';
import { Index } from './index.decorator';

export type PropertyOptions = {
  isPrimary?: boolean;
  nullable?: boolean;
  default?: any;
  length?: number;
  hidden?: boolean;
  unique?: boolean;
  index?: boolean;
  dbType?: 'varchar' | 'text' | 'int' | 'bigint' | 'float' | 'double' | 'decimal' | 'date' | 'datetime' | 'time' | 'timestamp' | 'boolean' | 'json' | 'jsonb' | 'enum' | 'array' | 'uuid';
  autoIncrement?: boolean;
  columnName?: string;
  isEnum?: boolean;
  enumItems?: string[]|number[];
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
    options['columnName'] = options?.columnName || toSnakeCase(propertyKey as string);
    properties.push({propertyKey, options});
    Metadata.set(PROPERTIES, properties, target.constructor);

    if (options.isPrimary) {
      const indexes: {name: string, properties: string[]}[] = Metadata.get('indexes', target.constructor) || [];
      indexes.push({name: `[TABLE]_pkey`, properties: [propertyKey as string]});
      Metadata.set('indexes', indexes, target.constructor);
    }

    if (options.index) {
      Index({properties: [propertyKey as string]})(target, propertyKey);
    }

    properties.forEach((property: Prop) => {
      const types = Metadata.get(PROPERTIES_METADATA, target.constructor) || {};
      const type = Metadata.getType(target, property.propertyKey);
      types[property.propertyKey] = {type, options: property.options};
      Metadata.set(PROPERTIES_METADATA, types, target.constructor);
    });
  };
}
