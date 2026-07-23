import 'reflect-metadata';

import { CONTROLLER_META, ROUTES_META, PARAMS_META, MIDDLEWARE_META } from './metadata';
import type { RouteInfo, MiddlewareInfo, ControllerMeta } from './metadata';
import type { ParamMetadata } from './decorators/params';
// RadixRouter removed - using Bun's native SIMD-accelerated router
import { compileHandler } from './compiler/JITCompiler';
import { Context } from './context/Context';
import { Container, Scope } from './container/Container';
import type { Token, ProviderConfig } from './container/Container';
import { CorsHandler, type CorsConfig } from './cors/CorsHandler';
import type { ValidatorAdapter } from './validation/ValidatorAdapter';
import { HttpException } from './exceptions/HttpException';
import { ValidationException } from './validation/ZodAdapter';
import { EventType, hasEventHandlers, getEventHandlers } from './events/Lifecycle';
import { CacheService } from './cache/CacheService';
import type { CacheConfig } from './cache/CacheDriver';
import { DEFAULT_STATIC_ROUTES } from './DefaultRoutes';
import { ZodAdapter } from './validation/ZodAdapter';
import type { CarnoMiddleware } from './middleware/CarnoMiddleware';

export type MiddlewareHandler = (ctx: Context) => Response | void | Promise<Response | void>;

export type MiddlewareClass = new (...args: any[]) => CarnoMiddleware;

export type MiddlewareEntry = MiddlewareHandler | MiddlewareClass | CarnoMiddleware;

type ResolvedMiddleware =
    | { kind: 'function'; handler: MiddlewareHandler }
    | { kind: 'class'; instance: CarnoMiddleware };

/**
 * Carno plugin configuration.
 */
export interface CarnoConfig {
    exports?: (Token | ProviderConfig)[];
    globalMiddlewares?: MiddlewareEntry[];
    disableStartupLog?: boolean;
    cors?: CorsConfig;
    validation?: ValidatorAdapter | boolean | (new (...args: any[]) => ValidatorAdapter);
    cache?: CacheConfig | boolean;
}

// CompiledRoute removed - handlers are registered directly in Bun's routes

const NOT_FOUND_RESPONSE = new Response('Not Found', { status: 404 });

/**
 * Pre-computed response - frozen and reused.
 */
const TEXT_OPTS = Object.freeze({
    status: 200,
    headers: { 'Content-Type': 'text/plain' }
});

const JSON_OPTS = Object.freeze({
    status: 200,
    headers: { 'Content-Type': 'application/json' }
});

const INTERNAL_ERROR_RESPONSE = new Response(
    '{"statusCode":500,"message":"Internal Server Error"}',
    { status: 500, headers: { 'Content-Type': 'application/json' } }
);

// METHOD_MAP removed - Bun handles method routing natively

/**
 * Carno Application - Ultra-aggressive performance.
 * 
 * ZERO runtime work in hot path:
 * - All responses pre-created at startup
 * - Direct Bun native routes - no fetch fallback needed
 * - No function calls in hot path
 */
export class Carno {
    private _controllers: (new (...args: any[]) => any)[] = [];
    private _services: (Token | ProviderConfig)[] = [];
    private _middlewares: MiddlewareEntry[] = [];
    private routes: Record<string, Record<string, Response | Function> | Response | Function> = {};
    private container = new Container();
    private corsHandler: CorsHandler | null = null;
    private hasCors = false;
    private validator: ValidatorAdapter | null = null;
    private server: any;

    // WebSocket support
    _wsHandlerBuilder: ((container: Container) => any) | null = null;
    _wsUpgradePaths: Set<string> = new Set();

    // Cached lifecycle event flags - checked once at startup
    private hasInitHooks = false;
    private hasBootHooks = false;

