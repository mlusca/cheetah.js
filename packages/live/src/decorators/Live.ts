import 'reflect-metadata';
import { LIVE_META, type LiveMeta, type LiveOptions } from '../metadata';

/** Marks an existing route as subscribable while keeping it a normal HTTP route. */
export function Live(options: LiveOptions = {}): MethodDecorator {
    return function (target: any, propertyKey: string | symbol): void {
        const meta: LiveMeta = {
            key: options.key,
            shared: options.shared ?? 'private',
            dependsOn: options.dependsOn ?? [],
            handlerName: String(propertyKey)
        };

        Reflect.defineMetadata(LIVE_META, meta, target.constructor, String(propertyKey));
    };
}
