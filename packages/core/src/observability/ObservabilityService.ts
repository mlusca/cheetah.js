import type { ExecutionContextData } from '../context/ExecutionContext';

/**
 * Optional bridge implemented by observability plugins.  Core supplies a
 * no-op instance, so packages can report failures without depending on a
 * concrete logger implementation.
 */
export class ObservabilityService {
    readonly enabled: boolean = false;

    onHttpRequestComplete(_context: ExecutionContextData, _status: number, _durationMs: number): void {
        // no-op
    }

    onExecutionError(_context: ExecutionContextData, _error: unknown): void {
        // no-op
    }
}
