import {
    HttpException,
    ValidationException,
    type Carno
} from '@carno.js/core';
import type {
    LiveExecutionContext,
    LiveInputs,
    LiveResource,
    LiveResourceExecutor
} from './types';

export class LiveRouteExecutionError extends Error {
    constructor(
        public readonly statusCode: number,
        message: string
    ) {
        super(message);
        this.name = 'LiveRouteExecutionError';
    }
}

export function isLiveAuthorizationFailure(error: unknown): boolean {
    return error instanceof LiveRouteExecutionError &&
        (error.statusCode === 401 || error.statusCode === 403);
}

/**
 * Adapt the core's compiled HTTP route to a Live resource compute.  The
 * adapter is created once at startup; only the synthetic request and response
 * decoding happen per compute.
 */
export function createLiveRouteExecutor(carno: Carno): LiveResourceExecutor {
    return async (
        _controllerInstance: any,
        resource: LiveResource,
        inputs: LiveInputs,
        context: LiveExecutionContext
    ): Promise<unknown> => {
        const request = createRequest(resource, inputs, context);
        let response: Response;

        try {
            response = await carno.executeCompiledRoute(
                resource.controllerClass,
                resource.handlerName,
                request,
                inputs.params
            );
        } catch (error) {
            if (error instanceof HttpException || error instanceof ValidationException) {
                response = error.toResponse();
            } else {
                throw error;
            }
        }

        if (response.status < 200 || response.status >= 300) {
            const detail = await response.text().catch(() => '');
            throw new LiveRouteExecutionError(
                response.status,
                detail || `Live route returned HTTP ${response.status}.`
            );
        }

        return decodeResponse(response);
    };
}

function createRequest(
    resource: LiveResource,
    inputs: LiveInputs,
    context: LiveExecutionContext
): Request {
    const path = interpolatePath(resource.httpPath, inputs.params, resource.id);
    const url = new URL(`http://carno.live${path}`);

    for (const [key, value] of Object.entries(inputs.query)) {
        for (const item of Array.isArray(value) ? value : [value]) {
            url.searchParams.append(key, item);
        }
    }

    const headers = new Headers(context.scope?.headers);

    if (context.headers) {
        new Headers(context.headers).forEach((value, key) => headers.set(key, value));
    }

    const hasBody = resource.httpMethod === 'POST' && inputs.body !== undefined;

    if (hasBody && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
    }

    return new Request(url, {
        method: resource.httpMethod,
        headers,
        body: hasBody ? JSON.stringify(inputs.body) : undefined
    });
}

function interpolatePath(
    path: string,
    params: Record<string, string>,
    resourceId: string
): string {
    return path.replace(/:([A-Za-z0-9_]+)/g, (_segment, key: string) => {
        const value = params[key];

        if (value === undefined) {
            throw new LiveRouteExecutionError(
                400,
                `Live resource "${resourceId}" is missing route parameter "${key}".`
            );
        }

        return encodeURIComponent(value);
    });
}

async function decodeResponse(response: Response): Promise<unknown> {
    if (response.status === 204) {
        return undefined;
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

    if (contentType.includes('json')) {
        return response.json();
    }

    return response.text();
}
