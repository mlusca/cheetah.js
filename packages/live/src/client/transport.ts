import type { LiveSocket } from './core';
import {
    LIVE_CONNECTION_HEADER,
    LIVE_POLL_HEADER,
    LIVE_RESOURCE_HEADER,
    LIVE_TOKEN_HEADER,
    type ClientMessage,
    type ServerMessage
} from '../shared/protocol';

export interface TransportHandlers {
    onOpen(): void;
    onMessage(raw: string): void;
    onClose(): void;
}

/**
 * A pipe the client can speak the protocol over.
 *
 * The protocol does not change between implementations, and neither does the
 * client's behaviour: a component cannot tell which one is in use, and the day
 * an `if (kind === 'sse')` appears in a component, the abstraction has failed.
 * `kind` exists to be logged.
 */
export interface ClientTransport {
    readonly kind: 'websocket' | 'sse' | 'polling';
    start(handlers: TransportHandlers): void;
    send(raw: string): void;
    close(): void;
}

export class WebSocketTransport implements ClientTransport {
    readonly kind = 'websocket' as const;

    private socket: LiveSocket | null = null;
    private closed = false;

    constructor(
        private readonly url: string,
        private readonly factory: (url: string) => LiveSocket = defaultSocketFactory
    ) {}

    start(handlers: TransportHandlers): void {
        const socket = this.factory(this.url);
        this.socket = socket;

        socket.onopen = () => handlers.onOpen();
        socket.onmessage = event => handlers.onMessage(event.data);
        // An error and a close both mean the same thing here: the pipe is gone.
        socket.onclose = () => this.report(handlers);
        socket.onerror = () => this.report(handlers);
    }

    send(raw: string): void {
        this.socket?.send(raw);
    }

    close(): void {
        this.closed = true;
        this.socket?.close();
        this.socket = null;
    }

    private report(handlers: TransportHandlers): void {
        if (this.closed) {
            // We closed it. Reporting it would schedule a reconnect to a
            // client that has already given up.
            // Also latches error-then-close so the ladder sees one death,
            // not two descents that skip a rung.
            return;
        }

        this.closed = true;
        this.socket = null;
        handlers.onClose();
    }
}

function defaultSocketFactory(url: string): LiveSocket {
    return new WebSocket(url) as unknown as LiveSocket;
}

export interface RoutePath {
    method: string;
    path: string;
}

export interface EventSourceLike {
    onopen: ((event: unknown) => void) | null;
    onmessage: ((event: { data: string }) => void) | null;
    onerror: ((event: unknown) => void) | null;
    close(): void;
}

/**
 * Flatten the tree `@carno.js/client` generates into `resourceId -> path`.
 *
 * Polling needs a URL and the protocol carries a resource id, so without this
 * the bottom rung cannot exist. Routes with no `@Live()` are skipped: polling
 * one would be polling something nobody can subscribe to.
 */
export function routeIndex(routes: unknown): Record<string, RoutePath> {
    const index: Record<string, RoutePath> = {};

    const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') {
            return;
        }

        const candidate = node as { method?: unknown; path?: unknown; resourceId?: unknown; live?: unknown };

        if (typeof candidate.method === 'string' && typeof candidate.path === 'string') {
            if (
                candidate.method.toLowerCase() === 'get' &&
                typeof candidate.resourceId === 'string' &&
                candidate.live
            ) {
                index[candidate.resourceId] = { method: candidate.method, path: candidate.path };
            }

            return;
        }

        for (const value of Object.values(node as Record<string, unknown>)) {
            walk(value);
        }
    };

    walk(routes);

    return index;
}

/**
 * Try each rung in order, descend when one does not open.
 *
 * There is no promotion back up: a proxy that blocks WebSocket will keep
 * blocking it, and retrying the top rung on every reconnect spends a round
 * trip per cycle to fail forever. The next page load starts at the top again.
 */
export class LadderTransport implements ClientTransport {
    private active: ClientTransport | null = null;
    private handlers: TransportHandlers | null = null;
    private rung = 0;
    private settled = false;
    private probe: ReturnType<typeof setTimeout> | null = null;
    private closed = false;

    constructor(
        private readonly rungs: (() => ClientTransport)[],
        private readonly options: { probeMs: number }
    ) {}

    get kind(): ClientTransport['kind'] {
        return this.active?.kind ?? 'websocket';
    }

    start(handlers: TransportHandlers): void {
        this.handlers = handlers;
        this.rung = 0;
        this.settled = false;
        this.tryRung();
    }

    send(raw: string): void {
        this.active?.send(raw);
    }

    close(): void {
        this.closed = true;
        this.clearProbe();
        this.active?.close();
        this.active = null;
    }

