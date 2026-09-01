import 'reflect-metadata';
import { CONTROLLER_META, PARAMS_META, ROUTES_META, type ParamMetadata } from '@carno.js/core';
import type { Dependency } from '../graph/types';
import { LIVE_META, type LiveMeta } from '../metadata';
import { dependencyContext } from './dependency-context';
import type { LiveInputs, LiveResource } from './types';

/**
 * Verbs that may carry @Live. The real criterion is idempotence, not the verb:
 * subscribing means re-running the handler whenever the data changes, and
 * re-running a write duplicates the side effect. GET and POST are the two the
 * web uses for reading; a PUT that only reads is an abuse of the protocol and
 * is not worth the API surface.
 */
const ALLOWED_METHODS = new Set(['get', 'post']);

/**
 * Parameters that would break "state is recomputable from inputs": there is no
 * Request, no header set and no middleware-populated locals during a recompute.
 */
const FORBIDDEN_PARAMS: Record<string, string> = {
    req: '@Req()',
    ctx: '@Ctx()',
    header: '@Header()',
    locals: '@Locals()'
};

export class LiveValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LiveValidationError';
    }
}

interface RouteInfoLike {
    method: string;
    path: string;
    handlerName: string;
}

export class ResourceRegistry {
    private readonly resources = new Map<string, LiveResource>();

    /**
     * Scan a controller for @Live handlers and validate them.
     *
     * Validation runs at registration, which is bootstrap time: the core
     * compiles everything at startup, so a misdeclared resource fails the boot
     * instead of failing the first subscription in production.
     */
    register(ControllerClass: new (...args: any[]) => any, instance: any): void {
        const routes: RouteInfoLike[] = Reflect.getMetadata(ROUTES_META, ControllerClass) || [];
        const controllerMeta: { path?: string } = Reflect.getMetadata(CONTROLLER_META, ControllerClass) || {};
        const prefix = controllerMeta.path ?? '';

        for (const route of routes) {
            const meta: LiveMeta | undefined = Reflect.getMetadata(
                LIVE_META,
                ControllerClass,
                route.handlerName
            );

            if (!meta) {
                continue;
            }

            const id = `${ControllerClass.name}.${route.handlerName}`;
            const where = `${ControllerClass.name}.${route.handlerName}()`;

            if (!ALLOWED_METHODS.has(route.method)) {
                throw new LiveValidationError(
                    `${where} is decorated with @Live() on @${route.method.toUpperCase()}(). ` +
                    `Subscribing means re-running the handler whenever the data changes, so it has ` +
                    `to be idempotent. Only @Get() and @Post() may be live.`
                );
            }

            const params: ParamMetadata[] =
                Reflect.getMetadata(PARAMS_META, ControllerClass, route.handlerName) || [];

            for (const type of ['req', 'ctx', 'header', 'locals']) {
                const param = params.find(candidate => candidate.type === type);
                const forbidden = param ? FORBIDDEN_PARAMS[param.type] : undefined;

                if (forbidden) {
                    throw new LiveValidationError(
                        `${where} uses ${forbidden}, which is not available during a recompute. ` +
                        `A live resource must be a pure function of its declared inputs.`
                    );
                }

            }

            if (route.method === 'get' && params.some(param => param.type === 'body')) {
                throw new LiveValidationError(
                    `${where} uses @Body() on @Get(). A GET subscription carries no body; ` +
                    `declare the route as @Post() or read the value from @Query().`
                );
            }

            if (meta.key !== undefined && (typeof meta.key !== 'string' || meta.key === '')) {
                throw new LiveValidationError(`${where} declares an empty @Live({ key }).`);
            }

            if (this.resources.has(id)) {
                throw new LiveValidationError(`Live resource "${id}" is already registered.`);
            }

            this.resources.set(id, {
                id,
                controllerName: ControllerClass.name,
                handlerName: route.handlerName,
                meta,
                params,
                invoke: (args: unknown[]) => Promise.resolve(instance[route.handlerName](...args)),
                httpPath: joinRoutePath(prefix, route.path),
                httpMethod: route.method.toUpperCase()
            });
        }
    }

    get(id: string): LiveResource | undefined {
        return this.resources.get(id);
    }

    ids(): string[] {
        return [...this.resources.keys()];
    }

    /** Every live route, as the HTTP layer addresses it. */
    livePaths(): { method: string; path: string }[] {
        return [...this.resources.values()].map(resource => ({
            method: resource.httpMethod,
            path: resource.httpPath
        }));
    }

    /** Run the handler and report what it read. */
    async compute(
        resource: LiveResource,
        inputs: LiveInputs
    ): Promise<{ data: unknown; deps: Dependency[] }> {
        const args = buildArgs(resource.params, inputs);

        const { result, deps } = await dependencyContext.run(collector => {
            for (const key of resource.meta.dependsOn) {
                collector.add({ key, columns: null });
            }

            return resource.invoke(args);
        });

        return { data: result, deps };
    }
}

function buildArgs(params: ParamMetadata[], inputs: LiveInputs): unknown[] {
    if (params.length === 0) {
        return [];
    }

    const size = Math.max(...params.map(param => param.index)) + 1;
    const args = new Array<unknown>(size).fill(undefined);

    for (const param of params) {
        if (param.type === 'param') {
            args[param.index] = param.key ? inputs.params[param.key] : inputs.params;
        } else if (param.type === 'query') {
            args[param.index] = param.key ? inputs.query[param.key] : inputs.query;
        } else if (param.type === 'body') {
            args[param.index] = param.key
                ? (inputs.body as Record<string, unknown> | undefined)?.[param.key]
                : inputs.body;
        }
    }

    return args;
}

/** Same join the core router does: collapse the slashes, keep the root. */
export function joinRoutePath(prefix: string, path: string): string {
    const joined = `${prefix}${path}`.replace(/\/{2,}/g, '/');

    return joined.length > 1 ? joined.replace(/\/$/, '') : (joined || '/');
}
