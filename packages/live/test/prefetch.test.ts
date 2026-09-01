import { describe, expect, test } from 'bun:test';
import { Controller, Get, Query } from '@carno.js/core';
import { Live } from '../src/decorators/Live';
import { ResourceRegistry } from '../src/resource/ResourceRegistry';
import { prefetchLive } from '../src/resource/prefetch';
import { hydrationKey, toHydrateMap } from '../src/client/hydrate';
import { storeKey } from '../src/client/core';
import { fnv1a64 } from '../src/shared/hash';
import { canonical } from '../src/shared/canonical';

@Controller('/cards')
class CardsController {
    @Get('/')
    @Live({ shared: 'public', key: 'id' })
    list(@Query('done') done?: string) {
        return done === 'true' ? [{ id: 2 }] : [{ id: 1 }, { id: 2 }];
    }
}

function registry(): ResourceRegistry {
    const instance = new ResourceRegistry();
    instance.register(CardsController, new CardsController());
    return instance;
}

describe('prefetchLive', () => {
    test('returns the data and the hash the subscription will compare against', async () => {
        const payload = await prefetchLive(registry(), 'CardsController.list');

        expect(payload.data).toEqual([{ id: 1 }, { id: 2 }]);
        expect(payload.hash).toBe(fnv1a64(canonical([{ id: 1 }, { id: 2 }])));
        expect(payload.resourceId).toBe('CardsController.list');
    });

    test('passes the inputs to the handler', async () => {
        const payload = await prefetchLive(registry(), 'CardsController.list', { query: { done: 'true' } });

        expect(payload.data).toEqual([{ id: 2 }]);
    });

    test('normalises the inputs, so the key matches what the client will build', async () => {
        const payload = await prefetchLive(registry(), 'CardsController.list');

        expect(payload.inputs).toEqual({ params: {}, query: {}, body: undefined });
        expect(hydrationKey(payload)).toBe(storeKey('CardsController.list', { params: {}, query: {} }));
    });

    test('refuses a resource that is not registered, naming it', async () => {
        await expect(prefetchLive(registry(), 'Nope.thing')).rejects.toThrow(/Nope\.thing/);
    });

    test('does not register an instance anywhere', async () => {
        // The whole point: a rendered page that nobody subscribes to must not
        // leave a live instance behind being recomputed forever.
        const resources = registry();
        await prefetchLive(resources, 'CardsController.list');

        expect(resources.ids()).toEqual(['CardsController.list']);
    });
});

describe('toHydrateMap', () => {
    test('keys payloads exactly the way LiveClient looks them up', async () => {
        const resources = registry();
        const payloads = [
            await prefetchLive(resources, 'CardsController.list'),
            await prefetchLive(resources, 'CardsController.list', { query: { done: 'true' } })
        ];

        const map = toHydrateMap(payloads);

        expect(Object.keys(map).sort()).toEqual([
            storeKey('CardsController.list', { params: {}, query: {} }),
            storeKey('CardsController.list', { params: {}, query: { done: 'true' } })
        ].sort());
        expect(map[storeKey('CardsController.list', { params: {}, query: {} })].data).toEqual([{ id: 1 }, { id: 2 }]);
    });
});

describe('hydration end to end', () => {
    test('a hydrated client subscribes with the hash and never shows pending', async () => {
        const { LiveClient } = await import('../src/client/core');
        const payload = await prefetchLive(registry(), 'CardsController.list');

        const sent: string[] = [];
        const socket = {
            sent,
            send(data: string) { sent.push(data); },
            close() {},
            onopen: null as (() => void) | null,
            onmessage: null as ((event: { data: string }) => void) | null,
            onclose: null as (() => void) | null,
            onerror: null as ((error: unknown) => void) | null
        };

        const client = new LiveClient({
            url: 'ws://x/live',
            hydrate: toHydrateMap([payload]),
            socketFactory: () => socket as any
        });

        const store = client.store('CardsController.list', { params: {}, query: {} });

        expect(store.getSnapshot()).toEqual({
            data: [{ id: 1 }, { id: 2 }],
            pending: false,
            error: null,
            stale: false
        });

        store.subscribe(() => {});
        socket.onopen?.();

        const sub = JSON.parse(sent.find(raw => raw.includes('"t":"sub"'))!);
        expect(sub.hash).toBe(payload.hash);
    });
});
