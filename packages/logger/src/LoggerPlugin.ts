import { Carno, ObservabilityService } from '@carno.js/core';
import { LoggerService, LoggerConfig, LogLevel } from './LoggerService';
import { LoggerObservabilityService } from './LoggerObservabilityService';

/**
 * Logger plugin configuration.
 */
export interface LoggerPluginConfig extends LoggerConfig {
    /** Auto-register as singleton in DI */
    autoRegister?: boolean;

    /** Enable automatic HTTP correlation and request completion logs. */
    httpInstrumentation?: boolean;
}

/**
 * Create a logger plugin for Turbo.
 * 
 * @example
 * ```typescript
 * const app = new Turbo();
 * app.use(createLoggerPlugin({ level: LogLevel.DEBUG }));
 * 
 * // Now LoggerService is available for injection
 * @Controller()
 * class MyController {
 *   constructor(private logger: LoggerService) {}
 *   
 *   @Get('/')
 *   index() {
 *     this.logger.info('Request received', { path: '/' });
 *     return 'Hello';
 *   }
 * }
 * ```
 */
export function createCarnoLogger(config: LoggerPluginConfig = {}) {
    const logger = new LoggerService(config);
    const services: any[] = [
            {
                token: LoggerService,
                useValue: logger
            }
    ];

    if (config.httpInstrumentation !== false) {
        services.push({
            token: ObservabilityService,
            useValue: new LoggerObservabilityService(logger)
        });
    }

    return new Carno().services(services);
}

export const CarnoLogger = createCarnoLogger();

/**
 * Create a standalone logger (without Turbo).
 */
export function createLogger(config: LoggerConfig = {}): LoggerService {
    return new LoggerService(config);
}

// Re-export everything
export { LoggerService, LogLevel } from './LoggerService';
export type { LoggerConfig } from './LoggerService';
export type { LogData } from './LoggerService';
