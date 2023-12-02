export function getDefaultLength(type: string): number {
  return null;
}

export function toSnakeCase(propertyKey1: string) {
  propertyKey1 = propertyKey1[0].toLowerCase() + propertyKey1.slice(1);

  return propertyKey1.replace(/([A-Z])/g, '_$1').toLowerCase();
}

export function extendsFrom(baseClass, instance) {
  if (!instance) return false;
  let proto = Object.getPrototypeOf(instance);
  while (proto) {
    if (proto === baseClass.prototype) {
      return true;
    }
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}
