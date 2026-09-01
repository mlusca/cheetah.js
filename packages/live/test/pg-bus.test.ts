import { describe, expect, test } from 'bun:test';
import { PgNotifyBus, chunkEvents } from '../src/bus/PgNotifyBus';
import { PgListener, type ListenableSql } from '../src/emitters/pg-listener';
import type { InvalidationEvent } from '../src/graph/types';

/** Stands in for the Postgres notification bus, shared by several connections. */
class FakeBroker {
    private readonly handlers = new Map<string, Set<(payload: string) => void>>();

    connection(): ListenableSql {
        const broker = this;
        const own = new Set<{ channel: string; handler: (payload: string) => void }>();

        return {
            async listen(channel: string, onNotify: (payload: string) => void): Promise<void> {
                let bucket = broker.handlers.get(channel);

                if (!bucket) {
                    bucket = new Set();
                    broker.handlers.set(channel, bucket);
                }

                bucket.add(onNotify);
                own.add({ channel, handler: onNotify });
            },
            async notify(channel: string, payload = ''): Promise<void> {
                // Postgres delivers to every listening session, sender included.
                for (const handler of [...(broker.handlers.get(channel) ?? [])]) {
                    handler(payload);
                }
            },
            async unsafe(): Promise<void> {},
            async close(): Promise<void> {
                for (const entry of own) {
                    broker.handlers.get(entry.channel)?.delete(entry.handler);
                }

                own.clear();
            }
        };
    }
}

function node(broker: FakeBroker, nodeId: string) {
    const received: InvalidationEvent[] = [];
    const bus = new PgNotifyBus({
        url: 'postgres://ignored',
        channel: 'carno_test_bus',
        nodeId,
        listener: new PgListener({
            url: 'postgres://ignored',
            heartbeatMs: 0,
            sqlFactory: () => broker.connection()
        })
    });

    bus.subscribe(events => received.push(...events));

    return { bus, received };
}

describe('chunkEvents', () => {
    test('keeps everything in one frame when it fits', () => {
        const frames = chunkEvents([{ key: 'orm:users#1', columns: null }], 'n1', 7000);

        expect(frames).toHaveLength(1);
        expect(JSON.parse(frames[0])).toEqual({ n: 'n1', e: [{ key: 'orm:users#1', columns: null }] });
    });

    test('splits into frames under the ceiling', () => {
        const events = Array.from({ length: 50 }, (_, index) => ({
            key: `orm:users#${index}`,
            columns: ['name', 'email']
        }));

        const frames = chunkEvents(events, 'n1', 400);

        expect(frames.length).toBeGreaterThan(1);

        for (const frame of frames) {
            expect(Buffer.byteLength(frame, 'utf8')).toBeLessThanOrEqual(400);
        }

        expect(frames.flatMap(frame => JSON.parse(frame).e)).toEqual(events);
    });

    test('one oversized event degrades to its table instead of overflowing', () => {
        const frames = chunkEvents(
            [{ key: 'orm:users#1', columns: Array.from({ length: 200 }, (_, i) => `column_${i}`) }],
            'n1',
            300
        );

        expect(frames).toHaveLength(1);
        expect(JSON.parse(frames[0]).e).toEqual([{ key: 'orm:users', columns: null }]);
    });
});

describe('PgNotifyBus', () => {
    test('an invalidation published on one node arrives on the other', async () => {
        const broker = new FakeBroker();
        const a = node(broker, 'a');
        const b = node(broker, 'b');

        await a.bus.start();
        await b.bus.start();

        a.bus.publish([{ key: 'orm:users#1', columns: ['name'] }]);
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(b.received).toEqual([{ key: 'orm:users#1', columns: ['name'] }]);

        await a.bus.stop();
        await b.bus.stop();
    });

    test('the publishing node delivers locally exactly once', async () => {
        const broker = new FakeBroker();
        const a = node(broker, 'a');

        await a.bus.start();
        a.bus.publish([{ key: 'orm:users#1', columns: null }]);
        await new Promise(resolve => setTimeout(resolve, 10));

        // Postgres echoes the notification back to the sender; the node id is
        // what keeps it from becoming a second invalidation.
        expect(a.received).toEqual([{ key: 'orm:users#1', columns: null }]);

        await a.bus.stop();
    });

    test('publishLocal stays on this node', async () => {
        const broker = new FakeBroker();
        const a = node(broker, 'a');
        const b = node(broker, 'b');

        await a.bus.start();
        await b.bus.start();

        a.bus.publishLocal([{ key: 'orm:users#1', columns: null }]);
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(a.received).toHaveLength(1);
        expect(b.received).toHaveLength(0);

        await a.bus.stop();
        await b.bus.stop();
    });

    test('garbage on the channel is ignored', async () => {
        const broker = new FakeBroker();
        const a = node(broker, 'a');

        await a.bus.start();
        await broker.connection().notify('carno_test_bus', 'not json');
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(a.received).toHaveLength(0);

        await a.bus.stop();
    });
});
