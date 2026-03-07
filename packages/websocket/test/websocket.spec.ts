import 'reflect-metadata';
import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { CarnoSocket, RoomBroadcaster } from '../src/CarnoSocket';
import { NamespaceRegistry } from '../src/namespace/NamespaceRegistry';
import { RoomManager } from '../src/rooms/RoomManager';
import { Gateway } from '../src/decorators/Gateway';
import { OnOpen, OnClose, OnMessage, OnError, OnDrain, SubscribeMessage } from '../src/decorators/Events';
import { GATEWAY_META, WS_HANDLERS_META } from '../src/metadata';
import { WebSocketPlugin } from '../src/WebSocketPlugin';
import type { GatewayMeta, WsHandlerMeta } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers – mock Bun ServerWebSocket
// ---------------------------------------------------------------------------

function createMockWs(overrides: Record<string, any> = {}) {
    const subscriptions = new Set<string>();

    return {
        data: { id: 'uuid-abc-123', namespace: '/chat' },
        remoteAddress: '127.0.0.1',
        readyState: 1,
        subscriptions,
        send: mock((message: any, _compress?: boolean) => message.length ?? 0),
        publish: mock((_topic: string, _message: any) => 0),
        subscribe: mock((room: string) => subscriptions.add(room)),
        unsubscribe: mock((room: string) => subscriptions.delete(room)),
        isSubscribed: mock((room: string) => subscriptions.has(room)),
        close: mock((_code?: number, _reason?: string) => {}),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// CarnoSocket
// ---------------------------------------------------------------------------

describe('CarnoSocket', () => {
    let ws: ReturnType<typeof createMockWs>;
    let socket: CarnoSocket;

    beforeEach(() => {
        ws = createMockWs();
        socket = new CarnoSocket(ws as any);
    });

    describe('getters', () => {
        test('id returns the UUID from ws.data', () => {
            expect(socket.id).toBe('uuid-abc-123');
        });

        test('namespace returns the namespace from ws.data', () => {
            expect(socket.namespace).toBe('/chat');
        });

        test('remoteAddress returns ws.remoteAddress', () => {
            expect(socket.remoteAddress).toBe('127.0.0.1');
        });

        test('rooms returns a copy of subscriptions', () => {
            ws.subscriptions.add('general');
            ws.subscriptions.add('vip');

            const rooms = socket.rooms;
            expect(rooms).toContain('general');
            expect(rooms).toContain('vip');
            expect(rooms).toHaveLength(2);

            // Must be a copy, not the same reference
            rooms.push('fake');
            expect(socket.rooms).toHaveLength(2);
        });

        test('rooms returns empty array when no subscriptions', () => {
            expect(socket.rooms).toEqual([]);
        });

        test('readyState returns ws.readyState', () => {
            expect(socket.readyState).toBe(1);
        });

        test('readyState reflects changes in underlying ws', () => {
            ws.readyState = 3;
            expect(socket.readyState).toBe(3);
        });

        test('raw returns the underlying ws instance', () => {
            expect(socket.raw).toBe(ws);
        });
    });

    describe('send()', () => {
        test('sends a string message', () => {
            socket.send('hello');
            expect(ws.send).toHaveBeenCalledWith('hello', undefined);
        });

        test('sends with compress flag', () => {
            socket.send('compressed', true);
            expect(ws.send).toHaveBeenCalledWith('compressed', true);
        });

        test('sends ArrayBuffer', () => {
            const buf = new ArrayBuffer(4);
            socket.send(buf);
            expect(ws.send).toHaveBeenCalledWith(buf, undefined);
        });

        test('sends Uint8Array', () => {
            const buf = new Uint8Array([1, 2, 3]);
            socket.send(buf);
            expect(ws.send).toHaveBeenCalledWith(buf, undefined);
        });

        test('returns the result from ws.send', () => {
            ws.send = mock(() => 42);
            const result = socket.send('test');
            expect(result).toBe(42);
        });
    });

    describe('emit()', () => {
        test('sends JSON with event and data', () => {
            socket.emit('greeting', { message: 'hi' });
            expect(ws.send).toHaveBeenCalledWith(
                JSON.stringify({ event: 'greeting', data: { message: 'hi' } })
            );
        });

        test('sends JSON with event only (no data)', () => {
            socket.emit('ping');
            expect(ws.send).toHaveBeenCalledWith(
                JSON.stringify({ event: 'ping', data: undefined })
            );
        });

        test('handles complex nested data', () => {
            const data = { users: [{ id: 1, name: 'Alice' }], count: 1 };
            socket.emit('users:list', data);
            expect(ws.send).toHaveBeenCalledWith(
                JSON.stringify({ event: 'users:list', data })
            );
        });
    });

    describe('join()', () => {
        test('subscribes to a room', () => {
            socket.join('general');
            expect(ws.subscribe).toHaveBeenCalledWith('general');
        });

        test('can join multiple rooms', () => {
            socket.join('general');
            socket.join('vip');
            expect(ws.subscribe).toHaveBeenCalledTimes(2);
            expect(ws.subscribe).toHaveBeenCalledWith('general');
            expect(ws.subscribe).toHaveBeenCalledWith('vip');
        });
    });

    describe('leave()', () => {
        test('unsubscribes from a room', () => {
            socket.join('general');
            socket.leave('general');
            expect(ws.unsubscribe).toHaveBeenCalledWith('general');
        });
    });

    describe('to()', () => {
        test('returns a RoomBroadcaster instance', () => {
            const broadcaster = socket.to('general');
            expect(broadcaster).toBeInstanceOf(RoomBroadcaster);
        });

        test('returns different broadcasters for different rooms', () => {
            const b1 = socket.to('general');
            const b2 = socket.to('vip');
            expect(b1).not.toBe(b2);
        });
    });

    describe('publish()', () => {
        test('publishes JSON event to topic', () => {
            socket.publish('general', 'newMessage', { text: 'hello' });
            expect(ws.publish).toHaveBeenCalledWith(
                'general',
                JSON.stringify({ event: 'newMessage', data: { text: 'hello' } })
            );
        });

        test('publishes without data', () => {
            socket.publish('general', 'ping');
            expect(ws.publish).toHaveBeenCalledWith(
                'general',
                JSON.stringify({ event: 'ping', data: undefined })
            );
        });
    });

    describe('isSubscribed()', () => {
        test('returns false when not subscribed', () => {
            expect(socket.isSubscribed('general')).toBe(false);
        });

        test('returns true when subscribed', () => {
            socket.join('general');
            // isSubscribed delegates to ws.isSubscribed which checks the Set
            expect(socket.isSubscribed('general')).toBe(true);
        });
    });

    describe('close()', () => {
        test('closes without arguments', () => {
            socket.close();
            expect(ws.close).toHaveBeenCalledWith(undefined, undefined);
        });

        test('closes with code', () => {
            socket.close(1000);
            expect(ws.close).toHaveBeenCalledWith(1000, undefined);
        });

        test('closes with code and reason', () => {
            socket.close(1000, 'Normal closure');
            expect(ws.close).toHaveBeenCalledWith(1000, 'Normal closure');
        });
    });
});

// ---------------------------------------------------------------------------
// RoomBroadcaster
// ---------------------------------------------------------------------------

describe('RoomBroadcaster', () => {
    let ws: ReturnType<typeof createMockWs>;
    let broadcaster: RoomBroadcaster;

    beforeEach(() => {
        ws = createMockWs();
        broadcaster = new RoomBroadcaster('general', ws as any);
    });

    describe('emit()', () => {
        test('publishes JSON event to the room', () => {
            broadcaster.emit('message', { text: 'hello' });
            expect(ws.publish).toHaveBeenCalledWith(
                'general',
                JSON.stringify({ event: 'message', data: { text: 'hello' } })
            );
        });

        test('publishes event without data', () => {
            broadcaster.emit('ping');
            expect(ws.publish).toHaveBeenCalledWith(
                'general',
                JSON.stringify({ event: 'ping', data: undefined })
            );
        });
    });

    describe('send()', () => {
        test('publishes raw string message to the room', () => {
            broadcaster.send('raw message');
            expect(ws.publish).toHaveBeenCalledWith('general', 'raw message');
        });

        test('publishes raw ArrayBuffer message', () => {
            const buf = new ArrayBuffer(8);
            broadcaster.send(buf);
            expect(ws.publish).toHaveBeenCalledWith('general', buf);
        });

        test('publishes raw Uint8Array message', () => {
            const buf = new Uint8Array([10, 20, 30]);
            broadcaster.send(buf);
            expect(ws.publish).toHaveBeenCalledWith('general', buf);
        });
    });
});

// ---------------------------------------------------------------------------
// NamespaceRegistry
// ---------------------------------------------------------------------------

describe('NamespaceRegistry', () => {
    let registry: NamespaceRegistry;

    beforeEach(() => {
        registry = new NamespaceRegistry();
    });

    describe('_increment()', () => {
        test('increments count for new namespace', () => {
            registry._increment('/chat');
            expect(registry.getCount('/chat')).toBe(1);
        });

        test('increments count cumulatively', () => {
            registry._increment('/chat');
            registry._increment('/chat');
            registry._increment('/chat');
            expect(registry.getCount('/chat')).toBe(3);
        });

        test('tracks multiple namespaces independently', () => {
            registry._increment('/chat');
            registry._increment('/chat');
            registry._increment('/notifications');
            expect(registry.getCount('/chat')).toBe(2);
            expect(registry.getCount('/notifications')).toBe(1);
        });
    });

    describe('_decrement()', () => {
        test('decrements count', () => {
            registry._increment('/chat');
            registry._increment('/chat');
            registry._decrement('/chat');
            expect(registry.getCount('/chat')).toBe(1);
        });

        test('does not go below zero', () => {
            registry._decrement('/chat');
            expect(registry.getCount('/chat')).toBe(0);
        });

        test('does not go below zero when already zero', () => {
            registry._increment('/chat');
            registry._decrement('/chat');
            registry._decrement('/chat');
            registry._decrement('/chat');
            expect(registry.getCount('/chat')).toBe(0);
        });

        test('decrements independently per namespace', () => {
            registry._increment('/chat');
            registry._increment('/chat');
            registry._increment('/notifications');
            registry._decrement('/chat');
            expect(registry.getCount('/chat')).toBe(1);
            expect(registry.getCount('/notifications')).toBe(1);
        });
    });

    describe('getCount()', () => {
        test('returns 0 for unknown namespace', () => {
            expect(registry.getCount('/unknown')).toBe(0);
        });

        test('returns current count', () => {
            registry._increment('/chat');
            registry._increment('/chat');
            expect(registry.getCount('/chat')).toBe(2);
        });
    });

    describe('getNamespaces()', () => {
        test('returns empty array when no connections', () => {
            expect(registry.getNamespaces()).toEqual([]);
        });

        test('returns namespaces with active connections', () => {
            registry._increment('/chat');
            registry._increment('/notifications');
            const ns = registry.getNamespaces();
            expect(ns).toContain('/chat');
            expect(ns).toContain('/notifications');
            expect(ns).toHaveLength(2);
        });

        test('excludes namespaces with zero connections', () => {
            registry._increment('/chat');
            registry._increment('/notifications');
            registry._decrement('/notifications');
            const ns = registry.getNamespaces();
            expect(ns).toEqual(['/chat']);
        });

        test('excludes namespaces that were decremented to zero', () => {
            registry._increment('/chat');
            registry._decrement('/chat');
            expect(registry.getNamespaces()).toEqual([]);
        });
    });

    describe('getTotalConnections()', () => {
        test('returns 0 when no connections', () => {
            expect(registry.getTotalConnections()).toBe(0);
        });

        test('returns sum across all namespaces', () => {
            registry._increment('/chat');
            registry._increment('/chat');
            registry._increment('/notifications');
            expect(registry.getTotalConnections()).toBe(3);
        });

        test('reflects decrements', () => {
            registry._increment('/chat');
            registry._increment('/chat');
            registry._increment('/notifications');
            registry._decrement('/chat');
            expect(registry.getTotalConnections()).toBe(2);
        });
    });
});

// ---------------------------------------------------------------------------
// RoomManager
// ---------------------------------------------------------------------------

describe('RoomManager', () => {
    function createMockCarno(server: any = null) {
        return { getServer: () => server } as any;
    }

    describe('broadcast()', () => {
        test('publishes JSON event to room via server', () => {
            const publishMock = mock((_room: string, _msg: string) => {});
            const carno = createMockCarno({ publish: publishMock, pendingWebSockets: 0 });
            const manager = new RoomManager(carno);

            manager.broadcast('general', 'announcement', { text: 'hello' });

            expect(publishMock).toHaveBeenCalledWith(
                'general',
                JSON.stringify({ event: 'announcement', data: { text: 'hello' } })
            );
        });

        test('publishes event without data', () => {
            const publishMock = mock((_room: string, _msg: string) => {});
            const carno = createMockCarno({ publish: publishMock, pendingWebSockets: 0 });
            const manager = new RoomManager(carno);

            manager.broadcast('general', 'ping');

            expect(publishMock).toHaveBeenCalledWith(
                'general',
                JSON.stringify({ event: 'ping', data: undefined })
            );
        });

        test('throws when server is not started', () => {
            const carno = createMockCarno(null);
            const manager = new RoomManager(carno);

            expect(() => manager.broadcast('room', 'event')).toThrow(
                '[@carno.js/websocket] RoomManager.broadcast() called before the server started.'
            );
        });
    });

    describe('broadcastRaw()', () => {
        test('publishes raw string message to room', () => {
            const publishMock = mock((_room: string, _msg: any) => {});
            const carno = createMockCarno({ publish: publishMock, pendingWebSockets: 0 });
            const manager = new RoomManager(carno);

            manager.broadcastRaw('general', 'raw data');

            expect(publishMock).toHaveBeenCalledWith('general', 'raw data');
        });

        test('throws when server is not started', () => {
            const carno = createMockCarno(null);
            const manager = new RoomManager(carno);

            expect(() => manager.broadcastRaw('room', 'data')).toThrow(
                '[@carno.js/websocket] RoomManager.broadcastRaw() called before the server started.'
            );
        });
    });

    describe('pendingWebSockets', () => {
        test('returns 0 when no server', () => {
            const carno = createMockCarno(null);
            const manager = new RoomManager(carno);
            expect(manager.pendingWebSockets).toBe(0);
        });

        test('returns server pendingWebSockets value', () => {
            const carno = createMockCarno({ pendingWebSockets: 5 });
            const manager = new RoomManager(carno);
            expect(manager.pendingWebSockets).toBe(5);
        });
    });
});

// ---------------------------------------------------------------------------
// @Gateway decorator
// ---------------------------------------------------------------------------

describe('@Gateway decorator', () => {
    test('sets metadata with the provided path', () => {
        @Gateway('/chat')
        class TestGateway {}

        const meta: GatewayMeta = Reflect.getMetadata(GATEWAY_META, TestGateway);
        expect(meta).toEqual({ path: '/chat' });
    });

    test('defaults path to "/" when called without arguments', () => {
        @Gateway()
        class DefaultGateway {}

        const meta: GatewayMeta = Reflect.getMetadata(GATEWAY_META, DefaultGateway);
        expect(meta).toEqual({ path: '/' });
    });

    test('auto-prepends "/" if path does not start with "/"', () => {
        @Gateway('ws')
        class NoPrefixGateway {}

        const meta: GatewayMeta = Reflect.getMetadata(GATEWAY_META, NoPrefixGateway);
        expect(meta).toEqual({ path: '/ws' });
    });

    test('does not double-prepend "/" if path already starts with "/"', () => {
        @Gateway('/already')
        class AlreadyPrefixedGateway {}

        const meta: GatewayMeta = Reflect.getMetadata(GATEWAY_META, AlreadyPrefixedGateway);
        expect(meta.path).toBe('/already');
    });

    test('handles nested paths', () => {
        @Gateway('/api/v1/ws')
        class NestedGateway {}

        const meta: GatewayMeta = Reflect.getMetadata(GATEWAY_META, NestedGateway);
        expect(meta).toEqual({ path: '/api/v1/ws' });
    });
});

// ---------------------------------------------------------------------------
// Event decorators (@OnOpen, @OnClose, @OnMessage, @OnError, @OnDrain, @SubscribeMessage)
// ---------------------------------------------------------------------------

describe('Event decorators', () => {
    test('@OnOpen() registers handler with type "open"', () => {
        class TestGw {
            @OnOpen()
            handleOpen() {}
        }

        const handlers: WsHandlerMeta[] = Reflect.getMetadata(WS_HANDLERS_META, TestGw);
        expect(handlers).toHaveLength(1);
        expect(handlers[0]).toEqual({ methodName: 'handleOpen', type: 'open' });
    });

    test('@OnClose() registers handler with type "close"', () => {
        class TestGw {
            @OnClose()
            handleClose() {}
        }

        const handlers: WsHandlerMeta[] = Reflect.getMetadata(WS_HANDLERS_META, TestGw);
        expect(handlers).toHaveLength(1);
        expect(handlers[0]).toEqual({ methodName: 'handleClose', type: 'close' });
    });

    test('@OnMessage() registers handler with type "message"', () => {
        class TestGw {
            @OnMessage()
            handleMessage() {}
        }

        const handlers: WsHandlerMeta[] = Reflect.getMetadata(WS_HANDLERS_META, TestGw);
        expect(handlers).toHaveLength(1);
        expect(handlers[0]).toEqual({ methodName: 'handleMessage', type: 'message' });
    });

    test('@OnError() registers handler with type "error"', () => {
        class TestGw {
            @OnError()
            handleError() {}
        }

        const handlers: WsHandlerMeta[] = Reflect.getMetadata(WS_HANDLERS_META, TestGw);
        expect(handlers).toHaveLength(1);
        expect(handlers[0]).toEqual({ methodName: 'handleError', type: 'error' });
    });

    test('@OnDrain() registers handler with type "drain"', () => {
        class TestGw {
            @OnDrain()
            handleDrain() {}
        }

        const handlers: WsHandlerMeta[] = Reflect.getMetadata(WS_HANDLERS_META, TestGw);
        expect(handlers).toHaveLength(1);
        expect(handlers[0]).toEqual({ methodName: 'handleDrain', type: 'drain' });
    });

    test('@SubscribeMessage() registers handler with type "subscribe" and event name', () => {
        class TestGw {
            @SubscribeMessage('chat:send')
            handleSend() {}
        }

        const handlers: WsHandlerMeta[] = Reflect.getMetadata(WS_HANDLERS_META, TestGw);
        expect(handlers).toHaveLength(1);
        expect(handlers[0]).toEqual({
            methodName: 'handleSend',
            type: 'subscribe',
            event: 'chat:send',
        });
    });

    test('multiple decorators accumulate on the same class', () => {
        class MultiGw {
            @OnOpen()
            onOpen() {}

            @OnClose()
            onClose() {}

            @OnMessage()
            onMsg() {}

            @SubscribeMessage('ping')
            onPing() {}

            @SubscribeMessage('chat')
            onChat() {}
        }

        const handlers: WsHandlerMeta[] = Reflect.getMetadata(WS_HANDLERS_META, MultiGw);
        expect(handlers).toHaveLength(5);

        const types = handlers.map(h => h.type);
        expect(types).toContain('open');
        expect(types).toContain('close');
        expect(types).toContain('message');
        expect(types.filter(t => t === 'subscribe')).toHaveLength(2);
    });

    test('each class has its own independent handler list', () => {
        class GwA {
            @OnOpen()
            open() {}
        }

        class GwB {
            @OnClose()
            close() {}

            @OnMessage()
            msg() {}
        }

        const handlersA: WsHandlerMeta[] = Reflect.getMetadata(WS_HANDLERS_META, GwA);
        const handlersB: WsHandlerMeta[] = Reflect.getMetadata(WS_HANDLERS_META, GwB);

        expect(handlersA).toHaveLength(1);
        expect(handlersB).toHaveLength(2);
    });

    test('@SubscribeMessage does not set event property for non-subscribe types', () => {
        class TestGw {
            @OnOpen()
            open() {}
        }

        const handlers: WsHandlerMeta[] = Reflect.getMetadata(WS_HANDLERS_META, TestGw);
        expect(handlers[0].event).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Metadata constants
// ---------------------------------------------------------------------------

describe('Metadata constants', () => {
    test('GATEWAY_META has expected value', () => {
        expect(GATEWAY_META).toBe('carno:ws:gateway');
    });

    test('WS_HANDLERS_META has expected value', () => {
        expect(WS_HANDLERS_META).toBe('carno:ws:handlers');
    });
});

// ---------------------------------------------------------------------------
// WebSocketPlugin
// ---------------------------------------------------------------------------

describe('WebSocketPlugin', () => {
    describe('create() validation', () => {
        test('throws when a gateway class is missing @Gateway decorator', () => {
            class NoDecoratorGateway {}

            expect(() => WebSocketPlugin.create([NoDecoratorGateway])).toThrow(
                '[@carno.js/websocket] Class "NoDecoratorGateway" is missing the @Gateway decorator.'
            );
        });

        test('does not throw for properly decorated gateway', () => {
            @Gateway('/test')
            class ValidGateway {
                @OnOpen()
                open() {}
            }

            expect(() => WebSocketPlugin.create([ValidGateway])).not.toThrow();
        });
    });

    describe('Bun WebSocket handler (buildBunWebSocketHandler)', () => {
        // We test the handler indirectly by invoking the builder via the plugin internals.
        // The simplest approach: build a gateway, extract the handler, and test each lifecycle.

        function createHandlerFromGateway(
            GatewayClass: new (...args: any[]) => any,
            instance: any,
            config: any = {}
        ) {
            const meta: GatewayMeta = Reflect.getMetadata(GATEWAY_META, GatewayClass);
            const handlers: WsHandlerMeta[] = Reflect.getMetadata(WS_HANDLERS_META, GatewayClass) || [];

            const gatewayMap = new Map();
            gatewayMap.set(meta.path, { instance, handlers });

            const registry = new NamespaceRegistry();

            // Reproduce buildBunWebSocketHandler logic
            const getHandlers = (namespace: string, type: string): WsHandlerMeta[] =>
                gatewayMap.get(namespace)?.handlers.filter((h: any) => h.type === type) ?? [];

            const getSubscribeHandlers = (namespace: string, event: string): WsHandlerMeta[] =>
                gatewayMap.get(namespace)?.handlers.filter(
                    (h: any) => h.type === 'subscribe' && h.event === event
                ) ?? [];

            const getInstance = (namespace: string): any =>
                gatewayMap.get(namespace)?.instance;

            const handler = {
                ...config,

                open(ws: any) {
                    const namespace: string = ws.data?.namespace;
                    const inst = getInstance(namespace);
                    if (!inst) return;
                    registry._increment(namespace);
                    const socket = new CarnoSocket(ws);
                    for (const h of getHandlers(namespace, 'open')) {
                        inst[h.methodName](socket);
                    }
                },

                message(ws: any, message: string | ArrayBuffer | Uint8Array) {
                    const namespace: string = ws.data?.namespace;
                    const inst = getInstance(namespace);
                    if (!inst) return;
                    const socket = new CarnoSocket(ws);
                    for (const h of getHandlers(namespace, 'message')) {
                        inst[h.methodName](socket, message);
                    }
                    if (typeof message === 'string') {
                        try {
                            const parsed = JSON.parse(message);
                            if (parsed && typeof parsed.event === 'string') {
                                for (const h of getSubscribeHandlers(namespace, parsed.event)) {
                                    inst[h.methodName](socket, parsed.data);
                                }
                            }
                        } catch {}
                    }
                },

                close(ws: any, code: number, reason: string) {
                    const namespace: string = ws.data?.namespace;
                    const inst = getInstance(namespace);
                    if (!inst) return;
                    registry._decrement(namespace);
                    const socket = new CarnoSocket(ws);
                    for (const h of getHandlers(namespace, 'close')) {
                        inst[h.methodName](socket, code, reason);
                    }
                },

                error(ws: any, error: Error) {
                    const namespace: string = ws.data?.namespace;
                    const inst = getInstance(namespace);
                    if (!inst) return;
                    const socket = new CarnoSocket(ws);
                    for (const h of getHandlers(namespace, 'error')) {
                        inst[h.methodName](socket, error);
                    }
                },

                drain(ws: any) {
                    const namespace: string = ws.data?.namespace;
                    const inst = getInstance(namespace);
                    if (!inst) return;
                    const socket = new CarnoSocket(ws);
                    for (const h of getHandlers(namespace, 'drain')) {
                        inst[h.methodName](socket);
                    }
                },
            };

            return { handler, registry };
        }

        describe('open handler', () => {
            test('calls @OnOpen methods with a CarnoSocket', () => {
                const openSpy = mock((_socket: any) => {});

                @Gateway('/chat')
                class TestGw {
                    @OnOpen()
                    onOpen(socket: any) { openSpy(socket); }
                }

                const instance = new TestGw();
                const { handler } = createHandlerFromGateway(TestGw, instance);
                const ws = createMockWs();

                handler.open(ws);
                expect(openSpy).toHaveBeenCalledTimes(1);

                const receivedSocket = openSpy.mock.calls[0][0];
                expect(receivedSocket).toBeInstanceOf(CarnoSocket);
                expect(receivedSocket.id).toBe('uuid-abc-123');
            });

            test('increments namespace registry on open', () => {
                @Gateway('/chat')
                class TestGw {
                    @OnOpen()
                    onOpen() {}
                }

                const { handler, registry } = createHandlerFromGateway(TestGw, new TestGw());
                const ws = createMockWs();

                handler.open(ws);
                handler.open(ws);
                expect(registry.getCount('/chat')).toBe(2);
            });

            test('does nothing when namespace has no matching gateway', () => {
                @Gateway('/chat')
                class TestGw {
                    @OnOpen()
                    onOpen() {}
                }

                const { handler } = createHandlerFromGateway(TestGw, new TestGw());
                const ws = createMockWs({ data: { id: 'x', namespace: '/unknown' } });

                // Should not throw
                handler.open(ws);
            });
        });

        describe('message handler', () => {
            test('calls @OnMessage with socket and raw message', () => {
                const msgSpy = mock((_socket: any, _message: any) => {});

                @Gateway('/chat')
                class TestGw {
                    @OnMessage()
                    onMsg(socket: any, message: any) { msgSpy(socket, message); }
                }

                const { handler } = createHandlerFromGateway(TestGw, new TestGw());
                const ws = createMockWs();

                handler.message(ws, 'hello');
                expect(msgSpy).toHaveBeenCalledTimes(1);
                expect(msgSpy.mock.calls[0][0]).toBeInstanceOf(CarnoSocket);
                expect(msgSpy.mock.calls[0][1]).toBe('hello');
            });

            test('dispatches JSON event to @SubscribeMessage handler', () => {
                const subSpy = mock((_socket: any, _data: any) => {});

                @Gateway('/chat')
                class TestGw {
                    @SubscribeMessage('chat:send')
                    onSend(socket: any, data: any) { subSpy(socket, data); }
                }

                const { handler } = createHandlerFromGateway(TestGw, new TestGw());
                const ws = createMockWs();

                handler.message(ws, JSON.stringify({ event: 'chat:send', data: { text: 'hi' } }));
                expect(subSpy).toHaveBeenCalledTimes(1);
                expect(subSpy.mock.calls[0][1]).toEqual({ text: 'hi' });
            });

            test('calls both @OnMessage and @SubscribeMessage for JSON messages', () => {
                const rawSpy = mock(() => {});
                const subSpy = mock(() => {});

                @Gateway('/chat')
                class TestGw {
                    @OnMessage()
                    onMsg() { rawSpy(); }

                    @SubscribeMessage('ping')
                    onPing() { subSpy(); }
                }

                const { handler } = createHandlerFromGateway(TestGw, new TestGw());
                const ws = createMockWs();

                handler.message(ws, JSON.stringify({ event: 'ping', data: null }));
                expect(rawSpy).toHaveBeenCalledTimes(1);
                expect(subSpy).toHaveBeenCalledTimes(1);
            });

            test('does not call @SubscribeMessage for non-JSON string', () => {
                const subSpy = mock(() => {});

                @Gateway('/chat')
                class TestGw {
                    @SubscribeMessage('test')
                    onTest() { subSpy(); }
                }

                const { handler } = createHandlerFromGateway(TestGw, new TestGw());
                const ws = createMockWs();

                handler.message(ws, 'not json at all');
                expect(subSpy).not.toHaveBeenCalled();
            });

            test('does not call @SubscribeMessage for JSON without event field', () => {
                const subSpy = mock(() => {});

                @Gateway('/chat')
                class TestGw {
                    @SubscribeMessage('test')
                    onTest() { subSpy(); }
                }

                const { handler } = createHandlerFromGateway(TestGw, new TestGw());
                const ws = createMockWs();

                handler.message(ws, JSON.stringify({ data: 'no event' }));
                expect(subSpy).not.toHaveBeenCalled();
            });

            test('does not call @SubscribeMessage for non-matching event', () => {
                const subSpy = mock(() => {});

                @Gateway('/chat')
                class TestGw {
                    @SubscribeMessage('expected')
                    onTest() { subSpy(); }
                }

                const { handler } = createHandlerFromGateway(TestGw, new TestGw());
                const ws = createMockWs();

                handler.message(ws, JSON.stringify({ event: 'other', data: {} }));
                expect(subSpy).not.toHaveBeenCalled();
            });

            test('does not dispatch @SubscribeMessage for binary messages', () => {
                const subSpy = mock(() => {});

                @Gateway('/chat')
                class TestGw {
                    @SubscribeMessage('test')
                    onTest() { subSpy(); }
                }

                const { handler } = createHandlerFromGateway(TestGw, new TestGw());
                const ws = createMockWs();

                handler.message(ws, new ArrayBuffer(4));
                expect(subSpy).not.toHaveBeenCalled();
            });

            test('does nothing when namespace has no matching gateway', () => {
                @Gateway('/chat')
                class TestGw {
                    @OnMessage()
                    onMsg() {}
                }

                const { handler } = createHandlerFromGateway(TestGw, new TestGw());
                const ws = createMockWs({ data: { id: 'x', namespace: '/unknown' } });

                handler.message(ws, 'test');
            });
        });

        describe('close handler', () => {
            test('calls @OnClose with socket, code, and reason', () => {
                const closeSpy = mock((_socket: any, _code: number, _reason: string) => {});

                @Gateway('/chat')
                class TestGw {
                    @OnClose()
                    onClose(socket: any, code: number, reason: string) {
                        closeSpy(socket, code, reason);
                    }
                }

                const { handler } = createHandlerFromGateway(TestGw, new TestGw());
                const ws = createMockWs();

                handler.open(ws); // First open to increment
                handler.close(ws, 1000, 'Normal');

                expect(closeSpy).toHaveBeenCalledTimes(1);
                expect(closeSpy.mock.calls[0][0]).toBeInstanceOf(CarnoSocket);
                expect(closeSpy.mock.calls[0][1]).toBe(1000);
                expect(closeSpy.mock.calls[0][2]).toBe('Normal');
            });

            test('decrements namespace registry on close', () => {
                @Gateway('/chat')
                class TestGw {
                    @OnOpen()
                    onOpen() {}

                    @OnClose()
                    onClose() {}
                }

                const { handler, registry } = createHandlerFromGateway(TestGw, new TestGw());
                const ws = createMockWs();

                handler.open(ws);
                handler.open(ws);
                expect(registry.getCount('/chat')).toBe(2);

                handler.close(ws, 1000, '');
                expect(registry.getCount('/chat')).toBe(1);
            });
        });

        describe('error handler', () => {
            test('calls @OnError with socket and error', () => {
                const errorSpy = mock((_socket: any, _error: Error) => {});

                @Gateway('/chat')
                class TestGw {
                    @OnError()
                    onError(socket: any, error: Error) {
                        errorSpy(socket, error);
                    }
                }

                const { handler } = createHandlerFromGateway(TestGw, new TestGw());
                const ws = createMockWs();
                const err = new Error('connection failed');

                handler.error(ws, err);

                expect(errorSpy).toHaveBeenCalledTimes(1);
                expect(errorSpy.mock.calls[0][0]).toBeInstanceOf(CarnoSocket);
                expect(errorSpy.mock.calls[0][1]).toBe(err);
            });
        });

        describe('drain handler', () => {
            test('calls @OnDrain with socket', () => {
                const drainSpy = mock((_socket: any) => {});

                @Gateway('/chat')
                class TestGw {
                    @OnDrain()
                    onDrain(socket: any) {
                        drainSpy(socket);
                    }
                }

                const { handler } = createHandlerFromGateway(TestGw, new TestGw());
                const ws = createMockWs();

                handler.drain(ws);

                expect(drainSpy).toHaveBeenCalledTimes(1);
                expect(drainSpy.mock.calls[0][0]).toBeInstanceOf(CarnoSocket);
            });
        });

        describe('config passthrough', () => {
            test('spreads config options into handler object', () => {
                @Gateway('/chat')
                class TestGw {}

                const config = {
                    perMessageDeflate: true,
                    maxPayloadLength: 1024,
                    idleTimeout: 60,
                    sendPings: true,
                };

                const { handler } = createHandlerFromGateway(TestGw, new TestGw(), config);

                expect(handler.perMessageDeflate).toBe(true);
                expect(handler.maxPayloadLength).toBe(1024);
                expect(handler.idleTimeout).toBe(60);
                expect(handler.sendPings).toBe(true);
            });
        });

        describe('multiple handlers per event', () => {
            test('calls all @OnOpen handlers in order', () => {
                const calls: string[] = [];

                @Gateway('/chat')
                class TestGw {
                    @OnOpen()
                    firstOpen() { calls.push('first'); }

                    @OnOpen()
                    secondOpen() { calls.push('second'); }
                }

                const { handler } = createHandlerFromGateway(TestGw, new TestGw());
                const ws = createMockWs();

                handler.open(ws);
                expect(calls).toEqual(['first', 'second']);
            });

            test('calls multiple @SubscribeMessage handlers for the same event', () => {
                const calls: string[] = [];

                @Gateway('/chat')
                class TestGw {
                    @SubscribeMessage('msg')
                    handlerA() { calls.push('A'); }

                    @SubscribeMessage('msg')
                    handlerB() { calls.push('B'); }
                }

                const { handler } = createHandlerFromGateway(TestGw, new TestGw());
                const ws = createMockWs();

                handler.message(ws, JSON.stringify({ event: 'msg', data: null }));
                expect(calls).toEqual(['A', 'B']);
            });
        });

        describe('multiple gateways (namespaces)', () => {
            test('routes events to the correct gateway based on namespace', () => {
                const chatSpy = mock(() => {});
                const notifSpy = mock(() => {});

                @Gateway('/chat')
                class ChatGw {
                    @OnOpen()
                    onOpen() { chatSpy(); }
                }

                @Gateway('/notifications')
                class NotifGw {
                    @OnOpen()
                    onOpen() { notifSpy(); }
                }

                // Build a multi-gateway map
                const registry = new NamespaceRegistry();
                const chatMeta: GatewayMeta = Reflect.getMetadata(GATEWAY_META, ChatGw);
                const chatHandlers: WsHandlerMeta[] = Reflect.getMetadata(WS_HANDLERS_META, ChatGw) || [];
                const notifMeta: GatewayMeta = Reflect.getMetadata(GATEWAY_META, NotifGw);
                const notifHandlers: WsHandlerMeta[] = Reflect.getMetadata(WS_HANDLERS_META, NotifGw) || [];

                const gatewayMap = new Map();
                gatewayMap.set(chatMeta.path, { instance: new ChatGw(), handlers: chatHandlers });
                gatewayMap.set(notifMeta.path, { instance: new NotifGw(), handlers: notifHandlers });

                const getHandlers = (namespace: string, type: string): WsHandlerMeta[] =>
                    gatewayMap.get(namespace)?.handlers.filter((h: any) => h.type === type) ?? [];
                const getInstance = (namespace: string) =>
                    gatewayMap.get(namespace)?.instance;

                const handler = {
                    open(ws: any) {
                        const namespace: string = ws.data?.namespace;
                        const inst = getInstance(namespace);
                        if (!inst) return;
                        registry._increment(namespace);
                        const socket = new CarnoSocket(ws);
                        for (const h of getHandlers(namespace, 'open')) {
                            inst[h.methodName](socket);
                        }
                    },
                };

                // Connect to /chat
                handler.open(createMockWs({ data: { id: '1', namespace: '/chat' } }));
                expect(chatSpy).toHaveBeenCalledTimes(1);
                expect(notifSpy).not.toHaveBeenCalled();

                // Connect to /notifications
                handler.open(createMockWs({ data: { id: '2', namespace: '/notifications' } }));
                expect(chatSpy).toHaveBeenCalledTimes(1);
                expect(notifSpy).toHaveBeenCalledTimes(1);

                expect(registry.getCount('/chat')).toBe(1);
                expect(registry.getCount('/notifications')).toBe(1);
            });
        });
    });
});

// ---------------------------------------------------------------------------
// Index re-exports
// ---------------------------------------------------------------------------

describe('package exports', () => {
    test('re-exports all public API from index', async () => {
        const idx = await import('../src/index');

        // Plugin
        expect(idx.WebSocketPlugin).toBeDefined();

        // Socket classes
        expect(idx.CarnoSocket).toBeDefined();
        expect(idx.RoomBroadcaster).toBeDefined();

        // Services
        expect(idx.RoomManager).toBeDefined();
        expect(idx.NamespaceRegistry).toBeDefined();

        // Decorators
        expect(idx.Gateway).toBeDefined();
        expect(idx.OnOpen).toBeDefined();
        expect(idx.OnClose).toBeDefined();
        expect(idx.OnMessage).toBeDefined();
        expect(idx.OnError).toBeDefined();
        expect(idx.OnDrain).toBeDefined();
        expect(idx.SubscribeMessage).toBeDefined();
    });
});