    private tryRung(): void {
        this.clearProbe();

        if (this.closed) {
            return;
        }

        if (this.rung >= this.rungs.length) {
            // Every rung refused. One close, not one per rung, or the client
            // schedules a reconnect storm against itself.
            this.handlers?.onClose();
            return;
        }

        const rung = this.rung;
        const transport = this.rungs[rung]();
        this.active = transport;

        transport.start({
            onOpen: () => {
                this.clearProbe();
                this.settled = true;
                this.handlers?.onOpen();
            },
            onMessage: raw => this.handlers?.onMessage(raw),
            onClose: () => {
                if (this.active !== transport) {
                    // A previous rung firing error then close. One death,
                    // one descent — otherwise we skip the rung that just
                    // became active.
                    return;
                }

                if (this.settled) {
                    // It worked and then dropped. That is an ordinary
                    // disconnect and the client's backoff owns it.
                    this.handlers?.onClose();
                    return;
                }

                this.descend();
            }
        });

        // A proxy that swallows the upgrade without answering never fires an
        // error. Without this the ladder would wait for a close that never
        // comes, on the rung that is exactly the one being blocked.
        if (this.active === transport && this.rung === rung && !this.settled && !this.closed) {
            this.probe = setTimeout(() => this.descend(), this.options.probeMs);
            this.probe.unref?.();
        }
    }

    private descend(): void {
        if (this.settled || this.closed) {
            return;
        }

        this.clearProbe();
        this.active?.close();
        this.active = null;
        this.rung += 1;
        this.tryRung();
    }

    private clearProbe(): void {
        if (this.probe) {
            clearTimeout(this.probe);
            this.probe = null;
        }
    }
}

/**
 * The protocol over Server-Sent Events: down the stream, up by POST.
 *
 * The connection id arrives in the first frame and every client message
 * carries it, because the control endpoint has no other way to know which
 * stream a POST belongs to.
 */
export class SseClientTransport implements ClientTransport {
    readonly kind = 'sse' as const;

    private source: EventSourceLike | null = null;
    private cid: string | null = null;
    private queue: string[] = [];
    private closed = false;

    constructor(
        private readonly baseUrl: string,
        private readonly options: {
            streamPath?: string;
            controlPath?: string;
            fetch?: typeof fetch;
            eventSourceFactory?: (url: string) => EventSourceLike;
        } = {}
    ) {}

    start(handlers: TransportHandlers): void {
        const streamUrl = `${this.baseUrl}${this.options.streamPath ?? '/live/sse'}`;

        if (!this.options.eventSourceFactory && typeof EventSource === 'undefined') {
            // SSR and Bun do not provide the browser EventSource API. Treat
            // that as an unavailable rung so the ladder can continue to the
            // next transport instead of throwing during construction.
            handlers.onClose();
            return;
        }

        const build = this.options.eventSourceFactory
            ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike);

        const source = build(streamUrl);
        this.source = source;

        source.onmessage = event => {
            let frame: { t?: string; cid?: string };

            try {
                frame = JSON.parse(event.data) as { t?: string; cid?: string };
            } catch {
                return;
            }

            if (frame.t === 'ready' && typeof frame.cid === 'string') {
                this.cid = frame.cid;
                handlers.onOpen();
                // Anything the client tried to say before the id arrived.
                const queued = this.queue;
                this.queue = [];
                for (const raw of queued) {
                    this.send(raw);
                }
                return;
            }

            handlers.onMessage(event.data);
        };

