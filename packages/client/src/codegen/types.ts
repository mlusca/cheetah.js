export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options';

export interface RouteSlot {
    name?: string;
    type: string;
    optional?: boolean;
}

export interface RouteLive {
    shared: 'private' | 'tenant' | 'public';
    /** Field that identifies a row of a returned collection. */
    key?: string;
}

export interface RouteSchema {
    method: HttpMethod;
    path: string;
    relativePath: string;
    pathSource?: string;
    handlerName: string;
    controllerName: string;
    filePath: string;
    params: RouteSlot[];
    query: RouteSlot[];
    headers: RouteSlot[];
    body: RouteSlot[];
    response: string;
    /** Present when the handler carries @Live(). */
    live?: RouteLive;
}

export interface ScanWarning {
    message: string;
    file?: string;
    line?: number;
}

export interface ScanResult {
    routes: RouteSchema[];
    warnings: ScanWarning[];
    aliases: TypeAlias[];
}

export interface TypeAlias {
    name: string;
    type: string;
}

export interface GenerateResult {
    output: string;
    changed: boolean;
    skipped: boolean;
    routes: RouteSchema[];
    warnings: ScanWarning[];
    content: string;
}
