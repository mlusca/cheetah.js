export const LIVE_META = Symbol('carno:live');

export type LiveShared = 'private' | 'tenant' | 'public';

export interface LiveOptions {
    /** Field that identifies a row of a returned collection. */
    key?: string;

    /** Who may share one computed instance. */
    shared?: LiveShared;

    /** Manual dependency keys for data the ORM cannot observe. */
    dependsOn?: string[];
}

export interface LiveMeta {
    key?: string;
    shared: LiveShared;
    dependsOn: string[];
    handlerName: string;
}
