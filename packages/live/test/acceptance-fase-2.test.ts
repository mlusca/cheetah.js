import { afterEach, describe, expect, test } from 'bun:test';
import { BaseEntity, Entity, PrimaryKey, Property, statementObserver } from '../../orm/dist/index.js';
import { withDatabase } from '../../orm/dist/testing/with-database.js';
import { Body, Controller, Get, Post, Query } from '@carno.js/core';
import { createTestHarness } from '../../core/dist/testing/TestHarness.js';
import { getDriverType } from '../../orm/src/driver/driver-factory';
import { Live } from '../src/decorators/Live';
import { LivePlugin } from '../src/LivePlugin';
import { closeLiveRuntime } from '../src/runtime';
import type { LiveAuthorizationRequest, LiveAuthorizer } from '../src/auth/authorizer';
import type { ServerMessage } from '../src/shared/protocol';

const TABLE_STATEMENTS = [
    'CREATE TABLE live2_cards (id SERIAL PRIMARY KEY, title TEXT NOT NULL, done BOOLEAN NOT NULL DEFAULT FALSE);'
];

@Entity({ tableName: 'live2_cards' })
class Card extends BaseEntity<Card> {
    @PrimaryKey()
    id!: number;

    @Property()
    title!: string;

    @Property()
    done!: boolean;
}

@Controller('/cards')
class CardsController {
    @Get('/')
    @Live({ key: 'id', shared: 'public' })
    async list(@Query('done') done?: string) {
        const cards = await Card.find(done === undefined ? {} : { done: done === 'true' });
        return cards.map(card => ({ id: card.id, title: card.title }));
    }

    @Post('/search')
    @Live({ key: 'id', shared: 'public' })
    async search(@Body() filter: { contains: string }) {
        const cards = await Card.find({});
        return cards
            .filter(card => card.title.includes(filter.contains))
            .map(card => ({ id: card.id, title: card.title }));
    }
}

class DenyEveryone implements LiveAuthorizer {
    authorize(request: LiveAuthorizationRequest): boolean {
        void request;
        return false;
    }
}

/** Minimal protocol client over a real WebSocket. */
class ProbeClient {
    private readonly socket: WebSocket;
    readonly received: ServerMessage[] = [];

    private constructor(socket: WebSocket) {
        this.socket = socket;
        socket.onmessage = event => this.received.push(JSON.parse(String(event.data)));
    }

    static connect(port: number): Promise<ProbeClient> {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(`ws://127.0.0.1:${port}/live`);
            socket.onopen = () => resolve(new ProbeClient(socket));
            socket.onerror = reject;
        });
    }

    send(message: unknown): void {
        this.socket.send(JSON.stringify(message));
    }

    close(): void {
        this.socket.close();
    }

    async wait(predicate: (message: ServerMessage) => boolean, timeoutMs = 4000): Promise<ServerMessage> {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            const found = this.received.find(predicate);

            if (found) {
                return found;
            }

            await new Promise(resolve => setTimeout(resolve, 10));
        }

        throw new Error(`Timed out. Received: ${JSON.stringify(this.received)}`);
    }
}

const describePostgres = getDriverType() === 'postgres' ? describe : describe.skip;

afterEach(async () => {
    statementObserver.reset();
    // Awaited, not fire-and-forget: the LISTEN socket has to be back in the
    // pool before the next test asks Postgres for another one.
    await closeLiveRuntime();
});

