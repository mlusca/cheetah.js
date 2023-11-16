import { HttpException } from '@cheetah.js/core';

type VoExtended<T, Vo> = Vo extends ValueObject<T, Vo>
  ? Vo
  : ValueObject<T, Vo>;

export abstract class ValueObject<T, Vo> {
  /**
   * Valor do Value Object.
   * É privado para não ser alterado diretamente.
   * O valor também é imutável.
   *
   * @private
   */
  private value: T;

  constructor(value: T) {
    if (!this.validate(value)) {
      //@ts-ignore
      throw new HttpException(`Invalid value for ${this.name}`, 400);
    }

    this.setValue(value);
  }

  /**
   * Creates a Value Object instance from a value.
   *
   * @example
   * Email.from('test@test.com');
   *
   * @param value
   */
  static from<T, Vo>(
    this: new (value: T) => VoExtended<T, Vo>,
    value: T,
  ): VoExtended<T, Vo> {
    return new this(value);
  }

  /**
   * Returns the scalar value of the Value Object.
   *
   */
  public getValue(): T {
    return this.value;
  }

  /**
   * Compares the value of the Value Object with another Value Object.
   *
   * @param vo
   */
  public equals(vo: ValueObject<T, Vo>): boolean {
    return this.getValue() === vo.getValue();
  }

  /**
   * Validates the value of the Value Object.
   * It is abstract so that each Value Object can implement its own validation.
   * It is protected from being called directly.
   *
   * @param value
   * @protected
   */
  protected abstract validate(value: T): boolean;

  /**
   * Sets the value of the Value Object.
   *
   * @param value
   * @private
   */
  private setValue(value: T) {
    this.value = value;
  }
}