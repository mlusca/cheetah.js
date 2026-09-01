import globby from 'globby';
import {promises as fs} from 'fs';
import path from 'path';
import {Metadata} from '@carno.js/core';
import {EntityStorage} from '../domain/entities';
import {Orm} from '../orm';
import {OrmService} from '../orm.service';
import {ConnectionSettings, DriverInterface} from '../driver/driver.interface';
import {ormSessionContext} from '../orm-session-context';
import {ENTITIES} from '../constants';
import type {Logger} from '../logger';
import {BunMysqlDriver} from '../driver/bun-mysql.driver';
import {
  DriverType,
  getDefaultConnectionSettings,
  getDriverClass,
  getDriverType,
} from '../driver/driver-factory';

export type DatabaseTestContext = {
  orm: Orm<DriverInterface>;
  executeSql: (sql: string) => Promise<{ rows: unknown[] }>;
  driverType: DriverType;
  getDbType: () => 'postgres' | 'mysql';
};

export type DatabaseTestOptions = {
  schema?: string;
  entityFile?: string;
  logger?: Logger;
  connection?: Partial<ConnectionSettings>;
};

type DatabaseSession = {
  orm: Orm<DriverInterface>;
  schema: string;
  storage: EntityStorage;
  driverType: DriverType;
};

type DatabaseTestRoutine = (context: DatabaseTestContext) => Promise<void>;

const DEFAULT_SCHEMA = 'public';

/**
 * Pool size for a test session.
 *
 * Sessions are cached per entity set and never closed, so every distinct set a
 * suite touches holds its pool open for the life of the process. At the driver
 * default that is ten sockets each, and a full `bun test` run exhausts
 * Postgres's client slots. A test issues one statement at a time; two is
 * headroom, not a limit. Override it through `options.connection.max`.
 */
const TEST_POOL_SIZE = 2;

function getDefaultConnection(options?: DatabaseTestOptions): ConnectionSettings {
  const driverType = getDriverType();
  const driverClass = getDriverClass(driverType);
  const settings = getDefaultConnectionSettings(driverType);
  const databaseName = resolveTestDatabaseName(options);

  if (driverType === 'mysql' && databaseName) {
    settings.database = databaseName;
  }

  return {
    ...settings,
    max: TEST_POOL_SIZE,
    driver: driverClass,
  };
}

type CachedSession = {
  orm: Orm<DriverInterface>;
  schema: string;
  storage: EntityStorage;
  driverType: DriverType;
};

const sessionCache = new Map<string, CachedSession>();

function getCacheKey(options: DatabaseTestOptions): string {
  const connection = resolveConnection(options.connection, options);
  const entitySignature = resolveEntitySignature();
  const driverType = getDriverType();

  return JSON.stringify({
    host: connection.host,
    port: connection.port,
    database: connection.database,
    schema: options.schema ?? DEFAULT_SCHEMA,
    entityFile: options.entityFile,
    migrationPath: connection.migrationPath,
    entitySignature,
    driverType,
  });
}

function resolveEntitySignature(): string {
  const entities = Metadata.get(ENTITIES, Reflect) || [];

  return buildEntitySignature(entities);
}

function buildEntitySignature(
  entities: Array<{ target?: { name?: string } }>,
): string {
  if (entities.length < 1) {
    return 'none';
  }

  const names = entities.map((entity) => entity.target?.name ?? 'unknown');

  return names.sort().join('|');
}

export async function withDatabase(
  tables: string[],
  routine: DatabaseTestRoutine,
  options?: DatabaseTestOptions,
): Promise<void>;

export async function withDatabase(
  routine: DatabaseTestRoutine,
  options?: DatabaseTestOptions,
  tables?: string[],
): Promise<void>;

export async function withDatabase(
  arg1: DatabaseTestRoutine | string[],
  arg2?: DatabaseTestRoutine | DatabaseTestOptions,
  arg3?: DatabaseTestOptions | string[],
): Promise<void> {
  const {routine: targetRoutine, options: targetOptions, statements} = await normalizeArgs(
    arg1,
    arg2,
    arg3,
  );

  const cacheKey = getCacheKey(targetOptions);
  let cachedSession = sessionCache.get(cacheKey);
  const schemaStatements = await resolveSchemaStatements(statements, targetOptions);

  if (!cachedSession) {
    const session = await createSession(targetOptions);
    cachedSession = {
      orm: session.orm,
      schema: session.schema,
      storage: session.storage,
      driverType: session.driverType,
    };
    sessionCache.set(cacheKey, cachedSession);
  }

  await runWithSession(cachedSession, async () => {
    const context = buildContext(cachedSession.orm, cachedSession.driverType);

    await dropAndRecreateSchema(context, cachedSession.schema);
    await prepareSchema(context, cachedSession.schema);
    await createTables(context, schemaStatements);
    await targetRoutine(context);
  });
}

