import { describe, expect, test } from 'bun:test';
import { Controller, Get } from '@carno.js/core';
import { Live } from '../src/decorators/Live';
import { LIVE_META, type LiveMeta } from '../src/metadata';
import {
    canonicalInputs,
    InputTooLargeError,
    instanceIdOf,
    MissingScopeError,
    scopeKeyOf
} from '../src/resource/instance-id';

@Controller('/users')
class UsersController {
    @Get('/')
    @Live({ key: 'id' })
    list() {
        return [];
    }

    @Get('/:id')
    @Live({ shared: 'tenant' })
    get() {
        return {};
    }

    @Get('/stats')
    plain() {
        return {};
    }
}

function metaOf(handler: string): LiveMeta | undefined {
    return Reflect.getMetadata(LIVE_META, UsersController, handler);
}

describe('@Live', () => {
    test('defaults to private scope and records the handler name', () => {
        expect(metaOf('list')).toEqual({ key: 'id', shared: 'private', dependsOn: [], handlerName: 'list' });
    });

    test('carries an explicit shared scope', () => {
        expect(metaOf('get')?.shared).toBe('tenant');
    });

    test('leaves undecorated handlers alone', () => {
        expect(metaOf('plain')).toBeUndefined();
    });
});

describe('scopeKeyOf', () => {
    test('public collapses to a single shared bucket', () => {
        expect(scopeKeyOf('public', {})).toBe('pub');
    });

    test('tenant and principal are embedded literally, never hashed', () => {
        expect(scopeKeyOf('tenant', { tenant: 'acme' })).toBe('t:acme');
        expect(scopeKeyOf('private', { principal: 42 })).toBe('p:42');
    });

    test('encodes separators so two tenants cannot forge each other keys', () => {
        expect(scopeKeyOf('tenant', { tenant: 'a|b' })).toBe('t:a%7Cb');
    });

    test('refuses a scope it cannot resolve rather than falling back', () => {
        expect(() => scopeKeyOf('tenant', {})).toThrow(MissingScopeError);
        expect(() => scopeKeyOf('private', {})).toThrow(MissingScopeError);
    });
});

describe('instanceIdOf', () => {
    const inputs = { params: {}, query: { status: 'active' } };

    test('is stable for the same resource, scope and inputs', () => {
        const a = instanceIdOf('UsersController.list', 'pub', canonicalInputs(inputs, 8192));
        const b = instanceIdOf('UsersController.list', 'pub', canonicalInputs({ query: { status: 'active' }, params: {} }, 8192));

        expect(a).toBe(b);
    });

    test('two tenants never share an instance', () => {
        const canonical = canonicalInputs(inputs, 8192);
        const a = instanceIdOf('UsersController.list', scopeKeyOf('tenant', { tenant: 'acme' }), canonical);
        const b = instanceIdOf('UsersController.list', scopeKeyOf('tenant', { tenant: 'globex' }), canonical);

        expect(a).not.toBe(b);
        expect(a.startsWith('UsersController.list|t:acme|')).toBe(true);
    });

    test('different inputs produce different instances', () => {
        const a = instanceIdOf('r', 'pub', canonicalInputs({ params: {}, query: { s: 'a' } }, 8192));
        const b = instanceIdOf('r', 'pub', canonicalInputs({ params: {}, query: { s: 'b' } }, 8192));

        expect(a).not.toBe(b);
    });
});

describe('canonicalInputs', () => {
    test('rejects inputs above the ceiling', () => {
        const inputs = { params: {}, query: { q: 'x'.repeat(9000) } };

        expect(() => canonicalInputs(inputs, 8192)).toThrow(InputTooLargeError);
    });
});
