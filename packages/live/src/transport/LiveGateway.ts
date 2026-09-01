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
        inbound.delete(socket.id);
        const runtime = getLiveRuntime();
        runtime.engine.dropConnection(socket.id);
        runtime.transport.remove(socket.id);
        runtime.scopes.delete(socket.id);
    }
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
            const scope = await runtime.resolver.resolve({ connectionId, token: message.token });

            if (!inbound.has(connectionId)) {
                return;
            }

            runtime.scopes.set(connectionId, scope);
            return;
        }

        case 'sub': {
            const scope = runtime.scopes.get(connectionId) ?? { principal: connectionId };
            await runtime.engine.subscribe(
                connectionId,
                message.sid,
                message.resource,
                { params: message.inputs?.params ?? {}, query: message.inputs?.query ?? {} },
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
