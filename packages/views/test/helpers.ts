import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ViewEngine } from '../src';

export const FIXTURES = path.join(import.meta.dir, 'fixtures');

export function plainEngine(compiles?: { count: number }): ViewEngine {
    return {
        name: 'plain',
        extensions: ['.html'],
        compile(source: string) {
            if (compiles) compiles.count += 1;
            return source;
        },
        render(template: unknown, data: Record<string, any>) {
            return String(template).replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
                const value = data[key];
                return value == null ? '' : String(value);
            });
        },
    };
}

export async function makeTempViews(prefix: string, files: Record<string, string>): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), `carno-views-${prefix}-`));

    for (const [relative, contents] of Object.entries(files)) {
        const target = path.join(dir, relative);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, contents, 'utf8');
    }

    return dir;
}

export async function writeView(root: string, relative: string, contents: string): Promise<void> {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, 'utf8');
}
