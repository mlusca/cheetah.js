import { Statement } from '../driver/driver.interface';
import { EntityStorage, Options } from '../domain/entities';
import { ValueObject } from '../common/value-object';
import { extendsFrom } from '../utils';
import { IdentityMapIntegration } from '../identity-map';

export class ModelTransformer {
  constructor(private entityStorage: EntityStorage) { }

  transform<T>(model: any, statement: Statement<any>, data: any): T {
    const { instanceMap, cachedAliases } = this.createInstances(model, statement, data);
    const optionsMap = this.buildOptionsMap(instanceMap);

    this.startHydration(instanceMap, cachedAliases);
    this.populateProperties(data, instanceMap, optionsMap, cachedAliases);
    this.linkJoinedEntities(statement, instanceMap, optionsMap);
    this.finalizeHydration(instanceMap, cachedAliases);

    return instanceMap[statement.alias!] as T;
  }

  /**
   * Fused trailing pass: resetChangedValues + endHydration + identity-map
   * registration in a single iteration over the instance map.
   */
  private finalizeHydration(instanceMap: Record<string, any>, cachedAliases: Set<string>): void {
    const aliases = Object.keys(instanceMap);
    for (let i = 0; i < aliases.length; i += 1) {
      const alias = aliases[i];
      if (cachedAliases.has(alias)) continue;
      const instance = instanceMap[alias];

      // resetChangedValues: snapshot only user-visible keys (skipping the
      // underscore/dollar-prefixed bookkeeping fields BaseEntity uses for its
      // change-tracking proxy). Keeps semantics identical to the original
      // helper while avoiding a second pass over the instance map.
      if (instance) {
        const currentValues: Record<string, any> = {};
        for (const k in instance) {
          const c = k.charCodeAt(0);
          if (c !== 95 /* _ */ && c !== 36 /* $ */) {
            currentValues[k] = instance[k];
          }
        }
        instance._oldValues = currentValues;
        instance._changedValues = {};
      }

      // endHydration
      if (instance && typeof instance.$_endHydration === 'function') {
        instance.$_endHydration();
      }

      // registerInstancesInIdentityMap
      IdentityMapIntegration.registerEntity(instance);
    }
  }

  private startHydration(instanceMap: Record<string, any>, cachedAliases: Set<string>): void {
    for (const [alias, instance] of Object.entries(instanceMap)) {
      if (cachedAliases.has(alias)) {
        continue;
      }

      instance.$_startHydration?.();
    }
  }

  private endHydration(instanceMap: Record<string, any>, cachedAliases: Set<string>): void {
    for (const [alias, instance] of Object.entries(instanceMap)) {
      if (cachedAliases.has(alias)) {
        continue;
      }

      instance.$_endHydration?.();
    }
  }

  private registerInstancesInIdentityMap(instanceMap: Record<string, any>, cachedAliases: Set<string>): void {
    Object.entries(instanceMap).forEach(([alias, instance]) => {
      // Skip registering entities that were already in cache
      if (cachedAliases.has(alias)) {
        return;
      }
      IdentityMapIntegration.registerEntity(instance);
    });
  }

  private createInstances(model: any, statement: Statement<any>, data: any): { instanceMap: Record<string, any>; cachedAliases: Set<string> } {
    const cachedAliases = new Set<string>();
    const primaryKey = this.extractPrimaryKeyFromData(model, statement.alias!, data);
    const { instance, wasCached } = this.createInstance(model, primaryKey);

    if (wasCached) {
      cachedAliases.add(statement.alias!);
    }

    const instanceMap: Record<string, any> = {
      [statement.alias!]: instance,
    };

    if (statement.join) {
      this.addJoinedInstances(statement, instanceMap, data, cachedAliases);
    }

    return { instanceMap, cachedAliases };
  }

  private createInstance(model: any, primaryKey?: any): { instance: any; wasCached: boolean } {
    if (primaryKey !== undefined && primaryKey !== null) {
      const cached = IdentityMapIntegration.getEntity(model, primaryKey);

      if (cached) {
        return { instance: cached, wasCached: true };
      }
    }

    const instance = new model();
    instance.$_isPersisted = true;

    return { instance, wasCached: false };
  }

  private addJoinedInstances(statement: Statement<any>, instanceMap: Record<string, any>, data: any, cachedAliases: Set<string>): void {
    statement.join!.forEach(join => {
      // Skip pivot table joins (no entity class)
      if (!join.joinEntity) return;

      const primaryKey = this.extractPrimaryKeyFromData(join.joinEntity!, join.joinAlias, data);
      const { instance: joinInstance, wasCached } = this.createInstance(join.joinEntity!, primaryKey);

      if (wasCached) {
        cachedAliases.add(join.joinAlias);
      }

      instanceMap[join.joinAlias] = joinInstance;
    });
  }

  private extractPrimaryKeyFromData(model: any, alias: string, data: any): any {
    const options = this.entityStorage.get(model);

    if (!options) {
      return undefined;
    }

    return this.extractPrimaryKeyValue(options, alias, data);
  }

  private extractPrimaryKeyValue(options: Options, alias: string, data: any): any {
    const pkProperty = this.findPrimaryKeyProperty(options);

    if (!pkProperty) {
      return undefined;
    }

    return this.getPrimaryKeyFromData(pkProperty, alias, data);
  }

