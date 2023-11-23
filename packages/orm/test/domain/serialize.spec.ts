import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { execute, mockLogger, purgeDatabase, startDatabase } from '../node-database';
import { BaseEntity, Entity, PrimaryKey, Property } from '../../src';

describe('serialize', () => {
  beforeEach(async () => {
    await startDatabase();
    await execute(DLL);
  })

  afterEach(async () => {
    await purgeDatabase();
    (mockLogger as jest.Mock).mockClear();
  })

  const DLL = `
      CREATE TABLE "user"
      (
          "id"    SERIAL PRIMARY KEY,
          "email" varchar(255) NOT NULL
      );
  `;

  @Entity()
  class User extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property({ hidden: true })
    email: string;

    propertyHidden = 'propertyHidden';
  }

  it('should serialize', async () => {
    Entity()(User);

    const user = new User();
    user.email = 'test@test.com';
    user.id = 1;

    expect(JSON.stringify(user)).toEqual('{"id":1}')
  });
});
