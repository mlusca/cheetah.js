import {
  ApplicationConfig,
  Context,
  CONTROLLER_EVENTS,
  CONTROLLER_MIDDLEWARES,
  CONTROLLER_ROUTES, DefaultRoutesCheetah,
  EventType,
  getClassOrSymbol,
  getMethodArgTypes,
  GlobalProvider,
  HttpException,
  HttpMethod,
  Injectable,
  isClassValidator, isPrimitiveType,
  isRequestScope,
  LocalsContainer, LoggerService,
  Metadata,
  MiddlewareRes,
  nameOf,
  OnEvent,
  Provider,
  ProviderScope,
  ProviderType,
  ROUTE_MIDDLEWARES,
  TokenProvider,
  Type,
} from '@cheetah.js/core';
import {ContainerConfiguration, TokenRouteWithProvider} from './ContainerConfiguration.js';
import {Container} from './container';
import {plainToInstance} from 'class-transformer';
import {validateSync} from 'class-validator';
import Memoirist from '../route/memoirist';

@Injectable()
export class InjectorService {

  settings = new ContainerConfiguration()
  container: Container = new Container()
  applicationConfig: ApplicationConfig = {}
  router = new Memoirist()
  private historyMethods: WeakMap<any, { [key: string]: { args: any, params: any } }> = new Map()

  loadModule(container: Container, applicationConfig: ApplicationConfig, router: Memoirist<any>) {
    this.container = container
    this.router = router;
    this.applicationConfig = applicationConfig
    this.removeUnknownProviders()
    this.callHook(EventType.OnApplicationInit)
    this.saveInjector()
    this.resolveControllers()
  }

  private resolveControllers() {
    if (!this.settings) return {};
    const controllers = GlobalProvider.getByType(ProviderType.CONTROLLER)
      .filter(controller => !controller.isChild())

    let hydrateRoute: Map<string, TokenRouteWithProvider[]> = new Map()
    for (const controller of controllers) {
      let routes = Metadata.get(CONTROLLER_ROUTES, controller.token)

      const controllerMiddleware = Metadata.get(CONTROLLER_MIDDLEWARES, controller.token) || []
      if (routes.length === 0) continue;

      if (controller.path) {
        routes = routes.map((route: any) => {
          route.path = `${controller.path}${route.path}`
          if (route.path.endsWith('/')) {
            route.path = route.path.slice(0, -1)
          }

          if (!route.path.startsWith('/')) {
            route.path = `/${route.path}`
          }
          return route
        })
      }

      // @ts-ignore
      for (const method of Object.keys(HttpMethod).map(key => HttpMethod[key])) {
        if (!routes.some((route: any) => route.method.toLowerCase() === method)) continue;

        hydrateRoute.set(method, [
          ...hydrateRoute.get(method) || [],
          ...routes
            .filter((route: any) => route.method.toLowerCase() === method)
            .map((route: any) => ({
              ...route,
              provider: controller.token,
              route,
              middlewares: [...controllerMiddleware, ...(Metadata.get(ROUTE_MIDDLEWARES, controller.token, route.methodName) || [])]
            })),
        ])
      }

      if (controller.children) {
        const childrenRoutes = this.resolveChildrenRoutes(controller.path ?? '', controller.children, controllerMiddleware)
        childrenRoutes.forEach(route => {
          hydrateRoute.set(route.method.toLowerCase(), [
            ...hydrateRoute.get(route.method.toLowerCase()) || [],
            route
          ])
        })
      }
    }
    hydrateRoute.forEach(method => {
      method.forEach(route => this.router.add(route.method.toLowerCase(), route.path, route))
    })
  }

  private resolveChildrenRoutes(parentPath: string, children: Provider[], parentMiddlewares: any[]): TokenRouteWithProvider[] {
    let childrenRoutes: any[] = [];

    for (const childController of children) {

      let controller = GlobalProvider.get(childController)
      if(!controller) throw new Error(`Child ${childController} not is an controller. Please, check the providers configuration.`)
      let childRoutes = Metadata.get(CONTROLLER_ROUTES, controller.token);
      const childMiddlewares = Metadata.get(CONTROLLER_MIDDLEWARES, controller.token) || [];

      if (childRoutes.length === 0) continue;

      if (parentPath) {
        childRoutes = childRoutes.map((route: any) => {
          let controllerPath = controller?.path ?? '';

          if(controllerPath.endsWith('/')) {
            controllerPath = controller!.path!.slice(0, -1);
          }
          if (!controllerPath.startsWith('/')) {
            controllerPath = `/${controller!.path}`;
          }

          route.path = `${parentPath}${controllerPath ?? ''}${route.path}`;
          if (route.path.endsWith('/')) {
            route.path = route.path.slice(0, -1);
          }
          if (!route.path.startsWith('/')) {
            route.path = `/${route.path}`;
          }
          return route;
        });
      }
      // @ts-ignore
      for (const method of Object.keys(HttpMethod).map(key => HttpMethod[key])) {
        if (!childRoutes.some((route: any) => route.method.toLowerCase() === method)) continue;

        childrenRoutes = [
          ...childrenRoutes,
          ...childRoutes
            .filter((route: any) => route.method.toLowerCase() === method)
            .map((route: any) => ({
              ...route,
              provider: controller!.token,
              route,
              middlewares: [...parentMiddlewares, ...childMiddlewares, ...(Metadata.get(ROUTE_MIDDLEWARES, controller!.token, route.methodName) || [])]
            }))
        ];
      }

      if (controller.children) {
        childrenRoutes = [...childrenRoutes, ...this.resolveChildrenRoutes(controller.path!, controller.children, childMiddlewares)];
      }
    }

    return childrenRoutes;
  }

