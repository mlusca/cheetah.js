/**
 * Log levels.
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    FATAL = 4,
    SILENT = 5
}

/**
 * Logger configuration.
 */
export interface LoggerConfig {
    /** Minimum log level to output */
    level?: LogLevel | keyof typeof LogLevel;

    /** Pretty print structured data */
    pretty?: boolean;

    /** Output format. `pretty` preserves the legacy human-readable output. */
    format?: 'pretty' | 'json';

    /** Include timestamp */
    timestamp?: boolean;

    /** Custom timestamp format function */
    timestampFormat?: () => string;

    /** Prefix for all messages */
    prefix?: string;

    /** Async buffer flush interval (ms). 0 = sync */
    flushInterval?: number;
}

import { ExecutionContext, OnApplicationShutdown } from '@carno.js/core';

/**
 * Structured log data.
 */
export type LogData = Record<string, any>;

// ANSI color codes for beautiful output
const COLORS = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',

    // Levels
    debug: '\x1b[36m',    // Cyan
    info: '\x1b[32m',     // Green
    warn: '\x1b[33m',     // Yellow
    error: '\x1b[31m',    // Red
    fatal: '\x1b[35m',    // Magenta

    // Data
    key: '\x1b[90m',      // Gray
    string: '\x1b[33m',   // Yellow
    number: '\x1b[36m',   // Cyan
    boolean: '\x1b[35m',  // Magenta
    null: '\x1b[90m',     // Gray
};

const LEVEL_LABELS: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: `${COLORS.debug}${COLORS.bold}DEBUG${COLORS.reset}`,
    [LogLevel.INFO]: `${COLORS.info}${COLORS.bold}INFO${COLORS.reset} `,
    [LogLevel.WARN]: `${COLORS.warn}${COLORS.bold}WARN${COLORS.reset} `,
    [LogLevel.ERROR]: `${COLORS.error}${COLORS.bold}ERROR${COLORS.reset}`,
    [LogLevel.FATAL]: `${COLORS.fatal}${COLORS.bold}FATAL${COLORS.reset}`,
    [LogLevel.SILENT]: '',
};

const LEVEL_ICONS: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: '🔍',
    [LogLevel.INFO]: '✨',
    [LogLevel.WARN]: '⚠️ ',
    [LogLevel.ERROR]: '❌',
    [LogLevel.FATAL]: '💀',
    [LogLevel.SILENT]: '',
};

/**
 * High-performance async logger.
 * 
 * Features:
 * - Async buffered output (like Pino)
 * - Structured JSON data support
 * - Beautiful colorized output
 * - Zero-allocation hot path
 * 
 * @example
 * ```typescript
 * const logger = new LoggerService({ level: LogLevel.DEBUG });
 * 
 * logger.info('User logged in', { userId: 123, ip: '192.168.1.1' });
 * logger.error('Database error', { error: err.message, query: sql });
 * ```
 */
export class LoggerService {
    private level: LogLevel;
    private pretty: boolean;
    private format: 'pretty' | 'json';
    private timestamp: boolean;
    private timestampFormat: () => string;
    private prefix: string;
    private buffer: string[] = [];
    private flushTimer: Timer | null = null;
    private flushInterval: number;


    constructor(config: LoggerConfig = {}) {
        this.level = this.parseLevel(config.level ?? LogLevel.INFO);
        this.pretty = config.pretty ?? true;
        this.format = config.format ?? 'pretty';
        this.timestamp = config.timestamp ?? true;
        this.timestampFormat = config.timestampFormat ?? this.defaultTimestamp;
        this.prefix = config.prefix ?? '';
        this.flushInterval = config.flushInterval ?? 10;

        if (this.flushInterval > 0) {
            this.flushTimer = setInterval(() => this.flush(), this.flushInterval);
            // The logger must not keep a CLI, test process, or worker alive
            // solely because it is waiting to flush its small buffer.
            (this.flushTimer as any).unref?.();
        }

        // Ensure logs are flushed when the process exits
        process.on('exit', () => this.flush());
    }

    @OnApplicationShutdown()
    shutdown(): void {
        this.flush();
    }

    /**
     * Debug level log.
     */
    debug(message: string, data?: LogData): void {
        this.log(LogLevel.DEBUG, message, data);
    }

    /**
     * Info level log.
     */
    info(message: string, data?: LogData): void {
        this.log(LogLevel.INFO, message, data);
    }

    /**
     * Warning level log.
     */
    warn(message: string, data?: LogData): void {
        this.log(LogLevel.WARN, message, data);
    }

    /**
     * Error level log.
     */
    error(message: string, data?: LogData): void {
        this.log(LogLevel.ERROR, message, data);
    }

    /**
     * Fatal level log (will also flush immediately).
     */
    fatal(message: string, data?: LogData): void {
        this.log(LogLevel.FATAL, message, data);
        this.flush(); // Flush immediately for fatal
    }

    /**
     * Log with custom level.
     */
    log(level: LogLevel, message: string, data?: LogData): void {
        if (level < this.level) return;

        let line: string;
        try {
            line = this.formatLine(level, message, this.withExecutionContext(data));
        } catch {
            line = this.formatSerializationFallback(level, message);
        }

        if (this.flushInterval === 0) {
            // Sync mode
            this.write(line, level);
        } else {
            // Async mode
            this.buffer.push(line);
        }
    }

