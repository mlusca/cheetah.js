/** Everything a resource compute is allowed to read from the caller. */
export interface LiveInputs {
    params: Record<string, string>;
    query: Record<string, string | string[]>;
    /**
     * Body of a @Post() live resource. Absent on @Get().
     *
     * It is part of the instance identity, not extra baggage: two clients
     * posting different filters must not share one computed instance.
     */
    body?: unknown;
}

/** Ambient dimensions resolved on the server; never sent by the client. */
export interface LiveScope {
    principal?: string | number;
    tenant?: string | number;
}
