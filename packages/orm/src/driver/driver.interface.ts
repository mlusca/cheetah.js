import { PropertyOptions } from "../decorators/property.decorator";
import { Collection } from "../domain/collection";
import { Reference } from "../domain/reference";
import { ValueObject } from "../common/value-object";

export interface DriverInterface {
  connectionString: string;
  readonly dbType: "postgres" | "mysql";

  getIdentifierQuote(): string;

  /**
   * Format a single JS value as a SQL literal (numbers/booleans pass through,
   * strings are escape-quoted, dates are ISO/MySQL-formatted, null becomes
   * `NULL`). Used by bulk-update raw SQL builders that bypass the prepared
   * statement path.
   */
  formatLiteral(value: unknown, columnMetadata?: ColumnMetadata): string | number | boolean;

  executeStatement(
    statement: Statement<any>
  ): Promise<{ query: any; startTime: number; sql: string; affectedRows?: number }>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeSql(s: string): Promise<any>;
  snapshot(tableName: string, options: any): Promise<SnapshotTable | undefined>;

  getCreateTableInstruction(
    schema: string | undefined,
    tableName: string,
    creates: ColDiff[]
  ): string;
  getAlterTableFkInstruction(
    schema: string | undefined,
    tableName: string,
    colDiff: ColDiff,
    fk: ForeignKeyInfo
  ): string;
  getCreateIndex(
    index: IndexStatement,
    schema: string | undefined,
    tableName: string
  ): string;
  getAddColumn(
    schema: string | undefined,
    tableName: string,
    colName: string,
    colDiff: ColDiff,
    colDiffInstructions: string[]
  ): void;
  getDropColumn(
    colDiffInstructions: string[],
    schema: string | undefined,
    tableName: string,
    colName: string
  ): void;

  getDropIndex(
    index: IndexStatement,
    schema: string | undefined,
    tableName: string
  ): string;

  getCreateUniqueConstraint(
    unique: UniqueStatement,
    schema: string | undefined,
    tableName: string
  ): string;

  getDropUniqueConstraint(
    unique: UniqueStatement,
    schema: string | undefined,
    tableName: string
  ): string;

  getAlterTableType(
    schema: string | undefined,
    tableName: string,
    colName: string,
    colDiff: ColDiff
  ): string;

  getAlterTableDefaultInstruction(
    schema: string | undefined,
    tableName: string,
    colName: string,
    colDiff: ColDiff
  ): string;

  getAlterTablePrimaryKeyInstruction(
    schema: string | undefined,
    tableName: string,
    colName: string,
    colDiff: ColDiff
  ): string;

  getDropConstraint(
    param: { name: string },
    schema: string | undefined,
    tableName: string
  ): string;

  getAddUniqueConstraint(
    schema: string | undefined,
    tableName: string,
    colName: string
  ): string;

  getAlterTableDropNullInstruction(
    schema: string | undefined,
    tableName: string,
    colName: string,
    colDiff: ColDiff
  ): string;

  getAlterTableDropNotNullInstruction(
    schema: string | undefined,
    tableName: string,
    colName: string,
    colDiff: ColDiff
  ): string;
  getAlterTableEnumInstruction(
    schema: string,
    tableName: string,
    colName: string,
    colDiff: ColDiff
  ): string;
  getDropTypeEnumInstruction(
    param: { name: string },
    schema: string | undefined,
    tableName: string
  ): string;

  transaction<T>(callback: (tx: any) => Promise<T>): Promise<T>;
}

export type ValueOrInstance<T> = T extends ValueObject<any, any>
  ? // @ts-ignore
  T | T["value"]
  : NonNullable<T>;

export type SnapshotConstraintInfo = {
  indexName: string;
  consDef: string;
  type: string;
};

export interface CacheSettings {
  maxKeysPerTable?: number;
  invalidateCacheOnWrite?: boolean;
}

export interface ConnectionSettings<
  T extends DriverInterface = DriverInterface
> {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  connectionString?: string;
  max?: number;
  idleTimeout?: number;
  maxLifetime?: number;
  connectionTimeout?: number;
  ssl?: boolean;
  replicas?: Array<Partial<ConnectionSettings<T>>>;
  driver: new (options: ConnectionSettings<T>) => T;
  entities?: Function[] | string;
  migrationPath?: string;
  cache?: CacheSettings;
}

