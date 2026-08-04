import { describe, expect, it } from 'bun:test';
import { ExecutionContext } from '@carno.js/core';
import {
  CARNO_OBSERVABILITY_METADATA,
  addObservabilityMetadata,
  getOriginRequestId,
} from '../src/services/observability-context';

describe('queue observability context', () => {
  it('copies the request id to reserved job metadata without mutating payload', () => {
    const data = { userId: '42' };
    const enriched = ExecutionContext.run({ requestId: 'request-42', kind: 'http' }, () =>
      addObservabilityMetadata(data)
    );

    expect(data).toEqual({ userId: '42' });
    expect(enriched).toMatchObject({
      userId: '42',
      [CARNO_OBSERVABILITY_METADATA]: { version: 1, requestId: 'request-42' }
    });
    expect(getOriginRequestId({ data: enriched })).toBe('request-42');
  });

  it('does not restore untrusted correlation identifiers from a job payload', () => {
    expect(getOriginRequestId({
      data: { [CARNO_OBSERVABILITY_METADATA]: { version: 1, requestId: 'trusted\nforged-log' } }
    })).toBeUndefined();
  });

  it('adds correlation metadata when a job has no payload', () => {
    const enriched = ExecutionContext.run({ requestId: 'request-42', kind: 'http' }, () =>
      addObservabilityMetadata(undefined)
    );

    expect(enriched).toEqual({
      [CARNO_OBSERVABILITY_METADATA]: { version: 1, requestId: 'request-42' }
    });
  });
});
