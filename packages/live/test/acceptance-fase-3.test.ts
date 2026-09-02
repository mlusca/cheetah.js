import { afterEach, describe, expect, test } from 'bun:test';
import { BaseEntity, Entity, PrimaryKey, Property, statementObserver } from '../../orm/dist/index.js';
import { withDatabase } from '../../orm/dist/testing/with-database.js';
import { Controller, Get } from '@carno.js/core';
import { createTestHarness } from '../../core/dist/testing/TestHarness.js';
import { getDriverType } from '../../orm/src/driver/driver-factory';
import { liveIsland } from '../../views/src/live-island';
import { Live } from '../src/decorators/Live';
import { LiveClient, type LiveSocket } from '../src/client/core';
import { LivePlugin } from '../src/LivePlugin';
import { closeLiveRuntime, getLiveRuntime } from '../src/runtime';
import { prefetchLive } from '../src/resource/prefetch';
import { toHydrateMap } from '../src/client/hydrate';
import type { ServerMessage } from '../src/shared/protocol';

const TABLE_STATEMENTS = [
    'CREATE TABLE live3_notes (id SERIAL PRIMARY KEY, body TEXT NOT NULL);'
];

@Entity({ tableName: 'live3_notes' })
class Note extends BaseEntity<Note> {
    @PrimaryKey()
    id!: number;

    @Property()
    body!: string;
}

@Controller('/notes')
class NotesController {
    @Get('/')
    @Live({ key: 'id', shared: 'public' })
    async list() {
        const notes = await Note.find({});
        return notes.map(note => ({ id: note.id, body: note.body }));
    }
}

const describePostgres = getDriverType() === 'postgres' ? describe : describe.skip;

afterEach(async () => {
    statementObserver.reset();
    await closeLiveRuntime();
});

function probeSocket() {
    const socket = {
        sent: [] as string[],
        received: [] as ServerMessage[],
        send(data: string) { socket.sent.push(data); },
        close() {},
        onopen: null as (() => void) | null,
        onmessage: null as ((event: { data: string }) => void) | null,
        onclose: null as (() => void) | null,
        onerror: null as ((error: unknown) => void) | null
    };

    return socket;
}

describePostgres('Live Resources phase 3 acceptance', () => {
    test('a views page renders server-side and only the subscribed island updates (criterion 7)', async () => {
        await withDatabase(TABLE_STATEMENTS, async ({ executeSql }) => {
            await executeSql(`INSERT INTO live3_notes (body) VALUES ('first');`);

            const harness = await createTestHarness({
                plugins: [LivePlugin.create({
                    controllers: [NotesController],
                    config: { coalesceMs: 5 }
                })],
                listen: true
            });

            // --- the server renders the page, island payload included -------
            const payload = await prefetchLive(getLiveRuntime().resources, 'NotesController.list');
            const page = [
                '<h1>Notes</h1>',
                '<div id="static">rendered once, never subscribed</div>',
                `<div id="island"></div>${liveIsland(payload)}`
            ].join('');

            expect(page).toContain('rendered once, never subscribed');
            expect(page).toContain('data-carno-live');
            expect(payload.data).toEqual([{ id: 1, body: 'first' }]);

            // --- the client picks the payload up, and starts full -----------
            const hydrate = toHydrateMap([JSON.parse(
                page.slice(page.indexOf('data-carno-live>') + 'data-carno-live>'.length, page.lastIndexOf('</script>'))
            )]);

            const socket = probeSocket();
            const client = new LiveClient({
                url: `ws://127.0.0.1:${harness.port}/live`,
                hydrate,
                socketFactory: () => socket as unknown as LiveSocket
            });

            const store = client.store('NotesController.list', { params: {}, query: {} });

            // No waterfall: the first paint has the data, not a spinner.
            expect(store.getSnapshot().pending).toBe(false);
            expect(store.getSnapshot().data).toEqual([{ id: 1, body: 'first' }]);

            store.subscribe(() => {});
            socket.onopen?.();

            const sub = JSON.parse(socket.sent.find(raw => raw.includes('"t":"sub"'))!);
            expect(sub.hash).toBe(payload.hash);

            await harness.close();
        });
    });

    test('an island subscribing over a real socket receives a patch, and the hash spares the first send', async () => {
        await withDatabase(TABLE_STATEMENTS, async ({ executeSql }) => {
            await executeSql(`INSERT INTO live3_notes (body) VALUES ('first');`);

            const harness = await createTestHarness({
                plugins: [LivePlugin.create({
                    controllers: [NotesController],
                    config: { coalesceMs: 5 }
                })],
                listen: true
            });

            const payload = await prefetchLive(getLiveRuntime().resources, 'NotesController.list');
            const received: ServerMessage[] = [];
            const socket = new WebSocket(`ws://127.0.0.1:${harness.port}/live`);

            await new Promise<void>(resolve => { socket.onopen = () => resolve(); });
            socket.onmessage = event => received.push(JSON.parse(String(event.data)));

            socket.send(JSON.stringify({ t: 'hello', v: 1 }));
            socket.send(JSON.stringify({
                t: 'sub',
                sid: 's1',
                resource: 'NotesController.list',
                inputs: { params: {}, query: {} },
                hash: payload.hash
            }));

            const wait = async (predicate: (message: ServerMessage) => boolean) => {
                const deadline = Date.now() + 4000;

                while (Date.now() < deadline) {
                    const found = received.find(predicate);
                    if (found) return found;
                    await new Promise(resolve => setTimeout(resolve, 10));
                }

                throw new Error(`timed out. Received: ${JSON.stringify(received)}`);
            };

            // The screen already holds this content, so nothing is sent.
            const current = await wait(message => message.t === 'current');
            expect(current).toMatchObject({ t: 'current', sid: 's1' });
            expect(received.some(message => message.t === 'snapshot')).toBe(false);

            await Note.create({ body: 'second' });

            const patch = await wait(message => message.t === 'patch');
            expect(patch).toMatchObject({ t: 'patch', sid: 's1' });

            socket.close();
            await harness.close();
        });
    });

    test('an ORM update reaches a liveSignal, closing the Angular half of criterion 1', async () => {
        await withDatabase(TABLE_STATEMENTS, async ({ executeSql }) => {
            await executeSql(`INSERT INTO live3_notes (body) VALUES ('first');`);

            const { Injector, runInInjectionContext } = await import('@angular/core');
            const { liveSignal, provideLive, reconcileLiveSignal } = await import('../src/client/angular');

            const harness = await createTestHarness({
                plugins: [LivePlugin.create({
                    controllers: [NotesController],
                    config: { coalesceMs: 5 }
                })],
                listen: true
            });

            const client = new LiveClient({ url: `ws://127.0.0.1:${harness.port}/live` });
            const injector = Injector.create({ providers: [provideLive(client)] });

            const state = runInInjectionContext(injector, () => liveSignal<{ id: number; body: string }[]>(
                'NotesController.list'
            ));
            reconcileLiveSignal(state);

            const settle = async (predicate: () => boolean) => {
                const deadline = Date.now() + 4000;

                while (Date.now() < deadline) {
                    if (predicate()) return;
                    await new Promise(resolve => setTimeout(resolve, 20));
                }

                throw new Error(`timed out. Last state: ${JSON.stringify(state())}`);
            };

            await settle(() => state().data?.length === 1);

            // No broadcast code anywhere: an ordinary repository write.
            await Note.create({ body: 'second' });

            await settle(() => state().data?.length === 2);
            expect(state().data?.map(note => note.body)).toEqual(['first', 'second']);

            injector.destroy();
            client.close();
            await harness.close();
        });
    });
});
