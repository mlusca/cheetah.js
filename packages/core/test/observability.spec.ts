import { describe, expect, it } from 'bun:test';
import { Carno, Controller, ExecutionContext, Get, HttpException, ObservabilityService, type ExecutionContextData } from '../src';
import { withTestApp } from '../src/testing/TestHarness';
import { LoggerService } from '@carno.js/logger';

class TestLoggerObservability extends ObservabilityService {
  override readonly enabled = true;

  constructor(private readonly logger: LoggerService) {
    super();
  }

  override onHttpRequestComplete(context: ExecutionContextData, status: number, durationMs: number): void {
    this.logger.info('HTTP request completed', { ...context, status, durationMs });
  }

  override onExecutionError(context: ExecutionContextData, error: unknown): void {
    this.logger.error('Unhandled HTTP request error', { ...context, error });
  }
}

function createTestLoggerPlugin(logger: LoggerService): Carno {
  return new Carno().services([
    { token: LoggerService, useValue: logger },
    { token: ObservabilityService, useValue: new TestLoggerObservability(logger) }
  ]);
}

describe('HTTP observability', () => {
  it('does not let a failing observability adapter alter HTTP responses', async () => {
    class FailingObservability extends ObservabilityService {
      override readonly enabled = true;

      override onHttpRequestComplete(): void {
        throw new Error('completion adapter failure');
      }

      override onExecutionError(): void {
        throw new Error('error adapter failure');
      }
    }

    @Controller('/adapter')
    class AdapterController {
      @Get('/success')
      success() {
        return { ok: true };
      }

      @Get('/failure')
      failure() {
        throw new Error('handler failure');
      }
    }

    const originalError = console.error;
    console.error = (() => undefined) as typeof console.error;
    try {
      await withTestApp(async harness => {
        const success = await harness.get('/adapter/success');
        expect(success.status).toBe(200);
        expect(success.headers.get('x-request-id')).toBeDefined();

        const failure = await harness.get('/adapter/failure');
        expect(failure.status).toBe(500);

        const repeatedFailure = await harness.get('/adapter/failure');
        expect(repeatedFailure.status).toBe(500);
      }, {
        controllers: [AdapterController],
        plugins: [new Carno().services({ token: ObservabilityService, useValue: new FailingObservability() })],
        listen: true
      });
    } finally {
      console.error = originalError;
    }
  });

  it('preserves request ids and logs route, status and duration', async () => {
    @Controller('/users')
    class UsersController {
      @Get('/:id')
      getUser() {
        return { ok: true };
      }
    }

    const lines: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((line: string) => {
      lines.push(line);
      return true;
    }) as typeof process.stdout.write;

    try {
      const logger = new LoggerService({ format: 'json', flushInterval: 0, timestamp: false });
      await withTestApp(async harness => {
        const response = await harness.get('/users/42', { headers: { 'x-request-id': 'gateway-42' } });
        expect(response.headers.get('x-request-id')).toBe('gateway-42');
        expect(response.status).toBe(200);

        const event = lines.map(line => JSON.parse(line)).find(line => line.message === 'HTTP request completed');
        expect(event.context).toMatchObject({
          requestId: 'gateway-42',
          method: 'GET',
          route: '/users/:id',
          status: 200
        });
        expect(event.context.durationMs).toBeGreaterThanOrEqual(0);
        logger.close();
      }, {
        controllers: [UsersController],
        plugins: [createTestLoggerPlugin(logger)],
        listen: true
      });
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('isolates request context and completion logs between concurrent requests', async () => {
    @Controller('/concurrent')
    class ConcurrentController {
      @Get()
      async get() {
        await Promise.resolve();
        return { requestId: ExecutionContext.get()?.requestId };
      }
    }

    const lines: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((line: string) => {
      lines.push(line);
      return true;
    }) as typeof process.stdout.write;

    try {
      const logger = new LoggerService({ format: 'json', flushInterval: 0, timestamp: false });
      await withTestApp(async harness => {
        const [first, second] = await Promise.all([
          harness.get('/concurrent', { headers: { 'x-request-id': 'concurrent-one' } }),
          harness.get('/concurrent', { headers: { 'x-request-id': 'concurrent-two' } })
        ]);
        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect((await first.json()).requestId).toBe('concurrent-one');
        expect((await second.json()).requestId).toBe('concurrent-two');

        const requestIds = lines
          .map(line => JSON.parse(line))
          .filter(line => line.message === 'HTTP request completed')
          .map(line => line.context.requestId)
          .sort();
        expect(requestIds).toEqual(['concurrent-one', 'concurrent-two']);
        logger.close();
      }, {
        controllers: [ConcurrentController],
        plugins: [createTestLoggerPlugin(logger)],
        listen: true
      });
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('generates request ids for static and failed requests without exposing stacks', async () => {
    @Controller('/broken')
    class BrokenController {
      @Get()
      fail() {
        throw new Error('private failure');
      }
    }

    const stdout: string[] = [];
    const stderr: string[] = [];
    const originalStdout = process.stdout.write;
    const originalStderr = process.stderr.write;
    process.stdout.write = ((line: string) => { stdout.push(line); return true; }) as typeof process.stdout.write;
    process.stderr.write = ((line: string) => { stderr.push(line); return true; }) as typeof process.stderr.write;

    try {
      const logger = new LoggerService({ format: 'json', flushInterval: 0, timestamp: false });
      await withTestApp(async harness => {
        const health = await harness.get('/health');
        expect(health.headers.get('x-request-id')).toMatch(/^[A-Za-z0-9._:-]+$/);

        const failure = await harness.get('/broken');
        expect(failure.status).toBe(500);
        expect(await failure.text()).not.toContain('private failure');

        const errorEvent = stderr.map(line => JSON.parse(line)).find(line => line.message === 'Unhandled HTTP request error');
        expect(errorEvent.context.requestId).toBeDefined();
        expect(errorEvent.context.error.stack).toContain('private failure');
        logger.close();
      }, {
        controllers: [BrokenController],
        plugins: [createTestLoggerPlugin(logger)],
        listen: true
      });
    } finally {
      process.stdout.write = originalStdout;
      process.stderr.write = originalStderr;
    }
  });

  it('does not report expected HTTP exceptions as unhandled errors', async () => {
    @Controller('/expected')
    class ExpectedErrorController {
      @Get()
      get() {
        throw new HttpException(422, 'Expected validation response');
      }
    }

    const stdout: string[] = [];
    const stderr: string[] = [];
    const originalStdout = process.stdout.write;
    const originalStderr = process.stderr.write;
    process.stdout.write = ((line: string) => { stdout.push(line); return true; }) as typeof process.stdout.write;
    process.stderr.write = ((line: string) => { stderr.push(line); return true; }) as typeof process.stderr.write;

    try {
      const logger = new LoggerService({ format: 'json', flushInterval: 0, timestamp: false });
      await withTestApp(async harness => {
        const response = await harness.get('/expected');
        expect(response.status).toBe(422);
        expect(stderr).toHaveLength(0);
        expect(stdout.map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({
          message: 'HTTP request completed',
          context: expect.objectContaining({ status: 422 })
        }));
        logger.close();
      }, {
        controllers: [ExpectedErrorController],
        plugins: [createTestLoggerPlugin(logger)],
        listen: true
      });
    } finally {
      process.stdout.write = originalStdout;
      process.stderr.write = originalStderr;
    }
  });
});
