export interface GatewayMeta {
    /** HTTP path used for the WebSocket upgrade (acts as namespace). E.g. `/chat` */
    path: string;
}

export type WsEventType = 'open' | 'close' | 'message' | 'error' | 'drain' | 'subscribe';

export interface WsHandlerMeta {
    methodName: string;
    type: WsEventType;
    /** Only set when type === 'subscribe' */
    event?: string;
}

/** Data attached to each Bun ServerWebSocket via server.upgrade() */
export interface CarnoSocketData {
    id: string;
    namespace: string;
}

export interface WebSocketPluginConfig {
    /** Enable per-message deflate compression */
    perMessageDeflate?: boolean | { compress?: boolean; decompress?: boolean };
    /** Maximum allowed payload size in bytes (default: 16 MB) */
    maxPayloadLength?: number;
    /** Idle connection timeout in seconds (default: 120) */
    idleTimeout?: number;
    /** Backpressure limit in bytes (default: 1 MB) */
    backpressureLimit?: number;
    /** Close connection when backpressure limit is reached */
    closeOnBackpressureLimit?: boolean;
    /** Send periodic ping frames to keep connection alive */
    sendPings?: boolean;
    /** Publish messages back to the sender when using pub/sub */
    publishToSelf?: boolean;
}
