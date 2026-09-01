import {
    DestroyRef,
    InjectionToken,
    Injector,
    computed,
    effect,
    inject,
    signal,
    type Provider,
    type Signal
} from '@angular/core';
import type { LiveDataOf, LiveDescriptor, LiveInputsOf } from '../shared/descriptor';
import type { LiveClient, LiveState } from './core';
import { LiveSlot } from './vanilla';

/** How a component finds the client without every call site passing it. */
export const LIVE_CLIENT = new InjectionToken<LiveClient>('carno.live.client');

export function provideLive(client: LiveClient): Provider {
    return { provide: LIVE_CLIENT, useValue: client };
}

export interface LiveSignalOptions {
    /** Overrides the injected client. Mostly for tests and for multi-backend apps. */
    client?: LiveClient;
    /** Required when calling outside an injection context. */
    injector?: Injector;
}

const PENDING: LiveState<any> = { data: undefined, pending: true, error: null, stale: false };

const reconcilers = new WeakMap<object, () => void>();

/**
 * The function production `effect()` calls. bun:test has no EffectScheduler,
 * so tests invoke this in place of `TestBed.flushEffects()`.
 */
export function reconcileLiveSignal(state: object): void {
    const reconcile = reconcilers.get(state);

    if (!reconcile) {
        throw new Error('reconcileLiveSignal() expected a liveSignal() state');
    }

    reconcile();
}

export function liveSignal<R>(
    descriptor: LiveDescriptor<R>,
    inputs?: () => LiveInputsOf<R>,
    options?: LiveSignalOptions
): Signal<LiveState<LiveDataOf<R>>>;
export function liveSignal<T>(
    resourceId: string,
    inputs?: () => Record<string, any>,
    options?: LiveSignalOptions
): Signal<LiveState<T>>;

/**
 * Subscribe a component to server-owned state, as a signal.
 *
 * `inputs` is read reactively, so changing a signal it touches re-points the
 * subscription and cancels the previous one. Teardown is `DestroyRef`, so
 * there is nothing to unsubscribe by hand, and nothing here touches zone.js.
 */
export function liveSignal(
    resource: string | LiveDescriptor<any>,
    inputs: () => Record<string, any> = () => ({}),
    options: LiveSignalOptions = {}
): Signal<LiveState<any>> {
    const client = options.client ?? inject(LIVE_CLIENT);
    const destroyRef = options.injector
        ? options.injector.get(DestroyRef)
        : inject(DestroyRef);

    const state = signal<LiveState<any>>(PENDING);
    const slot = new LiveSlot<any>(client, next => state.set(next));

    // A computed, not a raw call: the effect below then re-runs only when the
    // inputs actually recompute to something different, and LiveSlot ignores
    // the ones that recompute to the same thing.
    const target = computed(() => inputs());

    function reconcile(): void {
        slot.point(resource, target());
    }

    try {
        effect(() => reconcile(), options.injector ? { injector: options.injector } : undefined);
    } catch {
        // bun:test has no EffectScheduler. Production Angular always does.
    }

    destroyRef.onDestroy(() => slot.close());

    const output = state.asReadonly();
    reconcilers.set(output, reconcile);

    return output;
}
