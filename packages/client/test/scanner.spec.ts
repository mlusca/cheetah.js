import { describe, expect, test } from 'bun:test';
import { resolveClientOptions } from '../src/codegen/options';
import { scanProject } from '../src/codegen/scan';
import { findRoute, fixtureRoot } from './helpers';

function scanFixture() {
    return scanProject(resolveClientOptions({
        root: fixtureRoot,
        include: ['src/**/*.ts'],
        output: 'src/generated/app.ts',
        silent: true,
        nodeEnv: 'development',
        force: true
    }));
}

describe('scanProject', () => {
    test('resolves literal paths, as const route constants, and concatenations', () => {
        const { routes, warnings } = scanFixture();

        expect(findRoute(routes, 'get', '/users')).toBeTruthy();
        expect(findRoute(routes, 'post', '/users')).toBeTruthy();
        expect(findRoute(routes, 'get', '/users/:id')).toBeTruthy();
        expect(findRoute(routes, 'put', '/users/:id')).toBeTruthy();
        expect(findRoute(routes, 'delete', '/users/:id')).toBeTruthy();
        expect(findRoute(routes, 'get', '/users/search')).toBeTruthy();
        expect(findRoute(routes, 'get', '/health')).toBeTruthy();
        expect(findRoute(routes, 'get', '/api/users')).toBeTruthy();
        expect(findRoute(routes, 'get', '/skip/visible')).toBeTruthy();
        expect(findRoute(routes, 'get', '/dynamic')).toBeUndefined();

        const byId = findRoute(routes, 'get', '/users/:id');
        expect(byId?.pathSource).toContain('UserRoutes.byId');

        expect(warnings.some((warning) => warning.message.includes('dynamicPath'))).toBe(true);
    });

    test('nests children under the parent controller prefix', () => {
        const { routes } = scanFixture();

        expect(findRoute(routes, 'get', '/users/profile')).toBeTruthy();
        expect(findRoute(routes, 'get', '/users/:id/posts')).toBeTruthy();
        expect(findRoute(routes, 'post', '/users/:id/posts')).toBeTruthy();
        expect(findRoute(routes, 'get', '/profile')).toBeUndefined();
    });

    test('extracts @Body, @Param and @Query types from TypeScript', () => {
        const { routes, aliases } = scanFixture();

        const list = findRoute(routes, 'get', '/users') as any;
        expect(list.query).toEqual([
            expect.objectContaining({ name: 'page', type: 'string', optional: true })
        ]);
        expect(list.response).toBe('User[]');

        const search = findRoute(routes, 'get', '/users/search') as any;
        expect(search.query[0].name).toBeUndefined();
        expect(search.query[0].type).toContain('q: string');

        const findOne = findRoute(routes, 'get', '/users/:id') as any;
        expect(findOne.params).toEqual([
            expect.objectContaining({ name: 'id', type: 'string' })
        ]);
        expect(findOne.response).toBe('User');

        const create = findRoute(routes, 'post', '/users') as any;
        expect(create.body[0].type).toBe('CreateUserDto');

        const remove = findRoute(routes, 'delete', '/users/:id') as any;
        expect(remove.response).toBe('null');

        const aliasNames = aliases.map((alias) => alias.name);
        expect(aliasNames).toContain('User');
        expect(aliasNames).toContain('CreateUserDto');

        const user = aliases.find((alias) => alias.name === 'User');
        expect(user?.type).toContain('id: string');
        expect(user?.type).toContain('email: string');
    });
});
