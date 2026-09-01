import { describe, expect, test } from 'bun:test';
import { SocketTransport } from '../src/transport/SocketTransport';
import { ConnectionScopeResolver } from '../src/transport/scope-resolver';
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
