import { SqlBuilder } from '../SqlBuilder';
import {
  FilterQuery,
  FindOptions,
  FindOneOption,
  ValueOrInstance,
} from '../driver/driver.interface';
import type { UpdateData } from '../query/update-expression';
import { Orm } from '../orm';
import { transactionContext } from '../transaction/transaction-context';
import { EntityStorage } from '../domain/entities';
import { ValueProcessor } from '../utils/value-processor';
import {
  buildDerivedWhere,
  DerivedQueryPlan,
  getDerivedQueryPlan,
  isDerivedQueryMethodName,
} from './derived-query';

const derivedMethodCache = new WeakMap<object, Map<string, Function>>();

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

    return new Proxy(this, {
      get: (target, property, receiver) => {
        if (typeof property !== 'string') {
          return Reflect.get(target, property, receiver);
        }

        const existing = Reflect.get(target, property, receiver);

        if (existing !== undefined || !isDerivedQueryMethodName(property)) {
          return existing;
        }

        let instanceCache = derivedMethodCache.get(target);

        if (!instanceCache) {
          instanceCache = new Map<string, Function>();
          derivedMethodCache.set(target, instanceCache);
        }

        const cached = instanceCache.get(property);

        if (cached) {
          return cached;
        }

        const plan = getDerivedQueryPlan(entityClass, property);

        if (!plan) {
          return undefined;
        }

        const derived = async (...args: unknown[]) => executeDerivedQuery(receiver as Repository<T>, plan, args);
        instanceCache.set(property, derived);

        return derived;
      },
    });
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
    const { where, orderBy, fields, load, loadStrategy, cache } = options;

    return this.createQueryBuilder()
      .select(fields as any)
      .setStrategy(loadStrategy)
      .load(load as unknown as string[])
      .where(where || {})
      .orderBy(orderBy as any)
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
   * Finds a paginated result set and the total matching row count.
   *
   * `page` is 1-based and defaults to 1. `pageSize` defaults to 20.
   */
  async findPage<Hint extends string = never>(
    options?: RepositoryFindPageOptions<T, Hint>
  ): Promise<Page<T>> {
    const { page, pageSize, ...findOptions } = options || {};
    const normalizedPage = normalizePaginationInteger(page, 'page', 1);
    const normalizedPageSize = normalizePaginationInteger(pageSize, 'pageSize', 20);
    const offset = (normalizedPage - 1) * normalizedPageSize;

    if (!Number.isSafeInteger(offset)) {
      throw new Error('findPage option "page" and "pageSize" produce an unsafe offset.');
    }

    const [data, total] = await Promise.all([
      this.find({
        ...findOptions,
        limit: normalizedPageSize,
        offset,
      } as RepositoryFindOptions<T, Hint>),
      this.count(findOptions.where),
    ]);

    return {
      data,
      total,
      page: normalizedPage,
      pageSize: normalizedPageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / normalizedPageSize),
    };
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
   * Bulk insert. Splits `rows` into chunks of `chunkSize` (default 500), runs
   * each chunk as a single multi-row INSERT and wraps the whole operation in
   * a transaction so partial failures roll back. Returns hydrated entity
   * instances in input order.
   *
   * Trade-offs vs. `Session.flush()`:
   * - `bulkCreate` is imperative and runs immediately. Use it when you want
   *   the data persisted as soon as the call returns.
   * - For multi-entity unit-of-work scenarios, prefer `ormSessionContext` /
   *   `Session.flush()` so related rows are batched together and constraints
   *   are checked at the end of the transaction.
   *
   * @param rows entity payloads (same shape accepted by `create`).
   * @param opts.chunkSize maximum rows per INSERT statement (default 500).
   */
  async bulkCreate(
    rows: Array<Partial<{ [K in keyof T]: ValueOrInstance<T[K]> }>>,
    opts?: { chunkSize?: number },
  ): Promise<T[]> {
    if (!Array.isArray(rows) || rows.length === 0) {
      return [];
    }

    const chunkSize = opts?.chunkSize && opts.chunkSize > 0 ? opts.chunkSize : 500;

    const runBulk = async (): Promise<T[]> => {
      const out: T[] = [];
      for (let i = 0; i < rows.length; i += chunkSize) {
        const slice = rows.slice(i, i + chunkSize);
        const inserted = await this.createQueryBuilder()
          .insertMany(slice)
          .executeAndReturnMany();
        for (let k = 0; k < inserted.length; k += 1) out.push(inserted[k]);
      }
      return out;
    };

    // Single-chunk inserts are atomic at the SQL layer; only wrap multi-chunk
    // operations in a transaction (skips redundant BEGIN/COMMIT round-trips).
    if (rows.length <= chunkSize) {
      return runBulk();
    }

    if (transactionContext.hasContext()) {
      // Already inside a user-managed transaction — reuse it.
      return runBulk();
    }

    return Orm.getInstance().transaction(async () => runBulk());
  }

  /**
   * Updates entities matching the criteria.
   */
  async update(
    where: FilterQuery<T>,
    data: UpdateData<T>
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
    data: UpdateData<T>
  ): Promise<void> {
    await this.update({ id } as any, data);
  }

  /**
   * Bulk update by primary key. Each row in `rows` MUST contain the entity's
   * primary key (configured via `@PrimaryKey()` — defaults to `id`); the
   * remaining keys are the columns to update for that row.
   *
   * Strategy `case` (default and only strategy currently): emits a single
   * `UPDATE` per chunk using `CASE pk WHEN ... THEN ... ELSE col END` so that
   * rows omitting a given column keep their existing value. This collapses N
   * round-trips into ⌈N/chunkSize⌉.
   *
   * `onUpdate` properties (e.g. an `updatedAt` timestamp) are applied to
   * every row in the chunk automatically.
   *
   * Returns the total number of rows affected (sum across chunks).
   *
   * @example
   * ```ts
   * await repo.bulkUpdate([
   *   { id: 1, name: 'Alice', email: 'a@x.com' },
   *   { id: 2, name: 'Bob' }, // email left unchanged
   * ]);
   * ```
   */
  async bulkUpdate(
    rows: Array<Partial<{ [K in keyof T]: ValueOrInstance<T[K]> }>>,
    opts?: { chunkSize?: number },
  ): Promise<number> {
    if (!Array.isArray(rows) || rows.length === 0) {
      return 0;
    }

    const chunkSize = opts?.chunkSize && opts.chunkSize > 0 ? opts.chunkSize : 500;

    const orm = Orm.getInstance();
    const driver = orm.driverInstance;
    const entityOptions = EntityStorage.getInstance().get(this.entityClass as Function);
    if (!entityOptions) {
      throw new Error(`Entity metadata not found for ${this.entityClass.name}`);
    }

    const pkProperty = entityOptions._primaryKeyPropertyName || 'id';
    const pkColumn = entityOptions._primaryKeyColumnName || 'id';
    const tableName = entityOptions.tableName || this.entityClass.name.toLowerCase();
    const schema = entityOptions.schema || 'public';
    const q = driver.getIdentifierQuote();
    const qTable = driver.dbType === 'mysql'
      ? `${q}${tableName}${q}`
      : `${q}${schema}${q}.${q}${tableName}${q}`;
    const qPk = `${q}${pkColumn}${q}`;

    const onUpdateList = entityOptions._metadataIndex?.onUpdateProperties || [];

    const runChunk = async (chunk: typeof rows): Promise<number> => {
      // Project rows: { columnName -> value }, with PK extracted separately.
      const processed: Array<{ pkValue: any; cols: Record<string, any> }> = [];
      for (let i = 0; i < chunk.length; i += 1) {
        const row = chunk[i] as any;
        if (row[pkProperty] === undefined || row[pkProperty] === null) {
          throw new Error(
            `bulkUpdate: row ${i} is missing primary key "${pkProperty}"`,
          );
        }
        const cols = ValueProcessor.processForUpdate<T>(row, entityOptions);
        // Remove the PK from the SET map (it's the WHEN selector, not a target).
        delete cols[pkColumn];
        // Apply onUpdate hooks per row (e.g. updatedAt).
        for (let k = 0; k < onUpdateList.length; k += 1) {
          const p = onUpdateList[k];
          cols[p.columnName] = (p.options.onUpdate as () => any)();
        }
        processed.push({ pkValue: row[pkProperty], cols });
      }

      // Union of all columns being updated across the chunk.
      const allCols = new Set<string>();
      for (let i = 0; i < processed.length; i += 1) {
        const keys = Object.keys(processed[i].cols);
        for (let k = 0; k < keys.length; k += 1) allCols.add(keys[k]);
      }

      if (allCols.size === 0) {
        // Nothing to update — but the caller asked us to "touch" rows.
        return 0;
      }

      const orderedCols = Array.from(allCols);
      const setParts = new Array(orderedCols.length);

      for (let c = 0; c < orderedCols.length; c += 1) {
        const col = orderedCols[c];
        const qCol = `${q}${col}${q}`;
        const whens: string[] = [];
        for (let i = 0; i < processed.length; i += 1) {
          const p = processed[i];
          if (col in p.cols) {
            whens.push(
              `WHEN ${driver.formatLiteral(p.pkValue)} THEN ${driver.formatLiteral(p.cols[col])}`,
            );
          }
        }
        // ELSE col preserves existing value when a row didn't request a change.
        setParts[c] = `${qCol} = CASE ${qPk} ${whens.join(' ')} ELSE ${qCol} END`;
      }

      const inList = processed
        .map((p) => driver.formatLiteral(p.pkValue))
        .join(', ');

      const sql = `UPDATE ${qTable} SET ${setParts.join(', ')} WHERE ${qPk} IN (${inList})`;

      const result = await driver.executeSql(sql);
      const affected =
        (result as any)?.affectedRows ?? (result as any)?.count ?? 0;
      return Number(affected);
    };

    const runAll = async (): Promise<number> => {
      let total = 0;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const slice = rows.slice(i, i + chunkSize);
        total += await runChunk(slice);
      }
      return total;
    };

    if (rows.length <= chunkSize) {
      return runAll();
    }

    if (transactionContext.hasContext()) {
      return runAll();
    }

    return Orm.getInstance().transaction(async () => runAll());
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
   * Bulk delete by primary key list. Splits `ids` into chunks of `chunkSize`
   * (default 500) and emits one `DELETE WHERE pk IN (...)` per chunk. Wraps
   * multi-chunk runs in a transaction so partial failures roll back.
   *
   * Returns the total number of rows deleted.
   */
  async bulkDelete(
    ids: Array<number | string>,
    opts?: { chunkSize?: number },
  ): Promise<number> {
    if (!Array.isArray(ids) || ids.length === 0) {
      return 0;
    }

    const chunkSize = opts?.chunkSize && opts.chunkSize > 0 ? opts.chunkSize : 500;

    const entityOptions = EntityStorage.getInstance().get(this.entityClass as Function);
    if (!entityOptions) {
      throw new Error(`Entity metadata not found for ${this.entityClass.name}`);
    }
    const pkProperty = entityOptions._primaryKeyPropertyName || 'id';

    const runChunk = async (chunk: Array<number | string>): Promise<number> => {
      const result = await this.createQueryBuilder()
        .delete()
        .where({ [pkProperty]: { $in: chunk } } as any)
        .execute();
      return Number((result as any)?.affectedRows ?? 0);
    };

    const runAll = async (): Promise<number> => {
      let total = 0;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const slice = ids.slice(i, i + chunkSize);
        total += await runChunk(slice);
      }
      return total;
    };

    if (ids.length <= chunkSize) {
      return runAll();
    }

    if (transactionContext.hasContext()) {
      return runAll();
    }

    return Orm.getInstance().transaction(async () => runAll());
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

