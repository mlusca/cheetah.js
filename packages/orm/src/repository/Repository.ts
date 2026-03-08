import { SqlBuilder } from '../SqlBuilder';
import {
  FilterQuery,
  FindOptions,
  FindOneOption,
  ValueOrInstance,
} from '../driver/driver.interface';

/**
 * Generic Repository class for database operations.
 * Provides type-safe methods for CRUD operations.
 *
 * @example
 * ```typescript
 * @Service()
 * export class LessonRepository extends Repository<Lesson> {
 *   constructor() {
 *     super(Lesson);
 *   }
 *
 *   async findByCourse(courseId: number): Promise<Lesson[]> {
 *     return this.find({
 *       where: { courseId },
 *       order: { orderIndex: 'ASC' }
 *     });
 *   }
 * }
 * ```
 */
export abstract class Repository<T extends object> {
  protected readonly entityClass: new () => T;

  constructor(entityClass: new () => T) {
    this.entityClass = entityClass;
  }

  /**
   * Creates a new query builder for the entity.
   */
  protected createQueryBuilder(): SqlBuilder<T> {
    return new SqlBuilder<T>(this.entityClass);
  }

  /**
   * Finds entities matching the given criteria.
   *
   * @example
   * ```TypeScript
   * const lessons = await repository.find({
   *   where: { courseId: 1, isPublished: true },
   *   order: { orderIndex: 'ASC' },
   *   limit: 10
   * });
   * ```
   */
  async find<Hint extends string = never>(options: RepositoryFindOptions<T, Hint>): Promise<T[]> {
    const { where, orderBy, limit, offset, fields, load, loadStrategy, cache } = options;

    return this.createQueryBuilder()
      .select(fields as any)
      .setStrategy(loadStrategy)
      .load(load as unknown as string[])
      .where(where || {})
      .limit(limit)
      .offset(offset)
      .orderBy(orderBy as any)
      .cache(cache)
      .executeAndReturnAll();
  }

  /**
   * Finds a single entity matching the given criteria.
   * Returns undefined if not found.
   */
  async findOne<Hint extends string = never>(options: RepositoryFindOneOptions<T, Hint>): Promise<T | undefined> {
    const { where, fields, load, loadStrategy, cache } = options;

    return this.createQueryBuilder()
      .select(fields as any)
      .setStrategy(loadStrategy)
      .load(load as unknown as string[])
      .where(where || {})
      .cache(cache)
      .executeAndReturnFirst();
  }

  /**
   * Finds a single entity matching the given criteria.
   * Throws an error if not found.
   */
  async findOneOrFail<Hint extends string = never>(
    options: RepositoryFindOneOptions<T, Hint>
  ): Promise<T> {
    const { where, orderBy, fields, load, loadStrategy, cache } = options;

    return this.createQueryBuilder()
      .select(fields as any)
      .setStrategy(loadStrategy)
      .load(load as unknown as string[])
      .where(where || {})
      .orderBy(orderBy as any)
      .cache(cache)
      .executeAndReturnFirstOrFail();
  }

  /**
   * Finds all entities with optional filtering.
   */
  async findAll<Hint extends string = never>(
    options?: Omit<RepositoryFindOptions<T>, 'where'>
  ): Promise<T[]> {
    const { orderBy, limit, offset, fields, load, loadStrategy, cache } = options || {};

    return this.createQueryBuilder()
      .select(fields as any)
      .setStrategy(loadStrategy)
      .load(load as unknown as string[])
      .offset(offset)
      .limit(limit)
      .orderBy(orderBy as any)
      .cache(cache)
      .executeAndReturnAll();
  }

  /**
   * Finds an entity by its primary key.
   */
  async findById<Hint extends string = never>(id: number | string, options?: Omit<RepositoryFindOneOptions<T, Hint>, 'where'>): Promise<T | undefined> {
    return this.findOne({ where: { id } as any, ...options });
  }

  /**
   * Finds an entity by its primary key.
   * Throws an error if not found.
   */
  async findByIdOrFail<Hint extends string = never>(id: number | string, options?: Omit<RepositoryFindOneOptions<T, Hint>, 'where'>): Promise<T> {
    return this.findOneOrFail({ where: { id } as any, ...options });
  }

  /**
   * Creates a new entity.
   */
  async create(
    data: Partial<{ [K in keyof T]: ValueOrInstance<T[K]> }>
  ): Promise<T> {
    return this.createQueryBuilder()
      .insert(data)
      .executeAndReturnFirstOrFail();
  }

  /**
   * Updates entities matching the criteria.
   */
  async update(
    where: FilterQuery<T>,
    data: Partial<{ [K in keyof T]: ValueOrInstance<T[K]> }>
  ): Promise<void> {
    await this.createQueryBuilder()
      .update(data)
      .where(where)
      .execute();
  }

  /**
   * Updates an entity by its primary key.
   */
  async updateById(
    id: number | string,
    data: Partial<{ [K in keyof T]: ValueOrInstance<T[K]> }>
  ): Promise<void> {
    await this.update({ id } as any, data);
  }

  /**
   * Deletes entities matching the criteria.
   *
   * @example
   * ```typescript
   * await repository.delete({ isActive: false });
   * ```
   */
  async delete(where: FilterQuery<T>): Promise<void> {
    await this.createQueryBuilder()
      .delete()
      .where(where)
      .execute();
  }

  /**
   * Deletes an entity by its primary key.
   */
  async deleteById(id: number | string): Promise<void> {
    await this.delete({ id } as any);
  }

  /**
   * Counts entities matching the criteria.
   */
  async count(where?: FilterQuery<T>): Promise<number> {
    return this.createQueryBuilder()
      .count()
      .setStrategy('joined')
      .where(where || {})
      .executeCount();
  }

  /**
   * Checks if any entity matches the criteria.
   */
  async exists(where: FilterQuery<T>): Promise<boolean> {
    const count = await this.count(where);
    return count > 0;
  }
}

/**
 * Find options for repository queries.
 */
export type RepositoryFindOptions<T, Hint extends string = never> = FindOptions<T, Hint> & {
  where?: FilterQuery<T>;
}

/**
 * Find one options for repository queries.
 */
export type RepositoryFindOneOptions<T, Hint extends string = never> = Omit<
  RepositoryFindOptions<T, Hint>,
  'limit' | 'offset'
>;
