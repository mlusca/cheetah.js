import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { generate, resetGenerateCache } from '../src/codegen/generate';
import { fixtureRoot, scratchDir } from './helpers';

describe('generate', () => {
    test('writes a self-contained App type and resolved path constants', () => {
        resetGenerateCache();
        const outDir = scratchDir('generate');
        const output = path.join(outDir, 'app.ts');

        const result = generate({
            root: fixtureRoot,
            output,
            include: ['src/**/*.ts'],
            silent: true,
            nodeEnv: 'development',
            force: true
        });

        expect(result.skipped).toBe(false);
        expect(result.changed).toBe(true);
        expect(fs.existsSync(output)).toBe(true);
        expect(result.content).toBe(fs.readFileSync(output, 'utf8'));

        expect(result.content).toContain('export type App =');
        expect(result.content).toContain('export type User =');
        expect(result.content).toContain('export type CreateUserDto =');
        expect(result.content).toContain('":id":');
        expect(result.content).toContain('posts:');
        expect(result.content).toContain('query: { page?: string }');
        expect(result.content).toContain('body: CreateUserDto');
        expect(result.content).toContain('response: User[]');
        expect(result.content).toContain('response: User');
        expect(result.content).not.toContain('Promise<');
        expect(result.content).toContain('response: null');
        expect(result.content).toContain('health:');
        expect(result.content).toContain('users: {');
        expect(result.content).toContain('findOne: "/users/:id"');
        expect(result.content).toContain('"/users/:id/posts"');
        expect(result.content).toContain('list: "/users"');
        expect(result.content).not.toContain('@carno.js/core');
        expect(result.content).not.toContain('UserController');
        expect(result.content).not.toContain('from \'./dto\'');

        const again = generate({
            root: fixtureRoot,
            output,
            include: ['src/**/*.ts'],
            silent: true,
            nodeEnv: 'development',
            force: true
        });
        expect(again.changed).toBe(false);
        expect(again.content).toBe(result.content);
    });

    test('skips regeneration in production when the output already exists', () => {
        resetGenerateCache();
        const outDir = scratchDir('generate-prod');
        const output = path.join(outDir, 'app.ts');
        fs.writeFileSync(output, '// stale\n', 'utf8');

        const result = generate({
            root: fixtureRoot,
            output,
            include: ['src/**/*.ts'],
            silent: true,
            nodeEnv: 'production',
            force: false
        });

        expect(result.skipped).toBe(true);
        expect(fs.readFileSync(output, 'utf8')).toBe('// stale\n');
    });
});
