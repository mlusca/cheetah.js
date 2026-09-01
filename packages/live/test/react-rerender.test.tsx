import './happydom';
import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { createElement, useRef } from 'react';
import { LiveClient, type LiveSocket } from '../src/client/core';
import { LiveProvider, useLive } from '../src/client/react';

/** A socket the test drives by hand: nothing is sent, everything is injected. */
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

afterEach(cleanup);

describe('useLive re-rendering', () => {
    test('a snapshot after mount re-renders the component with the new data', async () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });

        function Cards() {
            const { data, pending } = useLive<{ id: number }[]>('CardsController.list');
            return createElement('div', { 'data-testid': 'out' }, pending ? 'pending' : String(data?.length ?? 0));
        }

        const screen = render(createElement(LiveProvider, { client }, createElement(Cards)));

        expect(screen.getByTestId('out').textContent).toBe('pending');

        await act(async () => {
            socket.onopen?.();
            socket.deliver({ t: 'snapshot', sid: 's0', rev: 1, hash: 'h1', data: [{ id: 1 }, { id: 2 }] });
        });

        expect(screen.getByTestId('out').textContent).toBe('2');
    });

    test('a message that establishes nothing new does not re-render', async () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });
        let renders = 0;

        function Cards() {
            renders += 1;
            const { data } = useLive<{ id: number }[]>('CardsController.list');
            return createElement('div', { 'data-testid': 'out' }, String(data?.length ?? 0));
        }

        render(createElement(LiveProvider, { client }, createElement(Cards)));

        await act(async () => {
            socket.onopen?.();
            socket.deliver({ t: 'snapshot', sid: 's0', rev: 1, hash: 'h1', data: [{ id: 1 }] });
        });

        const afterSnapshot = renders;

        // Same data, same flags. The store has to keep the identical state
        // object here, or useSyncExternalStore re-renders forever.
        await act(async () => {
            socket.deliver({ t: 'current', sid: 's0', rev: 1, hash: 'h1' });
        });

        expect(renders).toBe(afterSnapshot);
    });

    test('the data object stays referentially identical across a no-op message', async () => {
        const socket = fakeSocket();
        const client = new LiveClient({ url: 'ws://x/live', socketFactory: () => socket });
        const seen: unknown[] = [];

        function Cards() {
            const { data } = useLive<{ id: number }[]>('CardsController.list');
            const previous = useRef<unknown>(null);

            if (data !== previous.current) {
                previous.current = data;
                seen.push(data);
            }

            return createElement('div', null, String(data?.length ?? 0));
        }

        render(createElement(LiveProvider, { client }, createElement(Cards)));

        await act(async () => {
            socket.onopen?.();
            socket.deliver({ t: 'snapshot', sid: 's0', rev: 1, hash: 'h1', data: [{ id: 1 }] });
            socket.deliver({ t: 'current', sid: 's0', rev: 1, hash: 'h1' });
        });

        // undefined at mount, then the array. A third entry would mean the
        // store handed out a new object for content that did not change.
        expect(seen.length).toBe(2);
    });

    test('unmounting releases the subscription after the grace period', async () => {
        const socket = fakeSocket();
        const client = new LiveClient({
            url: 'ws://x/live',
            socketFactory: () => socket,
            unsubGraceMs: 1
        });

        function Cards() {
            useLive('CardsController.list');
            return null;
        }

        const screen = render(createElement(LiveProvider, { client }, createElement(Cards)));

        await act(async () => { socket.onopen?.(); });

        expect(socket.sent.some(raw => raw.includes('"t":"sub"'))).toBe(true);

        screen.unmount();
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(socket.sent.some(raw => raw.includes('"t":"unsub"'))).toBe(true);
    });
});
