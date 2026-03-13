import path from 'path';
import { EntityStorage } from 'packages/orm/src/domain/entities';
import { CacheService } from '@carno.js/core';
import { spyOn } from 'bun:test';
import { Orm, OrmService, setDebugEnabled, resetLogger } from "../src";
import { BunMysqlDriver } from '../src/driver/bun-mysql.driver';
import { ConnectionSettings, DriverInterface } from "../src/driver/driver.interface";
import {
  getDefaultConnectionSettings,
  getDriverClass,
  getDriverType,
} from "../src/driver/driver-factory";

const cacheService = new CacheService();

export let app: Orm<DriverInterface>
export let mockLogger: ReturnType<typeof spyOn>
export { cacheService }

export async function startDatabase(entityFile: string | undefined = undefined) {
  if (app?.driverInstance) {
    try {
      await app.disconnect();
    } catch {
      // Ignore stale connections from a previous test app instance.
    }
  }

  resetLogger();
  //setDebugEnabled(true);

  app = new Orm(cacheService);
  mockLogger = spyOn(app.logger, 'debug');

  const driverType = getDriverType();
  const driver = getDriverClass(driverType);
  const settings = getDefaultConnectionSettings(driverType);
  const databaseName = driverType === 'mysql'
    ? resolveTestDatabaseName(entityFile)
    : undefined;

  const service = new OrmService(app, new EntityStorage(), entityFile);

  if (driverType === 'mysql' && databaseName && databaseName !== settings.database) {
    await ensureMysqlDatabase(settings, databaseName);
  }

  await service.onInit({
    ...settings,
    database: databaseName ?? settings.database,
    driver,
    max: 10,
  });
}

export async function purgeDatabase(schema: string = 'public') {
  if (!app?.driverInstance) {
    throw new Error('Database not initialized. Connection probably failed in startDatabase()');
  }

  if (app.driverInstance.dbType === 'mysql') {
    await purgeMysqlDatabase();

    return;
  }

  await app.driverInstance.executeSql(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema};`);
}

async function purgeMysqlDatabase() {
  await app.driverInstance.executeSql('SET FOREIGN_KEY_CHECKS = 0');

  const result = await app.driverInstance.executeSql(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`
  );

  const rows = Array.isArray(result) ? result : [];

  for (const row of rows as any[]) {
    const tableName = row.table_name || row.TABLE_NAME;

    await app.driverInstance.executeSql(`DROP TABLE IF EXISTS \`${tableName}\``);
  }

  await app.driverInstance.executeSql('SET FOREIGN_KEY_CHECKS = 1');
}

export async function execute(sql: string) {
  if (!app?.driverInstance) {
    console.log("Database not initialized. Connection probably failed in startDatabase()")
    throw new Error('Database not initialized. Connection probably failed in startDatabase()');
  }


  let adaptedSql = sql;

  if (app.driverInstance.dbType === 'mysql') {
    adaptedSql = adaptSqlForMysql(sql);
  }

  const result = await app.driverInstance.executeSql(adaptedSql);

  return { rows: Array.isArray(result) ? result : [] };
}

function resolveTestDatabaseName(entityFile?: string): string | undefined {
  const envFile = process.env.BUN_TEST_FILE || process.env.BUN_TEST_FILE_PATH;
  const filePath = entityFile ?? envFile ?? findTestFileFromStack();

  if (!filePath) {
    return undefined;
  }

  const base = path
    .basename(filePath)
    .replace(/\W+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

  if (!base) {
    return undefined;
  }

  return `mysql_test_${base}`.slice(0, 63);
}

function findTestFileFromStack(): string | undefined {
  const stack = new Error().stack?.split('\n') ?? [];

  for (const line of stack) {
    const match = line.match(/\(([^)]+?\.(?:test|spec)\.[jt]s)(?::\d+:\d+)?\)/)
      ?? line.match(/at ([^ ]+?\.(?:test|spec)\.[jt]s)(?::\d+:\d+)?/);

    if (match?.[1]) {
      return match[1].replace(/^file:\/\//, '');
    }
  }

  return undefined;
}

async function ensureMysqlDatabase(
  settings: ConnectionSettings,
  databaseName: string,
): Promise<void> {
  const adminSettings: ConnectionSettings = {
    ...settings,
    database: settings.database || 'mysql',
  };

  let lastError: any;

  // Retry up to 5 times with exponential backoff
  for (let i = 0; i < 5; i++) {
    const adminDriver = new BunMysqlDriver(adminSettings);
    try {
      await adminDriver.connect();
      await adminDriver.executeSql(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\``);
      await adminDriver.disconnect();
      return;
    } catch (err: any) {
      lastError = err;
      // Close connection if it was opened but failed during query
      try { await adminDriver.disconnect(); } catch { }

      // Wait 1s, 2s, 4s, 8s...
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
    }
  }

  throw lastError || new Error('Failed to ensure MySQL database');
}

function adaptSqlForMysql(sql: string): string {
  let adapted = sql;
  const enumTypes: Record<string, string> = {};

  adapted = adapted.replace(
    /CREATE\s+TYPE\s+"?([A-Za-z0-9_]+)"?\s+AS\s+ENUM\s*\(([^;]+)\);?/gi,
    (_match, typeName: string, values: string) => {
      enumTypes[typeName] = `ENUM(${values})`;
      return '';
    },
  );

  adapted = adapted.replace(/SERIAL\s+PRIMARY\s+KEY/gi, 'INT AUTO_INCREMENT PRIMARY KEY');
  adapted = adapted.replace(/SERIAL/gi, 'INT AUTO_INCREMENT');
  adapted = adapted.replace(/\buuid\b/gi, 'CHAR(36)');
  adapted = adapted.replace(/TIMESTAMPTZ/gi, 'TIMESTAMP');
  adapted = adapted.replace(/NOW\(\)/gi, 'CURRENT_TIMESTAMP');
  adapted = adapted.replace(/boolean/gi, 'TINYINT(1)');
  adapted = adapted.replace(/TRUE/gi, '1');
  adapted = adapted.replace(/FALSE/gi, '0');
  adapted = adapted.replace(
    /'(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})\.\d{3}Z'/g,
    "'$1 $2'",
  );
  adapted = adapted.replace(/"public"\./g, '');
  adapted = adapted.replace(/public\./g, '');
  adapted = adapted.replace(/"test_schema"\./g, '');

  for (const [typeName, enumDefinition] of Object.entries(enumTypes)) {
    const typePattern = new RegExp(`\\b${typeName}\\b`, 'g');
    adapted = adapted.replace(typePattern, enumDefinition);
  }

  // Remove inline REFERENCES clauses (MySQL doesn't support PostgreSQL inline FK syntax)
  adapted = adapted.replace(/\s+REFERENCES\s+`[^`]+`\s*\(`[^`]+`\)/gi, '');
  adapted = adapted.replace(/\s+REFERENCES\s+"[^"]+"\s*\("[^"]+"\)/gi, '');
  adapted = adapted.replace(/"([^"]+)"/g, '`$1`');

  return adapted;
}
