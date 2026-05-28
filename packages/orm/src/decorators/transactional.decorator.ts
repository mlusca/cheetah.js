import { Orm } from '../orm';

function decorate(
  targetOrMethod: any,
  contextOrKey: any,
  descriptor?: PropertyDescriptor
): any {
  // Stage 3 method decorator check
  if (
    contextOrKey &&
    typeof contextOrKey === 'object' &&
    contextOrKey.kind === 'method'
  ) {
    const originalMethod = targetOrMethod;
    return function (this: any, ...args: any[]) {
      return Orm.getInstance().transaction(async () => {
        return originalMethod.apply(this, args);
      });
    };
  }

  // Experimental / legacy decorator
  if (descriptor && typeof descriptor.value === 'function') {
    const originalMethod = descriptor.value;
    descriptor.value = function (this: any, ...args: any[]) {
      return Orm.getInstance().transaction(async () => {
        return originalMethod.apply(this, args);
      });
    };
    return descriptor;
  }

  throw new Error('@Transactional can only be applied to methods.');
}

/**
 * Decorator to run a method inside a database transaction.
 * Supports both experimental decorators and TS5 Stage 3 decorators.
 */
export function Transactional(): any;
export function Transactional(
  target: any,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor
): any;
export function Transactional(
  value: Function,
  context: any
): any;
export function Transactional(...args: any[]): any {
  // If called directly as a decorator: @Transactional
  if (args.length > 0) {
    const [first, second, third] = args;
    if (
      // Stage 3: first is function, second is context object with kind === 'method'
      (typeof first === 'function' && second && typeof second === 'object' && second.kind === 'method') ||
      // Experimental: second is string/symbol (propertyKey), third is descriptor object
      ((typeof second === 'string' || typeof second === 'symbol') && third && typeof third === 'object')
    ) {
      return decorate(first, second, third);
    }
  }

  // Otherwise, called as a factory: @Transactional()
  return function (targetOrMethod: any, contextOrKey: any, descriptor?: PropertyDescriptor) {
    return decorate(targetOrMethod, contextOrKey, descriptor);
  };
}
