import type { PatchOp, PathSegment } from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function deepEqual(left: unknown, right: unknown): boolean {
    if (left === right) {
        return true;
    }

    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((item, i) => deepEqual(item, right[i]));
    }

    if (isPlainObject(left) && isPlainObject(right)) {
        const leftKeys = Object.keys(left);

        if (leftKeys.length !== Object.keys(right).length) {
            return false;
        }

        return leftKeys.every(key =>
            Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key])
        );
    }

    return false;
}

/**
 * Snapshot → snapshot diffing, and patch application with structural sharing.
 * Structural sharing keeps useSyncExternalStore snapshots referentially stable
 * and lets framework memoization skip untouched branches.
 */
export class PatchEngine {
    constructor(private readonly keyField?: string) {}

    diff(prev: unknown, next: unknown): PatchOp[] {
        const ops: PatchOp[] = [];
        this.diffValue(prev, next, [], ops);
        return ops;
    }

    apply(prev: unknown, ops: PatchOp[]): unknown {
        if (ops.length === 0) {
            return prev;
        }

        let root = prev;

        for (const op of ops) {
            root = this.applyOne(root, op);
        }

        return root;
    }

    private diffValue(prev: unknown, next: unknown, path: PathSegment[], ops: PatchOp[]): void {
        if (prev === next) {
            return;
        }

        if (Array.isArray(prev) && Array.isArray(next)) {
            if (this.isKeyed(prev) && this.isKeyed(next)) {
                this.diffKeyedArray(prev, next, path, ops);
                return;
            }

            if (!deepEqual(prev, next)) {
                ops.push({ op: 'set', path, value: next });
            }
            return;
        }

        if (isPlainObject(prev) && isPlainObject(next)) {
            for (const key of Object.keys(prev)) {
                if (!Object.prototype.hasOwnProperty.call(next, key)) {
                    ops.push({ op: 'unset', path: [...path, key] });
                }
            }

            for (const key of Object.keys(next)) {
                if (!Object.prototype.hasOwnProperty.call(prev, key)) {
                    ops.push({ op: 'set', path: [...path, key], value: next[key] });
                    continue;
                }

                this.diffValue(prev[key], next[key], [...path, key], ops);
            }
            return;
        }

        if (!deepEqual(prev, next)) {
            ops.push({ op: 'set', path, value: next });
        }
    }

    private diffKeyedArray(
        prev: unknown[],
        next: unknown[],
        path: PathSegment[],
        ops: PatchOp[]
    ): void {
        const prevByKey = this.indexByKey(prev);
        const nextByKey = this.indexByKey(next);

        for (const key of prevByKey.keys()) {
            if (!nextByKey.has(key)) {
                ops.push({ op: 'remove', path, key });
            }
        }

        next.forEach((row, index) => {
            const key = this.keyOf(row)!;
            const before = prevByKey.get(key);

            if (before === undefined || !deepEqual(before, row)) {
                ops.push({ op: 'upsert', path, key, index, value: row });
            }
        });

        const survivingPrevKeys = [...prevByKey.keys()].filter(key => nextByKey.has(key));
        const nextKeys = [...nextByKey.keys()];
        const orderChanged =
            survivingPrevKeys.length !== nextKeys.length ||
            survivingPrevKeys.some((key, i) => key !== nextKeys[i]);

        if (orderChanged) {
            ops.push({ op: 'order', path, keys: nextKeys });
        }
    }

    private isKeyed(value: unknown[]): boolean {
        if (!this.keyField) {
            return false;
        }

        return value.every(item => this.keyOf(item) !== undefined);
    }

    private keyOf(row: unknown): string | number | undefined {
        if (!this.keyField || !isPlainObject(row)) {
            return undefined;
        }

        const value = row[this.keyField];
        return typeof value === 'string' || typeof value === 'number' ? value : undefined;
    }

    private indexByKey(rows: unknown[]): Map<string | number, unknown> {
        const index = new Map<string | number, unknown>();

        for (const row of rows) {
            index.set(this.keyOf(row)!, row);
        }

        return index;
    }

    private applyOne(root: unknown, op: PatchOp): unknown {
        if (op.op === 'set') {
            return this.replaceAt(root, op.path, () => op.value);
        }

        if (op.op === 'unset') {
            const parentPath = op.path.slice(0, -1);
            const key = op.path[op.path.length - 1];

            return this.replaceAt(root, parentPath, current => {
                if (!isPlainObject(current)) {
                    return current;
                }

                const clone = { ...current };
                delete clone[String(key)];
                return clone;
            });
        }

        return this.replaceAt(root, op.path, current => {
            const rows = Array.isArray(current) ? current : [];

            if (op.op === 'remove') {
                return rows.filter(row => this.keyOf(row) !== op.key);
            }

            if (op.op === 'upsert') {
                const index = rows.findIndex(row => this.keyOf(row) === op.key);

                if (index === -1) {
                    const clone = rows.slice();
                    clone.splice(Math.min(op.index, clone.length), 0, op.value);
                    return clone;
                }

                const clone = rows.slice();
                clone[index] = op.value;
                return clone;
            }

            const byKey = new Map(rows.map(row => [this.keyOf(row), row] as const));
            return op.keys.map(key => byKey.get(key)).filter(row => row !== undefined);
        });
    }

    /** Rebuild only the containers along `path`, preserving all other refs. */
    private replaceAt(
        root: unknown,
        path: PathSegment[],
        update: (current: unknown) => unknown
    ): unknown {
        if (path.length === 0) {
            return update(root);
        }

        const [head, ...rest] = path;

        if (Array.isArray(root)) {
            const index = Number(head);
            const clone = root.slice();
            clone[index] = this.replaceAt(root[index], rest, update);
            return clone;
        }

        const base = isPlainObject(root) ? root : {};
        const key = String(head);
        return { ...base, [key]: this.replaceAt(base[key], rest, update) };
    }
}
