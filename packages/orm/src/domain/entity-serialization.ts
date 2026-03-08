import { Metadata } from '@carno.js/core';
import { COMPUTED_PROPERTIES, PROPERTIES_METADATA } from '../constants';
import { EntityStorage, Property } from './entities';

export function serializeEntityInstance(instance: Record<string, any>): Record<string, any> {
  const storage = EntityStorage.getInstance();
  const entity = storage?.get(instance.constructor);

  const data = entity
    ? serializeWithEntity(instance, entity)
    : serializeWithMetadata(instance);

  addComputedProperties(instance, data);

  return data;
}

function serializeWithEntity(instance: Record<string, any>, entity: any): Record<string, any> {
  const data: Record<string, any> = {};
  const allProperties = new Set<string>(Object.keys(entity.properties));
  const allRelations = new Set<string>((entity.relations || []).map((relation: any) => relation.propertyKey));
  const hideProperties = new Set<string>(entity.hideProperties);

  for (const key in instance) {
    if (shouldSkipProperty(key, allProperties, allRelations, hideProperties)) {
      continue;
    }

    data[key] = instance[key];
  }

  return data;
}

function serializeWithMetadata(instance: Record<string, any>): Record<string, any> {
  const data: Record<string, any> = {};
  const hideProperties = new Set<string>(getHiddenPropertiesFromMetadata(instance.constructor));

  for (const key in instance) {
    if (shouldSkipPropertyBasic(key, hideProperties)) {
      continue;
    }

    data[key] = instance[key];
  }

  return data;
}

function shouldSkipProperty(
  key: string,
  allProperties: Set<string>,
  allRelations: Set<string>,
  hideProperties: Set<string>,
): boolean {
  if (isInternalProperty(key)) {
    return true;
  }

  if (!allProperties.has(key) && !allRelations.has(key)) {
    return true;
  }

  return hideProperties.has(key);
}

function shouldSkipPropertyBasic(key: string, hideProperties: Set<string>): boolean {
  if (isInternalProperty(key)) {
    return true;
  }

  return hideProperties.has(key);
}

function isInternalProperty(key: string): boolean {
  return key.startsWith('$') || key.startsWith('_');
}

function getHiddenPropertiesFromMetadata(target: Function): string[] {
  const properties: { [key: string]: Property } =
    Metadata.get(PROPERTIES_METADATA, target) || {};

  const hideProperties: string[] = [];

  for (const [key, prop] of Object.entries(properties)) {
    if (prop.options?.hidden) {
      hideProperties.push(key);
    }
  }

  return hideProperties;
}

function addComputedProperties(instance: Record<string, any>, data: Record<string, any>): void {
  const computedProperties: string[] =
    Metadata.get(COMPUTED_PROPERTIES, instance.constructor) || [];

  for (const key of computedProperties) {
    data[key] = instance[key];
  }
}