    constructor(public config: CarnoConfig = {}) {
        this.config.exports = this.config.exports || [];
        this.config.globalMiddlewares = this.config.globalMiddlewares || [];

        // Initialize CORS handler if configured
        if (this.config.cors) {
            this.corsHandler = new CorsHandler(this.config.cors);
            this.hasCors = true;
        }

        // Initialize validator
        // Default: ZodAdapter if undefined or true
        if (this.config.validation === undefined || this.config.validation === true) {
            this.validator = new ZodAdapter();
        }
        // Constructor class passed directly
        else if (typeof this.config.validation === 'function') {
            const AdapterClass = this.config.validation as (new (...args: any[]) => ValidatorAdapter);
            this.validator = new AdapterClass();
        }
        // Instance passed directly
        else if (this.config.validation) {
            this.validator = this.config.validation as ValidatorAdapter;
        }
    }

    /**
     * Use a Carno plugin.
     * Imports controllers, services, middlewares, routes, and WebSocket config from another Carno instance.
     */
    use(plugin: Carno): this {
        // Import controllers from plugin
        if (plugin._controllers.length > 0) {
            this._controllers.push(...plugin._controllers);
        }

        // Import services from plugin exports
        for (const exported of plugin.config.exports || []) {
            const existingService = this.findServiceInPlugin(plugin, exported);
            const serviceToAdd = this.shouldCloneService(existingService)
                ? { ...existingService }
                : exported;

            this._services.push(serviceToAdd);
        }

        // Import services registered via .services() on the plugin
        if (plugin._services.length > 0) {
            this._services.push(...plugin._services);
        }

        // Import global middlewares
        if (plugin.config.globalMiddlewares) {
            this._middlewares.push(...plugin.config.globalMiddlewares);
        }

        // Import middlewares registered via .middlewares() on the plugin
        if (plugin._middlewares.length > 0) {
            this._middlewares.push(...plugin._middlewares);
        }

        // Import routes registered via .route() or .addRoutes() on the plugin
        for (const [path, methods] of Object.entries(plugin.routes)) {
            if (!this.routes[path]) {
                this.routes[path] = {};
            }

            // Merge methods for this path
            if (typeof methods === 'object' && methods !== null && !(methods instanceof Response)) {
                Object.assign(this.routes[path], methods);
            } else {
                // Single handler (Response or Function) - preserve it
                this.routes[path] = methods;
            }
        }

        // Import WebSocket handler builder and upgrade paths
        if (plugin._wsHandlerBuilder) {
            this._wsHandlerBuilder = plugin._wsHandlerBuilder;
            for (const path of plugin._wsUpgradePaths) {
                this._wsUpgradePaths.add(path);
            }
        }

        return this;
    }

    /**
     * Register a WebSocket handler builder and the upgrade paths.
     * Used internally by @carno.js/websocket plugin.
     */
    wsHandler(builder: (container: Container) => any, upgradePaths: string[]): this {
        this._wsHandlerBuilder = builder;
        for (const path of upgradePaths) {
            this._wsUpgradePaths.add(path);
        }
        return this;
    }

    /**
     * Returns the underlying Bun server instance (available after listen()).
     */
    getServer(): any {
        return this.server;
    }

    private findServiceInPlugin(plugin: Carno, exported: any): any | undefined {
        return plugin._services.find(
            s => this.getServiceToken(s) === this.getServiceToken(exported)
        );
    }

    private getServiceToken(service: any): any {
        return service?.token || service;
    }

    private shouldCloneService(service: any): boolean {
        return !!(service?.useValue !== undefined || service?.useClass);
    }

    /**
     * Register one or more services/providers.
     */
    services(serviceClass: Token | ProviderConfig | (Token | ProviderConfig)[]): this {
        const items = Array.isArray(serviceClass) ? serviceClass : [serviceClass];
        this._services.push(...items);
        return this;
    }

    /**
     * Register one or more global middlewares.
     */
    middlewares(handler: MiddlewareEntry | MiddlewareEntry[]): this {
        const items = Array.isArray(handler) ? handler : [handler];
        this._middlewares.push(...items);
        return this;
    }

    /**
     * Register one or more controllers.
     */
    controllers(controllerClass: (new (...args: any[]) => any) | (new (...args: any[]) => any)[]): this {
        const items = Array.isArray(controllerClass) ? controllerClass : [controllerClass];
        this._controllers.push(...items);
        return this;
    }

