import { describe, expect, test } from 'bun:test';
import { withDatabase } from '../../orm/src/testing';
import { getDriverType } from '../../orm/src/driver/driver-factory';
import { PgNotifyEmitter } from '../src/emitters/pg-notify-emitter';
import type { InvalidationEvent } from '../src/graph/types';

const URL = process.env.CARNO_TEST_PG_URL
    ?? 'postgres://postgres:postgres@localhost:5433/postgres';

const TABLE_STATEMENTS = [
    'CREATE TABLE pg_notify_rows (id SERIAL PRIMARY KEY, title TEXT NOT NULL, note TEXT NULL);'
];

const describePostgres = getDriverType() === 'postgres' ? describe : describe.skip;

async function waitFor(events: InvalidationEvent[], count: number): Promise<void> {
    const deadline = Date.now() + 3000;

    while (events.length < count && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

describePostgres('PgNotifyEmitter against a real database', () => {
    test('a raw SQL write that never touched the ORM produces an invalidation', async () => {
        await withDatabase(TABLE_STATEMENTS, async ({ executeSql }) => {
            const received: InvalidationEvent[] = [];
            const emitter = new PgNotifyEmitter(events => received.push(...events), {
                tables: [{ table: 'pg_notify_rows', primaryKey: 'id' }],
                url: URL,
                execute: sql => executeSql(sql),
                channel: 'carno_live_test',
                heartbeatMs: 0
            });

            await emitter.attach();

            // No ORM, no entity, no repository: this is what a migration, a
            // psql session or a service in another language looks like.
            await executeSql(`INSERT INTO pg_notify_rows (title) VALUES ('first');`);
            await waitFor(received, 1);

            await executeSql(`UPDATE pg_notify_rows SET title = 'second' WHERE id = 1;`);
            await waitFor(received, 2);

            // An update that writes the same value must not wake anyone.
            await executeSql(`UPDATE pg_notify_rows SET title = 'second' WHERE id = 1;`);
            await new Promise(resolve => setTimeout(resolve, 300));

            await executeSql(`DELETE FROM pg_notify_rows WHERE id = 1;`);
            await waitFor(received, 3);

            await emitter.detach();

            expect(received).toEqual([
                { key: 'orm:pg_notify_rows#1', columns: null },
                { key: 'orm:pg_notify_rows#1', columns: ['title'] },
                { key: 'orm:pg_notify_rows#1', columns: null }
            ]);
        });
    });
});
