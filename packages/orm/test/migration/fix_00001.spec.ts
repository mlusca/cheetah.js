import { afterEach, beforeEach, describe, expect, it, jest, test } from "bun:test";
import { execute, mockLogger, purgeDatabase, startDatabase } from "../node-database";
import { Metadata } from "@cheetah.js/core";
import { ENTITIES } from "../../src/constants";
import { BaseEntity, Email, Entity, ManyToOne, Migrator, PrimaryKey, Property } from "../../src";
import { v4 } from "uuid";
import path from "path";
import fs from "fs";

describe("error on length", () => {
  beforeEach(async () => {
    await startDatabase();
    Metadata.delete(ENTITIES, Reflect);
  });

  afterEach(async () => {
    await purgeDatabase();
    (mockLogger as jest.Mock).mockClear();
  });

  class User extends BaseEntity {
    @Property({ length: 100 })
    username: string;

    @Property({ index: true, unique: true })
    email: string;

    @Property({ hidden: true, length: 20 })
    password: string;

    @Property({ index: true })
    token?: string;

    @PrimaryKey({ dbType: "uuid" })
    id: string = v4();

    @Property({ length: 3 })
    createdAt: Date = new Date();

    @Property({ length: 3, onUpdate: () => new Date() })
    updatedAt: Date = new Date();
  }

  test("1", async () => {
    await execute(
      "" +
        'CREATE TABLE "public"."user" ("id" uuid NOT NULL PRIMARY KEY UNIQUE,"created_at" timestamp(3) NOT NULL,"updated_at" timestamp(3) NOT NULL,"username" character varying(255) NOT NULL,"email" character varying(255) NOT NULL UNIQUE,"password" character varying(255) NOT NULL,"token" character varying(255));' +
        'CREATE INDEX "email_index" ON "public"."user" ("email");' +
        'CREATE INDEX "token_index" ON "public"."user" ("token");'
    );

    Entity()(User);
    const migrator = new Migrator();
    await migrator.initConfigFile();
    await migrator.createMigration("test");

    // Caminho para o arquivo gerado
    const migrationFilePath = path.join(__dirname, "/test.sql");

    // Leitura do conteúdo do arquivo
    const migrationContent = fs.readFileSync(migrationFilePath, { encoding: "utf-8" });
    expect(migrationContent).toContain(
      'ALTER TABLE "public"."user" ALTER COLUMN "password" TYPE character varying(20);\n' + 'ALTER TABLE "public"."user" ALTER COLUMN "username" TYPE character varying(100);'
    );
  });
});