    /**
     * Register a route programmatically.
     * Useful for plugins that need to register routes without controllers.
     * 
     * @example
     * ```ts
     * app.route('GET', '/health', () => ({ status: 'ok' }));
     * app.route('POST', '/webhook', async (ctx) => {
     *   const data = await ctx.parseBody();
     *   return { received: true };
     * });
     * ```
     */
    route(method: string, path: string, handler: Response | Function): this {
        const normalizedMethod = method.toUpperCase();

        if (!this.routes[path]) {
            this.routes[path] = {};
        }

        this.routes[path][normalizedMethod] = handler;
        return this;
    }

    /**
     * Bulk register multiple routes at once.
     * 
     * @example
     * ```ts
     * app.addRoutes({
     *   '/api/users': {
     *     'GET': () => ({ users: [] }),
     *     'POST': (ctx) => ({ created: true })
     *   },
     *   '/api/health': {
     *     'GET': () => ({ status: 'ok' })
     *   }
     * });
     * ```
     */
    addRoutes(routes: Record<string, Record<string, Response | Function>>): this {
        for (const [path, methods] of Object.entries(routes)) {
            if (!this.routes[path]) {
                this.routes[path] = {};
            }

            for (const [method, handler] of Object.entries(methods)) {
                this.routes[path][method.toUpperCase()] = handler;
            }
        }
        return this;
    }

    /**
     * Get a service instance from the container.
     */
    get<T>(token: Token<T>): T {
        return this.container.get(token);
    }

    /**
     * Bootstrap the application and start listening for HTTP requests.
     *
     * Resolves when `@OnApplicationInit()` hooks (including async ones) have
     * finished and the server is accepting connections. `@OnApplicationBoot()`
     * hooks are started after listen and are not awaited.
     */
    async listen(port: number = 3000): Promise<void> {
        await this.bootstrap();
        this.compileRoutes();

        // All routes go through Bun's native SIMD-accelerated router
        const config: any = {
            port,
            fetch: this.handleNotFound.bind(this),
            error: this.handleError.bind(this),
            routes: {
                ...DEFAULT_STATIC_ROUTES,
                ...this.routes
            }
        };

        // Wire in WebSocket support if a handler builder was registered
        if (this._wsHandlerBuilder && this._wsUpgradePaths.size > 0) {
            config.websocket = this._wsHandlerBuilder(this.container);

            const upgradePaths = this._wsUpgradePaths;
            const fallback = this.handleNotFound.bind(this);

            config.fetch = (req: Request, server: any) => {
                const pathname = new URL(req.url).pathname;

                if (upgradePaths.has(pathname)) {
                    const upgraded = server.upgrade(req, {
                        data: {
                            id: crypto.randomUUID(),
                            namespace: pathname,
                        },
                    });

                    if (upgraded) return;
                    return new Response('WebSocket upgrade failed', { status: 400 });
                }

                return fallback(req);
            };
        }

        this.server = Bun.serve(config);

        // Execute BOOT hooks after server is ready (fire-and-forget)
        if (this.hasBootHooks) {
            void this.executeLifecycleHooks(EventType.BOOT);
        }

        this.registerShutdownHandlers();

        if (!this.config.disableStartupLog) {
            console.log(`Carno running on port ${port}`);
        }
    }

    private async bootstrap(): Promise<void> {
        // Cache lifecycle event flags
        this.hasInitHooks = hasEventHandlers(EventType.INIT);
        this.hasBootHooks = hasEventHandlers(EventType.BOOT);

        // Register Container itself so it can be injected
        this.container.register({
            token: Container,
            useValue: this.container
        });

        // Register this Carno instance so services can inject it (e.g. RoomManager)
        this.container.register({
            token: Carno,
            useValue: this
        });

        // Always register CacheService (Memory by default)
        const cacheConfig = typeof this.config.cache === 'object' ? this.config.cache : {};
        this.container.register({
            token: CacheService,
            useValue: new CacheService(cacheConfig)
        });

        for (const service of this._services) {
            this.container.register(service);
        }

        for (const ControllerClass of this._controllers) {
            this.container.register(ControllerClass);
        }

        // Resolve singleton services before INIT so instances (and @PostConstruct)
        // exist when application init hooks run.
        for (const service of this._services) {
            const token = typeof service === 'function' ? service : service.token;
            const serviceConfig = typeof service === 'function' ? null : service;

            if (!serviceConfig || serviceConfig.scope !== Scope.REQUEST) {
                this.container.get(token);
            }
        }

        if (this.hasInitHooks) {
            await this.executeLifecycleHooks(EventType.INIT);
        }
    }

