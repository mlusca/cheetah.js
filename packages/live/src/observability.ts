/**
 * The slice of `ObservabilityService` the live package needs.
 *
 * Declared structurally rather than imported so `@carno.js/core` stays an
 * ordinary peer here and the metrics path is testable without one.
 */
export interface MetricSink {
    onMetric(name: string, value: number, tags?: Record<string, string | number | boolean>): void;
}

/**
 * Names the engine publishes, and the guard that keeps a broken metrics
 * backend from breaking the engine.
 *
 * The engine calls this unconditionally; `none()` is what makes that safe when
 * no observability plugin is installed, which is the default.
 */
export class LiveMetrics {
    constructor(private readonly sink: MetricSink | null) {}

    static none(): LiveMetrics {
        return new LiveMetrics(null);
    }

    recompute(resource: string, producedPatch: boolean, ops: number, durationMs: number): void {
        this.publish('live.recompute', 1, { resource, patched: producedPatch });
        this.publish('live.recompute.ms', durationMs, { resource });

        if (producedPatch) {
            this.publish('live.patch.ops', ops, { resource });
        }
    }

    invalidation(keys: number, fanout: number): void {
        this.publish('live.invalidation.keys', keys);
        this.publish('live.invalidation.fanout', fanout);
    }

    instances(count: number): void {
        this.publish('live.instances', count);
    }

    private publish(name: string, value: number, tags?: Record<string, string | number | boolean>): void {
        if (!this.sink) {
            return;
        }

        try {
            this.sink.onMetric(name, value, tags);
        } catch {
            // Losing a number is acceptable. Losing a recompute is not.
        }
    }
}
