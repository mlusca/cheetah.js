import { describe, expect, test } from 'bun:test';
import { matchGlob } from '../src/codegen/glob';
import { normalizeControllerPath, normalizeMethodPath, normalizeRoutePath } from '../src/codegen/normalize';

describe('glob and path helpers', () => {
    test('matchGlob handles **/*.ts includes and generated excludes', () => {
        expect(matchGlob('src/users.controller.ts', 'src/**/*.ts')).toBe(true);
        expect(matchGlob('src/users/users.controller.ts', 'src/**/*.ts')).toBe(true);
        expect(matchGlob('src/generated/app.ts', '**/generated/**')).toBe(true);
        expect(matchGlob('src/users.spec.ts', '**/*.spec.ts')).toBe(true);
        expect(matchGlob('test/users.controller.ts', 'src/**/*.ts')).toBe(false);
    });

    test('normalizes paths the same way as Carno compileController', () => {
        expect(normalizeControllerPath('users')).toBe('/users');
        expect(normalizeControllerPath('/users/')).toBe('/users');
        expect(normalizeControllerPath('')).toBe('');
        expect(normalizeMethodPath('')).toBe('/');
        expect(normalizeMethodPath(':id')).toBe('/:id');
        expect(normalizeRoutePath('/users' + '/')).toBe('/users');
        expect(normalizeRoutePath('/users' + '/:id')).toBe('/users/:id');
        expect(normalizeRoutePath('/parent' + '/child' + '/route')).toBe('/parent/child/route');
        expect(normalizeRoutePath('/root' + '/middle' + '/')).toBe('/root/middle');
        expect(normalizeRoutePath('/users///:id')).toBe('/users/:id');
        expect(normalizeRoutePath('//api//users')).toBe('/api/users');
    });
});
