import type { ServerMessage } from '../shared/protocol';
import type { OwnedTransport } from './FanTransport';

export interface SseTransportOptions {
    /** 0 disables the heartbeat. Only tests want that. */
    heartbeatMs: number;
    maxConnections: number;
    /** Called when the client goes away, so the engine can drop the connection. */
    onDisconnect?: (connectionId: string) => void;
}

const ENCODER = new TextEncoder();
const NativeReadableStream = ReadableStream;

/**
 * The downstream half of the SSE transport.
 *
 * Upstream is `POST /live/control`, which speaks the same protocol into the
 * same handler the WebSocket gateway uses -- see `sse-routes.ts`. This half
 * only writes frames, so the engine cannot tell it apart from a socket.
 */
export class SseTransport implements OwnedTransport {
    private readonly streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
    private heartbeat: ReturnType<typeof setInterval> | null = null;

    constructor(private readonly options: SseTransportOptions) {}

    open(connectionId: string): ReadableStream<Uint8Array> {
        if (this.streams.size >= this.options.maxConnections) {
            throw new Error(`[carno:live] the SSE transport is at capacity (${this.options.maxConnections}).`);
        }

        return new NativeReadableStream<Uint8Array>({
            start: controller => {
                this.streams.set(connectionId, controller);
                // The client cannot learn its own connection id any other way,
                // and it needs it to address the control endpoint.
                this.write(controller, `data: ${JSON.stringify({ t: 'ready', cid: connectionId })}\n\n`);
                this.ensureHeartbeat();
            },
            cancel: () => {
                this.streams.delete(connectionId);
                this.options.onDisconnect?.(connectionId);
            }
        });
    }

    owns(connectionId: string): boolean {
        return this.streams.has(connectionId);
    }

    send(connectionId: string, message: ServerMessage): number {
        const controller = this.streams.get(connectionId);

        if (!controller) {
            return 0;
        }

        return this.write(controller, `data: ${JSON.stringify(message)}\n\n`);
    }

    close(connectionId: string): void {
        const controller = this.streams.get(connectionId);
        this.streams.delete(connectionId);

        try {
            controller?.close();
        } catch {
            // Already closed from the other end.
        }
    }

    count(): number {
        return this.streams.size;
    }

    stop(): void {
        if (this.heartbeat) {
            clearInterval(this.heartbeat);
            this.heartbeat = null;
        }

        for (const connectionId of [...this.streams.keys()]) {
            this.close(connectionId);
        }
    }

    private ensureHeartbeat(): void {
        if (this.heartbeat || this.options.heartbeatMs <= 0) {
            return;
        }

        // A comment frame. EventSource ignores it; an idle-timeout proxy does
        // not, which is the whole point.
        this.heartbeat = setInterval(() => {
            for (const controller of this.streams.values()) {
                this.write(controller, ': ping\n\n');
            }
        }, this.options.heartbeatMs);

        this.heartbeat.unref?.();
    }

    private write(controller: ReadableStreamDefaultController<Uint8Array>, frame: string): number {
        try {
            controller.enqueue(ENCODER.encode(frame));
            return 1;
        } catch {
            return 0;
        }
    }
}
