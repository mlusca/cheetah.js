import type { LiveEngine } from './LiveEngine';
import type { SocketTransport } from './transport/SocketTransport';
import type { LiveScopeResolver } from './transport/scope-resolver';
import type { LiveScope } from './shared/inputs';

export interface LiveRuntime {
    engine: LiveEngine;
    transport: SocketTransport;
    resolver: LiveScopeResolver;
    scopes: Map<string, LiveScope>;
}

let current: LiveRuntime | null = null;

/**
 * Process-wide holder, same shape as `Orm.getInstance()`.
 *
 * The gateway is instantiated by the core container, which has no factory
 * providers, so constructor-injecting a hand-built engine would need a
 * registration dance that exists only to satisfy the container.
 */
export function setLiveRuntime(runtime: LiveRuntime): void {
    current = runtime;
}

export function getLiveRuntime(): LiveRuntime {
    if (!current) {
        throw new Error('[carno:live] LivePlugin.create() has not run yet.');
    }

    return current;
}

export function resetLiveRuntime(): void {
    current = null;
}
