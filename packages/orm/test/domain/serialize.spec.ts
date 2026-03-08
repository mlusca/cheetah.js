import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { app, execute, mockLogger, purgeDatabase, startDatabase } from '../node-database';
import { BaseEntity, Entity, ManyToOne, OneToMany, PrimaryKey, Property } from '../../src';
import { EntityStorage } from '../../src/domain/entities';

describe('serialize', () => {
  beforeEach(async () => {
    EntityStorage.getInstance()?.['entities']?.clear?.();
    await startDatabase();
    await execute(DLL);
    await execute(DDL_CUSTOMER);
    await execute(DDL_LOCATION);
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

  const DDL_CUSTOMER = `
      CREATE TABLE "customer"
      (
          "id"    SERIAL PRIMARY KEY,
          "name"  varchar(255) NOT NULL
      );
  `;

  const DDL_LOCATION = `
      CREATE TABLE "location"
      (
          "id"          SERIAL PRIMARY KEY,
          "street"      varchar(255) NOT NULL,
          "customer_id" integer REFERENCES "customer" ("id")
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

  @Entity()
  class Customer extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    name: string;

    @OneToMany(() => Location, (location) => location.customer)
    locations: Location[];
  }

  @Entity()
  class Location extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    street: string;

    @ManyToOne(() => Customer)
    customer: Customer;
  }

  @Entity()
  class PlainDecoratedUser {
    @PrimaryKey()
    id: number;

    @Property({ hidden: true })
    secret: string;
  }

  it('should serialize', async () => {
    Entity()(User);

    const user = new User();
    user.email = 'test@test.com';
    user.id = 1;

    expect(JSON.stringify(user)).toEqual('{"id":1}')
  });

  it('should only install rich toJSON for classes decorated with Entity', async () => {
    const decorated = new PlainDecoratedUser();
    decorated.id = 7;
    decorated.secret = 'classified';

    class PlainUndecoratedUser {
      id: number;
      secret: string;
    }

    const plain = new PlainUndecoratedUser();
    plain.id = 7;
    plain.secret = 'classified';

    expect(JSON.stringify(decorated)).toEqual('{"id":7}');
    expect(JSON.stringify(plain)).toEqual('{"id":7,"secret":"classified"}');
  });

  it('should serialize loaded many-to-one relation payloads', async () => {
    Entity()(Customer);
    Entity()(Location);

    const customer = await Customer.create({
      id: 1,
      name: 'Acme Corp',
    });

    await Location.create({
      id: 1,
      street: 'Main St',
      customer,
    });

    const location = await Location.findOneOrFail({ id: 1 }, { load: ['customer'] });
    const serialized = JSON.parse(JSON.stringify(location));

    expect(serialized).toEqual({
      id: 1,
      street: 'Main St',
      customer: {
        id: 1,
        name: 'Acme Corp',
      },
    });
  });

  it('should serialize loaded one-to-many relation payloads', async () => {
    Entity()(Customer);
    Entity()(Location);

    const customer = await Customer.create({
      id: 2,
      name: 'Globex',
    });

    await Location.create({ id: 2, street: '1st Ave', customer });
    await Location.create({ id: 3, street: '2nd Ave', customer });

    const loadedCustomer = await Customer.findOneOrFail({ id: 2 }, { load: ['locations'] });
    const serialized = JSON.parse(JSON.stringify(loadedCustomer));

    expect(serialized).toEqual({
      id: 2,
      name: 'Globex',
      locations: [
        { id: 2, street: '1st Ave', customer: 2 },
        { id: 3, street: '2nd Ave', customer: 2 },
      ],
    });
  });
});
