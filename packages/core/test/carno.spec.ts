import { afterEach, describe, expect, it, beforeEach } from 'bun:test'
import { Carno, Controller, Get } from '../src';
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

  afterEach(() => {
    carno?.stop()
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
})