export type ConditionOperators<T, C> = {
  $ne?: T;
  $in?: T[];
  $nin?: T[];
  $like?: string;
  $notLike?: string;
  $ilike?: string;
  $notIlike?: string;
  $gt?: T;
  $gte?: T;
  $lt?: T;
  $lte?: T;

  $and?: Condition<C>[];
  $or?: Condition<C>[];
  // adicione aqui os demais operadores que precisar
};

export type Condition<T> = {
  [P in keyof T]?: T[P] | ConditionOperators<T[P], T>;
};

export type InstanceOf<T> = {
  [key in keyof T]: T[key];
};

export type ClassType<T = any> = {
  [k: string]: T;
};

export interface EnumOptions<T> extends PropertyOptions {
  items?: (number | string)[] | (() => ClassType);
  array?: boolean;
}

export type JoinStatement<T> = {
  type: "INNER" | "LEFT" | "RIGHT";
  originalEntity?: Function;
  originTable: string;
  originSchema: string;
  originAlias: string;
  joinTable: string;
  joinSchema: string;
  joinAlias: string;
  joinEntity?: Function;
  joinWhere?: string;
  joinProperty: string;
  on: string;
  propertyKey: string | symbol;
  hooks?: { type: string; propertyName: string }[];
};

export type ColumnMetadata = {
  dbType?: PropertyOptions["dbType"];
  array?: boolean;
  type?: Function;
};

export type Statement<T> = {
  statement?: "select" | "insert" | "update" | "delete" | "count";
  table?: string;
  alias?: string;
  customSchema?: string;
  columns?: string[];
  join?: JoinStatement<T>[];
  selectJoin?: Statement<T>[];
  strategy?: "select" | "joined";
  where?: string;
  values?: any;
  columnMetadata?: Record<string, ColumnMetadata>;
  groupBy?: string[];
  orderBy?: string[];
  limit?: number;
  offset?: number;
  hooks?: { type: string; propertyName: string }[];
  instance?: InstanceOf<T>;
  cache?: boolean | number | Date;

  /**
   * Multi-row INSERT support. When `bulk` is true, `values` is `Record<string, any>[]`
   * (one row per object) and `instances` holds the corresponding entity instances.
   */
  bulk?: boolean;
  instances?: InstanceOf<T>[];

  joinProperty?: string;
  fkKey?: string;
  primaryKey?: string;
  primaryKeyColumnName?: string;
  originAlias?: string;
  originProperty?: string;
  joinEntity?: Function;
  originEntity?: Function;
};

interface SnapshotColumnInfo {
  table_catalog: string;
  table_schema: string;
  table_name: string;
  column_name: string;
  ordinal_position: number;
  column_default: string | null;
  is_nullable: string;
  data_type: string;
  character_maximum_length: number | null;
  character_octet_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  datetime_precision: number | null;
  character_set_name: string | null;
  collation_name: string | null;
  column_type: string;
  column_key: string;
  extra: string;
  privileges: string;
  column_comment: string;
}

export type SnapshotTable = {
  tableName: string;
  schema?: string;
  columns: ColumnsInfo[];
  indexes: SnapshotIndexInfo[];
  uniques?: SnapshotUniqueInfo[];
  foreignKeys?: ForeignKeyInfo[];
};

export type SnapshotIndexInfo = {
  table: string;
  indexName: string;
  columnName: string;
  where?: string;
};

export type SnapshotUniqueInfo = {
  table: string;
  uniqueName: string;
  columnName: string;
};

export type IndexStatement = {
  name: string;
  properties?: string[];
  where?: string;
};

export type UniqueStatement = {
  name: string;
  properties?: string[];
};

export type ForeignKeyInfo = {
  referencedTableName: string;
  referencedColumnName: string;
};

export type ColumnsInfo = {
  name: string;
  type: string;
  nullable?: boolean;
  default?: string | null;
  primary?: boolean;
  unique?: boolean;
  autoIncrement?: boolean;
  length?: number;
  isEnum?: boolean;
  precision?: number;
  scale?: number;
  isDecimal?: boolean;
  enumItems?: string[] | number[] | "__AUTO_DETECT__";
  foreignKeys?: ForeignKeyInfo[];
};

export type SqlActionType = "CREATE" | "DELETE" | "ALTER" | "INDEX";

