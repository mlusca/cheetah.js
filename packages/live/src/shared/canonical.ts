/**
 * Deterministic JSON canonicalization, shared verbatim by client and server.
 *
 * Both sides MUST produce byte-identical output for the same logical value:
 * the instance id and the content hash are derived from it, so a divergence
 * silently breaks subscription dedupe and the hydration handshake instead of
 * failing loudly.
 */
export class NonSerializableInputError extends Error {
    constructor(
        public readonly path: string,
        public readonly received: string
    ) {
        super(`Live input at "${path}" is not serializable (received ${received}).`);
        this.name = 'NonSerializableInputError';
    }
}

export function canonical(value: unknown, path: string = '$'): string {
    if (value === null || value === undefined) {
        return 'null';
    }

    switch (typeof value) {
        case 'boolean':
            return value ? 'true' : 'false';
        case 'number':
            if (!Number.isFinite(value)) {
                throw new NonSerializableInputError(path, String(value));
            }
            // -0 and 0 are the same input as far as a query is concerned.
            return Object.is(value, -0) ? '0' : String(value);
        case 'string':
            return JSON.stringify(value);
        case 'bigint':
        case 'function':
        case 'symbol':
            throw new NonSerializableInputError(path, typeof value);
    }

    if (Array.isArray(value)) {
        const items = value.map((item, index) => canonical(item, `${path}[${index}]`));
        return `[${items.join(',')}]`;
    }

    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
        // Date, Map, Set, class instances: no agreed wire form, so refuse
        // rather than guess one the client would canonicalize differently.
        const name = (value as object).constructor?.name ?? 'object';
        throw new NonSerializableInputError(path, name);
    }

    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

    const body = entries
        .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item, `${path}.${key}`)}`)
        .join(',');

    return `{${body}}`;
}
