import {
    createContext,
    createElement,
    useCallback,
    useContext,
    useMemo,
    useRef,
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
import type { OptimisticList } from './optimistic';

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
    // Loose on purpose, and invisible to callers: a descriptor's own `query`
    // type is a plain object, which no index signature accepts. The overloads
    // above are what anyone actually sees.
    inputs: Record<string, any> = {}
): LiveState<any> {
    const client = useContext(LiveContext);

    if (!client) {
        throw new Error('useLive() requires a <LiveProvider client={...}> above it in the tree.');
    }

    const resourceId = typeof resource === 'string' ? resource : resourceIdOf(resource);
    const normalized = normalizeLiveInputs(inputs as Partial<LiveInputs>);
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

/**
 * Run an action, showing its expected effect immediately.
 *
 * The overlay lives above the confirmed snapshot, so a server patch arriving
 * mid-flight lands underneath it and nothing flickers. It is removed when the
 * action settles, either way.
 */
export function useLiveAction<
    Dto,
    Result,
    const Targets extends readonly LiveDescriptor<any>[]
>(
    action: (dto: Dto) => Promise<Result>,
    options: { optimistic?: OptimisticList<Targets, Dto> } = {}
): (dto: Dto) => Promise<Result> {
    const client = useContext(LiveContext);

    if (!client) {
        throw new Error('useLiveAction() requires a <LiveProvider client={...}> above it in the tree.');
    }

    // The array is a fresh literal on every render; a ref keeps the returned
    // function stable without making the dependency list lie.
    const specs = useRef<readonly { on: LiveDescriptor<any>; apply: (draft: any, dto: Dto) => void }[]>([]);
    specs.current = (options.optimistic ?? []) as readonly {
        on: LiveDescriptor<any>;
        apply: (draft: any, dto: Dto) => void;
    }[];

    return useCallback(async (dto: Dto): Promise<Result> => {
        const remove = specs.current.map(spec =>
            client.overlay(resourceIdOf(spec.on), draft => spec.apply(draft, dto))
        );

        try {
            return await action(dto);
        } finally {
            for (const drop of remove) {
                drop();
            }
        }
    }, [client, action]);
}
