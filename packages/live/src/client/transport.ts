import type { LiveSocket } from './core';

export interface TransportHandlers {
    onOpen(): void;
    onMessage(raw: string): void;
    onClose(): void;
}

/**
 * A pipe the client can speak the protocol over.
 *
 * The protocol does not change between implementations, and neither does the
 * client's behaviour: a component cannot tell which one is in use, and the day
 * an `if (kind === 'sse')` appears in a component, the abstraction has failed.
 * `kind` exists to be logged.
 */
export interface ClientTransport {
    readonly kind: 'websocket' | 'sse' | 'polling';
    start(handlers: TransportHandlers): void;
    send(raw: string): void;
    close(): void;
}

export class WebSocketTransport implements ClientTransport {
    readonly kind = 'websocket' as const;

    private socket: LiveSocket | null = null;
    private closed = false;

    constructor(
        private readonly url: string,
        private readonly factory: (url: string) => LiveSocket = defaultSocketFactory
    ) {}

    start(handlers: TransportHandlers): void {
        const socket = this.factory(this.url);
        this.socket = socket;

        socket.onopen = () => handlers.onOpen();
        socket.onmessage = event => handlers.onMessage(event.data);
        // An error and a close both mean the same thing here: the pipe is gone.
        socket.onclose = () => this.report(handlers);
        socket.onerror = () => this.report(handlers);
    }

    send(raw: string): void {
        this.socket?.send(raw);
    }

    close(): void {
        this.closed = true;
        this.socket?.close();
        this.socket = null;
    }

    private report(handlers: TransportHandlers): void {
        if (this.closed) {
            // We closed it. Reporting it would schedule a reconnect to a
            // client that has already given up.
            return;
        }

        this.socket = null;
        handlers.onClose();
    }
}

function defaultSocketFactory(url: string): LiveSocket {
    return new WebSocket(url) as unknown as LiveSocket;
}
