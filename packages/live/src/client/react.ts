import {
    createContext,
    createElement,
    useContext,
    useMemo,
    useSyncExternalStore,
    type ReactElement,
    type ReactNode
} from 'react';
import { canonical } from '../shared/canonical';
import {
    normalizeLiveInputs,
    resourceIdOf,
    type LiveDataOf,
    type LiveDescriptor,
    type LiveInputsOf
} from '../shared/descriptor';
import type { LiveInputs } from '../shared/inputs';
import type { LiveClient, LiveState } from './core';

export const LiveContext = createContext<LiveClient | null>(null);

export function LiveProvider(props: { client: LiveClient; children?: ReactNode }): ReactElement {
    return createElement(LiveContext.Provider, { value: props.client }, props.children);
}

export function useLive<T>(resource: string, inputs?: Partial<LiveInputs>): LiveState<T>;
export function useLive<R>(
    descriptor: LiveDescriptor<R>,
    inputs?: LiveInputsOf<R>
): LiveState<LiveDataOf<R>>;

/**
 * Subscribe a component to server-owned state.
 *
 * The component keeps its own local state next to this — selected row, open
 * modal, focused input. None of that travels; only the server's data does.
 */
export function useLive(
    resource: string | LiveDescriptor<any>,
    inputs: Partial<LiveInputs> = {}
): LiveState<any> {
    const client = useContext(LiveContext);

    if (!client) {
        throw new Error('useLive() requires a <LiveProvider client={...}> above it in the tree.');
    }

    const resourceId = typeof resource === 'string' ? resource : resourceIdOf(resource);
    const normalized = normalizeLiveInputs(inputs);
    const identity = canonical({
        params: normalized.params,
        query: normalized.query,
        body: normalized.body ?? null
    });

    // Depend on the canonical form, not on the object: a new literal every
    // render would resubscribe on every render.
    const stable = useMemo(() => normalized, [identity]);
    const store = useMemo(() => client.store(resourceId, stable), [client, resourceId, stable]);

    return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
