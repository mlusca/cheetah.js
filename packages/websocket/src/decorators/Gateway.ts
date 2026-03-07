import 'reflect-metadata';
import { GATEWAY_META } from '../metadata';
import type { GatewayMeta } from '../types';

/**
 * Marks a class as a WebSocket gateway.
 * The `path` is the HTTP endpoint that will be upgraded to a WebSocket connection
 * and also acts as the namespace identifier.
 *
 * @example
 * ```ts
 * @Gateway('/chat')
 * class ChatGateway {
 *   @OnOpen()
 *   onOpen(socket: CarnoSocket) { socket.join('general'); }
 * }
 * ```
 */
export function Gateway(path: string = '/'): ClassDecorator {
    return (target: any) => {
        const meta: GatewayMeta = { path: path.startsWith('/') ? path : `/${path}` };
        Reflect.defineMetadata(GATEWAY_META, meta, target);
    };
}
