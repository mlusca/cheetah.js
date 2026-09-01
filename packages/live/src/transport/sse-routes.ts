import { getLiveRuntime } from '../runtime';
import { dropLiveConnection, handleMessage } from './LiveGateway';
import type { SseTransport } from './SseTransport';

export interface SseRouteOptions {
    transport: SseTransport;
    streamPath: string;
    controlPath: string;
}

// Captured at load so a later happy-dom register cannot replace the
// constructor Bun.serve requires of a route handler.
const NativeResponse = Response;

const SSE_HEADERS = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nginx buffers proxied responses by default, which turns a live stream
    // into a stream that arrives all at once, at the end.
    'X-Accel-Buffering': 'no'
};

/**
 * The two halves of the SSE transport, as HTTP.
 *
 * `GET streamPath` opens the downstream and names the connection; every
 * client message goes up through `POST controlPath` and into the same
 * `handleMessage` the WebSocket gateway uses. There is no second protocol
 * here, and there must never be one.
 *
 * Handlers registered through `Carno.route()` receive a Bun `Request`, not a
 * `Context` -- the docstring on that method says otherwise, the runtime does
 * not.
 */
export function createSseRoutes(options: SseRouteOptions) {
    const { transport, streamPath, controlPath } = options;

    const stream = (request: Request): Response => {
        // Unguessable on purpose: the id is a bearer for this connection, and
        // whoever holds it can subscribe as it.
        const connectionId = `sse:${crypto.randomUUID()}`;

        try {
            const body = transport.open(connectionId);
            const runtime = getLiveRuntime();
            // Until a `hello` arrives, the connection is its own principal:
            // safe, shares nothing. Same rule as the gateway's onOpen.
            runtime.scopes.set(connectionId, { principal: connectionId });

            // Cancelling the client reader does not always reach the stream's
            // `cancel`; aborting the request does, and is what a closed
            // EventSource looks like on the wire.
            request.signal.addEventListener('abort', () => {
                transport.close(connectionId);

                try {
                    dropLiveConnection(connectionId);
                } catch {
                    // closeLiveRuntime nulls the runtime before dispose.
                }
            });

            return new NativeResponse(body, { status: 200, headers: SSE_HEADERS });
        } catch (error) {
            return new NativeResponse((error as Error).message, { status: 503 });
        }
    };

    const control = async (request: Request): Promise<Response> => {
        let payload: { cid?: unknown; message?: unknown };

        try {
            payload = await request.json() as { cid?: unknown; message?: unknown };
        } catch {
            return new NativeResponse('malformed body', { status: 400 });
        }

        if (typeof payload.cid !== 'string' || !payload.message) {
            return new NativeResponse('cid and message are required', { status: 400 });
        }

        if (!transport.owns(payload.cid)) {
            return new NativeResponse('unknown connection', { status: 404 });
        }

        await handleMessage(payload.cid, JSON.stringify(payload.message));

        return new NativeResponse(null, { status: 204 });
    };

    return { streamPath, controlPath, stream, control };
}
