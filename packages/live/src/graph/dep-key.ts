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

/** The table an ORM key names, or null for a key from another namespace. */
export function tableOfKey(key: DepKey): string | null {
    if (!key.startsWith('orm:')) {
        return null;
    }

    const rest = key.slice('orm:'.length);
    const separator = rest.indexOf(ROW_SEPARATOR);

    return separator === -1 ? rest : rest.slice(0, separator);
}
