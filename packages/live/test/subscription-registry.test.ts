import { describe, expect, test } from 'bun:test';
import { SubscriptionRegistry } from '../src/graph/SubscriptionRegistry';

describe('SubscriptionRegistry', () => {
    test('tracks one connection subscribing once', () => {
        const registry = new SubscriptionRegistry();

        expect(registry.subscribe('c1', 'i1')).toBe(1);
        expect(registry.connectionsOf('i1')).toEqual(['c1']);
        expect(registry.instanceCount()).toBe(1);
    });

    test('refcounts repeated subscriptions from the same connection', () => {
        const registry = new SubscriptionRegistry();
        registry.subscribe('c1', 'i1');

        expect(registry.subscribe('c1', 'i1')).toBe(2);
        expect(registry.connectionsOf('i1')).toEqual(['c1']);
        expect(registry.unsubscribe('c1', 'i1')).toBe(1);
        expect(registry.hasSubscribers('i1')).toBe(true);
        expect(registry.unsubscribe('c1', 'i1')).toBe(0);
        expect(registry.hasSubscribers('i1')).toBe(false);
    });

    test('two connections share one instance', () => {
        const registry = new SubscriptionRegistry();
        registry.subscribe('c1', 'i1');
        registry.subscribe('c2', 'i1');

        expect(registry.connectionsOf('i1').sort()).toEqual(['c1', 'c2']);
        registry.unsubscribe('c1', 'i1');
        expect(registry.hasSubscribers('i1')).toBe(true);
    });

    test('counts distinct instances per connection for the per-connection ceiling', () => {
        const registry = new SubscriptionRegistry();
        registry.subscribe('c1', 'i1');
        registry.subscribe('c1', 'i1');
        registry.subscribe('c1', 'i2');

        expect(registry.countForConnection('c1')).toBe(2);
    });

    test('dropping a connection returns the instances left with no subscriber', () => {
        const registry = new SubscriptionRegistry();
        registry.subscribe('c1', 'i1');
        registry.subscribe('c1', 'i2');
        registry.subscribe('c2', 'i2');

        expect(registry.dropConnection('c1').sort()).toEqual(['i1']);
        expect(registry.hasSubscribers('i2')).toBe(true);
        expect(registry.countForConnection('c1')).toBe(0);
    });

    test('unsubscribing something never subscribed is a no-op', () => {
        const registry = new SubscriptionRegistry();

        expect(registry.unsubscribe('c1', 'i1')).toBe(0);
        expect(registry.dropConnection('nope')).toEqual([]);
    });
});
