import { EntityStorage, Options } from './domain/entities';
import { Orm } from './orm';
import { transactionContext } from './transaction/transaction-context';
import { Repository } from './repository/Repository';
import type { ValueOrInstance } from './driver/driver.interface';

/**
 * Result of `Session.flush()` — counters of rows committed by the unit of work.
 */
export type FlushResult = {
  inserted: number;
  updated: number;
  deleted: number;
};

type EntityClass = new (...args: any[]) => any;

type PendingBucket = {
  inserts: any[];
  updates: any[];
  deletes: Array<number | string>;
};

/**
 * Unit-of-Work session. Queue insert/update/delete operations across multiple
 * entity types, then call `flush()` to materialize them in a single
 * transaction with optimal batching:
 *
 * - Inserts are issued parent-first (FK-safe topological order).
 * - Updates run in any order (CASE-based, one statement per entity per chunk).
 * - Deletes run children-first (reverse topological order).
 *
 * Trade-offs vs. eager `Repository.bulkCreate/bulkUpdate/bulkDelete`:
 * - `Session.flush()` is the right tool when you have a *graph* of changes
 *   that should be committed atomically together.
 * - `Repository.bulk*` are the right tool for a single homogenous batch you
 *   want to persist immediately.
 *
 * Sessions are reusable after a successful `flush()`: pending queues are
 * cleared automatically, so you can enqueue a new batch on the same instance.
 *
 * @example
 * ```ts
 * const session = new Session();
 * session.queueInsert(Author, { id: 1, name: 'Ada' });
 * session.queueInsert(Book,   { id: 1, title: 'X', authorId: 1 });
 * session.queueUpdate(Book,   { id: 1, title: 'Y' });
 * session.queueDelete(OldRow, 42);
 * await session.flush(); // single transaction
 * ```
 */
export class Session {
  private readonly buckets = new Map<EntityClass, PendingBucket>();
  /** Insertion order of entity classes — used to keep flush deterministic. */
  private readonly seen: EntityClass[] = [];

  private getBucket(entityClass: EntityClass): PendingBucket {
    let bucket = this.buckets.get(entityClass);
    if (!bucket) {
      bucket = { inserts: [], updates: [], deletes: [] };
      this.buckets.set(entityClass, bucket);
      this.seen.push(entityClass);
    }
    return bucket;
  }

  /**
   * Queue an insert. Multiple calls accumulate; rows are persisted on
   * `flush()`. Defaults / `onInsert` / hooks fire on flush, exactly as if
   * `BaseEntity.createMany()` was called per entity class.
   */
  queueInsert<T>(entityClass: new (...args: any[]) => T, row: Partial<{ [K in keyof T]: ValueOrInstance<T[K]> }>): void {
    this.getBucket(entityClass).inserts.push(row);
  }

  /**
   * Queue an update by primary key. Each `row` MUST contain the entity's PK.
   * Behavior matches `Repository.bulkUpdate` (CASE strategy, ELSE preserves
   * untouched columns).
   */
  queueUpdate<T>(entityClass: new (...args: any[]) => T, row: Partial<{ [K in keyof T]: ValueOrInstance<T[K]> }>): void {
    this.getBucket(entityClass).updates.push(row);
  }

  /** Queue a delete by primary key. */
  queueDelete<T>(entityClass: new (...args: any[]) => T, id: number | string): void {
    this.getBucket(entityClass).deletes.push(id);
  }

  /** Drop all queued operations without executing them. */
  clear(): void {
    this.buckets.clear();
    this.seen.length = 0;
  }

  /** Number of operations currently queued. Useful for diagnostics / no-op guards. */
  pendingCount(): { inserts: number; updates: number; deletes: number } {
    let i = 0; let u = 0; let d = 0;
    for (const b of this.buckets.values()) {
      i += b.inserts.length;
      u += b.updates.length;
      d += b.deletes.length;
    }
    return { inserts: i, updates: u, deletes: d };
  }

