import 'reflect-metadata';

// Plugin
export { WebSocketPlugin } from './WebSocketPlugin';

// Socket & broadcasting
export { CarnoSocket } from './CarnoSocket';
export { RoomBroadcaster } from './CarnoSocket';

// Services
export { RoomManager } from './rooms/RoomManager';
export { NamespaceRegistry } from './namespace/NamespaceRegistry';

// Decorators - class
export { Gateway } from './decorators/Gateway';

// Decorators - method
export {
    OnOpen,
    OnClose,
    OnMessage,
    OnError,
    OnDrain,
    SubscribeMessage,
} from './decorators/Events';

// Types
export type {
    GatewayMeta,
    WsHandlerMeta,
    WsEventType,
    WebSocketPluginConfig,
    CarnoSocketData,
} from './types';
