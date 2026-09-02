import { Service } from '@carno.js/core';
import { getLiveRuntime } from './runtime';
import { prefetchLive, type LivePayload } from './resource/prefetch';
import { resourceIdOf, type LiveDescriptor } from './shared/descriptor';
import type { LiveExecutionContext, LiveInputs } from './resource/types';

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

    /**
     * Compute a live resource for a server-rendered first paint.
     *
     * Hand the payload to the template; the client starts full and its
     * subscription carries only the hash, so the first screen costs one
     * request instead of two and the data is never sent twice.
     */
    prefetch(
        resource: string | LiveDescriptor<any>,
        inputs: Partial<LiveInputs> = {},
        context: LiveExecutionContext = {}
    ): Promise<LivePayload> {
        const resourceId = typeof resource === 'string' ? resource : resourceIdOf(resource);

        return prefetchLive(getLiveRuntime().resources, resourceId, inputs, context);
    }
}
