
import { Orm, OrmService, PgDriver } from '@cheetah.js/orm';
import { EntityStorage } from 'packages/orm/src/domain/entities';
import { LoggerService } from '@cheetah.js/core/services/logger.service';
import { spyOn } from 'bun:test';

const loggerInstance = new LoggerService({applicationConfig: {logger: { level: 'info'}}} as any)
export let app: Orm<PgDriver>
export const mockLogger = spyOn(loggerInstance, 'debug')

export async function startDatabase(entityFile: string | undefined = undefined, logger: LoggerService = loggerInstance) {
  const service = new OrmService(new EntityStorage(), entityFile)
  app = new Orm({
    host: 'localhost',
    port: 5432,
    database: 'postgres',
    username: 'postgres',
    password: 'postgres',
    driver: PgDriver,
  }, logger)
  service.onInit()

  await app.connect()
}

export async function purgeDatabase(schema: string = 'public') {
  await app.driverInstance.executeSql(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema};`);
}

export async function execute(sql: string) {
  return await app.driverInstance.executeSql(sql);
}