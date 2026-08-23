import path from 'node:path';
import { ViewForbiddenError } from '../errors';
import { assertPathInsideRootSync, isAbsoluteViewName } from '../path';
import type { ViewEngine, ViewEngineOptions } from '../types';
import { interopDefault, rethrowIfPresent } from './load-module';

function rethrowViewError(error: unknown): never {
    if (error instanceof ViewForbiddenError) {
        throw new ViewForbiddenError();
    }

    throw error;
}

/**
 * EJS resolves relative includes from the parent filename (so `../` can leave the
 * views root) and absolute includes from `/` unless `root` is set. The includer
 * validates the resolved path and its realpath before EJS reads the file.
 */
function createEjsIncluder(root: string) {
    return (originalPath: string, parsedPath?: string) => {
        if (
            !originalPath
            || originalPath.includes('\0')
            || (parsedPath != null && parsedPath.includes('\0'))
            || isAbsoluteViewName(originalPath)
        ) {
            throw new ViewForbiddenError();
        }

        if (!parsedPath) {
            throw new Error(`Could not find the include file "${originalPath}"`);
        }

        return { filename: assertPathInsideRootSync(parsedPath, root) };
    };
}

function ejsCompileOptions(filename: string, options?: ViewEngineOptions) {
    const root = options?.root ? path.resolve(options.root) : path.dirname(path.resolve(filename || '.'));

    return {
        filename,
        root,
        views: [root],
        cache: options?.cache ?? false,
        async: false,
        includer: createEjsIncluder(root),
    };
}

/**
 * EJS adapter. `filename`, `root` and `views` enable `<%- include(...) %>`.
 * Optional layouts wrap the page with `<%- body %>` (trusted HTML from this engine).
 * Nested includes are confined to `options.root` (resolved path and realpath).
 */
export function createEjsEngine(): ViewEngine {
    let ejs: any;

    async function runtime(): Promise<any> {
        if (!ejs) {
            let mod: any;

            try {
                mod = await import('ejs');
            } catch (error) {
                rethrowIfPresent(error, 'ejs', 'ejs');
            }

            ejs = interopDefault(mod);
        }

        return ejs;
    }

    return {
        name: 'ejs',
        extensions: ['.ejs'],
        async compile(source, filename, options) {
            const lib = await runtime();
            return lib.compile(source, ejsCompileOptions(filename, options));
        },
        async render(template, data, options) {
            const lib = await runtime();
            const locals = { ...(options?.helpers ?? {}), ...(data ?? {}) };

            try {
                if (typeof template === 'function') {
                    return template(locals);
                }

                return lib.render(
                    String(template),
                    locals,
                    ejsCompileOptions(options?.filename ?? '', options)
                );
            } catch (error) {
                rethrowViewError(error);
            }
        },
    };
}
