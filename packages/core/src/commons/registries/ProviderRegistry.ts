import { Provider } from '../../domain/provider';
import { ProviderType } from '../../domain/provider-type'
import { GlobalProvider } from './ProviderControl';

GlobalProvider.createRegistry(ProviderType.CONTROLLER, Provider)
GlobalProvider.createRegistry(ProviderType.ROUTES, Provider)

export const registerController = GlobalProvider.createRegisterFn(ProviderType.CONTROLLER);

/**
 * Register a provider configuration.
 * @param {Provider<any>} provider
 */
export function registerProvider(provider: Partial<Provider>) {
    
    if (!provider.provide) {
        throw new Error("Provider.provide is required");
    }

    return GlobalProvider.merge(provider.provide, provider);
}