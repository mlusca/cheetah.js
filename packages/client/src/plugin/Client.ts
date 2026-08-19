import { Carno } from '@carno.js/core';
import type { ClientOptions } from '../codegen/options';
import { ClientService } from './ClientService';

export type { ClientOptions };

/**
 * Carno plugin that generates a typed HTTP client from controller sources.
 *
 * This is the primary UX: import the plugin and call `.use(Client())`.
 * Codegen runs automatically during `listen()` via `@OnApplicationInit`.
 * In development a file watcher keeps `src/generated/app.ts` in sync.
 *
 * @example
 * ```ts
 * import { Carno } from '@carno.js/core'
 * import { Client } from '@carno.js/client'
 *
 * const app = new Carno()
 *   .use(Client())
 *   .controllers([UserController])
 *
 * await app.listen(3000)
 * ```
 */
export function Client(options: ClientOptions = {}): Carno {
    const service = new ClientService(options);

    return new Carno().services({
        token: ClientService,
        useValue: service
    });
}
