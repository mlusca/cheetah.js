import { GlobalRegistrator } from '@happy-dom/global-registrator';

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