export type ColDiff = {
  actionType: SqlActionType;
  colName: string;
  colType?: string;
  colLength?: number;
  indexTables?: { name: string; properties?: string[] }[];
  colChanges?: {
    default?: string | null;
    primary?: boolean;
    unique?: boolean;
    nullable?: boolean;
    autoIncrement?: boolean;
    enumItems?: string[] | number[];
    enumModified?: boolean;
    precision?: number;
    scale?: number;
    foreignKeys?: ForeignKeyInfo[];
  };
};

export type TableDiff = {
  tableName: string;
  schema?: string;
  newTable?: boolean;
  colDiffs: ColDiff[];
};

export declare const PrimaryKeyType: unique symbol;
export declare const PrimaryKeyProp: unique symbol;
type ReadonlyPrimary<T> = T extends any[] ? Readonly<T> : T;
export type Primary<T> = T extends {
  [PrimaryKeyType]?: infer PK;
}
  ? ReadonlyPrimary<PK>
  : T extends {
    _id?: infer PK;
  }
  ? ReadonlyPrimary<PK> | string
  : T extends {
    uuid?: infer PK;
  }
  ? ReadonlyPrimary<PK>
  : T extends {
    id?: infer PK;
  }
  ? ReadonlyPrimary<PK>
  : never;
export type PrimaryProperty<T> = T extends {
  [PrimaryKeyProp]?: infer PK;
}
  ? PK
  : T extends {
    _id?: any;
  }
  ? "_id" | string
  : T extends {
    uuid?: any;
  }
  ? "uuid"
  : T extends {
    id?: any;
  }
  ? "id"
  : never;
export type IPrimaryKeyValue =
  | number
  | string
  | bigint
  | Date
  | {
    toHexString(): string;
  };
export type IPrimaryKey<T extends IPrimaryKeyValue = IPrimaryKeyValue> = T;
export type OperatorMap<T> = {
  $and?: Query<T>[];
  $or?: Query<T>[];
  $eq?: ExpandScalar<T> | ExpandScalar<T>[];
  $ne?: ExpandScalar<T>;
  $in?: ExpandScalar<T>[];
  $nin?: ExpandScalar<T>[];
  $not?: Query<T>;
  $gt?: ExpandScalar<T>;
  $gte?: ExpandScalar<T>;
  $lt?: ExpandScalar<T>;
  $lte?: ExpandScalar<T>;
  $like?: string;
  $notLike?: string;
  $ilike?: string;
  $notIlike?: string;
  $exists?: FilterQuery<ExpandProperty<T>>;
  $nexists?: FilterQuery<ExpandProperty<T>>;
};
export type ExcludeFunctions<T, K extends keyof T> = T[K] extends Function
  ? never
  : K extends symbol
  ? never
  : K;
export type Scalar =
  | boolean
  | number
  | string
  | bigint
  | symbol
  | Date
  | RegExp
  | Uint8Array
  | {
    toHexString(): string;
  };
// TODO: revise
export type ExpandProperty<T> = T extends Reference<infer U>
  ? NonNullable<U>
  : T extends Collection<infer U, any>
  ? NonNullable<U>
  : T extends (infer U)[]
  ? NonNullable<U>
  : NonNullable<T>;
export type ExpandScalar<T> =
  | null
  | (T extends string ? T | RegExp : T extends Date ? Date | string : T);
type ExpandObject<T> = T extends object
  ? T extends Scalar
  ? never
  : {
    // @ts-ignore
    -readonly [K in keyof T as ExcludeFunctions<T, K>]?:
    | Query<ExpandProperty<T[K]>>
    | FilterValue<ExpandProperty<T[K]>>
    | null;
  }
  : never;
export type EntityProps<T> = {
  // @ts-ignore
  -readonly [K in keyof T as ExcludeFunctions<T, K>]?: T[K];
};
export type Query<T> = T extends object
  ? T extends Scalar
  ? never
  : FilterQuery<T>
  : FilterValue<T>;
export type FilterValue2<T> = T | ExpandScalar<T> | Primary<T>;
export type FilterValue<T> =
  | OperatorMap<FilterValue2<T>>
  | FilterValue2<T>
  | FilterValue2<T>[]
  | null;
export type EntityClass<T> = Function & { prototype: T };
export type EntityName<T> = string | EntityClass<T> | { name: string };
export type ObjectQuery<T> = ExpandObject<T> & OperatorMap<T>;
export type FilterQuery<T> =
  | ObjectQuery<T>
  | NonNullable<ExpandScalar<Primary<T>>>
  | NonNullable<EntityProps<T> & OperatorMap<T>>
  | FilterQuery<T>[];

