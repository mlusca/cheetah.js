import { describe, expect, test } from 'bun:test';
import { createApi, fillPath } from '../src/client/descriptor';
import type { RouteDescriptor } from '../src/client/descriptor';

interface Card {
    id: string;
    title: string;
}

const routes = {
    cards: {
        list: { method: 'get', path: '/cards', resourceId: 'BoardController.list', live: { shared: 'tenant', key: 'id' } } as RouteDescriptor<{ query: { status?: string }; response: Card[] }>,
        byId: { method: 'get', path: '/cards/:id', resourceId: 'BoardController.byId', live: { shared: 'private' } } as RouteDescriptor<{ params: { id: string }; response: Card }>,
        create: { method: 'post', path: '/cards' } as RouteDescriptor<{ body: { title: string }; response: Card }>
    }
} as const;

function recorder(payload: unknown = [{ id: '1', title: 'Ada' }]) {
    const calls: { url: string; method?: string; body?: unknown }[] = [];

    const fetcher = (async (input: unknown, init?: RequestInit) => {
        calls.push({ url: String(input), method: init?.method, body: init?.body });
        return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
    }) as typeof fetch;

    return { calls, fetcher };
}

describe('fillPath', () => {
    test('substitutes and encodes path parameters', () => {
        expect(fillPath('/cards/:id/notes', { id: 'a b' })).toBe('/cards/a%20b/notes');
    });

    test('refuses to build a URL with a hole in it', () => {
        expect(() => fillPath('/cards/:id', {})).toThrow(/Missing path parameter "id"/);
    });

    test('leaves a static path alone', () => {
        expect(fillPath('/cards')).toBe('/cards');
    });
});

describe('createApi', () => {
    test('calls the route and returns the parsed body', async () => {
        const { calls, fetcher } = recorder();
        const api = createApi(routes, { baseUrl: 'http://api.test', fetcher });

        const result = await api.cards.list({ query: { status: 'open' } });

        expect(calls[0].url).toBe('http://api.test/cards?status=open');
        expect(calls[0].method).toBe('GET');
        expect(result.data).toEqual([{ id: '1', title: 'Ada' }]);
    });

    test('fills path parameters', async () => {
        const { calls, fetcher } = recorder({ id: '7', title: 'Ada' });
        const api = createApi(routes, { baseUrl: 'http://api.test', fetcher });

        await api.cards.byId({ params: { id: '7' } });

        expect(calls[0].url).toBe('http://api.test/cards/7');
    });

    test('sends a JSON body on a POST', async () => {
        const { calls, fetcher } = recorder({ id: '2', title: 'New' });
        const api = createApi(routes, { baseUrl: 'http://api.test', fetcher });

        await api.cards.create({ body: { title: 'New' } });

        expect(calls[0].method).toBe('POST');
        expect(calls[0].body).toBe(JSON.stringify({ title: 'New' }));
    });

    test('the callable still carries the descriptor fields', () => {
        const { fetcher } = recorder();
        const api = createApi(routes, { baseUrl: 'http://api.test', fetcher });

        expect(api.cards.list.resourceId).toBe('BoardController.list');
        expect(api.cards.list.live).toEqual({ shared: 'tenant', key: 'id' });
        expect(api.cards.create.resourceId).toBeUndefined();
    });

    test('keeps the shape of the tree', () => {
        const { fetcher } = recorder();
        const api = createApi(routes, { baseUrl: 'http://api.test', fetcher });

        expect(typeof api.cards).toBe('object');
        expect(typeof api.cards.list).toBe('function');
    });
});
