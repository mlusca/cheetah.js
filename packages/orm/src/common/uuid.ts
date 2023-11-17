import { ValueObject } from '@cheetah.js/orm';

export class Uuid extends ValueObject<string, Uuid> {

  protected validate(value: string): boolean {
    return /^[a-f\d]{8}(-[a-f\d]{4}){4}[a-f\d]{8}$/i.test(value);
  }
}