import { CarnoSocket, Gateway, OnClose, OnMessage, OnOpen } from '@carno.js/websocket';
import { getLiveRuntime } from '../runtime';
import type { ClientMessage } from '../shared/protocol';

export const LIVE_GATEWAY_PATH = '/live';

/** Per-connection tail so `hello` finishes before a back-to-back `sub`. */
const inbound = new Map<string, Promise<void>>();

@Gateway(LIVE_GATEWAY_PATH)
export class LiveGateway {
    @OnOpen()
    onOpen(socket: CarnoSocket): void {
        const runtime = getLiveRuntime();
        runtime.transport.add(socket);
        runtime.handshakes.delete(socket.id);
        // Until a `hello` arrives, the connection is its own principal: safe,
        // shares nothing.
        runtime.scopes.set(socket.id, { principal: socket.id });
    }

    @OnMessage()
    onMessage(socket: CarnoSocket, raw: string | ArrayBuffer | Uint8Array): void {
        if (typeof raw !== 'string') {
            return;
        }

        void handleMessage(socket.id, raw).catch(() => {});
    }

    @OnClose()
    onClose(socket: CarnoSocket): void {
        dropLiveConnection(socket.id);
        getLiveRuntime().transport.remove(socket.id);
    }
}

/**
 * Tear down a connection from any pipe.
 *
 * WebSocket and SSE must leave the engine, the inbound queue and the scope
 * map in the same state: an in-flight `hello` cannot subscribe after the
 * client has gone, and a cancelled stream cannot leak a principal.
 */
export function dropLiveConnection(connectionId: string): void {
    inbound.delete(connectionId);
    const runtime = getLiveRuntime();
    runtime.engine.dropConnection(connectionId);
    runtime.scopes.delete(connectionId);
    runtime.handshakes.delete(connectionId);
}

export function handleMessage(connectionId: string, raw: string): Promise<void> {
    const previous = inbound.get(connectionId) ?? Promise.resolve();
    const next = previous.then(
        () => dispatch(connectionId, raw),
        () => dispatch(connectionId, raw)
    );
    inbound.set(connectionId, next);
    return next;
}

async function dispatch(connectionId: string, raw: string): Promise<void> {
    if (!inbound.has(connectionId)) {
        return;
    }

    const runtime = getLiveRuntime();

    let message: ClientMessage;

    try {
        message = JSON.parse(raw) as ClientMessage;
    } catch {
        return;
    }

    if (!message || typeof (message as { t?: unknown }).t !== 'string') {
        return;
    }

    switch (message.t) {
        case 'hello': {
            if (runtime.handshakes.has(connectionId)) {
                return;
            }

            const scope = await runtime.resolver.resolve({ connectionId, token: message.token });

            if (!inbound.has(connectionId)) {
                return;
            }

            runtime.scopes.set(connectionId, scope);
            runtime.handshakes.add(connectionId);
            return;
        }

        case 'sub': {
            const scope = runtime.scopes.get(connectionId) ?? { principal: connectionId };
            await runtime.engine.subscribe(
                connectionId,
                message.sid,
                message.resource,
                {
                    params: message.inputs?.params ?? {},
                    query: message.inputs?.query ?? {},
                    body: message.inputs?.body
                },
                scope,
                message.hash
            );
            return;
        }

        case 'unsub':
            runtime.engine.unsubscribe(connectionId, message.sid);
            return;

        case 'resync':
            await runtime.engine.resync(connectionId, message.sid, message.hash);
            return;
    }
}
