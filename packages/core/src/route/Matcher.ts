import { Context, TokenRouteWithProvider, TokenRouteWithProviderMap } from '@cheetah.js/core';

const parseUrl = require('parseurl-fast');

class Matcher {

  match(request: Request, routes: TokenRouteWithProviderMap, context: Context): TokenRouteWithProvider {
    const method = request.method.toLowerCase();

    if (!routes) {
      throw new Error(`Method not allowed for ${request.url}`)
    }

    const routeMethod = routes.get(method);

    const url = parseUrl(request);
    const route = routeMethod?.find(route => this.identifyRoute(route, url, context));

    if (!route) {
      throw new Error('Method not allowed')
    }

    return route;
  }

  /**
   * Identify route by url path.
   * The route can have params (:param) and wildcards (*).
   *
   * @param route
   * @param url
   * @param context
   */
  identifyRoute(route: TokenRouteWithProvider, url: URL, context: Context) {
    const urlPath = url.pathname.split('/');
    const routePathSegments = route.path.split('/');

    if (urlPath.length !== routePathSegments.length) {
      return false;
    }

    return routePathSegments.every((path, index) => {
      if (path === '*') {
        return true;
      }

      if (path.startsWith(':')) {
        context.setParam({
          ...context.param,
          [path.replace(':', '')]: urlPath[index]
        })
        return true;
      }

      return path === urlPath[index];
    });
  }
}

export const RouteResolver = new Matcher();