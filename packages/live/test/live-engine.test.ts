import { beforeEach, describe, expect, test } from 'bun:test';
import { Controller, Get, Query } from '@carno.js/core';
import { Live } from '../src/decorators/Live';
import { resolveLiveConfig } from '../src/config';
import { DependencyGraph } from '../src/graph/DependencyGraph';
import { SubscriptionRegistry } from '../src/graph/SubscriptionRegistry';
import { InProcessBus } from '../src/bus/InProcessBus';
import { ResourceRegistry } from '../src/resource/ResourceRegistry';
import { dependencyContext } from '../src/resource/dependency-context';
import { LiveEngine, type LiveTransport } from '../src/LiveEngine';
import type { ServerMessage } from '../src/shared/protocol';
import { LiveRouteExecutionError } from '../src/resource/route-executor';
import type { LiveResourceExecutor } from '../src/resource/types';
import { directResourceExecutor } from './resource-registry-helper';

const rows: { id: number; name: string; hits: number }[] = [];

@Controller('/users')
class UsersController {
    @Get('/')
    @Live({ key: 'id', shared: 'public' })
    list(@Query('q') q?: string) {
        dependencyContext.current()?.add({ key: 'orm:users', columns: ['id', 'name'] });
        return rows.filter(row => !q || row.name.includes(q)).map(row => ({ id: row.id, name: row.name }));
    }

    @Get('/private')
    @Live()
    mine() {
        dependencyContext.current()?.add({ key: 'orm:users', columns: null });
        return { ok: true };
    }
}

class FakeTransport implements LiveTransport {
    readonly sent: { connectionId: string; message: ServerMessage }[] = [];
    result = 1;

    send(connectionId: string, message: ServerMessage): number {
        this.sent.push({ connectionId, message });
        return this.result;
    }

    messagesFor(connectionId: string): ServerMessage[] {
        return this.sent.filter(entry => entry.connectionId === connectionId).map(entry => entry.message);
    }

    clear(): void {
        this.sent.length = 0;
    }
}

function build(overrides = {}) {
    const resources = new ResourceRegistry();
    resources.register(UsersController, new UsersController(), directResourceExecutor);

    const bus = new InProcessBus();
    const transport = new FakeTransport();
    const engine = new LiveEngine(
        resources,
        new DependencyGraph(),
        new SubscriptionRegistry(),
        bus,
        transport,
        resolveLiveConfig({ coalesceMs: 1, unsubGraceMs: 5, ...overrides })
    );
    engine.start();

    return { engine, bus, transport };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 25));

beforeEach(() => {
    rows.length = 0;
    rows.push({ id: 1, name: 'Ada', hits: 0 });
});

