import { SQL } from 'bun';

/**
 * The slice of Bun's Postgres client this module needs.
 *
 * Bun 1.4 implements `listen` and `notify` at runtime, but `@types/bun` does
 * not declare them and the published docs still list them as unimplemented.
 * Declaring the slice here keeps the cast in one place, and makes the whole
 * thing injectable so the unit tests need no database.
 */
export interface ListenableSql {
    listen(channel: string, onNotify: (payload: string) => void): Promise<unknown>;
    notify(channel: string, payload?: string): Promise<unknown>;
    unsafe(query: string): Promise<unknown>;
    close(): Promise<void>;
}

export interface PgListenerOptions {
    url: string;
    /** Liveness check interval. Zero disables the timer; `check()` still works. */
    heartbeatMs?: number;
    /** Delay between reconnection attempts. */
    retryMs?: number;
    /** Injected in tests. Defaults to a dedicated single Bun connection. */
    sqlFactory?: (url: string) => ListenableSql;
    /**
     * Fired after the connection came back and every channel was re-listened.
     *
     * Whatever was published while the socket was down is gone with no trace,
     * so the caller has to assume the worst — see PgNotifyEmitter.
     */
    onReconnect?: () => void;
}

const DEFAULT_HEARTBEAT_MS = 5000;
const DEFAULT_RETRY_MS = 1000;

function defaultSqlFactory(url: string): ListenableSql {
    // A LISTEN connection cannot be shared with the query pool: it sits open
    // waiting for asynchronous notifications, so it gets its own socket.
    return new SQL({ url, max: 1 }) as unknown as ListenableSql;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** One dedicated Postgres connection held open for LISTEN, with reconnection. */
export class PgListener {
    private sql: ListenableSql | null = null;
    private readonly channels = new Map<string, (payload: string) => void>();
    private timer: ReturnType<typeof setInterval> | null = null;
    private opening: Promise<void> | null = null;
    private closed = false;

    constructor(private readonly options: PgListenerOptions) {}

    async listen(channel: string, onNotify: (payload: string) => void): Promise<void> {
        const known = this.channels.has(channel);
        this.channels.set(channel, onNotify);

        if (!this.sql) {
            // `open()` subscribes every registered channel, this one included.
            await this.connect();
            return;
        }

        if (!known) {
            await this.sql.listen(channel, onNotify);
        }
    }

    async notify(channel: string, payload: string): Promise<void> {
        await this.connect();
        await this.sql?.notify(channel, payload);
    }

    /** One liveness probe. Called by the heartbeat and directly by tests. */
    async check(): Promise<void> {
        if (this.closed || !this.sql) {
            return;
        }

        try {
            await this.sql.unsafe('SELECT 1');
        } catch {
            await this.reconnect();
        }
    }

    async close(): Promise<void> {
        this.closed = true;

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        const sql = this.sql;
        this.sql = null;

        try {
            await sql?.close();
        } catch {
            // Already gone. Nothing to do and nothing to report.
        }
    }

    // ------------------------------------------------------------ internals

    private factory(): (url: string) => ListenableSql {
        return this.options.sqlFactory ?? defaultSqlFactory;
    }

    private async connect(): Promise<void> {
        if (this.sql || this.closed) {
            return;
        }

        if (!this.opening) {
            this.opening = this.open().finally(() => {
                this.opening = null;
            });
        }

        await this.opening;
    }

    private async open(): Promise<void> {
        const sql = this.factory()(this.options.url);

        for (const [channel, handler] of this.channels) {
            await sql.listen(channel, handler);
        }

        this.sql = sql;
        this.startHeartbeat();
    }

    private startHeartbeat(): void {
        const interval = this.options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;

        if (this.timer || interval <= 0) {
            return;
        }

        this.timer = setInterval(() => {
            void this.check();
        }, interval);
    }

    private async reconnect(): Promise<void> {
        const previous = this.sql;
        this.sql = null;

        try {
            await previous?.close();
        } catch {
            // The socket is what just failed; closing it is best effort.
        }

        while (!this.closed) {
            try {
                await this.open();
                this.options.onReconnect?.();
                return;
            } catch {
                this.sql = null;
                await delay(this.options.retryMs ?? DEFAULT_RETRY_MS);
            }
        }
    }
}
