import nodeFs from 'node:fs';
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
 * Pug treats a leading `/` as basedir-relative (`include /layout` → `${root}/layout`).
 * Filesystem-absolute names (`C:\\...`, UNC) are not that convention and are rejected.
 */
function isPugBasedirPath(filename: string): boolean {
    return filename.startsWith('/');
}

/**
 * Resolve an `include` / `extends` path the way Pug does, then canonicalize it
 * under `root`. Relative `../` that stays inside the views tree is allowed.
 */
function resolvePugPath(filename: string, source: string | undefined, root: string): string {
    if (!filename || filename.includes('\0') || (source != null && source.includes('\0'))) {
        throw new ViewForbiddenError();
    }

    const trimmed = filename.trim();

    if (isPugBasedirPath(trimmed)) {
        const relative = trimmed.replace(/^[/\\]+/, '');

        if (!relative || isAbsoluteViewName(relative)) {
            throw new ViewForbiddenError();
        }

        return path.resolve(root, relative);
    }

    if (isAbsoluteViewName(trimmed)) {
        throw new ViewForbiddenError();
    }

    if (!source) {
        throw new Error(
            'the "filename" option is required to use includes and extends with "relative" paths'
        );
    }

    return path.resolve(path.dirname(source.trim()), trimmed);
}

/**
 * Pug `basedir` only changes the base of `/`-prefixed includes. Relative `../`,
 * filesystem-absolute paths, and symlinks still go through the default loader.
 * These plugins validate the resolved path and its realpath before any read.
 */
function createPugPathPlugin(root: string) {
    return {
        resolve(filename: string, source: string) {
            const resolved = resolvePugPath(filename, source, root);
            return assertPathInsideRootSync(resolved, root);
        },
        read(filename: string) {
            const safePath = assertPathInsideRootSync(filename, root);
            return nodeFs.readFileSync(safePath);
        },
    };
}

function pugCompileOptions(filename: string, options?: ViewEngineOptions) {
    const root = options?.root ? path.resolve(options.root) : path.dirname(path.resolve(filename || '.'));

    return {
        filename,
        basedir: root,
        cache: options?.cache ?? false,
        plugins: [createPugPathPlugin(root)],
    };
}

/**
 * Pug adapter. `filename` is the current template; `basedir` is the views root
 * so native `extends` / `include` resolve correctly.
 * Nested files are confined to `options.root` (resolved path and realpath).
 * When `layout` is set on the service, the wrapper template uses `!= body`.
 */
export function createPugEngine(): ViewEngine {
    let pug: any;

    async function runtime(): Promise<any> {
        if (!pug) {
            let mod: any;

            try {
                mod = await import('pug');
            } catch (error) {
                rethrowIfPresent(error, 'pug', 'pug');
            }

            pug = interopDefault(mod);
        }

        return pug;
    }

    return {
        name: 'pug',
        extensions: ['.pug', '.jade'],
        async compile(source, filename, options) {
            const lib = await runtime();

            try {
                return lib.compile(source, pugCompileOptions(filename, options));
            } catch (error) {
                rethrowViewError(error);
            }
        },
        async render(template, data, options) {
            const lib = await runtime();
            const locals = { ...(options?.helpers ?? {}), ...(data ?? {}) };

            try {
                if (typeof template === 'function') {
                    return template(locals);
                }

                return lib.render(String(template), {
                    ...locals,
                    ...pugCompileOptions(options?.filename ?? '', options),
                });
            } catch (error) {
                rethrowViewError(error);
            }
        },
    };
}
