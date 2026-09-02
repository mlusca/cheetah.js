import type { ParamMetadata } from '@carno.js/core';
import type { LiveMeta } from '../metadata';

export type { LiveInputs, LiveScope } from '../shared/inputs';
import type { LiveInputs, LiveScope } from '../shared/inputs';

export interface LiveExecutionContext {
    /** Scope resolved for a subscription, including optional middleware headers. */
    scope?: LiveScope;
    /** Explicit headers, useful when prefetching from an authenticated SSR request. */
    headers?: HeadersInit;
}

export interface LiveResourceExecutor {
    (
        controllerInstance: any,
        resource: LiveResource,
        inputs: LiveInputs,
        context: LiveExecutionContext
    ): Promise<unknown>;
}

export interface LiveResource {
    /** `${controllerName}.${handlerName}` */
    id: string;
    controllerClass: new (...args: any[]) => any;
    controllerName: string;
    handlerName: string;
    meta: LiveMeta;
    params: ParamMetadata[];
    invoke(inputs: LiveInputs, context?: LiveExecutionContext): Promise<unknown>;
    /** Full HTTP path, controller prefix included. Used by the ETag layer. */
    httpPath: string;
    httpMethod: string;
}
