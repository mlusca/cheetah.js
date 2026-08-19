import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { Carno } from '@carno.js/core';
import { Client } from '../src/plugin/Client';
import { ClientService } from '../src/plugin/ClientService';
import { resetGenerateCache } from '../src/codegen/generate';
import { fixtureRoot, scratchDir } from './helpers';

describe('Client plugin', () => {
    let app: Carno | null = null;

    afterEach(async () => {
        if (app) {
            try {
                app.get(ClientService).stopWatching();
            } catch {
                // plugin not registered
            }
            await app.stop();
            app = null;
        }
    });

    test('generates the client during listen() from scanned sources', async () => {
        resetGenerateCache();
        const outDir = scratchDir('plugin');
        const output = path.join(outDir, 'generated', 'app.ts');

        app = new Carno({ disableStartupLog: true }).use(Client({
            root: fixtureRoot,
            output,
            include: ['src/**/*.ts'],
            watch: false,
            silent: true,
            nodeEnv: 'development',
            force: true
        }));

        await app.listen(0);

        expect(fs.existsSync(output)).toBe(true);
        const content = fs.readFileSync(output, 'utf8');
        expect(content).toContain('export type App =');
        expect(content).toContain('findOne: "/users/:id"');
        expect(app.get(ClientService)).toBeInstanceOf(ClientService);
    });

    test('does not watch in production when the output already exists', async () => {
        resetGenerateCache();
        const outDir = scratchDir('plugin-prod');
        const output = path.join(outDir, 'app.ts');
        fs.writeFileSync(output, '// already generated\n', 'utf8');

        app = new Carno({ disableStartupLog: true }).use(Client({
            root: fixtureRoot,
            output,
            include: ['src/**/*.ts'],
            silent: true,
            nodeEnv: 'production'
        }));

        await app.listen(0);
        expect(fs.readFileSync(output, 'utf8')).toBe('// already generated\n');
    });
});
