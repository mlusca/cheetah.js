import { describe, expect, test } from 'bun:test';
import { LiveClient, type LiveSocket } from '../src/client/core';
import { WebSocketTransport, type ClientTransport, type TransportHandlers } from '../src/client/transport';

function fakeSocket(): LiveSocket & { sent: string[] } {
    const socket = {
        sent: [] as string[],
        send(data: string) { socket.sent.push(data); },
        close() {},
        onopen: null as (() => void) | null,
        onmessage: null as ((event: { data: string }) => void) | null,
        onclose: null as (() => void) | null,
        onerror: null as ((error: unknown) => void) | null
    };

    return socket;
}

describe('WebSocketTransport', () => {
    test('reports itself as websocket and forwards the three events', () => {
        const socket = fakeSocket();
        const transport = new WebSocketTransport('ws://x/live', () => socket);
        const seen: string[] = [];

        transport.start({
            onOpen: () => seen.push('open'),
            onMessage: raw => seen.push(`message:${raw}`),
            onClose: () => seen.push('close')
        });

        expect(transport.kind).toBe('websocket');

        socket.onopen?.();
        socket.onmessage?.({ data: 'hi' });
        socket.onclose?.();

        expect(seen).toEqual(['open', 'message:hi', 'close']);
    });

    test('an error counts as a close, because both mean the pipe is gone', () => {
        const socket = fakeSocket();
        const transport = new WebSocketTransport('ws://x/live', () => socket);
        let closes = 0;

        transport.start({ onOpen: () => {}, onMessage: () => {}, onClose: () => { closes += 1; } });
        socket.onerror?.(new Error('boom'));

        expect(closes).toBe(1);
    });

    test('close() does not report a close back, so it cannot trigger a reconnect', () => {
        const socket = fakeSocket();
        const transport = new WebSocketTransport('ws://x/live', () => socket);
        let closes = 0;

        transport.start({ onOpen: () => {}, onMessage: () => {}, onClose: () => { closes += 1; } });
        transport.close();
        socket.onclose?.();

        expect(closes).toBe(0);
    });
});

describe('LiveClient over a custom transport', () => {
    test('uses transportFactory when one is given, and reports its kind', () => {
        const sent: string[] = [];
        let handlers: TransportHandlers | null = null;

        const custom: ClientTransport = {
            kind: 'sse',
            start(next) { handlers = next; },
            send(raw) { sent.push(raw); },
            close() {}
        };

        const client = new LiveClient({ url: 'http://x/live', transportFactory: () => custom });

        expect(client.transport()).toBeNull();

        client.store('CardsController.list', { params: {}, query: {} }).subscribe(() => {});
        handlers!.onOpen();

        expect(client.transport()).toBe('sse');
        expect(sent.some(raw => raw.includes('"t":"hello"'))).toBe(true);
        expect(sent.some(raw => raw.includes('"t":"sub"'))).toBe(true);
    });

    test('socketFactory still works, unchanged', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });

        client.store('CardsController.list', { params: {}, query: {} }).subscribe(() => {});
        socket.onopen?.();

        expect(client.transport()).toBe('websocket');
        expect(socket.sent.some(raw => raw.includes('"t":"sub"'))).toBe(true);
    });
});
