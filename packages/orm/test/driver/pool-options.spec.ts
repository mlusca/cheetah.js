import {describe, expect, it} from 'bun:test';
import {BunPgDriver} from '../../src/driver/bun-pg.driver';
import {getDefaultConnectionSettings, getDriverType} from '../../src/driver/driver-factory';

/**
 * The pool size a caller asks for has to reach the pool.
 *
 * Backend pids are the only honest witness: a pool of one can serve concurrent
 * queries only by serialising them onto its single connection, so every query
 * reports the same pid. A pool that silently fell back to the driver default
 * would spread them across several.
 */
describe('BunDriverBase pool options', () => {
  const isPostgres = getDriverType() === 'postgres';
  const test = isPostgres ? it : it.skip;

  test('honours an explicit max on the primary connection', async () => {
    const driver = new BunPgDriver({
      ...getDefaultConnectionSettings('postgres'),
      max: 1,
    } as any);

    await driver.connect();

    try {
      const results = await Promise.all(
        Array.from({length: 4}, () => driver.executeSql('SELECT pg_backend_pid() AS pid')),
      );
      const pids = new Set(results.map((rows: any) => Number(rows[0].pid)));

      expect(pids.size).toBe(1);
    } finally {
      await driver.disconnect();
    }
  });
});
