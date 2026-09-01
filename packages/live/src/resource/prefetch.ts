import { canonical } from '../shared/canonical';
import { normalizeLiveInputs } from '../shared/descriptor';
import { fnv1a64 } from '../shared/hash';
import type { LiveInputs } from '../shared/inputs';
import type { ResourceRegistry } from './ResourceRegistry';

/** What a server-rendered page hands the client so the first paint is full. */
export interface LivePayload {
    resourceId: string;
    inputs: LiveInputs;
    data: unknown;
    hash: string;
}

/**
 * Compute a live resource once, for the first paint.
 *
 * Deliberately not a subscription: nothing is registered in the dependency
 * graph and no instance is created. Every rendered page would otherwise leave
 * behind an instance being recomputed forever, including the ones nobody ever
 * subscribes to -- the worst possible cost for the most common case. The
 * instance is born when a client subscribes, and the hash returned here is
 * what makes that subscription carry no data.
 */
export async function prefetchLive(
    resources: ResourceRegistry,
    resourceId: string,
    inputs: Partial<LiveInputs> = {}
): Promise<LivePayload> {
    const resource = resources.get(resourceId);

    if (!resource) {
        throw new Error(
            `[carno:live] cannot prefetch "${resourceId}": no live resource by that name. ` +
            `Is its controller listed in LivePlugin.create({ controllers })?`
        );
    }

    const normalized = normalizeLiveInputs(inputs);
    const { data } = await resources.compute(resource, normalized);

    return {
        resourceId,
        inputs: normalized,
        data,
        hash: fnv1a64(canonical(data))
    };
}