describe('LiveEngine.subscribe', () => {
    test('answers a first subscription with a snapshot', async () => {
        const { engine, transport } = build();
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});

        const [message] = transport.messagesFor('c1');
        expect(message.t).toBe('snapshot');
        expect((message as any).data).toEqual([{ id: 1, name: 'Ada' }]);
        expect((message as any).hash).toMatch(/^[0-9a-f]{16}$/);
    });

    test('answers with current when the client hash already matches', async () => {
        const { engine, transport } = build();
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        const hash = (transport.messagesFor('c1')[0] as any).hash;
        transport.clear();

        await engine.subscribe('c2', 's1', 'UsersController.list', { params: {}, query: {} }, {}, hash);

        const [message] = transport.messagesFor('c2');
        expect(message.t).toBe('current');
        expect((message as any).data).toBeUndefined();
    });

    test('two connections with the same inputs and scope share one instance', async () => {
        const { engine } = build();
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        await engine.subscribe('c2', 's1', 'UsersController.list', { params: {}, query: {} }, {});

        expect(engine.stats().instances).toBe(1);
    });

    test('private scope keeps two principals apart', async () => {
        const { engine } = build();
        await engine.subscribe('c1', 's1', 'UsersController.mine', { params: {}, query: {} }, { principal: 1 });
        await engine.subscribe('c2', 's1', 'UsersController.mine', { params: {}, query: {} }, { principal: 2 });

        expect(engine.stats().instances).toBe(2);
    });

    test('rejects an unknown resource with an error message', async () => {
        const { engine, transport } = build();
        await engine.subscribe('c1', 's1', 'Nope.nope', { params: {}, query: {} }, {});

        expect(transport.messagesFor('c1')[0]).toMatchObject({ t: 'error', code: 'unknown_resource' });
    });

    test('enforces the per-connection instance ceiling', async () => {
        const { engine, transport } = build({ maxInstancesPerConnection: 1 });
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        await engine.subscribe('c1', 's2', 'UsersController.list', { params: {}, query: { q: 'A' } }, {});

        expect(transport.messagesFor('c1')[1]).toMatchObject({ t: 'error', code: 'too_many_instances' });
    });

    test('single-flights initial creation for a shared instance', async () => {
        let releaseCompute!: () => void;
        const computeGate = new Promise<void>(resolve => {
            releaseCompute = resolve;
        });
        let firstComputeStarted!: () => void;
        const firstStarted = new Promise<void>(resolve => {
            firstComputeStarted = resolve;
        });
        let computeCalls = 0;

        @Controller('/single-flight')
        class SingleFlightController {
            @Get('/')
            @Live({ shared: 'public' })
            async list() {
                computeCalls++;
                firstComputeStarted();
                await computeGate;
                return { value: 'shared' };
            }
        }

        const resources = new ResourceRegistry();
        resources.register(SingleFlightController, new SingleFlightController(), directResourceExecutor);
        const transport = new FakeTransport();
        const engine = new LiveEngine(
            resources,
            new DependencyGraph(),
            new SubscriptionRegistry(),
            new InProcessBus(),
            transport,
            resolveLiveConfig({ coalesceMs: 1 })
        );
        engine.start();

        const inputs = { params: {}, query: {} };
        const first = engine.subscribe('c1', 's1', 'SingleFlightController.list', inputs, {});
        const second = engine.subscribe('c2', 's2', 'SingleFlightController.list', inputs, {});

        await firstStarted;
        releaseCompute();
        await Promise.all([first, second]);

        expect(computeCalls).toBe(1);
        expect(engine.stats().instances).toBe(1);
        expect(transport.messagesFor('c1')[0]).toMatchObject({
            t: 'snapshot',
            data: { value: 'shared' }
        });
        expect(transport.messagesFor('c2')[0]).toMatchObject({
            t: 'snapshot',
            data: { value: 'shared' }
        });
    });

    test('reserves node capacity for a distinct instance being created', async () => {
        let releaseCompute!: () => void;
        const computeGate = new Promise<void>(resolve => {
            releaseCompute = resolve;
        });
        let firstComputeStarted!: () => void;
        const firstStarted = new Promise<void>(resolve => {
            firstComputeStarted = resolve;
        });
        let computeCalls = 0;

        @Controller('/capacity-flight')
        class CapacityFlightController {
            @Get('/')
            @Live({ shared: 'public' })
            async list(@Query('q') q?: string) {
                computeCalls++;
                firstComputeStarted();
                await computeGate;
                return { value: q ?? 'all' };
            }
        }

        const resources = new ResourceRegistry();
        resources.register(CapacityFlightController, new CapacityFlightController(), directResourceExecutor);
        const transport = new FakeTransport();
        const engine = new LiveEngine(
            resources,
            new DependencyGraph(),
            new SubscriptionRegistry(),
            new InProcessBus(),
            transport,
            resolveLiveConfig({ coalesceMs: 1, maxInstancesPerNode: 1 })
        );
        engine.start();

        const first = engine.subscribe(
            'c1',
            's1',
            'CapacityFlightController.list',
            { params: {}, query: {} },
            {}
        );
        await firstStarted;

        const second = engine.subscribe(
            'c2',
            's2',
            'CapacityFlightController.list',
            { params: {}, query: { q: 'other' } },
            {}
        );

        await new Promise(resolve => setTimeout(resolve, 0));
        releaseCompute();
        await Promise.all([first, second]);

        expect(computeCalls).toBe(1);
        expect(transport.messagesFor('c1')[0]).toMatchObject({ t: 'snapshot' });
        expect(transport.messagesFor('c2')[0]).toMatchObject({
            t: 'error',
            code: 'node_at_capacity'
        });
        expect(engine.stats().instances).toBe(1);
    });

    test('recomputes with the subscription scope and revokes on a pipeline denial', async () => {
        let allowed = true;
        let receivedHeader: string | null = null;

        @Controller('/scoped')
        class ScopedController {
            @Get('/')
            @Live({ shared: 'public' })
            read() {
                dependencyContext.current()?.add({ key: 'orm:scope', columns: null });
                return { ok: true };
            }
        }

        const executor: LiveResourceExecutor = async (instance, resource, inputs, context) => {
            receivedHeader = new Headers(context.scope?.headers).get('x-allow');

            if (!allowed) {
                throw new LiveRouteExecutionError(403, 'forbidden');
            }

            return directResourceExecutor(instance, resource, inputs, context);
        };
        const resources = new ResourceRegistry();
        resources.register(ScopedController, new ScopedController(), executor);
        const bus = new InProcessBus();
        const transport = new FakeTransport();
        const engine = new LiveEngine(
            resources,
            new DependencyGraph(),
            new SubscriptionRegistry(),
            bus,
            transport,
            resolveLiveConfig({ coalesceMs: 1, unsubGraceMs: 5 })
        );
        engine.start();

        await engine.subscribe(
            'c1',
            's1',
            'ScopedController.read',
            { params: {}, query: {} },
            { principal: 'ada', headers: { 'x-allow': 'yes' } }
        );
        expect(receivedHeader).toBe('yes');
        transport.clear();

        allowed = false;
        engine.invalidate('orm:scope');
        await settle();

        expect(transport.messagesFor('c1')).toEqual([
            expect.objectContaining({ t: 'error', code: 'forbidden' })
        ]);
    });
});

