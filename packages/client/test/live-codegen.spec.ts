import { describe, expect, test } from 'bun:test';
import { emitApp } from '../src/codegen/emit';
import { resolveClientOptions } from '../src/codegen/options';
import { scanProject } from '../src/codegen/scan';
import { findRoute, liveFixtureRoot } from './helpers';

function scanLiveFixture() {
    return scanProject(resolveClientOptions({
        root: liveFixtureRoot,
        include: ['src/**/*.ts'],
        output: 'src/generated/app.ts',
        silent: true,
        nodeEnv: 'development',
        force: true
    }));
}

describe('scanning @Live()', () => {
    test('reads shared and key from the decorator', () => {
        const { routes } = scanLiveFixture();

        expect(findRoute(routes, 'get', '/cards')).toMatchObject({
            live: { shared: 'tenant', key: 'id' }
        });
    });

    test('defaults shared to private when the decorator is bare', () => {
        const { routes } = scanLiveFixture();

        expect(findRoute(routes, 'get', '/cards/:id')).toMatchObject({
            live: { shared: 'private' }
        });
        expect((findRoute(routes, 'get', '/cards/:id') as any).live.key).toBeUndefined();
    });

    test('reads @Live() on a POST', () => {
        const { routes } = scanLiveFixture();

        expect(findRoute(routes, 'post', '/cards/search')).toMatchObject({
            live: { shared: 'private', key: 'id' }
        });
    });

    test('leaves a plain route without a live field', () => {
        const { routes } = scanLiveFixture();

        expect((findRoute(routes, 'post', '/cards') as any).live).toBeUndefined();
    });
});

describe('emitting descriptors', () => {
    test('emits one descriptor per route, typed through App', () => {
        const { routes, aliases } = scanLiveFixture();
        const content = emitApp(routes, aliases);

        expect(content).toContain('export interface RouteDescriptor<R = unknown>');
        expect(content).toContain('export const routes = {');
        expect(content).toContain('method: "get", path: "/cards"');
        expect(content).toContain('as RouteDescriptor<App["cards"]["get"]>');
        expect(content).toContain('as RouteDescriptor<App["cards"][":id"]["get"]>');
    });

    test('carries live and the resource id for subscribable routes only', () => {
        const { routes, aliases } = scanLiveFixture();
        const content = emitApp(routes, aliases);

        expect(content).toContain('resourceId: "BoardController.list"');
        expect(content).toContain('live: { shared: "tenant", key: "id" }');
        // `create` is a plain POST: no resource id, no live.
        expect(content).not.toContain('resourceId: "BoardController.create"');
    });

    test('still emits the paths constant unchanged in shape', () => {
        const { routes, aliases } = scanLiveFixture();
        const content = emitApp(routes, aliases);

        expect(content).toContain('export const paths = {');
        expect(content).toContain('list: "/cards"');
    });
});
