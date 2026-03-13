export class OptimisticLockError extends Error {
  constructor(entityName: string, id: any) {
    super(`Optimistic lock failed for entity ${entityName} with ID ${id}. Let's assume another process updated it in the meantime.`);
    this.name = 'OptimisticLockError';
  }
}