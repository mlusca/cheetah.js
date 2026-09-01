import type { InvalidationBus } from './bus/InvalidationBus';
import type { LiveConfig } from './config';
import { DependencyGraph } from './graph/DependencyGraph';
import { SubscriptionRegistry } from './graph/SubscriptionRegistry';
import type { InvalidationEvent } from './graph/types';
import { PatchEngine } from './patch/PatchEngine';
import { canonical } from './shared/canonical';
import { fnv1a64 } from './shared/hash';
import type { ServerMessage } from './shared/protocol';
import {
    canonicalInputs,
    instanceIdOf,
    scopeKeyOf
} from './resource/instance-id';
import type { ResourceRegistry } from './resource/ResourceRegistry';
import type { LiveInputs, LiveResource, LiveScope } from './resource/types';

export interface LiveTransport {
    /**
     * Send one message. The return value is the underlying socket's: Bun's
     * `ServerWebSocket.send()` answers -1 under back-pressure and 0 when the
     * message was dropped. Anything <= 0 counts as back-pressure here.
     */
    send(connectionId: string, message: ServerMessage): number;
}

export interface LiveStats {
    instances: number;
    recomputes: number;
    /**
     * Recomputes that produced no patch. The most important number in the
     * system: it measures the precision of the invalidation granularity
     * directly. Climbing means the graph is waking instances for nothing.
     */
    recomputesWithoutPatch: number;
}

interface LiveInstance {
    id: string;
    resource: LiveResource;
    inputs: LiveInputs;
    patcher: PatchEngine;
    data: unknown;
    hash: string;
    revision: number;
    computing: Promise<void> | null;
    dirty: boolean;
    dropTimer: ReturnType<typeof setTimeout> | null;
}

export class LiveEngine {
    private readonly instances = new Map<string, LiveInstance>();
    /** connectionId → sid → instanceId. Addressing only; refcount lives in the registry. */
    private readonly bindings = new Map<string, Map<string, string>>();
    private readonly backpressure = new Map<string, number>();
    private readonly pending = new Set<string>();

    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private unsubscribeBus: (() => void) | null = null;
    private recomputes = 0;
    private recomputesWithoutPatch = 0;

    constructor(
        private readonly resources: ResourceRegistry,
        private readonly graph: DependencyGraph,
        private readonly subs: SubscriptionRegistry,
        private readonly bus: InvalidationBus,
        private readonly transport: LiveTransport,
        private readonly config: LiveConfig
    ) {}

    start(): void {
        if (this.unsubscribeBus) {
            return;
        }

        this.unsubscribeBus = this.bus.subscribe(events => this.onInvalidation(events));
    }

    stop(): void {
        this.unsubscribeBus?.();
        this.unsubscribeBus = null;

        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }

