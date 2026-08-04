import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Correlation data associated with the current asynchronous execution.
 * It deliberately contains operational metadata only; request payloads and
 * headers must never be placed here automatically.
 */
export interface ExecutionContextData {
    requestId: string;
    kind: 'http' | 'queue' | 'schedule';
    method?: string;
    route?: string;
    queueName?: string;
    jobName?: string;
    jobId?: string;
    scheduleName?: string;
    scheduleType?: 'cron' | 'interval' | 'timeout';
}

const storage = new AsyncLocalStorage<ExecutionContextData>();

/**
 * Async-safe execution context shared by core integrations.  A separate
 * store is created for every request, queue job, and scheduled invocation.
 */
export class ExecutionContext {
    private static readonly REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

    static run<T>(context: ExecutionContextData, callback: () => T): T {
        return storage.run(Object.freeze({ ...context }), callback);
    }

    static get(): Readonly<ExecutionContextData> | undefined {
        return storage.getStore();
    }

    static createRequestId(): string {
        return crypto.randomUUID();
    }

    static isValidRequestId(value: unknown): value is string {
        return typeof value === 'string' && this.REQUEST_ID_PATTERN.test(value);
    }
}
