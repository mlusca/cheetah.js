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
import type { LiveInputs } from '../shared/inputs';
import type { LiveClient, LiveState } from './core';

export const LiveContext = createContext<LiveClient | null>(null);

export function LiveProvider(props: { client: LiveClient; children?: ReactNode }): ReactElement {
    return createElement(LiveContext.Provider, { value: props.client }, props.children);
}

/**
 * Subscribe a component to server-owned state.
 *
 * The component keeps its own local state next to this — selected row, open
 * modal, focused input. None of that travels; only the server's data does.
 */
export function useLive<T>(resource: string, inputs: Partial<LiveInputs> = {}): LiveState<T> {
    const client = useContext(LiveContext);

    if (!client) {
        throw new Error('useLive() requires a <LiveProvider client={...}> above it in the tree.');
    }

    const params = inputs.params ?? {};
    const query = inputs.query ?? {};
    const identity = canonical({ params, query });

    // Depend on the canonical form, not on the object: a new literal every
    // render would resubscribe on every render.
    const normalized = useMemo(() => ({ params, query }), [identity]);
    const store = useMemo(() => client.store<T>(resource, normalized), [client, resource, normalized]);

    return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
