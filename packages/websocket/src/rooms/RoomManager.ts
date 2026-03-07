import { Service } from '@carno.js/core';
import { Carno } from '@carno.js/core';

/**
 * Service for server-wide WebSocket broadcasting.
 * Can be injected into any controller or service to broadcast messages
 * to all subscribers of a room from outside WebSocket event handlers.
 *
 * @example
 * ```ts
 * @Controller('/api')
 * class NotificationsController {
 *   constructor(private readonly rooms: RoomManager) {}
 *
 *   @Post('/announce')
 *   announce(@Body() body: { message: string }) {
 *     this.rooms.broadcast('general', 'announcement', body);
 *     return { sent: true };
 *   }
 * }
 * ```
 */
@Service()
export class RoomManager {
    constructor(private readonly carno: Carno) {}

    /**
     * Broadcast a named event with optional data to all subscribers of a room.
     * Requires the WebSocket server to be running (call after `app.listen()`).
     */
    broadcast(room: string, event: string, data?: any): void {
        const server = this.carno.getServer();
        if (!server) {
            throw new Error('[@carno.js/websocket] RoomManager.broadcast() called before the server started.');
        }
        server.publish(room, JSON.stringify({ event, data }));
    }

    /**
     * Broadcast a raw message to all subscribers of a room.
     */
    broadcastRaw(room: string, message: string | ArrayBuffer | Uint8Array): void {
        const server = this.carno.getServer();
        if (!server) {
            throw new Error('[@carno.js/websocket] RoomManager.broadcastRaw() called before the server started.');
        }
        server.publish(room, message as string);
    }

    /** Total number of pending (buffered) WebSocket connections. */
    get pendingWebSockets(): number {
        return this.carno.getServer()?.pendingWebSockets ?? 0;
    }
}
