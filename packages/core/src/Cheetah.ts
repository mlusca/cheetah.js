import { Server } from 'bun';
import { RouteExecutor } from './route/RouteExecutor.js';
import { ValidatorOptions } from 'class-validator';
import {
  Context,
  createContainer,
  createInjector,
  EventType,
  HttpException,
  LocalsContainer,
  LoggerService,
  registerProvider,
  TokenRouteWithProvider,
} from '@cheetah.js/core';
import process from 'node:process';
import * as pino from 'pino';
import Memoirist from "./route/memoirist";


export interface ApplicationConfig {
  validation?: ValidatorOptions,
  logger?: pino.LoggerOptions,
  exports?: any[],
  providers?: any[],
}

const parseUrl = require('parseurl-fast');

export class Cheetah {
  router: Memoirist<TokenRouteWithProvider> = new Memoirist()
  private injector = createInjector()
  private fetch = (request: Request, server: Server) => this.fetcher(request, server)
  private server: Server

  constructor(public config: ApplicationConfig = {}) {
    this.injector.callHook(EventType.OnApplicationBoot, {})
  }

  /**
   * Use the Cheetah plugin.
   *
   * @param plugin
   */
  use(plugin: Cheetah) {
    if (!this.config.providers) {
      this.config.providers = []
    }

    for (const provider of (plugin.config.exports || [])) {
      this.config.providers.push(provider)
    }

    return this
  }

  /**
   * Set the custom logger provider.
   * The provider must be a class with the @Service() decorator.
   * The provider must extend the LoggerService class.
   *
   * @param provider
   */
  useLogger(provider: any) {
    registerProvider({provide: LoggerService, useClass: provider})
    return this;
  }

  public init() {
    this.injector.loadModule(createContainer(), this.config, this.router)
  }

  async listen(port: number = 3000) {
    process.on('SIGTERM', () => this.injector.callHook(EventType.OnApplicationShutdown))
    this.init()
    this.createHttpServer(port)
  }

  public getHttpServer() {
    return this.server
  }

  getInjector() {
    return this.injector;
  }

  private createHttpServer(port: number) {
    this.server = Bun.serve({port, fetch: this.fetch, error: this.catcher})
    console.log(`Server running on port ${port}`)
  }

  private async fetcher(request: Request, server: Server): Promise<Response> {
    const urlParsed = parseUrl(request)

   const context = await Context.createFromRequest(urlParsed, request, server)
    this.injector.callHook(EventType.OnRequest, {context})
    const local = new LocalsContainer()

    const route = this.router.find(request.method.toLowerCase(), urlParsed.path)

    if (!route) {
      throw new HttpException("Method not allowed", 404)
    }

   context.param = route.params

    local.set(Context, context)
    return RouteExecutor.executeRoute(route.store, this.injector, context, local)
  }

  private catcher = (error: Error) => {
    if (error instanceof HttpException) {
      return new Response(
        JSON.stringify(
          {
            message: error.getResponse(),
            statusCode: error.getStatus(),
          },
        ), {
          status: error.statusCode,
          headers: {'Content-Type': 'application/json'},
        })
    }

    return new Response(error.message, {status: 500})
  }

  close(closeActiveConnections: boolean = false) {
    this.server.stop(closeActiveConnections);
  }
}
