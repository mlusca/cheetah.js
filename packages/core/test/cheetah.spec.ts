import { afterEach, describe, expect, it, beforeEach } from 'bun:test'
import { Cheetah, Controller, Get } from '../src';

describe('Cheetah', () => {
  @Controller()
  class TestController {

    @Get()
    async test() {
      return 'Test'
    }
  }

  let cheetah: Cheetah | null

  beforeEach(() => {
    cheetah = null;
  })

  afterEach(async () => {
    cheetah?.close(true)
  })

  it('should create a instance of Cheetah with controller', async () => {
    cheetah = new Cheetah({
      providers: [TestController]
    })
    await cheetah.listen(3000)

    const injector = cheetah.getInjector()
    const match = injector.router.find('get', '/')
    expect(match).not.toBeNull()
  });

  it('should create a instance of Cheetah without controller', async () => {
    cheetah = new Cheetah()
    await cheetah.listen(3000)

    const injector = cheetah.getInjector()
    const match = injector.router.find('get', '/')

    expect(match).toBeNull()
  })

  it('should use a plugin', async () => {
    Controller()(TestController) // Reload the decorator
    const plugin = new Cheetah({
      exports: [TestController]
    })

    cheetah = new Cheetah()
    cheetah.use(plugin)
    await cheetah.listen(3000)

    const injector = cheetah.getInjector()
    const match = injector.router.find('get', '/')

    expect(match).not.toBeNull()
  })
})