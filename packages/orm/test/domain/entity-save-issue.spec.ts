import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { app, execute, mockLogger, purgeDatabase, startDatabase } from '../node-database';
import { BaseEntity, Entity, PrimaryKey, Property } from '../../src';

const DLL = `
    CREATE TABLE "user_library"
    (
        "id"          SERIAL PRIMARY KEY,
        "name"        varchar(255) NOT NULL,
        "is_favorite" boolean DEFAULT false
    );
`;

const BATTLE_UNIT_SNAPSHOT_DDL = `
    CREATE TABLE "battle_unit_snapshot"
    (
        "id"          SERIAL PRIMARY KEY,
        "side"        varchar(32) NOT NULL,
        "slot_number" integer NOT NULL,
        "name"        varchar(255) NOT NULL,
        "hp"          integer NOT NULL
    );
`;

@Entity()
class UserLibrary extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    name: string;

    @Property()
    isFavorite: boolean;
}

@Entity()
class BattleUnitSnapshot extends BaseEntity {
    @PrimaryKey()
    id: number;

    @Property()
    side: string = 'ALLY';

    @Property()
    slotNumber: number = 0;

    @Property()
    name: string = 'Unknown';

    @Property()
    hp: number = 100;
}

describe('Entity save() method issue', () => {

    beforeEach(async () => {
        await startDatabase();
        await execute(DLL);
    })

    afterEach(async () => {
        await purgeDatabase();
        await app?.disconnect();
        (mockLogger as jest.Mock).mockClear();
    })

    test('should update entity loaded from database using save() - simulates toggleFavorite scenario', async () => {
        // Given: Create a library that is not favorite
        await UserLibrary.create({
            id: 1,
            name: 'My Library',
            isFavorite: false,
        });

        // When: Load library from database and toggle favorite
        const library = await UserLibrary.findOne({ id: 1 });
        expect(library).toBeInstanceOf(UserLibrary);
        expect(library!.isFavorite).toBe(false);

        library.isFavorite = !library.isFavorite;
        await library!.save();

        // Then: Library should be updated in database
        const updated = await UserLibrary.findOne({ id: 1 });
        expect(updated!.isFavorite).toBe(true);
    });

    test('should insert changed values for a new entity even when fields had default initializers', async () => {
        await execute(BATTLE_UNIT_SNAPSHOT_DDL);

        const snapshot = new BattleUnitSnapshot();
        snapshot.id = 1;
        snapshot.side = 'ENEMY';
        snapshot.slotNumber = 3;
        snapshot.name = 'Goblin';
        snapshot.hp = 80;

        await snapshot.save();

        const inserted = await BattleUnitSnapshot.findOne({ id: 1 });

        expect(inserted).toBeInstanceOf(BattleUnitSnapshot);
        expect(inserted).toMatchObject({
            id: 1,
            side: 'ENEMY',
            slotNumber: 3,
            name: 'Goblin',
            hp: 80,
        });
    });


});