export type Relationship<T> = {
  isRelation?: boolean;
  relation: "one-to-many" | "many-to-one" | "one-to-one-owner" | "one-to-one-inverse" | "many-to-many";
  type: Function;
  fkKey?: (string & keyof T) | ((e: T) => any);
  entity: () => EntityName<T>;
  originalEntity?: EntityName<T>;
  propertyKey: string | symbol;
  columnName: string;
  pivotTable?: string;
  joinColumn?: string;
  inverseJoinColumn?: string;
} & Partial<PropertyOptions>;

export type Cast<T, R> = T extends R ? T : R;
export type IsUnknown<T> = T extends unknown
  ? unknown extends T
  ? true
  : never
  : never;
type Loadable<T extends object> =
  | Collection<T, any>
  | Reference<T>
  | readonly T[];
type ExtractType<T> = T extends Loadable<infer U> ? U : T;
type StringKeys<T, E extends string = never> = T extends Collection<any, any>
  ? `${Exclude<keyof ExtractType<T> | E, symbol>}`
  : T extends Reference<any>
  ? `${Exclude<keyof ExtractType<T> | E, symbol>}`
  : T extends object
  ? `${Exclude<keyof ExtractType<T> | E, symbol>}`
  : never;
type Defined<T> = Exclude<T, null | undefined>;
type GetStringKey<
  T,
  K extends StringKeys<T, string>,
  E extends string
> = K extends keyof T ? ExtractType<T[K]> : K extends E ? keyof T : never;
type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
export type AutoPath<
  O,
  P extends string,
  E extends string = never,
  D extends Prev[number] = 5
> = [D] extends [never]
  ? string
  : P extends any
  ? (P & `${string}.` extends never ? P : P & `${string}.`) extends infer Q
  ? Q extends `${infer A}.${infer B}`
  ? A extends StringKeys<O, E>
  ? `${A}.${AutoPath<Defined<GetStringKey<O, A, E>>, B, E, Prev[D]>}`
  : never
  : Q extends StringKeys<O, E>
  ?
  | (Defined<GetStringKey<O, Q, E>> extends unknown
    ? Exclude<P, `${string}.`>
    : never)
  | (StringKeys<Defined<GetStringKey<O, Q, E>>, E> extends never
    ? never
    : `${Q}.`)
  : keyof ExtractType<O>
  : never
  : never;

export declare enum QueryOrder {
  ASC = "ASC",
  ASC_NULLS_LAST = "ASC NULLS LAST",
  ASC_NULLS_FIRST = "ASC NULLS FIRST",
  DESC = "DESC",
  DESC_NULLS_LAST = "DESC NULLS LAST",
  DESC_NULLS_FIRST = "DESC NULLS FIRST",
  asc = "asc",
  asc_nulls_last = "asc nulls last",
  asc_nulls_first = "asc nulls first",
  desc = "desc",
  desc_nulls_last = "desc nulls last",
  desc_nulls_first = "desc nulls first",
}
export declare enum QueryOrderNumeric {
  ASC = 1,
  DESC = -1,
}
export type QueryOrderKeysFlat =
  | QueryOrder
  | QueryOrderNumeric
  | keyof typeof QueryOrder;
export type QueryOrderKeys<T> = QueryOrderKeysFlat | QueryOrderMap<T>;
export type QueryOrderMap<T> = {
  // @ts-ignore
  [K in keyof T as ExcludeFunctions<T, K>]?: QueryOrderKeys<
    ExpandProperty<T[K]>
  >;
};
export type EntityField<T, P extends string = never> = AutoPath<T, P, "*">;
export interface FindOptions<T, P extends string = never> {
  load?: readonly AutoPath<T, P>[];
  orderBy?:
  | (QueryOrderMap<T> & {
    0?: never;
  })
  | QueryOrderMap<T>[];
  cache?: boolean | number | Date;
  limit?: number;
  offset?: number;
  fields?: readonly EntityField<T, P>[];
  schema?: string;
  loadStrategy?: "select" | "joined";
}
export type FindOneOption<T, P extends string = never> = Omit<
  FindOptions<T, P>,
  "limit" | "offset"
>;
