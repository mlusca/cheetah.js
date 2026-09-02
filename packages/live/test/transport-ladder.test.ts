import { describe, expect, test } from 'bun:test';
import {
    LadderTransport,
    PollingTransport,
    SseClientTransport,
    routeIndex,
    type ClientTransport,
    type TransportHandlers
} from '../src/client/transport';

const GENERATED_ROUTES = {
    cards: {
        list: { method: 'get', path: '/cards', resourceId: 'CardsController.list', live: { shared: 'public' } },
        one: { method: 'get', path: '/cards/:id', resourceId: 'CardsController.one', live: { shared: 'public' } }
    },
    health: {
        check: { method: 'get', path: '/health' }
    }
};

function stubTransport(kind: ClientTransport['kind'], behaviour: 'open' | 'fail'): ClientTransport & { started: number } {
    const transport = {
        kind,
        started: 0,
        start(handlers: TransportHandlers) {
            transport.started += 1;
            queueMicrotask(() => (behaviour === 'open' ? handlers.onOpen() : handlers.onClose()));
        },
        send() {},
        close() {}
    };

    return transport;
}

describe('routeIndex', () => {
    test('flattens the generated tree into resourceId to path', () => {
        expect(routeIndex(GENERATED_ROUTES)).toEqual({
            'CardsController.list': { method: 'get', path: '/cards' },
            'CardsController.one': { method: 'get', path: '/cards/:id' }
        });
    });

    test('skips routes that are not live, because polling one means nothing', () => {
        expect(routeIndex(GENERATED_ROUTES)['HealthController.check']).toBeUndefined();
    });

    test('skips live POST routes because polling only has a GET body', () => {
        expect(routeIndex({
            search: {
                run: { method: 'post', path: '/cards/search', resourceId: 'CardsController.search', live: {} }
            }
        })['CardsController.search']).toBeUndefined();
    });

    test('an empty or absent tree is an empty index, not a throw', () => {
        expect(routeIndex(undefined)).toEqual({});
        expect(routeIndex({})).toEqual({});
    });
});

describe('LadderTransport', () => {
    test('stays on the first rung when it opens', async () => {
        const socket = stubTransport('websocket', 'open');
        const sse = stubTransport('sse', 'open');
        const ladder = new LadderTransport([() => socket, () => sse], { probeMs: 50 });
        let opened = false;

        ladder.start({ onOpen: () => { opened = true; }, onMessage: () => {}, onClose: () => {} });
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(opened).toBe(true);
        expect(ladder.kind).toBe('websocket');
        expect(sse.started).toBe(0);
    });

    test('descends when a rung fails to open', async () => {
        const socket = stubTransport('websocket', 'fail');
        const sse = stubTransport('sse', 'open');
        const ladder = new LadderTransport([() => socket, () => sse], { probeMs: 50 });
        let opened = false;

        ladder.start({ onOpen: () => { opened = true; }, onMessage: () => {}, onClose: () => {} });
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(opened).toBe(true);
        expect(ladder.kind).toBe('sse');
    });

    test('descends when a rung neither opens nor fails within the probe window', async () => {
        const stuck: ClientTransport = { kind: 'websocket', start() {}, send() {}, close() {} };
        const sse = stubTransport('sse', 'open');
        const ladder = new LadderTransport([() => stuck, () => sse], { probeMs: 10 });
        let opened = false;

        ladder.start({ onOpen: () => { opened = true; }, onMessage: () => {}, onClose: () => {} });
        await new Promise(resolve => setTimeout(resolve, 40));

        // A corporate proxy that swallows the upgrade without answering is
        // the case that makes the timeout necessary rather than tidy.
        expect(opened).toBe(true);
        expect(ladder.kind).toBe('sse');
    });

    test('reports a real close once it is settled, so the client can reconnect', async () => {
        let handlers: TransportHandlers | null = null;
        const flaky: ClientTransport = {
            kind: 'websocket',
            start(next) { handlers = next; queueMicrotask(() => next.onOpen()); },
            send() {},
            close() {}
        };
        const ladder = new LadderTransport([() => flaky], { probeMs: 50 });
        let closes = 0;

        ladder.start({ onOpen: () => {}, onMessage: () => {}, onClose: () => { closes += 1; } });
        await new Promise(resolve => setTimeout(resolve, 10));
        handlers!.onClose();

        expect(closes).toBe(1);
    });

    test('a ladder whose every rung fails reports one close, not one per rung', async () => {
        const ladder = new LadderTransport(
            [() => stubTransport('websocket', 'fail'), () => stubTransport('sse', 'fail')],
            { probeMs: 10 }
        );
        let closes = 0;

        ladder.start({ onOpen: () => {}, onMessage: () => {}, onClose: () => { closes += 1; } });
        await new Promise(resolve => setTimeout(resolve, 40));

        expect(closes).toBe(1);
    });

    test('reports one close when a rung fails synchronously', async () => {
        const ladder = new LadderTransport([() => new SseClientTransport('http://x')], { probeMs: 10 });
        let closes = 0;

        ladder.start({ onOpen: () => {}, onMessage: () => {}, onClose: () => { closes += 1; } });
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(closes).toBe(1);
    });
});