export interface Page<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type RepositoryFindPageOptions<T, Hint extends string = never> = Omit<
  RepositoryFindOptions<T, Hint>,
  'limit' | 'offset'
> & {
  /**
   * 1-based page number. Defaults to 1.
   */
  page?: number;
  /**
   * Maximum number of rows returned in `data`. Defaults to 20.
   */
  pageSize?: number;
};

/**
 * Find one options for repository queries.
 */
export type RepositoryFindOneOptions<T, Hint extends string = never> = Omit<
  RepositoryFindOptions<T, Hint>,
  'limit' | 'offset'
>;

type NonFunctionStringKeys<T> = {
  [K in keyof T]: T[K] extends Function ? never : K extends string ? K : never
}[keyof T];

type DerivedValue<T, K extends keyof T> = T[K] | NonNullable<T[K]>;

type DerivedReadOptions<T> = Omit<RepositoryFindOptions<T>, 'where'>;
type DerivedReadOneOptions<T> = Omit<RepositoryFindOneOptions<T>, 'where'>;

export type DerivedQueryOptions<T extends object> = DerivedReadOptions<T>;

export type DerivedRepository<T extends object> = Repository<T> & {
  [K in NonFunctionStringKeys<T> as `findBy${Capitalize<K>}`]:
    (value: DerivedValue<T, K>, options?: DerivedReadOneOptions<T>) => Promise<T | undefined>;
} & {
  [K in NonFunctionStringKeys<T> as `findOneBy${Capitalize<K>}`]:
    (value: DerivedValue<T, K>, options?: DerivedReadOneOptions<T>) => Promise<T | undefined>;
} & {
  [K in NonFunctionStringKeys<T> as `findAllBy${Capitalize<K>}`]:
    (value: DerivedValue<T, K>, options?: DerivedReadOptions<T>) => Promise<T[]>;
} & {
  [K in NonFunctionStringKeys<T> as `countBy${Capitalize<K>}`]:
    (value: DerivedValue<T, K>) => Promise<number>;
} & {
  [K in NonFunctionStringKeys<T> as `existsBy${Capitalize<K>}`]:
    (value: DerivedValue<T, K>) => Promise<boolean>;
} & {
  [K in NonFunctionStringKeys<T> as `deleteBy${Capitalize<K>}`]:
    (value: DerivedValue<T, K>) => Promise<void>;
};

