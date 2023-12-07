import { Metadata } from "../../domain/Metadata";
import { PROVIDER } from "../../constants";
import { Provider } from "../../domain/provider";

/**
 * The decorators `@Injectable()` declare a new service can be injected in other service, controller, interceptor, etc.. on there `constructor`.
 * All classes annotated with `@Injectable()` are built one time, excepted if you change the default provider configuration.
 *
 * ::: tip
 * `@Injectable()` use the `reflect-metadata` to collect and inject the built provided to other services.
 * :::
 *
 * ### Options
 *
 * - type (@@ProviderType@@  or `string`): Kind of provider. (Default: `ProviderType.PROVIDER`)
 * - scope (@@ProviderScope@@): Kind of provider. (Default: `ProviderScope.SINGLETON`)
 * - provide (@@TokenProvider@@): An injection token (Note: This option override default metadata generated by Typescript).
 * - deps (`Type<any>`): List of class or provider which will be injected to the constructor (Note: This options override default metadata generated by Typescript).
 *
 * @returns {Function}
 * @decorator
 */
export function Injectable(options: Partial<Provider> = {}): ClassDecorator {
  return (target: any) => {
    const providers = Metadata.get(PROVIDER, Reflect) || [];
    providers.push({
      ...options,
      ...(options.provide ? { useClass: target } : { provide: target }),
    });
    Metadata.set(PROVIDER, providers, Reflect);
  };
}
