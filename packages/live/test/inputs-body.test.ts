import { describe, expect, test } from 'bun:test';
import { DEFAULT_LIVE_CONFIG } from '../src/config';
import { canonicalInputs, instanceIdOf } from '../src/resource/instance-id';
import { LiveClient, storeKey, type LiveSocket } from '../src/client/core';

const LIMIT = DEFAULT_LIVE_CONFIG.maxInputBytes;

describe('body as part of the instance identity', () => {
    test('the same body written in a different key order is the same input', () => {
        const first = canonicalInputs(
            { params: {}, query: {}, body: { status: 'active', page: 2 } },
            LIMIT
        );
        const second = canonicalInputs(
            { params: {}, query: {}, body: { page: 2, status: 'active' } },
            LIMIT
        );

        expect(first).toBe(second);
    });

    test('a different body is a different instance', () => {
        const active = instanceIdOf(
            'ReportsController.run',
            'pub',
            canonicalInputs({ params: {}, query: {}, body: { status: 'active' } }, LIMIT)
        );
        const archived = instanceIdOf(
            'ReportsController.run',
            'pub',
            canonicalInputs({ params: {}, query: {}, body: { status: 'archived' } }, LIMIT)
        );

        expect(active).not.toBe(archived);
    });

    test('an absent body and an empty body are the same instance', () => {
        const absent = canonicalInputs({ params: {}, query: {} }, LIMIT);
        const explicitNull = canonicalInputs({ params: {}, query: {}, body: null }, LIMIT);

        expect(absent).toBe(explicitNull);
    });

    test('an oversized body is refused before it becomes an instance', () => {
        expect(() =>
            canonicalInputs({ params: {}, query: {}, body: { blob: 'x'.repeat(LIMIT) } }, LIMIT)
        ).toThrow(/over the 8192 byte limit/);
    });

    test('a body that cannot be canonicalized is refused', () => {
        expect(() =>
            canonicalInputs({ params: {}, query: {}, body: { when: new Date() } }, LIMIT)
        ).toThrow(/not serializable/);
    });
});

describe('client store identity', () => {
    class FakeSocket implements LiveSocket {
        onopen: (() => void) | null = null;
        onmessage: ((event: { data: string }) => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: ((error: unknown) => void) | null = null;
        send(): void {}
        close(): void {}
    }

    test('storeKey separates two bodies', () => {
        const one = storeKey('R.run', { params: {}, query: {}, body: { page: 1 } });
        const two = storeKey('R.run', { params: {}, query: {}, body: { page: 2 } });

        expect(one).not.toBe(two);
    });

    test('the same body reuses the same store', () => {
        const client = new LiveClient({ url: 'ws://test/live', socketFactory: () => new FakeSocket() });
        const first = client.store('R.run', { params: {}, query: {}, body: { page: 1 } });
        const second = client.store('R.run', { params: {}, query: {}, body: { page: 1 } });

        expect(first).toBe(second);
    });
});
