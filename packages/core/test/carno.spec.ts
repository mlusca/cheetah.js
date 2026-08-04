import { afterEach, describe, expect, it, beforeEach } from 'bun:test'
import { CacheService, Carno, Controller, Get, MemoryDriver } from '../src';
import { withTestApp } from '../src/testing/TestHarness';

describe('Carno', () => {
  @Controller()
  class TestController {
    @Get()
    test() {
      return 'Test'
    }
  }

  let carno: Carno | null

  beforeEach(() => {
    carno = null;
  })

  afterEach(async () => {
    await carno?.stop()
  })

  it('should create a instance of Carno with controller', async () => {
    await withTestApp(async (harness) => {
      const response = await harness.get('/');
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('Test');
    }, {
      controllers: [TestController],
      listen: true
    });
  });

  it('should create a instance of Carno without controller', async () => {
    await withTestApp(async (harness) => {
      const response = await harness.get('/');
      expect(response.status).toBe(404);
    }, {
      listen: true
    });
  })

  it('should use a plugin', async () => {
    Controller()(TestController) // Reload the decorator

    const plugin = new Carno()
    plugin.controllers(TestController)

    carno = new Carno()
    carno.use(plugin)
    await carno.listen(3001)

    const response = await fetch('http://127.0.0.1:3001/');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Test');
  })

  it('stop() closes the registered CacheService', async () => {
    const driver = new MemoryDriver({ maxEntries: 10, cleanupIntervalMs: 30_000 });
    const closeSpy = { called: false };
    const originalClose = driver.close.bind(driver);
    driver.close = async () => {
      closeSpy.called = true;
      await originalClose();
    };

    carno = new Carno({
      disableStartupLog: true,
      cache: { driver },
    });
    await carno.listen(3021);

    const cache = carno.get(CacheService);
    await cache.set('keep', 'value');
    expect(await cache.get('keep')).toBe('value');

    await carno.stop();
    carno = null;

    expect(closeSpy.called).toBe(true);
    // MemoryDriver.close clears storage
    expect(driver.stats().size).toBe(0);
  });

  it('graceful SIGTERM shutdown awaits CacheService.close()', async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const originalOn = process.on;
    const originalExit = process.exit;
    let exitCode: number | undefined;

    process.on = ((event: string, listener: (...args: any[]) => any) => {
      handlers.set(event, listener);
      return process;
    }) as typeof process.on;

    process.exit = ((code?: number) => {
      exitCode = code;
      return undefined as never;
    }) as typeof process.exit;

    try {
      const driver = new MemoryDriver({ maxEntries: 10, cleanupIntervalMs: 30_000 });
      const closeSpy = { called: false };
      const originalClose = driver.close.bind(driver);
      driver.close = async () => {
        closeSpy.called = true;
        await originalClose();
      };

      carno = new Carno({
        disableStartupLog: true,
        cache: { driver },
      });
      await carno.listen(3022);

      const sigterm = handlers.get('SIGTERM');
      expect(sigterm).toBeDefined();

      await sigterm?.();

      expect(closeSpy.called).toBe(true);
      expect(exitCode).toBe(0);
      carno = null;
    } finally {
      process.on = originalOn;
      process.exit = originalExit;
    }
  });
})