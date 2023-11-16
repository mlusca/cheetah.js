import { PgDriver } from '@cheetah.js/orm';
import { ConnectionSettings } from '@cheetah.js/orm/driver/driver.interface';

const config: ConnectionSettings<any> = {
  host: 'localhost',
  port: 5432,
  database: 'postgres',
  username: 'postgres',
  password: 'postgres',
  driver: PgDriver,
  migrationPath: '/packages/orm/test/migration'
};

export default config;