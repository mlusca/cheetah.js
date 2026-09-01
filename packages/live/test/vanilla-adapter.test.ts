import { describe, expect, test } from 'bun:test';
import { LiveClient, type LiveSocket } from '../src/client/core';
import { LiveSlot, liveStore, liveStoreOf } from '../src/client/vanilla';
import type { LiveDescriptor } from '../src/shared/descriptor';

function fakeSocket(): LiveSocket & { sent: string[]; deliver: (message: unknown) => void } {
    const socket = {
        sent: [] as string[],
        send(data: string) { socket.sent.push(data); },
        close() {},
        onopen: null as (() => void) | null,
        onmessage: null as ((event: { data: string }) => void) | null,
        onclose: null as (() => void) | null,
        onerror: null as ((error: unknown) => void) | null,
        deliver(message: unknown) { socket.onmessage?.({ data: JSON.stringify(message) }); }
    };

    return socket;
}

interface CardsRoute {
    response: { id: number; title: string }[];
    query: { done?: string };
}

const cardsList: LiveDescriptor<CardsRoute> = {
    method: 'get',
    path: '/cards',
    resourceId: 'CardsController.list',
    live: { shared: 'public', key: 'id' }
};

describe('liveStore', () => {
    test('subscribes on the first listener and reports the snapshot', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });
        const handle = liveStore(client, cardsList, { query: { done: 'false' } });
        const seen: unknown[] = [];

        handle.subscribe(state => seen.push(state.data));
        socket.onopen?.();

        const sub = JSON.parse(socket.sent.find(raw => raw.includes('"t":"sub"'))!);
        expect(sub.resource).toBe('CardsController.list');
        expect(sub.inputs.query).toEqual({ done: 'false' });

        socket.deliver({ t: 'snapshot', sid: sub.sid, rev: 1, hash: 'h1', data: [{ id: 1, title: 'a' }] });

        expect(handle.get().data).toEqual([{ id: 1, title: 'a' }]);
        expect(seen.at(-1)).toEqual([{ id: 1, title: 'a' }]);
    });

    test('get() works before anyone subscribes', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });
        const handle = liveStore(client, cardsList);

        expect(handle.get()).toEqual({ data: undefined, pending: true, error: null, stale: false });
        expect(socket.sent).toEqual([]);
    });

    test('close() drops the listener without touching the others', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });
        const first = liveStore(client, cardsList);
        const second = liveStore(client, cardsList);
        let firstSaw = 0;
        let secondSaw = 0;

        first.subscribe(() => { firstSaw += 1; });
        second.subscribe(() => { secondSaw += 1; });
        socket.onopen?.();

        const sub = JSON.parse(socket.sent.find(raw => raw.includes('"t":"sub"'))!);
        first.close();
        socket.deliver({ t: 'snapshot', sid: sub.sid, rev: 1, hash: 'h1', data: [] });

        expect(firstSaw).toBe(0);
        expect(secondSaw).toBe(1);
    });

    test('two handles for the same resource and inputs share one subscription', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });

        liveStore(client, cardsList, { query: { done: 'true' } }).subscribe(() => {});
        liveStore(client, cardsList, { query: { done: 'true' } }).subscribe(() => {});
        socket.onopen?.();

        expect(socket.sent.filter(raw => raw.includes('"t":"sub"')).length).toBe(1);
    });

    test('a plain resource id works without a descriptor', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });

        liveStore<number[]>(client, 'CardsController.list').subscribe(() => {});
        socket.onopen?.();

        expect(JSON.parse(socket.sent[1]).resource).toBe('CardsController.list');
    });

    test('a descriptor without @Live() is refused with a message that says what to do', () => {
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => fakeSocket() });
        const plain: LiveDescriptor<CardsRoute> = { method: 'get', path: '/cards' };

        expect(() => liveStore(client, plain)).toThrow(/not a live resource/);
    });
});

describe('liveStoreOf', () => {
    test('resolves a descriptor to the same store a resource id resolves to', () => {
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => fakeSocket() });

        const fromDescriptor = liveStoreOf(client, cardsList, {});
        const fromId = liveStoreOf(client, 'CardsController.list', {});

        expect(fromDescriptor).toBe(fromId);
    });
});

describe('LiveSlot', () => {
    test('reports the state of whatever it currently points at', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });
        const seen: unknown[] = [];
        const slot = new LiveSlot<{ id: number }[]>(client, state => seen.push(state.data));

        slot.point(cardsList, { query: { done: 'false' } });
        socket.onopen?.();

        const sub = JSON.parse(socket.sent.find(raw => raw.includes('"t":"sub"'))!);
        socket.deliver({ t: 'snapshot', sid: sub.sid, rev: 1, hash: 'h1', data: [{ id: 1 }] });

        expect(slot.get().data).toEqual([{ id: 1 }]);
        expect(seen.at(-1)).toEqual([{ id: 1 }]);
    });

    test('pointing at the same inputs again is a no-op, not a resubscribe', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });
        const slot = new LiveSlot(client, () => {});

        slot.point(cardsList, { query: { done: 'false' } });
        socket.onopen?.();
        const afterFirst = socket.sent.length;

        // A reactive input that recomputed to the same value must not churn
        // the subscription: the server would drop and rebuild the instance.
        slot.point(cardsList, { query: { done: 'false' } });

        expect(socket.sent.length).toBe(afterFirst);
    });

    test('pointing somewhere new releases the old target before retaining the new one', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket, unsubGraceMs: 0 });
        const slot = new LiveSlot(client, () => {});

        slot.point(cardsList, { query: { done: 'false' } });
        socket.onopen?.();
        slot.point(cardsList, { query: { done: 'true' } });

        // Order matters: holding both at once is how a dragged filter walks a
        // connection into maxInstancesPerConnection.
        const kinds = socket.sent.map(raw => JSON.parse(raw).t);
        expect(kinds.filter(kind => kind === 'sub').length).toBe(2);
        expect(kinds.indexOf('sub')).toBeLessThan(kinds.lastIndexOf('sub'));
    });

    test('a state message for the old target after a switch is ignored', () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });
        const seen: unknown[] = [];
        const slot = new LiveSlot<{ id: number }[]>(client, state => seen.push(state.data));

        slot.point(cardsList, { query: { done: 'false' } });
        socket.onopen?.();
        const first = JSON.parse(socket.sent.find(raw => raw.includes('"t":"sub"'))!);

        slot.point(cardsList, { query: { done: 'true' } });
        socket.deliver({ t: 'snapshot', sid: first.sid, rev: 1, hash: 'h1', data: [{ id: 9 }] });

        expect(seen.some(data => JSON.stringify(data) === JSON.stringify([{ id: 9 }]))).toBe(false);
    });

    test('close() releases whatever it was pointing at', async () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket, unsubGraceMs: 0 });
        const slot = new LiveSlot(client, () => {});

        slot.point(cardsList);
        socket.onopen?.();
        slot.close();

        // LiveClient always schedules unsub through setTimeout, even at 0ms.
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(socket.sent.some(raw => raw.includes('"t":"unsub"'))).toBe(true);
    });
});
