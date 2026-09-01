import type { LiveInputs } from './inputs';

/**
 * Structural twin of the descriptor @carno.js/client emits.
 *
 * The generated file imports nothing, on purpose, so the two definitions meet
 * through TypeScript's structural typing. Keep the field names identical.
 */
export interface LiveDescriptor<R = unknown> {
    readonly method: string;
    readonly path: string;
    readonly resourceId?: string;
    readonly live?: { readonly shared: 'private' | 'tenant' | 'public'; readonly key?: string };
    readonly __route?: R;
}

/** What the route answers, as the client sees it. */
export type LiveDataOf<R> = R extends { response: infer S } ? Exclude<S, undefined | void> : unknown;

/** What the route takes, as a subscription sends it. */
export type LiveInputsOf<R> =
    (R extends { params: infer P } ? { params: P } : { params?: Record<string, string> })
    & (R extends { query: infer Q } ? { query: Q } : { query?: Record<string, string | string[]> })
    & (R extends { body: infer B } ? { body: B } : { body?: undefined });

export function resourceIdOf(descriptor: LiveDescriptor<any>): string {
    if (!descriptor.resourceId || !descriptor.live) {
        throw new Error(
            `${descriptor.method.toUpperCase()} ${descriptor.path} is not a live resource. ` +
            `Add @Live() to the handler and re-run the client codegen.`
        );
    }

    return descriptor.resourceId;
}

/** Fill the three input slots, whichever of them the caller bothered with. */
export function normalizeLiveInputs(inputs: Partial<LiveInputs> = {}): LiveInputs {
    return {
        params: inputs.params ?? {},
        query: inputs.query ?? {},
        body: inputs.body
    };
}
