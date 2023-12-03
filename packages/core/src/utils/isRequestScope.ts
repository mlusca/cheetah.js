import { TokenProvider } from "../commons";
import { InjectorService } from "../container";
import { Provider, ProviderScope } from "../domain";

/**
 * Check if the provider is a request scope or have some dependency that is a request scope

 * @param provider
 * @param deps
 * @param injector
 */
export function isRequestScope(provider: Provider, deps: TokenProvider[], injector: InjectorService): boolean {
  if (provider.scope === 'request') return true;
  if (deps.length === 0) return false;

  return deps.some(dep => {
    const depProvider = injector.get(dep);
    if (!depProvider) return false;
    return depProvider.scope === ProviderScope.REQUEST;
  });
}