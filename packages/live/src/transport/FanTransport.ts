import type { LiveTransport } from '../LiveEngine';
import type { ServerMessage } from '../shared/protocol';

export interface OwnedTransport extends LiveTransport {
    /** Whether this transport is the one holding that connection. */
    owns(connectionId: string): boolean;
}

/**
 * One engine, several pipes.
 *
 * The engine addresses connections by an opaque id and never asks how they are
 * reached, which is exactly what makes SSE a transport rather than a second
 * engine. This routes each send to whichever transport claims the id.
 */
export class FanTransport implements LiveTransport {
    private readonly children: OwnedTransport[] = [];

    add(child: OwnedTransport): void {
        this.children.push(child);
    }

    send(connectionId: string, message: ServerMessage): number {
        for (const child of this.children) {
            if (child.owns(connectionId)) {
                return child.send(connectionId, message);
            }
        }

        // Nobody holds it any more. Zero is "dropped", which the engine already
        // handles; throwing here would take a whole fan-out down with it.
        return 0;
    }
}
