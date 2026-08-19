import { OnApplicationInit, OnApplicationShutdown } from '@carno.js/core';
import { generate } from '../codegen/generate';
import { isProduction, resolveClientOptions, shouldWatch, type ClientOptions, type ResolvedClientOptions } from '../codegen/options';
import { createClientWatcher, type ClientWatcher } from '../codegen/watch';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Lifecycle service registered by `Client()`. Generates the typed client on init
 * and watches sources in development.
 */
export class ClientService {
    private watcher: ClientWatcher | null = null;
    readonly options: ResolvedClientOptions;

    constructor(options: ClientOptions = {}) {
        this.options = resolveClientOptions(options);
    }

    @OnApplicationInit()
    async onInit(): Promise<void> {
        const outputAbs = path.resolve(this.options.root, this.options.output);
        const prod = isProduction(this.options);

        try {
            if (prod && fs.existsSync(outputAbs) && !this.options.force) {
                if (!this.options.silent) {
                    const rel = path.relative(this.options.root, outputAbs) || outputAbs;
                    console.log(`[@carno.js/client] Using existing ${rel}`);
                }
            } else {
                generate(this.options);
            }
        } catch (error) {
            console.error('[@carno.js/client] Failed to generate client:', error);
            if (prod) {
                throw error;
            }
        }

        if (shouldWatch(this.options)) {
            this.watcher = createClientWatcher(this.options);
        }
    }

    @OnApplicationShutdown()
    async onShutdown(): Promise<void> {
        this.stopWatching();
    }

    stopWatching(): void {
        this.watcher?.close();
        this.watcher = null;
    }
}
