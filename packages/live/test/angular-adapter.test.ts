import { beforeEach, describe, expect, test } from 'bun:test';
import { EnvironmentInjector, Injector, runInInjectionContext, signal } from '@angular/core';
import { LiveClient, type LiveSocket } from '../src/client/core';
import { LIVE_CLIENT, liveSignal, provideLive, reconcileLiveSignal } from '../src/client/angular';
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

let socket: ReturnType<typeof fakeSocket>;
let client: LiveClient;
let injector: Injector;

beforeEach(() => {
    socket = fakeSocket();
    client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket, unsubGraceMs: 0 });
    injector = Injector.create({ providers: [provideLive(client)] });
});

function lastSub(): any {
    const raw = [...socket.sent].reverse().find(entry => entry.includes('"t":"sub"'));
    return raw ? JSON.parse(raw) : null;
}

function host<T>(fn: () => T): T {
    return runInInjectionContext(injector, fn);
}

describe('liveSignal', () => {
    test('starts pending and reads the client from LIVE_CLIENT', () => {
        const state = host(() => liveSignal(cardsList));
        reconcileLiveSignal(state);

        expect(injector.get(LIVE_CLIENT)).toBe(client);
        expect(state()).toEqual({ data: undefined, pending: true, error: null, stale: false });
    });

    test('a snapshot updates the signal', () => {
        const state = host(() => liveSignal(cardsList));
        reconcileLiveSignal(state);
        socket.onopen?.();
        socket.deliver({ t: 'snapshot', sid: lastSub().sid, rev: 1, hash: 'h1', data: [{ id: 1, title: 'a' }] });

        expect(state().data).toEqual([{ id: 1, title: 'a' }]);
        expect(state().pending).toBe(false);
    });

    test('changing a reactive input resubscribes with the new inputs', async () => {
        const done = signal('false');
        const state = host(() =>
            liveSignal(cardsList, () => ({ query: { done: done() } }))
        );
        reconcileLiveSignal(state);
        socket.onopen?.();

        expect(lastSub().inputs.query).toEqual({ done: 'false' });

        done.set('true');
        reconcileLiveSignal(state);

        expect(lastSub().inputs.query).toEqual({ done: 'true' });
        // LiveClient always schedules unsub through setTimeout, even at 0ms.
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(socket.sent.filter(raw => raw.includes('"t":"unsub"')).length).toBe(1);
        void state;
    });

    test('a reactive input that recomputes to the same value does not resubscribe', () => {
        const unrelated = signal(0);
        const state = host(() =>
            liveSignal(cardsList, () => {
                void unrelated();
                return { query: { done: 'false' } };
            })
        );
        reconcileLiveSignal(state);
        socket.onopen?.();
        const before = socket.sent.length;

        unrelated.set(1);
        reconcileLiveSignal(state);

        expect(socket.sent.length).toBe(before);
        void state;
    });

    test('destroying the injection context unsubscribes', async () => {
        const state = host(() => liveSignal(cardsList));
        reconcileLiveSignal(state);
        socket.onopen?.();

        (injector as EnvironmentInjector).destroy();

        // LiveClient always schedules unsub through setTimeout, even at 0ms.
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(socket.sent.some(raw => raw.includes('"t":"unsub"'))).toBe(true);
    });

    test('an explicit client wins over the injected one', () => {
        const otherSocket = fakeSocket();
        const other = new LiveClient({ url: 'ws://y/live', socketFactory: () => otherSocket });

        const state = host(() => liveSignal(cardsList, undefined, { client: other }));
        reconcileLiveSignal(state);
        otherSocket.onopen?.();

        expect(otherSocket.sent.some(raw => raw.includes('"t":"sub"'))).toBe(true);
        expect(socket.sent).toEqual([]);
    });
});
