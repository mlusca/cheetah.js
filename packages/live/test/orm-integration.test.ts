import { afterEach, describe, expect, test } from 'bun:test';
import { Entity, PrimaryKey, Property, BaseEntity, statementObserver, type Statement } from '../../orm/src';
import { withDatabase } from '../../orm/src/testing';
import { readDependencies, writeEvents } from '../src/emitters/statement-keys';
import { DEFAULT_LIVE_CONFIG } from '../src/config';

const TABLE_STATEMENTS = [
    'CREATE TABLE live_users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, last_seen_at TIMESTAMP NULL);'
];

@Entity({ tableName: 'live_users' })
class LiveUser extends BaseEntity<LiveUser> {
    @PrimaryKey()
    id!: number;

    @Property()
    name!: string;

    @Property({ nullable: true })
    lastSeenAt?: Date;
}

afterEach(() => {
    statementObserver.reset();
});

describe('statement keys against real ORM output', () => {
    test('a findOne by primary key yields a row dependency', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const reads: Statement<any>[] = [];
            statementObserver.onRead(statement => reads.push(statement));

            const created = await LiveUser.create({ name: 'Ada' });
            await LiveUser.findOne({ id: created.id });

            const select = reads.find(statement => statement.statement === 'select');
            expect(select).toBeDefined();

            const deps = readDependencies(select!, DEFAULT_LIVE_CONFIG.maxKeysPerRead);
            expect(deps[0].key).toBe(`orm:live_users#${created.id}`);
        });
    });

    test('a write emits the row key with the columns it wrote', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const writes: Statement<any>[] = [];
            statementObserver.onWrite(statement => writes.push(statement));

            const created = await LiveUser.create({ name: 'Ada' });
            await LiveUser.update({ id: created.id }, { name: 'Ada Lovelace' });

            const update = writes.find(statement => statement.statement === 'update');
            expect(update).toBeDefined();

            const events = writeEvents(update!, DEFAULT_LIVE_CONFIG.maxKeysPerRead);
            expect(events[0].key).toBe(`orm:live_users#${created.id}`);
            expect(events[0].columns).toContain('name');
        });
    });

    test('the generated column list normalizes to bare column names', async () => {
        await withDatabase(TABLE_STATEMENTS, async () => {
            const reads: Statement<any>[] = [];
            statementObserver.onRead(statement => reads.push(statement));

            await LiveUser.find({});

            const select = reads.find(statement => statement.statement === 'select');
            const deps = readDependencies(select!, DEFAULT_LIVE_CONFIG.maxKeysPerRead);

            expect(deps[0].key).toBe('orm:live_users');
            expect(deps[0].columns).toEqual(expect.arrayContaining(['id', 'name']));
        });
    });
});
