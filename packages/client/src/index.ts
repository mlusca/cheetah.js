export { client } from './client/http';
export { createApi, fillPath } from './client/descriptor';
export type { ApiCall, ApiOf, RouteDescriptor, RouteInput } from './client/descriptor';
export type {
    HttpMethod,
    RouteOptions,
    RouteResponse,
    HttpClient,
    ClientConfig,
    ClientCreate,
    ClientErrorValue,
    ClientHeaders,
    ClientResult
} from './client/types';

export { Client } from './plugin/Client';
export { ClientService } from './plugin/ClientService';
export type { ClientOptions } from './codegen/options';
