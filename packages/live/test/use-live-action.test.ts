import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveClient, storeKey, type LiveSocket } from '../src/client/core';
import { LiveProvider, useLiveAction } from '../src/client/react';
import type { LiveDescriptor } from '../src/shared/descriptor';

interface Card {
    id: string;
    title: string;
}

const listDescriptor = {
    method: 'get',
    path: '/cards',
    resourceId: 'BoardController.list',
    live: { shared: 'public', key: 'id' }
} as LiveDescriptor<{ response: Card[] }>;

class SilentSocket implements LiveSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;
    send(): void {}
    close(): void {}
}

function clientWithBoard() {
    const inputs = { params: {}, query: {}, body: undefined };
    const client = new LiveClient({
        url: 'ws://test/live',
        socketFactory: () => new SilentSocket(),
        hydrate: {
            [storeKey('BoardController.list', inputs)]: {
                data: [{ id: '1', title: 'Ada' }],
                hash: 'h1'
            }
        }
    });

    const store = client.store<Card[]>('BoardController.list', inputs);
    store.subscribe(() => {});

    return { client, store };
}

/** Render once so the hook runs, and hand the produced action back out. */
function actionFrom(client: LiveClient, build: () => (dto: any) => Promise<any>) {
    let captured: ((dto: any) => Promise<any>) | null = null;

    function Probe() {
        captured = build();
        return null;
    }

    renderToStaticMarkup(createElement(LiveProvider, { client }, createElement(Probe)));

    return captured!;
}

describe('useLiveAction', () => {
    test('applies the overlay while the action is in flight and drops it after', async () => {
        const { client, store } = clientWithBoard();
        const seen: unknown[] = [];
        let release: (() => void) | null = null;

        const send = actionFrom(client, () =>
            useLiveAction(
                (dto: { title: string }) =>
                    new Promise<Card>(resolve => {
                        release = () => resolve({ id: '2', title: dto.title });
                    }),
                {
                    optimistic: [{
                        on: listDescriptor,
                        apply: (draft, dto) => {
                            draft.push({ id: 'temp', title: dto.title });
                        }
                    }]
                }
            )
        );

        const pending = send({ title: 'Linus' });
        seen.push(store.getSnapshot().data);

        release!();
        await pending;
        seen.push(store.getSnapshot().data);

        expect(seen[0]).toEqual([{ id: '1', title: 'Ada' }, { id: 'temp', title: 'Linus' }]);
        expect(seen[1]).toEqual([{ id: '1', title: 'Ada' }]);
    });

    test('drops the overlay when the action fails', async () => {
        const { client, store } = clientWithBoard();

        const send = actionFrom(client, () =>
            useLiveAction(
                async () => {
                    throw new Error('rejected by the server');
                },
                {
                    optimistic: [{
                        on: listDescriptor,
                        apply: draft => {
                            draft.push({ id: 'temp', title: 'never' });
                        }
                    }]
                }
            )
        );

        await expect(send({})).rejects.toThrow('rejected by the server');
        expect(store.getSnapshot().data).toEqual([{ id: '1', title: 'Ada' }]);
    });

    test('an action with no optimistic entry just runs', async () => {
        const { client, store } = clientWithBoard();

        const send = actionFrom(client, () => useLiveAction(async (dto: { title: string }) => dto.title));

        await expect(send({ title: 'plain' })).resolves.toBe('plain');
        expect(store.getSnapshot().data).toEqual([{ id: '1', title: 'Ada' }]);
    });
});
