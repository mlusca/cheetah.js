import { describe, it, expect, beforeEach } from 'bun:test';
import { Controller, Get, Context, Service } from '../src';
import { withTestApp } from '../src/testing/TestHarness';
import type { MiddlewareHandler, CarnoMiddleware, CarnoClosure } from '../src';

describe('MiddlewareResolver', () => {
  // Create middlewares that modify context.locals
  const middleware1: MiddlewareHandler = (ctx: Context) => {
    ctx.locals.test = 'middleware1';
  };

  const middleware2: MiddlewareHandler = (ctx: Context) => {
    const value = ctx.locals.test || '';
    ctx.locals.test = value + '-middleware2';
  };

  const middlewareThatReturnsResponse: MiddlewareHandler = (ctx: Context) => {
    return new Response('Blocked by middleware', { status: 403 });
  };

  it('should execute middlewares in order', async () => {
    @Controller('/test')
    class TestController {
      @Get()
      getTest(ctx: Context) {
        return { result: ctx.locals.test };
      }
    }

    await withTestApp(
      async (harness) => {
        const response = await harness.get('/test');
        expect(response.status).toBe(200);
        // Note: Without @Use decorator on controller, middlewares need to be global
      },
      {
        controllers: [TestController],
        config: {
          globalMiddlewares: [middleware1, middleware2],
        },
        listen: true,
      }
    );
  });

  it('should allow middleware to return early response', async () => {
    @Controller('/blocked')
    class BlockedController {
      @Get()
      shouldNotReach() {
        return { reached: true };
      }
    }

    await withTestApp(
      async (harness) => {
        const response = await harness.get('/blocked');
        expect(response.status).toBe(403);
        expect(await response.text()).toBe('Blocked by middleware');
      },
      {
        controllers: [BlockedController],
        config: {
          globalMiddlewares: [middlewareThatReturnsResponse],
        },
        listen: true,
      }
    );
  });

  it('should handle routes with no middlewares', async () => {
    @Controller('/no-middleware')
    class NoMiddlewareController {
      @Get()
      simple() {
        return { ok: true };
      }
    }

    await withTestApp(
      async (harness) => {
        const response = await harness.get('/no-middleware');
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
      },
      {
        controllers: [NoMiddlewareController],
        listen: true,
      }
    );
  });

  it('should pass locals between middlewares', async () => {
    const setUserMiddleware: MiddlewareHandler = (ctx: Context) => {
      ctx.locals.user = { id: '42', name: 'John' };
    };

    @Controller('/user')
    class UserController {
      @Get()
      getUser(ctx: Context) {
        return { user: ctx.locals.user };
      }
    }

    await withTestApp(
      async (harness) => {
        const response = await harness.get('/user');
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.user).toEqual({ id: '42', name: 'John' });
      },
      {
        controllers: [UserController],
        config: {
          globalMiddlewares: [setUserMiddleware],
        },
        listen: true,
      }
    );
  });
});

describe('Class-based Middleware', () => {
  it('should support class-based middleware as global middleware with next()', async () => {
    @Service()
    class LogMiddleware implements CarnoMiddleware {
      async handle(ctx: Context, next: CarnoClosure): Promise<void> {
        ctx.locals.log = 'before';
        await next();
      }
    }

    @Controller('/class-mw')
    class TestController {
      @Get()
      getTest(ctx: Context) {
        return { log: ctx.locals.log };
      }
    }

    await withTestApp(
      async (harness) => {
        const response = await harness.get('/class-mw');
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.log).toBe('before');
      },
      {
        controllers: [TestController],
        services: [LogMiddleware],
        config: { globalMiddlewares: [LogMiddleware] },
        listen: true,
      }
    );
  });

  it('should execute onion lifecycle (before -> handler -> after)', async () => {
    const executionOrder: string[] = [];

    @Service()
    class OnionMiddleware implements CarnoMiddleware {
      async handle(ctx: Context, next: CarnoClosure): Promise<void> {
        executionOrder.push('before');
        await next();
        executionOrder.push('after');
      }
    }

    @Controller('/onion')
    class OnionController {
      @Get()
      get() {
        executionOrder.push('handler');
        return { ok: true };
      }
    }

    await withTestApp(
      async (harness) => {
        await harness.get('/onion');
        expect(executionOrder).toEqual(['before', 'handler', 'after']);
      },
      {
        controllers: [OnionController],
        services: [OnionMiddleware],
        config: { globalMiddlewares: [OnionMiddleware] },
        listen: true,
      }
    );
  });

  it('should short-circuit when class middleware does not call next()', async () => {
    let handlerReached = false;

    @Service()
    class GuardMiddleware implements CarnoMiddleware {
      async handle(ctx: Context, next: CarnoClosure): Promise<void> {
        // Do NOT call next() - short-circuits
      }
    }

    @Controller('/guarded')
    class GuardedController {
      @Get()
      shouldNotReach() {
        handlerReached = true;
        return { reached: true };
      }
    }

    await withTestApp(
      async (harness) => {
        const response = await harness.get('/guarded');
        expect(response.status).toBe(200);
        expect(handlerReached).toBe(false);
      },
      {
        controllers: [GuardedController],
        services: [GuardMiddleware],
        config: { globalMiddlewares: [GuardMiddleware] },
        listen: true,
      }
    );
  });

  it('should support mixed function and class middlewares in correct order', async () => {
    const order: string[] = [];

    const fnMiddleware: MiddlewareHandler = (ctx: Context) => {
      order.push('fn');
    };

    @Service()
    class ClassMw implements CarnoMiddleware {
      async handle(ctx: Context, next: CarnoClosure): Promise<void> {
        order.push('class-before');
        await next();
        order.push('class-after');
      }
    }

    @Controller('/mixed')
    class MixedController {
      @Get()
      get() {
        order.push('handler');
        return { ok: true };
      }
    }

    await withTestApp(
      async (harness) => {
        await harness.get('/mixed');
        expect(order).toEqual(['fn', 'class-before', 'handler', 'class-after']);
      },
      {
        controllers: [MixedController],
        services: [ClassMw],
        config: { globalMiddlewares: [fnMiddleware, ClassMw] },
        listen: true,
      }
    );
  });

  it('should support wrapping pattern (async context)', async () => {
    let insideContext = false;

    @Service()
    class WrapMiddleware implements CarnoMiddleware {
      async handle(ctx: Context, next: CarnoClosure): Promise<void> {
        insideContext = true;
        await next();
        insideContext = false;
      }
    }

    @Controller('/wrap')
    class WrapController {
      @Get()
      get() {
        return { insideContext };
      }
    }

    await withTestApp(
      async (harness) => {
        const response = await harness.get('/wrap');
        const data = await response.json();
        expect(data.insideContext).toBe(true);
      },
      {
        controllers: [WrapController],
        services: [WrapMiddleware],
        config: { globalMiddlewares: [WrapMiddleware] },
        listen: true,
      }
    );
  });
});
