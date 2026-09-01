/**
 * The SQL the Postgres emitter installs.
 *
 * It lives in its own module with no I/O so it can be asserted on without a
 * database, and so the one place that concatenates identifiers into SQL is one
 * short file you can read end to end.
 */

const BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class UnsafeIdentifierError extends Error {
    constructor(kind: string, value: string) {
        super(
            `Refusing to build SQL with an unsafe ${kind}: ${JSON.stringify(value)}. ` +
            `Only bare names matching [A-Za-z_][A-Za-z0-9_]* are accepted.`
        );
        this.name = 'UnsafeIdentifierError';
    }
}

/** Every identifier interpolated into the DDL below passes through here. */
export function assertIdentifier(kind: string, value: string): string {
    if (!BARE_IDENTIFIER.test(value)) {
        throw new UnsafeIdentifierError(kind, value);
    }

    return value;
}

export const TRIGGER_FUNCTION_NAME = 'carno_live_notify';

export function triggerNameOf(table: string): string {
    return `carno_live_${assertIdentifier('table', table)}`;
}

/**
 * The shared trigger function. Installed once; every table's trigger passes it
 * the primary key column and the channel as arguments.
 *
 * Two decisions are baked in here rather than on the JavaScript side:
 * an UPDATE whose jsonb diff is empty does not notify at all, because a write
 * that changed nothing must not wake a single subscriber; and a payload over
 * the ceiling degrades to the whole table instead of being truncated into
 * something that would parse as a different row.
 */
export function createFunctionSql(maxPayloadBytes: number): string {
    if (!Number.isInteger(maxPayloadBytes) || maxPayloadBytes <= 0) {
        throw new Error(`maxPayloadBytes must be a positive integer, got ${maxPayloadBytes}.`);
    }

    return `
CREATE OR REPLACE FUNCTION ${TRIGGER_FUNCTION_NAME}() RETURNS trigger AS $carno$
DECLARE
  pk_column text := TG_ARGV[0];
  channel text := TG_ARGV[1];
  new_row jsonb;
  old_row jsonb;
  changed text[];
  row_id text;
  payload text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    new_row := to_jsonb(OLD);
  ELSE
    new_row := to_jsonb(NEW);
  END IF;

  row_id := new_row ->> pk_column;

  IF TG_OP = 'UPDATE' THEN
    old_row := to_jsonb(OLD);

    SELECT array_agg(entry.key ORDER BY entry.key) INTO changed
    FROM jsonb_each(new_row) AS entry
    WHERE entry.value IS DISTINCT FROM (old_row -> entry.key);

    IF changed IS NULL THEN
      RETURN NULL;
    END IF;
  END IF;

  payload := json_build_object('t', TG_TABLE_NAME, 'i', row_id, 'c', changed)::text;

  IF octet_length(payload) > ${maxPayloadBytes} THEN
    payload := json_build_object('t', TG_TABLE_NAME, 'i', NULL, 'c', NULL)::text;
  END IF;

  PERFORM pg_notify(channel, payload);
  RETURN NULL;
END;
$carno$ LANGUAGE plpgsql;
`.trim();
}

export function createTriggerSql(table: string, primaryKey: string, channel: string): string {
    const safeTable = assertIdentifier('table', table);
    const safeKey = assertIdentifier('primary key column', primaryKey);
    const safeChannel = assertIdentifier('channel', channel);
    const trigger = triggerNameOf(safeTable);

    return `
DROP TRIGGER IF EXISTS ${trigger} ON ${safeTable};
CREATE TRIGGER ${trigger}
AFTER INSERT OR UPDATE OR DELETE ON ${safeTable}
FOR EACH ROW EXECUTE FUNCTION ${TRIGGER_FUNCTION_NAME}('${safeKey}', '${safeChannel}');
`.trim();
}

export function dropTriggerSql(table: string): string {
    return `DROP TRIGGER IF EXISTS ${triggerNameOf(table)} ON ${assertIdentifier('table', table)};`;
}
