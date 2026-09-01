import type { LiveMeta } from '../metadata';
import type { LiveInputs, LiveScope } from '../shared/inputs';

export interface LiveAuthorizationRequest {
    resourceId: string;
    controllerName: string;
    handlerName: string;
    meta: LiveMeta;
    inputs: LiveInputs;
    scope: LiveScope;
    connectionId: string;
}

/**
 * Decides whether one connection may hold one subscription.
 *
 * Called when the subscription is created and again whenever the connection's
 * `auth:` key is invalidated. Returning false ends that connection's
 * subscription; it never affects the other subscribers of a shared instance.
 */
export interface LiveAuthorizer {
    authorize(request: LiveAuthorizationRequest): boolean | Promise<boolean>;
}

/** Default. The scope already isolates instances, so nothing extra is refused. */
export class AllowAllAuthorizer implements LiveAuthorizer {
    authorize(): boolean {
        return true;
    }
}

const AUTH_PREFIX = 'auth:';

export function isAuthKey(key: string): boolean {
    return key.startsWith(AUTH_PREFIX);
}

/**
 * The authorization keys a connection with this scope answers to.
 *
 * Same two-level shape as the ORM keys: `auth:principal#42` is contained by
 * `auth:principal`, so invalidating the parent re-checks everyone.
 */
export function authKeysOf(scope: LiveScope): string[] {
    const keys: string[] = [];

    if (scope.principal !== undefined && scope.principal !== null && scope.principal !== '') {
        keys.push(`${AUTH_PREFIX}principal#${scope.principal}`);
    }

    if (scope.tenant !== undefined && scope.tenant !== null && scope.tenant !== '') {
        keys.push(`${AUTH_PREFIX}tenant#${scope.tenant}`);
    }

    return keys;
}
