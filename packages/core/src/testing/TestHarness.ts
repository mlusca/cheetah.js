import type { Server } from 'bun';
import { Carno, type CarnoConfig } from '../Carno';
import { Container, type Token } from '../container/Container';

/**
 * Test configuration options.
 */
export interface TestOptions {
    config?: CarnoConfig;
    listen?: boolean | number;
    port?: number;
    controllers?: (new (...args: any[]) => any)[];
    services?: (Token | any)[];
    plugins?: Carno[];
}

/**
 * Test harness - provides utilities for testing Carno applications.
 */
export interface TestHarness {
    /** The Carno app instance */
    app: Carno;

    /** The internal DI container */
    container: Container;

    /** The HTTP server (if listening) */
    server?: Server<any>;

    /** The port the server is running on */
    port?: number;

    /** Resolve a service from the container */
    resolve<T>(token: Token<T>): T;

    /** Make an HTTP request to the app */
    request(path: string, init?: RequestInit): Promise<Response>;

    /** Make a GET request */
    get(path: string, init?: Omit<RequestInit, 'method'>): Promise<Response>;

    /** Make a POST request */
    post(path: string, body?: any, init?: Omit<RequestInit, 'method' | 'body'>): Promise<Response>;

    /** Make a PUT request */
    put(path: string, body?: any, init?: Omit<RequestInit, 'method' | 'body'>): Promise<Response>;

    /** Make a DELETE request */
    delete(path: string, init?: Omit<RequestInit, 'method'>): Promise<Response>;

    /** Close the test harness and cleanup */
    close(): Promise<void>;
}

/**
 * Create a test harness for Turbo applications.
 * 
 * @example
 * ```typescript
 * const harness = await createTestHarness({
 *   controllers: [UserController],
 *   services: [UserService],
 *   listen: true
 * });
 * 
 * const response = await harness.get('/users');
 * expect(response.status).toBe(200);
 * 
 * await harness.close();
 * ```
 */
export async function createTestHarness(options: TestOptions = {}): Promise<TestHarness> {
    const config: CarnoConfig = {
        ...options.config,
        disableStartupLog: true
    };

    const app = new Carno(config);

    // Register plugins
    if (options.plugins) {
        for (const plugin of options.plugins) {
            app.use(plugin);
        }
    }

    // Register controllers
    if (options.controllers) {
        app.controllers(options.controllers);
    }

    // Register services
    if (options.services) {
        app.services(options.services);
    }

    const port = resolvePort(options);
    let server: Server<any> | undefined;

    if (shouldListen(options.listen)) {
        await app.listen(port);
        server = (app as any).server;
    }

    const actualPort = server?.port ?? port;
    const container = (app as any).container as Container;

    // Pre-bind methods for performance
    const baseUrl = `http://127.0.0.1:${actualPort}`;

    const request = async (path: string, init?: RequestInit): Promise<Response> => {
        if (!server) {
            throw new Error('Server not running. Set listen: true in options.');
        }
        const url = path.startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? path : '/' + path}`;
        return fetch(url, init);
    };

    return {
        app,
        container,
        server,
        port: actualPort,

        resolve: <T>(token: Token<T>): T => container.get(token),

        request,

        get: (path, init) => request(path, { ...init, method: 'GET' }),

        post: (path, body, init) => request(path, {
            ...init,
            method: 'POST',
            body: body ? JSON.stringify(body) : undefined,
            headers: { 'Content-Type': 'application/json', ...init?.headers }
        }),

        put: (path, body, init) => request(path, {
            ...init,
            method: 'PUT',
            body: body ? JSON.stringify(body) : undefined,
            headers: { 'Content-Type': 'application/json', ...init?.headers }
        }),

        delete: (path, init) => request(path, { ...init, method: 'DELETE' }),

        close: async () => {
            app.stop();
        }
    };
}

/**
 * Run a test routine with automatic harness cleanup.
 * 
 * @example
 * ```typescript
 * await withTestApp(async (harness) => {
 *   const response = await harness.get('/health');
 *   expect(response.status).toBe(200);
 * }, { controllers: [HealthController], listen: true });
 * ```
 */
export async function withTestApp(
    routine: (harness: TestHarness) => Promise<void>,
    options: TestOptions = {}
): Promise<void> {
    const harness = await createTestHarness(options);

    try {
        await routine(harness);
    } finally {
        await harness.close();
    }
}

function shouldListen(value: TestOptions['listen']): boolean {
    return typeof value === 'number' || Boolean(value);
}

function resolvePort(options: TestOptions): number {
    if (typeof options.listen === 'number') return options.listen;
    if (typeof options.port === 'number') return options.port;
    return 0; // Random port
}
