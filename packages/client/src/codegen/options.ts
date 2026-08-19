export interface ClientOptions {
    /** Project root used to resolve include/output. Defaults to `process.cwd()`. */
    root?: string;
    /** Glob patterns relative to `root`. Default: src/**.ts under src. */
    include?: string[];
    /** Glob patterns to skip. */
    exclude?: string[];
    /** Generated file path relative to `root`. Default: `src/generated/app.ts`. */
    output?: string;
    /**
     * Watch source files and regenerate. Default: `true` outside production.
     * Production never watches unless this is explicitly `true`.
     */
    watch?: boolean;
    /** Inline structural types (default). Named aliases are still emitted for declared types. */
    importTypes?: boolean;
    /** Optional tsconfig path, relative to `root` or absolute. */
    tsconfig?: string;
    /** Suppress success logs. */
    silent?: boolean;
    /** Watch debounce in milliseconds. Default: 150. */
    debounceMs?: number;
    /** Override NODE_ENV detection (tests). */
    nodeEnv?: string;
    /** Force generate even when a production output file already exists. */
    force?: boolean;
}

export interface ResolvedClientOptions {
    root: string;
    include: string[];
    exclude: string[];
    output: string;
    watch?: boolean;
    importTypes: boolean;
    tsconfig?: string;
    silent: boolean;
    debounceMs: number;
    nodeEnv: string;
    force: boolean;
}

export const DEFAULT_INCLUDE = ['src/**/*.ts'];
export const DEFAULT_OUTPUT = 'src/generated/app.ts';
export const DEFAULT_EXCLUDE = [
    '**/*.spec.ts',
    '**/*.test.ts',
    '**/*.d.ts',
    '**/generated/**',
    '**/node_modules/**',
    '**/dist/**'
];

export function resolveClientOptions(options: ClientOptions = {}): ResolvedClientOptions {
    const root = options.root ? normalizeSlashes(options.root) : normalizeSlashes(process.cwd());

    return {
        root,
        include: options.include?.length ? options.include : [...DEFAULT_INCLUDE],
        exclude: [...DEFAULT_EXCLUDE, ...(options.exclude ?? [])],
        output: options.output ?? DEFAULT_OUTPUT,
        watch: options.watch,
        importTypes: options.importTypes ?? false,
        tsconfig: options.tsconfig,
        silent: options.silent ?? false,
        debounceMs: options.debounceMs ?? 150,
        nodeEnv: options.nodeEnv ?? process.env.NODE_ENV ?? 'development',
        force: options.force ?? false
    };
}

export function shouldWatch(options: ResolvedClientOptions): boolean {
    if (options.watch === true) {
        return true;
    }

    if (options.watch === false) {
        return false;
    }

    return options.nodeEnv !== 'production';
}

export function isProduction(options: ResolvedClientOptions): boolean {
    return options.nodeEnv === 'production';
}

export function normalizeSlashes(value: string): string {
    return value.replace(/\\/g, '/');
}
