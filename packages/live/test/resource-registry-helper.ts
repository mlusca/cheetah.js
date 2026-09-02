import type { ParamMetadata } from '@carno.js/core';
import type { LiveResourceExecutor } from '../src/resource/types';

/** Test-only direct executor for ResourceRegistry unit tests. */
export const directResourceExecutor: LiveResourceExecutor = async (
    instance,
    resource,
    inputs
) => instance[resource.handlerName](...buildArgs(resource.params, inputs));

function buildArgs(params: ParamMetadata[], inputs: {
    params: Record<string, string>;
    query: Record<string, string | string[]>;
    body?: unknown;
}): unknown[] {
    if (params.length === 0) {
        return [];
    }

    const args = new Array<unknown>(Math.max(...params.map(param => param.index)) + 1).fill(undefined);

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
