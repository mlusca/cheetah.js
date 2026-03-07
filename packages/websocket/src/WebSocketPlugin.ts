import 'reflect-metadata';
import { Carno, Container } from '@carno.js/core';
import { GATEWAY_META, WS_HANDLERS_META } from './metadata';
import type { GatewayMeta, WsHandlerMeta, WebSocketPluginConfig } from './types';
import { CarnoSocket } from './CarnoSocket';
import { RoomManager } from './rooms/RoomManager';
import { NamespaceRegistry } from './namespace/NamespaceRegistry';

interface GatewayEntry {
    instance: any;
    handlers: WsHandlerMeta[];
}

/**
 * Plugin factory for Bun-native WebSocket support in Carno.js.
 *
 * Features:
 * - Decorator-based gateways (@Gateway, @OnOpen, @OnClose, @SubscribeMessage, …)
 * - Room management via Bun pub/sub (socket.join / socket.to().emit)
 * - Namespace support through multiple gateway paths
 * - Server-wide broadcasting via the injected RoomManager service
 * - Connection tracking via the injected NamespaceRegistry service
 *
 * @example
 * ```ts
 * import { Carno } from '@carno.js/core';
 * import { WebSocketPlugin, Gateway, OnOpen, SubscribeMessage, CarnoSocket } from '@carno.js/websocket';
 *
 * @Gateway('/chat')
 * class ChatGateway {
 *   @OnOpen()
 *   onOpen(socket: CarnoSocket) {
 *     socket.join('general');
 *     socket.emit('welcome', { id: socket.id });
 *   }
 *
 *   @SubscribeMessage('send')
 *   onSend(socket: CarnoSocket, payload: { message: string }) {
 *     socket.to('general').emit('message', { from: socket.id, ...payload });
 *   }
 * }
 *
 * const app = new Carno();
 * app.use(WebSocketPlugin.create([ChatGateway]));
 * app.listen(3000);
 * // Clients connect to ws://localhost:3000/chat
 * ```
 */
export class WebSocketPlugin {
    /**
     * Create a Carno plugin that activates WebSocket support.
     *
     * @param gateways - One or more gateway classes decorated with `@Gateway`.
     * @param config   - Optional Bun WebSocket tuning options.
     */
    static create(
        gateways: (new (...args: any[]) => any)[],
        config: WebSocketPluginConfig = {}
    ): Carno {
        const plugin = new Carno({ exports: [] });

        // Collect upgrade paths from gateway metadata
        const upgradePaths: string[] = [];
        for (const GatewayClass of gateways) {
            const meta: GatewayMeta | undefined = Reflect.getMetadata(GATEWAY_META, GatewayClass);
            if (!meta?.path) {
                throw new Error(
                    `[@carno.js/websocket] Class "${GatewayClass.name}" is missing the @Gateway decorator.`
                );
            }
            upgradePaths.push(meta.path);
        }

        // Register gateway classes + shared services for DI
        plugin.services([...gateways, RoomManager, NamespaceRegistry]);

        // The builder runs AFTER bootstrap(), so the DI container is fully populated
        const builder = (container: Container): any => {
            const gatewayMap = new Map<string, GatewayEntry>();

            for (const GatewayClass of gateways) {
                const meta: GatewayMeta = Reflect.getMetadata(GATEWAY_META, GatewayClass);
                const handlers: WsHandlerMeta[] = Reflect.getMetadata(WS_HANDLERS_META, GatewayClass) || [];
                const instance = container.get(GatewayClass);

                gatewayMap.set(meta.path, { instance, handlers });
            }

            const registry = container.get(NamespaceRegistry);

            return buildBunWebSocketHandler(gatewayMap, registry, config);
        };

        plugin.wsHandler(builder, upgradePaths);
        return plugin;
    }
}

function buildBunWebSocketHandler(
    gatewayMap: Map<string, GatewayEntry>,
    registry: NamespaceRegistry,
    config: WebSocketPluginConfig
): any {
    const getHandlers = (namespace: string, type: string): WsHandlerMeta[] =>
        gatewayMap.get(namespace)?.handlers.filter(h => h.type === type) ?? [];

    const getSubscribeHandlers = (namespace: string, event: string): WsHandlerMeta[] =>
        gatewayMap.get(namespace)?.handlers.filter(
            h => h.type === 'subscribe' && h.event === event
        ) ?? [];

    const getInstance = (namespace: string): any =>
        gatewayMap.get(namespace)?.instance;

    return {
        ...config,

        open(ws: any) {
            const namespace: string = ws.data?.namespace;
            const instance = getInstance(namespace);
            if (!instance) return;

            registry._increment(namespace);

            const socket = new CarnoSocket(ws);
            for (const h of getHandlers(namespace, 'open')) {
                instance[h.methodName](socket);
            }
        },

        message(ws: any, message: string | ArrayBuffer | Uint8Array) {
            const namespace: string = ws.data?.namespace;
            const instance = getInstance(namespace);
            if (!instance) return;

            const socket = new CarnoSocket(ws);

            // Raw message handlers
            for (const h of getHandlers(namespace, 'message')) {
                instance[h.methodName](socket, message);
            }

            // Event-based handlers via JSON protocol: { event, data }
            if (typeof message === 'string') {
                try {
                    const parsed = JSON.parse(message);
                    if (parsed && typeof parsed.event === 'string') {
                        for (const h of getSubscribeHandlers(namespace, parsed.event)) {
                            instance[h.methodName](socket, parsed.data);
                        }
                    }
                } catch {
                    // Not JSON – already handled by raw message handlers
                }
            }
        },

        close(ws: any, code: number, reason: string) {
            const namespace: string = ws.data?.namespace;
            const instance = getInstance(namespace);
            if (!instance) return;

            registry._decrement(namespace);

            const socket = new CarnoSocket(ws);
            for (const h of getHandlers(namespace, 'close')) {
                instance[h.methodName](socket, code, reason);
            }
        },

        error(ws: any, error: Error) {
            const namespace: string = ws.data?.namespace;
            const instance = getInstance(namespace);
            if (!instance) return;

            const socket = new CarnoSocket(ws);
            for (const h of getHandlers(namespace, 'error')) {
                instance[h.methodName](socket, error);
            }
        },

        drain(ws: any) {
            const namespace: string = ws.data?.namespace;
            const instance = getInstance(namespace);
            if (!instance) return;

            const socket = new CarnoSocket(ws);
            for (const h of getHandlers(namespace, 'drain')) {
                instance[h.methodName](socket);
            }
        },
    };
}