    private compileRoutes(): void {
        for (const ControllerClass of this._controllers) {
            this.compileController(ControllerClass);
        }
    }

    private compileController(
        ControllerClass: new (...args: any[]) => any,
        parentPath: string = '',
        inheritedMiddlewares: MiddlewareEntry[] = []
    ): void {
        const meta: ControllerMeta = Reflect.getMetadata(CONTROLLER_META, ControllerClass) || { path: '' };
        const basePath = parentPath + (meta.path || '');
        const routes: RouteInfo[] = Reflect.getMetadata(ROUTES_META, ControllerClass) || [];
        const middlewares: MiddlewareInfo[] = Reflect.getMetadata(MIDDLEWARE_META, ControllerClass) || [];
        const instance = this.container.get(ControllerClass);

        // Extract controller-level middlewares (applied to all routes of this controller)
        const controllerMiddlewares = middlewares
            .filter(m => !m.target)
            .map(m => m.handler as MiddlewareEntry);

        // Combine inherited middlewares with this controller's middlewares
        // This combined list is passed down to children and applied to current routes
        const scopedMiddlewares = [...inheritedMiddlewares, ...controllerMiddlewares];

        for (const route of routes) {
            const fullPath = this.normalizePath(basePath + route.path);
            const params: ParamMetadata[] = Reflect.getMetadata(PARAMS_META, ControllerClass, route.handlerName) || [];

            // Middlewares specific to this route handler
            const routeMiddlewares = middlewares
                .filter(m => m.target === route.handlerName)
                .map(m => m.handler as MiddlewareEntry);

            // Get parameter types for validation
            const paramTypes: any[] = Reflect.getMetadata('design:paramtypes', ControllerClass.prototype, route.handlerName) || [];

            // Find Body param with DTO that has @Schema for validation
            let bodyDtoType: any = null;
            for (const param of params) {
                if (param.type === 'body' && !param.key) {
                    const dtoType = paramTypes[param.index];
                    if (dtoType && this.validator?.hasValidation(dtoType)) {
                        bodyDtoType = dtoType;
                    }
                }
            }

            const compiled = compileHandler(instance, route.handlerName, params);

            const allMiddlewares = [
                ...(this.config.globalMiddlewares || []),
                ...this._middlewares,
                ...scopedMiddlewares,
                ...routeMiddlewares
            ];

            // Pre-resolve class-based middlewares at compile time for maximum performance
            const resolvedMiddlewares = allMiddlewares.map(m => this.resolveMiddleware(m));

            const hasMiddlewares = resolvedMiddlewares.length > 0;

            const method = route.method.toUpperCase();

            // Static response - no function needed
            if (compiled.isStatic && !hasMiddlewares) {
                this.registerRoute(fullPath, method, this.createStaticResponse(compiled.staticValue));
            } else {
                // Dynamic handler - compile to Bun-compatible function
                this.registerRoute(fullPath, method, this.createHandler(compiled, params, resolvedMiddlewares, bodyDtoType));
            }
        }

        // Compile child controllers with parent path and inherited middlewares
        if (meta.children) {
            for (const ChildController of meta.children) {
                if (!this.container.has(ChildController)) {
                    this.container.register(ChildController);
                }

                this.compileController(ChildController, basePath, scopedMiddlewares);
            }
        }
    }

    /**
     * Register a route with Bun's native router format.
     * Path: "/users/:id", Method: "GET", Handler: Function or Response
     */
    private registerRoute(path: string, method: string, handler: Response | Function): void {
        if (!this.routes[path]) {
            this.routes[path] = {};
        }

        (this.routes[path] as Record<string, Response | Function>)[method] = handler;
    }

