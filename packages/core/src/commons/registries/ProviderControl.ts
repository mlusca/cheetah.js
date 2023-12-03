import { ProviderType } from '../../domain/provider-type';
import { Provider } from '../../domain/provider';
import { ProviderScope } from '../../domain/provider-scope';
import { getClassOrSymbol } from '../../utils';
import { InjectorService } from '../../container/InjectorService';
import { LocalsContainer } from '../../domain/LocalsContainer';

export interface ResolvedInvokeOptions {
    token: TokenProvider;
    parent?: TokenProvider;
    scope: ProviderScope;
    deps: TokenProvider[];
    imports: TokenProvider[];
    provider: Provider;

    construct(deps: TokenProvider[]): any;
}

export type ProviderSettings = {
    injectable?: boolean;
    model?: Type<Provider>;

    /**
     *
     * @param provider
     * @param {Map<string | Function, any>} locals
     * @param options
     */
    onInvoke?(provider: Provider, locals: Map<string | Function, any>, options: ResolvedInvokeOptions & {
        injector: InjectorService
    }): void;

}

export interface Type<T = any> extends Function {
    new(...args: any[]): T;
}

export type TokenProvider<T = any> = string | symbol | Type<T> | Function | any;

export interface TokenProviderOpts {
    token?: TokenProvider;
    use: any;
}

class ProviderControl extends Map<TokenProvider, Provider> {
    settings: Map<string, ProviderSettings> = new Map()

    /**
     * The get() method returns a specified element from a Map object.
     * @param key Required. The key of the element to return from the Map object.
     * @returns Returns the element associated with the specified key or undefined if the key can't be found in the Map object.
     */
    get(key: TokenProvider): Provider | undefined {
        return super.get(getClassOrSymbol(key));
    }

    /**
     * The has() method returns a boolean indicating whether an element with the specified key exists or not.
     * @param key
     * @returns {boolean}
     */
    has(key: TokenProvider): boolean {
        return super.has(getClassOrSymbol(key));
    }

    /**
     * The set() method adds or updates an element with a specified key and value to a Map object.
     * @param key Required. The key of the element to add to the Map object.
     * @param metadata Required. The value of the element to add to the Map object.
     */
    set(key: TokenProvider, metadata: Provider): this {
        super.set(getClassOrSymbol(key), metadata);
        return this;
    }

    /**
     *
     * @param target
     * @param options
     */
    merge(target: TokenProvider, options: Partial<Provider>) {
        let meta = this.createIfNotExists(target, options);

        Object.keys(options).forEach((key) => {
            // @ts-ignore
            meta[key] = (options as any)[key];
        });

        this.set(target, meta);
        return meta;
    }

    getByType(type: ProviderType) {
        let result: Provider[] = [];

        this.forEach((value, key) => {
            if (value.type === type) {
                result.push(value);
                return;
            }
        });

        return result;
    }

    createRegistry(type: string, model: Type<Provider>, options: Partial<ProviderSettings> = {}) {
        const defaultOptions = this.getRegistrySettings(type);

        options = Object.assign(defaultOptions, {
            ...options,
            model
        });

        this.settings.set(type, options);

        return this;
    }

    getRegistrySettings(target: string | TokenProvider): ProviderSettings {
        let type: string = "provider";

        if (typeof target === "string") {
            type = target;
        } else {
            const provider = this.get(target);
            if (provider) {
                type = provider.type;
            }
        }

        return (
            this.settings.get(type) || {
                model: Provider
            }
        );
    }

    createRegisterFn(type: string) {
        return (provider: any | Provider, instance?: any): void => {
            provider = Object.assign({instance}, provider, {type});
            this.merge(provider.provide, provider);
        };
    }

    onInvoke(provider: Provider, locals: LocalsContainer, options: ResolvedInvokeOptions & {
        injector: InjectorService
    }) {
        const settings = this.settings.get(provider.type);

        if (settings?.onInvoke) {
            settings.onInvoke(provider, locals, options);
        }
    }

    /**
     *
     * @param key
     * @param options
     */
    protected createIfNotExists(key: TokenProvider, options: Partial<Provider>) {
        const type = options.type || ProviderType.PROVIDER;

        if (!this.has(key)) {
            const {model = Provider} = this.settings.get(type) || {};
            const item = new model(key, options);

            this.set(key, item);
        }

        return this.get(key)!;
    }
}

export const GlobalProvider = new ProviderControl()