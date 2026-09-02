import { describe, expect, test } from 'bun:test';
import type { Statement } from '@carno.js/orm';
import { ancestorsOf, rowKey, tableKey } from '../src/graph/dep-key';
import { normalizeColumns, readDependencies, writeEvents } from '../src/emitters/statement-keys';

const MAX = 64;

function select(overrides: Partial<Statement<any>>): Statement<any> {
    return { statement: 'select', table: 'users', alias: 'u', primaryKeyColumnName: 'id', ...overrides };
}

describe('dep-key', () => {
    test('builds table and row keys', () => {
        expect(tableKey('users')).toBe('orm:users');
        expect(rowKey('users', 42)).toBe('orm:users#42');
    });

    test('a row key has its table as ancestor', () => {
        expect(ancestorsOf('orm:users#42')).toEqual(['orm:users#42', 'orm:users']);
    });

    test('a table key has only itself', () => {
        expect(ancestorsOf('orm:users')).toEqual(['orm:users']);
    });

    test('an arbitrary app key is not split on colons', () => {
        expect(ancestorsOf('app:report:2026-08')).toEqual(['app:report:2026-08']);
    });
});

describe('normalizeColumns', () => {
    test('strips alias, quotes and the AS clause the ORM generates', () => {
        expect(normalizeColumns(['u."name" as "u_name"', 'u."id" as "u_id"'])).toEqual(['id', 'name']);
    });

    test('treats a star select as wildcard', () => {
        expect(normalizeColumns(['*'])).toBeNull();
        expect(normalizeColumns(undefined)).toBeNull();
    });
});

describe('readDependencies', () => {
    test('a primary-key lookup depends on the row', () => {
        const deps = readDependencies(select({ where: 'u."id" = 42', columns: ['u."name" as "u_name"'] }), MAX);
        expect(deps).toEqual([{ key: 'orm:users#42', columns: ['name'] }]);
    });

    test('a filtered list depends on the table', () => {
        const deps = readDependencies(select({ where: "u.\"status\" = 'active'", columns: ['u."id" as "u_id"'] }), MAX);
        expect(deps).toEqual([{ key: 'orm:users', columns: ['id'] }]);
    });

    test('an IN list produces one row key per id', () => {
        const deps = readDependencies(select({ where: 'u."id" IN (1, 2, 3)' }), MAX);
        expect(deps.map(d => d.key)).toEqual(['orm:users#1', 'orm:users#2', 'orm:users#3']);
    });

    test('collapses to the table when the IN list exceeds maxKeysPerRead', () => {
        const ids = Array.from({ length: 5 }, (_, i) => i + 1).join(', ');
        const deps = readDependencies(select({ where: `u."id" IN (${ids})` }), 4);
        expect(deps.map(d => d.key)).toEqual(['orm:users']);
    });

    test('a join adds the joined table as its own dependency', () => {
        const statement = select({
            where: 'u."id" = 7',
            join: [{ joinTable: 'orders', joinAlias: 'o', type: 'INNER', on: 'o.user_id = u.id' } as any]
        });
        expect(readDependencies(statement, MAX).map(d => d.key)).toEqual(['orm:users#7', 'orm:orders']);
    });

    test('a select-strategy join adds every child table as a dependency', () => {
        const statement = select({
            where: 'u."id" = 7',
            selectJoin: [{
                statement: 'select',
                table: '"public"."orders"',
                alias: 'o',
                columns: ['o."id"'],
                where: 'o.user_id IN (7)'
            }]
        });

        expect(readDependencies(statement, MAX).map(d => d.key)).toEqual(['orm:users#7', 'orm:orders']);
    });

    test('normalizes a qualified ORM table name', () => {
        expect(readDependencies(select({ table: '"public"."users"' }), MAX)[0].key).toBe('orm:users');
    });

    test('ignores write statements', () => {
        expect(readDependencies(select({ statement: 'update', values: { name: 'x' } }), MAX)).toEqual([]);
    });
});

describe('writeEvents', () => {
    test('an update by id emits the row key carrying the written columns', () => {
        const statement = select({ statement: 'update', where: 'u."id" = 42', values: { name: 'Ada' } });
        expect(writeEvents(statement, MAX)).toEqual([{ key: 'orm:users#42', columns: ['name'] }]);
    });

    test('an update by predicate emits the table key', () => {
        const statement = select({ statement: 'update', where: "u.\"created_at\" < '2020-01-01'", values: { archived: true } });
        expect(writeEvents(statement, MAX)).toEqual([{ key: 'orm:users', columns: ['archived'] }]);
    });

    test('a delete emits a wildcard because the whole row is gone', () => {
        const statement = select({ statement: 'delete', where: 'u."id" = 9' });
        expect(writeEvents(statement, MAX)).toEqual([{ key: 'orm:users#9', columns: null }]);
    });

    test('an insert emits the row key so table subscribers wake through the ancestor', () => {
        const statement = select({ statement: 'insert', values: { id: 5, name: 'Ada' } });
        expect(writeEvents(statement, MAX)).toEqual([{ key: 'orm:users#5', columns: ['id', 'name'] }]);
    });

    test('an insert without a primary key falls back to the table', () => {
        const statement = select({ statement: 'insert', values: { name: 'Ada' } });
        expect(writeEvents(statement, MAX)).toEqual([{ key: 'orm:users', columns: ['name'] }]);
    });

    test('a bulk insert emits one key per row', () => {
        const statement = select({ statement: 'insert', bulk: true, values: [{ id: 1 }, { id: 2 }] });
        expect(writeEvents(statement, MAX).map(e => e.key)).toEqual(['orm:users#1', 'orm:users#2']);
    });
});