    private createStaticResponse(value: any): Response {
        const isString = typeof value === 'string';
        const body = isString ? value : JSON.stringify(value);
        const opts = isString ? TEXT_OPTS : JSON_OPTS;

        return new Response(body, opts);
    }

    private createHandler(
        compiled: { fn: Function; isAsync: boolean },
        params: ParamMetadata[],
        middlewares: ResolvedMiddleware[],
        bodyDtoType?: any
    ): Function {
        const handler = compiled.fn;
        const hasMiddlewares = middlewares.length > 0;
        const hasParams = params.length > 0;
        const applyCors = this.hasCors ? this.applyCors.bind(this) : null;
        const validator = bodyDtoType ? this.validator : null;
        const needsValidation = !!validator;

        // Force middleware path when validation is needed
        const hasMiddlewaresOrValidation = hasMiddlewares || needsValidation;

        // No middlewares, no params - fastest path
        if (!hasMiddlewaresOrValidation && !hasParams) {
            if (compiled.isAsync) {
                return async (req: Request) => {
                    const ctx = new Context(req);
                    const result = await handler(ctx);
                    const response = this.buildResponse(result);

                    return applyCors ? applyCors(response, req) : response;
                };
            }

            return (req: Request) => {
                const ctx = new Context(req);
                const result = handler(ctx);
                const response = this.buildResponse(result);

                return applyCors ? applyCors(response, req) : response;
            };
        }

        // With params - use Bun's native req.params
        if (!hasMiddlewaresOrValidation && hasParams) {
            if (compiled.isAsync) {
                return async (req: Request) => {
                    const ctx = new Context(req, (req as any).params);
                    const result = await handler(ctx);
                    const response = this.buildResponse(result);

                    return applyCors ? applyCors(response, req) : response;
                };
            }

            return (req: Request) => {
                const ctx = new Context(req, (req as any).params);
                const result = handler(ctx);
                const response = this.buildResponse(result);

                return applyCors ? applyCors(response, req) : response;
            };
        }

        // With middlewares - onion pipeline
        const coreHandler = async (ctx: Context) => {
            // Validate body if validator is configured
            if (validator && bodyDtoType) {
                await ctx.parseBody();
                validator.validateOrThrow(bodyDtoType, ctx.body);
            }

            return compiled.isAsync
                ? await handler(ctx)
                : handler(ctx);
        };

        const chain = this.buildMiddlewareChain(
            middlewares,
            coreHandler,
            this.buildResponse.bind(this)
        );

        return async (req: Request) => {
            const ctx = new Context(req, (req as any).params || {});
            const response = await chain(ctx);

            return applyCors ? applyCors(response, req) : response;
        };
    }

    private resolveMiddleware(middleware: MiddlewareEntry): ResolvedMiddleware {
        if (typeof middleware === 'function' && middleware.prototype?.handle) {
            const instance = this.container.get(middleware as MiddlewareClass) as CarnoMiddleware;
            return { kind: 'class', instance };
        }

        // Pre-built instance with handle method
        if (typeof middleware === 'object' && middleware !== null && 'handle' in middleware) {
            return { kind: 'class', instance: middleware as CarnoMiddleware };
        }

        // Already a function
        return { kind: 'function', handler: middleware as MiddlewareHandler };
    }

    /**
     * Build an onion-style middleware chain.
     * Wraps from inside-out so each middleware can run code before and after next().
     */
    private buildMiddlewareChain(
        middlewares: ResolvedMiddleware[],
        coreHandler: (ctx: Context) => any | Promise<any>,
        buildResponseFn: (result: any) => Response
    ): (ctx: Context) => Promise<Response> {
        let chain: (ctx: Context) => Promise<Response> = async (ctx: Context) => {
            const result = await coreHandler(ctx);
            return buildResponseFn(result);
        };

        for (let i = middlewares.length - 1; i >= 0; i--) {
            const mw = middlewares[i];
            const nextLayer = chain;

            if (mw.kind === 'function') {
                chain = async (ctx: Context) => {
                    const result = await mw.handler(ctx);
                    if (result instanceof Response) {
                        return result;
                    }
                    return nextLayer(ctx);
                };
            } else {
                chain = async (ctx: Context) => {
                    let response: Response | undefined;
                    const result = await mw.instance.handle(ctx, async () => {
                        response = await nextLayer(ctx);
                        return response;
                    });
                    // If middleware returned a Response, use it (enables response transformation)
                    if (result instanceof Response) {
                        return result;
                    }
                    return response ?? new Response(null, { status: 200 });
                };
            }
        }

        return chain;
    }

