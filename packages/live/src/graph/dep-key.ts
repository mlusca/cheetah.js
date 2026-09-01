export type DepKey = string;

const ROW_SEPARATOR = '#';

/** Key naming a whole table: every row and every column of it. */
export function tableKey(table: string): DepKey {
    return `orm:${table}`;
}

/** Key naming one row by primary key. */
export function rowKey(table: string, id: string | number): DepKey {
    return `orm:${table}${ROW_SEPARATOR}${id}`;
}

/**
 * The key itself plus every key that contains it.
 *
 * The hierarchy is exactly two levels deep and the only separator is `#`:
 * `orm:users#42` is contained by `orm:users`. Colons are not hierarchical.
 */
export function ancestorsOf(key: DepKey): DepKey[] {
    const index = key.indexOf(ROW_SEPARATOR);

    if (index === -1) {
        return [key];
    }

    return [key, key.slice(0, index)];
}