        source.onerror = () => {
            if (this.closed) {
                return;
            }

            this.closed = true;
            this.source?.close();
            this.source = null;
            handlers.onClose();
        };
    }

    send(raw: string): void {
        if (!this.cid) {
            this.queue.push(raw);
            return;
        }

        const post = this.options.fetch ?? fetch;

        void post(`${this.baseUrl}${this.options.controlPath ?? '/live/control'}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cid: this.cid, message: JSON.parse(raw) as ClientMessage })
        }).catch(() => {
            // A failed control POST is not a dead stream. The stream's own
            // error handler owns the disconnect.
        });
    }

    close(): void {
        this.closed = true;
        this.source?.close();
        this.source = null;
        this.cid = null;
    }
}

interface Poll {
    sid: string;
    resourceId: string;
    url: string;
    etag: string | null;
    revision: number;
}

/**
 * The floor: conditional GET on the route the resource already serves.
 *
 * There are no patches here, only snapshots and 304s. A patch would need the
 * server to remember this client's previous revision, which is precisely the
 * history §8.1 says does not exist.
 */
export class PollingTransport implements ClientTransport {
    readonly kind = 'polling' as const;

    private handlers: TransportHandlers | null = null;
    private readonly polls = new Map<string, Poll>();
    private readonly connectionId = pollingConnectionId();
    private token: string | undefined;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(
        private readonly baseUrl: string,
        private readonly routes: Record<string, RoutePath>,
        private readonly options: { intervalMs?: number; fetch?: typeof fetch; token?: string } = {}
    ) {
        this.token = options.token;
    }

    start(handlers: TransportHandlers): void {
        this.handlers = handlers;
        handlers.onOpen();

        const interval = this.options.intervalMs ?? 5000;
        this.timer = setInterval(() => this.tick(), interval);
        this.timer.unref?.();
    }

    send(raw: string): void {
        let message: ClientMessage;

        try {
            message = JSON.parse(raw) as ClientMessage;
        } catch {
            return;
        }

        if (message.t === 'unsub') {
            this.polls.delete(message.sid);
            return;
        }

        if (message.t === 'hello') {
            this.token = message.token;
            return;
        }

        if (message.t !== 'sub') {
            // `resync` is answered by the next tick anyway.
            return;
        }

        const route = this.routes[message.resource];

        if (!route) {
            this.emit({
                t: 'error',
                sid: message.sid,
                code: 'no_route',
                message:
                    `Polling cannot reach "${message.resource}": pass the generated \`routes\` ` +
                    `to the LiveClient so it can turn a resource id into a URL.`
            });
            return;
        }

        const poll: Poll = {
            sid: message.sid,
            resourceId: message.resource,
            url: buildUrl(this.baseUrl, route.path, message.inputs),
            etag: message.hash ? `"${message.hash}"` : null,
            revision: 0
        };

        this.polls.set(message.sid, poll);
        void this.fetchOne(poll);
    }

    close(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        this.polls.clear();
    }

    private tick(): void {
        for (const poll of this.polls.values()) {
            void this.fetchOne(poll);
        }
    }

    private async fetchOne(poll: Poll): Promise<void> {
        const get = this.options.fetch ?? fetch;
        const headers: Record<string, string> = {};
        headers[LIVE_POLL_HEADER] = '1';
        headers[LIVE_CONNECTION_HEADER] = this.connectionId;
        headers[LIVE_RESOURCE_HEADER] = poll.resourceId;

        if (this.token) {
            headers[LIVE_TOKEN_HEADER] = this.token;
        }

        if (poll.etag) {
            headers['If-None-Match'] = poll.etag;
        }

        let response: Response;

        try {
            response = await get(poll.url, { headers });
        } catch (error) {
            this.emit({ t: 'stale', sid: poll.sid, reason: (error as Error).message });
            return;
        }

        if (response.status === 304) {
            // Already right on screen. Emitting a snapshot would hand the
            // store a new object for identical content and re-render for it.
            return;
        }

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                this.polls.delete(poll.sid);
                this.emit({
                    t: 'error',
                    sid: poll.sid,
                    code: 'forbidden',
                    message: 'Polling authorization failed.'
                });
                return;
            }

            if (response.status >= 400 && response.status < 500) {
                this.polls.delete(poll.sid);
                this.emit({
                    t: 'error',
                    sid: poll.sid,
                    code: 'invalid_subscription',
                    message: `Polling route returned HTTP ${response.status}.`
                });
                return;
            }

            this.emit({ t: 'stale', sid: poll.sid, reason: `HTTP ${response.status}` });
            return;
        }

        const tag = response.headers.get('ETag');
        poll.etag = tag;
        poll.revision += 1;

        this.emit({
            t: 'snapshot',
            sid: poll.sid,
            rev: poll.revision,
            hash: tag ? tag.replace(/"/g, '') : '',
            data: await response.json()
        });
    }

    private emit(message: ServerMessage): void {
        this.handlers?.onMessage(JSON.stringify(message));
    }
}

function pollingConnectionId(): string {
    const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return `poll:${uuid}`;
}

function buildUrl(baseUrl: string, path: string, inputs: { params?: Record<string, string>; query?: Record<string, unknown> }): string {
    const filled = path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name: string) => {
        const value = inputs.params?.[name];

        if (value === undefined) {
            throw new Error(`Missing path parameter "${name}" for ${path}.`);
        }

        return encodeURIComponent(String(value));
    });

    const search = new URLSearchParams();

    for (const [key, value] of Object.entries(inputs.query ?? {})) {
        if (Array.isArray(value)) {
            for (const item of value) {
                search.append(key, String(item));
            }
        } else if (value !== undefined && value !== null) {
            search.set(key, String(value));
        }
    }

    const suffix = search.toString();

    return `${baseUrl}${filled}${suffix ? `?${suffix}` : ''}`;
}
