import type { ParamMetadata } from '@carno.js/core';
import type { LiveMeta } from '../metadata';

export type { LiveInputs, LiveScope } from '../shared/inputs';

export interface LiveResource {
    /** `${controllerName}.${handlerName}` */
    id: string;
    controllerName: string;
    handlerName: string;
    meta: LiveMeta;
    params: ParamMetadata[];
    invoke(args: unknown[]): Promise<unknown>;
    /** Full HTTP path, controller prefix included. Used by the ETag layer. */
    httpPath: string;
    httpMethod: string;
}
