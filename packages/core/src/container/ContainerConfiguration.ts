import { Env } from 'bun';
import { TokenProvider, TokenProviderOpts } from '../commons';
import { setValue } from '..';
import { CheetahMiddleware, Provider, ProviderScope } from '../domain';

export type TokenRoute = { method: string, path: string, methodName: string, middlewares: CheetahMiddleware[] }
export type TokenRouteWithProvider = TokenRoute & { provider: Provider }
export type TokenRouteWithProviderMap = Map<string, TokenRouteWithProvider[]>

export class ContainerConfiguration {
    readonly default: Map<string, any> = new Map();
    protected map: Map<string, any> = new Map();

    constructor(initialProps = {}) {
        Object.entries({
            scopes: {},
            resolvers: [],
            imports: [],
            logger: {},
            ...initialProps
        }).forEach(([key, value]) => {
            this.default.set(key, value);
        });
    }

    get version() {
        return this.get("version");
    }

    set version(v: string) {
        this.map.set("version", v);
    }

    get rootDir() {
        return this.get("rootDir");
    }

    set rootDir(value: string) {
        this.map.set("rootDir", value);
    }

    get env(): Env {
        return this.map.get("env");
    }

    set env(value: Env) {
        this.map.set("env", value);
    }

    get scopes(): Record<string, ProviderScope> {
        return this.map.get("scopes");
    }

    set scopes(value: Record<string, ProviderScope>) {
        this.map.set("scopes", value);
    }

//    get resolvers(): DIResolver[] {
//        return this.getRaw("resolvers");
//    }
//
//    set resolvers(resolvers: DIResolver[]) {
//        this.map.set("resolvers", resolvers);
//    }

    get imports(): (TokenProvider | TokenProviderOpts)[] {
        return this.get("imports");
    }

    set imports(imports: (TokenProvider | TokenProviderOpts)[]) {
        this.map.set("imports", imports);
    }

    get routes(): TokenRouteWithProviderMap {
        return this.get("routes");
    }

    set routes(routes: TokenRouteWithProviderMap )  {
        this.map.set("routes", routes);
    }

//    get logger(): Partial<DILoggerOptions> {
//        return this.get("logger");
//    }
//
//    set logger(value: Partial<DILoggerOptions>) {
//        const logger = {...this.logger, ...value};
//        this.map.set("logger", logger);
//    }

//    get debug(): boolean {
//        return this.logger.level === "debug";
//    }
//
//    set debug(debug: boolean) {
//        this.logger = {...this.logger, level: debug ? "debug" : "info"};
//    }


    /**
   *
   * @param propertyKey
   * @param value
   */
  set(propertyKey: string | Partial<ContainerConfiguration>, value?: any): this {
        if (typeof propertyKey === "string") {
            if (Reflect.has(this, propertyKey)) {
                // @ts-ignore
                this[propertyKey] = value;
            } else {
                this.setRaw(propertyKey, value);
            }
        } else {
            Object.entries(propertyKey).forEach(([key, value]) => {
                this.set(key, value);
            });
        }

        return this;
    }

    setRaw(propertyKey: string, value: any) {
        setValue(this.map, propertyKey, value);

        return this;
    }

    /**
   *
   * @param propertyKey
   * @param defaultValue
   * @returns {undefined|any}
   */
  get<T = any>(propertyKey: string, defaultValue?: T): T {
        return this.getRaw(propertyKey, defaultValue);
    }

    protected getRaw(propertyKey: string, defaultValue?: any): any {
        const value = this.map.get(propertyKey)
        
        if (value !== undefined) {
            return value;
        }

        // @ts-ignore
        return this.map[propertyKey] ?? defaultValue;
    }
}