import { afterEach, describe, expect, test } from 'bun:test';
import { Controller, Get, Use } from '@carno.js/core';
import { createTestHarness } from '@carno.js/core';
import { Live, LivePlugin } from '../src';
import type { LiveAuthorizationRequest, LiveAuthorizer } from '../src/auth/authorizer';
import type { LiveScopeResolver } from '../src/transport/scope-resolver';
import { PollingTransport } from '../src/client/transport';
import { closeLiveRuntime } from '../src/runtime';

@Controller('/private')
class PrivateController {
    @Get('/')
    @Live({ shared: 'private' })
    read() {
        return { secret: true };
    }
}

class DenyPolling implements LiveAuthorizer {
    calls = 0;

    authorize(_request: LiveAuthorizationRequest): boolean {
        this.calls++;
        return false;
    }
}

class AllowPolling implements LiveAuthorizer {
    calls = 0;

    authorize(_request: LiveAuthorizationRequest): boolean {
        this.calls++;
        return true;
    }
}

@Controller('/scoped')
@Use(ctx => {
    if (ctx.headers.get('x-live-tenant') !== 'acme') {
        return new Response('forbidden', { status: 403 });
    }
})
class ScopedController {
    @Get('/')
    @Live({ shared: 'private' })
    read() {
        return { tenant: 'acme' };
    }
}

describe('PollingTransport authorization', () => {
    afterEach(async () => {
        await closeLiveRuntime();
    });

    test('consults the live scope and authorizer instead of polling the route anonymously', async () => {
        const authorizer = new DenyPolling();
        let resolvedToken: string | undefined;
        const resolver: LiveScopeResolver = {
            resolve: async ({ token }) => {
                resolvedToken = token;
                return { principal: 'ada' };
            }
        };
        const harness = await createTestHarness({
            plugins: [LivePlugin.create({
                controllers: [PrivateController],
                scopeResolver: resolver,
                authorizer
            })],
            listen: true
        });

        const received: unknown[] = [];
        const nativeFetch = (globalThis as { __carnoNativeFetch?: typeof fetch }).__carnoNativeFetch ?? fetch;
        const transport = new PollingTransport(
            `http://127.0.0.1:${harness.port}`,
            {
                'PrivateController.read': { method: 'GET', path: '/private' }
            },
            {
                intervalMs: 10_000,
                token: 'poll-secret',
                fetch: (async (url, init) => nativeFetch(url, init)) as typeof fetch
            }
        );

        try {
            transport.start({
                onOpen: () => {},
                onMessage: raw => received.push(JSON.parse(raw)),
                onClose: () => {}
            });
            transport.send(JSON.stringify({
                t: 'sub',
                sid: 's1',
                resource: 'PrivateController.read',
                inputs: { params: {}, query: {} }
            }));

            await new Promise(resolve => setTimeout(resolve, 30));

            expect(authorizer.calls).toBe(1);
            expect(resolvedToken).toBe('poll-secret');
            expect(received[0]).toMatchObject({ t: 'error', sid: 's1', code: 'forbidden' });
        } finally {
            transport.close();
            await harness.close();
        }
    });

    test('propagates the token and resolver headers through the HTTP route pipeline', async () => {
        const authorizer = new AllowPolling();
        let resolvedToken: string | undefined;
        const resolver: LiveScopeResolver = {
            resolve: async ({ token }) => {
                resolvedToken = token;
                return { principal: 'ada', headers: { 'x-live-tenant': 'acme' } };
            }
        };
        const harness = await createTestHarness({
            plugins: [LivePlugin.create({
                controllers: [ScopedController],
                scopeResolver: resolver,
                authorizer
            })],
            listen: true
        });

        const received: unknown[] = [];
        const nativeFetch = (globalThis as { __carnoNativeFetch?: typeof fetch }).__carnoNativeFetch ?? fetch;
        const transport = new PollingTransport(
            `http://127.0.0.1:${harness.port}`,
            { 'ScopedController.read': { method: 'GET', path: '/scoped' } },
            {
                intervalMs: 10_000,
                token: 'poll-secret',
                fetch: (async (url, init) => nativeFetch(url, init)) as typeof fetch
            }
        );

        try {
            transport.start({
                onOpen: () => {},
                onMessage: raw => received.push(JSON.parse(raw)),
                onClose: () => {}
            });
            transport.send(JSON.stringify({
                t: 'sub',
                sid: 's1',
                resource: 'ScopedController.read',
                inputs: { params: {}, query: {} }
            }));

            await new Promise(resolve => setTimeout(resolve, 30));

            expect(resolvedToken).toBe('poll-secret');
            expect(authorizer.calls).toBe(1);
            expect(received[0]).toMatchObject({
                t: 'snapshot',
                sid: 's1',
                data: { tenant: 'acme' }
            });
        } finally {
            transport.close();
            await harness.close();
        }
    });
});
