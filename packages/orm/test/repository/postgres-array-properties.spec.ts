import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import { getDriverType } from '../../src/driver/driver-factory';
import { BaseEntity, Entity, PrimaryKey, Property } from '../../src';

@Entity()
class PgArrayPost extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  title: string;

  @Property()
  tags: string[] = [];

  @Property({ dbType: 'jsonb' })
  metadata: string[] = [];
}

describe('PostgreSQL array properties', () => {
  beforeEach(async () => {
    await startDatabase();

    if (getDriverType() !== 'postgres') {
      return;
    }

    await execute(`
      CREATE TABLE "pg_array_post" (
        "id" SERIAL PRIMARY KEY,
        "title" varchar(255) NOT NULL,
        "tags" text[] NOT NULL,
        "metadata" jsonb NOT NULL
      );
    `);
  });

  afterEach(async () => {
    await purgeDatabase();
    await app?.disconnect();
  });

  test('inserts and updates native text arrays without JSON array literals', async () => {
    if (getDriverType() !== 'postgres') {
      return;
    }

    const empty = await PgArrayPost.create({
      title: 'Empty',
      tags: [],
      metadata: [],
    });

    expect(empty.tags).toEqual([]);
    expect(empty.metadata).toEqual([]);

    const withValues = await PgArrayPost.create({
      title: 'Escaped',
      tags: ['alpha', 'with,comma', 'quote " ok', "single ' ok", 'slash \\ ok'],
      metadata: ['json', 'still-jsonb'],
    });

    expect(withValues.tags).toEqual([
      'alpha',
      'with,comma',
      'quote " ok',
      "single ' ok",
      'slash \\ ok',
    ]);
    expect(withValues.metadata).toEqual(['json', 'still-jsonb']);

    await PgArrayPost.update({ id: withValues.id }, { tags: ['updated', 'middle'] });
    const updated = await PgArrayPost.findOne({ id: withValues.id });

    expect(updated?.tags).toEqual(['updated', 'middle']);
  });

  test('bulk inserts native text arrays', async () => {
    if (getDriverType() !== 'postgres') {
      return;
    }

    const inserted = await PgArrayPost.createMany([
      { title: 'One', tags: [], metadata: [] },
      { title: 'Two', tags: ['a', 'b'], metadata: ['json'] },
    ]);

    expect(inserted).toHaveLength(2);
    expect(inserted[0].tags).toEqual([]);
    expect(inserted[1].tags).toEqual(['a', 'b']);
    expect(inserted[1].metadata).toEqual(['json']);
  });
});
