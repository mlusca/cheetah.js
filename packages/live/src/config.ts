/**
 * Tunables from §10.1 of the design. These are starting points to calibrate
 * against the recompute-without-patch metric, not measured values.
 */
export interface LiveConfig {
    /** Window in ms over which invalidations for one instance are grouped. */
    coalesceMs: number;
    /** Above this many row keys, one read collapses to its table key. */
    maxKeysPerRead: number;
    /** Ceiling on the canonicalized inputs of a single subscription. */
    maxInputBytes: number;
    /** Grace period before dropping an instance whose refcount hit zero. */
    unsubGraceMs: number;
    /** Consecutive back-pressured sends before collapsing to a snapshot. */
    maxPendingPatches: number;
    /** Above this fan-out, recompute is queued instead of run inline. */
    fanoutQueueThreshold: number;
    /** Ceiling on live instances held by a single connection. */
    maxInstancesPerConnection: number;
    /** Ceiling on live instances held by this process. */
    maxInstancesPerNode: number;
    /** Path of the SSE downstream, when the SSE transport is on. */
    ssePath: string;
    /** Path client messages are posted to, when the SSE transport is on. */
    sseControlPath: string;
    /** Comment frame interval that keeps idle-timeout proxies from reaping. */
    sseHeartbeatMs: number;
    /** Ceiling on concurrent SSE streams held by this process. */
    sseMaxConnections: number;
}

export const DEFAULT_LIVE_CONFIG: LiveConfig = {
    coalesceMs: 16,
    maxKeysPerRead: 64,
    maxInputBytes: 8192,
    unsubGraceMs: 5000,
    maxPendingPatches: 32,
    fanoutQueueThreshold: 500,
    maxInstancesPerConnection: 64,
    maxInstancesPerNode: 50000,
    ssePath: '/live/sse',
    sseControlPath: '/live/control',
    sseHeartbeatMs: 15000,
    sseMaxConnections: 10000
};

export function resolveLiveConfig(overrides: Partial<LiveConfig> = {}): LiveConfig {
    return { ...DEFAULT_LIVE_CONFIG, ...overrides };
}
