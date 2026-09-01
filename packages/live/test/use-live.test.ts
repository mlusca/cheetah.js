import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveClient, storeKey, type LiveSocket } from '../src/client/core';
import { LiveProvider, useLive } from '../src/client/react';
import {
    normalizeLiveInputs,
    resourceIdOf,
    type LiveDescriptor
} from '../src/shared/descriptor';

interface Card {
    id: string;
    title: string;
}

const listDescriptor = {
    method: 'get',
    path: '/cards',
    resourceId: 'BoardController.list',
    live: { shared: 'tenant', key: 'id' }
} as LiveDescriptor<{ query: { status?: string }; response: Card[] }>;

const plainDescriptor = {
    method: 'post',
    path: '/cards'
} as LiveDescriptor<{ body: { title: string }; response: Card }>;

class SilentSocket implements LiveSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;
    send(): void {}
    close(): void {}
}

describe('resourceIdOf', () => {
    test('returns the id of a live route', () => {
        expect(resourceIdOf(listDescriptor)).toBe('BoardController.list');
    });

    test('explains itself when the route is not live', () => {
        expect(() => resourceIdOf(plainDescriptor)).toThrow(/not a live resource/);
    });
});

describe('normalizeLiveInputs', () => {
    test('fills the three slots', () => {
        expect(normalizeLiveInputs({ query: { status: 'open' } })).toEqual({
            params: {},
            query: { status: 'open' },
            body: undefined
        });
    });

    test('accepts nothing at all', () => {
        expect(normalizeLiveInputs()).toEqual({ params: {}, query: {}, body: undefined });
    });
});

describe('useLive with a descriptor', () => {
    test('reads the hydrated store for that resource and inputs', () => {
        const inputs = { params: {}, query: { status: 'open' }, body: undefined };
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

        function Board() {
            const state = useLive(listDescriptor, { query: { status: 'open' } });
            return createElement('div', null, JSON.stringify(state.data ?? null));
        }

        const html = renderToStaticMarkup(
            createElement(LiveProvider, { client }, createElement(Board))
        );

        expect(html).toContain('Ada');
    });

    test('the string form from phase 1 still works', () => {
        const inputs = { params: {}, query: {}, body: undefined };
        const client = new LiveClient({
            url: 'ws://test/live',
            socketFactory: () => new SilentSocket(),
            hydrate: {
                [storeKey('BoardController.list', inputs)]: { data: [{ id: '9' }], hash: 'h9' }
            }
        });

        function Board() {
            const state = useLive<{ id: string }[]>('BoardController.list');
            return createElement('div', null, JSON.stringify(state.data ?? null));
        }

        const html = renderToStaticMarkup(
            createElement(LiveProvider, { client }, createElement(Board))
        );

        expect(html).toContain('&quot;9&quot;');
    });
});
