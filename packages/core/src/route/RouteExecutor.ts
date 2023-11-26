import {
  Context,
  EventType,
  InjectorService,
  LocalsContainer,
  TokenRouteWithProvider,
} from '@cheetah.js/core';

class Router {
  public async executeRoute(route: TokenRouteWithProvider, injector: InjectorService, context: Context, locals: LocalsContainer): Promise<Response> {
    const provider = injector.invoke(route.provider, locals);

    route.provider.instance = provider;

    // @ts-ignore
    if (!provider[route.methodName]) {
      throw new Error('Controller not found');
    }


    const result = await injector.invokeRoute(route, context, locals);

    injector.callHook(EventType.OnResponse, { context, result })

    return this.mountResponse(result, context);
  }

  private mountResponse(result: any, context: Context) {
    let payload: string | any;
    let contentType: string;

    if (result instanceof Response) {
      return result;
    }

    switch (typeof result) {
      case 'string':
        payload = result;
        contentType = 'text/html';
        break;
      case 'object':
        payload = JSON.stringify(result);
        contentType = 'application/json';
        break;
      default:
        payload = result;
        contentType = 'text/plain';
    }

    return new Response(payload, {status: context.getResponseStatus() || 201, headers: {'Content-Type': contentType}});
  }
}

export const RouteExecutor = new Router();