describe('LiveEngine invalidation', () => {
    test('an invalidation that changes data produces a patch', async () => {
        const { engine, bus, transport } = build();
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        transport.clear();

        rows.push({ id: 2, name: 'Bob', hits: 0 });
        bus.publish([{ key: 'orm:users', columns: ['name'] }]);
        await settle();

        const [message] = transport.messagesFor('c1');
        expect(message.t).toBe('patch');
        expect((message as any).ops).toEqual([
            { op: 'upsert', path: [], key: 2, index: 1, value: { id: 2, name: 'Bob' } },
            { op: 'order', path: [], keys: [1, 2] }
        ]);
        expect((message as any).from).toBe(1);
        expect((message as any).to).toBe(2);
    });

    test('a recompute that changes nothing sends nothing', async () => {
        const { engine, bus, transport } = build();
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        transport.clear();

        bus.publish([{ key: 'orm:users', columns: ['name'] }]);
        await settle();

        expect(transport.sent).toHaveLength(0);
        expect(engine.stats().recomputesWithoutPatch).toBe(1);
    });

    test('a write to a column the resource does not read is ignored', async () => {
        const { engine, bus, transport } = build();
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        transport.clear();

        rows.push({ id: 2, name: 'Bob', hits: 0 });
        bus.publish([{ key: 'orm:users', columns: ['last_seen_at'] }]);
        await settle();

        expect(transport.sent).toHaveLength(0);
        expect(engine.stats().recomputes).toBe(1);
    });

    test('coalesces a burst of invalidations into one patch', async () => {
        const { engine, bus, transport } = build();
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        transport.clear();

        for (let i = 2; i <= 10; i++) {
            rows.push({ id: i, name: `U${i}`, hits: 0 });
            bus.publish([{ key: 'orm:users', columns: ['name'] }]);
        }
        await settle();

        expect(transport.messagesFor('c1').filter(m => m.t === 'patch')).toHaveLength(1);
    });

    test('fans one patch out to every subscriber of the instance', async () => {
        const { engine, bus, transport } = build();
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        await engine.subscribe('c2', 'sX', 'UsersController.list', { params: {}, query: {} }, {});
        transport.clear();

        rows.push({ id: 2, name: 'Bob', hits: 0 });
        bus.publish([{ key: 'orm:users', columns: ['name'] }]);
        await settle();

        expect(transport.messagesFor('c1')[0]).toMatchObject({ t: 'patch', sid: 's1' });
        expect(transport.messagesFor('c2')[0]).toMatchObject({ t: 'patch', sid: 'sX' });
    });

    test('sends a snapshot instead of a patch when the socket keeps back-pressuring', async () => {
        const { engine, bus, transport } = build({ maxPendingPatches: 1 });
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        transport.clear();
        transport.result = -1;

        for (let i = 2; i <= 4; i++) {
            rows.push({ id: i, name: `U${i}`, hits: 0 });
            bus.publish([{ key: 'orm:users', columns: ['name'] }]);
            await settle();
        }

        expect(transport.messagesFor('c1').some(m => m.t === 'snapshot')).toBe(true);
    });

    test('reports stale when a recompute throws', async () => {
        const { engine, bus, transport } = build();
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        transport.clear();

        const original = rows.filter;
        (rows as any).filter = () => { throw new Error('db down'); };
        bus.publish([{ key: 'orm:users', columns: ['name'] }]);
        await settle();
        (rows as any).filter = original;

        expect(transport.messagesFor('c1')[0]).toMatchObject({ t: 'stale' });
    });
});

