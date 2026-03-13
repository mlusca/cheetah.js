import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { app, execute, mockLogger, purgeDatabase, startDatabase } from '../node-database';
import {
  AfterCreate, AfterUpdate,
  BaseEntity,
  BeforeCreate,
  BeforeUpdate,
  Entity,
  expr,
  isUpdateExpression,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
} from '../../src';

describe('hooks', () => {

  beforeEach(async () => {
    await startDatabase();
    await execute(DLL);
    await execute(DDL_ADDRESS);
    await execute(DDL_STREET);
  })

  afterEach(async () => {
    await purgeDatabase();
    await app?.disconnect();
    (mockLogger as jest.Mock).mockClear();
  })

  const DLL = `
      CREATE TABLE "user"
      (
          "id"    SERIAL PRIMARY KEY,
          "email" varchar(255) NOT NULL
      );
  `;

  const DDL_ADDRESS = `
      CREATE TABLE "address"
      (
          "id"      SERIAL PRIMARY KEY,
          "address" varchar(255) NOT NULL,
          "user"    integer REFERENCES "user" ("id")
      );
  `;

  const DDL_STREET = `
      CREATE TABLE "street"
      (
          "id"      SERIAL PRIMARY KEY,
          "street"  varchar(255) NOT NULL,
          "address" integer REFERENCES "address" ("id")
      );
  `;

  const DDL_PLAYER = `
      CREATE TABLE "player"
      (
          "id" SERIAL PRIMARY KEY,
          "experience" integer NOT NULL
      );
  `;

  @Entity()
  class User extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    email: string;

    @OneToMany(() => Address, (address) => address.user)
    addresses: Address[];

    @BeforeCreate()
    onBeforeCreate() {
      this.id = 10
    }

    @BeforeUpdate()
    onBeforeUpdate() {
      this.email = 'otherEmail@test.com'
    }
  }

  @Entity({tableName: 'user'})
  class User2 extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    email: string;

    @OneToMany(() => Address, (address) => address.user)
    addresses: Address[];

    @AfterCreate()
    hook() {
      this.id = 10
    }

    @AfterUpdate()
    hook2() {
      this.email = 'AfterUpdate@test.com';
    }
  }

  @Entity()
  class Address extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    address: string;

    @ManyToOne(() => User)
    user: User;
  }

  @Entity()
  class Street extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    street: string;

    @ManyToOne(() => Address)
    address: Address;
  }

  let sawComputedExpressionInHook = false;

  @Entity()
  class Player extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    experience: number;

    @BeforeUpdate()
    normalizeComputedExperience() {
      if (isUpdateExpression(this.experience)) {
        sawComputedExpressionInHook = true;
      }
    }
  }

  it('beforeCreate', async () => {
    Entity()(User);

    const user = await User.create({email: 'test@test.com', id: 1})

    expect(user.id).toBe(10)
  })

  it('should  afterCreate', async () => {
    Entity({tableName: 'user'})(User2);

    const user = await User2.create({email: 'test@test.com', id: 1})

    expect(user.id).toBe(10)
  });

  it('should  beforeUpdate', async () => {
    Entity()(User);

    const user = await User.create({email: 'test@test.com', id: 1})
    expect(user.id).toBe(10)

    user.email = 'testUpdated@test.com'
    await user.save()
    expect(user.email).toBe('otherEmail@test.com')
  });

  it('should  afterUpdate', async () => {
    Entity({tableName: 'user'})(User2);

    const user = await User2.create({email: 'test@test.com', id: 1})
    expect(user.id).toBe(10)

    user.email = 'updateEmail@test.com';
    await user.save()
    expect(user.email).toBe('AfterUpdate@test.com');
  });

  it('should keep expr fields visible to beforeUpdate hooks in bulk updates', async () => {
    sawComputedExpressionInHook = false;
    await execute(DDL_PLAYER);

    await Player.create({
      id: 1,
      experience: 10,
    });

    await Player.update({ id: 1 }, {
      experience: expr((prev) => prev.plus(5)),
    });

    const updated = await Player.findOne({ id: 1 });

    expect(sawComputedExpressionInHook).toBe(true);
    expect(updated?.experience).toBe(15);
  });
});
