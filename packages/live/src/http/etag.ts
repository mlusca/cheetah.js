import type { CarnoClosure, CarnoMiddleware, Context } from '@carno.js/core';
import { canonical } from '../shared/canonical';
import { fnv1a64 } from '../shared/hash';
import { LIVE_POLL_HEADER, LIVE_RESOURCE_HEADER } from '../shared/protocol';
import type { LiveInputs, LiveScope } from '../resource/types';

export interface LiveRoutePath {
    method: string;
    path: string;
    resourceId?: string;
}

export interface LivePollingRequest {
    resourceId: string;
    inputs: LiveInputs;
    request: Request;
}

export type LivePollingGuard =
    (request: LivePollingRequest) => LiveScope | null | Promise<LiveScope | null>;

/** `/cards/:id` matches `/cards/42` and nothing deeper. */
export function pathMatcher(pattern: string): RegExp {
    const source = pattern
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '[^/]+');

    return new RegExp(`^${source}$`);
}

/**
 * Content-hash `ETag` on live GET routes, and `304` when the client already
 * holds that content.
 *
 * This is the bottom rung of §8.4: a client with neither WebSocket nor SSE
 * polls the same route the SPA calls, and pays for a body only when something
 * changed. The hash is the canonical one -- the same function the engine uses
 * to decide whether a recompute produced a patch -- so reordered JSON keys are
 * the same content, not a change.
 *
 * Scoped to live routes on purpose. Putting an `ETag` on every GET in the
 * application would change the behaviour of routes that asked for none of this.
 */
export class LiveETagMiddleware implements CarnoMiddleware {
    private matchers: { matcher: RegExp; resourceId?: string }[] = [];
    private pollingGuard: LivePollingGuard | null = null;

    constructor(paths: LiveRoutePath[], private readonly options: { enabled?: boolean } = {}) {
        this.setPaths(paths);
    }

    /** The plugin knows the live routes only after bootstrap. */
    setPaths(paths: LiveRoutePath[]): void {
        this.matchers = paths
            .filter(entry => entry.method.toUpperCase() === 'GET')
            .map(entry => ({ matcher: pathMatcher(entry.path), resourceId: entry.resourceId }));
    }

    setPollingGuard(guard: LivePollingGuard): void {
        this.pollingGuard = guard;
    }

    async handle(ctx: Context, next: CarnoClosure): Promise<Response | void> {
        const polling = ctx.req.headers.get(LIVE_POLL_HEADER) === '1';
        const requestedResource = polling
            ? ctx.req.headers.get(LIVE_RESOURCE_HEADER) ?? undefined
            : undefined;
        const route = ctx.method.toUpperCase() === 'GET'
            ? this.routeFor(ctx.path, requestedResource)
            : undefined;

        if (polling && (!requestedResource || !route)) {
            return new Response('Forbidden', { status: 403 });
        }

        if (!route) {
            return next();
        }

        if (ctx.req.headers.get(LIVE_POLL_HEADER) === '1') {
            const resourceId = route.resourceId;
            const scope = resourceId && this.pollingGuard
                ? await this.pollingGuard({
                    resourceId,
                    inputs: { params: ctx.params, query: ctx.query },
                    request: ctx.req
                })
                : null;

            if (!scope) {
                return new Response('Forbidden', { status: 403 });
            }

            if (scope.headers) {
                const headers = new Headers(ctx.req.headers);
                new Headers(scope.headers).forEach((value, key) => headers.set(key, value));
                (ctx as { req: Request }).req = new Request(ctx.req, { headers });
            }
        }

        if (this.options.enabled === false) {
            return next();
        }

        const response = await next();

        if (response.status !== 200) {
            return response;
        }

        const contentType = response.headers.get('Content-Type') ?? '';

        if (!contentType.includes('application/json')) {
            return response;
        }

        // Reading the body consumes the stream, so everything below hands the
        // caller a rebuilt response rather than the one it just drained.
        const body = await response.clone().text();
        let tag: string;

        try {
            tag = `"${fnv1a64(canonical(JSON.parse(body)))}"`;
        } catch {
            // Content-Type said JSON and it is not. Not our problem to fix.
            return response;
        }

        if (ctx.req.headers.get('If-None-Match') === tag) {
            return new Response(null, { status: 304, headers: { ETag: tag } });
        }

        const headers = new Headers(response.headers);
        headers.set('ETag', tag);

        return new Response(body, { status: 200, headers });
    }

    private routeFor(path: string, resourceId?: string): { resourceId?: string } | undefined {
        return this.matchers.find(route =>
            route.matcher.test(path) && (resourceId === undefined || route.resourceId === resourceId)
        );
    }
}
