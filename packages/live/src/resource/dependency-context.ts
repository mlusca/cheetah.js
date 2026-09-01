import { AsyncLocalStorage } from 'async_hooks';
import type { Dependency } from '../graph/types';

export class DependencyCollector {
    private readonly deps: Dependency[] = [];

    add(dep: Dependency): void {
        this.deps.push(dep);
    }

    addAll(deps: Dependency[]): void {
        for (const dep of deps) {
            this.deps.push(dep);
        }
    }

    drain(): Dependency[] {
        return this.deps.slice();
    }
}

/**
 * Collects the reads performed during one resource compute.
 *
 * Same AsyncLocalStorage shape as identityMapContext, tenantContext and
 * transactionContext in @carno.js/orm — concurrent computes each get their own
 * collector without threading a parameter through user code.
 */
class DependencyContext {
    private readonly storage = new AsyncLocalStorage<DependencyCollector>();

    async run<T>(fn: (collector: DependencyCollector) => Promise<T> | T): Promise<{ result: T; deps: Dependency[] }> {
        const collector = new DependencyCollector();
        const result = await this.storage.run(collector, async () => fn(collector));

        return { result, deps: collector.drain() };
    }

    current(): DependencyCollector | undefined {
        return this.storage.getStore();
    }

    isActive(): boolean {
        return this.storage.getStore() !== undefined;
    }
}

export const dependencyContext = new DependencyContext();
