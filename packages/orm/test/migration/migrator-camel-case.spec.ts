import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { execute, mockLogger, purgeDatabase, startDatabase } from '../node-database';
import { Metadata } from '@cheetah.js/core';
import { ENTITIES } from '../../src/constants';
import { BaseEntity, Entity, ManyToOne, Migrator, OneToMany, PrimaryKey, Property } from '../../src';
import path from 'path';
import fs from 'fs';

describe('Migration', () => {

  beforeEach(async () => {
    await startDatabase();
    Metadata.delete(ENTITIES, Reflect);
  })

  afterEach(async () => {
    await purgeDatabase();
    (mockLogger as jest.Mock).mockClear();
  })

  it('should snapshot database with propertyCamelcase', async () => {
    class User extends BaseEntity {
      @PrimaryKey({autoIncrement: true})
      id: number;

      @Property()
      createdAt: Date;

      @ManyToOne(() => User)
      userOwner: User[];
    }

    Entity()(User);
    const migrator = new Migrator();
    await migrator.initConfigFile();
    await migrator.createMigration( 'test');

    // Caminho para o arquivo gerado
    const migrationFilePath = path.join(__dirname, '/test.sql');

    // Leitura do conteúdo do arquivo
    const migrationContent = fs.readFileSync(migrationFilePath, {encoding: 'utf-8'});

    // Verificação do conteúdo conforme necessário
    expect(migrationContent).toContain('CREATE TABLE \"public\".\"user\" (\"id\" SERIAL NOT NULL PRIMARY KEY UNIQUE,\"created_at\" timestamp NOT NULL,\"user_owner_id\" SERIAL NOT NULL);');
    expect(migrationContent).toContain('ALTER TABLE \"public\".\"user\" ADD CONSTRAINT \"user_user_owner_id_fk\" FOREIGN KEY (\"user_owner_id\") REFERENCES \"user\" (\"id\");');
    await execute(migrationContent);
  });
});