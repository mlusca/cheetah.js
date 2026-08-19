import fs from 'node:fs';
import path from 'node:path';
import { emitApp } from './emit';
import type { ClientOptions, ResolvedClientOptions } from './options';
import { isProduction, resolveClientOptions } from './options';
import { collectSourceFiles } from './glob';
import { scanProject } from './scan';
import type { GenerateResult } from './types';

const mtimeCache = new Map<string, string>();

export function generate(options: ClientOptions | ResolvedClientOptions = {}): GenerateResult {
    const resolved = resolveClientOptions(options);
    const files = collectSourceFiles(resolved.root, resolved.include, resolved.exclude, resolved.output);
    const outputAbs = path.resolve(resolved.root, resolved.output);
    const stamp = files.map((file) => `${file}:${safeMtime(file)}`).join('|');
    const cacheKey = `${outputAbs}::${stamp}`;

    if (!resolved.force && mtimeCache.get(outputAbs) === cacheKey && fs.existsSync(outputAbs)) {
        const content = fs.readFileSync(outputAbs, 'utf8');
        return {
            output: outputAbs,
            changed: false,
            skipped: true,
            routes: [],
            warnings: [],
            content
        };
    }

    if (isProduction(resolved) && fs.existsSync(outputAbs) && !resolved.force && resolved.watch !== true) {
        const existing = fs.readFileSync(outputAbs, 'utf8');
        mtimeCache.set(outputAbs, cacheKey);
        return {
            output: outputAbs,
            changed: false,
            skipped: true,
            routes: [],
            warnings: [],
            content: existing
        };
    }

    const scan = scanProject(resolved, files);
    const content = emitApp(scan.routes, scan.aliases);

    const previous = fs.existsSync(outputAbs) ? fs.readFileSync(outputAbs, 'utf8') : null;
    const changed = previous !== content;

    if (changed) {
        fs.mkdirSync(path.dirname(outputAbs), { recursive: true });
        fs.writeFileSync(outputAbs, content, 'utf8');
    }

    mtimeCache.set(outputAbs, cacheKey);

    if (!resolved.silent) {
        const rel = path.relative(resolved.root, outputAbs) || outputAbs;
        const action = changed ? 'Generated' : 'Up to date';
        console.log(`[@carno.js/client] ${action} ${rel} (${scan.routes.length} routes)`);
        for (const warning of scan.warnings) {
            const where = warning.file
                ? `${path.relative(resolved.root, warning.file)}${warning.line ? `:${warning.line}` : ''}`
                : undefined;
            console.warn(`[@carno.js/client] ${where ? `${where} ` : ''}${warning.message}`);
        }
    }

    return {
        output: outputAbs,
        changed,
        skipped: false,
        routes: scan.routes,
        warnings: scan.warnings,
        content
    };
}

export function resetGenerateCache(): void {
    mtimeCache.clear();
}

function safeMtime(file: string): string {
    try {
        return String(fs.statSync(file).mtimeMs);
    } catch {
        return '0';
    }
}
