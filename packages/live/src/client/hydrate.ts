import type { LivePayload } from '../resource/prefetch';
import { storeKey } from './core';

/** Attribute the island helper marks its payload scripts with. */
export const HYDRATION_ATTRIBUTE = 'data-carno-live';

/** Exactly the key `LiveClient.store()` will look up. */
export function hydrationKey(payload: LivePayload): string {
    return storeKey(payload.resourceId, payload.inputs);
}

export function toHydrateMap(payloads: LivePayload[]): Record<string, { data: unknown; hash: string }> {
    const map: Record<string, { data: unknown; hash: string }> = {};

    for (const payload of payloads) {
        map[hydrationKey(payload)] = { data: payload.data, hash: payload.hash };
    }

    return map;
}

/**
 * Collect every island payload the server embedded in the page.
 *
 * A malformed one is skipped rather than thrown: one broken island must not
 * cost the page every other island's first paint.
 */
export function readHydrationPayload(
    root: ParentNode = document
): Record<string, { data: unknown; hash: string }> {
    const payloads: LivePayload[] = [];

    for (const node of root.querySelectorAll(`script[${HYDRATION_ATTRIBUTE}]`)) {
        try {
            payloads.push(JSON.parse(node.textContent ?? '') as LivePayload);
        } catch {
            // Skip it. The client will fetch that one instead.
        }
    }

    return toHydrateMap(payloads);
}
