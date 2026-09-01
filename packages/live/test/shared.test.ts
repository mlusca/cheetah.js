import { describe, expect, test } from 'bun:test';
import { canonical, NonSerializableInputError } from '../src/shared/canonical';
import { fnv1a64 } from '../src/shared/hash';

describe('canonical', () => {
    test('orders object keys so equal inputs produce equal strings', () => {
        expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
        expect(canonical({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    });

    test('preserves array order', () => {
        expect(canonical([3, 1, 2])).toBe('[3,1,2]');
    });

    test('drops undefined properties but keeps null', () => {
        expect(canonical({ a: undefined, b: null })).toBe('{"b":null}');
    });

    test('normalizes negative zero', () => {
        expect(canonical(-0)).toBe(canonical(0));
    });

    test('rejects non-serializable inputs', () => {
        expect(() => canonical(new Date())).toThrow(NonSerializableInputError);
        expect(() => canonical({ a: () => 1 })).toThrow(NonSerializableInputError);
        expect(() => canonical(Number.NaN)).toThrow(NonSerializableInputError);
    });

    test('reports the path of the offending value', () => {
        try {
            canonical({ filters: [{ since: new Date() }] });
            throw new Error('should have thrown');
        } catch (err) {
            expect((err as NonSerializableInputError).path).toBe('$.filters[0].since');
        }
    });
});

describe('fnv1a64', () => {
    test('is deterministic and 16 hex chars wide', () => {
        const hash = fnv1a64('carno');
        expect(hash).toMatch(/^[0-9a-f]{16}$/);
        expect(fnv1a64('carno')).toBe(hash);
    });

    test('separates inputs that differ only by order', () => {
        expect(fnv1a64('ab')).not.toBe(fnv1a64('ba'));
    });

    test('separates the empty string from a zero byte', () => {
        expect(fnv1a64('')).not.toBe(fnv1a64(String.fromCharCode(0)));
    });
});
