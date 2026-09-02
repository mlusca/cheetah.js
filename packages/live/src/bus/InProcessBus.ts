import type { InvalidationBus, InvalidationHandler } from './InvalidationBus';
import type { InvalidationEvent } from '../graph/types';

/** Single-process bus. Correct for one node; phase 2 adds the distributed ones. */
export class InProcessBus implements InvalidationBus {
    private readonly handlers = new Set<InvalidationHandler>();

    publish(events: InvalidationEvent[]): void {
        if (events.length === 0) {
            return;
        }

        for (const handler of this.handlers) {
            try {
                handler(events);
            } catch (error) {
                // One broken subscriber must not swallow invalidations for the
                // others: a dropped invalidation is a screen frozen on stale data.
                console.error('[carno:live] invalidation handler failed', error);
            }
        }
    }

    subscribe(handler: InvalidationHandler): () => void {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }
}
