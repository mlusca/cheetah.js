import { rowKey, tableKey } from '../graph/dep-key';
import type { InvalidationEvent } from '../graph/types';
import { PgListener } from './pg-listener';
import { createFunctionSql, createTriggerSql, dropTriggerSql } from './pg-trigger-sql';

export interface PgNotifyTable {
    /** Table name as it exists in the database, unqualified. */
    table: string;
    /** Primary key column, as it exists in the database. */
    primaryKey: string;
}

export interface PgNotifyEmitterOptions {
    tables: PgNotifyTable[];
    /** Connection string. Defaults to the ORM's own. */
    url: string;
    /** Runs the DDL. Defaults to the ORM driver's `executeSql`. */
    execute: (sql: string) => Promise<unknown>;
    channel?: string;
    maxPayloadBytes?: number;
    heartbeatMs?: number;
    retryMs?: number;
    /** Injected in tests. */
    listener?: PgListener;
}

export const DEFAULT_PG_CHANNEL = 'carno_live';
export const DEFAULT_PG_MAX_PAYLOAD_BYTES = 7000;

/**
 * Turn one trigger payload into invalidation events.
 *
 * Exported on its own because it is the whole translation layer between
 * Postgres and the graph, and it is worth testing without a database.
 */
export function eventsFromPayload(raw: string): InvalidationEvent[] {
    let parsed: { t?: unknown; i?: unknown; c?: unknown };

    try {
        parsed = JSON.parse(raw) as { t?: unknown; i?: unknown; c?: unknown };
    } catch {
        // Someone else is using our channel. Not our problem, and not a crash.
        return [];
    }

    if (!parsed || typeof parsed.t !== 'string' || parsed.t === '') {
        return [];
    }

    const table = parsed.t;
    const columns = Array.isArray(parsed.c)
        ? (parsed.c.filter(item => typeof item === 'string') as string[])
        : [];
    const id = typeof parsed.i === 'string' || typeof parsed.i === 'number' ? parsed.i : null;

    return [{
        key: id === null ? tableKey(table) : rowKey(table, id),
        // An empty list is "we do not know which columns", not "no columns".
        columns: columns.length > 0 ? columns : null
    }];
}

/**
 * The second emitter of §4.4: writes that never went through @carno.js/orm.
 *
 * A trigger per watched table produces table + primary key + changed columns,
 * which is the same key vocabulary the application emitter produces. The graph
 * cannot tell them apart, and does not need to.
 */
export class PgNotifyEmitter {
    private readonly listener: PgListener;
    private readonly channel: string;
    private attached = false;

    constructor(
        private readonly deliver: (events: InvalidationEvent[]) => void,
        private readonly options: PgNotifyEmitterOptions
    ) {
        this.channel = options.channel ?? DEFAULT_PG_CHANNEL;
        this.listener = options.listener ?? new PgListener({
            url: options.url,
            heartbeatMs: options.heartbeatMs,
            retryMs: options.retryMs,
            onReconnect: () => this.onReconnect()
        });
    }

    /** Tables this emitter announces, so the ORM emitter can skip them. */
    coveredTables(): Set<string> {
        return new Set(this.options.tables.map(entry => entry.table));
    }

    /** Install the trigger function and one trigger per watched table. */
    async install(): Promise<void> {
        await this.options.execute(
            createFunctionSql(this.options.maxPayloadBytes ?? DEFAULT_PG_MAX_PAYLOAD_BYTES)
        );

        for (const entry of this.options.tables) {
            await this.options.execute(createTriggerSql(entry.table, entry.primaryKey, this.channel));
        }
    }

    async attach(): Promise<void> {
        if (this.attached) {
            return;
        }

        this.attached = true;
        await this.install();
        await this.listener.listen(this.channel, payload => {
            const events = eventsFromPayload(payload);

            if (events.length > 0) {
                this.deliver(events);
            }
        });
    }

    async detach(): Promise<void> {
        this.attached = false;
        await this.listener.close();
    }

    /** Remove the triggers. The function is left in place; it is harmless. */
    async uninstall(): Promise<void> {
        for (const entry of this.options.tables) {
            await this.options.execute(dropTriggerSql(entry.table));
        }
    }

    /**
     * Whatever was written while the socket was down arrived nowhere, and there
     * is no way to ask Postgres what we missed. The only correct move is to
     * assume everything watched is stale.
     */
    private onReconnect(): void {
        this.deliver(this.options.tables.map(entry => ({
            key: tableKey(entry.table),
            columns: null
        })));
    }
}
