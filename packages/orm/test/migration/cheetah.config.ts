import { PgDriver } from '@cheetah.js/orm';

const config = {
  host: 'localhost',
  port: 5432,
  database: 'postgres',
  username: 'postgres',
  password: 'postgres',
  driver: PgDriver,
  migrationPath: '/packages/orm/test/migration'
};

export default config;