/**
 * Official engines shipped with @carno.js/views.
 * Each is an optional peer dependency loaded only when selected.
 */
export type OfficialViewEngineName = 'handlebars' | 'ejs' | 'pug';

/**
 * Helper function registered globally for subsequent renders.
 */
export type ViewHelper = (...args: any[]) => unknown;

export type ViewFormat = 'html' | 'json';

/**
 * Options passed to ViewEngine.compile / ViewEngine.render.
 * The service owns filesystem I/O; adapters receive already-read sources.
 */
export interface ViewEngineOptions {
    filename: string;
    root: string;
    cache: boolean;
    helpers: Record<string, ViewHelper>;
    partials: Record<string, string>;
}

/**
 * Adapter contract for a template engine.
 *
 * `compile` is optional. When it is omitted, the service passes the template
 * source string to `render`. When present, the service caches its return value
 * (an opaque compiled template) while `cache` is enabled.
 */
export interface ViewEngine {
    readonly name: string;
    readonly extensions: string[];
    compile?(source: string, filename: string, options?: ViewEngineOptions): unknown | Promise<unknown>;
    render(template: unknown, data: Record<string, any>, options?: ViewEngineOptions): string | Promise<string>;
}

export interface ViewsNegotiateOptions {
    /**
     * Format used when Accept is missing, a wildcard, unmatched, or a html/json tie.
     * Never applied to a format the client listed with `q=0`. When both HTML and
     * JSON are refused, `respond()` returns 406 instead of this default.
     * @default 'html'
     */
    default?: ViewFormat;
}

/**
 * Configuration for `CarnoViews()`.
 *
 * `engine` is required so an optional peer dependency is never loaded by accident.
 */
export interface ViewsModuleOptions {
    engine: OfficialViewEngineName | ViewEngine;
    /**
     * Template root. Relative values resolve from `process.cwd()`.
     * @default './views'
     */
    views?: string;
    /**
     * Cache compiled templates and file contents.
     * @default process.env.NODE_ENV === 'production'
     */
    cache?: boolean;
    /**
     * Optional layout view name, resolved like any other template under `views`.
     * The rendered page is provided as trusted `body` HTML.
     */
    layout?: string;
    /**
     * Directory of Handlebars-style partials, relative to `views` unless absolute.
     * Must remain inside the views root.
     */
    partials?: string;
    /** Helpers available from the first render. */
    helpers?: Record<string, ViewHelper>;
    negotiate?: ViewsNegotiateOptions;
}

export interface ResolvedViewsOptions {
    engine: OfficialViewEngineName | ViewEngine;
    views: string;
    cache: boolean;
    layout?: string;
    partials?: string;
    helpers: Record<string, ViewHelper>;
    negotiate: { default: ViewFormat };
}
