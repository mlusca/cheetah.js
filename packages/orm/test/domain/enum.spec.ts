import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { execute, mockLogger, purgeDatabase, startDatabase } from '../node-database';
import { BaseEntity, Entity, PrimaryKey } from '../../src';
import { Enum } from '../../src/decorators/enum.decorator';

describe('entity with enum property', () => {

  beforeEach(async () => {
    await startDatabase();
    await execute(DLL);
  })

  afterEach(async () => {
    await purgeDatabase();
    (mockLogger as jest.Mock).mockClear();
  })

  const DLL = `
      CREATE TYPE "public_user_role_enum" AS ENUM ('admin', 'user');
      CREATE TABLE "public"."user" ("id" SERIAL PRIMARY KEY UNIQUE,"role" public_user_role_enum NOT NULL);
  `;

  enum Role {
    ADMIN = 'admin',
    USER = 'user',
  }

  @Entity()
  class User extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Enum(() => Role)
    role: Role;
  }

  it('When create with enum', async () => {
    Entity()(User);

    const user = await User.create({role: Role.USER, id: 1})

    expect(user.id).toBe(1)
    expect(user.role).toBe(Role.USER)
  })

  it('When find with enum', async () => {
    Entity()(User);

    await User.create({role: Role.USER, id: 1})
    const user = await User.findOne({id: 1})

    expect(user.id).toBe(1)
    expect(user.role).toBe(Role.USER)
  })
});