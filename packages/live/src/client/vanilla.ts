import { canonical } from '../shared/canonical';
import {
    normalizeLiveInputs,
    resourceIdOf,
    type LiveDataOf,
    type LiveDescriptor,
    type LiveInputsOf
} from '../shared/descriptor';
import type { LiveInputs } from '../shared/inputs';
import type { LiveClient, LiveState, LiveStore } from './core';

/** A subscription held by something that is not a component. */
export interface LiveHandle<T> {
    /** Current state. Valid before, during and after a subscription. */
    get(): LiveState<T>;
    /**
     * Start receiving. The listener fires on every change, never on
     * registration -- read `get()` for the initial value.
     *
     * Returns the same function `close()` calls.
     */
    subscribe(listener: (state: LiveState<T>) => void): () => void;
    /** Release this handle's hold. Other handles on the same data keep theirs. */
    close(): void;
}

/**
 * Resolve a descriptor or a resource id to the underlying store.
 *
 * Framework adapters go through here rather than through `liveStore()`: they
 * already own their own teardown, and wrapping a second lifecycle around the
 * one the framework gives them is how an adapter starts leaking.
 */
export function liveStoreOf(
    client: LiveClient,
    resource: string | LiveDescriptor<any>,
    inputs: Record<string, any> = {}
): LiveStore<unknown> {
    const resourceId = typeof resource === 'string' ? resource : resourceIdOf(resource);

    return client.store(resourceId, normalizeLiveInputs(inputs as Partial<LiveInputs>));
}

/**
 * Canonical identity of a subscription, for adapters that need to know whether
 * reactive inputs actually changed before tearing a subscription down.
 */
export function liveIdentity(
    resource: string | LiveDescriptor<any>,
    inputs: Record<string, any> = {}
): string {
    const resourceId = typeof resource === 'string' ? resource : resourceIdOf(resource);
    const normalized = normalizeLiveInputs(inputs as Partial<LiveInputs>);

    return `${resourceId}|${canonical({
        params: normalized.params,
        query: normalized.query,
        body: normalized.body ?? null
    })}`;
}

export function liveStore<R>(
    client: LiveClient,
    descriptor: LiveDescriptor<R>,
    inputs?: LiveInputsOf<R>
): LiveHandle<LiveDataOf<R>>;
export function liveStore<T>(
    client: LiveClient,
    resourceId: string,
    inputs?: Partial<LiveInputs>
): LiveHandle<T>;

/**
 * Subscribe without a framework.
 *
 * This is the whole vanilla adapter, and it is small on purpose: everything
 * hard -- dedupe, revisions, resync, reconnect, the optimistic stack -- is in
 * the client, and an adapter that grows is logic leaking out of it.
 */
export function liveStore(
    client: LiveClient,
    resource: string | LiveDescriptor<any>,
    // Loose on purpose, and invisible to callers: a descriptor's own `query`
    // type is a plain object, which no index signature accepts. The overloads
    // above are what anyone actually sees.
    inputs: Record<string, any> = {}
): LiveHandle<any> {
    const store = liveStoreOf(client, resource, inputs);
    const drops = new Set<() => void>();

    return {
        get: () => store.getSnapshot(),
        subscribe(listener: (state: LiveState<any>) => void): () => void {
            const drop = store.subscribe(() => listener(store.getSnapshot()));
            drops.add(drop);

            // Idempotent: calling this and then close() must not release the
            // client's refcount twice, or an unrelated handle loses its data.
            return () => {
                if (drops.delete(drop)) {
                    drop();
                }
            };
        },
        close(): void {
            for (const drop of [...drops]) {
                drops.delete(drop);
                drop();
            }
        }
    };
}

const EMPTY_STATE: LiveState<any> = { data: undefined, pending: true, error: null, stale: false };

/**
 * A subscription that points at one target at a time.
 *
 * Reactive frameworks re-run an expression when its inputs change, and for a
 * live subscription that means "this component now wants a different instance".
 * The rule that makes that safe has nothing to do with any framework, so it
 * lives here: recomputing to the same inputs must not churn the subscription,
 * and switching targets must release the old one *before* retaining the new
 * one. Holding both across the switch is how a dragged filter walks a
 * connection into `maxInstancesPerConnection`.
 */
export class LiveSlot<T> {
    private identity: string | null = null;
    private release: (() => void) | null = null;
    private store: LiveStore<unknown> | null = null;

    constructor(
        private readonly client: LiveClient,
        private readonly onState: (state: LiveState<T>) => void
    ) {}

    point(resource: string | LiveDescriptor<any>, inputs: Record<string, any> = {}): void {
        const next = liveIdentity(resource, inputs);

        if (next === this.identity) {
            return;
        }

        this.release?.();
        this.release = null;

        this.identity = next;
        this.store = liveStoreOf(this.client, resource, inputs);

        const store = this.store;
        this.release = store.subscribe(() => this.onState(store.getSnapshot() as LiveState<T>));
        this.onState(store.getSnapshot() as LiveState<T>);
    }

    get(): LiveState<T> {
        return (this.store?.getSnapshot() as LiveState<T> | undefined) ?? EMPTY_STATE;
    }

    close(): void {
        this.release?.();
        this.release = null;
        this.store = null;
        this.identity = null;
    }
}
