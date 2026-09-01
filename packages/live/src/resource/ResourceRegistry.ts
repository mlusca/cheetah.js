import 'reflect-metadata';
import { PARAMS_META, ROUTES_META, type ParamMetadata } from '@carno.js/core';
import type { Dependency } from '../graph/types';
import { LIVE_META, type LiveMeta } from '../metadata';
import { dependencyContext } from './dependency-context';
import type { LiveInputs, LiveResource } from './types';

/** Verbs that may carry @Live in phase 1. @Post() arrives with phase 2. */
const ALLOWED_METHODS = new Set(['get']);

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
                    `Subscribing means re-running the handler whenever the data changes, so it must be ` +
                    `idempotent. Phase 1 allows @Get() only; @Post() for read-only queries arrives in phase 2.`
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

            if (params.some(param => param.type === 'body')) {
                throw new LiveValidationError(
                    `${where} uses @Body(), which requires @Live() on @Post(). That arrives in phase 2.`
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
                invoke: (args: unknown[]) => Promise.resolve(instance[route.handlerName](...args))
            });
        }
    }

    get(id: string): LiveResource | undefined {
        return this.resources.get(id);
    }

    ids(): string[] {
        return [...this.resources.keys()];
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
        }
    }

    return args;
}
