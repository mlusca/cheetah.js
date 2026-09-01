import type { DepKey } from './dep-key';

/** A read registered by one resource compute. */
export interface Dependency {
    key: DepKey;
    /** Null is a wildcard for an unenumerated column set. */
    columns: string[] | null;
}

/** A write announced by an invalidation emitter. */
export interface InvalidationEvent {
    key: DepKey;
    /** Null is a wildcard for a whole-row write. */
    columns: string[] | null;
}
