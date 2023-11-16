import { InjectorService } from './InjectorService';
import { CheetahMiddleware, Context, LocalsContainer } from '@cheetah.js/core'; // not change
import { TokenRouteWithProvider } from './ContainerConfiguration';

class MiddlewareResolver {
  public async resolveMiddlewares(route: TokenRouteWithProvider, injector: InjectorService, local: LocalsContainer) {
    if (route.middlewares.length == 0) {
      return;
    }

    await this.resolve(route.middlewares, injector, local)
  }

  private async resolve(middlewares: CheetahMiddleware[], injector: InjectorService, local: LocalsContainer) {
    const context = local.get(Context)
    let currentIndex = 0

    const next = async () => {
      const middleware = middlewares[currentIndex++]
      if (!middleware) return

      // @ts-ignore
      const instance = injector.invoke(middleware, local) as CheetahMiddleware
      instance.handle(context, next)
    }

    if (middlewares.length === 0) return;

    await next()
    if (currentIndex <= middlewares.length) throw new Error('Middleware stack exhausted')
  }
}

export const MiddlewareRes = new MiddlewareResolver();