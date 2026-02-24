/**
 * Carno - Ultra-Fast HTTP Framework
 * 
 * Design principles:
 * 1. ZERO abstraction at runtime - everything compiled at startup
 * 2. Direct Bun.serve() with native routes
 * 3. JIT compiled handlers with AOT async detection
 * 4. No intermediate layers in hot path
 * 5. Radix tree router for dynamic routes
 */

// Import reflect-metadata globally for decorator support
import 'reflect-metadata';

// Application
export { Carno } from './Carno';
export type { MiddlewareHandler, MiddlewareClass, MiddlewareEntry, CarnoConfig } from './Carno';

// Context
export { Context } from './context/Context';

// Decorators - Controller
export { Controller } from './decorators/Controller';
export type { ControllerOptions } from './metadata';

// Decorators - HTTP Methods
export { Get, Post, Put, Delete, Patch, Head, Options } from './decorators/methods';

// Decorators - Parameters
export { Param, Query, Body, Header, Req, Ctx, Locals } from './decorators/params';

// Decorators - Middleware
export { Use, Use as Middleware } from './decorators/Middleware';

// Middleware Interface
export type { CarnoMiddleware, CarnoClosure } from './middleware/CarnoMiddleware';

// Decorators - DI
export { Service } from './decorators/Service';
export { Inject } from './decorators/Inject';

// Container
export { Container, Scope } from './container/Container';
export type { Token, ProviderConfig } from './container/Container';

// Router
export { RadixRouter } from './router/RadixRouter';
export type { RouteMatch } from './router/RadixRouter';

// CORS
export { CorsHandler } from './cors/CorsHandler';
export type { CorsConfig, CorsOrigin } from './cors/CorsHandler';

// Validation
export type { ValidatorAdapter, ValidationResult, ValidationError, ValidationConfig } from './validation/ValidatorAdapter';
export { Schema, getSchema, VALIDATION_SCHEMA } from './validation/ValidatorAdapter';
export { ZodAdapter, ValidationException } from './validation/ZodAdapter';
export { ValibotAdapter } from './validation/ValibotAdapter';

// Exceptions
export {
    HttpException,
    BadRequestException,
    UnauthorizedException,
    ForbiddenException,
    NotFoundException,
    MethodNotAllowedException,
    ConflictException,
    UnprocessableEntityException,
    TooManyRequestsException,
    InternalServerErrorException,
    ServiceUnavailableException
} from './exceptions/HttpException';

// Lifecycle Events
export {
    EventType,
    OnApplicationInit,
    OnApplicationBoot,
    OnApplicationShutdown
} from './events/Lifecycle';

// Cache
export { CacheService } from './cache/CacheService';
export { MemoryDriver } from './cache/MemoryDriver';
export { RedisDriver } from './cache/RedisDriver';
export type { RedisConfig } from './cache/RedisDriver';
export type { CacheDriver, CacheConfig } from './cache/CacheDriver';

// Testing
export { createTestHarness, withTestApp } from './testing/TestHarness';
export type { TestHarness, TestOptions } from './testing/TestHarness';

// Utils
export { Metadata, isObject, isString } from './utils/Metadata';