describe('LiveEngine lifecycle', () => {
    test('drops the instance only after the grace period', async () => {
        const { engine } = build({ unsubGraceMs: 30 });
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        engine.unsubscribe('c1', 's1');

        expect(engine.stats().instances).toBe(1);
        await new Promise(resolve => setTimeout(resolve, 60));
        expect(engine.stats().instances).toBe(0);
    });

    test('resubscribing inside the grace period reuses the instance', async () => {
        const { engine, transport } = build({ unsubGraceMs: 50 });
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        engine.unsubscribe('c1', 's1');
        transport.clear();

        await engine.subscribe('c1', 's2', 'UsersController.list', { params: {}, query: {} }, {});
        await new Promise(resolve => setTimeout(resolve, 80));

        expect(engine.stats().instances).toBe(1);
        expect(engine.stats().recomputes).toBe(1);
    });

    test('resubscribe after an invalidation during unsub grace does not send stale state', async () => {
        const { engine, bus, transport } = build({ unsubGraceMs: 80 });
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        const hash = (transport.messagesFor('c1')[0] as any).hash;
        engine.unsubscribe('c1', 's1');
        transport.clear();

        rows.push({ id: 2, name: 'Bob', hits: 0 });
        bus.publish([{ key: 'orm:users', columns: ['name'] }]);
        await settle();

        await engine.subscribe('c1', 's2', 'UsersController.list', { params: {}, query: {} }, {}, hash);

        const [message] = transport.messagesFor('c1');
        expect(message.t).toBe('snapshot');
        expect((message as any).data).toEqual([
            { id: 1, name: 'Ada' },
            { id: 2, name: 'Bob' }
        ]);
    });

    test('dropping a connection releases everything it held', async () => {
        const { engine } = build({ unsubGraceMs: 1 });
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        engine.dropConnection('c1');
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(engine.stats().instances).toBe(0);
    });

    test('dropping the connection during the first createInstance does not orphan the instance', async () => {
        let releaseCompute!: () => void;
        const computeGate = new Promise<void>(resolve => {
            releaseCompute = resolve;
        });

        @Controller('/slow')
        class SlowController {
            @Get('/')
            @Live({ shared: 'public' })
            async list() {
                await computeGate;
                return [{ id: 1 }];
            }
        }

        const resources = new ResourceRegistry();
        resources.register(SlowController, new SlowController(), directResourceExecutor);
        const engine = new LiveEngine(
            resources,
            new DependencyGraph(),
            new SubscriptionRegistry(),
            new InProcessBus(),
            new FakeTransport(),
            resolveLiveConfig({ coalesceMs: 1, unsubGraceMs: 15 })
        );
        engine.start();

        const pending = engine.subscribe('c1', 's1', 'SlowController.list', { params: {}, query: {} }, {});
        await new Promise(resolve => setTimeout(resolve, 0));
        engine.dropConnection('c1');
        releaseCompute();
        await pending;
        await new Promise(resolve => setTimeout(resolve, 40));

        expect(engine.stats().instances).toBe(0);
    });

    test('dropping the first subscriber during createInstance does not roll back a second', async () => {
        let releaseCompute!: () => void;
        const computeGate = new Promise<void>(resolve => {
            releaseCompute = resolve;
        });

        @Controller('/slow2')
        class SlowController {
            @Get('/')
            @Live({ shared: 'public' })
            async list() {
                await computeGate;
                return [{ id: 1 }];
            }
        }

        const resources = new ResourceRegistry();
        resources.register(SlowController, new SlowController(), directResourceExecutor);
        const transport = new FakeTransport();
        const engine = new LiveEngine(
            resources,
            new DependencyGraph(),
            new SubscriptionRegistry(),
            new InProcessBus(),
            transport,
            resolveLiveConfig({ coalesceMs: 1, unsubGraceMs: 15 })
        );
        engine.start();

        const first = engine.subscribe('c1', 's1', 'SlowController.list', { params: {}, query: {} }, {});
        const second = engine.subscribe('c2', 's1', 'SlowController.list', { params: {}, query: {} }, {});
        await new Promise(resolve => setTimeout(resolve, 0));
        engine.dropConnection('c1');
        releaseCompute();
        await Promise.all([first, second]);

        expect(transport.messagesFor('c2')[0]).toMatchObject({ t: 'snapshot' });
        expect(engine.stats().instances).toBe(1);
        await new Promise(resolve => setTimeout(resolve, 40));
        expect(engine.stats().instances).toBe(1);
    });

    test('resubscribing the same sid does not leak the instance after one unsub', async () => {
        const { engine, transport } = build({ unsubGraceMs: 20 });
        const inputs = { params: {}, query: {} };

        await engine.subscribe('c1', 's1', 'UsersController.list', inputs, {});
        transport.clear();
        await engine.subscribe('c1', 's1', 'UsersController.list', inputs, {});

        expect(transport.messagesFor('c1')).toHaveLength(1);

        engine.unsubscribe('c1', 's1');
        await new Promise(resolve => setTimeout(resolve, 40));

        expect(engine.stats().instances).toBe(0);
    });

    test('reusing a sid for different inputs releases the previous instance', async () => {
        const { engine } = build({ unsubGraceMs: 20 });

        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: {} }, {});
        await engine.subscribe('c1', 's1', 'UsersController.list', { params: {}, query: { q: 'A' } }, {});
        engine.unsubscribe('c1', 's1');
        await new Promise(resolve => setTimeout(resolve, 40));

        expect(engine.stats().instances).toBe(0);
    });

    test('two sids on the same instance both have to unsubscribe', async () => {
        const { engine } = build({ unsubGraceMs: 20 });
        const inputs = { params: {}, query: {} };

        await engine.subscribe('c1', 's1', 'UsersController.list', inputs, {});
        await engine.subscribe('c1', 's2', 'UsersController.list', inputs, {});
        engine.unsubscribe('c1', 's1');
        await new Promise(resolve => setTimeout(resolve, 40));

        expect(engine.stats().instances).toBe(1);

        engine.unsubscribe('c1', 's2');
        await new Promise(resolve => setTimeout(resolve, 40));

        expect(engine.stats().instances).toBe(0);
    });
});
