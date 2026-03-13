import type { ExcludeFunctions, ValueOrInstance } from '../driver/driver.interface';

type SqlValueSerializer = (value: unknown) => string | number | boolean;
type ArithmeticOperand<T> = T extends number | bigint ? T : never;

const UPDATE_EXPRESSION_BRAND = Symbol.for('carno.orm.update-expression');

export interface UpdateExpression<T = unknown> {
  readonly [UPDATE_EXPRESSION_BRAND]: true;
  resolve(columnName: string, serializeValue: SqlValueSerializer): string;
}

class ArithmeticUpdateExpression<T> implements UpdateExpression<T> {
  readonly [UPDATE_EXPRESSION_BRAND] = true as const;

  constructor(
    private readonly operator: '+' | '-' | '*' | '/',
    private readonly operand: unknown,
  ) {}

  resolve(columnName: string, serializeValue: SqlValueSerializer): string {
    return `${columnName} ${this.operator} ${serializeValue(this.operand)}`;
  }
}

export class UpdateColumn<T> {
  plus(value: ArithmeticOperand<T>): UpdateExpression<T> {
    return new ArithmeticUpdateExpression('+', value);
  }

  minus(value: ArithmeticOperand<T>): UpdateExpression<T> {
    return new ArithmeticUpdateExpression('-', value);
  }

  times(value: ArithmeticOperand<T>): UpdateExpression<T> {
    return new ArithmeticUpdateExpression('*', value);
  }

  div(value: ArithmeticOperand<T>): UpdateExpression<T> {
    return new ArithmeticUpdateExpression('/', value);
  }
}

class DeferredUpdateExpression<T> implements UpdateExpression<T> {
  readonly [UPDATE_EXPRESSION_BRAND] = true as const;

  constructor(
    private readonly factory: (prev: UpdateColumn<T>) => UpdateExpression<T>,
  ) {}

  resolve(columnName: string, serializeValue: SqlValueSerializer): string {
    const expression = this.factory(new UpdateColumn<T>());

    if (!isUpdateExpression(expression)) {
      throw new Error('expr() callback must return an ORM update expression');
    }

    return expression.resolve(columnName, serializeValue);
  }
}

export type UpdateFieldValue<T> = ValueOrInstance<T> | UpdateExpression<T>;

export type UpdateData<T> = {
  // @ts-ignore
  -readonly [K in keyof T as ExcludeFunctions<T, K>]?: UpdateFieldValue<T[K]>;
};

export function expr<T>(
  factory: (prev: UpdateColumn<T>) => UpdateExpression<T>,
): UpdateExpression<T> {
  return new DeferredUpdateExpression(factory);
}

export function isUpdateExpression(value: unknown): value is UpdateExpression<unknown> {
  return !!value
    && typeof value === 'object'
    && UPDATE_EXPRESSION_BRAND in value
    && typeof (value as UpdateExpression<unknown>).resolve === 'function';
}
