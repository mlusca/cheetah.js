import { ClassType, EnumOptions } from '../driver/driver.interface';
import { Property } from '@cheetah.js/orm/decorators/property.decorator';

export function Enum(options: EnumOptions<any> | (() => ClassType)): PropertyDecorator {
  const isEnum = true;
  //@ts-ignore
  let enumItems: string[]|number[] = typeof options === 'function' ? options() : (typeof options.items === 'function' ? options.items() : options.items);
  if (typeof enumItems === 'object') {
    enumItems = Object.keys(enumItems).map(key => enumItems[key]);
  }
  return Property({ ...options, isEnum, enumItems, dbType: 'enum' });
}