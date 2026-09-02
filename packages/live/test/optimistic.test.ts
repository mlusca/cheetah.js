import { describe, expect, test } from 'bun:test';
import { LiveClient, type LiveSocket } from '../src/client/core';
import type { ClientMessage, ServerMessage } from '../src/shared/protocol';

class FakeSocket implements LiveSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;

    readonly sent: ClientMessage[] = [];

    send(data: string): void {
        this.sent.push(JSON.parse(data));
    }

    close(): void {}

    open(): void {
        this.onopen?.();
    }

    deliver(message: ServerMessage): void {
        this.onmessage?.({ data: JSON.stringify(message) });
    }

    sid(): string {
        const sub = this.sent.find(message => message.t === 'sub') as { sid: string };
        return sub.sid;
    }
}

function build() {
    const socket = new FakeSocket();
    const client = new LiveClient({
        url: 'ws://test/live',
        socketFactory: () => socket,
        unsubGraceMs: 5
    });

    const store = client.store<{ id: number; title: string }[]>('Cards.list', { params: {}, query: {} });
    store.subscribe(() => {});
    socket.open();
    socket.deliver({
        t: 'snapshot',
        sid: socket.sid(),
        rev: 1,
        hash: 'h1',
        data: [{ id: 1, title: 'Ada' }],
        key: 'id'
    });

    return { client, socket, store };
}

describe('optimistic overlay', () => {
    test('shows the optimistic row before the server knows about it', () => {
        const { client, store } = build();

        client.overlay('Cards.list', draft => {
            (draft as { id: number; title: string }[]).push({ id: -1, title: 'pending' });
        });

        expect(store.getSnapshot().data).toEqual([
            { id: 1, title: 'Ada' },
            { id: -1, title: 'pending' }
        ]);
    });

    test('removing the overlay goes back to what the server confirmed', () => {
        const { client, store } = build();

        const remove = client.overlay('Cards.list', draft => {
            (draft as { id: number; title: string }[]).push({ id: -1, title: 'pending' });
        });
        remove();

        expect(store.getSnapshot().data).toEqual([{ id: 1, title: 'Ada' }]);
    });

    test('a server patch during the action applies underneath the overlay', () => {
        const { client, socket, store } = build();

        client.overlay('Cards.list', draft => {
            (draft as { id: number; title: string }[]).push({ id: -1, title: 'pending' });
        });

        socket.deliver({
            t: 'patch',
            sid: socket.sid(),
            from: 1,
            to: 2,
            hash: 'h2',
            ops: [{ op: 'upsert', path: [], key: 2, index: 1, value: { id: 2, title: 'Linus' } }]
        });

        // The server's row landed on the confirmed snapshot; the optimistic row
        // is still projected on top of it.
        expect(store.getSnapshot().data).toEqual([
            { id: 1, title: 'Ada' },
            { id: 2, title: 'Linus' },
            { id: -1, title: 'pending' }
        ]);
    });

    test('the confirmed snapshot survives the overlay being dropped', () => {
        const { client, socket, store } = build();

        const remove = client.overlay('Cards.list', draft => {
            (draft as { id: number; title: string }[]).push({ id: -1, title: 'pending' });
        });

        socket.deliver({
            t: 'patch',
            sid: socket.sid(),
            from: 1,
            to: 2,
            hash: 'h2',
            ops: [{ op: 'upsert', path: [], key: 2, index: 1, value: { id: 2, title: 'Linus' } }]
        });
        remove();

        expect(store.getSnapshot().data).toEqual([
            { id: 1, title: 'Ada' },
            { id: 2, title: 'Linus' }
        ]);
    });

    test('two overlays apply in the order they were added', () => {
        const { client, store } = build();

        client.overlay('Cards.list', draft => {
            (draft as { id: number; title: string }[]).push({ id: -1, title: 'first' });
        });
        client.overlay('Cards.list', draft => {
            (draft as { id: number; title: string }[]).push({ id: -2, title: 'second' });
        });

        expect(store.getSnapshot().data).toEqual([
            { id: 1, title: 'Ada' },
            { id: -1, title: 'first' },
            { id: -2, title: 'second' }
        ]);
    });

    test('an overlay for another resource leaves this store alone', () => {
        const { client, store } = build();
        const before = store.getSnapshot();

        client.overlay('Cards.other', draft => {
            (draft as unknown[]).push({ id: -1 });
        });

        expect(store.getSnapshot()).toBe(before);
    });

    test('an overlay that throws does not break the store', () => {
        const { client, store } = build();

        client.overlay('Cards.list', () => {
            throw new Error('bad optimistic update');
        });

        expect(store.getSnapshot().data).toEqual([{ id: 1, title: 'Ada' }]);
    });
});
