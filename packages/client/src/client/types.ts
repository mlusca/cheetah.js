export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options';

export interface ClientErrorValue {
    statusCode: number;
    message: string;
    errors?: unknown[];
}

export type ClientResult<T> =
    | {
        data: T;
        error: null;
        status: number;
        headers: Headers;
        response: Response;
    }
    | {
        data: null;
        error: {
            status: number;
            value: ClientErrorValue;
        };
        status: number;
        headers: Headers;
        response: Response;
    };

export type ClientHeaders =
    | Record<string, string | undefined>
    | (() => Record<string, string | undefined> | Promise<Record<string, string | undefined>>);

export interface ClientConfig {
    fetcher?: typeof fetch;
    headers?: ClientHeaders;
    onError?: 'return' | 'throw';
}

type Methods = HttpMethod;

type HasBody<R> = R extends { body: infer B }
    ? [B] extends [never | undefined | void] ? false : true
    : false;

type RouteQuery<R> = R extends { query: infer Q } ? Q : undefined;
type RouteHeaders<R> = R extends { headers: infer H } ? H : Record<string, string | undefined>;
export type RouteResponse<R> = R extends { response: infer S } ? NormalizeClientData<S> : unknown;

type NormalizeClientData<T> =
    [T] extends [void | undefined]
        ? null
        : undefined extends T
            ? Exclude<T, undefined | void> | null
            : T;

export interface RouteOptions<R> {
    query?: RouteQuery<R>;
    headers?: RouteHeaders<R>;
    fetch?: RequestInit;
}

type RouteFn<R> = HasBody<R> extends true
    ? (body?: R extends { body: infer B } ? B : never, options?: RouteOptions<R>) => Promise<ClientResult<RouteResponse<R>>>
    : (options?: RouteOptions<R>) => Promise<ClientResult<RouteResponse<R>>>;

type ParamName<K> = K extends `:${infer P}` ? P : never;

type ParamSegments<T> = {
    [K in keyof T as ParamName<K>]: string | number;
};

type ParamChildNodes<T> = {
    [K in keyof T as K extends `:${string}` ? K : never]: T[K];
};

type UnionToIntersection<U> =
    (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

type MergedParamChildren<T> = UnionToIntersection<ParamChildNodes<T>[keyof ParamChildNodes<T>]>;

type NonMethodKeys<T> = Exclude<keyof T, Methods>;

export type ClientCreate<T> = {
    [K in NonMethodKeys<T>]: T[K] extends object ? ClientCreate<T[K]> : T[K];
} & {
    [K in keyof T & Methods]: RouteFn<T[K]>;
} & (keyof ParamSegments<T> extends never
    ? unknown
    : (params: ParamSegments<T>) => ClientCreate<MergedParamChildren<T>>);

export namespace HttpClient {
    export type Create<App> = ClientCreate<App>;
    export type Config = ClientConfig;
    export type Result<T> = ClientResult<T>;
    export type ErrorValue = ClientErrorValue;
}

export type { RouteFn };
