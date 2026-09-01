import type { InvalidationEvent } from '../graph/types';

export type InvalidationHandler = (events: InvalidationEvent[]) => void;

/**
 * Carries invalidations from an emitter to the nodes holding subscriptions.
 *
 * The graph does not care where an invalidation came from, which is why the
 * ORM emitter, the Postgres emitter and manual invalidation are three
 * implementations feeding one interface. Phase 1 ships the in-process one;
 * Redis and pg_notify buses arrive in phase 2 without touching the graph.
 */
export interface InvalidationBus {
    publish(events: InvalidationEvent[]): void;
    /** Returns an unsubscribe function. */
    subscribe(handler: InvalidationHandler): () => void;
}
