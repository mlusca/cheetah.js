export function getMethodArgTypes(target: any, methodName: string) {
  if (!target[methodName]) {
    throw new Error(`Method ${methodName} not found`);
  }

  return Reflect.getMetadata('design:paramtypes', target, methodName) || [];
}