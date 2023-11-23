import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { BaseEntity, Entity, ManyToOne, OneToMany, PrimaryKey, Property } from '../../src';
import { execute, mockLogger, purgeDatabase, startDatabase } from '../node-database';

describe('Relationship entities', () => {

  beforeEach(async () => {
    await startDatabase();
    await execute(DLL);
    await execute(DDL_ADDRESS);
    await execute(DDL_STREET);
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

  @Entity()
  class User extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    email: string;

    @OneToMany(() => Address, (address) => address.user)
    addresses: Address[];
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

  it('should create a new user with address', async () => {

    Entity()(User)
    Entity()(Address)
    Entity()(Street)

    const user = new User();
    user.email = 'test@test.com';
    user.id = 1;
    await user.save();

    const address = await Address.create({
      id: 1,
      address: 'test address',
      user,
    })
    const street = await Street.create({
      id: 1,
      street: 'test street',
      address,
    })

    const find = await Street.find({
      address: {
        user: {
          id: 1,
        }
      }
    });

    const findWithLoadSelect = await Street.find({
      address: {
        user: {
          id: 1,
        }
      }
    }, {
      loadStrategy: 'select'
    });

    expect(find).toHaveLength(1);
    expect(find[0].id).toBe(1);
    expect(find[0].street).toBe('test street');
    expect(find[0].address).toBeInstanceOf(Address);
    expect(find[0].address.user).toBeInstanceOf(User);
    expect(find[0].address.user.email).toBe('test@test.com');
    expect(findWithLoadSelect).toHaveLength(1);
    expect(findWithLoadSelect[0].id).toBe(1);
    expect(findWithLoadSelect[0].street).toBe('test street');
    expect(findWithLoadSelect[0].address).toBeInstanceOf(Address);
    expect(findWithLoadSelect[0].address.user).toBeInstanceOf(User);
    expect(findWithLoadSelect[0].address.user.email).toBe('test@test.com');
    expect(mockLogger).toHaveBeenCalledTimes(7)
    expect((mockLogger as jest.Mock).mock.calls[3][0]).toStartWith("SQL: SELECT s1.\"id\" as \"s1_id\", s1.\"street\" as \"s1_street\", s1.\"address\" as \"s1_address\", u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\", a1.\"id\" as \"a1_id\", a1.\"address\" as \"a1_address\", a1.\"user\" as \"a1_user\" FROM \"public\".\"street\" s1 LEFT JOIN public.address a1 ON s1.\"address\" = a1.\"id\" LEFT JOIN public.user u1 ON a1.\"user\" = u1.\"id\" WHERE (((u1.id = 1)))");
  });

  it('should load relationship', async () => {

    Entity()(User)
    Entity()(Address)
    Entity()(Street)

    const user = new User();
    user.email = 'test@test.com';
    user.id = 1;
    await user.save();

    const address = await Address.create({
      id: 1,
      address: 'test address',
      user,
    })
    await Street.create({
      id: 1,
      street: 'test street',
      address,
    })

    const find = await Street.findOneOrFail({}, {
      load: ['address', 'address.user'],
    });
    const find2 = await Street.findOneOrFail({}, {
      load: ['address', 'address.user'],
      loadStrategy: 'select',
    });

    expect(find).toBeInstanceOf(Street);
    expect(find.id).toBe(find2.id);
    expect(find.street).toBe(find2.street);
    expect(find.address.id).toBe(find2.address.id);
    expect(find.address.user.id).toBe(find2.address.user.id);
  });
});