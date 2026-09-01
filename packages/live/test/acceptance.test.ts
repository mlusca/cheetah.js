import { afterEach, describe, expect, test } from 'bun:test';
import { BaseEntity, Entity, PrimaryKey, Property, statementObserver } from '../../orm/dist/index.js';
import { withDatabase } from '../../orm/dist/testing/with-database.js';
import { Controller, Get, Query } from '@carno.js/core';
import { createTestHarness } from '../../core/dist/testing/TestHarness.js';
import { Live } from '../src/decorators/Live';
import { LivePlugin } from '../src/LivePlugin';
import { resetLiveRuntime } from '../src/runtime';
import type { ServerMessage } from '../src/shared/protocol';

const TABLE_STATEMENTS = [
    'CREATE TABLE live_tasks (id SERIAL PRIMARY KEY, title TEXT NOT NULL, tenant TEXT NOT NULL, touched_at TIMESTAMP NULL);'
];

@Entity({ tableName: 'live_tasks' })
class Task extends BaseEntity<Task> {
    @PrimaryKey()
    id!: number;

    @Property()
    title!: string;

    @Property()
    tenant!: string;

    @Property({ nullable: true })
    touchedAt?: Date;
}

@Controller('/tasks')
class TasksController {
    @Get('/')
    @Live({ key: 'id', shared: 'public' })
    async list(@Query('tenant') tenant: string) {
        const tasks = await Task.find({ tenant }, { fields: ['id', 'title'] as any });
        return tasks.map(task => ({ id: task.id, title: task.title }));
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

    /** Wait for a message matching `predicate`, or fail after `timeoutMs`. */
    async wait(predicate: (message: ServerMessage) => boolean, timeoutMs = 2000): Promise<ServerMessage> {
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

afterEach(() => {
    statementObserver.reset();
    resetLiveRuntime();
});

describe('Live Resources acceptance', () => {
    test('an ORM write reaches a subscriber with no broadcast code (criteria 1, 4, 5)', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const harness = await createTestHarness({
                controllers: [TasksController],
                plugins: [LivePlugin.create({ controllers: [TasksController], config: { coalesceMs: 5 } })],
                listen: true
            });

            try {
                await Task.create({ title: 'first', tenant: 'acme' });

                const probe = await ProbeClient.connect(harness.port!);
                probe.send({ t: 'sub', sid: 'a', resource: 'TasksController.list', inputs: { params: {}, query: { tenant: 'acme' } } });

                const snapshot = await probe.wait(message => message.t === 'snapshot');
                expect((snapshot as any).data).toEqual([{ id: expect.any(Number), title: 'first' }]);

                // Criterion 1: nothing below mentions the socket.
                await Task.create({ title: 'second', tenant: 'acme' });

                const patch = await probe.wait(message => message.t === 'patch');

                // Criterion 4, by proxy: a keyed upsert, not a whole-array set.
                expect((patch as any).ops.every((op: any) => op.op === 'upsert' || op.op === 'order')).toBe(true);

                // Criterion 5: a write to a column the resource never selected.
                const before = probe.received.length;
                const [task] = await Task.find({ title: 'first' });
                await Task.update({ id: task.id }, { touchedAt: new Date() });
                await new Promise(resolve => setTimeout(resolve, 200));

                expect(probe.received.length).toBe(before);

                probe.close();
            } finally {
                await harness.close();
            }
        });
    });

    test('does not publish an uncommitted write that is later rolled back', async () => {
        await withDatabase(TABLE_STATEMENTS, async context => {
            const harness = await createTestHarness({
                controllers: [TasksController],
                plugins: [LivePlugin.create({ controllers: [TasksController], config: { coalesceMs: 5 } })],
                listen: true
            });

            let probe: ProbeClient | undefined;

            try {
                const task = await Task.create({ title: 'before transaction', tenant: 'acme' });
                probe = await ProbeClient.connect(harness.port!);
                probe.send({
                    t: 'sub',
                    sid: 'a',
                    resource: 'TasksController.list',
                    inputs: { params: {}, query: { tenant: 'acme' } }
                });
                await probe.wait(message => message.t === 'snapshot');

                let failureMessage = '';
                let patchBeforeRollback = false;

                try {
                    await context.orm.transaction(async () => {
                        await Task.update({ id: task.id }, { title: 'should be rolled back' });

                        // Keep the transaction open long enough for an eager
                        // invalidation implementation to recompute and publish.
                        await new Promise(resolve => setTimeout(resolve, 50));
                        patchBeforeRollback = probe!.received.some(message => message.t === 'patch');
                        throw new Error('rollback live write');
                    });
                } catch (error) {
                    failureMessage = (error as Error).message;
                }

                expect(failureMessage).toBe('rollback live write');
                expect(patchBeforeRollback).toBe(false);
                await new Promise(resolve => setTimeout(resolve, 50));
                expect(probe.received.some(message => message.t === 'patch')).toBe(false);

                const persisted = await context.executeSql(
                    `SELECT title FROM live_tasks WHERE id = ${task.id}`
                );
                expect(persisted.rows[0].title).toBe('before transaction');
            } finally {
                probe?.close();
                await harness.close();
            }
        });
    });

    test('publishes a transactional write only after commit', async () => {
        await withDatabase(TABLE_STATEMENTS, async context => {
            const harness = await createTestHarness({
                controllers: [TasksController],
                plugins: [LivePlugin.create({ controllers: [TasksController], config: { coalesceMs: 5 } })],
                listen: true
            });

            let probe: ProbeClient | undefined;

            try {
                const task = await Task.create({ title: 'before commit', tenant: 'acme' });
                probe = await ProbeClient.connect(harness.port!);
                probe.send({
                    t: 'sub',
                    sid: 'a',
                    resource: 'TasksController.list',
                    inputs: { params: {}, query: { tenant: 'acme' } }
                });
                await probe.wait(message => message.t === 'snapshot');

                let patchBeforeCommit = false;

                await context.orm.transaction(async () => {
                    await Task.update({ id: task.id }, { title: 'after commit' });
                    await new Promise(resolve => setTimeout(resolve, 50));
                    patchBeforeCommit = probe!.received.some(message => message.t === 'patch');
                });

                expect(patchBeforeCommit).toBe(false);
                const patch = await probe.wait(message => message.t === 'patch');
                expect((patch as any).ops).toEqual(expect.arrayContaining([
                    expect.objectContaining({ op: 'upsert' })
                ]));
            } finally {
                probe?.close();
                await harness.close();
            }
        });
    });

    test('resubscribing with the current hash retransmits nothing (criterion 3)', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const harness = await createTestHarness({
                controllers: [TasksController],
                plugins: [LivePlugin.create({ controllers: [TasksController], config: { coalesceMs: 5 } })],
                listen: true
            });

            try {
                await Task.create({ title: 'only', tenant: 'acme' });

                const first = await ProbeClient.connect(harness.port!);
                first.send({ t: 'sub', sid: 'a', resource: 'TasksController.list', inputs: { params: {}, query: { tenant: 'acme' } } });
                const snapshot = await first.wait(message => message.t === 'snapshot');
                first.close();

                const second = await ProbeClient.connect(harness.port!);
                second.send({
                    t: 'sub',
                    sid: 'a',
                    resource: 'TasksController.list',
                    inputs: { params: {}, query: { tenant: 'acme' } },
                    hash: (snapshot as any).hash
                });

                const current = await second.wait(message => message.t === 'current');
                expect((current as any).data).toBeUndefined();

                second.close();
            } finally {
                await harness.close();
            }
        });
    });

    test('the same route still answers plain JSON (criterion 6)', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const harness = await createTestHarness({
                controllers: [TasksController],
                plugins: [LivePlugin.create({ controllers: [TasksController] })],
                listen: true
            });

            try {
                await Task.create({ title: 'over http', tenant: 'acme' });

                const response = await harness.get('/tasks?tenant=acme');

                expect(response.status).toBe(200);
                expect(await response.json()).toEqual([{ id: expect.any(Number), title: 'over http' }]);
            } finally {
                await harness.close();
            }
        });
    });

    test('two tenants subscribing the same resource never share an instance (criterion 8)', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const harness = await createTestHarness({
                controllers: [TasksController],
                plugins: [LivePlugin.create({ controllers: [TasksController], config: { coalesceMs: 5 } })],
                listen: true
            });

            try {
                await Task.create({ title: 'acme-only', tenant: 'acme' });
                await Task.create({ title: 'globex-only', tenant: 'globex' });

                const acme = await ProbeClient.connect(harness.port!);
                const globex = await ProbeClient.connect(harness.port!);

                acme.send({ t: 'sub', sid: 'a', resource: 'TasksController.list', inputs: { params: {}, query: { tenant: 'acme' } } });
                globex.send({ t: 'sub', sid: 'a', resource: 'TasksController.list', inputs: { params: {}, query: { tenant: 'globex' } } });

                const acmeSnapshot = await acme.wait(message => message.t === 'snapshot');
                const globexSnapshot = await globex.wait(message => message.t === 'snapshot');

                expect((acmeSnapshot as any).data).toEqual([{ id: expect.any(Number), title: 'acme-only' }]);
                expect((globexSnapshot as any).data).toEqual([{ id: expect.any(Number), title: 'globex-only' }]);

                acme.close();
                globex.close();
            } finally {
                await harness.close();
            }
        });
    });
});
