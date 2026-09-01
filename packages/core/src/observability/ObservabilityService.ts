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

    /**
     * A named number from anywhere in the framework.
     *
     * Deliberately generic. The alternative was a method per subsystem, which
     * would make core learn the vocabulary of packages it does not depend on
     * and that are optional -- `@carno.js/live` publishes recompute and
     * fan-out through here for exactly that reason. Names are namespaced by
     * their publisher (`live.recompute`, `queue.depth`).
     */
    onMetric(
        _name: string,
        _value: number,
        _tags?: Record<string, string | number | boolean>
    ): void {
        // no-op
    }
}
