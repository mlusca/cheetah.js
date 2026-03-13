import { AsyncLocalStorage } from 'async_hooks';

interface TenantContextData {
  tenantId: string | number;
}

class TenantContextManager {
  private storage: AsyncLocalStorage<TenantContextData>;

  constructor() {
    this.storage = new AsyncLocalStorage<TenantContextData>();
  }

  run<T>(tenantId: string | number, callback: () => Promise<T>): Promise<T> {
    return this.storage.run({ tenantId }, callback);
  }

  getTenantId(): string | number | undefined {
    return this.storage.getStore()?.tenantId;
  }

  hasContext(): boolean {
    return this.storage.getStore() !== undefined;
  }
}

export const tenantContext = new TenantContextManager();