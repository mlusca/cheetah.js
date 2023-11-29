import {ProviderType} from './provider-type';
import {ProviderScope} from './provider-scope';
import {classOf, isClass, methodsOf, TokenProvider, Type} from '@cheetah.js/core';

export type ProviderHookCallback<T = any> = (instance: T, ...args: any[]) => Promise<void> | void;

export class Provider {

  /**
   * Token group provider to retrieve all provider from the same type
   */
  public type: TokenProvider | ProviderType = ProviderType.PROVIDER;
  public deps: TokenProvider[] = [];
  public instance: any
  private _provide: TokenProvider
  // @ts-ignore
  private _useClass: Type
  private _useValue?: any;
  public hooks?: Record<string, ProviderHookCallback>;
  public path?: string;

  /**
   * Scope used by the injector to build the provider.
   */
  scope?: ProviderScope = ProviderScope.SINGLETON;
  children?: any[] = [];
  parent?: Function;

  constructor(token: TokenProvider, options: Partial<Provider> = {}) {
    this.provide = token;
    this.useClass = token;

    Object.assign(this, options);
  }

  get token() {
    return this._provide;
  }

  get useClass(): Type {
    return this._useClass;
  }

  /**
   * Create a new store if the given value is a class. Otherwise the value is ignored.
   * @param value
   */
  set useClass(value: Type) {
    if (isClass(value)) {
      this._useClass = classOf(value);

      this.hooks = methodsOf(this._useClass).reduce((hooks, {propertyKey}) => {
        if (String(propertyKey).startsWith('$')) {
          return {
            ...hooks,
            [propertyKey]: (instance: any, ...args: any[]) => instance[propertyKey](...args),
          };
        }
        return hooks;
      }, {} as any);
    }
  }

  get useValue() {
    return this._useValue;
  }

  set useValue(value: () => any) {
    this._useValue = value();
  }

  get provide() {
    return this._provide
  }

  set provide(value: TokenProvider) {
    if (!value) {
      return
    }

    this._provide = value;
  }

  clone(): Provider {
    return new (classOf(this))(this._provide, this);
  }

  isChild(): boolean {
    return !!this.parent
  }
}