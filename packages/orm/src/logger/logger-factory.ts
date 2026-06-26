import type { Logger } from './logger.interface';
import { ConsoleLogger } from './console-logger';
import { SilentLogger } from './silent-logger';

let cachedLogger: Logger | null = null;
let debugEnabled: boolean | null = null;

/**
 * Creates or returns a cached logger instance.
 * Tries to use @carno.js/logger if available, falls back to console.
 * Only logs if debug is enabled in config.
 */
export function createLogger(): Logger {
  if (cachedLogger) {
    return cachedLogger;
  }

  if (!isDebugEnabled()) {
    cachedLogger = new SilentLogger();
    return cachedLogger;
  }

  cachedLogger = tryLoadCarnoLogger() ?? new ConsoleLogger();

  return cachedLogger;
}

function isDebugEnabled(): boolean {
  if (debugEnabled !== null) {
    return debugEnabled;
  }

  debugEnabled = loadDebugConfig();

  return debugEnabled;
}

function loadDebugConfig(): boolean {
  if (process.env.DB_DEBUG === 'true') {
    return true;
  }

  return false;
}

function tryLoadCarnoLogger(): Logger | null {
  try {
    const loggerModule = require('@carno.js/logger');
    const LoggerService = loggerModule.LoggerService;

    if (LoggerService) {
      return new LoggerService({ level: 'DEBUG' });
    }
  } catch {
    // @carno.js/logger not installed
  }

  return null;
}

/**
 * Sets a custom logger instance.
 * Useful for testing or custom implementations.
 */
export function setLogger(logger: Logger): void {
  cachedLogger = logger;
}

/**
 * Resets the cached logger.
 * Useful for testing.
 */
export function resetLogger(): void {
  cachedLogger = null;
  debugEnabled = null;
}

/**
 * Enables or disables debug mode programmatically.
 */
export function setDebugEnabled(enabled: boolean): void {
  debugEnabled = enabled;
  cachedLogger = null;
}
