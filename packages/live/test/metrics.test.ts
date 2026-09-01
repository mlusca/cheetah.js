import { describe, expect, test } from 'bun:test';
import { LiveMetrics, type MetricSink } from '../src/observability';

function recorder(): MetricSink & { seen: { name: string; value: number; tags?: Record<string, any> }[] } {
    const seen: { name: string; value: number; tags?: Record<string, any> }[] = [];

    return {
        seen,
        onMetric(name, value, tags) { seen.push({ name, value, tags }); }
    };
}

describe('LiveMetrics', () => {
    test('a recompute that produced a patch publishes the count, the duration and the size', () => {
        const sink = recorder();

        new LiveMetrics(sink).recompute('CardsController.list', true, 3, 12.5);

        expect(sink.seen).toEqual([
            { name: 'live.recompute', value: 1, tags: { resource: 'CardsController.list', patched: true } },
            { name: 'live.recompute.ms', value: 12.5, tags: { resource: 'CardsController.list' } },
            { name: 'live.patch.ops', value: 3, tags: { resource: 'CardsController.list' } }
        ]);
    });

    test('a recompute that produced no patch is counted, and publishes no patch size', () => {
        const sink = recorder();

        new LiveMetrics(sink).recompute('CardsController.list', false, 0, 4);

        expect(sink.seen.map(entry => entry.name)).toEqual(['live.recompute', 'live.recompute.ms']);
        expect(sink.seen[0].tags).toEqual({ resource: 'CardsController.list', patched: false });
    });

    test('an invalidation publishes how many keys arrived and how many instances woke', () => {
        const sink = recorder();

        new LiveMetrics(sink).invalidation(2, 17);

        expect(sink.seen).toEqual([
            { name: 'live.invalidation.keys', value: 2, tags: undefined },
            { name: 'live.invalidation.fanout', value: 17, tags: undefined }
        ]);
    });

    test('an invalidation that woke nothing still publishes the fan-out', () => {
        const sink = recorder();

        // Zero fan-out is the healthy case and the interesting one: it is what
        // a precise graph looks like. Dropping it would bias the average up.
        new LiveMetrics(sink).invalidation(1, 0);

        expect(sink.seen.find(entry => entry.name === 'live.invalidation.fanout')?.value).toBe(0);
    });

    test('none() swallows everything without a sink', () => {
        expect(() => {
            LiveMetrics.none().recompute('X.y', true, 1, 1);
            LiveMetrics.none().invalidation(1, 1);
            LiveMetrics.none().instances(5);
        }).not.toThrow();
    });

    test('a sink that throws does not take the caller down', () => {
        const metrics = new LiveMetrics({
            onMetric() { throw new Error('the metrics backend is down'); }
        });

        // Losing a number is acceptable. Losing a recompute is not.
        expect(() => metrics.recompute('X.y', true, 1, 1)).not.toThrow();
    });
});

import { DependencyGraph } from '../src/graph/DependencyGraph';
import { InProcessBus } from '../src/bus/InProcessBus';
import { LiveEngine } from '../src/LiveEngine';
import { ResourceRegistry } from '../src/resource/ResourceRegistry';
import { SubscriptionRegistry } from '../src/graph/SubscriptionRegistry';
import { resolveLiveConfig } from '../src/config';
import { Controller, Get } from '@carno.js/core';
import { Live } from '../src/decorators/Live';

describe('LiveEngine metrics', () => {
    test('a recompute that changes nothing publishes patched=false', async () => {
        let payload = [{ id: 1 }];

        @Controller('/things')
        class ThingsController {
            @Get('/')
            @Live({ shared: 'public', dependsOn: ['orm:things'] })
            list() { return payload; }
        }

        const sink = recorder();
        const resources = new ResourceRegistry();
        resources.register(ThingsController, new ThingsController());

        const bus = new InProcessBus();
        const engine = new LiveEngine(
            resources,
            new DependencyGraph(),
            new SubscriptionRegistry(),
            bus,
            { send: () => 1 },
            resolveLiveConfig({ coalesceMs: 1 }),
            undefined,
            new LiveMetrics(sink)
        );

        engine.start();
        await engine.subscribe('c1', 's1', 'ThingsController.list', { params: {}, query: {} }, {});

        bus.publish([{ key: 'orm:things', columns: null }]);
        await new Promise(resolve => setTimeout(resolve, 40));

        const recomputes = sink.seen.filter(entry => entry.name === 'live.recompute');
        expect(recomputes.some(entry => entry.tags?.patched === false)).toBe(true);
        expect(sink.seen.some(entry => entry.name === 'live.patch.ops')).toBe(false);

        // And the same invalidation, now producing real change, flips it.
        payload = [{ id: 1 }, { id: 2 }];
        bus.publish([{ key: 'orm:things', columns: null }]);
        await new Promise(resolve => setTimeout(resolve, 40));

        expect(sink.seen.some(entry => entry.name === 'live.patch.ops')).toBe(true);
        expect(sink.seen.some(entry => entry.name === 'live.invalidation.fanout' && entry.value === 1)).toBe(true);

        engine.stop();
    });
});
