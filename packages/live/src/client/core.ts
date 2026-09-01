import { PatchEngine } from '../patch/PatchEngine';
import { canonical } from '../shared/canonical';
import type { LiveInputs } from '../shared/inputs';
import {
    LIVE_PROTOCOL_VERSION,
    type ClientMessage,
    type ServerMessage
} from '../shared/protocol';

export interface LiveState<T> {
    data: T | undefined;
    pending: boolean;
    error: string | null;
    /** The server cannot vouch for this being current. Data still shown. */
    stale: boolean;
}

export interface LiveStore<T> {
    subscribe(listener: () => void): () => void;
    getSnapshot(): LiveState<T>;
}

/** The slice of WebSocket this client uses, and the seam tests inject through. */
export interface LiveSocket {
    send(data: string): void;
    close(): void;
    onopen: (() => void) | null;
    onmessage: ((event: { data: string }) => void) | null;
    onclose: (() => void) | null;
    onerror: ((error: unknown) => void) | null;
}

export interface LiveClientOptions {
    url: string;
    token?: string;
    /**
     * Server-rendered payloads, keyed by `${resource}|${canonical(inputs)}`.
     * Lets the first paint skip the waterfall: the store starts full and the
     * subscription only says "this is the hash I already have".
     */
    hydrate?: Record<string, { data: unknown; hash: string }>;
    unsubGraceMs?: number;
    reconnect?: { initialMs?: number; maxMs?: number };
    socketFactory?: (url: string) => LiveSocket;
}

interface Entry {
    sid: string;
    key: string;
    resource: string;
    inputs: LiveInputs;
    refs: number;
    revision: number;
    hash: string | null;
    patcher: PatchEngine;
    state: LiveState<unknown>;
    listeners: Set<() => void>;
    dropTimer: ReturnType<typeof setTimeout> | null;
    store: LiveStore<unknown>;
}

const DEFAULT_UNSUB_GRACE_MS = 5000;
const DEFAULT_INITIAL_BACKOFF_MS = 250;
const DEFAULT_MAX_BACKOFF_MS = 30000;

export class LiveClient {
    private readonly entries = new Map<string, Entry>();
    private readonly bySid = new Map<string, Entry>();
    private socket: LiveSocket | null = null;
    private connected = false;
    private closed = false;
    private attempt = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private nextSid = 0;

    constructor(private readonly options: LiveClientOptions) {}

    store<T>(resource: string, inputs: LiveInputs): LiveStore<T> {
        const key = storeKey(resource, inputs);
        const existing = this.entries.get(key);

        if (existing) {
            return existing.store as LiveStore<T>;
        }

        const hydrated = this.options.hydrate?.[key];
        const entry: Entry = {
            sid: `s${this.nextSid++}`,
            key,
            resource,
            inputs,
            refs: 0,
            revision: hydrated ? 1 : 0,
            hash: hydrated?.hash ?? null,
            patcher: new PatchEngine(),
            state: {
                data: hydrated?.data,
                pending: hydrated === undefined,
                error: null,
                stale: false
            },
            listeners: new Set(),
            dropTimer: null,
            store: undefined as unknown as LiveStore<unknown>
        };

        entry.store = {
            subscribe: (listener: () => void) => this.retain(entry, listener),
            getSnapshot: () => entry.state
        };

        this.entries.set(key, entry);
        this.bySid.set(entry.sid, entry);

        return entry.store as LiveStore<T>;
    }

    close(): void {
        this.closed = true;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.socket?.close();
        this.socket = null;
        this.connected = false;
    }

    // ------------------------------------------------------------ lifecycle

    private retain(entry: Entry, listener: () => void): () => void {
        entry.listeners.add(listener);
        entry.refs += 1;

        if (entry.dropTimer) {
            clearTimeout(entry.dropTimer);
            entry.dropTimer = null;
        }

        if (entry.refs === 1) {
            this.ensureConnected();
            this.sendSub(entry);
        }

        return () => {
            entry.listeners.delete(listener);
            entry.refs -= 1;

            if (entry.refs > 0 || entry.dropTimer) {
                return;
            }

            // Grace period: coming back from a navigation must not tear the
            // subscription down and build it again.
            entry.dropTimer = setTimeout(() => {
                entry.dropTimer = null;

                if (entry.refs > 0) {
                    return;
                }

                this.send({ t: 'unsub', sid: entry.sid });
                this.entries.delete(entry.key);
                this.bySid.delete(entry.sid);
            }, this.options.unsubGraceMs ?? DEFAULT_UNSUB_GRACE_MS);
        };
    }

