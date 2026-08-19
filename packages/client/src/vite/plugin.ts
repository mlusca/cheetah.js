import path from 'node:path';
import { generate } from '../codegen/generate';
import { resolveClientOptions, type ClientOptions } from '../codegen/options';
import { createClientWatcher, type ClientWatcher } from '../codegen/watch';

export interface CarnoClientViteOptions extends ClientOptions {
    /**
     * API project root (the Carno app). Defaults to the Vite project root.
     * Use this when the frontend lives next to the API, e.g. `root: '../api'`.
     */
    root?: string;
}

interface VitePlugin {
    name: string;
    buildStart?: () => void;
    configureServer?: () => void;
    closeBundle?: () => void;
    buildEnd?: () => void;
}

/**
 * Vite plugin that generates the Carno HTTP client on `vite` / `vite build`.
 * In dev it watches API sources and regenerates when they change.
 */
export function carnoClient(options: CarnoClientViteOptions = {}): VitePlugin {
    let watcher: ClientWatcher | null = null;

    const resolved = () =>
        resolveClientOptions({
            ...options,
            root: options.root ?? process.cwd()
        });

    const run = (force: boolean): void => {
        const config = resolved();
        generate({ ...config, force, silent: config.silent });
    };

    const stop = (): void => {
        watcher?.close();
        watcher = null;
    };

    return {
        name: 'carno-client',
        buildStart() {
            try {
                run(true);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`[@carno.js/client] vite generate failed: ${message}`);
            }
        },
        configureServer() {
            stop();
            const config = resolved();
            watcher = createClientWatcher({ ...config, watch: true });
        },
        closeBundle() {
            stop();
        },
        buildEnd() {
            stop();
        }
    };
}

export default carnoClient;

export function resolveViteOutput(options: CarnoClientViteOptions): string {
    const config = resolveClientOptions(options);
    return path.resolve(config.root, config.output);
}
