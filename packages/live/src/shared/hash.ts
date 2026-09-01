const FNV_OFFSET_BASIS_A = 2166136261;
const FNV_OFFSET_BASIS_B = 0x9e3779b9;
const FNV_PRIME = 16777619;

/**
 * FNV-1a widened to 64 output bits by running two lanes with different offset
 * bases, the second one position-sensitive.
 *
 * `packages/orm/src/cache/cache-key-generator.ts` uses the 32-bit variant,
 * which is right for a cache — a collision there costs one stale entry. Here a
 * content-hash collision means "data changed but no patch was sent", and 32
 * bits reach 50% collision odds around 65k keys while `maxInstancesPerNode`
 * alone is 50000. This lives in one module so it can be swapped for a stronger
 * hash without touching anything else.
 */
export function fnv1a64(input: string): string {
    let laneA = FNV_OFFSET_BASIS_A;
    let laneB = FNV_OFFSET_BASIS_B;

    for (let i = 0; i < input.length; i++) {
        const code = input.charCodeAt(i);

        laneA ^= code;
        laneA = Math.imul(laneA, FNV_PRIME);

        laneB ^= code + i;
        laneB = Math.imul(laneB, FNV_PRIME);
    }

    return (laneA >>> 0).toString(16).padStart(8, '0') + (laneB >>> 0).toString(16).padStart(8, '0');
}
