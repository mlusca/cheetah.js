import * as fs from 'fs';
import * as path from 'path';

/**
 * Recursively list all files in a directory.
 * Performance: Uses async I/O to avoid blocking.
 */
export async function listFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    async function scan(directory: string): Promise<void> {
        let entries: fs.Dirent[];

        try {
            entries = await fs.promises.readdir(directory, { withFileTypes: true });
        } catch {
            return; // Directory doesn't exist or not readable
        }

        for (const entry of entries) {
            const fullPath = path.join(directory, entry.name);

            if (entry.isDirectory()) {
                await scan(fullPath);
            } else if (entry.isFile()) {
                files.push(fullPath);
            }
        }
    }

    await scan(dir);
    return files;
}

/**
 * Normalize path separators to forward slashes.
 */
export function normalizePath(p: string): string {
    let normalized = p.replace(/\\/g, '/');
    if (!normalized.startsWith('/')) normalized = '/' + normalized;
    if (normalized !== '/' && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}

/**
 * Check if a path is safe (no path traversal).
 */
export function isSafePath(filePath: string, root: string): boolean {
    const resolved = path.resolve(filePath);
    const rootResolved = path.resolve(root);
    return resolved.startsWith(rootResolved + path.sep) || resolved === rootResolved;
}

/**
 * Whether a missing path should fall back to index.html in SPA mode.
 *
 * Browser routes such as `/dashboard` and `/users/profile` have no file
 * extension. Asset requests (`/missing-file.js`) and the `/api` namespace
 * must not receive the SPA shell.
 */
export function isSpaNavigablePath(requestPath: string): boolean {
    const clean = requestPath.split('?')[0] || '/';
    const normalized = clean.startsWith('/') ? clean : `/${clean}`;

    if (path.posix.extname(normalized) || path.win32.extname(normalized)) {
        return false;
    }

    if (normalized === '/api' || normalized.startsWith('/api/')) {
        return false;
    }

    return true;
}
