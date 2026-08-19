import fs from 'node:fs';
import path from 'node:path';
import { generate } from './generate';
import { inferWatchDirectories, matchGlob } from './glob';
import type { ResolvedClientOptions } from './options';
import { resolveClientOptions, type ClientOptions } from './options';

export interface ClientWatcher {
    close(): void;
}

export function createClientWatcher(options: ClientOptions | ResolvedClientOptions = {}): ClientWatcher {
    const resolved = resolveClientOptions(options);
    const directories = inferWatchDirectories(resolved.root, resolved.include);
    const outputAbs = path.resolve(resolved.root, resolved.output);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const schedule = (): void => {
        if (closed) {
            return;
        }

        if (timer) {
            clearTimeout(timer);
        }

        timer = setTimeout(() => {
            timer = null;
            try {
                generate({ ...resolved, force: true });
            } catch (error) {
                console.error('[@carno.js/client] Watch generate failed:', error);
            }
        }, resolved.debounceMs);
    };

    const watchers: fs.FSWatcher[] = [];

    for (const dir of directories) {
        try {
            const watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
                if (!filename || closed) {
                    return;
                }

                const abs = path.resolve(dir, filename.toString());
                if (path.resolve(abs) === path.resolve(outputAbs)) {
                    return;
                }

                const rel = path.relative(resolved.root, abs).replace(/\\/g, '/');
                if (rel.startsWith('..')) {
                    return;
                }

                if (!resolved.include.some((pattern) => matchGlob(rel, pattern))) {
                    return;
                }

                if (resolved.exclude.some((pattern) => matchGlob(rel, pattern))) {
                    return;
                }

                schedule();
            });

            watchers.push(watcher);
        } catch (error) {
            console.error(`[@carno.js/client] Could not watch ${dir}:`, error);
        }
    }

    if (!resolved.silent) {
        console.log(`[@carno.js/client] Watching for route changes`);
    }

    return {
        close() {
            closed = true;
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            for (const watcher of watchers) {
                watcher.close();
            }
        }
    };
}
