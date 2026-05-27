import { POST_CONSTRUCT_META, PRE_DESTROY_META } from '../metadata';

/**
 * Decorator to designate a method to be run after dependency injection has been completed.
 */
export function PostConstruct(): any {
    return function (
        targetOrMethod: any,
        contextOrPropertyKey?: string | symbol | ClassMethodDecoratorContext,
        descriptor?: PropertyDescriptor
    ): any {
        // TS5 Stage 3 decorators: context is ClassMethodDecoratorContext
        if (contextOrPropertyKey && typeof contextOrPropertyKey === 'object' && 'kind' in contextOrPropertyKey) {
            const context = contextOrPropertyKey as ClassMethodDecoratorContext;

            context.addInitializer(function (this: any) {
                const constructor = this.constructor;
                Reflect.defineMetadata(POST_CONSTRUCT_META, context.name, constructor);
            });

            return targetOrMethod;
        }

        // Legacy decorators (experimentalDecorators: true)
        const constructor = targetOrMethod.constructor;
        const propertyKey = contextOrPropertyKey as string | symbol;
        Reflect.defineMetadata(POST_CONSTRUCT_META, propertyKey, constructor);
    };
}

/**
 * Decorator to designate a method to be run during container/application shutdown.
 */
export function PreDestroy(): any {
    return function (
        targetOrMethod: any,
        contextOrPropertyKey?: string | symbol | ClassMethodDecoratorContext,
        descriptor?: PropertyDescriptor
    ): any {
        // TS5 Stage 3 decorators: context is ClassMethodDecoratorContext
        if (contextOrPropertyKey && typeof contextOrPropertyKey === 'object' && 'kind' in contextOrPropertyKey) {
            const context = contextOrPropertyKey as ClassMethodDecoratorContext;

            context.addInitializer(function (this: any) {
                const constructor = this.constructor;
                Reflect.defineMetadata(PRE_DESTROY_META, context.name, constructor);
            });

            return targetOrMethod;
        }

        // Legacy decorators (experimentalDecorators: true)
        const constructor = targetOrMethod.constructor;
        const propertyKey = contextOrPropertyKey as string | symbol;
        Reflect.defineMetadata(PRE_DESTROY_META, propertyKey, constructor);
    };
}
