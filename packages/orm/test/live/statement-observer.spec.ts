import { afterEach, describe, expect, test } from 'bun:test';
import type { Statement } from '../../src/driver/driver.interface';
import { statementObserver } from '../../src/live/statement-observer';

const SELECT: Statement<any> = { statement: 'select', table: 'users' };
const UPDATE: Statement<any> = { statement: 'update', table: 'users' };

afterEach(() => {
  statementObserver.reset();
});

describe('statementObserver', () => {
  test('does nothing when no listener is registered', () => {
    expect(() => {
      statementObserver.notifyRead(SELECT);
      statementObserver.notifyWrite(UPDATE);
      statementObserver.notifyWriteAttempt(UPDATE);
    }).not.toThrow();
  });

  test('routes reads and writes to their own listeners', () => {
    const reads: Statement<any>[] = [];
    const writes: Statement<any>[] = [];

    statementObserver.onRead(statement => reads.push(statement));
    statementObserver.onWrite(statement => writes.push(statement));

    statementObserver.notifyRead(SELECT);
    statementObserver.notifyWrite(UPDATE);

    expect(reads).toEqual([SELECT]);
    expect(writes).toEqual([UPDATE]);
  });

  test('lets the write-attempt listener veto by throwing', () => {
    statementObserver.onWriteAttempt(() => {
      throw new Error('write during compute');
    });

    expect(() => statementObserver.notifyWriteAttempt(UPDATE)).toThrow('write during compute');
  });

  test('reset detaches every listener', () => {
    let calls = 0;
    statementObserver.onRead(() => { calls++; });
    statementObserver.reset();
    statementObserver.notifyRead(SELECT);

    expect(calls).toBe(0);
  });
});
