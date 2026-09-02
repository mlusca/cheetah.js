import { describe, expect, test } from 'bun:test';
import { Context, Controller, Get, Post } from '@carno.js/core';
import { Live } from '../src/decorators/Live';
import { LiveETagMiddleware, pathMatcher } from '../src/http/etag';
import { ResourceRegistry } from '../src/resource/ResourceRegistry';
import { directResourceExecutor } from './resource-registry-helper';

const LIVE_PATHS = [
    { method: 'GET', path: '/cards' },
    { method: 'GET', path: '/cards/:id' },
    { method: 'POST', path: '/cards/search' }
];

function contextFor(url: string, headers: Record<string, string> = {}, method = 'GET'): Context {
    return new Context(new Request(url, { method, headers }));
}

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
}

describe('pathMatcher', () => {
    test('a :param matches exactly one segment', () => {
        const matcher = pathMatcher('/cards/:id');

        expect(matcher.test('/cards/42')).toBe(true);
        expect(matcher.test('/cards')).toBe(false);
        expect(matcher.test('/cards/42/comments')).toBe(false);
    });

    test('a literal path matches only itself', () => {
        const matcher = pathMatcher('/cards');

        expect(matcher.test('/cards')).toBe(true);
        expect(matcher.test('/cardsx')).toBe(false);
    });
});

describe('LiveETagMiddleware', () => {
    test('adds an ETag to a live GET', async () => {
        const middleware = new LiveETagMiddleware(LIVE_PATHS);
        const response = await middleware.handle(contextFor('http://x/cards'), async () =>
            jsonResponse([{ id: 1 }])
        );

        expect((response as Response).headers.get('ETag')).toMatch(/^"[0-9a-f]+"$/);
    });

    test('answers 304 with no body when If-None-Match matches', async () => {
        const middleware = new LiveETagMiddleware(LIVE_PATHS);
        const first = await middleware.handle(contextFor('http://x/cards'), async () =>
            jsonResponse([{ id: 1 }])
        ) as Response;
        const tag = first.headers.get('ETag')!;

        const second = await middleware.handle(
            contextFor('http://x/cards', { 'If-None-Match': tag }),
            async () => jsonResponse([{ id: 1 }])
        ) as Response;

        expect(second.status).toBe(304);
        expect(await second.text()).toBe('');
        expect(second.headers.get('ETag')).toBe(tag);
    });

    test('answers 200 when the content changed', async () => {
        const middleware = new LiveETagMiddleware(LIVE_PATHS);
        const first = await middleware.handle(contextFor('http://x/cards'), async () =>
            jsonResponse([{ id: 1 }])
        ) as Response;

        const second = await middleware.handle(
            contextFor('http://x/cards', { 'If-None-Match': first.headers.get('ETag')! }),
            async () => jsonResponse([{ id: 1 }, { id: 2 }])
        ) as Response;

        expect(second.status).toBe(200);
        expect(await second.json()).toEqual([{ id: 1 }, { id: 2 }]);
    });

    test('the hash is of the canonical content, not of the byte order', async () => {
        const middleware = new LiveETagMiddleware(LIVE_PATHS);
        const ordered = await middleware.handle(contextFor('http://x/cards'), async () =>
            jsonResponse({ a: 1, b: 2 })
        ) as Response;

        const reordered = await middleware.handle(
            contextFor('http://x/cards', { 'If-None-Match': ordered.headers.get('ETag')! }),
            async () => jsonResponse({ b: 2, a: 1 })
        ) as Response;

        // Same content, different key order. A byte hash would send it again.
        expect(reordered.status).toBe(304);
    });

    test('a path that is not live is left alone', async () => {
        const middleware = new LiveETagMiddleware(LIVE_PATHS);
        const response = await middleware.handle(contextFor('http://x/health'), async () =>
            jsonResponse({ ok: true })
        ) as Response;

        expect(response.headers.get('ETag')).toBeNull();
    });

    test('a live POST is left alone', async () => {
        const middleware = new LiveETagMiddleware(LIVE_PATHS);
        const response = await middleware.handle(
            contextFor('http://x/cards/search', {}, 'POST'),
            async () => jsonResponse([])
        ) as Response;

        // POST is not cacheable, and conditional polling on it means nothing.
        expect(response.headers.get('ETag')).toBeNull();
    });

    test('rejects a polling request without its resource id', async () => {
        let downstream = false;
        const middleware = new LiveETagMiddleware([
            { method: 'GET', path: '/cards', resourceId: 'CardsController.list' }
        ]);
        middleware.setPollingGuard(() => ({ principal: 'ada' }));

        const response = await middleware.handle(
            contextFor('http://x/cards', { 'X-Carno-Live-Poll': '1' }),
            async () => {
                downstream = true;
                return jsonResponse([]);
            }
        ) as Response;

        expect(response.status).toBe(403);
        expect(downstream).toBe(false);
    });

    test('a non-200 is left alone', async () => {
        const middleware = new LiveETagMiddleware(LIVE_PATHS);
        const response = await middleware.handle(contextFor('http://x/cards'), async () =>
            new Response('nope', { status: 500 })
        ) as Response;

        expect(response.headers.get('ETag')).toBeNull();
    });

    test('a non-JSON body is left alone', async () => {
        const middleware = new LiveETagMiddleware(LIVE_PATHS);
        const response = await middleware.handle(contextFor('http://x/cards'), async () =>
            new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
        ) as Response;

        expect(response.headers.get('ETag')).toBeNull();
    });

    test('the downstream response is still readable by the caller', async () => {
        const middleware = new LiveETagMiddleware(LIVE_PATHS);
        const response = await middleware.handle(contextFor('http://x/cards'), async () =>
            jsonResponse([{ id: 7 }])
        ) as Response;

        // Hashing consumed the body once; the caller has to get a fresh one.
        expect(await response.json()).toEqual([{ id: 7 }]);
    });
});

describe('ResourceRegistry.livePaths', () => {
    test('joins the controller prefix with the handler path', () => {
        @Controller('/cards')
        class CardsController {
            @Get('/')
            @Live({ shared: 'public' })
            list() { return []; }

            @Get('/:id')
            @Live({ shared: 'public' })
            one() { return {}; }

            @Post('/search')
            @Live({ shared: 'public' })
            search() { return []; }
        }

        const registry = new ResourceRegistry();
        registry.register(CardsController, new CardsController(), directResourceExecutor);

        expect(registry.livePaths().sort((a, b) => a.path.localeCompare(b.path))).toEqual([
            { method: 'GET', path: '/cards', resourceId: 'CardsController.list' },
            { method: 'GET', path: '/cards/:id', resourceId: 'CardsController.one' },
            { method: 'POST', path: '/cards/search', resourceId: 'CardsController.search' }
        ]);
    });
});
