import { ENTITIES } from '../constants';
import { Metadata } from '@carno.js/core';
import { BaseEntity } from '../domain/base-entity';
import { serializeEntityInstance } from '../domain/entity-serialization';

export function Entity(options?: {tableName?: string}): ClassDecorator {
  return (target) => {
    installPlainEntityToJSON(target as any);

    const entities = Metadata.get(ENTITIES, Reflect) || [];
    entities.push({target, options});
    Metadata.set(ENTITIES, entities, Reflect)
  };
}

function installPlainEntityToJSON(target: { prototype?: Record<string, any> }): void {
  const prototype = target.prototype;

  if (!prototype) {
    return;
  }

  if (BaseEntity.prototype.isPrototypeOf(prototype)) {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(prototype, 'toJSON')) {
    return;
  }

  Object.defineProperty(prototype, 'toJSON', {
    value: function toJSON(): Record<string, any> {
      return serializeEntityInstance(this);
    },
    writable: true,
    configurable: true,
  });
}
