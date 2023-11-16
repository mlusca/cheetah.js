import { PgDriver } from '@cheetah.js/orm';
import { ConnectionSettings } from './packages/orm/src/driver/driver.interface';

const config: ConnectionSettings = {
  host: 'localhost',
  port: 5432,
  database: 'postgres',
  username: 'postgres',
  password: 'postgres',
  //@ts-ignore
  driver: PgDriver,
  migrationPath: '/packages/orm/test/migration'
};

export default config;