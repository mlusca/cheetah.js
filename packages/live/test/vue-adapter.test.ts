import { describe, expect, test } from 'bun:test';
import { effectScope, nextTick, ref } from 'vue';
import { LiveClient, type LiveSocket } from '../src/client/core';
import { useLiveQuery } from '../src/client/vue';
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

function harness() {
    const socket = fakeSocket();
    const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket, unsubGraceMs: 0 });
    const scope = effectScope();

    const lastSub = () => {
        const raw = [...socket.sent].reverse().find(entry => entry.includes('"t":"sub"'));
        return raw ? JSON.parse(raw) : null;
    };

    return { socket, client, scope, lastSub };
}

describe('useLiveQuery', () => {
    test('starts pending and fills in from a snapshot', () => {
        const { socket, client, scope, lastSub } = harness();
        const state = scope.run(() => useLiveQuery(cardsList, undefined, { client }))!;

        expect(state.value.pending).toBe(true);

        socket.onopen?.();
        socket.deliver({ t: 'snapshot', sid: lastSub().sid, rev: 1, hash: 'h1', data: [{ id: 1, title: 'a' }] });

        expect(state.value.data).toEqual([{ id: 1, title: 'a' }]);
        expect(state.value.pending).toBe(false);
        scope.stop();
    });

    test('changing a reactive input resubscribes', async () => {
        const { socket, client, scope, lastSub } = harness();
        const done = ref('false');

        scope.run(() => useLiveQuery(cardsList, () => ({ query: { done: done.value } }), { client }));
        socket.onopen?.();

        expect(lastSub().inputs.query).toEqual({ done: 'false' });

        done.value = 'true';
        await nextTick();
        // LiveClient always schedules unsub through setTimeout, even at 0ms.
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(lastSub().inputs.query).toEqual({ done: 'true' });
        expect(socket.sent.filter(raw => raw.includes('"t":"unsub"')).length).toBe(1);
        scope.stop();
    });

    test('a reactive input that recomputes to the same value does not resubscribe', async () => {
        const { socket, client, scope } = harness();
        const unrelated = ref(0);

        scope.run(() => useLiveQuery(cardsList, () => {
            void unrelated.value;
            return { query: { done: 'false' } };
        }, { client }));
        socket.onopen?.();
        const before = socket.sent.length;

        unrelated.value = 1;
        await nextTick();

        expect(socket.sent.length).toBe(before);
        scope.stop();
    });

    test('stopping the scope unsubscribes', async () => {
        const { socket, client, scope } = harness();

        scope.run(() => useLiveQuery(cardsList, undefined, { client }));
        socket.onopen?.();
        scope.stop();

        // LiveClient always schedules unsub through setTimeout, even at 0ms.
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(socket.sent.some(raw => raw.includes('"t":"unsub"'))).toBe(true);
    });

    test('the ref is shallow: the state object is replaced, never mutated', () => {
        const { socket, client, scope, lastSub } = harness();
        const state = scope.run(() => useLiveQuery(cardsList, undefined, { client }))!;
        const first = state.value;

        socket.onopen?.();
        socket.deliver({ t: 'snapshot', sid: lastSub().sid, rev: 1, hash: 'h1', data: [] });

        expect(state.value).not.toBe(first);
        scope.stop();
    });
});
