import type { LiveEngine } from './LiveEngine';
import type { SocketTransport } from './transport/SocketTransport';
import type { LiveScopeResolver } from './transport/scope-resolver';
import type { LiveScope } from './shared/inputs';
import type { ResourceRegistry } from './resource/ResourceRegistry';

export interface LiveRuntime {
    engine: LiveEngine;
    transport: SocketTransport;
    resolver: LiveScopeResolver;
    scopes: Map<string, LiveScope>;
    /** Connections that have completed their single allowed hello. */
    handshakes: Set<string>;
    /** Needed by prefetch(), which computes without subscribing. */
    resources: ResourceRegistry;
    /**
     * Everything the plugin opened and nothing else knows about: the dedicated
     * LISTEN connections of the Postgres emitter and of the distributed bus,
     * plus the engine's timers.
     */
    dispose?: (() => Promise<void> | void)[];
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

/**
 * Close whatever the plugin opened, then forget the runtime.
 *
 * Dropping the reference alone is not enough: a LISTEN connection is a socket
 * held open by nothing the container can see, so a process that builds and
 * tears down several Carno instances — a test suite, most obviously — runs the
 * database out of client slots.
 */
export async function closeLiveRuntime(): Promise<void> {
    const runtime = current;
    current = null;

    for (const close of runtime?.dispose ?? []) {
        try {
            await close();
        } catch (error) {
            console.error('[carno:live] failed to close a live connection', error);
        }
    }
}

/** Synchronous form. Prefer `closeLiveRuntime()` when you can await. */
export function resetLiveRuntime(): void {
    void closeLiveRuntime();
}
