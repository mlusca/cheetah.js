/**
 * SQL String Escape Utility
 *
 * Provides secure string escaping for SQL queries.
 *
 * SECURITY NOTE: While this escaping is robust, parameterized queries
 * (prepared statements) are the gold standard for SQL injection prevention.
 * This utility should be used only when parameterized queries are not feasible.
 */

const QUOTE_REGEX = /'/g;
const BACKSLASH_REGEX = /\\/g;

/**
 * Escape a string for safe inclusion inside a single-quoted SQL literal.
 *
 * @param escapeBackslash When `true` (default) backslashes are doubled. This is
 *   REQUIRED for MySQL, where `\` is an escape character inside string literals
 *   (otherwise `\'` breaks out of the literal). It MUST be `false` for
 *   PostgreSQL with `standard_conforming_strings = on` (the default), where `\`
 *   is a literal character — doubling it there corrupts stored data. The default
 *   is `true` so that an un-specified call site can never *under*-escape.
 */
export function escapeString(value: string, escapeBackslash = true): string {
  if (value.indexOf('\x00') !== -1) {
    throw new Error(
      'SQL injection attempt detected: null byte in string value',
    );
  }

  const quoted = value.replace(QUOTE_REGEX, "''");

  return escapeBackslash ? quoted.replace(BACKSLASH_REGEX, '\\\\') : quoted;
}

/**
 * A column/relation property that resolves to a real, decorator-registered
 * column is always a plain SQL identifier. When the ORM cannot resolve a key to
 * known metadata it previously fell back to interpolating the key verbatim,
 * which allowed SQL injection if filter keys were attacker-controlled
 * (e.g. `repository.find({ where: req.query })`). Reject anything that is not a
 * bare identifier before it reaches the query string.
 */
const SAFE_IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertSafeIdentifier(identifier: string): string {
  if (!SAFE_IDENTIFIER_REGEX.test(identifier)) {
    throw new Error(
      `Unsafe SQL identifier rejected: ${JSON.stringify(identifier)}`,
    );
  }

  return identifier;
}

export function escapeLikePattern(value: string): string {
  const escaped = escapeString(value);

  return escaped.replace(/[%_]/g, (char) => '\\' + char);
}
