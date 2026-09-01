/**
 * Instance ↔ connection index with per-pair refcounting.
 *
 * The refcount is per (connection, instance) pair because one page can mount
 * two components bound to the same resource with the same inputs: unmounting
 * one must not unsubscribe the other.
 */
export class SubscriptionRegistry {
    private readonly byInstance = new Map<string, Map<string, number>>();
    private readonly byConnection = new Map<string, Set<string>>();

    /** Returns the connection's refcount on this instance after the call. */
    subscribe(connectionId: string, instanceId: string): number {
        let holders = this.byInstance.get(instanceId);
        if (!holders) {
            holders = new Map<string, number>();
            this.byInstance.set(instanceId, holders);
        }

        const next = (holders.get(connectionId) ?? 0) + 1;
        holders.set(connectionId, next);

        let owned = this.byConnection.get(connectionId);
        if (!owned) {
            owned = new Set<string>();
            this.byConnection.set(connectionId, owned);
        }
        owned.add(instanceId);

        return next;
    }

    /** Returns the connection's refcount on this instance after the call. */
    unsubscribe(connectionId: string, instanceId: string): number {
        const holders = this.byInstance.get(instanceId);
        const current = holders?.get(connectionId) ?? 0;

        if (!holders || current === 0) {
            return 0;
        }

        const next = current - 1;

        if (next === 0) {
            holders.delete(connectionId);
            const owned = this.byConnection.get(connectionId);
            owned?.delete(instanceId);

            if (owned?.size === 0) {
                this.byConnection.delete(connectionId);
            }

            if (holders.size === 0) {
                this.byInstance.delete(instanceId);
            }
        } else {
            holders.set(connectionId, next);
        }

        return next;
    }

    /** Drop the connection; returns instances now left with no subscriber. */
    dropConnection(connectionId: string): string[] {
        const owned = this.byConnection.get(connectionId);

        if (!owned) {
            return [];
        }

        const orphaned: string[] = [];

        for (const instanceId of owned) {
            const holders = this.byInstance.get(instanceId);

            if (!holders) {
                continue;
            }

            holders.delete(connectionId);

            if (holders.size === 0) {
                this.byInstance.delete(instanceId);
                orphaned.push(instanceId);
            }
        }

        this.byConnection.delete(connectionId);

        return orphaned;
    }

    connectionsOf(instanceId: string): string[] {
        return [...(this.byInstance.get(instanceId)?.keys() ?? [])];
    }

    hasSubscribers(instanceId: string): boolean {
        return this.byInstance.has(instanceId);
    }

    /** Distinct instances held by the connection — the per-connection ceiling. */
    countForConnection(connectionId: string): number {
        return this.byConnection.get(connectionId)?.size ?? 0;
    }

    instanceCount(): number {
        return this.byInstance.size;
    }
}
