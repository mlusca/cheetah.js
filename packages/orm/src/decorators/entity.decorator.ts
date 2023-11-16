import { ENTITIES } from '../constants';
import { Metadata } from '@cheetah.js/core';

export function Entity(options?: {tableName?: string}): ClassDecorator {
  return (target) => {
    const entities = Metadata.get(ENTITIES, Reflect) || [];
    entities.push({target, options});
    Metadata.set(ENTITIES, entities, Reflect)
  };
}