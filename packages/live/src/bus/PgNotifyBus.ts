import { tableKey, tableOfKey } from '../graph/dep-key';
import type { InvalidationEvent } from '../graph/types';
import { PgListener } from '../emitters/pg-listener';
import type { InvalidationBus, InvalidationHandler } from './InvalidationBus';

export const DEFAULT_PG_BUS_CHANNEL = 'carno_live_bus';
export const DEFAULT_PG_BUS_MAX_PAYLOAD_BYTES = 7000;

export interface PgNotifyBusOptions {
    /** May be empty at construction; `setUrl` fills it before `start()`. */
    url: string;
    channel?: string;
    /** Identifies this process so its own echo can be dropped. */
    nodeId?: string;
    maxPayloadBytes?: number;
    heartbeatMs?: number;
    retryMs?: number;
    /** Injected in tests. */
    listener?: PgListener;
}

interface WireFrame {
    n: string;
    e: InvalidationEvent[];
}

/**
 * Split events into `pg_notify` frames under the payload ceiling.
 *
 * A single event that does not fit on its own degrades to its table key: a
 * coarse invalidation costs CPU, a dropped one costs a screen frozen on stale
 * data.
 */
export function chunkEvents(
    events: InvalidationEvent[],
    nodeId: string,
    maxPayloadBytes: number
): string[] {
    const encode = (items: InvalidationEvent[]): string => JSON.stringify({ n: nodeId, e: items });
    const frames: string[] = [];
    let batch: InvalidationEvent[] = [];

    for (const event of events) {
        let item = event;

        if (Buffer.byteLength(encode([item]), 'utf8') > maxPayloadBytes) {
            const table = tableOfKey(item.key);
            item = { key: table ? tableKey(table) : item.key, columns: null };
        }

        if (batch.length > 0 && Buffer.byteLength(encode([...batch, item]), 'utf8') > maxPayloadBytes) {
            frames.push(encode(batch));
            batch = [item];
            continue;
        }

        batch.push(item);
    }

    if (batch.length > 0) {
        frames.push(encode(batch));
    }

    return frames;
}

/**
 * Invalidation bus across nodes, over `LISTEN/NOTIFY`.
 *
 * Two entry points, on purpose. `publish` is for a source local to this node —
 * the ORM emitter, `LiveService.invalidate()` — and has to reach the others.
 * `publishLocal` is for a source that already reached every node, which is what
 * a Postgres trigger is; re-publishing that would multiply one write by the
 * size of the cluster.
 */
export class PgNotifyBus implements InvalidationBus {
    readonly nodeId: string;

    private readonly handlers = new Set<InvalidationHandler>();
    private readonly channel: string;
    private readonly maxPayloadBytes: number;
    private listener: PgListener | null;
    private url: string;

    constructor(private readonly options: PgNotifyBusOptions) {
        this.nodeId = options.nodeId ?? crypto.randomUUID();
        this.channel = options.channel ?? DEFAULT_PG_BUS_CHANNEL;
        this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_PG_BUS_MAX_PAYLOAD_BYTES;
        this.listener = options.listener ?? null;
        this.url = options.url;
    }

    /** Called by the plugin once the ORM knows where the database is. */
    setUrl(url: string): void {
        this.url = url;
    }

    async start(): Promise<void> {
        if (!this.listener) {
            this.listener = new PgListener({
                url: this.url,
                heartbeatMs: this.options.heartbeatMs,
                retryMs: this.options.retryMs
            });
        }

        await this.listener.listen(this.channel, raw => this.onFrame(raw));
    }

    async stop(): Promise<void> {
        await this.listener?.close();
    }

    publish(events: InvalidationEvent[]): void {
        if (events.length === 0) {
            return;
        }

        this.deliver(events);
        void this.broadcast(events);
    }

    /** Deliver here only: the source already reached every node. */
    publishLocal(events: InvalidationEvent[]): void {
        if (events.length === 0) {
            return;
        }

        this.deliver(events);
    }

    subscribe(handler: InvalidationHandler): () => void {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }

    // ------------------------------------------------------------ internals

    private async broadcast(events: InvalidationEvent[]): Promise<void> {
        const listener = this.listener;

        if (!listener) {
            console.error('[carno:live] the distributed bus is not started; invalidation stayed local');
            return;
        }

        for (const frame of chunkEvents(events, this.nodeId, this.maxPayloadBytes)) {
            try {
                await listener.notify(this.channel, frame);
            } catch (error) {
                // The other nodes will miss this one. Loud, because the symptom
                // over there is a screen that simply stops updating.
                console.error('[carno:live] failed to broadcast an invalidation', error);
            }
        }
    }

    private onFrame(raw: string): void {
        let frame: WireFrame;

        try {
            frame = JSON.parse(raw) as WireFrame;
        } catch {
            return;
        }

        if (!frame || typeof frame.n !== 'string' || !Array.isArray(frame.e)) {
            return;
        }

        if (frame.n === this.nodeId) {
            // Our own echo. These were delivered locally before being sent.
            return;
        }

        this.deliver(frame.e);
    }

    private deliver(events: InvalidationEvent[]): void {
        for (const handler of this.handlers) {
            try {
                handler(events);
            } catch (error) {
                console.error('[carno:live] invalidation handler failed', error);
            }
        }
    }
}