describePostgres('Live Resources phase 2 acceptance', () => {
    test('a write that never touched the application reaches the screen (criterion 2)', async () => {
        await withDatabase(TABLE_STATEMENTS, async ({ executeSql }) => {
            const harness = await createTestHarness({
                plugins: [LivePlugin.create({
                    controllers: [CardsController],
                    config: { coalesceMs: 5 },
                    pgNotify: {
                        tables: [{ table: 'live2_cards', primaryKey: 'id' }],
                        channel: 'carno_live_acceptance'
                    }
                })],
                listen: true
            });

            // The plugin installs the triggers from inside the WebSocket
            // builder, which is not awaited: give the DDL a moment to land.
            await new Promise(resolve => setTimeout(resolve, 500));

            const probe = await ProbeClient.connect(harness.port);
            probe.send({ t: 'hello', v: 1 });
            probe.send({ t: 'sub', sid: 's1', resource: 'CardsController.list', inputs: { params: {}, query: {} } });
            await probe.wait(message => message.t === 'snapshot');

            // No entity, no repository, no ORM: a migration or a psql session.
            await executeSql(`INSERT INTO live2_cards (title, done) VALUES ('from outside', false);`);

            const patch = await probe.wait(message => message.t === 'patch');

            probe.close();
            await harness.close();

            expect(patch).toMatchObject({ t: 'patch', sid: 's1' });
            expect(JSON.stringify((patch as { ops: unknown[] }).ops)).toContain('from outside');
        });
    });

    test('a live @Post() answers plain JSON and also updates over the socket', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const harness = await createTestHarness({
                plugins: [LivePlugin.create({
                    controllers: [CardsController],
                    config: { coalesceMs: 5 }
                })],
                listen: true
            });

            await Card.create({ title: 'alpha', done: false });

            // The same route, over plain HTTP, with no WebSocket in sight.
            const response = await fetch(`http://127.0.0.1:${harness.port}/cards/search`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ contains: 'alp' })
            });

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual([{ id: 1, title: 'alpha' }]);

            const probe = await ProbeClient.connect(harness.port);
            probe.send({ t: 'hello', v: 1 });
            probe.send({
                t: 'sub',
                sid: 's1',
                resource: 'CardsController.search',
                inputs: { params: {}, query: {}, body: { contains: 'alp' } }
            });

            const snapshot = await probe.wait(message => message.t === 'snapshot');
            expect((snapshot as { data: unknown }).data).toEqual([{ id: 1, title: 'alpha' }]);

            await Card.create({ title: 'alphabet', done: false });
            const patch = await probe.wait(message => message.t === 'patch');

            probe.close();
            await harness.close();

            expect(JSON.stringify((patch as { ops: unknown[] }).ops)).toContain('alphabet');
        });
    });

    test('two subscriptions with different bodies do not share an instance', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const harness = await createTestHarness({
                plugins: [LivePlugin.create({ controllers: [CardsController], config: { coalesceMs: 5 } })],
                listen: true
            });

            await Card.create({ title: 'alpha', done: false });
            await Card.create({ title: 'beta', done: false });

            const probe = await ProbeClient.connect(harness.port);
            probe.send({ t: 'hello', v: 1 });
            probe.send({
                t: 'sub',
                sid: 'a',
                resource: 'CardsController.search',
                inputs: { params: {}, query: {}, body: { contains: 'alp' } }
            });
            probe.send({
                t: 'sub',
                sid: 'b',
                resource: 'CardsController.search',
                inputs: { params: {}, query: {}, body: { contains: 'bet' } }
            });

            const first = await probe.wait(message => message.t === 'snapshot' && message.sid === 'a');
            const second = await probe.wait(message => message.t === 'snapshot' && message.sid === 'b');

            probe.close();
            await harness.close();

            expect((first as { data: unknown }).data).toEqual([{ id: 1, title: 'alpha' }]);
            expect((second as { data: unknown }).data).toEqual([{ id: 2, title: 'beta' }]);
        });
    });

    test('an unauthorized connection is told so and gets no data', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const harness = await createTestHarness({
                plugins: [LivePlugin.create({
                    controllers: [CardsController],
                    authorizer: new DenyEveryone(),
                    config: { coalesceMs: 5 }
                })],
                listen: true
            });

            const probe = await ProbeClient.connect(harness.port);
            probe.send({ t: 'hello', v: 1 });
            probe.send({ t: 'sub', sid: 's1', resource: 'CardsController.list', inputs: { params: {}, query: {} } });

            const error = await probe.wait(message => message.t === 'error');

            probe.close();
            await harness.close();

            expect(error).toMatchObject({ t: 'error', sid: 's1', code: 'forbidden' });
            expect(probe.received.some(message => message.t === 'snapshot')).toBe(false);
        });
    });
});
