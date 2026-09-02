import type { CarnoSocket } from '@carno.js/websocket';
import type { ServerMessage } from '../shared/protocol';
import type { OwnedTransport } from './FanTransport';

/**
 * Sends protocol messages over the raw socket.
 *
 * We use `socket.send()` rather than `socket.emit()` because emit wraps the
 * payload in `{ event, data }` for the gateway's own event protocol, and this
 * is a different protocol.
 */
export class SocketTransport implements OwnedTransport {
    private readonly sockets = new Map<string, CarnoSocket>();

    add(socket: CarnoSocket): void {
        this.sockets.set(socket.id, socket);
    }

    remove(connectionId: string): void {
        this.sockets.delete(connectionId);
    }

    owns(connectionId: string): boolean {
        return this.sockets.has(connectionId);
    }

    /** <= 0 means back-pressured or dropped; the engine counts those. */
    send(connectionId: string, message: ServerMessage): number {
        const socket = this.sockets.get(connectionId);

        if (!socket) {
            return 0;
        }

        try {
            return socket.send(JSON.stringify(message));
        } catch {
            // The socket closed between fan-out and send. Treat as dropped;
            // the close handler will clean it up.
            return 0;
        }
    }
}
