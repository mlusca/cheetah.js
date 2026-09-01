import { Service } from '@carno.js/core';
import { getLiveRuntime } from './runtime';

/**
 * Manual invalidation — the third emitter of §4.4, for data the ORM cannot
 * see: a rebuilt report, a webhook, an external cache.
 *
 * @example
 * ```ts
 * @Service()
 * export class ReportJob {
 *     constructor(private readonly live: LiveService) {}
 *
 *     @Cron('0 * * * *')
 *     async run() {
 *         await this.rebuild();
 *         this.live.invalidate('app:report:current');
 *     }
 * }
 * ```
 */
@Service()
export class LiveService {
    invalidate(key: string): void {
        getLiveRuntime().engine.invalidate(key);
    }
}
