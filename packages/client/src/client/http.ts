import type { HttpMethod, ClientConfig, ClientCreate, ClientErrorValue, ClientResult } from './types';

export interface RequestOptions {
    query?: Record<string, unknown>;
    headers?: Record<string, string | undefined>;
    fetch?: RequestInit;
}

const HTTP_METHODS = new Set<string>(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);
const BODY_METHODS = new Set<string>(['post', 'put', 'patch', 'delete']);
const IGNORED_KEYS = new Set<PropertyKey>([
    'then',
    'toJSON',
    '$$typeof',
    'inspect',
    'toString',
    'valueOf',
    'constructor',
    Symbol.toStringTag,
    Symbol.iterator,
    Symbol.toPrimitive,
    Symbol.asyncIterator
]);

const ABSOLUTE_URL = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;
const RELATIVE_URL_BASE = 'http://carno.invalid';

export function client<const App>(baseUrl: string, config: ClientConfig = {}): ClientCreate<App> {
    const origin = stripTrailingSlashes(baseUrl);
    return createProxy(origin, '', config) as ClientCreate<App>;
}

function createProxy(origin: string, currentPath: string, config: ClientConfig): unknown {
    const apply = (params: Record<string, string | number> = {}) => {
        let next = currentPath;
        for (const value of Object.values(params)) {
            next += `/${encodeURIComponent(String(value))}`;
        }
        return createProxy(origin, next, config);
    };

    return new Proxy(apply, {
        get(_target, key) {
            if (IGNORED_KEYS.has(key)) {
                return undefined;
            }

            if (typeof key === 'symbol') {
                return undefined;
            }

            if (HTTP_METHODS.has(key)) {
                return (first?: unknown, second?: unknown) => {
                    const method = key as HttpMethod;
                    const hasBody = BODY_METHODS.has(method);

                    return executeRequest(
                        origin,
                        currentPath || '/',
                        method,
                        hasBody ? first : undefined,
                        (hasBody ? second : first) as RequestOptions | undefined,
                        config
                    );
                };
            }

            const segment = key.startsWith(':') ? key.slice(1) : key;
            return createProxy(origin, `${currentPath}/${segment}`, config);
        }
    });
}

/** The one request path, shared by the path proxy and by createApi(). */
export async function executeRequest(
    origin: string,
    pathname: string,
    method: HttpMethod,
    body: unknown,
    options: RequestOptions | undefined,
    config: ClientConfig
): Promise<ClientResult<unknown>> {
    const request = createRequestUrl(origin, pathname);

    if (options?.query) {
        for (const [key, value] of Object.entries(options.query)) {
            if (value === undefined || value === null) {
                continue;
            }
            if (Array.isArray(value)) {
                for (const item of value) {
                    request.url.searchParams.append(key, String(item));
                }
            } else {
                request.url.searchParams.set(key, String(value));
            }
        }
    }

    const headers = new Headers(options?.fetch?.headers);
    const extra = await resolveHeaders(config.headers);
    for (const [key, value] of Object.entries(extra)) {
        if (value !== undefined) {
            headers.set(key, value);
        }
    }
    if (options?.headers) {
        for (const [key, value] of Object.entries(options.headers)) {
            if (value !== undefined) {
                headers.set(key, value);
            }
        }
    }

    let payload: BodyInit | undefined;
    if (body !== undefined && body !== null) {
        if (isBodyInit(body)) {
            payload = body;
        } else {
            payload = JSON.stringify(body);
            if (!headers.has('Content-Type')) {
                headers.set('Content-Type', 'application/json');
            }
        }
    }

    const fetcher = config.fetcher ?? fetch;
    const response = await fetcher(request.href(), {
        ...options?.fetch,
        method: method.toUpperCase(),
        headers,
        body: payload
    });

    const parsed = await parseBody(response);

    if (!response.ok) {
        const value = normalizeError(parsed, response);
        if (config.onError === 'throw') {
            const error = new Error(value.message) as Error & { status: number; value: ClientErrorValue };
            error.status = response.status;
            error.value = value;
            throw error;
        }

        return {
            data: null,
            error: { status: response.status, value },
            status: response.status,
            headers: response.headers,
            response
        };
    }

    return {
        data: parsed,
        error: null,
        status: response.status,
        headers: response.headers,
        response
    };
}

async function resolveHeaders(
    headers: ClientConfig['headers']
): Promise<Record<string, string | undefined>> {
    if (!headers) {
        return {};
    }
    if (typeof headers === 'function') {
        return (await headers()) ?? {};
    }
    return headers;
}

async function parseBody(response: Response): Promise<unknown> {
    if (response.status === 204) {
        return null;
    }

    const text = await response.text();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function normalizeError(parsed: unknown, response: Response): ClientErrorValue {
    if (parsed && typeof parsed === 'object') {
        const value = parsed as Record<string, unknown>;
        return {
            statusCode: typeof value.statusCode === 'number' ? value.statusCode : response.status,
            message: typeof value.message === 'string' ? value.message : response.statusText,
            errors: Array.isArray(value.errors) ? value.errors : undefined
        };
    }

    return {
        statusCode: response.status,
        message: typeof parsed === 'string' && parsed ? parsed : response.statusText
    };
}

export function stripTrailingSlashes(value: string): string {
    let end = value.length;
    while (end > 0 && value.charCodeAt(end - 1) === 47) {
        end -= 1;
    }
    return end === value.length ? value : value.slice(0, end);
}

function createRequestUrl(origin: string, pathname: string): { url: URL; href: () => string } {
    const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
    const joined = origin ? `${origin}${path}` : path;

    if (ABSOLUTE_URL.test(joined)) {
        const url = new URL(joined);
        return { url, href: () => url.href };
    }

    const url = new URL(joined, RELATIVE_URL_BASE);
    return {
        url,
        href: () => `${url.pathname}${url.search}${url.hash}`
    };
}

function isBodyInit(value: unknown): value is BodyInit {
    if (typeof value === 'string' || value instanceof Blob || value instanceof FormData || value instanceof URLSearchParams) {
        return true;
    }
    if (typeof ArrayBuffer !== 'undefined' && (value instanceof ArrayBuffer || ArrayBuffer.isView(value))) {
        return true;
    }
    if (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream) {
        return true;
    }
    return false;
}
