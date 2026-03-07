import 'reflect-metadata';
import { WS_HANDLERS_META } from '../metadata';
import type { WsHandlerMeta, WsEventType } from '../types';

function registerHandler(
    target: any,
    methodName: string,
    type: WsEventType,
    event?: string
): void {
    const existing: WsHandlerMeta[] = Reflect.getMetadata(WS_HANDLERS_META, target.constructor) || [];
    existing.push({ methodName, type, ...(event !== undefined ? { event } : {}) });
    Reflect.defineMetadata(WS_HANDLERS_META, existing, target.constructor);
}

/**
 * Called when a new WebSocket connection is established.
 *
 * @example
 * ```ts
 * @OnOpen()
 * onOpen(socket: CarnoSocket) { socket.join('general'); }
 * ```
 */
export function OnOpen(): MethodDecorator {
    return (target: any, propertyKey: string | symbol) => {
        registerHandler(target, String(propertyKey), 'open');
    };
}

/**
 * Called when a WebSocket connection is closed.
 *
 * @example
 * ```ts
 * @OnClose()
 * onClose(socket: CarnoSocket, code: number, reason: string) {}
 * ```
 */
export function OnClose(): MethodDecorator {
    return (target: any, propertyKey: string | symbol) => {
        registerHandler(target, String(propertyKey), 'close');
    };
}

/**
 * Called when a raw message is received (any format).
 * For event-based dispatch, prefer `@SubscribeMessage`.
 *
 * @example
 * ```ts
 * @OnMessage()
 * onMessage(socket: CarnoSocket, message: string | Buffer) {}
 * ```
 */
export function OnMessage(): MethodDecorator {
    return (target: any, propertyKey: string | symbol) => {
        registerHandler(target, String(propertyKey), 'message');
    };
}

/**
 * Called when a WebSocket error occurs.
 *
 * @example
 * ```ts
 * @OnError()
 * onError(socket: CarnoSocket, error: Error) {}
 * ```
 */
export function OnError(): MethodDecorator {
    return (target: any, propertyKey: string | symbol) => {
        registerHandler(target, String(propertyKey), 'error');
    };
}

/**
 * Called when the socket is ready to receive more data after backpressure.
 *
 * @example
 * ```ts
 * @OnDrain()
 * onDrain(socket: CarnoSocket) {}
 * ```
 */
export function OnDrain(): MethodDecorator {
    return (target: any, propertyKey: string | symbol) => {
        registerHandler(target, String(propertyKey), 'drain');
    };
}

/**
 * Subscribes to a specific named event sent by the client as JSON:
 * `{ "event": "<name>", "data": <payload> }`.
 *
 * @param event - Event name to match.
 *
 * @example
 * ```ts
 * @SubscribeMessage('send')
 * onSend(socket: CarnoSocket, payload: { message: string }) {
 *   socket.to('general').emit('message', payload);
 * }
 * ```
 */
export function SubscribeMessage(event: string): MethodDecorator {
    return (target: any, propertyKey: string | symbol) => {
        registerHandler(target, String(propertyKey), 'subscribe', event);
    };
}
