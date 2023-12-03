import { Property } from './property.decorator';
import { ClassType, EnumOptions } from '../driver/driver.interface';

export function Enum(options: EnumOptions<any> | (() => ClassType)): PropertyDecorator {
  const isEnum = true;
  //@ts-ignore
  let enumItems: string[]|number[] = typeof options === 'function' ? options() : (typeof options.items === 'function' ? options.items() : options.items);
  if (typeof enumItems === 'object') {
    enumItems = Object.keys(enumItems).map(key => enumItems[key]);
  }
  return Property({ ...options, isEnum, enumItems, dbType: 'enum' });
}