function executeDerivedQuery<T extends object>(
  repository: Repository<T>,
  plan: DerivedQueryPlan<T>,
  args: unknown[],
): Promise<T | T[] | number | boolean | void> {
  const { values, options } = splitDerivedArgs(plan, args);
  const where = buildDerivedWhere(plan, values);

  switch (plan.operation) {
    case 'findOne':
      return repository.findOne({
        where,
        ...withDerivedOrderAndLimit(plan, options, false),
      } as RepositoryFindOneOptions<T>);
    case 'findMany':
      return repository.find({
        where,
        ...withDerivedOrderAndLimit(plan, options, true),
      } as RepositoryFindOptions<T>);
    case 'count':
      return repository.count(where);
    case 'exists':
      return repository.exists(where);
    case 'delete':
      return repository.delete(where);
  }
}

function splitDerivedArgs<T extends object>(
  plan: DerivedQueryPlan<T>,
  args: unknown[],
): { values: unknown[]; options?: DerivedReadOptions<T> } {
  const expected = plan.parameterCount;

  if (args.length < expected) {
    throw new Error(
      `Derived query method "${plan.methodName}" expects ${expected} parameter(s), received ${args.length}.`,
    );
  }

  if (plan.operation === 'findOne' || plan.operation === 'findMany') {
    if (args.length === expected) {
      return { values: args };
    }

    if (args.length === expected + 1 && isPlainOptionsObject(args[expected])) {
      return {
        values: args.slice(0, expected),
        options: args[expected] as DerivedReadOptions<T>,
      };
    }
  }

  if (args.length > expected) {
    throw new Error(
      `Derived query method "${plan.methodName}" expects ${expected} parameter(s), received ${args.length}.`,
    );
  }

  return { values: args };
}

function withDerivedOrderAndLimit<T extends object>(
  plan: DerivedQueryPlan<T>,
  options: DerivedReadOptions<T> | undefined,
  allowLimit: boolean,
): DerivedReadOptions<T> {
  const merged: DerivedReadOptions<T> = { ...(options || {}) };

  if (plan.orderBy && !merged.orderBy) {
    merged.orderBy = plan.orderBy;
  }

  if (allowLimit && plan.limit !== undefined && merged.limit === undefined) {
    merged.limit = plan.limit;
  }

  return merged;
}

function isPlainOptionsObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizePaginationInteger(
  value: number | undefined,
  name: 'page' | 'pageSize',
  defaultValue: number,
): number {
  const candidate = value === undefined ? defaultValue : value;

  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new Error(`findPage option "${name}" must be a positive safe integer.`);
  }

  return candidate;
}