    /**
     * Set minimum log level.
     */
    setLevel(level: LogLevel | keyof typeof LogLevel): void {
        this.level = this.parseLevel(level);
    }

    /**
     * Flush buffered logs.
     */
    flush(): void {
        if (this.buffer.length === 0) return;

        const output = this.buffer.join('\n');
        this.buffer = [];

        process.stdout.write(output + '\n');
    }

    /**
     * Close the logger (flush and stop timer).
     */
    close(): void {
        this.flush();
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
    }

    private write(line: string, level: LogLevel): void {
        if (level >= LogLevel.ERROR) {
            process.stderr.write(line + '\n');
        } else {
            process.stdout.write(line + '\n');
        }
    }

    private formatLine(level: LogLevel, message: string, data?: LogData): string {
        if (this.format === 'json') {
            return this.formatJsonLine(level, message, data);
        }

        const parts: string[] = [];

        // Icon
        parts.push(LEVEL_ICONS[level]);

        // Timestamp
        if (this.timestamp) {
            parts.push(`${COLORS.dim}${this.timestampFormat()}${COLORS.reset}`);
        }

        // Level label
        parts.push(LEVEL_LABELS[level]);

        // Prefix
        if (this.prefix) {
            parts.push(`${COLORS.bold}[${this.prefix}]${COLORS.reset}`);
        }

        // Message
        parts.push(message);

        // Data
        if (data && Object.keys(data).length > 0) {
            if (this.pretty) {
                parts.push(this.formatDataPretty(data));
            } else {
                parts.push(`${COLORS.dim}${JSON.stringify(data)}${COLORS.reset}`);
            }
        }

        return parts.join(' ');
    }

    private formatJsonLine(level: LogLevel, message: string, data?: LogData): string {
        try {
            const entry: Record<string, unknown> = {
                ...(this.timestamp ? { timestamp: this.timestampFormat() } : {}),
                level: this.levelName(level),
                message,
                context: data || {}
            };

            if (this.prefix) entry.prefix = this.prefix;
            return JSON.stringify(entry, this.jsonReplacer());
        } catch {
            return this.formatSerializationFallback(level, message);
        }
    }

    private formatSerializationFallback(level: LogLevel, message: string): string {
        const safeMessage = typeof message === 'string' ? message : 'Logger serialization failure';
        if (this.format === 'json') {
            return JSON.stringify({
                level: this.levelName(level),
                message: safeMessage,
                context: { serializationError: true }
            });
        }
        return `[LOGGER SERIALIZATION ERROR] ${safeMessage}`;
    }

    private withExecutionContext(data?: LogData): LogData | undefined {
        const executionContext = ExecutionContext.get();
        if (!executionContext) return data;
        return { ...(data || {}), ...executionContext };
    }

    private levelName(level: LogLevel): string {
        switch (level) {
            case LogLevel.DEBUG: return 'debug';
            case LogLevel.INFO: return 'info';
            case LogLevel.WARN: return 'warn';
            case LogLevel.ERROR: return 'error';
            case LogLevel.FATAL: return 'fatal';
            default: return 'silent';
        }
    }

    private jsonReplacer(): (key: string, value: unknown) => unknown {
        const seen = new WeakSet<object>();
        return (_key, value) => {
            if (value instanceof Error) {
                return { name: value.name, message: value.message, stack: value.stack };
            }
            if (typeof value === 'bigint') return value.toString();
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) return '[Circular]';
                seen.add(value);
            }
            return value;
        };
    }

    private formatDataPretty(data: LogData): string {
        const formatted: string[] = [];

        for (const [key, value] of Object.entries(data)) {
            const formattedValue = this.formatValue(value);
            formatted.push(`${COLORS.key}${key}=${COLORS.reset}${formattedValue}`);
        }

        return formatted.join(' ');
    }

    private formatValue(value: any): string {
        if (value instanceof Error) {
            const summary = `${value.name}: ${value.message}`;
            return value.stack ? `${summary}\n${value.stack}` : summary;
        }
        if (value === null) {
            return `${COLORS.null}null${COLORS.reset}`;
        }
        if (value === undefined) {
            return `${COLORS.null}undefined${COLORS.reset}`;
        }
        if (typeof value === 'string') {
            return `${COLORS.string}"${value}"${COLORS.reset}`;
        }
        if (typeof value === 'number') {
            return `${COLORS.number}${value}${COLORS.reset}`;
        }
        if (typeof value === 'boolean') {
            return `${COLORS.boolean}${value}${COLORS.reset}`;
        }
        if (Array.isArray(value)) {
            return `${COLORS.dim}[${value.length} items]${COLORS.reset}`;
        }
        if (typeof value === 'object') {
            return `${COLORS.dim}{${Object.keys(value).length} keys}${COLORS.reset}`;
        }
        return String(value);
    }

    private defaultTimestamp(): string {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        const ms = String(now.getMilliseconds()).padStart(3, '0');
        return `${h}:${m}:${s}.${ms}`;
    }

    private parseLevel(level: LogLevel | keyof typeof LogLevel): LogLevel {
        if (typeof level === 'number') return level;
        return LogLevel[level] ?? LogLevel.INFO;
    }
}
