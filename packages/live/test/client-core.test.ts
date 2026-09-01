import { describe, expect, test } from 'bun:test';
import { LiveClient, type LiveSocket } from '../src/client/core';
import type { ClientMessage, ServerMessage } from '../src/shared/protocol';

class FakeSocket implements LiveSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;

    readonly sent: ClientMessage[] = [];
    closed = false;

    send(data: string): void {
        this.sent.push(JSON.parse(data));
    }

    close(): void {
        this.closed = true;
        this.onclose?.();
    }

    open(): void {
        this.onopen?.();
    }

    deliver(message: ServerMessage): void {
        this.onmessage?.({ data: JSON.stringify(message) });
    }

    subs(): Extract<ClientMessage, { t: 'sub' }>[] {
        return this.sent.filter(m => m.t === 'sub') as any;
    }
}

function build(options: Partial<ConstructorParameters<typeof LiveClient>[0]> = {}) {
    const socket = new FakeSocket();
    const client = new LiveClient({
        url: 'ws://test/live',
        socketFactory: () => socket,
        unsubGraceMs: 5,
        ...options
    });

    return { client, socket };
}

describe('LiveClient store', () => {
    test('starts pending and subscribes on open', () => {
        const { client, socket } = build();
        const store = client.store('UsersController.list', { params: {}, query: {} });
        store.subscribe(() => {});
        socket.open();

        expect(store.getSnapshot().pending).toBe(true);
        expect(socket.subs()[0]).toMatchObject({ resource: 'UsersController.list' });
    });

    test('a snapshot fills the store and clears pending', () => {
        const { client, socket } = build();
        const store = client.store<{ id: number }[]>('r', { params: {}, query: {} });
        store.subscribe(() => {});
        socket.open();

        socket.deliver({ t: 'snapshot', sid: socket.subs()[0].sid, rev: 1, hash: 'h1', data: [{ id: 1 }], key: 'id' });

        expect(store.getSnapshot()).toMatchObject({ pending: false, error: null, stale: false });
        expect(store.getSnapshot().data).toEqual([{ id: 1 }]);
    });

    test('getSnapshot is referentially stable until something changes', () => {
        const { client, socket } = build();
        const store = client.store('r', { params: {}, query: {} });
        store.subscribe(() => {});
        socket.open();
        socket.deliver({ t: 'snapshot', sid: socket.subs()[0].sid, rev: 1, hash: 'h1', data: { a: 1 } });

        const first = store.getSnapshot();
        expect(store.getSnapshot()).toBe(first);

        socket.deliver({ t: 'patch', sid: socket.subs()[0].sid, from: 1, to: 2, hash: 'h2', ops: [{ op: 'set', path: ['a'], value: 2 }] });

        expect(store.getSnapshot()).not.toBe(first);
        expect(store.getSnapshot().data).toEqual({ a: 2 });
    });

    test('applies keyed patches keeping untouched rows identical', () => {
        const { client, socket } = build();
        const store = client.store<{ id: number; n: string }[]>('r', { params: {}, query: {} });
        store.subscribe(() => {});
        socket.open();
        const sid = socket.subs()[0].sid;
        socket.deliver({ t: 'snapshot', sid, rev: 1, hash: 'h1', key: 'id', data: [{ id: 1, n: 'a' }, { id: 2, n: 'b' }] });

        const before = store.getSnapshot().data!;
        socket.deliver({
            t: 'patch', sid, from: 1, to: 2, hash: 'h2',
            ops: [{ op: 'upsert', path: [], key: 2, index: 1, value: { id: 2, n: 'bb' } }]
        });

        expect(store.getSnapshot().data![0]).toBe(before[0]);
        expect(store.getSnapshot().data![1]).toEqual({ id: 2, n: 'bb' });
    });

    test('asks for a resync when the patch revision does not follow', () => {
        const { client, socket } = build();
        const store = client.store('r', { params: {}, query: {} });
        store.subscribe(() => {});
        socket.open();
        const sid = socket.subs()[0].sid;
        socket.deliver({ t: 'snapshot', sid, rev: 1, hash: 'h1', data: { a: 1 } });

        socket.deliver({ t: 'patch', sid, from: 5, to: 6, hash: 'h9', ops: [] });

        expect(socket.sent.some(m => m.t === 'resync' && m.sid === sid)).toBe(true);
    });

    test('marks the store stale without dropping the data', () => {
        const { client, socket } = build();
        const store = client.store('r', { params: {}, query: {} });
        store.subscribe(() => {});
        socket.open();
        const sid = socket.subs()[0].sid;
        socket.deliver({ t: 'snapshot', sid, rev: 1, hash: 'h1', data: { a: 1 } });
        socket.deliver({ t: 'stale', sid, reason: 'db down' });

        expect(store.getSnapshot()).toMatchObject({ stale: true });
        expect(store.getSnapshot().data).toEqual({ a: 1 });
    });

    test('surfaces a server error on the store', () => {
        const { client, socket } = build();
        const store = client.store('r', { params: {}, query: {} });
        store.subscribe(() => {});
        socket.open();
        socket.deliver({ t: 'error', sid: socket.subs()[0].sid, code: 'unknown_resource', message: 'nope' });

        expect(store.getSnapshot()).toMatchObject({ pending: false, error: 'nope' });
    });

    test('two stores with the same resource and inputs share one subscription', () => {
        const { client, socket } = build();
        const a = client.store('r', { params: {}, query: { x: '1' } });
        const b = client.store('r', { params: {}, query: { x: '1' } });
        a.subscribe(() => {});
        b.subscribe(() => {});
        socket.open();

        expect(a).toBe(b);
        expect(socket.subs()).toHaveLength(1);
    });

    test('unsubscribing the last listener sends unsub after the grace period', async () => {
        const { client, socket } = build({ unsubGraceMs: 10 });
        const store = client.store('r', { params: {}, query: {} });
        const off = store.subscribe(() => {});
        socket.open();
        off();

        expect(socket.sent.some(m => m.t === 'unsub')).toBe(false);
        await new Promise(resolve => setTimeout(resolve, 30));
        expect(socket.sent.some(m => m.t === 'unsub')).toBe(true);
    });

    test('hydration seeds the store and subscribes with the hash it already has', () => {
        const hydrate = { 'r|{"params":{},"query":{}}': { data: { a: 1 }, hash: 'h1' } };
        const { client, socket } = build({ hydrate });
        const store = client.store('r', { params: {}, query: {} });
        store.subscribe(() => {});
        socket.open();

        expect(store.getSnapshot()).toMatchObject({ pending: false });
        expect(store.getSnapshot().data).toEqual({ a: 1 });
        expect(socket.subs()[0].hash).toBe('h1');
    });

    test('a current response leaves the hydrated data untouched', () => {
        const hydrate = { 'r|{"params":{},"query":{}}': { data: { a: 1 }, hash: 'h1' } };
        const { client, socket } = build({ hydrate });
        const store = client.store('r', { params: {}, query: {} });
        store.subscribe(() => {});
        socket.open();
        const before = store.getSnapshot();

        socket.deliver({ t: 'current', sid: socket.subs()[0].sid, rev: 1, hash: 'h1' });

        expect(store.getSnapshot().data).toBe(before.data);
    });

    test('resubscribes every live store on reconnect, carrying the hash', () => {
        const sockets: FakeSocket[] = [];
        const client = new LiveClient({
            url: 'ws://test/live',
            unsubGraceMs: 5,
            reconnect: { initialMs: 1, maxMs: 2 },
            socketFactory: () => {
                const socket = new FakeSocket();
                sockets.push(socket);
                return socket;
            }
        });

        const store = client.store('r', { params: {}, query: {} });
        store.subscribe(() => {});
        sockets[0].open();
        socketDeliverSnapshot(sockets[0]);

        sockets[0].onclose?.();

        return new Promise<void>(resolve => {
            setTimeout(() => {
                expect(sockets.length).toBeGreaterThan(1);
                sockets[1].open();
                expect(sockets[1].subs()[0].hash).toBe('h1');
                client.close();
                resolve();
            }, 40);
        });
    });
});

function socketDeliverSnapshot(socket: FakeSocket): void {
    socket.deliver({ t: 'snapshot', sid: socket.subs()[0].sid, rev: 1, hash: 'h1', data: { a: 1 } });
}