async function createSession(options: DatabaseTestOptions): Promise<DatabaseSession> {
  const orm: Orm<DriverInterface> = new Orm<DriverInterface>();
  const storage = new EntityStorage();
  const driverType = getDriverType();

  await initializeOrm(orm, storage, options);

  return {orm, schema: options.schema ?? DEFAULT_SCHEMA, storage, driverType};
}

async function initializeOrm(
  orm: Orm<DriverInterface>,
  storage: EntityStorage,
  options: DatabaseTestOptions,
): Promise<void> {

  if (options.entityFile) {
    const entityFiles = await globby(options.entityFile, {absolute: true});

    for (const file of entityFiles) {
      await import(file);
    }
  }

  const service = new OrmService(orm, storage, options.entityFile);
  const connection = resolveConnection(options.connection, options);

  if (getDriverType() === 'mysql') {
    await ensureMysqlDatabase(connection);
  }

  await service.onInit(connection);
}

async function runWithSession(
  session: CachedSession,
  routine: () => Promise<void>,
): Promise<void> {
  await ormSessionContext.run(
    {orm: session.orm, storage: session.storage},
    routine,
  );
}

function resolveConnection(
  overrides: Partial<ConnectionSettings> | undefined,
  options?: DatabaseTestOptions,
): ConnectionSettings {
  const defaultConnection = getDefaultConnection(options);

  if (!overrides) {
    return defaultConnection;
  }

  return {
    ...defaultConnection,
    ...overrides,
    driver: overrides.driver ?? defaultConnection.driver,
  };
}

function buildContext(orm: Orm<DriverInterface>, driverType: DriverType): DatabaseTestContext {
  return {
    orm,
    executeSql: (sql: string) => executeSql(orm, sql),
    driverType,
    getDbType: () => orm.driverInstance?.dbType || 'postgres',
  };
}

async function executeSql(orm: Orm<DriverInterface>, sql: string): Promise<{ rows: unknown[] }> {
  if (!orm.driverInstance) {
    throw new Error('Database driver not initialized. Call withDatabase() before executing SQL.');
  }

  let adaptedSql = sql;

  if (orm.driverInstance.dbType === 'mysql') {
    adaptedSql = adaptSqlForMysql(sql);
  }

  const result = await orm.driverInstance.executeSql(adaptedSql);

  return {rows: Array.isArray(result) ? result : []};
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
  adapted = adapted.replace(/"([^"]+)"/g, '`$1`');

  for (const [typeName, enumDefinition] of Object.entries(enumTypes)) {
    const typePattern = new RegExp(`\\b${typeName}\\b`, 'g');
    adapted = adapted.replace(typePattern, enumDefinition);
  }

  return adapted;
}

async function createTables(context: DatabaseTestContext, statements: string[]): Promise<void> {
  const payload = statements.filter(Boolean);

  if (payload.length < 1) {
    return;
  }

  await executeStatements(context, payload);
}

async function executeStatements(context: DatabaseTestContext, statements: string[]): Promise<void> {
  for (const statement of statements) {
    await context.executeSql(statement);
  }
}

async function dropAndRecreateSchema(context: DatabaseTestContext, schema: string): Promise<void> {
  const dbType = context.getDbType();

  if (dbType === 'mysql') {
    await cleanupMysqlDatabase(context);

    return;
  }

  await context.executeSql(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema};`);
}

async function cleanupMysqlDatabase(context: DatabaseTestContext): Promise<void> {
  await context.executeSql('SET FOREIGN_KEY_CHECKS = 0');

  const result = await context.executeSql(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`
  );

  for (const row of result.rows as any[]) {
    const tableName = row.table_name || row.TABLE_NAME;

    await context.executeSql(`DROP TABLE IF EXISTS \`${tableName}\``);
  }

  await context.executeSql('SET FOREIGN_KEY_CHECKS = 1');
}

type WithDatabaseArgs = {
  routine: DatabaseTestRoutine;
  options: DatabaseTestOptions;
  statements: string[];
};

async function normalizeArgs(
  tablesOrRoutine: DatabaseTestRoutine | string[],
  routineOrOptions: DatabaseTestOptions | DatabaseTestRoutine | undefined,
  optionsOrStatements: string[] | DatabaseTestOptions | undefined,
): Promise<WithDatabaseArgs> {
  if (Array.isArray(tablesOrRoutine)) {
    return {
      routine: routineOrOptions as DatabaseTestRoutine,
      options: (optionsOrStatements as DatabaseTestOptions) ?? {},
      statements: tablesOrRoutine,
    };
  }

  return {
    routine: tablesOrRoutine,
    options: (routineOrOptions as DatabaseTestOptions) ?? {},
    statements: Array.isArray(optionsOrStatements) ? optionsOrStatements : [],
  };
}

