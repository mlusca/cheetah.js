import { Service } from '@carno.js/core';

/**
 * Tracks the number of active WebSocket connections per namespace.
 * Automatically updated by `WebSocketPlugin` on open/close events.
 *
 * Can be injected into any service or controller to query connection counts.
 *
 * @example
 * ```ts
 * @Service()
 * class StatsService {
 *   constructor(private readonly registry: NamespaceRegistry) {}
 *
 *   getStats() {
 *     return {
 *       namespaces: this.registry.getNamespaces(),
 *       total: this.registry.getTotalConnections(),
 *     };
 *   }
 * }
 * ```
 */
@Service()
export class NamespaceRegistry {
    private readonly counts = new Map<string, number>();

    /** @internal - Called by WebSocketPlugin on socket open */
    _increment(namespace: string): void {
        this.counts.set(namespace, (this.counts.get(namespace) ?? 0) + 1);
    }

    /** @internal - Called by WebSocketPlugin on socket close */
    _decrement(namespace: string): void {
        const current = this.counts.get(namespace) ?? 0;
        if (current > 0) {
            this.counts.set(namespace, current - 1);
        }
    }

    /** Returns the number of active connections for the given namespace. */
    getCount(namespace: string): number {
        return this.counts.get(namespace) ?? 0;
    }

    /** Returns all namespaces that currently have at least one connection. */
    getNamespaces(): string[] {
        return [...this.counts.entries()]
            .filter(([, count]) => count > 0)
            .map(([ns]) => ns);
    }

    /** Returns the total number of active WebSocket connections across all namespaces. */
    getTotalConnections(): number {
        let total = 0;
        for (const count of this.counts.values()) {
            total += count;
        }
        return total;
    }
}
