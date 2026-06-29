import { describe, expect, test } from 'bun:test';
import { BunPgDriver } from '../../src/driver/bun-pg.driver';

function createDriver(): BunPgDriver {
  return new BunPgDriver({
    host: 'localhost',
    port: 5432,
    username: 'user',
    password: 'pass',
    database: 'db',
    driver: BunPgDriver,
  });
}

describe('PostgreSQL array literal serialization', () => {
  test('formats native array columns as PostgreSQL array literals', () => {
    const driver = createDriver();

    expect(driver.formatLiteral([], { type: Array })).toBe("'{}'");
    expect(driver.formatLiteral(['alpha', 'with,comma'], { type: Array }))
      .toBe(`'{"alpha","with,comma"}'`);
  });

  test('escapes native text array values', () => {
    const driver = createDriver();

    expect(driver.formatLiteral(['quote " ok', "single ' ok", 'slash \\ ok'], { type: Array }))
      .toBe(`'{"quote \\" ok","single '' ok","slash \\\\ ok"}'`);
  });

  test('keeps json array columns serialized as JSON', () => {
    const driver = createDriver();

    expect(driver.formatLiteral([], { dbType: 'jsonb', type: Array })).toBe("'[]'");
    expect(driver.formatLiteral(['json'], { dbType: 'jsonb', type: Array })).toBe(`'["json"]'`);
  });
});
