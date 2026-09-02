import { afterEach, describe, expect, test } from 'bun:test';
import { statementObserver, type Statement } from '@carno.js/orm';
import { AppEmitter, WriteDuringComputeError } from '../src/emitters/AppEmitter';
import { InProcessBus } from '../src/bus/InProcessBus';
import { DEFAULT_LIVE_CONFIG } from '../src/config';
import { dependencyContext } from '../src/resource/dependency-context';
import type { InvalidationEvent } from '../src/graph/types';

afterEach(() => {
    statementObserver.reset();
});

function statement(overrides: Partial<Statement<any>>): Statement<any> {
    return { table: 'users', alias: 'u', primaryKeyColumnName: 'id', ...overrides };
}

describe('InProcessBus', () => {
    test('delivers published events to every subscriber', () => {
        const bus = new InProcessBus();
        const seen: InvalidationEvent[][] = [];
        bus.subscribe(events => seen.push(events));
        bus.subscribe(events => seen.push(events));

        bus.publish([{ key: 'orm:users', columns: null }]);

        expect(seen).toHaveLength(2);
    });

    test('unsubscribe stops delivery', () => {
        const bus = new InProcessBus();
        let calls = 0;
        const off = bus.subscribe(() => { calls++; });

        bus.publish([{ key: 'a', columns: null }]);
        off();
        bus.publish([{ key: 'a', columns: null }]);

        expect(calls).toBe(1);
    });

    test('one failing subscriber does not stop the others', () => {
        const bus = new InProcessBus();
        let reached = false;
        bus.subscribe(() => { throw new Error('boom'); });
        bus.subscribe(() => { reached = true; });

        bus.publish([{ key: 'a', columns: null }]);

        expect(reached).toBe(true);
    });
});

describe('AppEmitter', () => {
    test('feeds reads into the active dependency collector', async () => {
        const emitter = new AppEmitter(new InProcessBus(), DEFAULT_LIVE_CONFIG);
        emitter.attach();

        const { deps } = await dependencyContext.run(() => {
            statementObserver.notifyRead(statement({ statement: 'select', where: 'u."id" = 42' }));
            return Promise.resolve(null);
        });

        expect(deps).toEqual([{ key: 'orm:users#42', columns: null }]);
    });

    test('drops reads that happen outside a compute', () => {
        const emitter = new AppEmitter(new InProcessBus(), DEFAULT_LIVE_CONFIG);
        emitter.attach();

        expect(() => statementObserver.notifyRead(statement({ statement: 'select' }))).not.toThrow();
    });

    test('publishes an invalidation for a write', () => {
        const bus = new InProcessBus();
        const seen: InvalidationEvent[][] = [];
        bus.subscribe(events => seen.push(events));
        new AppEmitter(bus, DEFAULT_LIVE_CONFIG).attach();

        statementObserver.notifyWrite(statement({ statement: 'update', where: 'u."id" = 7', values: { name: 'x' } }));

        expect(seen).toEqual([[{ key: 'orm:users#7', columns: ['name'] }]]);
    });

    test('refuses a write attempted during a compute', async () => {
        new AppEmitter(new InProcessBus(), DEFAULT_LIVE_CONFIG).attach();

        await dependencyContext.run(() => {
            expect(() => statementObserver.notifyWriteAttempt(statement({ statement: 'update' })))
                .toThrow(WriteDuringComputeError);
            return Promise.resolve(null);
        });
    });

    test('allows writes outside a compute', () => {
        new AppEmitter(new InProcessBus(), DEFAULT_LIVE_CONFIG).attach();

        expect(() => statementObserver.notifyWriteAttempt(statement({ statement: 'update' }))).not.toThrow();
    });

    test('detach unhooks the observer', () => {
        const bus = new InProcessBus();
        let calls = 0;
        bus.subscribe(() => { calls++; });
        const emitter = new AppEmitter(bus, DEFAULT_LIVE_CONFIG);

        emitter.attach();
        emitter.detach();
        statementObserver.notifyWrite(statement({ statement: 'update', values: { a: 1 } }));

        expect(calls).toBe(0);
    });
});