  private getPrimaryKeyFromData(pkProperty: any, alias: string, data: any): any {
    const pkColumnName = pkProperty.options.columnName;
    const pkKey = `${alias}_${pkColumnName}`;

    return data[pkKey];
  }

  private findPrimaryKeyProperty(options: Options): any {
    const pkPropertyName = options._primaryKeyPropertyName || 'id';
    return options.properties[pkPropertyName] || null;
  }

  private buildOptionsMap(instanceMap: Record<string, any>): Map<string, Options> {
    const optionsMap = new Map<string, Options>();

    for (const [alias, instance] of Object.entries(instanceMap)) {
      const options = this.entityStorage.get(instance.constructor);
      if (options) {
        optionsMap.set(alias, options);
      }
    }

    return optionsMap;
  }

  private populateProperties(
    data: any,
    instanceMap: Record<string, any>,
    optionsMap: Map<string, Options>,
    cachedAliases: Set<string>,
  ): void {
    Object.entries(data).forEach(([key, value]) => {
      const { alias, propertyName } = this.parseColumnKey(key);
      const entity = instanceMap[alias];

      if (!entity) {
        return;
      }

      // Skip populating properties for cached entities to preserve in-memory changes
      if (cachedAliases.has(alias)) {
        return;
      }

      this.setPropertyValue(entity, propertyName, value, optionsMap.get(alias)!);
    });
  }

  private parseColumnKey(key: string): { alias: string; propertyName: string } {
    const index = key.indexOf('_');
    return {
      alias: key.substring(0, index),
      propertyName: key.substring(index + 1),
    };
  }

  private setPropertyValue(entity: any, columnName: string, value: any, options: Options): void {
    const propertyInfo = this.findPropertyByColumnName(columnName, options);

    if (!propertyInfo) {
      return;
    }

    const { key, property } = propertyInfo;

    if (this.isValueObjectType(property.type)) {
      entity[key] = new property.type(value);
      return;
    }

    entity[key] = this.normalizePropertyValue(property, value);
  }

  // @todo refactor for performance
  private normalizePropertyValue(property: any, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    if (property?.type === Boolean) {
      if (value === 1 || value === '1' || value === true || value === 'true') {
        return true;
      }
      if (value === 0 || value === '0' || value === false || value === 'false') {
        return false;
      }
    }

    if (property?.type === Date && !(value instanceof Date)) {
      return new Date(value);
    }

    return value;
  }

  private findPropertyByColumnName(
    columnName: string,
    options: Options,
  ): { key: string; property: any } | null {
    const idx = options._metadataIndex;
    if (idx) {
      const cached = idx.propertyByColumn.get(columnName);
      if (cached) {
        return { key: cached.key, property: cached.property };
      }
      return null;
    }

    // Defensive fallback (Options built outside the standard registration
    // path won't have the index yet).
    const entry = Object.entries(options.properties).find(
      ([_, prop]) => prop.options.columnName === columnName,
    );

    if (entry) {
      return { key: entry[0], property: entry[1] };
    }

    const relation = options.relations?.find(
      (rel) => rel.columnName === columnName && (rel.relation === 'many-to-one' || rel.relation === 'one-to-one-owner'),
    );

    if (relation) {
      return { key: relation.propertyKey as string, property: relation };
    }

    return null;
  }

  private isValueObjectType(type: any): boolean {
    return extendsFrom(ValueObject, type?.prototype);
  }

  private linkJoinedEntities(
    statement: Statement<any>,
    instanceMap: Record<string, any>,
    optionsMap: Map<string, Options>,
  ): void {
    if (!statement.join) {
      return;
    }

    statement.join.forEach(join => {
      this.linkSingleJoin(join, instanceMap, optionsMap);
    });
  }

  private linkSingleJoin(
    join: any,
    instanceMap: Record<string, any>,
    optionsMap: Map<string, Options>,
  ): void {
    const { joinAlias, originAlias, propertyKey } = join;
    const originEntity = instanceMap[originAlias];
    const joinEntity = instanceMap[joinAlias];

    if (!originEntity || !joinEntity) {
      return;
    }

    const property = this.findRelationProperty(originAlias, propertyKey, optionsMap);

    if (property) {
      this.attachJoinedEntity(originEntity, joinEntity, propertyKey, property);
    }
  }

  private findRelationProperty(alias: string, propertyKey: string, optionsMap: Map<string, Options>): any {
    return optionsMap.get(alias)?.relations.find(rel => rel.propertyKey === propertyKey);
  }

  private attachJoinedEntity(originEntity: any, joinEntity: any, propertyKey: string, property: any): void {
    if (property.type === Array) {
      originEntity[propertyKey] = this.appendToArray(originEntity[propertyKey], joinEntity);
    } else {
      originEntity[propertyKey] = joinEntity;
    }
  }

  private appendToArray(existingArray: any[], newItem: any): any[] {
    return existingArray ? [...existingArray, newItem] : [newItem];
  }

  private resetChangedValues(instanceMap: Record<string, any>, cachedAliases: Set<string>): void {
    Object.entries(instanceMap).forEach(([alias, instance]) => {
      // Skip resetting changed values for cached entities to preserve in-memory changes
      if (cachedAliases.has(alias)) {
        return;
      }

      const currentValues = {};

      for (const key in instance) {
        if (!key.startsWith('_') && !key.startsWith('$')) {
          currentValues[key] = instance[key];
        }
      }

      instance._oldValues = currentValues;
      instance._changedValues = {};
    });
  }
}
