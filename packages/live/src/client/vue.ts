import {
    computed,
    getCurrentInstance,
    inject,
    onScopeDispose,
    provide,
    shallowRef,
    watchEffect,
    type InjectionKey,
    type ShallowRef
} from 'vue';
import type { LiveDataOf, LiveDescriptor, LiveInputsOf } from '../shared/descriptor';
import type { LiveClient, LiveState } from './core';
import { LiveSlot } from './vanilla';

export const LIVE_CLIENT_KEY: InjectionKey<LiveClient> = Symbol('carno.live.client');

/** Call once, high in the tree. Every useLiveQuery() below it finds the client. */
export function provideLiveClient(client: LiveClient): void {
    provide(LIVE_CLIENT_KEY, client);
}

const PENDING: LiveState<any> = { data: undefined, pending: true, error: null, stale: false };

export function useLiveQuery<R>(
    descriptor: LiveDescriptor<R>,
    inputs?: () => LiveInputsOf<R>,
    options?: { client?: LiveClient }
): ShallowRef<LiveState<LiveDataOf<R>>>;
export function useLiveQuery<T>(
    resourceId: string,
    inputs?: () => Record<string, any>,
    options?: { client?: LiveClient }
): ShallowRef<LiveState<T>>;

/**
 * Subscribe a component to server-owned state, as a shallow ref.
 *
 * Shallow because the server replaces the whole snapshot and nothing ever
 * writes into it: a deep proxy would pay to track mutations that cannot
 * happen. `inputs` is read inside a watchEffect, so a ref it touches
 * re-points the subscription; the effect scope tears it down.
 */
export function useLiveQuery(
    resource: string | LiveDescriptor<any>,
    inputs: () => Record<string, any> = () => ({}),
    options: { client?: LiveClient } = {}
): ShallowRef<LiveState<any>> {
    const client = options.client
        ?? (getCurrentInstance() ? inject(LIVE_CLIENT_KEY, undefined) : undefined);

    if (!client) {
        throw new Error(
            'useLiveQuery() found no LiveClient. Call provideLiveClient(client) in an ancestor ' +
            'component, or pass { client } explicitly.'
        );
    }

    const state = shallowRef<LiveState<any>>(PENDING);
    const slot = new LiveSlot<any>(client, next => { state.value = next; });
    const target = computed(() => inputs());

    watchEffect(() => slot.point(resource, target.value));
    onScopeDispose(() => slot.close());

    return state;
}
