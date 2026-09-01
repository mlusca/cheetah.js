import type { LiveScope } from '../shared/inputs';

export interface LiveHandshake {
    connectionId: string;
    /** Opaque credential from the client's `hello`. */
    token?: string;
}

export interface LiveScopeResolver {
    resolve(handshake: LiveHandshake): LiveScope | Promise<LiveScope>;
}

/**
 * Default resolver: every connection is its own principal.
 *
 * Safe by construction — nothing is ever shared between connections, so no
 * application can leak one user's data to another by forgetting to configure
 * this. Applications that want `shared: 'tenant'` or a real user identity
 * replace it.
 */
export class ConnectionScopeResolver implements LiveScopeResolver {
    resolve(handshake: LiveHandshake): LiveScope {
        return { principal: handshake.connectionId };
    }
}
