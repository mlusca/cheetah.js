import { SqlBuilder } from '../SqlBuilder';
import { FilterQuery, FindOneOption, FindOptions, ValueOrInstance } from '../driver/driver.interface';

export abstract class BaseEntity {
  private _oldValues: any = {};
  private _changedValues: any = {};
  private $_isPersisted: boolean = false;

  constructor() {
    return new Proxy(this, {
      set(target: any, p: string, newValue: any): boolean {

        if (p.startsWith('$')) {
          target[p] = newValue;
          return true;
        }

        // se oldvalue não existir, é porque é a primeira vez que o atributo está sendo setado
        if (!target._oldValues[p]) {
          target._oldValues[p] = newValue;
        }

        // se o valor for diferente do valor antigo, é porque o valor foi alterado
        if (target._oldValues[p] !== newValue) {
          target._changedValues[p] = newValue;
        }

        target[p] = newValue;

        return true;
      },
    })
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
      .orderBy(options?.orderBy as string[]);

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

  public async save() {
    const qb = this.createQueryBuilder()

    if (this.$_isPersisted) {
      qb.update(this._changedValues)
        // @ts-ignore
        .where({id: this._oldValues.id})
    } else {
      qb.insert(this._oldValues)
    }

    await qb.execute()

    this._oldValues = {
      ...this._oldValues,
      ...this._changedValues,
    }
    this._changedValues = {}
  }
}