import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { resetGenerateCache } from '../src/codegen/generate';
import { carnoClient } from '../src/vite/plugin';
import { fixtureRoot, scratchDir } from './helpers';

describe('carnoClient vite plugin', () => {
    test('generates during buildStart using the shipped plugin', () => {
        resetGenerateCache();
        const outDir = scratchDir('vite');
        const output = path.join(outDir, 'app.ts');

        const plugin = carnoClient({
            root: fixtureRoot,
            output,
            include: ['src/**/*.ts'],
            silent: true,
            nodeEnv: 'development'
        });

        expect(plugin.name).toBe('carno-client');
        expect(typeof plugin.buildStart).toBe('function');
        plugin.buildStart?.();

        expect(fs.existsSync(output)).toBe(true);
        const content = fs.readFileSync(output, 'utf8');
        expect(content).toContain('export type App =');
        expect(content).toContain('findOne: "/users/:id"');

        plugin.closeBundle?.();
    });
});
