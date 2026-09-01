import 'reflect-metadata';

// Decorator and metadata
export { Live } from './decorators/Live';
export { LIVE_META } from './metadata';
export type { LiveMeta, LiveOptions, LiveShared } from './metadata';

// Plugin and services
export { LivePlugin } from './LivePlugin';
export type { LivePluginOptions } from './LivePlugin';
export { LiveService } from './LiveService';
export { LiveEngine } from './LiveEngine';
export type { LiveTransport, LiveStats } from './LiveEngine';

// Configuration
export { DEFAULT_LIVE_CONFIG, resolveLiveConfig } from './config';
export type { LiveConfig } from './config';

// Scope
export { ConnectionScopeResolver } from './transport/scope-resolver';
export type { LiveHandshake, LiveScopeResolver } from './transport/scope-resolver';
export type { LiveInputs, LiveScope } from './shared/inputs';

// Authorization
export { AllowAllAuthorizer, authKeysOf, isAuthKey } from './auth/authorizer';
export type { LiveAuthorizationRequest, LiveAuthorizer } from './auth/authorizer';

// Invalidation
export { InProcessBus } from './bus/InProcessBus';
export type { InvalidationBus, InvalidationHandler } from './bus/InvalidationBus';
export type { Dependency, InvalidationEvent } from './graph/types';
export { ancestorsOf, rowKey, tableKey } from './graph/dep-key';
export type { DepKey } from './graph/dep-key';
export { WriteDuringComputeError } from './emitters/AppEmitter';

// Protocol and patches, shared with the client
export * from './shared/protocol';
export type { PatchOp, PathSegment } from './patch/types';
export { PatchEngine } from './patch/PatchEngine';
export { canonical, NonSerializableInputError } from './shared/canonical';
export { fnv1a64 } from './shared/hash';
