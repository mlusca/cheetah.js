import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test';
import { Migrator } from '../../src/migration/migrator';
import config from './cheetah.config';
import { BaseEntity, Entity, ManyToOne, PrimaryKey, Property } from '../../src';
import { execute, mockLogger, purgeDatabase, startDatabase } from '../node-database';
import * as path from 'path';
import * as fs from 'fs';
import { Metadata } from '@cheetah.js/core';
import { ENTITIES } from '../../src/constants';
import { Index } from '../../src/decorators/index.decorator';
import { Email } from '../../src/common/email.vo';
import { Enum } from '../../src/decorators/enum.decorator';

describe('Migration', () => {

  beforeEach(async () => {
    await startDatabase();
    Metadata.delete(ENTITIES, Reflect);
  })

  afterEach(async () => {
    await purgeDatabase();
    (mockLogger as jest.Mock).mockClear();
  })

  it('When search de config file', async () => {
    const migrator = new Migrator();
    await migrator.initConfigFile();

    expect(migrator.config).toEqual(config)
  });

  it('When not search de config file', async () => {
    const migrator = new Migrator();
    expect(async () => {
      await migrator.initConfigFile('src')
    }).toThrow("Config file not found");
  });

  it('should snapshot database', async () => {
    class User extends BaseEntity {
      @PrimaryKey()
      id: number;

      @Property({ unique: true })
      email: string;
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
    expect(migrationContent).toContain('CREATE TABLE \"public\".\"user\" (\"id\" numeric(11) NOT NULL PRIMARY KEY UNIQUE,\"email\" character varying(255) NOT NULL UNIQUE);');
    await execute(migrationContent);
  });

  it('should modify database column', async () => {
    await execute("CREATE TABLE \"public\".\"user\" (\"id\" numeric(11) PRIMARY KEY UNIQUE,\"email\" character varying(255) UNIQUE);")
    class User extends BaseEntity {
      @PrimaryKey()
      id: number;

      @Property()
      email: string;

      @Property({length: 10})
      password: string;

      @Property({nullable: true})
      token?: string;
    }

    Entity()(User);

    const migrator = new Migrator();
    await migrator.initConfigFile();
    await migrator.createMigration( 'test');
    const migrationFilePath = path.join(__dirname, '/test.sql');
    const migrationContent = fs.readFileSync(migrationFilePath, {encoding: 'utf-8'});

    expect(migrationContent).toContain("ALTER TABLE \"public\".\"user\" DROP CONSTRAINT \"user_email_key\";");
    expect(migrationContent).toContain('ALTER TABLE \"public\".\"user\" ADD COLUMN \"password\" character varying(10) NOT NULL')
    expect(migrationContent).toContain('ALTER TABLE \"public\".\"user\" ADD COLUMN \"token\" character varying(255);')
    await execute(migrationContent);
  });

  it('should modify a column unique', async () => {
    await execute("CREATE TABLE \"public\".\"user\" (\"id\" numeric(11) NOT NULL PRIMARY KEY UNIQUE,\"email\" character varying(255) NOT NULL unique, \"password\" character varying(10) NOT NULL);")
    class User extends BaseEntity {
      @PrimaryKey()
      id: number;

      @Property()
      email: string;

      @Property({length: 10, unique: true})
      password: string;
    }

    Entity()(User);

    const migrator = new Migrator();
    await migrator.initConfigFile();
    await migrator.createMigration( 'test');
    const migrationFilePath = path.join(__dirname, '/test.sql');
    const migrationContent = fs.readFileSync(migrationFilePath, {encoding: 'utf-8'});

    expect(migrationContent).toContain("ALTER TABLE \"public\".\"user\" DROP CONSTRAINT \"user_email_key\";");
    expect(migrationContent).toContain("ALTER TABLE \"public\".\"user\" ADD UNIQUE (\"password\");")
    await execute(migrationContent);
  });

  it('should add a relation property', async () => {
    await execute("CREATE TABLE \"public\".\"user\" (\"id\" numeric(11) NOT NULL PRIMARY KEY UNIQUE,\"email\" character varying(255) NOT NULL unique);")
    await execute("CREATE TABLE \"public\".\"address\" (\"id\" numeric(11) NOT NULL PRIMARY KEY UNIQUE);")
    class User extends BaseEntity {
      @PrimaryKey()
      id: number;

      @Property()
      email: string;
    }

    class Address extends BaseEntity {
      @PrimaryKey()
      id: number;

      @ManyToOne(() => User)
      user: User;
    }

    Entity()(User);
    Entity()(Address);

    const migrator = new Migrator();
    await migrator.initConfigFile();
    await migrator.createMigration( 'test');
    const migrationFilePath = path.join(__dirname, '/test.sql');
    const migrationContent = fs.readFileSync(migrationFilePath, {encoding: 'utf-8'});

    expect(migrationContent).toContain("ALTER TABLE \"public\".\"user\" DROP CONSTRAINT \"user_email_key\";");
    expect(migrationContent).toContain("ALTER TABLE \"public\".\"address\" ADD COLUMN \"user\" numeric(11) NOT NULL;");
    expect(migrationContent).toContain("ALTER TABLE \"public\".\"address\" ADD CONSTRAINT \"address_user_fk\" FOREIGN KEY (\"user\") REFERENCES \"user\" (\"id\");")
    await execute(migrationContent);
  });

  it('should add a relation property', async () => {
    await execute("CREATE TABLE \"public\".\"user\" (\"id\" numeric(11) NOT NULL PRIMARY KEY UNIQUE,\"email\" character varying(255) NOT NULL);")
    await execute("CREATE TABLE \"public\".\"address\" (\"id\" numeric(11) NOT NULL PRIMARY KEY UNIQUE, \"user\" numeric(11) NOT NULL);")
    await execute("ALTER TABLE \"public\".\"address\" ADD CONSTRAINT \"address_user_fk\" FOREIGN KEY (\"user\") REFERENCES \"public\".\"user\" (\"id\");")

    class User extends BaseEntity {
      @PrimaryKey()
      id: number;

      @Property()
      email: string;
    }

    class Address extends BaseEntity {
      @PrimaryKey()
      id: number;

      @Property({length: 11, nullable: true})
      user: number;
    }

    Entity()(User);
    Entity()(Address);

    const migrator = new Migrator();
    await migrator.initConfigFile();
    await migrator.createMigration( 'test');
    const migrationFilePath = path.join(__dirname, '/test.sql');
    const migrationContent = fs.readFileSync(migrationFilePath, {encoding: 'utf-8'});

    expect(migrationContent).toContain("ALTER TABLE \"public\".\"address\" DROP CONSTRAINT \"address_user_fk\";")
    expect(migrationContent).toContain("ALTER TABLE \"public\".\"address\" ALTER COLUMN \"user\" DROP NOT NULL;")
    await execute(migrationContent);
  });

  it('should add a index property with multiple indexes', async () => {
    await execute("CREATE TABLE \"public\".\"user\" (\"id\" numeric(11) NOT NULL PRIMARY KEY UNIQUE,\"email\" character varying(255) NOT NULL);")

    class User extends BaseEntity {
      @PrimaryKey()
      @Index({properties: ['id', 'email']})
      id: number;

      @Property()
      @Index()
      email: string;
    }

    Entity()(User);

    const migrator = new Migrator();
    await migrator.initConfigFile();
    await migrator.createMigration( 'test');
    const migrationFilePath = path.join(__dirname, '/test.sql');
    const migrationContent = fs.readFileSync(migrationFilePath, {encoding: 'utf-8'});

    expect(migrationContent).toContain("CREATE INDEX \"id_email_index\" ON \"public\".\"user\" (\"id\", \"email\");")
    expect(migrationContent).toContain("CREATE INDEX \"email_index\" ON \"public\".\"user\" (\"email\");")
    await execute(migrationContent);
  });

  it('should add a create with relations', async () => {
    class User extends BaseEntity {
      @PrimaryKey()
      @Index({properties: ['id', 'email']})
      id: number;

      @Property()
      @Index()
      email: string;
    }

    class Address extends BaseEntity {
      @PrimaryKey()
      id: number;

      @ManyToOne(() => User)
      user: User;
    }

    Entity()(User);
    Entity()(Address);

    const migrator = new Migrator();
    await migrator.initConfigFile();
    await migrator.createMigration( 'test');
    const migrationFilePath = path.join(__dirname, '/test.sql');
    const migrationContent = fs.readFileSync(migrationFilePath, {encoding: 'utf-8'});

    expect(migrationContent).toContain("CREATE TABLE \"public\".\"user\" (\"id\" numeric(11) NOT NULL PRIMARY KEY UNIQUE,\"email\" character varying(255) NOT NULL);")
    expect(migrationContent).toContain("CREATE INDEX \"id_email_index\" ON \"public\".\"user\" (\"id\", \"email\");")
    expect(migrationContent).toContain("CREATE INDEX \"email_index\" ON \"public\".\"user\" (\"email\");\n")
    expect(migrationContent).toContain("CREATE TABLE \"public\".\"address\" (\"id\" numeric(11) NOT NULL PRIMARY KEY UNIQUE,\"user\" numeric(11) NOT NULL);")
    expect(migrationContent).toContain("ALTER TABLE \"public\".\"address\" ADD CONSTRAINT \"address_user_fk\" FOREIGN KEY (\"user\") REFERENCES \"user\" (\"id\");")
    expect(migrationContent.split('\n').length).toEqual(5)
    await execute(migrationContent);
  });

  it('should create with value-objects', async () => {
    class User extends BaseEntity {
      @PrimaryKey()
      id: number;

      @Property({ dbType: 'text' })
      email: Email;
    }

    Entity()(User);

    const migrator = new Migrator();
    await migrator.initConfigFile();
    await migrator.createMigration( 'test');
    const migrationFilePath = path.join(__dirname, '/test.sql');
    const migrationContent = fs.readFileSync(migrationFilePath, {encoding: 'utf-8'});

    expect(migrationContent).toContain("CREATE TABLE \"public\".\"user\" (\"id\" numeric(11) NOT NULL PRIMARY KEY UNIQUE,\"email\" text NOT NULL);")
    expect(migrationContent.split('\n').length).toEqual(1)
    await execute(migrationContent);
  });

  it('should create with auto-increment', async () => {
    class User extends BaseEntity {
      @PrimaryKey({ autoIncrement: true })
      id: number;

      @Property({ dbType: 'text' })
      email: Email;
    }

    Entity()(User);

    const migrator = new Migrator();
    await migrator.initConfigFile();
    await migrator.createMigration( 'test');
    const migrationFilePath = path.join(__dirname, '/test.sql');
    const migrationContent = fs.readFileSync(migrationFilePath, {encoding: 'utf-8'});

    expect(migrationContent).toContain("CREATE TABLE \"public\".\"user\" (\"id\" SERIAL PRIMARY KEY UNIQUE,\"email\" text NOT NULL);")
    expect(migrationContent.split('\n').length).toEqual(1)
    await execute(migrationContent);
  });

  it('should create with enum property', async () => {
    enum Role {
      ADMIN = 'admin',
      USER = 'user',
    }
    class User extends BaseEntity {
      @PrimaryKey({ autoIncrement: true })
      id: number;

      @Enum(() => Role)
      role: Role;
    }

    Entity()(User);

    const migrator = new Migrator();
    await migrator.initConfigFile();
    await migrator.createMigration( 'test');
    const migrationFilePath = path.join(__dirname, '/test.sql');
    const migrationContent = fs.readFileSync(migrationFilePath, {encoding: 'utf-8'});

    expect(migrationContent).toContain("CREATE TYPE \"public_user_role_enum\" AS ENUM ('admin', 'user');CREATE TABLE \"public\".\"user\" (\"id\" SERIAL PRIMARY KEY UNIQUE,\"role\" \"public_user_role_enum\" NOT NULL);")
    expect(migrationContent.split('\n').length).toEqual(1)
    await execute(migrationContent);
  });

  it('should alter property to enum property', async () => {
    const DDL = `
        CREATE TABLE "public"."user" ("id" SERIAL PRIMARY KEY UNIQUE,"role" character varying(255) NOT NULL UNIQUE);
    `;
    await execute(DDL);
    enum Role {
      ADMIN = 'admin',
      USER = 'user',
    }
    class User extends BaseEntity {
      @PrimaryKey({ autoIncrement: true })
      id: number;

      @Enum(() => Role)
      role: Role;
    }

    Entity()(User);

    const migrator = new Migrator();
    await migrator.initConfigFile();
    await migrator.createMigration( 'test');
    const migrationFilePath = path.join(__dirname, '/test.sql');
    const migrationContent = fs.readFileSync(migrationFilePath, {encoding: 'utf-8'});

    expect(migrationContent).toContain("ALTER TABLE \"public\".\"user\" DROP CONSTRAINT \"user_role_key\";\nALTER TABLE \"public\".\"user\" DROP COLUMN IF EXISTS \"role\";\nCREATE TYPE \"public_user_role_enum\" AS ENUM ('admin', 'user');\nALTER TABLE \"public\".\"user\" ADD COLUMN \"role\" \"public_user_role_enum\" NOT NULL;")
    expect(migrationContent.split('\n').length).toEqual(4)
    await execute(migrationContent);
  });

  it('should alter property enum values', async () => {
    const DDL = `
        CREATE TYPE "public_user_role_enum" AS ENUM ('admin', 'user');
        CREATE TABLE "public"."user" ("id" SERIAL PRIMARY KEY UNIQUE,"role" public_user_role_enum NOT NULL);
    `;
    await execute(DDL);
    enum Role {
      ADMIN = 'admin',
      USER = 'user',
      MODERATOR = 'moderator',
    }
    class User extends BaseEntity {
      @PrimaryKey({ autoIncrement: true })
      id: number;

      @Enum(() => Role)
      role: Role;
    }

    Entity()(User);

    const migrator = new Migrator();
    await migrator.initConfigFile();
    await migrator.createMigration( 'test');
    const migrationFilePath = path.join(__dirname, '/test.sql');
    const migrationContent = fs.readFileSync(migrationFilePath, {encoding: 'utf-8'});

    expect(migrationContent).toContain("ALTER TABLE \"public\".\"user\" ALTER COLUMN \"role\" TYPE varchar(255);DROP TYPE IF EXISTS \"public_user_role_enum\";CREATE TYPE \"public_user_role_enum\" AS ENUM ('admin', 'user', 'moderator');ALTER TABLE \"public\".\"user\" ALTER COLUMN \"role\" TYPE \"public_user_role_enum\" USING \"role\"::text::\"public_user_role_enum\"")
    expect(migrationContent.split('\n').length).toEqual(1)
    await execute(migrationContent);
  });

  it('should alter property enum to string', async () => {
    const DDL = `
        CREATE TYPE "public_user_role_enum" AS ENUM ('admin', 'user');
        CREATE TABLE "public"."user" ("id" SERIAL PRIMARY KEY UNIQUE,"role" public_user_role_enum NOT NULL);
    `;
    await execute(DDL);
    class User extends BaseEntity {
      @PrimaryKey({ autoIncrement: true })
      id: number;

      @Property()
      role: string;
    }

    Entity()(User);

    const migrator = new Migrator();
    await migrator.initConfigFile();
    await migrator.createMigration( 'test');
    const migrationFilePath = path.join(__dirname, '/test.sql');
    const migrationContent = fs.readFileSync(migrationFilePath, {encoding: 'utf-8'});

    expect(migrationContent).toContain("ALTER TABLE \"public\".\"user\" ALTER COLUMN \"role\" TYPE character varying(255);\nDROP TYPE IF EXISTS \"public_user_role_enum\";")
    expect(migrationContent.split('\n').length).toEqual(2)
    await execute(migrationContent);
  });
})