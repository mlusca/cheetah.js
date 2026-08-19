import fs from 'node:fs';
import path from 'node:path';
import { normalizeSlashes } from './options';

export function collectSourceFiles(
    root: string,
    include: string[],
    exclude: string[],
    outputRelative?: string
): string[] {
    const results: string[] = [];
    const outputAbs = outputRelative
        ? normalizeSlashes(path.resolve(root, outputRelative))
        : undefined;

    walk(root, (file) => {
        const abs = normalizeSlashes(file);
        if (outputAbs && abs === outputAbs) {
            return;
        }

        const rel = normalizeSlashes(path.relative(root, file));
        if (rel.startsWith('..')) {
            return;
        }

        if (!include.some((pattern) => matchGlob(rel, pattern))) {
            return;
        }

        if (exclude.some((pattern) => matchGlob(rel, pattern))) {
            return;
        }

        results.push(abs);
    });

    results.sort();
    return results;
}

export function matchGlob(relativePath: string, pattern: string): boolean {
    const rel = normalizeSlashes(relativePath);
    const pat = normalizeSlashes(pattern).replace(/^\.\//, '');
    return globToRegExp(pat).test(rel);
}

export function globToRegExp(pattern: string): RegExp {
    let i = 0;
    let out = '^';

    while (i < pattern.length) {
        if (pattern[i] === '*' && pattern[i + 1] === '*') {
            if (pattern[i + 2] === '/') {
                out += '(?:.*/)?';
                i += 3;
            } else {
                out += '.*';
                i += 2;
            }
        } else if (pattern[i] === '*') {
            out += '[^/]*';
            i += 1;
        } else if (pattern[i] === '?') {
            out += '[^/]';
            i += 1;
        } else {
            out += escapeRegex(pattern[i]);
            i += 1;
        }
    }

    out += '$';
    return new RegExp(out);
}

function stripTrailingSlashes(value: string): string {
    let end = value.length;
    while (end > 0 && value.charCodeAt(end - 1) === 47) {
        end -= 1;
    }
    return end === value.length ? value : value.slice(0, end);
}

function escapeRegex(char: string): string {
    return /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

function walk(dir: string, visit: (file: string) => void): void {
    let entries: fs.Dirent[];

    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
                continue;
            }
            walk(full, visit);
            continue;
        }

        if (entry.isFile()) {
            visit(full);
        }
    }
}

export function inferWatchDirectories(root: string, include: string[]): string[] {
    const dirs = new Set<string>();

    for (const pattern of include) {
        const posix = normalizeSlashes(pattern);
        const star = posix.search(/[*?]/);
        const prefix = star === -1 ? posix : posix.slice(0, star);
        const trimmed = stripTrailingSlashes(prefix);
        const first = trimmed.split('/').filter(Boolean)[0];
        const candidate = first ? path.resolve(root, first) : root;

        if (fs.existsSync(candidate)) {
            dirs.add(candidate);
        } else {
            dirs.add(root);
        }
    }

    if (dirs.size === 0) {
        dirs.add(root);
    }

    return [...dirs];
}
