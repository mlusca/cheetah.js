import { POST_CONSTRUCT_META, PRE_DESTROY_META } from '../metadata';

/**
 * Lightweight DI Container for Turbo.
 * 
 * Features:
 * - Constructor injection via reflect-metadata
 * - Singleton scope by default
 * - Request scope support
 * - Lazy instantiation
 */

export type Token<T = any> = new (...args: any[]) => T;

export enum Scope {
    SINGLETON = 'singleton', // Always the same instance
    REQUEST = 'request',     // New instance per request
    INSTANCE = 'instance'    // New instance per dependency injection
}

export interface ProviderConfig<T = any> {
    token: Token<T>;
    useClass?: Token<T>;
    useValue?: T;
    scope?: Scope;
}

interface ProviderEntry {
    config: ProviderConfig;
    instance: any | null;
}

export class Container {
    private configs = new Map<Token, ProviderConfig>();
    private instances = new Map<Token, any>();
    private resolving = new Set<Token>();

    register<T>(config: ProviderConfig<T> | Token<T>): this {
        const normalized = this.normalizeConfig(config);

        this.configs.set(normalized.token, normalized);

        if (normalized.useValue !== undefined) {
            this.instances.set(normalized.token, normalized.useValue);
        }

        return this;
    }

    get<T>(token: Token<T>): T {
        const cached = this.instances.get(token);

        if (cached !== undefined) {
            return cached;
        }

        const res = this.resolveInternal(token);
        return res.instance;
    }

    has(token: Token): boolean {
        return this.configs.has(token);
    }

    hasPreDestroyHooks(): boolean {
        for (const [token, config] of this.configs) {
            const target = config.useClass ?? token;

            if (Reflect.getMetadata(PRE_DESTROY_META, target)) {
                return true;
            }
        }

        for (const [token, instance] of this.instances) {
            const config = this.configs.get(token);
            const target = config?.useClass ?? instance?.constructor ?? token;

            if (Reflect.getMetadata(PRE_DESTROY_META, target)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Resolves a token to return instance and its effective scope.
     */
    private resolveInternal<T>(token: Token<T>, requestLocals?: Map<Token, any>): { instance: T, scope: Scope } {
        // 1. Check Request Cache
        if (requestLocals?.has(token)) {
            return { instance: requestLocals.get(token), scope: Scope.REQUEST };
        }

        // 2. Check Singleton Cache
        const cached = this.instances.get(token);
        if (cached !== undefined) {
            return { instance: cached, scope: Scope.SINGLETON };
        }

        const config = this.configs.get(token);

        if (!config) {
            throw new Error(`Provider not found: ${token.name}`);
        }

        // 3. Create Instance with Scope Bubbling
        const creation = this.createInstance(config, requestLocals);

        // 4. Cache based on Effective Scope
        if (creation.scope === Scope.SINGLETON) {
            this.instances.set(token, creation.instance);
        } else if (creation.scope === Scope.REQUEST && requestLocals) {
            requestLocals.set(token, creation.instance);
        }
        // INSTANCE scope is never cached

        return creation;
    }

    private createInstance(config: ProviderConfig, requestLocals?: Map<Token, any>): { instance: any, scope: Scope } {
        const target = config.useClass ?? config.token;

        if (this.resolving.has(target)) {
            throw new Error(`Circular dependency detected: ${target.name}`);
        }

        this.resolving.add(target);

        try {
            const depsToken = this.getDependencies(target);
            let instance: any;
            let effectiveScope = config.scope || Scope.SINGLETON;

            if (depsToken.length === 0) {
                // No deps: Scope is as configured
                instance = new target();
            } else {
                const args: any[] = [];
                for (const depToken of depsToken) {
                    const depResult = this.resolveInternal(depToken, requestLocals);
                    args.push(depResult.instance);

                    // Scope Bubbling Logic:
                    // If a dependency is REQUEST scoped, the parent MUST become REQUEST scoped (if it was Singleton)
                    // to avoid holding a stale reference to a request-bound instance.
                    if (depResult.scope === Scope.REQUEST && effectiveScope === Scope.SINGLETON) {
                        effectiveScope = Scope.REQUEST;
                    }
                }
                instance = new target(...args);
            }

            // PostConstruct Hook: Retrieve metadata and execute immediately
            const postConstructMethod = Reflect.getMetadata(POST_CONSTRUCT_META, target);
            if (postConstructMethod && typeof instance[postConstructMethod] === 'function') {
                try {
                    const result = instance[postConstructMethod]();
                    if (result instanceof Promise) {
                        result.catch((err) => {
                            console.error(`Error in PostConstruct hook of ${target.name}:`, err);
                        });
                    }
                } catch (err) {
                    console.error(`Error in PostConstruct hook of ${target.name}:`, err);
                }
            }

            return { instance, scope: effectiveScope };
        } finally {
            this.resolving.delete(target);
        }
    }

    private getDependencies(target: Token): Token[] {
        const types = Reflect.getMetadata('design:paramtypes', target) || [];
        return types.filter((t: any) => t && typeof t === 'function' && !this.isPrimitive(t));
    }

    private isPrimitive(type: any): boolean {
        return type === String || type === Number || type === Boolean || type === Object || type === Array || type === Symbol;
    }

    private normalizeConfig<T>(config: ProviderConfig<T> | Token<T>): ProviderConfig<T> {
        if (typeof config === 'function') {
            return {
                token: config,
                useClass: config,
                scope: Scope.SINGLETON
            };
        }

        return {
            ...config,
            useClass: config.useClass ?? config.token,
            scope: config.scope ?? Scope.SINGLETON
        };
    }

    async destroy(): Promise<void> {
        const entries = Array.from(this.instances.entries()).reverse();
        for (const [token, instance] of entries) {
            if (!instance) continue;
            const config = this.configs.get(token);
            const target = config?.useClass ?? instance.constructor ?? token;
            const preDestroyMethod = Reflect.getMetadata(PRE_DESTROY_META, target);
            if (preDestroyMethod && typeof instance[preDestroyMethod] === 'function') {
                try {
                    const result = instance[preDestroyMethod]();
                    if (result instanceof Promise) {
                        await result;
                    }
                } catch (err) {
                    console.error(`Error in PreDestroy hook of ${target.name ?? token.name}:`, err);
                }
            }
        }
    }

    clear(): void {
        this.configs.clear();
        this.instances.clear();
    }
}
