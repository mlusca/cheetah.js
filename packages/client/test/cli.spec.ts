import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { fixtureRoot, scratchDir } from './helpers';

describe('carno-client CLI', () => {
    test('generate writes the client through the shipped CLI entry', async () => {
        const outDir = scratchDir('cli');
        const output = path.join(outDir, 'app.ts');
        const cli = path.resolve(import.meta.dir, '../src/cli.ts');

        const proc = Bun.spawn({
            cmd: [
                'bun',
                cli,
                'generate',
                '--root',
                fixtureRoot,
                '--output',
                output,
                '--include',
                'src/**/*.ts',
                '--silent'
            ],
            stdout: 'pipe',
            stderr: 'pipe'
        });

        const exit = await proc.exited;
        const stderr = await new Response(proc.stderr).text();
        expect(exit).toBe(0);
        expect(stderr).toBe('');
        expect(fs.existsSync(output)).toBe(true);
        expect(fs.readFileSync(output, 'utf8')).toContain('export type App =');
    });
});
