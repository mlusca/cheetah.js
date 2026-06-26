import { describe, expect, test } from 'bun:test';
import { BunPgDriver } from '../src/driver/bun-pg.driver';
import {
  finalizeConnectionConfig,
  normalizeConfigModule,
} from '../src/config-loader';
import {BunMysqlDriver} from "../src";

describe('config-loader', () => {
  test('normalizeConfigModule unwraps nested default exports', () => {
    const config = {
      driver: BunPgDriver,
      host: 'db.local',
    };

    expect(normalizeConfigModule({ default: config })).toEqual(config);
    expect(normalizeConfigModule({ default: { default: config } })).toEqual(config);
    expect(normalizeConfigModule(config)).toEqual(config);
  });

  test('finalizeConnectionConfig fills missing driver', () => {
    const settings = finalizeConnectionConfig({
      host: 'db.local',
      port: 5432,
      username: 'app',
      password: 'secret',
      database: 'app_db',
    });

    expect(settings.driver).toBeOneOf([BunPgDriver, BunMysqlDriver]);
    expect(settings.host).toBe('db.local');
    expect(settings.database).toBe('app_db');
  });
});