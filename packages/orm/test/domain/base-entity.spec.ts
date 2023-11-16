import { afterEach, beforeEach, describe, expect, jest, test, setSystemTime } from 'bun:test'
import { app, execute, mockLogger, purgeDatabase, startDatabase } from '../node-database';
import { BaseEntity, Entity, OneToMany, PrimaryKey, Property } from '../../src';

@Entity()
class UserTest extends BaseEntity {
  @PrimaryKey()
  id: number;

  @Property()
  createdAt: Date = new Date();

  @Property({onUpdate: () => new Date()})
  updatedAt: Date;
}

describe('Creation, update and deletion of entities', () => {

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

    @Property()
    user: number;
  }

  beforeEach(async () => {
    await startDatabase();
    await execute(DLL);
  })

  afterEach(async () => {
    await purgeDatabase();
    (mockLogger as jest.Mock).mockClear();
  })


  test('should create a entity', async () => {
    const user = await User.create({
      email: 'test@test.com',
      id: 1,
    })
    const result = await execute(`SELECT *
                                  FROM "user"
                                  WHERE id = '1';`);

    expect(result.rows[0]).toEqual({
      id: 1,
      email: 'test@test.com',
    });

    expect(user).toBeInstanceOf(User);
    expect(mockLogger).toHaveBeenCalledTimes(1);
    expect((mockLogger as jest.Mock).mock.calls[0][0]).toStartWith("SQL: INSERT INTO \"public\".\"user\" (\"email\", \"id\") VALUES ('test@test.com', 1) RETURNING \"id\" as \"u1_id\", \"email\" as \"u1_email\" ");
  });

  test('should create a entity by new instance', async () => {
    const user = new User();
    user.email = 'test@test.com';
    user.id = 1;
    await user.save();

    const result = await execute(`SELECT *
                                  FROM "user"
                                  WHERE id = '1';`);

    expect(result.rows[0]).toEqual({
      id: 1,
      email: 'test@test.com',
    });

    expect(user).toBeInstanceOf(User);
    expect(mockLogger).toHaveBeenCalledTimes(1);
    expect((mockLogger as jest.Mock).mock.calls[0][0]).toStartWith("SQL: INSERT INTO \"public\".\"user\" (\"email\", \"id\") VALUES ('test@test.com', 1) RETURNING \"id\" as \"u1_id\", \"email\" as \"u1_email\" ");
  });

  test('should a find a entity', async () => {
    const user = await User.create({
      email: 'test@test.com',
      id: 1,
    })

    const result = await User.findOne({id: 1});

    expect(result).toBeInstanceOf(User);
    expect(result).toEqual(user!);
    expect(mockLogger).toHaveBeenCalledTimes(2);
    expect((mockLogger as jest.Mock).mock.calls[1][0]).toStartWith("SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (u1.id = 1) LIMIT 1");
  });

  test('should a update a entity', async () => {
    const user = await User.create({
      email: 'test@test.com',
      id: 1,
    })
    user!.email = 'updated@test.com';
    await user!.save();

    const result = await User.findOne({id: 1});
    expect(result!.email).toEqual('updated@test.com')
    expect(mockLogger).toHaveBeenCalledTimes(3);
    expect((mockLogger as jest.Mock).mock.calls[1][0]).toStartWith("SQL: UPDATE public.user as u1 SET email = 'updated@test.com' WHERE (u1.id = 1)");
  });

  test('should a find relationship', async () => {
    await execute(DDL_ADDRESS);
    const user = await User.create({
      email: 'test@test.com',
      id: 1,
    });
    const address = await Address.create({
      address: 'Street 1',
      user: user.id,
      id: 1,
    });

    const result = await User.findOne({
      addresses: {
        id: 1,
      },
    })

    expect(result).toBeInstanceOf(User);
    expect(result!.addresses).toBeInstanceOf(Array);
    expect(result!.addresses[0]).toEqual(address);
  })

  test('when findOrFail but not found, throw error', async () => {
    expect(async () => {
      await User.findOneOrFail({id: 1})
    }).toThrow()
    expect(mockLogger).toHaveBeenCalledTimes(1);
    expect((mockLogger as jest.Mock).mock.calls[0][0]).toStartWith("SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (u1.id = 1) LIMIT 1");
  })

  test('When create a entity, return the created entity', async () => {
    const id = 1;
    const email = 'test@test.com';

    const user = await User.create({
      email,
      id,
    });

    expect(user).toBeInstanceOf(User);
    expect(user.id).toEqual(id);
    expect(user.email).toEqual(email);
  })

  test('When search with $eq operator', async () => {
    const id = 1;
    const email = 'test@test.com';

    await User.create({
      email,
      id,
    });

    const user = await User.findOneOrFail({
      id: {
        $eq: id,
      },
      email: email,
    });

    expect(user).toBeInstanceOf(User);
    expect(user.id).toEqual(id);
    expect(user.email).toEqual(email);
    expect(mockLogger).toHaveBeenCalledTimes(2);
    expect((mockLogger as jest.Mock).mock.calls[1][0]).toStartWith("SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (u1.id = 1 AND u1.email = 'test@test.com') LIMIT 1");
  });

  test('When search with $ne operator', async () => {
    const id = 1;
    const email = 'test@test.com';

    await User.create({
      email,
      id,
    });

    const user = await User.findOneOrFail({
      id: {
        $ne: 2,
      },
      email: email,
    });

    expect(user).toBeInstanceOf(User);
    expect(user.id).toEqual(id);
    expect(user.email).toEqual(email);
    expect(mockLogger).toHaveBeenCalledTimes(2);
    expect((mockLogger as jest.Mock).mock.calls[1][0]).toStartWith("SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (u1.id != 2 AND u1.email = 'test@test.com') LIMIT 1");
  });

  test('When search with $gt and $lt operator', async () => {
    const id = 1;
    const email = 'test@test.com';

    await User.create({
      email,
      id,
    });

    const user = await User.findOneOrFail({
      id: {
        $gt: 0,
        $lt: 2,
      },
    });

    expect(user).toBeInstanceOf(User);
    expect(user.id).toEqual(id);
    expect(user.email).toEqual(email);
    expect(mockLogger).toHaveBeenCalledTimes(2);
    expect((mockLogger as jest.Mock).mock.calls[1][0]).toStartWith("SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (u1.id > 0 AND u1.id < 2) LIMIT 1");
  });

  test('When search with $gte and $lte operator', async () => {
    const id = 1;
    const email = 'test@test.com';

    await User.create({
      email,
      id,
    });

    const user = await User.findOneOrFail({
      id: {
        $gte: 1,
        $lte: 1,
      },
    });

    expect(user).toBeInstanceOf(User);
    expect(user.id).toEqual(id);
    expect(user.email).toEqual(email);
    expect(mockLogger).toHaveBeenCalledTimes(2);
    expect((mockLogger as jest.Mock).mock.calls[1][0]).toStartWith("SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (u1.id >= 1 AND u1.id <= 1) LIMIT 1");
  });

  test('When search with $in operator', async () => {
    const user = await createUser();

    const result = await User.findOneOrFail({
      id: {
        $in: [1, 2],
      },
    });

    expect(result).toEqual(user);
    expect(mockLogger).toHaveBeenCalledTimes(2);
    expect((mockLogger as jest.Mock).mock.calls[1][0]).toStartWith("SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (u1.id IN (1, 2)) LIMIT 1");
  });

  test('When search with $nin operator', async () => {
    const user = await createUser();

    const result = await User.findOneOrFail({
      id: {
        $nin: [2],
      },
    });

    expect(result).toEqual(user);
    expect(mockLogger).toHaveBeenCalledTimes(2);
    expect((mockLogger as jest.Mock).mock.calls[1][0]).toStartWith("SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (u1.id NOT IN (2)) LIMIT 1");
  });

  test('When search with $or operator', async () => {
    const user = await createUser();

    const result = await User.findOneOrFail({
      $or: [
        {id: 1},
        {email: 'test_error@test.com'},
        ]
    });

    expect(result).toEqual(user);
    expect(mockLogger).toHaveBeenCalledTimes(2);
    expect((mockLogger as jest.Mock).mock.calls[1][0]).toStartWith("SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (((u1.id = 1) OR (u1.email = 'test_error@test.com'))) LIMIT 1");
  });

  test('When search with $and operator', async () => {
    const user = await createUser();

    const result = await User.findOneOrFail({
      $and: [
        {id: 1},
        {email: 'test@test.com'},
      ]
    });

    expect(result).toEqual(user);
    expect(mockLogger).toHaveBeenCalledTimes(2);
    expect((mockLogger as jest.Mock).mock.calls[1][0]).toStartWith("SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (((u1.id = 1) AND (u1.email = 'test@test.com'))) LIMIT 1");
  });

  test('When find all', async () => {
    const user = await createUser();

    const result = await User.findAll({});

    expect(result).toEqual([user]);
    expect(mockLogger).toHaveBeenCalledTimes(2);
    expect((mockLogger as jest.Mock).mock.calls[1][0]).toStartWith("SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1");
  });

  test('When find with columns defined', async () => {
    await execute(DDL_ADDRESS)
    const user = await createUser();
    const address = await Address.create({
      address: 'Street 1',
      user: user.id,
      id: 1,
    });

    const result = await User.findOneOrFail({
      addresses: {
        id: 1
      }
    },{fields: ['id', 'addresses.id']});

    expect(result.id).toEqual(user.id);
    expect(result.email).toBeUndefined();
    expect(result.addresses[0].id).toEqual(address.id);
    expect(result.addresses[0].address).toBeUndefined();
    expect(mockLogger).toHaveBeenCalledTimes(3);
    expect((mockLogger as jest.Mock).mock.calls[2][0]).toStartWith("SQL: SELECT u1.\"id\" as u1_id, a1.\"id\" as a1_id FROM \"public\".\"user\" u1 LEFT JOIN public.address a1 ON a1.user = u1.id WHERE ((a1.id = 1)) LIMIT 1");
  })

  test('When find with orderBy defined', async () => {
    await execute(DDL_ADDRESS)
    const user = await createUser();
    const address = await Address.create({
      address: 'Street 1',
      user: user.id,
      id: 1,
    });

    const result = await User.findOneOrFail({
      addresses: {
        id: 1
      }
    },{fields: ['id', 'addresses.id'], orderBy: {id: 'DESC', addresses: {address: 'DESC'}}});

    expect(result.id).toEqual(user.id);
    expect(mockLogger).toHaveBeenCalledTimes(3);
    expect((mockLogger as jest.Mock).mock.calls[2][0]).toStartWith("SQL: SELECT u1.\"id\" as u1_id, a1.\"id\" as a1_id FROM \"public\".\"user\" u1 LEFT JOIN public.address a1 ON a1.user = u1.id WHERE ((a1.id = 1)) ORDER BY u1.\"id\" DESC, a1.\"address\" DESC LIMIT 1");
  })

  test('When find with limit defined', async () => {
    const user = await createUser();


    const result = await User.find({},{
      fields: ['id'],
      limit: 1,
    });

    expect(result.length).toEqual(1)
    expect(result[0].id).toEqual(user.id);
    expect(mockLogger).toHaveBeenCalledTimes(2);
    expect((mockLogger as jest.Mock).mock.calls[1][0]).toStartWith("SQL: SELECT u1.\"id\" as u1_id FROM \"public\".\"user\" u1 LIMIT 1");
  })

  test('When find with offset defined', async () => {
    await createUser();
    const user2 = await User.create({
      email: 'test2@test.com',
      id: 2,
    });

    const result = await User.find({},{
      fields: ['id'],
      offset: 1,
      limit: 1,
      orderBy: {id: 'ASC'}
    });

    expect(result[0].id).toEqual(user2.id);
    expect(mockLogger).toHaveBeenCalledTimes(3);
    expect((mockLogger as jest.Mock).mock.calls[2][0]).toStartWith("SQL: SELECT u1.\"id\" as u1_id FROM \"public\".\"user\" u1 ORDER BY u1.\"id\" ASC OFFSET 1 LIMIT 1");
  })

  test('When use a querybuilder', async() => {
    const created = await app.createQueryBuilder<User>(User)
      .insert({id: 1, email: 'test@test.com'})
      .executeAndReturnFirst()

    expect(created).toBeInstanceOf(User);
    expect(created!.id).toEqual(1);
  })

  test('When have update column and default column', async() => {
    const dateNow = new Date();
    setSystemTime(dateNow)

    const DLL = `
      CREATE TABLE "usertest"
      (
          "id"    SERIAL PRIMARY KEY,
          "createdAt" timestamp,
          "updatedAt" timestamp
      );
  `;

    await purgeDatabase()
    await startDatabase(import.meta.path)
    await execute(DLL)

    Entity()(UserTest)
    const created = await UserTest.create({
      id: 1
    })

    expect(created).toBeInstanceOf(UserTest);
    expect(created!.id).toEqual(1);
    expect(created!.createdAt).toEqual(dateNow);
    expect(created!.updatedAt).toEqual(dateNow);
  })

  async function createUser() {
    return User.create({
      email: 'test@test.com',
      id: 1,
    })
  }
})