import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { LiveClient, type LiveSocket } from '../src/client/core';
import { LiveProvider, useLive } from '../src/client/react';

function silentSocket(): LiveSocket {
    return {
        send() {},
        close() {},
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null
    };
}

function clientWith(hydrate: Record<string, { data: unknown; hash: string }>): LiveClient {
    return new LiveClient({ url: 'ws://test/live', hydrate, socketFactory: silentSocket });
}

describe('useLive', () => {
    test('renders hydrated server state on the first pass, with no round trip', () => {
        const client = clientWith({
            'UsersController.list|{"body":null,"params":{},"query":{"status":"active"}}': {
                data: [{ id: 1, name: 'Ada' }],
                hash: 'h1'
            }
        });

        function UserList() {
            const { data, stale } = useLive<{ id: number; name: string }[]>(
                'UsersController.list',
                { query: { status: 'active' } }
            );

            return createElement(
                'ul',
                { 'data-stale': String(stale) },
                (data ?? []).map(user => createElement('li', { key: user.id }, user.name))
            );
        }

        const html = renderToString(
            createElement(LiveProvider, { client }, createElement(UserList))
        );

        expect(html).toContain('Ada');
        expect(html).toContain('data-stale="false"');
    });

    test('renders the pending state when nothing was hydrated', () => {
        const client = clientWith({});

        function Pending() {
            const { pending } = useLive('UsersController.list');
            return createElement('span', null, pending ? 'loading' : 'ready');
        }

        const html = renderToString(createElement(LiveProvider, { client }, createElement(Pending)));

        expect(html).toContain('loading');
    });

    test('the same resource and inputs resolve to the same store instance', () => {
        const client = clientWith({});
        const a = client.store('r', { params: {}, query: { x: '1' } });
        const b = client.store('r', { params: {}, query: { x: '1' } });
        const c = client.store('r', { params: {}, query: { x: '2' } });

        expect(a).toBe(b);
        expect(a).not.toBe(c);
    });

    test('fails loudly outside a provider', () => {
        function Orphan() {
            useLive('r');
            return null;
        }

        expect(() => renderToString(createElement(Orphan))).toThrow(/LiveProvider/);
    });
});