    /**
     * Apply CORS headers to a response.
     */
    private applyCors(response: Response, req: Request): Response {
        const origin = req.headers.get('origin');

        if (origin && this.corsHandler) {
            return this.corsHandler.apply(response, origin);
        }

        return response;
    }

    /**
     * Fallback handler - only called for unmatched routes.
     * All matched routes go through Bun's native router.
     */
    private handleNotFound(req: Request): Response {
        // CORS preflight for unmatched routes
        if (this.hasCors && req.method === 'OPTIONS') {
            const origin = req.headers.get('origin');

            if (origin) {
                return this.corsHandler!.preflight(origin);
            }
        }

        return NOT_FOUND_RESPONSE;
    }

    private buildResponse(result: any): Response {
        if (result instanceof Response) {
            return result;
        }

        if (typeof result === 'string') {
            return new Response(result, TEXT_OPTS);
        }

        // Handle undefined/void return values - return empty 204 No Content
        if (result === undefined) {
            return new Response(null, { status: 204 });
        }

        return Response.json(result);
    }

    private normalizePath(path: string): string {
        if (!path.startsWith('/')) path = '/' + path;
        if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1);

        return path.replace(/\/+/g, '/');
    }

    private hasParams(path: string): boolean {
        return path.includes(':') || path.includes('*');
    }

    stop(): void {
        this.server?.stop?.();
    }

    /**
     * Error handler for Bun.serve.
     * Converts exceptions to proper HTTP responses.
     */
    private handleError(error: Error): Response {
        let response: Response;

        // HttpException - return custom response
        if (error instanceof HttpException) {
            response = error.toResponse();
        }
        // ValidationException - return 400 with errors
        else if (error instanceof ValidationException) {
            response = error.toResponse();
        }
        // Unknown error - return 500
        else {
            console.error('Unhandled error:', error);
            response = INTERNAL_ERROR_RESPONSE;
        }

        // Apply CORS headers if configured
        if (this.hasCors && this.corsHandler) {
            return this.corsHandler.apply(response, '*');
        }

        return response;
    }

    /**
     * Execute lifecycle hooks for a specific event type.
     *
     * INIT and SHUTDOWN are barriers: returned promises are awaited in priority
     * order before bootstrap/shutdown continues. BOOT is fire-and-forget so
     * listen() can return once the server is accepting connections.
     * Failures in INIT abort startup; other phases log and continue.
     */
    private async executeLifecycleHooks(type: EventType): Promise<void> {
        const handlers = getEventHandlers(type);
        const shouldAwaitHooks = type !== EventType.BOOT;

        for (const handler of handlers) {
            try {
                const instance = this.container.has(handler.target)
                    ? this.container.get(handler.target)
                    : null;

                if (instance && typeof (instance as any)[handler.methodName] === 'function') {
                    const result = (instance as any)[handler.methodName]();

                    if (result instanceof Promise) {
                        if (shouldAwaitHooks) {
                            await result;
                        } else {
                            result.catch((err: Error) =>
                                console.error(`Error in ${type} hook ${handler.methodName}:`, err)
                            );
                        }
                    }
                }
            } catch (err) {
                if (type === EventType.INIT) {
                    throw err;
                }
                console.error(`Error in ${type} hook ${handler.methodName}:`, err);
            }
        }

        if (type === EventType.SHUTDOWN) {
            await this.container.destroy();
        }
    }

    /**
     * Register SIGTERM/SIGINT handlers for graceful shutdown.
     */
    private registerShutdownHandlers(): void {
        const shutdown = async () => {
            await this.executeLifecycleHooks(EventType.SHUTDOWN);
            this.stop();
            process.exit(0);
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    }

}
