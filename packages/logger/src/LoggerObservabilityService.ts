import { ObservabilityService, type ExecutionContextData } from '@carno.js/core';
import { LoggerService } from './LoggerService';

/** Connects the framework's optional observability events to LoggerService. */
export class LoggerObservabilityService extends ObservabilityService {
    override readonly enabled = true;

    constructor(private readonly logger: LoggerService) {
        super();
    }

    override onHttpRequestComplete(context: ExecutionContextData, status: number, durationMs: number): void {
        this.logger.info('HTTP request completed', {
            status,
            durationMs: Math.round(durationMs * 1000) / 1000,
            ...context
        });
    }

    override onExecutionError(context: ExecutionContextData, error: unknown): void {
        this.logger.error(
            context.kind === 'http' ? 'Unhandled HTTP request error' : 'Unhandled background execution error',
            { error, ...context }
        );
    }

    override onMetric(
        name: string,
        value: number,
        tags?: Record<string, string | number | boolean>
    ): void {
        this.logger.info('Metric', { metric: name, value, ...tags });
    }
}

