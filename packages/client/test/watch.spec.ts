import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { generate, resetGenerateCache } from '../src/codegen/generate';
import { createClientWatcher } from '../src/codegen/watch';
import { copyFixture } from './helpers';

describe('createClientWatcher', () => {
    let watcher: { close(): void } | null = null;

    afterEach(() => {
        watcher?.close();
        watcher = null;
    });

    test('regenerates when a controller file changes', async () => {
        resetGenerateCache();
        const root = copyFixture('watch');
        const output = 'src/generated/app.ts';

        generate({
            root,
            output,
            include: ['src/**/*.ts'],
            silent: true,
            nodeEnv: 'development',
            force: true
        });

        const outputAbs = path.join(root, output);
        const before = fs.readFileSync(outputAbs, 'utf8');
        expect(before).not.toContain('/watch-new');

        watcher = createClientWatcher({
            root,
            output,
            include: ['src/**/*.ts'],
            silent: true,
            debounceMs: 80,
            nodeEnv: 'development'
        });

        const controller = path.join(root, 'src', 'health.controller.ts');
        const original = fs.readFileSync(controller, 'utf8');
        const updated = original.replace(
            /@Get\(\)(\r?\n)    check\(\): \{ ok: true \} \{/,
            (_match, newline: string) =>
                [
                    `@Get('/watch-new')`,
                    `    watched(): { watched: true } {`,
                    `        return { watched: true };`,
                    `    }`,
                    ``,
                    `    @Get()`,
                    `    check(): { ok: true } {`
                ].join(newline)
        );
        expect(updated).not.toBe(original);
        fs.writeFileSync(controller, updated, 'utf8');

        const deadline = Date.now() + 4000;
        let after = before;
        while (Date.now() < deadline) {
            await Bun.sleep(100);
            if (fs.existsSync(outputAbs)) {
                after = fs.readFileSync(outputAbs, 'utf8');
                if (after.includes('/watch-new')) {
                    break;
                }
            }
        }

        expect(after).toContain('/watch-new');
        expect(after).toContain('watched:');
    });
});
