import { describe, expect, test } from 'bun:test';
import { FanTransport, type OwnedTransport } from '../src/transport/FanTransport';
import type { ServerMessage } from '../src/shared/protocol';

function child(prefix: string): OwnedTransport & { sent: { id: string; message: ServerMessage }[] } {
    const sent: { id: string; message: ServerMessage }[] = [];

    return {
        sent,
        owns: (connectionId: string) => connectionId.startsWith(prefix),
        send(connectionId: string, message: ServerMessage) {
            sent.push({ id: connectionId, message });
            return 1;
        }
    };
}

const HELLO: ServerMessage = { t: 'current', sid: 's1', rev: 1, hash: 'h' };

describe('FanTransport', () => {
    test('delivers to the child that owns the connection', () => {
        const sockets = child('ws:');
        const streams = child('sse:');
        const fan = new FanTransport();
        fan.add(sockets);
        fan.add(streams);

        fan.send('sse:abc', HELLO);

        expect(streams.sent.length).toBe(1);
        expect(sockets.sent.length).toBe(0);
    });

    test('an unowned connection is a dropped send, not a throw', () => {
        const fan = new FanTransport();
        fan.add(child('ws:'));

        // The engine treats <= 0 as back-pressure or drop, and cleans up on
        // its own schedule. Throwing here would take a whole fan-out down.
        expect(fan.send('sse:gone', HELLO)).toBe(0);
    });

    test('the first owner wins, so a stale child cannot shadow a live one', () => {
        const first = child('c');
        const second = child('c');
        const fan = new FanTransport();
        fan.add(first);
        fan.add(second);

        fan.send('c1', HELLO);

        expect(first.sent.length).toBe(1);
        expect(second.sent.length).toBe(0);
    });

    test('reports back-pressure from the child verbatim', () => {
        const fan = new FanTransport();
        fan.add({ owns: () => true, send: () => -1 });

        expect(fan.send('anything', HELLO)).toBe(-1);
    });
});
