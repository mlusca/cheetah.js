import { ancestorsOf, type DepKey } from './dep-key';
import type { Dependency, InvalidationEvent } from './types';

/** Column sets registered per instance under one key. null means wildcard. */
type ColumnSet = Set<string> | null;

/**
 * Key ↔ instance index with ancestor resolution and column filtering.
 *
 * Knows nothing about WebSocket, the ORM, or resources — it is a pure data
 * structure, which is why the hard part of invalidation is testable without
 * a server, a database or a socket.
 */
export class DependencyGraph {
    private readonly byKey = new Map<DepKey, Map<string, ColumnSet>>();
    private readonly byInstance = new Map<string, Set<DepKey>>();

    /** Replace every dependency held by this instance. */
    setDependencies(instanceId: string, deps: Dependency[]): void {
        this.remove(instanceId);

        if (deps.length === 0) {
            return;
        }

        const keys = new Set<DepKey>();

        for (const dep of deps) {
            keys.add(dep.key);

            let holders = this.byKey.get(dep.key);
            if (!holders) {
                holders = new Map<string, ColumnSet>();
                this.byKey.set(dep.key, holders);
            }

            if (!holders.has(instanceId)) {
                holders.set(instanceId, dep.columns === null ? null : new Set(dep.columns));
                continue;
            }

            const existing = holders.get(instanceId)!;

            if (existing === null) {
                continue;
            }

            if (dep.columns === null) {
                holders.set(instanceId, null);
                continue;
            }

            for (const column of dep.columns) {
                existing.add(column);
            }
        }

        this.byInstance.set(instanceId, keys);
    }

    /** Forget the instance entirely. */
    remove(instanceId: string): void {
        const keys = this.byInstance.get(instanceId);

        if (!keys) {
            return;
        }

        for (const key of keys) {
            const holders = this.byKey.get(key);

            if (!holders) {
                continue;
            }

            holders.delete(instanceId);

            if (holders.size === 0) {
                this.byKey.delete(key);
            }
        }

        this.byInstance.delete(instanceId);
    }

    /**
     * Instances concerned by this write.
     *
     * Both directions of the hierarchy matter. A row write wakes table
     * subscribers, while a table write wakes row subscribers because a
     * predicate write may have touched that row.
     */
    resolve(event: InvalidationEvent): string[] {
        const matched = new Set<string>();

        for (const key of ancestorsOf(event.key)) {
            this.collect(key, event.columns, matched);
        }

        const descendantPrefix = `${event.key}#`;
        if (!event.key.includes('#')) {
            for (const key of this.byKey.keys()) {
                if (key.startsWith(descendantPrefix)) {
                    this.collect(key, event.columns, matched);
                }
            }
        }

        return [...matched];
    }

    keyCount(): number {
        return this.byKey.size;
    }

    instanceCount(): number {
        return this.byInstance.size;
    }

    private collect(key: DepKey, writtenColumns: string[] | null, into: Set<string>): void {
        const holders = this.byKey.get(key);

        if (!holders) {
            return;
        }

        for (const [instanceId, readColumns] of holders) {
            if (intersects(readColumns, writtenColumns)) {
                into.add(instanceId);
            }
        }
    }
}

function intersects(readColumns: Set<string> | null, writtenColumns: string[] | null): boolean {
    if (readColumns === null || writtenColumns === null) {
        return true;
    }

    for (const column of writtenColumns) {
        if (readColumns.has(column)) {
            return true;
        }
    }

    return false;
}