describe('SseClientTransport', () => {
    test('reports an unavailable EventSource as a failed rung', () => {
        const transport = new SseClientTransport('http://x');
        let closes = 0;

        expect(() => transport.start({
            onOpen: () => {},
            onMessage: () => {},
            onClose: () => { closes += 1; }
        })).not.toThrow();

        expect(closes).toBe(1);
    });
});

describe('PollingTransport', () => {
    test('turns a sub into a conditional GET and the answer into a snapshot', async () => {
        const calls: { url: string; headers: Record<string, string> }[] = [];
        const fetchStub = (async (url: any, init: any) => {
            calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
            return new Response(JSON.stringify([{ id: 1 }]), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ETag: '"abc"' }
            });
        }) as unknown as typeof fetch;

        const transport = new PollingTransport(
            'http://x',
            routeIndex(GENERATED_ROUTES),
            { intervalMs: 10_000, fetch: fetchStub }
        );

        const received: any[] = [];
        transport.start({ onOpen: () => {}, onMessage: raw => received.push(JSON.parse(raw)), onClose: () => {} });
        transport.send(JSON.stringify({ t: 'hello', v: 1, token: 'poll-secret' }));
        transport.send(JSON.stringify({
            t: 'sub',
            sid: 's1',
            resource: 'CardsController.list',
            inputs: { params: {}, query: { done: 'true' } }
        }));

        await new Promise(resolve => setTimeout(resolve, 20));

        expect(calls[0].url).toBe('http://x/cards?done=true');
        expect(calls[0].headers['X-Carno-Live-Poll']).toBe('1');
        expect(calls[0].headers['X-Carno-Live-Token']).toBe('poll-secret');
        expect(calls[0].headers['X-Carno-Live-Connection']).toMatch(/^poll:/);
        expect(received[0]).toMatchObject({ t: 'snapshot', sid: 's1', data: [{ id: 1 }], hash: 'abc' });
        transport.close();
    });

    test('sends If-None-Match on the second poll and emits nothing on 304', async () => {
        let call = 0;
        const fetchStub = (async (_url: any, init: any) => {
            call += 1;

            if (call === 1) {
                return new Response(JSON.stringify([{ id: 1 }]), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json', ETag: '"abc"' }
                });
            }

            expect((init.headers as Record<string, string>)['If-None-Match']).toBe('"abc"');
            return new Response(null, { status: 304 });
        }) as unknown as typeof fetch;

        const transport = new PollingTransport(
            'http://x',
            routeIndex(GENERATED_ROUTES),
            { intervalMs: 5, fetch: fetchStub }
        );

        const received: any[] = [];
        transport.start({ onOpen: () => {}, onMessage: raw => received.push(JSON.parse(raw)), onClose: () => {} });
        transport.send(JSON.stringify({
            t: 'sub', sid: 's1', resource: 'CardsController.list', inputs: { params: {}, query: {} }
        }));

        await new Promise(resolve => setTimeout(resolve, 40));

        // 304 means the screen is already right. Emitting a snapshot would
        // hand the store a new object for identical content and re-render.
        expect(received.filter(message => message.t === 'snapshot').length).toBe(1);
        transport.close();
    });

    test('fills :params from the inputs', async () => {
        const urls: string[] = [];
        const fetchStub = (async (url: any) => {
            urls.push(String(url));
            return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }) as unknown as typeof fetch;

        const transport = new PollingTransport('http://x', routeIndex(GENERATED_ROUTES), { intervalMs: 10_000, fetch: fetchStub });
        transport.start({ onOpen: () => {}, onMessage: () => {}, onClose: () => {} });
        transport.send(JSON.stringify({
            t: 'sub', sid: 's1', resource: 'CardsController.one', inputs: { params: { id: '42' }, query: {} }
        }));

        await new Promise(resolve => setTimeout(resolve, 20));

        expect(urls[0]).toBe('http://x/cards/42');
        transport.close();
    });

    test('an unsub stops the polling for that subscription', async () => {
        let calls = 0;
        const fetchStub = (async () => {
            calls += 1;
            return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }) as unknown as typeof fetch;

        const transport = new PollingTransport('http://x', routeIndex(GENERATED_ROUTES), { intervalMs: 5, fetch: fetchStub });
        transport.start({ onOpen: () => {}, onMessage: () => {}, onClose: () => {} });
        transport.send(JSON.stringify({
            t: 'sub', sid: 's1', resource: 'CardsController.list', inputs: { params: {}, query: {} }
        }));

        await new Promise(resolve => setTimeout(resolve, 20));
        transport.send(JSON.stringify({ t: 'unsub', sid: 's1' }));
        const afterUnsub = calls;
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(calls).toBe(afterUnsub);
        transport.close();
    });

    test('a resource the index does not know is an error the client can show', async () => {
        const transport = new PollingTransport('http://x', {}, { intervalMs: 10_000 });
        const received: any[] = [];

        transport.start({ onOpen: () => {}, onMessage: raw => received.push(JSON.parse(raw)), onClose: () => {} });
        transport.send(JSON.stringify({
            t: 'sub', sid: 's1', resource: 'Unknown.thing', inputs: { params: {}, query: {} }
        }));

        await new Promise(resolve => setTimeout(resolve, 10));

        // Silence here would be a screen that stays pending forever with no
        // explanation. Say what is missing and how to supply it.
        expect(received[0]).toMatchObject({ t: 'error', sid: 's1', code: 'no_route' });
        expect(received[0].message).toMatch(/routes/);
        transport.close();
    });
});