        for (const instance of this.instances.values()) {
            if (instance.dropTimer) {
                clearTimeout(instance.dropTimer);
            }
        }
    }

    async subscribe(
        connectionId: string,
        sid: string,
        resourceId: string,
        inputs: LiveInputs,
        scope: LiveScope,
        clientHash?: string
    ): Promise<void> {
        const resource = this.resources.get(resourceId);

        if (!resource) {
            this.fail(connectionId, sid, 'unknown_resource', `No live resource named "${resourceId}".`);
            return;
        }

        let instanceId: string;

        try {
            const scopeKey = scopeKeyOf(resource.meta.shared, scope);
            instanceId = instanceIdOf(resource.id, scopeKey, canonicalInputs(inputs, this.config.maxInputBytes));
        } catch (error) {
            this.fail(connectionId, sid, 'invalid_subscription', (error as Error).message);
            return;
        }

        const known = this.instances.has(instanceId);
        const heldByConnection = this.subs.countForConnection(connectionId);

        if (!this.bindings.get(connectionId)?.has(sid) && heldByConnection >= this.config.maxInstancesPerConnection) {
            this.fail(
                connectionId,
                sid,
                'too_many_instances',
                `A connection may hold at most ${this.config.maxInstancesPerConnection} live instances.`
            );
            return;
        }

        if (!known && this.instances.size >= this.config.maxInstancesPerNode) {
            this.fail(connectionId, sid, 'node_at_capacity', 'This node is at its live instance ceiling.');
            return;
        }

        const previous = this.bindings.get(connectionId)?.get(sid);

        if (previous !== instanceId) {
            if (previous !== undefined) {
                this.release(connectionId, sid);
            }

            this.bind(connectionId, sid, instanceId);
            this.subs.subscribe(connectionId, instanceId);
        }

        let instance = this.instances.get(instanceId);

        if (instance?.dropTimer) {
            clearTimeout(instance.dropTimer);
            instance.dropTimer = null;
        }

        if (!instance) {
            try {
                instance = await this.createInstance(instanceId, resource, inputs);
            } catch (error) {
                this.release(connectionId, sid);
                this.fail(connectionId, sid, 'compute_failed', (error as Error).message);
                return;
            }
        }

        if (this.bindings.get(connectionId)?.get(sid) !== instanceId) {
            this.scheduleDrop(instanceId);
            return;
        }

        this.sendState(connectionId, sid, instance, clientHash);
    }

    unsubscribe(connectionId: string, sid: string): void {
        this.release(connectionId, sid);
    }

    async resync(connectionId: string, sid: string, clientHash?: string): Promise<void> {
        const instanceId = this.bindings.get(connectionId)?.get(sid);
        const instance = instanceId ? this.instances.get(instanceId) : undefined;

        if (!instance) {
            this.fail(connectionId, sid, 'unknown_subscription', 'Resync for a subscription this node does not hold.');
            return;
        }

        this.sendState(connectionId, sid, instance, clientHash);
    }

    dropConnection(connectionId: string): void {
        const owned = this.bindings.get(connectionId);

        if (owned) {
            for (const sid of [...owned.keys()]) {
                this.release(connectionId, sid);
            }
        }

        this.bindings.delete(connectionId);
        this.backpressure.delete(connectionId);
    }

    /** Manual invalidation — the third emitter of §4.4. */
    invalidate(key: string): void {
        this.bus.publish([{ key, columns: null }]);
    }

    stats(): LiveStats {
        return {
            instances: this.instances.size,
            recomputes: this.recomputes,
            recomputesWithoutPatch: this.recomputesWithoutPatch
        };
    }

    // ------------------------------------------------------------ internals

    private bind(connectionId: string, sid: string, instanceId: string): void {
        let owned = this.bindings.get(connectionId);

        if (!owned) {
            owned = new Map<string, string>();
            this.bindings.set(connectionId, owned);
        }

        owned.set(sid, instanceId);
    }

    private release(connectionId: string, sid: string): void {
        const owned = this.bindings.get(connectionId);
        const instanceId = owned?.get(sid);

        if (!owned || !instanceId) {
            return;
        }

        owned.delete(sid);
        this.subs.unsubscribe(connectionId, instanceId);
        this.scheduleDrop(instanceId);
    }

    private scheduleDrop(instanceId: string): void {
        if (this.subs.hasSubscribers(instanceId)) {
            return;
        }

        const instance = this.instances.get(instanceId);

        if (!instance || instance.dropTimer) {
            return;
        }

        // Grace period so coming back from a navigation does not recompute
        // everything the page had a moment ago.
        instance.dropTimer = setTimeout(() => {
            if (!this.subs.hasSubscribers(instanceId)) {
                this.instances.delete(instanceId);
                this.graph.remove(instanceId);
            }
        }, this.config.unsubGraceMs);
    }

    private async createInstance(
        instanceId: string,
        resource: LiveResource,
        inputs: LiveInputs
    ): Promise<LiveInstance> {
        const { data, deps } = await this.resources.compute(resource, inputs);
        this.recomputes++;
        this.graph.setDependencies(instanceId, deps);

        const instance: LiveInstance = {
            id: instanceId,
            resource,
            inputs,
            patcher: new PatchEngine(resource.meta.key),
            data,
            hash: fnv1a64(canonical(data)),
            revision: 1,
            computing: null,
            dirty: false,
            dropTimer: null
        };

        this.instances.set(instanceId, instance);
        return instance;
    }

    private sendState(
        connectionId: string,
        sid: string,
        instance: LiveInstance,
        clientHash?: string
    ): void {
        if (clientHash && clientHash === instance.hash) {
            // The screen already holds this exact content. Nothing on the wire.
            this.send(connectionId, {
                t: 'current',
                sid,
                rev: instance.revision,
                hash: instance.hash,
                key: instance.resource.meta.key
            });
            return;
        }

        this.send(connectionId, {
            t: 'snapshot',
            sid,
            rev: instance.revision,
            hash: instance.hash,
            data: instance.data,
            key: instance.resource.meta.key
        });
    }

    private onInvalidation(events: InvalidationEvent[]): void {
        for (const event of events) {
            for (const instanceId of this.graph.resolve(event)) {
                // Grace-held instances have no subscribers but are still cached.
                if (this.instances.has(instanceId)) {
                    this.pending.add(instanceId);
                }
            }
        }

        if (this.pending.size === 0 || this.flushTimer) {
            return;
        }

        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            void this.flush();
        }, this.config.coalesceMs);
    }

    private async flush(): Promise<void> {
        const batch = [...this.pending];
        this.pending.clear();

        for (let i = 0; i < batch.length; i += this.config.fanoutQueueThreshold) {
            const slice = batch.slice(i, i + this.config.fanoutQueueThreshold);
            await Promise.all(slice.map(instanceId => this.recompute(instanceId)));

            if (i + this.config.fanoutQueueThreshold < batch.length) {
                // Yield between slices so a large fan-out does not monopolize
                // the loop and stall unrelated requests.
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
    }

    private recompute(instanceId: string): Promise<void> {
        const instance = this.instances.get(instanceId);

        if (!instance) {
            return Promise.resolve();
        }

        if (instance.computing) {
            // Single-flight: N invalidations arriving during one recompute cost
            // exactly one more recompute, not N.
            instance.dirty = true;
            return instance.computing;
        }

        instance.computing = this.runCompute(instance).finally(() => {
            instance.computing = null;

            if (instance.dirty) {
                instance.dirty = false;
                void this.recompute(instanceId);
            }
        });

        return instance.computing;
    }

    private async runCompute(instance: LiveInstance): Promise<void> {
        let data: unknown;
        let deps;

        try {
            ({ data, deps } = await this.resources.compute(instance.resource, instance.inputs));
        } catch (error) {
            this.broadcast(instance, sid => ({ t: 'stale', sid, reason: (error as Error).message }));
            return;
        }

        this.recomputes++;
        this.graph.setDependencies(instance.id, deps);

        const hash = fnv1a64(canonical(data));

        if (hash === instance.hash) {
            // Recompute is not a patch. Coarse invalidation costs CPU, never
            // traffic and never a re-render.
            this.recomputesWithoutPatch++;
            return;
        }

        const ops = instance.patcher.diff(instance.data, data);
        const from = instance.revision;

        instance.data = data;
        instance.hash = hash;
        instance.revision += 1;

        this.broadcast(instance, sid => ({
            t: 'patch',
            sid,
            from,
            to: instance.revision,
            hash,
            ops
        }));
    }

    private broadcast(instance: LiveInstance, build: (sid: string) => ServerMessage): void {
        for (const connectionId of this.subs.connectionsOf(instance.id)) {
            for (const sid of this.sidsFor(connectionId, instance.id)) {
                const message = build(sid);

                if (message.t === 'patch' && this.isBackedUp(connectionId)) {
                    // The client is behind. Collapse instead of queueing more.
                    this.send(connectionId, {
                        t: 'snapshot',
                        sid,
                        rev: instance.revision,
                        hash: instance.hash,
                        data: instance.data,
                        key: instance.resource.meta.key
                    });
                    this.backpressure.set(connectionId, 0);
                    continue;
                }

                this.send(connectionId, message);
            }
        }
    }

    private sidsFor(connectionId: string, instanceId: string): string[] {
        const owned = this.bindings.get(connectionId);

        if (!owned) {
            return [];
        }

        const sids: string[] = [];

        for (const [sid, boundInstance] of owned) {
            if (boundInstance === instanceId) {
                sids.push(sid);
            }
        }

        return sids;
    }

    private isBackedUp(connectionId: string): boolean {
        return (this.backpressure.get(connectionId) ?? 0) >= this.config.maxPendingPatches;
    }

    private send(connectionId: string, message: ServerMessage): void {
        const result = this.transport.send(connectionId, message);
        const current = this.backpressure.get(connectionId) ?? 0;

        this.backpressure.set(connectionId, result > 0 ? 0 : current + 1);
    }

    private fail(connectionId: string, sid: string, code: string, message: string): void {
        this.send(connectionId, { t: 'error', sid, code, message });
    }
}
