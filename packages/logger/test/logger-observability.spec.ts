import { describe, expect, it } from 'bun:test';
import { Controller, ExecutionContext, Get, withTestApp } from '@carno.js/core';
import { createCarnoLogger, LogLevel, LoggerService } from '../src';

describe('LoggerService JSON observability', () => {
  it('emits one structured JSON line with async execution context', () => {
    const lines: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((line: string) => {
      lines.push(line);
      return true;
    }) as typeof process.stdout.write;

    try {
      const logger = new LoggerService({ format: 'json', flushInterval: 0, timestamp: false });
      ExecutionContext.run({ requestId: 'request-123', kind: 'http', method: 'GET', route: '/users/:id' }, () => {
        logger.info('User fetched', { userId: '42' });
      });

      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toEqual({
        level: 'info',
        message: 'User fetched',
        context: {
          userId: '42',
          requestId: 'request-123',
          kind: 'http',
          method: 'GET',
          route: '/users/:id'
        }
      });
      logger.close();
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('serializes errors with a stack trace in JSON mode', () => {
    const lines: string[] = [];
    const originalWrite = process.stderr.write;
    process.stderr.write = ((line: string) => {
      lines.push(line);
      return true;
    }) as typeof process.stderr.write;

    try {
      const logger = new LoggerService({ format: 'json', flushInterval: 0, timestamp: false, level: LogLevel.DEBUG });
      logger.error('Operation failed', { error: new Error('boom') });

      const entry = JSON.parse(lines[0]);
      expect(entry.level).toBe('error');
      expect(entry.context.error).toMatchObject({ name: 'Error', message: 'boom' });
      expect(entry.context.error.stack).toContain('boom');
      logger.close();
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it('does not propagate JSON serialization failures to the caller', () => {
    const lines: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((line: string) => { lines.push(line); return true; }) as typeof process.stdout.write;

    try {
      const logger = new LoggerService({ format: 'json', flushInterval: 0, timestamp: false });
      const unsafeData = { toJSON: () => { throw new Error('cannot serialize'); } };

      expect(() => logger.info('Request completed', { unsafeData })).not.toThrow();
      expect(JSON.parse(lines[0])).toEqual({
        level: 'info',
        message: 'Request completed',
        context: { serializationError: true }
      });
      logger.close();
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('enables HTTP instrumentation only when the logger plugin is registered', async () => {
    @Controller('/observable')
    class ObservableController {
      @Get()
      get() {
        return { ok: true };
      }
    }

    const lines: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((line: string) => { lines.push(line); return true; }) as typeof process.stdout.write;

    try {
      await withTestApp(async harness => {
        const response = await harness.get('/observable', { headers: { 'x-request-id': 'logger-plugin-id' } });
        expect(response.headers.get('x-request-id')).toBe('logger-plugin-id');
        expect(lines.map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({
          message: 'HTTP request completed',
          context: expect.objectContaining({ requestId: 'logger-plugin-id', route: '/observable', status: 200 })
        }));
        harness.resolve(LoggerService).close();
      }, {
        controllers: [ObservableController],
        plugins: [createCarnoLogger({ format: 'json', flushInterval: 0, timestamp: false })],
        listen: true
      });
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
