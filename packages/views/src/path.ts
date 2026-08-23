import nodeFs from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ViewForbiddenError } from './errors';

export const DEFAULT_VIEWS_DIR = './views';

export function resolveViewsRoot(views = DEFAULT_VIEWS_DIR): string {
    return path.resolve(process.cwd(), views);
}

export function toPosix(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}

export function normalizeExtensions(extensions: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const extension of extensions) {
        if (!extension) continue;
        const value = extension.startsWith('.') ? extension : `.${extension}`;
        if (seen.has(value)) continue;
        seen.add(value);
        normalized.push(value);
    }

    return normalized;
}

export function isInsideRoot(target: string, root: string): boolean {
    const resolvedRoot = path.resolve(root);
    const resolvedTarget = path.resolve(target);
    const relative = path.relative(resolvedRoot, resolvedTarget);

    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function isAbsoluteViewName(name: string): boolean {
    const normalized = toPosix(name);

    if (path.isAbsolute(name) || path.isAbsolute(normalized)) {
        return true;
    }

    if (normalized.startsWith('/') || normalized.startsWith('//')) {
        return true;
    }

    return /^[a-zA-Z]:/.test(normalized);
}

/**
 * Reject names that can escape the views root before joining.
 * `..` is always forbidden, even when the resolved path would stay inside.
 */
export function assertSafeViewName(name: string): void {
    if (!name || typeof name !== 'string' || name.includes('\0')) {
        throw new ViewForbiddenError();
    }

    if (isAbsoluteViewName(name)) {
        throw new ViewForbiddenError();
    }

    const segments = toPosix(name).split('/').filter(segment => segment.length > 0 && segment !== '.');

    if (segments.length === 0 || segments.some(segment => segment === '..')) {
        throw new ViewForbiddenError();
    }
}

export async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

export async function realpathOrResolve(filePath: string): Promise<string> {
    try {
        return await fs.realpath(filePath);
    } catch {
        return path.resolve(filePath);
    }
}

export async function assertRealpathInside(filePath: string, root: string): Promise<void> {
    const realFile = await realpathOrResolve(filePath);
    const realRoot = await realpathOrResolve(root);

    if (!isInsideRoot(realFile, realRoot)) {
        throw new ViewForbiddenError();
    }
}

/**
 * Sync counterpart used by engines that resolve nested files at render time (EJS include).
 * Returns the canonical path when the file exists so subsequent reads cannot follow a symlink.
 */
export function assertPathInsideRootSync(filePath: string, root: string): string {
    if (!filePath || filePath.includes('\0') || !root) {
        throw new ViewForbiddenError();
    }

    const resolved = path.resolve(filePath);
    const resolvedRoot = path.resolve(root);

    if (!isInsideRoot(resolved, resolvedRoot)) {
        throw new ViewForbiddenError();
    }

    let realRoot = resolvedRoot;

    try {
        realRoot = nodeFs.realpathSync(resolvedRoot);
    } catch {
        // The views root may not exist yet; the resolved path is still bounded above.
    }

    try {
        const realFile = nodeFs.realpathSync(resolved);

        if (!isInsideRoot(realFile, realRoot)) {
            throw new ViewForbiddenError();
        }

        return realFile;
    } catch (error) {
        if (error instanceof ViewForbiddenError) {
            throw error;
        }

        return resolved;
    }
}

export async function readTextFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf8');
}

export async function listFilesRecursive(dir: string): Promise<string[]> {
    const files: string[] = [];

    async function walk(current: string): Promise<void> {
        let entries;

        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;

            const fullPath = path.join(current, entry.name);

            if (entry.isDirectory()) {
                await walk(fullPath);
            } else if (entry.isFile() || entry.isSymbolicLink()) {
                files.push(fullPath);
            }
        }
    }

    await walk(dir);
    return files;
}
