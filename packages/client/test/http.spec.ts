import { describe, expect, test } from 'bun:test';
import { client } from '../src/client/http';
import type { App } from './http-app';

type FetchCall = {
    url: string;
    init?: RequestInit;
};

function mockFetch(calls: FetchCall[], impl: (url: string, init?: RequestInit) => Promise<Response>) {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        return impl(url, init);
    }) as typeof fetch;
}

describe('client', () => {
    test('builds nested paths, interpolates params and serializes query/body', async () => {
        const calls: FetchCall[] = [];
        const api = client<App>('http://localhost:3000', {
            fetcher: mockFetch(calls, async () =>
                new Response(JSON.stringify({ id: '42', name: 'Ada', email: 'ada@x.com' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                })
            ),
            headers: { Authorization: 'Bearer test' }
        });

        const listed = await api.users.get({ query: { page: '1' } });
        expect(listed.error).toBeNull();
        expect(listed.data).toEqual({ id: '42', name: 'Ada', email: 'ada@x.com' });
        expect(calls[0].url).toBe('http://localhost:3000/users?page=1');
        expect(calls[0].init?.method).toBe('GET');
        expect((calls[0].init?.headers as Headers).get('Authorization')).toBe('Bearer test');

        const user = await api.users({ id: '42' }).get();
        expect(user.error).toBeNull();
        expect(calls[1].url).toBe('http://localhost:3000/users/42');

        const created = await api.users.post({ name: 'Ada', email: 'ada@x.com' });
        expect(created.error).toBeNull();
        expect(calls[2].url).toBe('http://localhost:3000/users');
        expect(calls[2].init?.method).toBe('POST');
        expect(calls[2].init?.body).toBe(JSON.stringify({ name: 'Ada', email: 'ada@x.com' }));
        expect((calls[2].init?.headers as Headers).get('Content-Type')).toBe('application/json');

        await api.users({ id: '9' }).posts.post({ title: 'Hi' });
        expect(calls[3].url).toBe('http://localhost:3000/users/9/posts');
        expect(calls[3].init?.method).toBe('POST');
        expect(calls[3].init?.body).toBe(JSON.stringify({ title: 'Hi' }));
    });

    test('resolves relative bases without requiring an absolute origin', async () => {
        const sameOrigin: FetchCall[] = [];
        const sameOriginApi = client<App>('', {
            fetcher: mockFetch(sameOrigin, async () => Response.json({ id: '1' }))
        });

        await sameOriginApi.users.get({ query: { page: '1' } });
        expect(sameOrigin[0].url).toBe('/users?page=1');

        const prefixed: FetchCall[] = [];
        const prefixedApi = client<App>('/api', {
            fetcher: mockFetch(prefixed, async () => Response.json({ id: '1' }))
        });

        await prefixedApi.users({ id: '42' }).get();
        expect(prefixed[0].url).toBe('/api/users/42');
    });

    test('returns data: null for 204 and empty bodies', async () => {
        const api = client<App>('http://localhost:3000', {
            fetcher: mockFetch([], async (_url, init) => {
                if (init?.method === 'DELETE') {
                    return new Response(null, { status: 204 });
                }
                return new Response('', { status: 200 });
            })
        });

        const removed = await api.users({ id: '42' }).delete();
        expect(removed.error).toBeNull();
        expect(removed.status).toBe(204);
        expect(removed.data).toBeNull();
        const voidData: null = removed.data;

        const empty = await api.users.get();
        expect(empty.error).toBeNull();
        expect(empty.data).toBeNull();
        expect(voidData).toBeNull();
    });

    test('returns typed error objects and can throw instead', async () => {
        const failing = client('http://localhost:3000', {
            fetcher: mockFetch([], async () =>
                new Response(JSON.stringify({ statusCode: 404, message: 'Not Found' }), { status: 404 })
            )
        });

        const result = await failing.users({ id: 'missing' }).get();
        expect(result.data).toBeNull();
        expect(result.error?.status).toBe(404);
        expect(result.error?.value).toEqual({ statusCode: 404, message: 'Not Found' });

        const throwing = client('http://localhost:3000', {
            onError: 'throw',
            fetcher: mockFetch([], async () =>
                new Response(JSON.stringify({ statusCode: 400, message: 'Bad Request', errors: ['name'] }), {
                    status: 400
                })
            )
        });

        try {
            await throwing.users.post({ name: '', email: '' });
            throw new Error('expected throw');
        } catch (error) {
            expect((error as Error).message).toBe('Bad Request');
            expect((error as { status: number }).status).toBe(400);
            expect((error as { value: { errors?: unknown[] } }).value.errors).toEqual(['name']);
        }
    });
});
