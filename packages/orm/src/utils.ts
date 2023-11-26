export function getDefaultLength(type: string): number {
  return null;
}

export function toSnakeCase(propertyKey1: string) {
  propertyKey1 = propertyKey1[0].toLowerCase() + propertyKey1.slice(1);

  return propertyKey1.replace(/([A-Z])/g, '_$1').toLowerCase();
}
