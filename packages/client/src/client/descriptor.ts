import { executeRequest, stripTrailingSlashes, type RequestOptions } from './http';
import type { ClientConfig, ClientResult, HttpMethod, RouteOptions, RouteResponse } from './types';

/**
 * The runtime shape the codegen emits for every route.
 *
 * Declared here as well, structurally identical: the generated file is
 * standalone by design — it imports nothing — so the two definitions meet
 * through TypeScript's structural typing rather than through an import.
 */
export interface RouteDescriptor<R = unknown> {
    readonly method: HttpMethod;
    readonly path: string;
    /** Only on @Live() routes: the id the subscription protocol addresses. */
    readonly resourceId?: string;
    readonly live?: { readonly shared: 'private' | 'tenant' | 'public'; readonly key?: string };
    /** Phantom: carries the route's types. Never present at runtime. */
    readonly __route?: R;
}

export type RouteInput<R> =
    (R extends { params: infer P } ? { params: P } : { params?: never })
    & (R extends { query: infer Q } ? { query: Q } : { query?: never })
    & (R extends { body: infer B } ? { body: B } : { body?: never });

export type ApiCall<R> = (
    input?: RouteInput<R>,
    options?: RouteOptions<R>
) => Promise<ClientResult<RouteResponse<R>>>;

export type ApiOf<T> = {
    [K in keyof T]: T[K] extends RouteDescriptor<infer R> ? ApiCall<R> & T[K] : ApiOf<T[K]>;
};

/** Substitute `:name` segments, refusing to build a URL with a hole in it. */
export function fillPath(template: string, params?: Record<string, unknown>): string {
    return template.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name: string) => {
        const value = params?.[name];

        if (value === undefined || value === null) {
            throw new Error(`Missing path parameter "${name}" for ${template}.`);
        }

        return encodeURIComponent(String(value));
    });
}

/**
 * Turn the generated `routes` tree into callables.
 *
 * Additive on purpose: `client<App>(baseUrl)` keeps working exactly as before.
 * This is the surface the live client reads `resourceId` and `live` from.
 */
export function createApi<T>(routes: T, config: ClientConfig & { baseUrl: string }): ApiOf<T> {
    const origin = stripTrailingSlashes(config.baseUrl);
    return buildNode(routes, origin, config) as ApiOf<T>;
}

function buildNode(node: unknown, origin: string, config: ClientConfig): unknown {
    if (isDescriptor(node)) {
        return buildCallable(node, origin, config);
    }

    if (!node || typeof node !== 'object') {
        return node;
    }

    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        out[key] = buildNode(value, origin, config);
    }

    return out;
}

function isDescriptor(value: unknown): value is RouteDescriptor {
    return Boolean(value)
        && typeof value === 'object'
        && typeof (value as RouteDescriptor).method === 'string'
        && typeof (value as RouteDescriptor).path === 'string';
}

interface CallInput {
    params?: Record<string, unknown>;
    query?: Record<string, unknown>;
    body?: unknown;
}

function buildCallable(descriptor: RouteDescriptor, origin: string, config: ClientConfig): unknown {
    const call = (input?: CallInput, options?: RouteOptions<unknown>) => {
        const extra = options as { headers?: Record<string, string | undefined>; fetch?: RequestInit } | undefined;
        const request: RequestOptions = {
            query: input?.query,
            headers: extra?.headers,
            fetch: extra?.fetch
        };

        return executeRequest(
            origin,
            fillPath(descriptor.path, input?.params),
            descriptor.method,
            input?.body,
            request,
            config
        );
    };

    // The descriptor's own fields ride along, so `api.cards.list` is both the
    // call and the thing `useLive` reads.
    return Object.assign(call, descriptor);
}
