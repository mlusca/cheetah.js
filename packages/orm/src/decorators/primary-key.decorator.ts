import { Property, PropertyOptions } from './property.decorator';

export function PrimaryKey(options?: Omit<PropertyOptions, 'isPrimary'>): PropertyDecorator {
  const isPrimary = true;
  return Property({ ...options, isPrimary, unique: true });
}