    private ensureConnected(): void {
        if (this.socket || this.closed) {
            return;
        }

        const factory = this.options.socketFactory ?? defaultSocketFactory;
        const socket = factory(this.options.url);
        this.socket = socket;

        socket.onopen = () => {
            this.connected = true;
            this.attempt = 0;
            this.send({ t: 'hello', v: LIVE_PROTOCOL_VERSION, token: this.options.token });

            // Reconnect is just "subscribe again, carrying the hash of what is
            // on screen". There is no session to restore, because there is no
            // session.
            for (const entry of this.entries.values()) {
                if (entry.refs > 0) {
                    this.sendSub(entry);
                }
            }
        };

        socket.onmessage = event => this.onMessage(event.data);
        socket.onclose = () => this.onDisconnect();
        socket.onerror = () => this.onDisconnect();
    }

    private onDisconnect(): void {
        this.connected = false;
        this.socket = null;

        if (this.closed || this.reconnectTimer) {
            return;
        }

        const initial = this.options.reconnect?.initialMs ?? DEFAULT_INITIAL_BACKOFF_MS;
        const max = this.options.reconnect?.maxMs ?? DEFAULT_MAX_BACKOFF_MS;
        const ceiling = Math.min(max, initial * 2 ** this.attempt);

        // Full jitter, and it is mandatory: a deploy reconnects every client at
        // once, and a synchronised recompute storm takes the database down.
        const delay = Math.random() * ceiling;
        this.attempt += 1;

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.ensureConnected();
        }, delay);
    }

    private sendSub(entry: Entry): void {
        this.send({
            t: 'sub',
            sid: entry.sid,
            resource: entry.resource,
            inputs: entry.inputs,
            hash: entry.hash ?? undefined
        });
    }

    private send(message: ClientMessage): void {
        if (!this.socket || !this.connected) {
            return;
        }

        this.socket.send(JSON.stringify(message));
    }

    // -------------------------------------------------------------- inbound

    private onMessage(raw: string): void {
        let message: ServerMessage;

        try {
            message = JSON.parse(raw) as ServerMessage;
        } catch {
            return;
        }

        const entry = this.bySid.get((message as { sid?: string }).sid ?? '');

        if (!entry) {
            return;
        }

        switch (message.t) {
            case 'snapshot':
                if (message.key) {
                    entry.patcher = new PatchEngine(message.key);
                }
                entry.revision = message.rev;
                entry.hash = message.hash;
                this.update(entry, { data: message.data, pending: false, error: null, stale: false });
                return;

            case 'current':
                if (message.key) {
                    entry.patcher = new PatchEngine(message.key);
                }
                entry.revision = message.rev;
                entry.hash = message.hash;
                // Content already on screen: touch only the flags, keep
                // `data` referentially identical so nothing re-renders.
                this.update(entry, { data: entry.state.data, pending: false, error: null, stale: false });
                return;

            case 'patch':
                if (message.from !== entry.revision) {
                    // A hole in the sequence. Ask for full state rather than
                    // applying ops to a base we cannot vouch for.
                    this.send({ t: 'resync', sid: entry.sid, hash: entry.hash ?? undefined });
                    return;
                }

                entry.revision = message.to;
                entry.hash = message.hash;
                this.update(entry, {
                    data: entry.patcher.apply(entry.state.data, message.ops),
                    pending: false,
                    error: null,
                    stale: false
                });
                return;

            case 'stale':
                this.update(entry, { ...entry.state, stale: true });
                return;

            case 'error':
                this.update(entry, { ...entry.state, pending: false, error: message.message });
                return;
        }
    }

    private update(entry: Entry, next: LiveState<unknown>): void {
        if (
            next.data === entry.state.data &&
            next.pending === entry.state.pending &&
            next.error === entry.state.error &&
            next.stale === entry.state.stale
        ) {
            // Nothing changed. Keeping the same object is what makes
            // useSyncExternalStore stable instead of looping.
            return;
        }

        entry.state = next;

        for (const listener of entry.listeners) {
            listener();
        }
    }
}

export function storeKey(resource: string, inputs: LiveInputs): string {
    return `${resource}|${canonical({
        params: inputs.params ?? {},
        query: inputs.query ?? {},
        body: inputs.body ?? null
    })}`;
}

function defaultSocketFactory(url: string): LiveSocket {
    return new WebSocket(url) as unknown as LiveSocket;
}
