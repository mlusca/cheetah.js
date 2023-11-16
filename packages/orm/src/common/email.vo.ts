import { ValueObject } from '@cheetah.js/orm/common/value-object';

export class Email extends ValueObject<string, Email> {

  private REGEX = /^[a-z0-9.]+@[a-z0-9]+\.[a-z]+(\.[a-z]+)?$/i;

  protected validate(value: string): boolean {
    return this.REGEX.test(value);
  }
}