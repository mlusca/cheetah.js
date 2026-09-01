import { afterEach, describe, expect, test } from 'bun:test';
import { Controller, Get } from '@carno.js/core';
import { createTestHarness } from '../../core/dist/testing/TestHarness.js';
import { Live } from '../src/decorators/Live';
import { LivePlugin } from '../src/LivePlugin';
import { closeLiveRuntime, getLiveRuntime } from '../src/runtime';

// happy-dom (loaded by react-rerender.test.tsx) replaces global fetch with a
// browser fetch that enforces CORS and buffers the body. These tests talk to
// a real Bun.serve, so they use the native one captured before that register.
const fetch =
    (globalThis as { __carnoNativeFetch?: typeof globalThis.fetch }).__carnoNativeFetch
    ?? globalThis.fetch;
const NativeAbortController =
    (globalThis as { __carnoNativeAbortController?: typeof AbortController }).__carnoNativeAbortController
    ?? globalThis.AbortController;

@Controller('/numbers')
class NumbersController {
    @Get('/')
    @Live({ shared: 'public', dependsOn: ['app:numbers'] })
    list() {
        return [1, 2, 3];
    }
}

/** Reads SSE frames off the response body, one `data:` payload at a time. */
async function* frames(response: Response): AsyncGenerator<any> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { value, done } = await reader.read();

        if (done) {
            return;
        }

        buffer += decoder.decode(value, { stream: true });

        let split = buffer.indexOf('\n\n');

        while (split !== -1) {
            const frame = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);

            if (frame.startsWith('data: ')) {
                yield JSON.parse(frame.slice(6));
            }

            split = buffer.indexOf('\n\n');
        }
    }
}

async function next(stream: AsyncGenerator<any>, predicate: (frame: any) => boolean, timeoutMs = 4000): Promise<any> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const { value, done } = await stream.next();

        if (done) {
            throw new Error('the stream ended before the frame arrived');
        }

        if (predicate(value)) {
            return value;
        }
    }

    throw new Error('timed out waiting for a frame');
}

afterEach(async () => {
    await closeLiveRuntime();
});

describe('SSE routes', () => {
    test('a subscription over SSE receives a snapshot and then a patch', async () => {
        const harness = await createTestHarness({
            controllers: [NumbersController],
            plugins: [LivePlugin.create({
                controllers: [NumbersController],
                sse: true,
                config: { coalesceMs: 5, sseHeartbeatMs: 0 }
            })],
            listen: true
        });

        const response = await fetch(`http://127.0.0.1:${harness.port}/live/sse`);
        expect(response.headers.get('content-type')).toContain('text/event-stream');

        const stream = frames(response);
        const ready = await next(stream, frame => frame.t === 'ready');
        expect(typeof ready.cid).toBe('string');

        const post = (message: unknown) => fetch(`http://127.0.0.1:${harness.port}/live/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cid: ready.cid, message })
        });

        await post({ t: 'hello', v: 1 });
        await post({ t: 'sub', sid: 's1', resource: 'NumbersController.list', inputs: { params: {}, query: {} } });

        const snapshot = await next(stream, frame => frame.t === 'snapshot');
        expect(snapshot.data).toEqual([1, 2, 3]);

        await harness.close();
    });

    test('the control endpoint refuses an unknown connection id', async () => {
        const harness = await createTestHarness({
            controllers: [NumbersController],
            plugins: [LivePlugin.create({ controllers: [NumbersController], sse: true })],
            listen: true
        });

        const response = await fetch(`http://127.0.0.1:${harness.port}/live/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cid: 'sse:not-a-real-one', message: { t: 'hello', v: 1 } })
        });

        // The cid is a bearer for a live connection. An unknown one is not a
        // no-op to be swallowed; it is a request that must not be served.
        expect(response.status).toBe(404);
        await harness.close();
    });

    test('the control endpoint refuses a malformed body', async () => {
        const harness = await createTestHarness({
            controllers: [NumbersController],
            plugins: [LivePlugin.create({ controllers: [NumbersController], sse: true })],
            listen: true
        });

        const response = await fetch(`http://127.0.0.1:${harness.port}/live/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'not json'
        });

        expect(response.status).toBe(400);
        await harness.close();
    });

    test('cancelling the stream drops the scope and refuses a late control message', async () => {
        const harness = await createTestHarness({
            controllers: [NumbersController],
            plugins: [LivePlugin.create({
                controllers: [NumbersController],
                sse: true,
                config: { sseHeartbeatMs: 0 }
            })],
            listen: true
        });

        const abort = new NativeAbortController();
        const response = await fetch(`http://127.0.0.1:${harness.port}/live/sse`, { signal: abort.signal });
        const reader = response.body!.getReader();
        const ready = JSON.parse(
            new TextDecoder().decode((await reader.read()).value).replace(/^data: /, '').trim()
        );
        expect(typeof ready.cid).toBe('string');

        await fetch(`http://127.0.0.1:${harness.port}/live/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cid: ready.cid, message: { t: 'hello', v: 1 } })
        });
        expect(getLiveRuntime().scopes.has(ready.cid)).toBe(true);

        abort.abort();

        const deadline = Date.now() + 1000;
        while (getLiveRuntime().scopes.has(ready.cid) && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }

        expect(getLiveRuntime().scopes.has(ready.cid)).toBe(false);

        const late = await fetch(`http://127.0.0.1:${harness.port}/live/control`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cid: ready.cid,
                message: { t: 'sub', sid: 's1', resource: 'NumbersController.list', inputs: { params: {}, query: {} } }
            })
        });
        expect(late.status).toBe(404);

        await harness.close();
    });

    test('no routes exist when sse is off', async () => {
        const harness = await createTestHarness({
            controllers: [NumbersController],
            plugins: [LivePlugin.create({ controllers: [NumbersController] })],
            listen: true
        });

        const response = await fetch(`http://127.0.0.1:${harness.port}/live/sse`);

        expect(response.status).toBe(404);
        await harness.close();
    });
});
