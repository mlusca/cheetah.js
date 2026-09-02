import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll } from 'bun:test';

/**
 * Native fetch, captured before happy-dom replaces it.
 *
 * HTTP tests that talk to a real Bun.serve (SSE streams, CORS-free POSTs)
 * must use this: happy-dom's fetch enforces same-origin and buffers the body.
 */
(globalThis as { __carnoNativeFetch?: typeof fetch }).__carnoNativeFetch = globalThis.fetch;
(globalThis as { __carnoNativeAbortController?: typeof AbortController }).__carnoNativeAbortController =
    globalThis.AbortController;

if (!(globalThis as { document?: unknown }).document) {
    GlobalRegistrator.register();
}

// Do not leak happy-dom's Response/Request constructors into later tests
// that start a real Bun.serve instance.
afterAll(() => {
    if ((globalThis as { document?: unknown }).document) {
        GlobalRegistrator.unregister();
    }
});
