import type { Statement } from '@carno.js/orm';
import { rowKey, tableKey } from '../graph/dep-key';
import type { Dependency, InvalidationEvent } from '../graph/types';

const WRITE_STATEMENTS = new Set(['insert', 'update', 'delete']);
const READ_STATEMENTS = new Set(['select', 'count']);

/**
 * Turn the column list the ORM generated into bare column names.
 * Returns null when the list is absent or contains an expression/star.
 */
export function normalizeColumns(columns: string[] | undefined): string[] | null {
    if (!columns || columns.length === 0) {
        return null;
    }

    const names = new Set<string>();

    for (const raw of columns) {
        const beforeAlias = raw.split(/\s+as\s+/i)[0].trim();
        const lastDot = beforeAlias.lastIndexOf('.');
        const bare = (lastDot === -1 ? beforeAlias : beforeAlias.slice(lastDot + 1))
            .replace(/["`\[\]]/g, '')
            .trim();

        if (bare === '' || bare === '*' || bare.includes('(')) {
            return null;
        }

        names.add(bare);
    }

    return [...names].sort();
}

function unquote(value: string): string {
    return value.replace(/["`\[\]]/g, '');
}

/** SQL statements carry a qualified and quoted table; keys use the table only. */
function tableNameOf(table: string): string {
    const lastPart = table.trim().split('.').pop() ?? table;
    return unquote(lastPart.trim());
}

function parseLiteral(raw: string): string | number {
    const trimmed = raw.trim();

    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        return trimmed.slice(1, -1);
    }

    return Number(trimmed);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unwrapOuterParentheses(value: string): string {
    let current = value.trim();

    while (current.startsWith('(') && current.endsWith(')')) {
        let depth = 0;
        let enclosesWholeExpression = true;

        for (let index = 0; index < current.length; index++) {
            if (current[index] === '(') {
                depth++;
            } else if (current[index] === ')') {
                depth--;

                if (depth === 0 && index !== current.length - 1) {
                    enclosesWholeExpression = false;
                    break;
                }
            }
        }

        if (!enclosesWholeExpression || depth !== 0) {
            break;
        }

        current = current.slice(1, -1).trim();
    }

    return current;
}

/**
 * Extract primary-key values only when the WHERE clause is exactly a primary
 * key equality or a primary-key IN list. Anything else degrades to the table.
 */
export function extractRowIds(
    where: string | undefined,
    primaryKeyColumn: string | undefined
): (string | number)[] | null {
    if (!where || !primaryKeyColumn) {
        return null;
    }

    const trimmed = unwrapOuterParentheses(where.trim());
    const column = `(?:[\\w"\`\\[\\]]+\\.)?["\`\\[]?${escapeRegExp(primaryKeyColumn)}["\`\\]]?`;

    const equality = new RegExp(`^${column}\\s*=\\s*(\\d+|'[^']*')$`, 'i').exec(trimmed);
    if (equality) {
        return [parseLiteral(equality[1])];
    }

    const inList = new RegExp(`^${column}\\s+IN\\s*\\(([^()]*)\\)$`, 'i').exec(trimmed);
    if (inList) {
        const items = inList[1].split(',').map(item => item.trim()).filter(item => item !== '');

        if (items.length === 0 || items.some(item => !/^(\d+|'[^']*')$/.test(item))) {
            return null;
        }

        return items.map(parseLiteral);
    }

    return null;
}

/** Dependencies registered by one read. Empty for writes. */
export function readDependencies(statement: Statement<any>, maxKeysPerRead: number): Dependency[] {
    if (!READ_STATEMENTS.has(statement.statement ?? '') || !statement.table) {
        return [];
    }

    const table = tableNameOf(statement.table);
    const columns = normalizeColumns(statement.columns);
    const ids = extractRowIds(statement.where, statement.primaryKeyColumnName);
    const deps: Dependency[] = [];

    if (ids && ids.length <= maxKeysPerRead) {
        for (const id of ids) {
            deps.push({ key: rowKey(table, id), columns });
        }
    } else {
        deps.push({ key: tableKey(table), columns });
    }

    // A joined read depends on every joined table too. We cannot attribute the
    // selected columns per table, so joins are wildcard.
    for (const join of statement.join ?? []) {
        if (join.joinTable) {
            deps.push({ key: tableKey(tableNameOf(join.joinTable)), columns: null });
        }
    }

    // Select-strategy relations execute these child statements directly via
    // SqlJoinManager, so they never pass through the ORM's root observer hook.
    // Their filters depend on the root rows and are not stable primary-key
    // predicates; track each child table as a wildcard instead.
    for (const selectJoin of statement.selectJoin ?? []) {
        if (selectJoin.table) {
            deps.push({ key: tableKey(tableNameOf(selectJoin.table)), columns: null });
        }
    }

    return deps;
}

function writtenColumns(statement: Statement<any>): string[] | null {
    if (statement.statement === 'delete') {
        return null;
    }

    const values = statement.values;

    if (!values) {
        return null;
    }

    const rows: Record<string, unknown>[] = Array.isArray(values) ? values : [values];
    const names = new Set<string>();

    for (const row of rows) {
        for (const name of Object.keys(row)) {
            names.add(unquote(name));
        }
    }

    return names.size === 0 ? null : [...names].sort();
}

function insertedIds(statement: Statement<any>): (string | number)[] | null {
    const pk = statement.primaryKeyColumnName;

    if (!pk || !statement.values) {
        return null;
    }

    const rows: Record<string, unknown>[] = Array.isArray(statement.values)
        ? statement.values
        : [statement.values];
    const ids: (string | number)[] = [];

    for (const row of rows) {
        const value = row[pk];

        if (typeof value !== 'string' && typeof value !== 'number') {
            return null;
        }

        ids.push(value);
    }

    return ids.length === 0 ? null : ids;
}

/** Invalidation events announced by one write. Empty for reads. */
export function writeEvents(statement: Statement<any>, maxKeysPerRead: number): InvalidationEvent[] {
    if (!WRITE_STATEMENTS.has(statement.statement ?? '') || !statement.table) {
        return [];
    }

    const table = tableNameOf(statement.table);
    const columns = writtenColumns(statement);
    const ids = statement.statement === 'insert'
        ? insertedIds(statement)
        : extractRowIds(statement.where, statement.primaryKeyColumnName);

    if (ids && ids.length <= maxKeysPerRead) {
        return ids.map(id => ({ key: rowKey(table, id), columns }));
    }

    return [{ key: tableKey(table), columns }];
}
