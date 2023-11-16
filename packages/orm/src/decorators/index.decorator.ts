import { Metadata } from '@cheetah.js/core';

export function Index<T>(options?: { properties: (keyof T)[] }): PropertyDecorator {
  return (target: any, propertyKey: symbol | string) => {
    const indexes: {name: string, properties: string[]}[] = Metadata.get('indexes', target.constructor) || [];
    let index: {name: string, properties: string[]};

    if (options && options.properties) {
      const properties = options.properties as any;
      index = {name: `${properties.join('_')}_index`, properties: options.properties as any};
    } else {
      index = {name: `${propertyKey as string}_index`, properties: [propertyKey as string]} ;
    }

    indexes.push(index);
    Metadata.set('indexes', indexes, target.constructor);
  };
}