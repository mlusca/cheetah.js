import type { LiveDataOf, LiveDescriptor } from '../shared/descriptor';

/**
 * One optimistic projection: which resource it targets, and how the action's
 * payload changes it.
 *
 * `on` is what makes `draft` typed. Without naming the target, the draft would
 * have to be `any`, and an optimistic update on `any` is a guess the compiler
 * cannot check.
 */
export interface OptimisticEntry<Target, Dto> {
    on: Target;
    apply: (draft: LiveDataOf<Target extends LiveDescriptor<infer R> ? R : never>, dto: Dto) => void;
}

/** Maps a tuple of descriptors to the matching tuple of optimistic entries. */
export type OptimisticList<Targets extends readonly unknown[], Dto> = {
    [K in keyof Targets]: OptimisticEntry<Targets[K], Dto>;
};
