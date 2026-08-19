export { client } from './client/http';
export type {
    HttpMethod,
    RouteOptions,
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
