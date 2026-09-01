export type PathSegment = string | number;

/** Replace the value at `path`. */
export interface SetOp {
    op: 'set';
    path: PathSegment[];
    value: unknown;
}

/** Delete the property at `path`. */
export interface UnsetOp {
    op: 'unset';
    path: PathSegment[];
}

/** Insert or replace one row of a keyed array at `path`. */
export interface UpsertOp {
    op: 'upsert';
    path: PathSegment[];
    key: string | number;
    index: number;
    value: unknown;
}

/** Remove one row, by key, from a keyed array at `path`. */
export interface RemoveOp {
    op: 'remove';
    path: PathSegment[];
    key: string | number;
}

/** Final key order of a keyed array at `path`. */
export interface OrderOp {
    op: 'order';
    path: PathSegment[];
    keys: (string | number)[];
}

export type PatchOp = SetOp | UnsetOp | UpsertOp | RemoveOp | OrderOp;
