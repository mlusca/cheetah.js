import { describe, test, expect } from 'bun:test';
import { assertSafeIdentifier, escapeString, escapeLikePattern } from '../src/utils/sql-escape';

describe('assertSafeIdentifier', () => {
  test('accepts plain column identifiers', () => {
    expect(assertSafeIdentifier('name')).toBe('name');
    expect(assertSafeIdentifier('created_at')).toBe('created_at');
    expect(assertSafeIdentifier('_private')).toBe('_private');
    expect(assertSafeIdentifier('col123')).toBe('col123');
  });

  test('rejects identifiers that could break out of SQL', () => {
    expect(() => assertSafeIdentifier('a = 1 OR 1=1')).toThrow();
    expect(() => assertSafeIdentifier('id; DROP TABLE users')).toThrow();
    expect(() => assertSafeIdentifier('a") ; --')).toThrow();
    expect(() => assertSafeIdentifier('1col')).toThrow();
    expect(() => assertSafeIdentifier('')).toThrow();
  });
});

describe('escapeString', () => {
  test('doubles single quotes so a value cannot terminate the literal', () => {
    expect(escapeString("x' OR '1'='1")).toBe("x'' OR ''1''=''1");
  });

  test('MySQL mode (default) doubles backslashes to block the backslash-quote breakout', () => {
    // input: backslash + quote  ->  \\''   (escaped backslash + escaped quote)
    expect(escapeString("\\'", true)).toBe("\\\\''");
  });

  test('PostgreSQL mode keeps backslashes literal (standard_conforming_strings)', () => {
    // input: backslash + quote  ->  \''    (literal backslash + escaped quote)
    expect(escapeString("\\'", false)).toBe("\\''");
  });

  test('rejects null bytes', () => {
    expect(() => escapeString('a\x00b')).toThrow();
  });
});

describe('escapeLikePattern', () => {
  test('escapes wildcard metacharacters', () => {
    expect(escapeLikePattern('100%_off')).toBe('100\\%\\_off');
  });
});
