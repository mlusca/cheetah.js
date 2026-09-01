import { describe, expect, test } from 'bun:test';
import { resolveClientOptions } from '../src/codegen/options';
import { scanProject } from '../src/codegen/scan';
import { liveFixtureRoot } from './helpers';

function warnings() {
    return scanProject(resolveClientOptions({
        root: liveFixtureRoot,
        include: ['src/**/*.ts'],
        output: 'src/generated/app.ts',
        silent: true,
        nodeEnv: 'development',
        force: true
    })).warnings;
}

function find(fragment: string) {
    return warnings().find(warning => warning.message.includes(fragment));
}

describe('live validation at build time', () => {
    test('warns about @Live() on a verb that is neither GET nor POST', () => {
        const warning = find('@Live() on @PUT()');

        expect(warning).toBeDefined();
        expect(warning!.file).toContain('bad.controller.ts');
        expect(warning!.line).toBeGreaterThan(0);
    });

    test('warns about request-bound parameters, one per parameter', () => {
        expect(find('@Req()')).toBeDefined();
        expect(find('@Ctx()')).toBeDefined();
        expect(find('@Header()')).toBeDefined();
    });

    test('warns about an input type that cannot be hashed', () => {
        const warning = find('cannot be canonicalized');

        expect(warning).toBeDefined();
        expect(warning!.message).toContain('since');
    });

    test('warns about a keyed collection with no key declared', () => {
        const warning = find('declares no `key`');

        expect(warning).toBeDefined();
        expect(warning!.message).toContain('needsKey');
    });

    test('warns about two live resources sharing one id', () => {
        const warning = find('share the id');

        expect(warning).toBeDefined();
        expect(warning!.message).toContain('BoardController.list');
    });

    test('says nothing about a well-formed live resource', () => {
        const noise = warnings().filter(warning => warning.message.includes('BoardController.byId'));

        expect(noise).toEqual([]);
    });
});
