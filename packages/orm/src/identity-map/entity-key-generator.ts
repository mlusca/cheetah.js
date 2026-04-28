import { EntityStorage } from '../domain/entities';

export class EntityKeyGenerator {
  private entityStorage: EntityStorage;
  // Per-class cache of "ClassName" + ":" + primary key property name. The
  // string never changes for a class once entities are registered, so caching
  // it lets us skip the EntityStorage map lookup on every set/get call.
  private pkPropertyByClass: WeakMap<Function, string> = new WeakMap();
  private classNameCache: WeakMap<Function, string> = new WeakMap();

  constructor() {
    this.entityStorage = EntityStorage.getInstance();
  }

  generate(entityClass: Function, pk: any): string {
    const className = this.getClassName(entityClass);
    const keyValue = this.serializePrimaryKey(pk);

    return `${className}:${keyValue}`;
  }

  generateForEntity(entity: any): string {
    const ctor = entity.constructor;
    const pkName = this.getPrimaryKeyName(ctor);
    const pk = entity[pkName];
    const className = this.getClassName(ctor);
    const keyValue = this.serializePrimaryKey(pk);

    return `${className}:${keyValue}`;
  }

  extractPrimaryKey(entity: any): any {
    const pkName = this.getPrimaryKeyName(entity.constructor);

    return entity[pkName];
  }

  private getPrimaryKeyName(entityClass: Function): string {
    const cached = this.pkPropertyByClass.get(entityClass);
    if (cached !== undefined) return cached;

    const options = this.entityStorage.get(entityClass);
    const pkName = options?._primaryKeyPropertyName || 'id';
    this.pkPropertyByClass.set(entityClass, pkName);
    return pkName;
  }

  private serializePrimaryKey(pk: any): string {
    if (Array.isArray(pk)) {
      return pk.join(':');
    }

    return String(pk);
  }

  private getClassName(entityClass: Function): string {
    const cached = this.classNameCache.get(entityClass);
    if (cached !== undefined) return cached;
    const name = entityClass.name;
    this.classNameCache.set(entityClass, name);
    return name;
  }
}
