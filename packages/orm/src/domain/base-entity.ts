import { SqlBuilder } from '../SqlBuilder';
import { FilterQuery, FindOneOption, FindOptions, ValueOrInstance } from '../driver/driver.interface';
import { EntityStorage } from './entities';
import { serializeEntityInstance } from './entity-serialization';
import type { UpdateData } from '../query/update-expression';

export abstract class BaseEntity {
  private _oldValues: any = {};
  private _changedValues: any = {};
  private $_isPersisted: boolean = false;
  private $_isHydrating: boolean = false;

  constructor() {
    return new Proxy(this, {
      set(target: any, p: string, newValue: any): boolean {
        if (p.startsWith('$') || p.startsWith('_')) {
          target[p] = newValue;
          return true;
        }

        if (target.$_isHydrating) {
          target[p] = newValue;
          return true;
        }

        if (!(p in target._oldValues)) {
          target._oldValues[p] = newValue;
        }

        if (target._oldValues[p] !== newValue) {
          target._changedValues[p] = newValue;
        }

        target[p] = newValue;
        return true;
      },
    })
  }

  $_startHydration(): void {
    this.$_isHydrating = true;
  }

  $_endHydration(): void {
    this.$_isHydrating = false;
  }

  /**
   * Gets current entity's Repository.
   */
  static createQueryBuilder<T>(
    this: { new(): T } & typeof BaseEntity,
  ): SqlBuilder<T> {
    return new SqlBuilder<T>(this);
  }

  /**
   * Gets current entity's Repository.
   */
  private createQueryBuilder<T>(): SqlBuilder<T> {
    // @ts-ignore
    return new SqlBuilder<T>(this.constructor);
  }

  static async find<T, Hint extends string = never>(
    this: { new(): T } & typeof BaseEntity,
    where: FilterQuery<T>,
    options?: FindOptions<T, Hint>
  ): Promise<T[]> {
    return this.createQueryBuilder<T>()
      .select(options?.fields as any)
      .setStrategy(options?.loadStrategy)
      .load(options?.load as any[])
      .where(where)
      .limit(options?.limit)
      .offset(options?.offset)
      .orderBy(options?.orderBy as string[])
      .cache(options?.cache)
      .executeAndReturnAll();
  }

  static async findOne<T, Hint extends string = never>(
    this: { new(): T } & typeof BaseEntity,
    where: FilterQuery<T>,
    options?: FindOneOption<T, Hint>
  ): Promise<T | undefined> {
    return this.createQueryBuilder<T>()
      .select(options?.fields as any)
      .setStrategy(options?.loadStrategy)
      .load(options?.load as any[])
      .where(where)
      .cache(options?.cache)
      .executeAndReturnFirst();
  }

  /**
   * Find a record in the database based on the provided query where and return it, or throw an error if not found.
   *
   * @param {FilterQuery<T>} where - The query where used to search for the record.
   * @param options
   * @return {Promise<T>} - A promise that resolves with the found record.
   */
  static async findOneOrFail<T, Hint extends string = never>(
    this: { new(): T } & typeof BaseEntity,
    where: FilterQuery<T>,
    options?: FindOneOption<T, Hint>
  ): Promise<T> {
    return this.createQueryBuilder<T>()
      // @ts-ignore
      .select(options?.fields)
      .setStrategy(options?.loadStrategy)
      .load(options?.load as any[])
      .where(where)
      .orderBy(options?.orderBy as string[])
      .cache(options?.cache)
      .executeAndReturnFirstOrFail();
  }

  static async findAll<
    T extends object,
    Hint extends string = never
  >(
    this: { new(): T } & typeof BaseEntity,
    options: FindOptions<T, Hint>
  ): Promise<T[]> {
    const builder = this.createQueryBuilder<T>()
      .select(options.fields as any)
      .setStrategy(options?.loadStrategy)
      .load(options?.load as any[])
      .offset(options?.offset)
      .limit(options.limit)
      .orderBy(options?.orderBy as string[])
      .cache(options?.cache);

    return builder.executeAndReturnAll();
  }

  static async create<T extends BaseEntity>(
    this: { new(): T } & typeof BaseEntity,
    where: Partial<{ [K in keyof T]: ValueOrInstance<T[K]> }>,
  ): Promise<T> {
    return this.createQueryBuilder<T>()
      .insert(where)
      .executeAndReturnFirstOrFail();
  }

  /**
   * Bulk insert. Generates a single multi-row INSERT statement and returns
   * the resulting entity instances. For very large input arrays, prefer the
   * Repository's `bulkCreate(rows, { chunkSize })` which chunks automatically
   * and wraps each chunk in a transaction.
   *
   * Hooks (`@BeforeCreate`, `@AfterCreate`), `default` and `onInsert` apply
   * to every row, mirroring N sequential `create()` calls.
   */
  static async createMany<T extends BaseEntity>(
    this: { new(): T } & typeof BaseEntity,
    rows: Array<Partial<{ [K in keyof T]: ValueOrInstance<T[K]> }>>,
  ): Promise<T[]> {
    if (!Array.isArray(rows) || rows.length === 0) {
      return [];
    }

    return this.createQueryBuilder<T>()
      .insertMany(rows)
      .executeAndReturnMany();
  }

  static async update<T>(
    this: { new(): T } & typeof BaseEntity,
    where: FilterQuery<T>,
    data: UpdateData<T>,
  ): Promise<void> {
    await this.createQueryBuilder<T>()
      .update(data)
      .where(where)
      .execute();
  }

  static async delete<T>(
    this: { new(): T } & typeof BaseEntity,
    where: FilterQuery<T>,
  ): Promise<void> {
    await this.createQueryBuilder<T>()
      .delete()
      .where(where)
      .execute();
  }

  public async save() {
    const qb = this.createQueryBuilder()
    const wasPersisted = this.$_isPersisted;

    if (wasPersisted) {
      qb.update(this._changedValues);
      qb.setInstance(this)
      // Use cached primary key property name instead of hardcoded 'id'
      const storage = EntityStorage.getInstance();
      const options = storage.get(this.constructor);
      const pkName = options?._primaryKeyPropertyName || 'id';
      // @ts-ignore
      qb.where({ [pkName]: this._oldValues[pkName] })
    } else {
      qb.insert({
        ...this._oldValues,
        ...this._changedValues,
      })
    }

    await qb.execute()

    if (!wasPersisted) {
      this.$_isPersisted = true;
    }

    qb.callHook('afterCreate', this)
    qb.callHook('afterUpdate', this)
    this._oldValues = {
      ...this._oldValues,
      ...this._changedValues,
    }
    this._changedValues = {}
  }

  /**
   * Determines whether the current object has been persisted after the last modification.
   *
   * @return {boolean} Returns true if the object has been persisted, otherwise false.
   */
  public isPersisted() {
    return this.$_isPersisted;
  }

  /**
   * Removes this entity from the database.
   * Uses cached primary key property name instead of hardcoded 'id'.
   */
  public async remove() {
    const qb = this.createQueryBuilder();
    const storage = EntityStorage.getInstance();
    const options = storage.get(this.constructor);
    const pkName = options?._primaryKeyPropertyName || 'id';
    // @ts-ignore
    qb.delete().where({ [pkName]: this._oldValues[pkName] });
    await qb.execute();
  }

  public toJSON(): Record<string, any> {
    return serializeEntityInstance(this as Record<string, any>);
  }
}