  private ensureProvider(token: TokenProvider): Provider | undefined {
    if (!this.container.has(token) && GlobalProvider.has(token)) {
      this.container.addProvider(token)
    }

    return this.container.get(token)
  }

  public get(token: TokenProvider): Provider | undefined {
    return this.ensureProvider(token)
  }


  /**
   * Invoke the class and inject all services that required by the class constructor.
   *
   * #### Example
   *
   *
   * @param token The injectable class to invoke. Class parameters are injected according constructor signature.
   * @param locals  Optional object. If preset then any argument Class are read from this object first, before the `InjectorService` is consulted.
   * @param options
   * @returns The class constructed.
   */
  public invoke(token: TokenProvider, locals?: LocalsContainer, options: any = {}): Type {
    if (locals && locals.has(token)) {
      return locals.get(token)
    }

    if (isPrimitiveType(token)) return token;

    const provider = this.ensureProvider(token)
    if (!provider) throw new Error(`Provider not found for: ${nameOf(token)}`)

    return this.resolve(provider, locals)
  }

  protected resolve(
    provider: Provider,
    locals: LocalsContainer = new LocalsContainer(),
  ) {
    if (provider.instance) return provider.instance
    let scope = this.scopeOf(provider)

    if (!provider.useClass) throw new Error('Provider not found.');
    const deps = this.getConstructorDependencies(provider.useClass)

    const construct = (deps: TokenProvider[]) => new provider.useClass(...deps);

    let instance: any;

    // Se algum dos deps for REQUEST, o escopo do provider será REQUEST também
    // @ts-ignore
    if (isRequestScope(provider, deps, this)) {
      scope = ProviderScope.REQUEST
    }
    const services = deps.filter(t => !isPrimitiveType(t)).map((token) => this.invoke(getClassOrSymbol(token), locals))
    instance = construct(services)

    switch (scope) {
      case ProviderScope.SINGLETON:
        provider.instance = instance
        this.container.addProvider(provider.token, provider)
        break;
      case ProviderScope.REQUEST:
        const clone = provider.clone()
        clone.instance = instance
        locals.set(clone.token, clone)
        break;
    }

    return instance;
  }

  async invokeRoute(route: TokenRouteWithProvider, context: Context, locals: LocalsContainer) {
    // @ts-ignore
    await MiddlewareRes.resolveMiddlewares(route, this, locals)

    return this.invokeMethod(route.provider.instance, route.methodName, locals, context)
  }

  async invokeMethod(instance: any, methodName: string, locals: LocalsContainer, context: Context) {
    const cachedMethod = this.historyMethods.get(instance);
    let methodInfo;

    if (cachedMethod) {
      methodInfo = cachedMethod[methodName];
    } else {
      methodInfo = this.cacheMethodInfo(instance, methodName);
    }

    const {args, params} = methodInfo;
    const services = [];

    for (let index = 0; index < args.length; index++) {
      const token = args[index];

      if (params[index]) {
        const param = params[index];

        if (isClassValidator(token)) {
          const obj = plainToInstance(token, param.fun(context, param.param));
          const errors = validateSync(obj, this.applicationConfig.validation);
          if (errors.length > 0) {
            throw new HttpException(errors, 400);
          }

          services.push(obj);
        } else {
          services.push(param.fun(context, param.param));
        }
      } else {
        services.push(this.invoke(getClassOrSymbol(token), locals));
      }
    }

    return instance[methodName](...services);
  }

  private cacheMethodInfo(instance: any, methodName: string) {
    const args = getMethodArgTypes(instance, methodName);
    const params = Metadata.getParamDecoratorFunc(instance, methodName);
    const methodInfo = {args, params};
    const cachedMethod: { [key: string]: { args: any, params: any } } = this.historyMethods.get(instance) || {};

    cachedMethod[methodName] = methodInfo;
    this.historyMethods.set(instance, cachedMethod);

    return methodInfo;
  }

  scopeOf(provider: Provider): ProviderScope | undefined {
    return provider.scope || ProviderScope.SINGLETON;
  }

  getConstructorDependencies(target: TokenProvider, propertyKey?: string | symbol | undefined): TokenProvider[] {
    return Metadata.getOwn("override:ctor:design:paramtypes", target, propertyKey) || [...Metadata.getParamTypes(target, propertyKey)] || [];
  }

  public callHook(event: EventType, data: any = null) {
    const hooks: OnEvent[] | undefined = Metadata.get(CONTROLLER_EVENTS, Reflect)
    if (!hooks) return;

    hooks
      .filter((hook: OnEvent) => hook.eventName === event)
      .forEach(async (hook: OnEvent) => {
        const instance = this.invoke(hook.target)
        // @ts-ignore
        await instance[hook.methodName](data ?? {})
      })
  }

  private saveInjector() {
    const provider = this.ensureProvider(InjectorService)
    provider!.instance = this
    this.container.set(InjectorService, provider!)
  }

  private removeUnknownProviders() {
    const defaults = [
      Context,
      InjectorService,
      DefaultRoutesCheetah,
      LoggerService
    ]
    this.applicationConfig.providers = this.applicationConfig.providers || []
    this.applicationConfig.providers.push(...defaults)
    let hooks = Metadata.get(CONTROLLER_EVENTS, Reflect)

    for (let [token] of GlobalProvider.entries()) {
      if (!this.applicationConfig.providers || !this.applicationConfig.providers.includes(token)) {
        GlobalProvider.delete(token)

        if (hooks) {
          hooks = hooks.filter((hook: any) => hook.target !== token)
          Metadata.set(CONTROLLER_EVENTS, hooks, Reflect)
        }
      }
    }
  }
}