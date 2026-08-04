import { ExecutionContext } from '@carno.js/core';

/** Reserved, versioned payload namespace used to transfer correlation across workers. */
export const CARNO_OBSERVABILITY_METADATA = '__carno_observability';
// Kept aligned with the HTTP boundary in @carno.js/core. This package can be
// tested against the currently published core build as well as workspace source.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

interface QueueObservabilityMetadata {
  version: 1;
  requestId: string;
}

export function addObservabilityMetadata(data: any): any {
  const context = ExecutionContext.get();
  if (!context?.requestId) {
    return data;
  }

  // BullMQ permits jobs without a payload. Normalize those to an object so
  // correlation metadata is not dropped by addBulk or add.
  if (data == null) {
    data = {};
  }

  if (typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }

  // Never overwrite a user-owned value in the reserved namespace.
  if (Object.prototype.hasOwnProperty.call(data, CARNO_OBSERVABILITY_METADATA)) {
    return data;
  }

  const metadata: QueueObservabilityMetadata = { version: 1, requestId: context.requestId };
  return { ...data, [CARNO_OBSERVABILITY_METADATA]: metadata };
}

export function getOriginRequestId(job: any): string | undefined {
  const metadata = job?.data?.[CARNO_OBSERVABILITY_METADATA] as QueueObservabilityMetadata | undefined;
  return metadata?.version === 1 && typeof metadata.requestId === 'string' && REQUEST_ID_PATTERN.test(metadata.requestId)
    ? metadata.requestId
    : undefined;
}
