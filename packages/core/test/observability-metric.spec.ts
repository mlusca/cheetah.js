import { describe, expect, it } from 'bun:test';
import { ObservabilityService } from '../src/observability/ObservabilityService';

describe('ObservabilityService.onMetric', () => {
  it('is a no-op on the base class, like the other hooks', () => {
    const service = new ObservabilityService();

    expect(() => service.onMetric('anything', 1)).not.toThrow();
    expect(service.enabled).toBe(false);
  });

  it('is overridable, and receives name, value and tags', () => {
    const seen: unknown[] = [];

    class Recording extends ObservabilityService {
      override readonly enabled = true;

      override onMetric(name: string, value: number, tags?: Record<string, string | number | boolean>): void {
        seen.push({ name, value, tags });
      }
    }

    new Recording().onMetric('live.recompute', 1, { resource: 'X.y', patched: false });

    expect(seen).toEqual([{ name: 'live.recompute', value: 1, tags: { resource: 'X.y', patched: false } }]);
  });
});
