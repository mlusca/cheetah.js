import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { fixtureRoot, scratchDir } from './helpers';

describe('@carno.js/client/register', () => {
    test('preload generates the client without a watch command', async () => {
        const outDir = scratchDir('register');
        const output = path.join(outDir, 'app.ts');
        const register = path.resolve(import.meta.dir, '../src/bun/register.ts');

        const proc = Bun.spawn({
            cmd: ['bun', '--preload', register, '-e', 'console.log("booted")'],
            cwd: fixtureRoot,
            env: {
                ...process.env,
                CARNO_CLIENT_ROOT: fixtureRoot,
                CARNO_CLIENT_OUTPUT: output,
                CARNO_CLIENT_INCLUDE: 'src/**/*.ts',
                CARNO_CLIENT_SILENT: '1'
            },
            stdout: 'pipe',
            stderr: 'pipe'
        });

        const exit = await proc.exited;
        const stderr = await new Response(proc.stderr).text();
        const stdout = await new Response(proc.stdout).text();

        expect(exit).toBe(0);
        expect(stderr).toBe('');
        expect(stdout).toContain('booted');
        expect(fs.existsSync(output)).toBe(true);
        expect(fs.readFileSync(output, 'utf8')).toContain('export type App =');
    });
});
