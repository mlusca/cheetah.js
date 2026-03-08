import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { app, execute, purgeDatabase, startDatabase } from '../node-database';
import { BaseEntity, Entity, PrimaryKey, Property } from '../../src';

const DDL_USER_TEAM_SLOT = `
  CREATE TABLE "user_team_slot" (
    "id" integer PRIMARY KEY,
    "formation_column" integer NOT NULL DEFAULT 99,
    "label" varchar(255) NOT NULL
  );
`;

@Entity({ tableName: 'user_team_slot' })
class UserTeamSlot extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property({ columnName: 'formation_column' })
  formationColumn: number;

  @Property()
  label: string;
}

describe('New entity save() with explicit values and repeated save', () => {
  beforeEach(async () => {
    await startDatabase();
    await execute(DDL_USER_TEAM_SLOT);
  });

  afterEach(async () => {
    await purgeDatabase();
    await app?.disconnect();
  });

  test('should persist the explicit formationColumn on the first save of a new entity', async () => {
    const slot = new UserTeamSlot();
    slot.id = 1;
    slot.formationColumn = 7;
    slot.label = 'Starter';

    await slot.save();

    const rows = await execute(`
      SELECT "id", "formation_column", "label"
      FROM "user_team_slot"
      WHERE "id" = 1
    `);

    expect(rows.rows).toHaveLength(1);
    expect((rows.rows[0] as any).formation_column).toBe(7);
    expect((rows.rows[0] as any).label).toBe('Starter');
  });

  
  test('should update the same in-memory entity on a second save instead of inserting again', async () => {
    const slot = new UserTeamSlot();
    slot.id = 1;
    slot.formationColumn = 7;
    slot.label = 'Starter';

    expect(slot.isPersisted()).toBe(false);
    await slot.save();
    expect(slot.isPersisted()).toBe(true);

    slot.formationColumn = 3;
    slot.label = 'Updated starter';

    await slot.save();
    expect(slot.isPersisted()).toBe(true);

    const rows = await execute(`
      SELECT "id", "formation_column", "label"
      FROM "user_team_slot"
      WHERE "id" = 1
    `);

    expect(rows.rows).toHaveLength(1);
    expect((rows.rows[0] as any).formation_column).toBe(3);
    expect((rows.rows[0] as any).label).toBe('Updated starter');
  });
});