async function resolveSchemaStatements(
  statements: string[],
  options: DatabaseTestOptions,
): Promise<string[]> {
  const explicit = statements.filter(Boolean);

  if (explicit.length > 0) {
    return explicit;
  }

  const fromMigrations = await loadStatementsFromMigrations(options);

  return fromMigrations.filter(Boolean);
}

function normalizeGlobPatterns(patterns: string[]): string[] {
  return patterns.map(normalizeGlobPattern);
}

function normalizeGlobPattern(pattern: string): string {
  return pattern.replace(/\\/g, '/');
}

async function loadStatementsFromMigrations(options: DatabaseTestOptions): Promise<string[]> {
  const connection = resolveConnection(options.connection, options);
  const patterns = await resolveMigrationPatterns(connection);

  if (patterns.length < 1) {
    return [];
  }

  const normalizedPatterns = normalizeGlobPatterns(patterns);
  const files = await globby(normalizedPatterns, {absolute: true, expandDirectories: false});

  if (files.length < 1) {
    return [];
  }

  const orderedFiles = sortMigrationFiles(files);

  return extractStatementsFromFiles(orderedFiles);
}

async function resolveMigrationPatterns(
  connection: ConnectionSettings,
): Promise<string[]> {
  if (connection.migrationPath) {
    return [connection.migrationPath];
  }

  const inferred = await inferMigrationPathFromConfig();

  if (inferred) {
    return [inferred];
  }

  return [];
}

function resolveTestDatabaseName(options?: DatabaseTestOptions): string | undefined {
  const envFile = process.env.BUN_TEST_FILE || process.env.BUN_TEST_FILE_PATH;
  const filePath = options?.entityFile ?? envFile ?? findTestFileFromStack();

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

async function ensureMysqlDatabase(settings: ConnectionSettings): Promise<void> {
  if (!settings.database) {
    return;
  }

  const defaultMysql = getDefaultConnectionSettings('mysql');
  const adminSettings: ConnectionSettings = {
    ...settings,
    database: defaultMysql.database || 'mysql',
  };
  const adminDriver = new BunMysqlDriver(adminSettings);

  await adminDriver.connect();
  await adminDriver.executeSql(`CREATE DATABASE IF NOT EXISTS \`${settings.database}\``);
  await adminDriver.disconnect();
}

async function inferMigrationPathFromConfig(): Promise<string | undefined> {
  const configFile = await findConfigFile();

  if (!configFile) {
    return undefined;
  }

  const contents = await safeReadFile(configFile);

  if (!contents) {
    return undefined;
  }

  return extractMigrationPath(contents, configFile);
}

async function findConfigFile(): Promise<string | undefined> {
  const candidates = [
    'carno.config.ts',
    'carno.config.js',
    'carno.config.mjs',
    'carno.config.cjs',
  ];

  for (const file of candidates) {
    const fullPath = path.resolve(process.cwd(), file);
    const exists = await fileExists(fullPath);

    if (exists) {
      return fullPath;
    }
  }

  return undefined;
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function safeReadFile(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

function extractMigrationPath(source: string, file: string): string | undefined {
  const match = source.match(/migrationPath\s*:\s*['"`]([^'"`]+)['"`]/);

  if (!match) {
    return undefined;
  }

  const candidate = match[1].trim();

  if (path.isAbsolute(candidate)) {
    return candidate;
  }

  const baseDir = path.dirname(file);

  return path.resolve(baseDir, candidate);
}

async function extractStatementsFromFiles(files: string[]): Promise<string[]> {
  const statements: string[] = [];

  for (const file of files) {
    const payload = await safeReadFile(file);

    if (!payload) {
      continue;
    }

    const extracted = extractStatements(payload);
    statements.push(...extracted);
  }

  return Array.from(new Set(statements));
}

function extractStatements(payload: string): string[] {
  const matches =
    payload.match(
      /(CREATE\s+(?:TABLE|TYPE|INDEX|SCHEMA)[\s\S]*?;|ALTER\s+TABLE[\s\S]*?\bADD\b[\s\S]*?;)/gi,
    ) ?? [];

  return matches.map((statement) => statement.replace(/\s+/g, ' ').trim());
}

function sortMigrationFiles(files: string[]): string[] {
  return [...files].sort((first, second) =>
    path.basename(first).localeCompare(path.basename(second), undefined, {numeric: true}),
  );
}

async function prepareSchema(context: DatabaseTestContext, schema: string): Promise<void> {
  const dbType = context.getDbType();

  if (dbType === 'mysql') {
    return;
  }

  await context.executeSql(buildCreateSchemaStatement(schema));
  await ensureSearchPath(context, schema);
}

function buildCreateSchemaStatement(schema: string): string {
  return `CREATE SCHEMA IF NOT EXISTS ${schema};`;
}

async function ensureSearchPath(context: DatabaseTestContext, schema: string): Promise<void> {
  await context.executeSql(buildSearchPathStatement(schema));
}

function buildSearchPathStatement(schema: string): string {
  return `SET search_path TO ${schema};`;
}