  /**
   * Execute all queued work in a single transaction. Inserts run before
   * updates which run before deletes; among inserts/deletes the entity
   * classes are topologically sorted by FK dependencies (many-to-one) so
   * parent rows exist before children reference them.
   *
   * If the session is already inside a transaction (e.g. wrapped by
   * `Orm.getInstance().transaction(...)`), it reuses that transaction
   * instead of opening a nested one.
   */
  async flush(opts?: { chunkSize?: number }): Promise<FlushResult> {
    const totals: FlushResult = { inserted: 0, updated: 0, deleted: 0 };
    const counts = this.pendingCount();
    if (counts.inserts + counts.updates + counts.deletes === 0) {
      return totals;
    }

    const chunkSize = opts?.chunkSize && opts.chunkSize > 0 ? opts.chunkSize : 500;
    const insertOrder = this.topologicalOrder();
    const deleteOrder = insertOrder.slice().reverse();

    const work = async (): Promise<FlushResult> => {
      try {
        // 1) Inserts (parents first).
        for (const cls of insertOrder) {
          const bucket = this.buckets.get(cls);
          if (!bucket || bucket.inserts.length === 0) continue;
          const repo = makeAdHocRepository(cls);
          const rows = await repo.bulkCreate(bucket.inserts as any, { chunkSize });
          totals.inserted += rows.length;
        }

        // 2) Updates (any order — they don't have inter-entity dependencies).
        for (const cls of this.seen) {
          const bucket = this.buckets.get(cls);
          if (!bucket || bucket.updates.length === 0) continue;
          const repo = makeAdHocRepository(cls);
          totals.updated += await repo.bulkUpdate(bucket.updates as any, { chunkSize });
        }

        // 3) Deletes (children first to satisfy FK constraints).
        for (const cls of deleteOrder) {
          const bucket = this.buckets.get(cls);
          if (!bucket || bucket.deletes.length === 0) continue;
          const repo = makeAdHocRepository(cls);
          totals.deleted += await repo.bulkDelete(bucket.deletes, { chunkSize });
        }

        return totals;
      } finally {
        this.clear();
      }
    };

    if (transactionContext.hasContext()) {
      return work();
    }

    return Orm.getInstance().transaction(async () => work());
  }

  /**
   * Compute a topological order over the queued entity classes such that for
   * every many-to-one relation A→B (A depends on B), B appears before A.
   *
   * Falls back to insertion order for cyclic / unknown dependencies (the
   * caller is responsible for committing such graphs in a deferred-FK
   * setting, which we don't ship in this release).
   */
  private topologicalOrder(): EntityClass[] {
    const storage = EntityStorage.getInstance();
    const known = new Set<EntityClass>(this.seen);

    // For each class C, dependencies are the set of *queued* classes that C
    // references via a many-to-one relation.
    const deps = new Map<EntityClass, Set<EntityClass>>();
    for (const cls of this.seen) {
      const opt = storage.get(cls as Function) as Options | undefined;
      const set = new Set<EntityClass>();
      if (opt) {
        const m2o = opt._metadataIndex?.manyToOneRelations || [];
        for (const r of m2o) {
          const target = r.entity() as EntityClass;
          if (target !== cls && known.has(target)) {
            set.add(target);
          }
        }
      }
      deps.set(cls, set);
    }

    const placed = new Set<EntityClass>();
    const ordered: EntityClass[] = [];
    let progress = true;
    while (progress && ordered.length < this.seen.length) {
      progress = false;
      for (const cls of this.seen) {
        if (placed.has(cls)) continue;
        const d = deps.get(cls)!;
        let ready = true;
        for (const dep of d) {
          if (!placed.has(dep)) { ready = false; break; }
        }
        if (ready) {
          ordered.push(cls);
          placed.add(cls);
          progress = true;
        }
      }
    }

    // Cycle fallback — push remaining entities in insertion order.
    if (ordered.length < this.seen.length) {
      for (const cls of this.seen) {
        if (!placed.has(cls)) ordered.push(cls);
      }
    }
    return ordered;
  }
}

/**
 * Cheap Repository instance used internally by `Session.flush()` to leverage
 * the existing bulk* implementations without forcing the caller to subclass
 * `Repository<T>` for every entity in the unit of work.
 */
class AdHocRepository<T extends object> extends Repository<T> {
  constructor(entityClass: new () => T) {
    super(entityClass);
  }
}

function makeAdHocRepository(cls: EntityClass): AdHocRepository<any> {
  return new AdHocRepository<any>(cls as any);
}

/**
 * Convenience helper: open a Session, run `cb` with it, then auto-flush. If
 * `cb` throws, the session is cleared and the error is rethrown.
 *
 * @example
 * ```ts
 * await withSession(async (s) => {
 *   s.queueInsert(User, { name: 'Alice' });
 *   s.queueInsert(User, { name: 'Bob' });
 * });
 * ```
 */
export async function withSession(
  cb: (session: Session) => Promise<void> | void,
  opts?: { chunkSize?: number; autoFlush?: boolean },
): Promise<FlushResult>;
export async function withSession<T>(
  cb: (session: Session) => Promise<T> | T,
  opts?: { chunkSize?: number; autoFlush?: boolean },
): Promise<{ result: T; flush: FlushResult }>;
export async function withSession<T>(
  cb: (session: Session) => Promise<T> | T,
  opts?: { chunkSize?: number; autoFlush?: boolean },
): Promise<FlushResult | { result: T; flush: FlushResult }> {
  const session = new Session();
  let result: T;
  try {
    result = await cb(session);
  } catch (err) {
    session.clear();
    throw err;
  }

  const autoFlush = opts?.autoFlush !== false;
  const flushResult = autoFlush
    ? await session.flush({ chunkSize: opts?.chunkSize })
    : { inserted: 0, updated: 0, deleted: 0 };

  if (result === undefined) {
    return flushResult as any;
  }
  return { result, flush: flushResult } as any;
}
