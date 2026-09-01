/** Everything a resource compute is allowed to read from the caller. */
export interface LiveInputs {
    params: Record<string, string>;
    query: Record<string, string | string[]>;
}

/** Ambient dimensions resolved on the server; never sent by the client. */
export interface LiveScope {
    principal?: string | number;
    tenant?: string | number;
}
