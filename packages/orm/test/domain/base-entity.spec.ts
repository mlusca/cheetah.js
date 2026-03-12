import { afterEach, beforeEach, describe, expect, jest, setSystemTime, test } from 'bun:test'
import { app, execute, mockLogger, purgeDatabase, startDatabase } from '../node-database';
import { BaseEntity, Entity, expr, ManyToOne, OneToMany, PrimaryKey, Property } from '../../src';
import { Email } from '../../src/common/email.vo';
import { v4 } from 'uuid';

@Entity()
class UserTest extends BaseEntity {
    @PrimaryKey()
    id: string = v4();

    @Property()
    createdAt: Date = new Date();

    @Property({ onUpdate: () => new Date() })
    updatedAt: Date;
}

@Entity()
class UserValue extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    email: Email
}

@Entity()
class Address extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    address: string;

    @Property()
    userOwner: number;
}

@Entity()
class UserCamel extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    emailUser: string;

    @Property({ columnName: 'date' })
    createdAt: Date;

    @ManyToOne(() => Address)
    addressUser: Address;
}

@Entity({ tableName: 'player_stats' })
class PlayerStats extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property({ columnName: 'experience_points' })
    experience: number;

    @Property()
    level: number;
}

describe('Creation, update and deletion of entities', () => {
    function expectLoggedSql(
        callIndex: number,
        expected: { postgres: string; mysql: string },
    ): void {
        const prefix = app.driverInstance?.dbType === 'mysql'
            ? expected.mysql
            : expected.postgres;

        expect((mockLogger as jest.Mock).mock.calls[callIndex][0]).toStartWith(prefix);
    }

    function expectLoggedSqlContains(
        loggedSql: string,
        expected: { postgres: string; mysql: string },
    ): void {
        const fragment = app.driverInstance?.dbType === 'mysql'
            ? expected.mysql
            : expected.postgres;

        expect(loggedSql).toContain(fragment);
    }

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
            "id"         SERIAL PRIMARY KEY,
            "address"    varchar(255) NOT NULL,
            "user_owner" integer REFERENCES "user" ("id")
        );
    `;

    const DDL_PLAYER_STATS = `
        CREATE TABLE "player_stats"
        (
            "id" SERIAL PRIMARY KEY,
            "experience_points" integer NOT NULL DEFAULT 0,
            "level" integer NOT NULL DEFAULT 1
        );
    `;

    @Entity()
    class User extends BaseEntity {
        @PrimaryKey()
        id: number;

        @Property()
        email: string;

        @OneToMany(() => Address, (address) => address.userOwner)
        addresses: Address[];
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

    beforeEach(async () => {
        await startDatabase();
        await execute(DLL);
    })

    afterEach(async () => {
        await purgeDatabase();
        await app?.disconnect();
        (mockLogger as jest.Mock).mockClear();
    })


    test('should create a entity', async () => {
        (mockLogger as jest.Mock).mockClear();
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
        expectLoggedSql(0, {
            postgres: "SQL: INSERT INTO \"public\".\"user\" (\"email\", \"id\") VALUES ('test@test.com', 1) RETURNING \"id\" as \"u1_id\", \"email\" as \"u1_email\" ",
            mysql: "SQL: INSERT INTO `user` (`email`, `id`) VALUES ('test@test.com', 1)",
        });
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
        expectLoggedSql(0, {
            postgres: "SQL: INSERT INTO \"public\".\"user\" (\"email\", \"id\") VALUES ('test@test.com', 1) RETURNING \"id\" as \"u1_id\", \"email\" as \"u1_email\" ",
            mysql: "SQL: INSERT INTO `user` (`email`, `id`) VALUES ('test@test.com', 1)",
        });
    });

    test('should a find a entity', async () => {
        const user = await User.create({
            email: 'test@test.com',
            id: 1,
        })

        const result = await User.findOne({ id: 1 });

        expect(result).toBeInstanceOf(User);
        expect(result).toEqual(user!);
        expect(mockLogger).toHaveBeenCalledTimes(2);
        expectLoggedSql(1, {
            postgres: "SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (u1.id = 1) LIMIT 1",
            mysql: "SQL: SELECT u1.`id` as `u1_id`, u1.`email` as `u1_email` FROM `user` u1 WHERE (u1.id = 1) LIMIT 1",
        });
    });

    test('should a update a entity', async () => {
        const user = await User.create({
            email: 'test@test.com',
            id: 1,
        })
        user!.email = 'updated@test.com';
        await user!.save();

        const result = await User.findOne({ id: 1 });
        expect(result!.email).toEqual('updated@test.com')
        expect(mockLogger).toHaveBeenCalledTimes(3);
        expectLoggedSql(1, {
            postgres: "SQL: UPDATE \"public\".\"user\" as u1 SET email = 'updated@test.com' WHERE (u1.id = 1)",
            mysql: "SQL: UPDATE `user` as u1 SET email = 'updated@test.com' WHERE (u1.id = 1)",
        });
    });

    test('should support static active record update', async () => {
        await User.create({
            email: 'test@test.com',
            id: 1,
        });

        await User.update({ id: 1 }, { email: 'updated-via-static@test.com' });

        const result = await User.findOne({ id: 1 });

        expect(result?.email).toEqual('updated-via-static@test.com');
    });

    test('should support static active record delete', async () => {
        await User.create({
            email: 'test@test.com',
            id: 1,
        });

        await User.delete({ id: 1 });

        const result = await User.findOne({ id: 1 });

        expect(result).toBeUndefined();
    });

    test('should support computed updates through active record static update', async () => {
        await purgeDatabase();
        await startDatabase(import.meta.path);
        await execute(DDL_PLAYER_STATS);

        await PlayerStats.create({
            id: 1,
            experience: 10,
            level: 1,
        });

        (mockLogger as jest.Mock).mockClear();

        await PlayerStats.update({ id: 1 }, {
            experience: expr((prev) => prev.plus(5)),
            level: 2,
        });

        const result = await PlayerStats.findOne({ id: 1 });

        expect(result?.experience).toEqual(15);
        expect(result?.level).toEqual(2);
        expect(mockLogger).toHaveBeenCalledTimes(2);
        expectLoggedSql(0, {
            postgres: 'SQL: UPDATE "public"."player_stats" as p1 SET experience_points = experience_points + 5, level = 2 WHERE (p1.id = 1)',
            mysql: 'SQL: UPDATE `player_stats` as p1 SET experience_points = experience_points + 5, level = 2 WHERE (p1.id = 1)',
        });
    });

    test('should support minus, times and div expressions through active record static update', async () => {
        await purgeDatabase();
        await startDatabase(import.meta.path);
        await execute(DDL_PLAYER_STATS);

        await PlayerStats.create({
            id: 1,
            experience: 12,
            level: 1,
        });

        await PlayerStats.update({ id: 1 }, {
            experience: expr((prev) => prev.minus(2)),
        });
        expect((await PlayerStats.findOne({ id: 1 }))?.experience).toEqual(10);

        await PlayerStats.update({ id: 1 }, {
            experience: expr((prev) => prev.times(3)),
        });
        expect((await PlayerStats.findOne({ id: 1 }))?.experience).toEqual(30);

        await PlayerStats.update({ id: 1 }, {
            experience: expr((prev) => prev.div(5)),
        });
        expect((await PlayerStats.findOne({ id: 1 }))?.experience).toEqual(6);
    });

    test('should support computed updates through query builder with columnName mapping', async () => {
        await purgeDatabase();
        await startDatabase(import.meta.path);
        await execute(DDL_PLAYER_STATS);

        await PlayerStats.create({
            id: 1,
            experience: 7,
            level: 1,
        });

        (mockLogger as jest.Mock).mockClear();

        await PlayerStats.createQueryBuilder()
            .update({ experience: expr((prev) => prev.plus(3)) })
            .where({ id: 1 })
            .execute();

        const result = await PlayerStats.findOne({ id: 1 });

        expect(result?.experience).toEqual(10);
        expect(mockLogger).toHaveBeenCalledTimes(2);
        expectLoggedSql(0, {
            postgres: 'SQL: UPDATE "public"."player_stats" as p1 SET experience_points = experience_points + 3 WHERE (p1.id = 1)',
            mysql: 'SQL: UPDATE `player_stats` as p1 SET experience_points = experience_points + 3 WHERE (p1.id = 1)',
        });
    });

    test('should support different formulas through query builder computed updates', async () => {
        await purgeDatabase();
        await startDatabase(import.meta.path);
        await execute(DDL_PLAYER_STATS);

        await PlayerStats.create({
            id: 1,
            experience: 9,
            level: 1,
        });

        await PlayerStats.createQueryBuilder()
            .update({ experience: expr((prev) => prev.times(2)) })
            .where({ id: 1 })
            .execute();
        expect((await PlayerStats.findOne({ id: 1 }))?.experience).toEqual(18);

        await PlayerStats.createQueryBuilder()
            .update({ experience: expr((prev) => prev.minus(6)) })
            .where({ id: 1 })
            .execute();
        expect((await PlayerStats.findOne({ id: 1 }))?.experience).toEqual(12);

        await PlayerStats.createQueryBuilder()
            .update({ experience: expr((prev) => prev.div(4)) })
            .where({ id: 1 })
            .execute();
        expect((await PlayerStats.findOne({ id: 1 }))?.experience).toEqual(3);
    });

    test('should a find relationship', async () => {
        await execute(DDL_ADDRESS);
        const user = await User.create({
            email: 'test@test.com',
            id: 1,
        });
        const address = await Address.create({
            address: 'Street 1',
            userOwner: user.id,
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
            await User.findOneOrFail({ id: 1 })
        }).toThrow()
        expect(mockLogger).toHaveBeenCalledTimes(1);
        expectLoggedSql(0, {
            postgres: "SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (u1.id = 1) LIMIT 1",
            mysql: "SQL: SELECT u1.`id` as `u1_id`, u1.`email` as `u1_email` FROM `user` u1 WHERE (u1.id = 1) LIMIT 1",
        });
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
        expectLoggedSql(1, {
            postgres: "SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (u1.id = 1 AND u1.email = 'test@test.com') LIMIT 1",
            mysql: "SQL: SELECT u1.`id` as `u1_id`, u1.`email` as `u1_email` FROM `user` u1 WHERE (u1.id = 1 AND u1.email = 'test@test.com') LIMIT 1",
        });
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
        expectLoggedSql(1, {
            postgres: "SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (u1.id != 2 AND u1.email = 'test@test.com') LIMIT 1",
            mysql: "SQL: SELECT u1.`id` as `u1_id`, u1.`email` as `u1_email` FROM `user` u1 WHERE (u1.id != 2 AND u1.email = 'test@test.com') LIMIT 1",
        });
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
        expectLoggedSql(1, {
            postgres: "SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (u1.id > 0 AND u1.id < 2) LIMIT 1",
            mysql: "SQL: SELECT u1.`id` as `u1_id`, u1.`email` as `u1_email` FROM `user` u1 WHERE (u1.id > 0 AND u1.id < 2) LIMIT 1",
        });
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
        expectLoggedSql(1, {
            postgres: "SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (u1.id >= 1 AND u1.id <= 1) LIMIT 1",
            mysql: "SQL: SELECT u1.`id` as `u1_id`, u1.`email` as `u1_email` FROM `user` u1 WHERE (u1.id >= 1 AND u1.id <= 1) LIMIT 1",
        });
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
        expectLoggedSql(1, {
            postgres: "SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (u1.id IN (1, 2)) LIMIT 1",
            mysql: "SQL: SELECT u1.`id` as `u1_id`, u1.`email` as `u1_email` FROM `user` u1 WHERE (u1.id IN (1, 2)) LIMIT 1",
        });
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
        expectLoggedSql(1, {
            postgres: "SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (u1.id NOT IN (2)) LIMIT 1",
            mysql: "SQL: SELECT u1.`id` as `u1_id`, u1.`email` as `u1_email` FROM `user` u1 WHERE (u1.id NOT IN (2)) LIMIT 1",
        });
    });

    test('When search with $or operator', async () => {
        const user = await createUser();

        const result = await User.findOneOrFail({
            $or: [
                { id: 1 },
                { email: 'test_error@test.com' },
            ],
        });

        expect(result).toEqual(user);
        expect(mockLogger).toHaveBeenCalledTimes(2);
        expectLoggedSql(1, {
            postgres: "SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (((u1.id = 1) OR (u1.email = 'test_error@test.com'))) LIMIT 1",
            mysql: "SQL: SELECT u1.`id` as `u1_id`, u1.`email` as `u1_email` FROM `user` u1 WHERE (((u1.id = 1) OR (u1.email = 'test_error@test.com'))) LIMIT 1",
        });
    });

    test('When search with $and operator', async () => {
        const user = await createUser();

        const result = await User.findOneOrFail({
            $and: [
                { id: 1 },
                { email: 'test@test.com' },
            ],
        });

        expect(result).toEqual(user);
        expect(mockLogger).toHaveBeenCalledTimes(2);
        expectLoggedSql(1, {
            postgres: "SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1 WHERE (((u1.id = 1) AND (u1.email = 'test@test.com'))) LIMIT 1",
            mysql: "SQL: SELECT u1.`id` as `u1_id`, u1.`email` as `u1_email` FROM `user` u1 WHERE (((u1.id = 1) AND (u1.email = 'test@test.com'))) LIMIT 1",
        });
    });

    test('When find all', async () => {
        const user = await createUser();

        const result = await User.findAll({});

        expect(result).toEqual([user]);
        expect(mockLogger).toHaveBeenCalledTimes(2);
        expectLoggedSql(1, {
            postgres: "SQL: SELECT u1.\"id\" as \"u1_id\", u1.\"email\" as \"u1_email\" FROM \"public\".\"user\" u1",
            mysql: "SQL: SELECT u1.`id` as `u1_id`, u1.`email` as `u1_email` FROM `user` u1",
        });
    });

    test('When find with columns defined', async () => {
        await execute(DDL_ADDRESS)
        const user = await createUser();
        const address = await Address.create({
            address: 'Street 1',
            userOwner: user.id,
            id: 1,
        });

        const result = await User.findOneOrFail({
            addresses: {
                id: 1,
            },
        }, { fields: ['id', 'addresses.id'] });

        expect(result.id).toEqual(user.id);
        expect(result.email).toBeUndefined();
        expect(result.addresses[0].id).toEqual(address.id);
        expect(result.addresses[0].address).toBeUndefined();
        expect(mockLogger).toHaveBeenCalledTimes(3);
        expectLoggedSql(2, {
            postgres: "SQL: SELECT u1.\"id\" as u1_id, a1.\"id\" as a1_id FROM \"public\".\"user\" u1 LEFT JOIN public.address a1 ON a1.\"user_owner\" = u1.\"id\" WHERE ((a1.id = 1))",
            mysql: "SQL: SELECT u1.`id` as u1_id, a1.`id` as a1_id FROM `user` u1 LEFT JOIN `address` a1 ON a1.`user_owner` = u1.`id` WHERE ((a1.id = 1))",
        });
    })

    test('When find with orderBy defined', async () => {
        // Given
        await execute(DDL_ADDRESS);
        const user = await createUser();
        await Address.create({
            address: 'Street 1',
            userOwner: user.id,
            id: 1,
        });

        // When
        const result = await User.findOneOrFail({
            addresses: {
                id: 1,
            },
        }, {
            fields: ['id', 'addresses.id'],
            orderBy: { id: 'DESC', addresses: { address: 'DESC', userOwner: 'DESC' } },
        });

        // Then
        expect(result.id).toEqual(user.id);
        expect(mockLogger).toHaveBeenCalledTimes(3);
        expectLoggedSql(2, {
            postgres: "SQL: SELECT u1.\"id\" as u1_id, a1.\"id\" as a1_id FROM \"public\".\"user\" u1 LEFT JOIN public.address a1 ON a1.\"user_owner\" = u1.\"id\" WHERE ((a1.id = 1)) ORDER BY u1.\"id\" DESC, a1.\"address\" DESC, a1.\"user_owner\" DESC",
            mysql: "SQL: SELECT u1.`id` as u1_id, a1.`id` as a1_id FROM `user` u1 LEFT JOIN `address` a1 ON a1.`user_owner` = u1.`id` WHERE ((a1.id = 1)) ORDER BY u1.`id` DESC, a1.`address` DESC, a1.`user_owner` DESC",
        });
    })

    test('When find with limit defined', async () => {
        const user = await createUser();


        const result = await User.find({}, {
            fields: ['id'],
            limit: 1,
        });

        expect(result.length).toEqual(1)
        expect(result[0].id).toEqual(user.id);
        expect(mockLogger).toHaveBeenCalledTimes(2);
        expectLoggedSql(1, {
            postgres: "SQL: SELECT u1.\"id\" as u1_id FROM \"public\".\"user\" u1 LIMIT 1",
            mysql: "SQL: SELECT u1.`id` as u1_id FROM `user` u1 LIMIT 1",
        });
    })

    test('When find with offset defined', async () => {
        await createUser();
        const user2 = await User.create({
            email: 'test2@test.com',
            id: 2,
        });

        const result = await User.find({}, {
            fields: ['id'],
            offset: 1,
            limit: 1,
            orderBy: { id: 'ASC' },
        });

        expect(result[0].id).toEqual(user2.id);
        expect(mockLogger).toHaveBeenCalledTimes(3);
        expectLoggedSql(2, {
            postgres: "SQL: SELECT u1.\"id\" as u1_id FROM \"public\".\"user\" u1 ORDER BY u1.\"id\" ASC OFFSET 1 LIMIT 1",
            mysql: "SQL: SELECT u1.`id` as u1_id FROM `user` u1 ORDER BY u1.`id` ASC LIMIT 1, 1",
        });
    })

    test('When use a querybuilder', async () => {
        const created = await app.createQueryBuilder<User>(User)
            .insert({ id: 1, email: 'test@test.com' })
            .executeAndReturnFirst()

        expect(created).toBeInstanceOf(User);
        expect(created!.id).toEqual(1);
    })

    test('When have update column and default column', async () => {
        const dateNow = new Date();
        setSystemTime(dateNow)

        const DLL = `
            CREATE TABLE "user_test"
            (
                "id"         uuid PRIMARY KEY,
                "created_at" timestamp,
                "updated_at" timestamp
            );
        `;

        await purgeDatabase()
        await startDatabase(import.meta.path)
        await execute(DLL)

        Entity()(UserTest)
        const created = await UserTest.create({})
        const expectedDate = app.driverInstance?.dbType === 'mysql'
            ? new Date(Math.floor(dateNow.getTime() / 1000) * 1000)
            : dateNow;

        expect(created).toBeInstanceOf(UserTest);
        expect(created!.id).toHaveLength(36);
        expect(created!.createdAt).toEqual(expectedDate);
        expect(created!.updatedAt).toEqual(expectedDate);
    })

    test('When have a column with value-object', async () => {
        const DLL = `
            CREATE TABLE "user_value"
            (
                "id"    SERIAL PRIMARY KEY,
                "email" varchar(255) NOT NULL
            );
        `;

        await purgeDatabase()
        await startDatabase(import.meta.path)
        await execute(DLL)

        Entity()(UserValue)
        const created = await UserValue.create({
            id: 1,
            email: Email.from('test@test.com'),
        })

        const find = await UserValue.findOne({
            email: Email.from('test@test.com'),
            id: 1,
        })

        expect(created).toBeInstanceOf(UserValue);
        expect(created!.id).toEqual(1);
        expect(created!.email).toEqual(Email.from('test@test.com'));

        expect(find).toBeInstanceOf(UserValue);
        expect(find!.id).toEqual(1);
        expect(find!.email).toEqual(Email.from('test@test.com'));
    })

    test('When have a join with strategy select-in', async () => {
        await execute(DDL_ADDRESS)
        Entity()(User)
        Entity()(Address)

        const user = await createUser();
        const address = await Address.create({
            address: 'Street 1',
            userOwner: user.id,
            id: 3,
        });

        const result = await User.findOne({
            addresses: {
                id: 3,
            },
        }, { fields: ['id', 'addresses.id'], loadStrategy: 'select' });

        expect(result).toBeInstanceOf(User);
        expect(result!.id).toEqual(user.id);
        expect(result!.addresses).toBeInstanceOf(Array);
        expect(result!.addresses[0]).toBeInstanceOf(Address);
        expect(result!.addresses[0].id).toEqual(address.id);
        expect(result!.addresses[0].address).toBeUndefined();
        expect(mockLogger).toHaveBeenCalledTimes(4);
        expect(mockLogger).not.toHaveBeenCalledTimes(5)
        expectLoggedSql(2, {
            postgres: "SQL: SELECT u1.\"id\" as u1_id FROM \"public\".\"user\" u1 LIMIT 1",
            mysql: "SQL: SELECT u1.`id` as u1_id FROM `user` u1 LIMIT 1",
        });
        expectLoggedSql(3, {
            postgres: "SQL: SELECT a1.\"id\" as \"a1_id\" FROM \"public\".\"address\" a1 WHERE (a1.id = 3) AND a1.\"user_owner\" IN (1)",
            mysql: "SQL: SELECT a1.`id` as `a1_id` FROM `address` a1 WHERE (a1.id = 3) AND a1.`user_owner` IN (1)",
        });
    })

    test('When have a property camelCase', async () => {
        const DLL = `
            CREATE TABLE "user_camel"
            (
                "id"              SERIAL PRIMARY KEY,
                "email_user"      varchar(255) NOT NULL,
                "date"            timestamp    NOT NULL,
                "address_user_id" integer REFERENCES "address" ("id")
            );
        `;
        await execute(DDL_ADDRESS)
        await execute(DLL)
        Entity()(Address)
        Entity()(UserCamel)

        await User.create({
            email: 'test@test.com',
            id: 1,
        })

        const address = await Address.create({
            address: 'Street 1',
            userOwner: 1,
            id: 1,
        })

        await UserCamel.create({
            emailUser: 'test@test.com',
            createdAt: new Date(),
            id: 1,
            addressUser: address
        });
        const user = await UserCamel.findOne({
            emailUser: 'test@test.com',
            addressUser: {
                id: 1
            }
        })

        expect(user).toBeInstanceOf(UserCamel);
        expect(user!.id).toEqual(1);
        expect(user!.emailUser).toEqual('test@test.com');
        expect(user!.addressUser.id).toEqual(address.id);
        expect(user!.addressUser.address).toEqual(address.address);
        expect(user!.addressUser.userOwner).toEqual(address.userOwner);
    });

    test('When have a property oneToMany camelCase', async () => {
        await execute(DDL_ADDRESS)
        Entity()(User)
        Entity()(Address)

        await User.create({
            email: 'test@test.com',
            id: 1,
        })

        const address = await Address.create({
            address: 'Street 1',
            userOwner: 1,
            id: 1,
        })

        const user = await User.findOne({
            addresses: {
                id: 1
            }
        })

        expect(user).toBeInstanceOf(User);
        expect(user!.id).toEqual(1);
        expect(user!.email).toEqual('test@test.com');
        expect(user.addresses[0].id).toEqual(address.id);
        expect(user.addresses[0].address).toEqual(address.address);
        expect(user.addresses[0].userOwner).toEqual(address.userOwner);
    })


    test('should update an entity loaded from database using save()', async () => {
        await User.create({
            email: 'test@test.com',
            id: 1,
        });

        const library = await User.findOne({ id: 1 });
        expect(library).toBeInstanceOf(User);
        expect(library!.email).toEqual('test@test.com');

        library!.email = 'updated@test.com';
        await library!.save();

        const updated = await User.findOne({ id: 1 });
        expect(updated!.email).toEqual('updated@test.com');
    });

    async function createUser() {
        return User.create({
            email: 'test@test.com',
            id: 1,
        })
    }

    test('should use columnName in SELECT when fields are specified', async () => {
        const DLL = `
            CREATE TABLE "user_camel"
            (
                "id"              SERIAL PRIMARY KEY,
                "email_user"      varchar(255) NOT NULL,
                "date"            timestamp    NOT NULL,
                "address_user_id" integer REFERENCES "address" ("id")
            );
        `;

        await execute(DDL_ADDRESS);
        await execute(DLL);
        Entity()(Address);
        Entity()(UserCamel);

        await User.create({
            email: 'owner@test.com',
            id: 1,
        });

        const address = await Address.create({
            address: 'Street 1',
            userOwner: 1,
            id: 1,
        });

        await UserCamel.create({
            emailUser: 'test@test.com',
            createdAt: new Date('2024-01-01'),
            id: 1,
            addressUser: address,
        });

        await UserCamel.create({
            emailUser: 'another@test.com',
            createdAt: new Date('2024-01-02'),
            id: 2,
            addressUser: address,
        });

        (mockLogger as jest.Mock).mockClear();

        const users = await UserCamel.find(
            { id: 1 },
            { fields: ['createdAt', 'emailUser'] }
        );

        expect(users).toHaveLength(1);
        expect(users[0].emailUser).toEqual('test@test.com');
        expect(users[0].createdAt).toEqual(new Date('2024-01-01'));
        expect(mockLogger).toHaveBeenCalledTimes(1);

        const loggedSql = (mockLogger as jest.Mock).mock.calls[0][0];
        expectLoggedSqlContains(loggedSql, { postgres: 'u1."date"', mysql: 'u1.`date`' });
        expectLoggedSqlContains(loggedSql, { postgres: 'u1."email_user"', mysql: 'u1.`email_user`' });
        expect(loggedSql).not.toContain('u1."createdAt"');
        expect(loggedSql).not.toContain('u1."emailUser"');
    });
})
