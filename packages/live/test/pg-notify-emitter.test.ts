import { describe, expect, test } from 'bun:test';
import {
    UnsafeIdentifierError,
    assertIdentifier,
    createFunctionSql,
    createTriggerSql,
    dropTriggerSql,
    triggerNameOf
} from '../src/emitters/pg-trigger-sql';
import { eventsFromPayload } from '../src/emitters/pg-notify-emitter';
import { DEFAULT_LIVE_CONFIG } from '../src/config';
import { AppEmitter } from '../src/emitters/AppEmitter';
import { InProcessBus } from '../src/bus/InProcessBus';
import { statementObserver } from '@carno.js/orm';
import type { InvalidationEvent } from '../src/graph/types';

describe('trigger SQL', () => {
    test('refuses an identifier that is not a bare name', () => {
        expect(() => assertIdentifier('table', 'users; DROP TABLE users')).toThrow(UnsafeIdentifierError);
        expect(() => assertIdentifier('table', 'public.users')).toThrow(UnsafeIdentifierError);
        expect(() => assertIdentifier('table', '"users"')).toThrow(UnsafeIdentifierError);
        expect(assertIdentifier('table', 'live_tasks')).toBe('live_tasks');
    });

    test('names the trigger after the table', () => {
        expect(triggerNameOf('live_tasks')).toBe('carno_live_live_tasks');
    });

    test('the trigger fires on every write and carries the key column', () => {
        const sql = createTriggerSql('live_tasks', 'id', 'carno_live');

        expect(sql).toContain('AFTER INSERT OR UPDATE OR DELETE ON live_tasks');
        expect(sql).toContain('FOR EACH ROW');
        expect(sql).toContain(`EXECUTE FUNCTION carno_live_notify('id', 'carno_live')`);
        expect(sql).toContain('DROP TRIGGER IF EXISTS carno_live_live_tasks ON live_tasks');
    });

    test('the function refuses to notify when an UPDATE changed nothing', () => {
        const sql = createFunctionSql(7000);

        expect(sql).toContain('IF changed IS NULL THEN');
        expect(sql).toContain('octet_length(payload) > 7000');
        expect(sql).toContain('PERFORM pg_notify(channel, payload)');
    });

    test('drop is idempotent', () => {
        expect(dropTriggerSql('live_tasks')).toBe(
            'DROP TRIGGER IF EXISTS carno_live_live_tasks ON live_tasks;'
        );
    });
});

describe('eventsFromPayload', () => {
    test('a row write becomes a row key with its columns', () => {
        expect(eventsFromPayload('{"t":"live_tasks","i":"42","c":["title"]}')).toEqual([
            { key: 'orm:live_tasks#42', columns: ['title'] }
        ]);
    });

    test('a write with no columns is a wildcard', () => {
        expect(eventsFromPayload('{"t":"live_tasks","i":"42","c":null}')).toEqual([
            { key: 'orm:live_tasks#42', columns: null }
        ]);
    });

    test('an empty column list is a wildcard, not an empty filter', () => {
        expect(eventsFromPayload('{"t":"live_tasks","i":"42","c":[]}')).toEqual([
            { key: 'orm:live_tasks#42', columns: null }
        ]);
    });

    test('a payload with no id degrades to the whole table', () => {
        expect(eventsFromPayload('{"t":"live_tasks","i":null,"c":null}')).toEqual([
            { key: 'orm:live_tasks', columns: null }
        ]);
    });

    test('garbage on the channel is ignored, not thrown', () => {
        expect(eventsFromPayload('not json')).toEqual([]);
        expect(eventsFromPayload('{"i":"42"}')).toEqual([]);
    });
});

describe('AppEmitter with a covered table', () => {
    test('does not publish writes announced by another emitter', () => {
        const bus = new InProcessBus();
        const published: InvalidationEvent[] = [];
        bus.subscribe(events => published.push(...events));

        const emitter = new AppEmitter(bus, DEFAULT_LIVE_CONFIG);
        emitter.setCoveredTables(['live_tasks']);
        emitter.attach();

        statementObserver.notifyWrite({
            statement: 'update',
            table: 'live_tasks',
            where: 'id = 1',
            values: { title: 'x' },
            primaryKeyColumnName: 'id'
        } as any);
        statementObserver.notifyWrite({
            statement: 'update',
            table: 'other_table',
            where: 'id = 1',
            values: { title: 'x' },
            primaryKeyColumnName: 'id'
        } as any);

        emitter.detach();

        expect(published).toEqual([{ key: 'orm:other_table#1', columns: ['title'] }]);
    });
});
