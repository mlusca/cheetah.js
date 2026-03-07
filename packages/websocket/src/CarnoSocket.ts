import type { CarnoSocketData } from './types';

/**
 * Enables broadcasting to all subscribers of a room (topic).
 * Obtained via `socket.to(room)`.
 */
export class RoomBroadcaster {
    constructor(
        private readonly room: string,
        private readonly ws: any
    ) {}

    /** Emit a named event with optional data to all room subscribers. */
    emit(event: string, data?: any): void {
        this.ws.publish(this.room, JSON.stringify({ event, data }));
    }

    /** Send a raw message to all room subscribers. */
    send(message: string | ArrayBuffer | Uint8Array): void {
        this.ws.publish(this.room, message as string);
    }
}

/**
 * Wrapper around Bun's `ServerWebSocket` exposing a Socket.io-inspired API.
 * Supports rooms via Bun's native pub/sub.
 */
export class CarnoSocket {
    constructor(private readonly ws: any) {}

    /** Unique connection ID (UUID assigned at upgrade time). */
    get id(): string {
        return (this.ws.data as CarnoSocketData).id;
    }

    /** The gateway path (namespace) this socket connected to. */
    get namespace(): string {
        return (this.ws.data as CarnoSocketData).namespace;
    }

    /** Remote IP address of the client. */
    get remoteAddress(): string {
        return this.ws.remoteAddress;
    }

    /** List of room names (topics) this socket is currently subscribed to. */
    get rooms(): string[] {
        return [...(this.ws.subscriptions as string[])];
    }

    /** Current WebSocket ready state. */
    get readyState(): number {
        return this.ws.readyState;
    }

    /** Send a raw message directly to this socket. */
    send(message: string | ArrayBuffer | Uint8Array, compress?: boolean): number {
        return this.ws.send(message, compress);
    }

    /**
     * Emit a named event with optional data to this socket.
     * The client receives `{ event, data }` as JSON.
     */
    emit(event: string, data?: any): void {
        this.ws.send(JSON.stringify({ event, data }));
    }

    /** Subscribe to a room (Bun pub/sub topic). */
    join(room: string): void {
        this.ws.subscribe(room);
    }

    /** Unsubscribe from a room. */
    leave(room: string): void {
        this.ws.unsubscribe(room);
    }

    /** Returns a broadcaster targeting all subscribers of the given room. */
    to(room: string): RoomBroadcaster {
        return new RoomBroadcaster(room, this.ws);
    }

    /** Publish a named event to all sockets subscribed to the given topic. */
    publish(topic: string, event: string, data?: any): void {
        this.ws.publish(topic, JSON.stringify({ event, data }));
    }

    /** Whether this socket is subscribed to the given room. */
    isSubscribed(room: string): boolean {
        return this.ws.isSubscribed(room);
    }

    /** Close the WebSocket connection. */
    close(code?: number, reason?: string): void {
        this.ws.close(code, reason);
    }

    /** Access the underlying Bun `ServerWebSocket` instance. */
    get raw(): any {
        return this.ws;
    }
}
