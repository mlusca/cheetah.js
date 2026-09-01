import 'reflect-metadata';

// Decorator and metadata
export { Live } from './decorators/Live';
export { LIVE_META } from './metadata';
export type { LiveMeta, LiveOptions, LiveShared } from './metadata';

// Plugin and services
export { LivePlugin } from './LivePlugin';
export type { LivePluginOptions } from './LivePlugin';
export { closeLiveRuntime } from './runtime';
export { LiveService } from './LiveService';
export { LiveEngine } from './LiveEngine';
export type { LiveTransport, LiveStats } from './LiveEngine';

// Metrics
export { LiveMetrics } from './observability';
export type { MetricSink } from './observability';

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
export { PgNotifyBus, chunkEvents } from './bus/PgNotifyBus';
export type { PgNotifyBusOptions } from './bus/PgNotifyBus';
export { PgNotifyEmitter, eventsFromPayload } from './emitters/pg-notify-emitter';
export type { PgNotifyEmitterOptions, PgNotifyTable } from './emitters/pg-notify-emitter';
export { PgListener } from './emitters/pg-listener';
export type { ListenableSql, PgListenerOptions } from './emitters/pg-listener';
export { tableOfKey } from './graph/dep-key';

// Protocol and patches, shared with the client
export * from './shared/protocol';
export type { PatchOp, PathSegment } from './patch/types';
export { PatchEngine } from './patch/PatchEngine';
export { canonical, NonSerializableInputError } from './shared/canonical';
export { fnv1a64 } from './shared/hash';
export { normalizeLiveInputs, resourceIdOf } from './shared/descriptor';
export type { LiveDataOf, LiveDescriptor, LiveInputsOf } from './shared/descriptor';
export type { OptimisticEntry, OptimisticList } from './client/optimistic';

// Framework-free client adapter
export { liveStore, liveStoreOf, liveIdentity, LiveSlot } from './client/vanilla';
export type { LiveHandle } from './client/vanilla';

export { WebSocketTransport, LadderTransport, PollingTransport, SseClientTransport, routeIndex } from './client/transport';
export type { ClientTransport, TransportHandlers, EventSourceLike, RoutePath } from './client/transport';

// Transports
export { FanTransport } from './transport/FanTransport';
export type { OwnedTransport } from './transport/FanTransport';
export { SseTransport } from './transport/SseTransport';
export type { SseTransportOptions } from './transport/SseTransport';
export { createSseRoutes } from './transport/sse-routes';
export type { SseRouteOptions } from './transport/sse-routes';

// Conditional GET
export { LiveETagMiddleware, pathMatcher } from './http/etag';
export type { LiveRoutePath } from './http/etag';
