import type { PatchOp } from '../patch/types';
import type { LiveInputs } from '../resource/types';

export const LIVE_PROTOCOL_VERSION = 1;

/** Sent once per connection, before any subscription. */
export interface ClientHello {
    t: 'hello';
    v: number;
    /** Opaque credential; the server's LiveScopeResolver interprets it. */
    token?: string;
}

export interface ClientSub {
    t: 'sub';
    /** Client-chosen subscription id. The instance id never leaves the server. */
    sid: string;
    resource: string;
    inputs: LiveInputs;
    /** Content hash of what the client already has on screen, if anything. */
    hash?: string;
}

export interface ClientUnsub {
    t: 'unsub';
    sid: string;
}

export interface ClientResync {
    t: 'resync';
    sid: string;
    hash?: string;
}

export type ClientMessage = ClientHello | ClientSub | ClientUnsub | ClientResync;

/** Full state. */
export interface ServerSnapshot {
    t: 'snapshot';
    sid: string;
    rev: number;
    hash: string;
    data: unknown;
    /**
     * The resource's `@Live({ key })`, if it declared one. The client needs it
     * to apply keyed ops, and this is the only message that establishes state,
     * so it is the only place it has to travel.
     */
    key?: string;
}

/** The client's hash matched what the server computed: nothing on the wire. */
export interface ServerCurrent {
    t: 'current';
    sid: string;
    rev: number;
    hash: string;
    /** Same reason as on `snapshot`: this also establishes state, on hydration. */
    key?: string;
}

export interface ServerPatch {
    t: 'patch';
    sid: string;
    from: number;
    to: number;
    hash: string;
    ops: PatchOp[];
}

/**
 * The server cannot vouch for this instance being current (a recompute is
 * failing). The client keeps showing the last data and flags it, so the UI can
 * say so.
 */
export interface ServerStale {
    t: 'stale';
    sid: string;
    reason: string;
}

/** The subscription is invalid or not allowed; the client ends the instance. */
export interface ServerError {
    t: 'error';
    sid: string;
    code: string;
    message: string;
}

export type ServerMessage = ServerSnapshot | ServerCurrent | ServerPatch | ServerStale | ServerError;
