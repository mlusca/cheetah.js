import { describe, expect, test } from 'bun:test';
import { PgListener, type ListenableSql } from '../src/emitters/pg-listener';

class FakeSql implements ListenableSql {
    readonly listened: string[] = [];
    readonly notified: { channel: string; payload: string }[] = [];
    readonly handlers = new Map<string, (payload: string) => void>();
    healthy = true;
    closed = false;

    async listen(channel: string, onNotify: (payload: string) => void): Promise<void> {
        this.listened.push(channel);
        this.handlers.set(channel, onNotify);
    }

    async notify(channel: string, payload = ''): Promise<void> {
        this.notified.push({ channel, payload });
    }

    async unsafe(): Promise<void> {
        if (!this.healthy) {
            throw new Error('connection lost');
        }
    }

    async close(): Promise<void> {
        this.closed = true;
    }

    emit(channel: string, payload: string): void {
        this.handlers.get(channel)?.(payload);
    }
}

function build() {
    const created: FakeSql[] = [];
    let reconnects = 0;
    const listener = new PgListener({
        url: 'postgres://ignored',
        heartbeatMs: 0,
        retryMs: 1,
        sqlFactory: () => {
            const sql = new FakeSql();
            created.push(sql);
            return sql;
        },
        onReconnect: () => {
            reconnects += 1;
        }
    });

    return { listener, created, reconnects: () => reconnects };
}

describe('PgListener', () => {
    test('subscribes the channel and delivers payloads', async () => {
        const { listener, created } = build();
        const seen: string[] = [];

        await listener.listen('carno_live', payload => seen.push(payload));
        created[0].emit('carno_live', '{"t":"users"}');

        expect(created[0].listened).toEqual(['carno_live']);
        expect(seen).toEqual(['{"t":"users"}']);

        await listener.close();
    });

    test('a second channel reuses the same connection', async () => {
        const { listener, created } = build();

        await listener.listen('one', () => {});
        await listener.listen('two', () => {});

        expect(created).toHaveLength(1);
        expect(created[0].listened).toEqual(['one', 'two']);

        await listener.close();
    });

    test('a dead connection is rebuilt and every channel is re-listened', async () => {
        const { listener, created, reconnects } = build();
        const seen: string[] = [];

        await listener.listen('carno_live', payload => seen.push(payload));
        created[0].healthy = false;

        await listener.check();

        expect(created).toHaveLength(2);
        expect(created[0].closed).toBe(true);
        expect(created[1].listened).toEqual(['carno_live']);
        expect(reconnects()).toBe(1);

        created[1].emit('carno_live', 'after');
        expect(seen).toEqual(['after']);

        await listener.close();
    });

    test('a healthy connection is left alone', async () => {
        const { listener, created, reconnects } = build();

        await listener.listen('carno_live', () => {});
        await listener.check();

        expect(created).toHaveLength(1);
        expect(reconnects()).toBe(0);

        await listener.close();
    });

    test('notify goes out on the same connection', async () => {
        const { listener, created } = build();

        await listener.notify('carno_bus', 'payload');

        expect(created[0].notified).toEqual([{ channel: 'carno_bus', payload: 'payload' }]);

        await listener.close();
    });

    test('close shuts the connection and stops reconnecting', async () => {
        const { listener, created } = build();

        await listener.listen('carno_live', () => {});
        await listener.close();

        expect(created[0].closed).toBe(true);

        await listener.check();
        expect(created).toHaveLength(1);
    });
});
