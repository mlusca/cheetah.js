import { afterEach, describe, expect, test } from 'bun:test';
import { dropLiveConnection, handleMessage, LiveGateway } from '../src/transport/LiveGateway';
import { SocketTransport } from '../src/transport/SocketTransport';
import { ConnectionScopeResolver } from '../src/transport/scope-resolver';
import { getLiveRuntime, resetLiveRuntime, setLiveRuntime } from '../src/runtime';
import type { LiveScope } from '../src/shared/inputs';
import type { ServerMessage } from '../src/shared/protocol';

class FakeSocket {
    sent: string[] = [];
    result = 7;

    constructor(public readonly id: string) {}

    send(message: string): number {
        this.sent.push(message);
        return this.result;
    }
}

const MESSAGE: ServerMessage = { t: 'stale', sid: 's1', reason: 'test' };

describe('SocketTransport', () => {
    test('serializes the message to the registered socket', () => {
        const transport = new SocketTransport();
        const socket = new FakeSocket('c1');
        transport.add(socket as any);

        expect(transport.send('c1', MESSAGE)).toBe(7);
        expect(JSON.parse(socket.sent[0])).toEqual(MESSAGE as any);
    });

    test('reports a dropped send for an unknown connection', () => {
        expect(new SocketTransport().send('ghost', MESSAGE)).toBe(0);
    });

    test('reports a dropped send when the socket throws', () => {
        const transport = new SocketTransport();
        transport.add({ id: 'c1', send: () => { throw new Error('closed'); } } as any);

        expect(transport.send('c1', MESSAGE)).toBe(0);
    });

    test('remove stops delivery', () => {
        const transport = new SocketTransport();
        const socket = new FakeSocket('c1');
        transport.add(socket as any);
        transport.remove('c1');

        expect(transport.send('c1', MESSAGE)).toBe(0);
    });
});

describe('ConnectionScopeResolver', () => {
    test('makes each connection its own principal, which shares nothing', async () => {
        const resolver = new ConnectionScopeResolver();

        expect(await resolver.resolve({ connectionId: 'c1' })).toEqual({ principal: 'c1' });
        expect(await resolver.resolve({ connectionId: 'c2' })).toEqual({ principal: 'c2' });
    });
});

describe('LiveGateway', () => {
    afterEach(() => {
        resetLiveRuntime();
    });

    test('a sub sent immediately after hello uses the resolved scope', async () => {
        let releaseHello!: () => void;
        const helloGate = new Promise<void>(resolve => {
            releaseHello = resolve;
        });

        let releaseSub!: () => void;
        const subSeen = new Promise<void>(resolve => {
            releaseSub = resolve;
        });

        let usedScope: LiveScope | undefined;

        setLiveRuntime({
            engine: {
                subscribe: async (_connectionId: string, _sid: string, _resource: string, _inputs: unknown, scope: LiveScope) => {
                    usedScope = scope;
                    releaseSub();
                },
                unsubscribe() {},
                dropConnection() {},
                resync: async () => {}
            } as any,
            transport: new SocketTransport(),
            resolver: {
                resolve: async () => {
                    await helloGate;
                    return { principal: 'user-1', tenant: 'acme' };
                }
            },
            scopes: new Map()
        });

        const gateway = new LiveGateway();
        const socket = new FakeSocket('c1');
        gateway.onOpen(socket as any);
        gateway.onMessage(socket as any, JSON.stringify({ t: 'hello', v: 1, token: 't' }));
        gateway.onMessage(
            socket as any,
            JSON.stringify({ t: 'sub', sid: 's1', resource: 'UsersController.list', inputs: { params: {}, query: {} } })
        );

        // Let both handlers start. Hello parks on the resolver; without
        // per-connection ordering, sub would already have subscribed.
        await new Promise(resolve => setTimeout(resolve, 0));
        releaseHello();
        await subSeen;

        expect(usedScope).toEqual({ principal: 'user-1', tenant: 'acme' });
        gateway.onClose(socket as any);
    });

    test('close drops a queued sub so a slow hello cannot resurrect the connection', async () => {
        let releaseHello!: () => void;
        const helloGate = new Promise<void>(resolve => {
            releaseHello = resolve;
        });

        let subscribed = false;

        setLiveRuntime({
            engine: {
                subscribe: async () => {
                    subscribed = true;
                },
                unsubscribe() {},
                dropConnection() {},
                resync: async () => {}
            } as any,
            transport: new SocketTransport(),
            resolver: {
                resolve: async () => {
                    await helloGate;
                    return { principal: 'user-1' };
                }
            },
            scopes: new Map()
        });

        const gateway = new LiveGateway();
        const socket = new FakeSocket('c1');
        gateway.onOpen(socket as any);
        gateway.onMessage(socket as any, JSON.stringify({ t: 'hello', v: 1, token: 't' }));
        gateway.onMessage(
            socket as any,
            JSON.stringify({ t: 'sub', sid: 's1', resource: 'UsersController.list', inputs: { params: {}, query: {} } })
        );

        await new Promise(resolve => setTimeout(resolve, 0));
        gateway.onClose(socket as any);
        releaseHello();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(subscribed).toBe(false);
        expect(getLiveRuntime().scopes.has('c1')).toBe(false);
    });

    test('dropLiveConnection drops a queued sub, which is what SSE cancel uses', async () => {
        let releaseHello!: () => void;
        const helloGate = new Promise<void>(resolve => {
            releaseHello = resolve;
        });

        let subscribed = false;

        setLiveRuntime({
            engine: {
                subscribe: async () => {
                    subscribed = true;
                },
                unsubscribe() {},
                dropConnection() {},
                resync: async () => {}
            } as any,
            transport: new SocketTransport(),
            resolver: {
                resolve: async () => {
                    await helloGate;
                    return { principal: 'user-1' };
                }
            },
            scopes: new Map([['sse:1', { principal: 'sse:1' }]])
        });

        void handleMessage('sse:1', JSON.stringify({ t: 'hello', v: 1, token: 't' }));
        void handleMessage(
            'sse:1',
            JSON.stringify({ t: 'sub', sid: 's1', resource: 'UsersController.list', inputs: { params: {}, query: {} } })
        );

        await new Promise(resolve => setTimeout(resolve, 0));
        dropLiveConnection('sse:1');
        releaseHello();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(subscribed).toBe(false);
        expect(getLiveRuntime().scopes.has('sse:1')).toBe(false);
    });
});
