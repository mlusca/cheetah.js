import { describe, expect, test } from 'bun:test';
import { SseTransport } from '../src/transport/SseTransport';
import type { ServerMessage } from '../src/shared/protocol';

const SNAPSHOT: ServerMessage = { t: 'snapshot', sid: 's1', rev: 1, hash: 'h1', data: [{ id: 1 }] };

async function readOne(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
    const { value } = await reader.read();
    return new TextDecoder().decode(value);
}

describe('SseTransport', () => {
    test('open() hands back a stream, and owns() claims the connection', () => {
        const transport = new SseTransport({ heartbeatMs: 0, maxConnections: 10 });
        const stream = transport.open('sse:1');

        expect(stream).toBeInstanceOf(ReadableStream);
        expect(transport.owns('sse:1')).toBe(true);
        expect(transport.owns('sse:2')).toBe(false);
    });

    test('the first frame carries the connection id, because the client has no other way to learn it', async () => {
        const transport = new SseTransport({ heartbeatMs: 0, maxConnections: 10 });
        const reader = transport.open('sse:1').getReader();

        expect(await readOne(reader)).toBe('data: {"t":"ready","cid":"sse:1"}\n\n');
    });

    test('a message is written as one SSE frame of JSON', async () => {
        const transport = new SseTransport({ heartbeatMs: 0, maxConnections: 10 });
        const reader = transport.open('sse:1').getReader();
        await readOne(reader);

        expect(transport.send('sse:1', SNAPSHOT)).toBe(1);
        expect(await readOne(reader)).toBe(`data: ${JSON.stringify(SNAPSHOT)}\n\n`);
    });

    test('sending to a closed connection is a drop, not a throw', () => {
        const transport = new SseTransport({ heartbeatMs: 0, maxConnections: 10 });
        transport.open('sse:1');
        transport.close('sse:1');

        expect(transport.send('sse:1', SNAPSHOT)).toBe(0);
        expect(transport.owns('sse:1')).toBe(false);
    });

    test('refuses to open past the ceiling', () => {
        const transport = new SseTransport({ heartbeatMs: 0, maxConnections: 1 });
        transport.open('sse:1');

        expect(() => transport.open('sse:2')).toThrow(/at capacity/);
    });

    test('a heartbeat keeps the connection from being reaped by a proxy', async () => {
        const transport = new SseTransport({ heartbeatMs: 5, maxConnections: 10 });
        const reader = transport.open('sse:1').getReader();
        await readOne(reader);

        // A comment frame: valid SSE, ignored by EventSource, enough traffic
        // to stop an idle-timeout proxy from closing the stream.
        expect(await readOne(reader)).toBe(': ping\n\n');
        transport.stop();
    });

    test('stop() closes every stream it holds', () => {
        const transport = new SseTransport({ heartbeatMs: 0, maxConnections: 10 });
        transport.open('sse:1');
        transport.open('sse:2');

        transport.stop();

        expect(transport.count()).toBe(0);
    });

    test('the client cancelling the stream releases the connection', async () => {
        const transport = new SseTransport({ heartbeatMs: 0, maxConnections: 10 });
        const dropped: string[] = [];
        const withHook = new SseTransport({
            heartbeatMs: 0,
            maxConnections: 10,
            onDisconnect: id => dropped.push(id)
        });
        void transport;

        const stream = withHook.open('sse:1');
        await stream.cancel();

        expect(dropped).toEqual(['sse:1']);
        expect(withHook.owns('sse:1')).toBe(false);
    });
});
