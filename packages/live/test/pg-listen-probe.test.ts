import { describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { getDriverType } from '../../orm/src/driver/driver-factory';

const URL = process.env.CARNO_TEST_PG_URL
    ?? 'postgres://postgres:postgres@localhost:5433/postgres';

const describePostgres = getDriverType() === 'postgres' ? describe : describe.skip;

describePostgres('Bun LISTEN/NOTIFY', () => {
    test('a notification sent on one connection arrives on the listening one', async () => {
        const listener = new SQL({ url: URL, max: 1 }) as any;
        const writer = new SQL({ url: URL, max: 1 }) as any;
        const received: string[] = [];

        expect(typeof listener.listen).toBe('function');
        expect(typeof writer.notify).toBe('function');

        await listener.listen('carno_probe', (payload: string) => {
            received.push(payload);
        });
        await writer.notify('carno_probe', 'hello');

        const deadline = Date.now() + 3000;

        while (received.length === 0 && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        await listener.close();
        await writer.close();

        expect(received).toEqual(['hello']);
    });
});

describePostgres('PgListener against a real database', () => {
    test('delivers a notification through the listener', async () => {
        const { PgListener } = await import('../src/emitters/pg-listener');
        const listener = new PgListener({ url: URL, heartbeatMs: 0 });
        const seen: string[] = [];

        await listener.listen('carno_probe_listener', payload => seen.push(payload));
        await listener.notify('carno_probe_listener', '{"t":"users","i":"7"}');

        const deadline = Date.now() + 3000;

        while (seen.length === 0 && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        await listener.close();

        expect(seen).toEqual(['{"t":"users","i":"7"}']);
    });
});
