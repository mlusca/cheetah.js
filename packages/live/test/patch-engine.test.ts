import { describe, expect, test } from 'bun:test';
import { PatchEngine } from '../src/patch/PatchEngine';

describe('PatchEngine without a key', () => {
    const engine = new PatchEngine();

    test('produces no ops for deep-equal values', () => {
        expect(engine.diff({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toEqual([]);
    });

    test('sets a changed leaf', () => {
        expect(engine.diff({ a: 1 }, { a: 2 })).toEqual([{ op: 'set', path: ['a'], value: 2 }]);
    });

    test('unsets a removed property', () => {
        expect(engine.diff({ a: 1, b: 2 }, { a: 1 })).toEqual([{ op: 'unset', path: ['b'] }]);
    });

    test('recurses into nested objects instead of replacing them', () => {
        expect(engine.diff({ a: { b: 1, c: 2 } }, { a: { b: 9, c: 2 } }))
            .toEqual([{ op: 'set', path: ['a', 'b'], value: 9 }]);
    });

    test('replaces an unkeyed array wholesale', () => {
        expect(engine.diff({ xs: [1, 2] }, { xs: [1, 2, 3] }))
            .toEqual([{ op: 'set', path: ['xs'], value: [1, 2, 3] }]);
    });
});

describe('PatchEngine with a key', () => {
    const engine = new PatchEngine('id');

    const a = { id: 1, name: 'Ada' };
    const b = { id: 2, name: 'Bob' };
    const c = { id: 3, name: 'Cid' };

    test('inserting at the top is an upsert plus an order, not a rebuild', () => {
        const ops = engine.diff([a, b], [c, a, b]);

        expect(ops).toEqual([
            { op: 'upsert', path: [], key: 3, index: 0, value: c },
            { op: 'order', path: [], keys: [3, 1, 2] }
        ]);
    });

    test('changing one row touches only that row', () => {
        const ops = engine.diff([a, b], [a, { id: 2, name: 'Bobby' }]);

        expect(ops).toEqual([
            { op: 'upsert', path: [], key: 2, index: 1, value: { id: 2, name: 'Bobby' } }
        ]);
    });

    test('removing a row emits remove', () => {
        expect(engine.diff([a, b], [a])).toEqual([{ op: 'remove', path: [], key: 2 }]);
    });

    test('reordering without changing content emits only order', () => {
        expect(engine.diff([a, b], [b, a])).toEqual([{ op: 'order', path: [], keys: [2, 1] }]);
    });

    test('applies keyed diffs to arrays nested in objects', () => {
        const ops = engine.diff({ users: [a, b] }, { users: [a] });
        expect(ops).toEqual([{ op: 'remove', path: ['users'], key: 2 }]);
    });

    test('falls back to a whole-array set when an element lacks the key', () => {
        const ops = engine.diff([a], [a, { name: 'no id' }]);
        expect(ops).toEqual([{ op: 'set', path: [], value: [a, { name: 'no id' }] }]);
    });
});

describe('PatchEngine.apply', () => {
    test('round-trips: apply(prev, diff(prev, next)) deep-equals next', () => {
        const engine = new PatchEngine('id');
        const cases: [unknown, unknown][] = [
            [{ a: 1 }, { a: 2 }],
            [{ a: 1, b: 2 }, { a: 1 }],
            [{ a: { b: 1 } }, { a: { b: 2, c: 3 } }],
            [[{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }]],
            [[{ id: 1, n: 'a' }], [{ id: 1, n: 'b' }, { id: 2, n: 'c' }]],
            [{ users: [{ id: 1 }] }, { users: [] }],
            [{ xs: [1, 2] }, { xs: [3] }]
        ];

        for (const [prev, next] of cases) {
            expect(engine.apply(prev, engine.diff(prev, next))).toEqual(next as any);
        }
    });

    test('untouched sibling objects keep reference identity', () => {
        const engine = new PatchEngine();
        const prev = { left: { deep: { n: 1 } }, right: { n: 2 } };
        const next = { left: { deep: { n: 1 } }, right: { n: 3 } };

        const applied = engine.apply(prev, engine.diff(prev, next)) as typeof prev;

        expect(applied.left).toBe(prev.left);
        expect(applied).not.toBe(prev);
        expect(applied.right).not.toBe(prev.right);
    });

    test('untouched rows of a keyed list keep reference identity', () => {
        const engine = new PatchEngine('id');
        const kept = { id: 1, name: 'Ada' };
        const prev = [kept, { id: 2, name: 'Bob' }];
        const next = [kept, { id: 2, name: 'Bobby' }];

        const applied = engine.apply(prev, engine.diff(prev, next)) as typeof prev;

        expect(applied[0]).toBe(kept);
        expect(applied).not.toBe(prev);
    });

    test('an empty op list returns the very same root', () => {
        const engine = new PatchEngine();
        const prev = { a: 1 };

        expect(engine.apply(prev, [])).toBe(prev);
    });
});
