import {
  ColDiff,
  ConnectionSettings,
  DriverInterface,
  ForeignKeyInfo,
  IndexStatement,
  SnapshotConstraintInfo,
  SnapshotIndexInfo,
  SnapshotTable,
  Statement,
} from './driver.interface';
import { BunDriverBase } from './bun-driver.base';

export class BunMysqlDriver extends BunDriverBase implements DriverInterface {
  readonly dbType = 'mysql' as const;

  constructor(options: ConnectionSettings) {
    super(options);
  }

  protected getProtocol(): string {
    return 'mysql';
  }

  public getIdentifierQuote(): string {
    return '`';
  }

  protected buildAutoIncrementType(colDiff: ColDiff): string {
    return 'INT AUTO_INCREMENT';
  }

  protected buildEnumType(
    schema: string | undefined,
    tableName: string,
    colDiff: ColDiff
  ): { beforeSql: string; columnType: string } {
    const enumValues = colDiff.colChanges!.enumItems!
      .map((item) => `'${item}'`)
      .join(', ');

    return {
      beforeSql: '',
      columnType: `ENUM(${enumValues})`,
    };
  }

  protected appendReturningClause(
    sql: string,
    statement: Statement<any>
  ): string {
    return sql;
  }

  protected async handleInsertReturn(
    statement: Statement<any>,
    result: any,
    sql: string,
    startTime: number,
    context: any
  ): Promise<{ query: any; startTime: number; sql: string }> {
    if (!statement.columns) {
      return {
        query: { rows: Array.isArray(result) ? result : [] },
        startTime,
        sql,
      };
    }

    const primaryKeyColumnName = statement.primaryKeyColumnName || 'id';
    const cols = statement.columns.join(', ').replaceAll(`${statement.alias}.`, '');

    // Multi-row INSERT path. MySQL guarantees consecutive AUTO_INCREMENT IDs for a
    // single multi-row INSERT under the default `innodb_autoinc_lock_mode=1`
    // (and stricter modes). LAST_INSERT_ID() returns the *first* generated ID;
    // ROW_COUNT() (exposed via `result.affectedRows`) returns the total inserted.
    if (statement.bulk && Array.isArray(statement.values)) {
      const rows = statement.values as Array<Record<string, any>>;
      const ids: any[] = [];
      const explicitCount = rows.filter((r) => r[primaryKeyColumnName] !== undefined && r[primaryKeyColumnName] !== null).length;
      const allHaveExplicitIds = explicitCount === rows.length;

      if (explicitCount > 0 && explicitCount < rows.length) {
        throw new Error(
          `bulkCreate: mixed explicit/auto-generated primary keys are not supported. ` +
          `${explicitCount} of ${rows.length} rows have explicit '${primaryKeyColumnName}' values.`
        );
      }

      if (allHaveExplicitIds) {
        for (const r of rows) ids.push(r[primaryKeyColumnName]);
      } else {
        const lastIdResult = await context.unsafe('SELECT LAST_INSERT_ID() as id');
        const firstId = lastIdResult[0]?.id;
        if (!firstId) {
          return { query: { rows: [] }, startTime, sql };
        }
        for (let i = 0; i < rows.length; i += 1) ids.push(firstId + i);
      }

      const inList = ids.map((v) => this.toDatabaseValue(v)).join(', ');
      const selectSql = `SELECT ${cols} FROM ${statement.table} WHERE \`${primaryKeyColumnName}\` IN (${inList}) ORDER BY FIELD(\`${primaryKeyColumnName}\`, ${inList})`;
      const selectResult = await context.unsafe(selectSql);

      return {
        query: { rows: Array.isArray(selectResult) ? selectResult : [] },
        startTime,
        sql,
      };
    }

    let insertId: number | undefined;

    // Check if ID was manually provided in the values
    if (statement.values && statement.values[primaryKeyColumnName]) {
      insertId = statement.values[primaryKeyColumnName];
    } else {
      // For AUTO_INCREMENT, use LAST_INSERT_ID()
      const lastIdResult = await context.unsafe('SELECT LAST_INSERT_ID() as id');
      insertId = lastIdResult[0]?.id;
    }

    if (!insertId) {
      // If no ID available, return empty result
      return {
        query: { rows: [] },
        startTime,
        sql,
      };
    }

    const idValue = this.toDatabaseValue(insertId);
    const selectSql = `SELECT ${cols} FROM ${statement.table} WHERE \`${primaryKeyColumnName}\` = ${idValue}`;
    const selectResult = await context.unsafe(selectSql);

    return {
      query: { rows: Array.isArray(selectResult) ? selectResult : [] },
      startTime,
      sql,
    };
  }

  protected buildLimitAndOffsetClause(statement: Statement<any>): string {
    const { offset, limit } = statement;

    if (offset && limit) {
      return ` LIMIT ${offset}, ${limit}`;
    }

    if (limit) {
      return this.buildLimitClause(limit);
    }

    return '';
  }

  getCreateTableInstruction(
    schema: string | undefined,
    tableName: string,
    creates: ColDiff[]
  ): string {
    let beforeSql = ``;

    const st = `CREATE TABLE \`${tableName}\` (${creates
      .map((colDiff) => {
        const isAutoIncrement = colDiff.colChanges?.autoIncrement;
        let sql = ``;

        if (colDiff.colChanges?.enumItems) {
          const enumValues = colDiff.colChanges.enumItems
            .map((item) => `'${item}'`)
            .join(', ');
          sql += `\`${colDiff.colName}\` ENUM(${enumValues})`;
        } else {
          const type = isAutoIncrement
            ? 'INT AUTO_INCREMENT'
            : colDiff.colType + (colDiff.colLength ? `(${colDiff.colLength})` : '');
          sql += `\`${colDiff.colName}\` ${type}`;
        }

        if (!colDiff.colChanges?.nullable) {
          sql += ' NOT NULL';
        }

        if (colDiff.colChanges?.primary) {
          sql += ' PRIMARY KEY';
        }

        if (colDiff.colChanges?.unique) {
          sql += ' UNIQUE';
        }

        if (colDiff.colChanges?.default) {
          sql += ` DEFAULT ${colDiff.colChanges.default}`;
        }

        return sql;
      })
      .join(', ')});`;

    return beforeSql + st;
  }

  getAlterTableFkInstruction(
    schema: string | undefined,
    tableName: string,
    colDiff: ColDiff,
    fk: ForeignKeyInfo
  ): string {
    return `ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`${tableName}_${colDiff.colName}_fk\` FOREIGN KEY (\`${colDiff.colName}\`) REFERENCES \`${fk.referencedTableName}\` (\`${fk.referencedColumnName}\`);`;
  }

  getCreateIndex(
    index: IndexStatement,
    schema: string | undefined,
    tableName: string
  ): string {
    const properties = index.properties || [];
    if (properties.length === 0) {
      throw new Error("Index properties are required.");
    }

    if (index.where) {
      throw new Error("Partial indexes are only supported on postgres.");
    }

    const columns = properties.map((prop) => `\`${prop}\``).join(', ');

    return `CREATE INDEX \`${index.name}\` ON \`${tableName}\` (${columns});`;
  }

  getAddColumn(
    schema: string | undefined,
    tableName: string,
    colName: string,
    colDiff: ColDiff,
    colDiffInstructions: string[]
  ): void {
    let sql = ``;

    if (colDiff.colChanges?.enumItems) {
      const enumValues = colDiff.colChanges.enumItems
        .map((item) => `'${item}'`)
        .join(', ');
      sql += `ALTER TABLE \`${tableName}\` ADD COLUMN \`${colDiff.colName}\` ENUM(${enumValues})`;
    } else {
      sql += `ALTER TABLE \`${tableName}\` ADD COLUMN \`${colName}\` ${colDiff.colType}${colDiff.colLength ? `(${colDiff.colLength})` : ''}`;
    }

    if (!colDiff.colChanges?.nullable) {
      sql += ' NOT NULL';
    }

    if (colDiff.colChanges?.primary) {
      sql += ' PRIMARY KEY';
    }

    if (colDiff.colChanges?.unique) {
      sql += ' UNIQUE';
    }

    if (colDiff.colChanges?.default) {
      sql += ` DEFAULT ${colDiff.colChanges.default}`;
    }

    colDiffInstructions.push(sql.concat(';'));

    if (colDiff.colChanges?.foreignKeys) {
      colDiff.colChanges.foreignKeys.forEach((fk) => {
        colDiffInstructions.push(
          `ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`${tableName}_${colName}_fk\` FOREIGN KEY (\`${colName}\`) REFERENCES \`${fk.referencedTableName}\` (\`${fk.referencedColumnName}\`);`
        );
      });
    }
  }

  getDropColumn(
    colDiffInstructions: string[],
    schema: string | undefined,
    tableName: string,
    colName: string
  ): void {
    colDiffInstructions.push(
      `ALTER TABLE \`${tableName}\` DROP COLUMN IF EXISTS \`${colName}\`;`
    );
  }

  getDropIndex(
    index: { name: string; properties?: string[] },
    schema: string | undefined,
    tableName: string
  ): string {
    return `ALTER TABLE \`${tableName}\` DROP INDEX \`${index.name}\`;`;
  }

  getCreateUniqueConstraint(
    unique: { name: string; properties?: string[] },
    schema: string | undefined,
    tableName: string
  ): string {
    const properties = unique.properties || [];

    if (properties.length === 0) {
      throw new Error("Unique properties are required.");
    }

    const columns = properties.map((prop) => `\`${prop}\``).join(', ');

    return `ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`${unique.name}\` UNIQUE (${columns});`;
  }

  getDropUniqueConstraint(
    unique: { name: string },
    schema: string | undefined,
    tableName: string
  ): string {
    return `ALTER TABLE \`${tableName}\` DROP INDEX \`${unique.name}\`;`;
  }

  getAlterTableType(
    schema: string | undefined,
    tableName: string,
    colName: string,
    colDiff: ColDiff
  ): string {
    return `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${colName}\` ${colDiff.colType}${colDiff.colLength ? `(${colDiff.colLength})` : ''};`;
  }

  getAlterTableDefaultInstruction(
    schema: string | undefined,
    tableName: string,
    colName: string,
    colDiff: ColDiff
  ): string {
    return `ALTER TABLE \`${tableName}\` ALTER COLUMN \`${colName}\` SET DEFAULT ${colDiff.colChanges!.default};`;
  }

  getAlterTablePrimaryKeyInstruction(
    schema: string | undefined,
    tableName: string,
    colName: string,
    colDiff: ColDiff
  ): string {
    return `ALTER TABLE \`${tableName}\` ADD PRIMARY KEY (\`${colName}\`);`;
  }

  getDropConstraint(
    param: { name: string },
    schema: string | undefined,
    tableName: string
  ): string {
    return `ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${param.name}\`;`;
  }

  getAddUniqueConstraint(
    schema: string | undefined,
    tableName: string,
    colName: string
  ): string {
    return `ALTER TABLE \`${tableName}\` ADD UNIQUE (\`${colName}\`);`;
  }

  getAlterTableDropNullInstruction(
    schema: string | undefined,
    tableName: string,
    colName: string,
    colDiff: ColDiff
  ): string {
    return `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${colName}\` ${colDiff.colType} NULL;`;
  }

  getAlterTableDropNotNullInstruction(
    schema: string | undefined,
    tableName: string,
    colName: string,
    colDiff: ColDiff
  ): string {
    return `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${colName}\` ${colDiff.colType} NOT NULL;`;
  }

  getAlterTableEnumInstruction(
    schema: string,
    tableName: string,
    colName: string,
    colDiff: ColDiff
  ): string {
    const enumValues = colDiff.colChanges!.enumItems!
      .map((item) => `'${item}'`)
      .join(', ');

    return `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${colName}\` ENUM(${enumValues});`;
  }

  getDropTypeEnumInstruction(
    param: { name: string },
    schema: string | undefined,
    tableName: string
  ): string {
    return '';
  }

  async snapshot(
    tableName: string,
    options: any
  ): Promise<SnapshotTable | undefined> {
    const schema = (options && options.schema) || 'information_schema';

    const sql = `SELECT * FROM information_schema.columns WHERE table_name = '${tableName}' AND table_schema = DATABASE()`;
    const result = await this.sql.unsafe(sql);

    if (!result || result.length === 0) {
      return;
    }

    const indexes = (await this.index(tableName, options)) || [];
    const constraints = (await this.constraints(tableName, options)) || [];

    return {
      tableName,
      schema,
      indexes,
      columns: result.map((row) => {
        return {
          default: row.COLUMN_DEFAULT,
          length:
            row.CHARACTER_MAXIMUM_LENGTH ||
            row.NUMERIC_PRECISION ||
            row.DATETIME_PRECISION,
          name: row.COLUMN_NAME,
          nullable: row.IS_NULLABLE === 'YES',
          primary: row.COLUMN_KEY === 'PRI',
          unique: row.COLUMN_KEY === 'UNI' || row.COLUMN_KEY === 'PRI',
          type: row.DATA_TYPE,
          foreignKeys: this.getForeignKeysFromConstraints(
            constraints,
            row,
            'COLUMN_NAME'
          ),
          isEnum: row.DATA_TYPE === 'enum',
          enumItems: row.DATA_TYPE === 'enum' ? this.parseEnumValues(row.COLUMN_TYPE) : undefined,
          precision: row.NUMERIC_PRECISION,
          scale: row.NUMERIC_SCALE,
          isDecimal: row.DATA_TYPE === 'decimal',
        };
      }),
    };
  }

  private parseEnumValues(columnType: string): string[] {
    const match = columnType.match(/enum\((.*)\)/);

    if (!match) {
      return [];
    }

    return match[1].split(',').map((v) => v.trim().replace(/'/g, ''));
  }

  async index(
    tableName: string,
    options: any
  ): Promise<SnapshotIndexInfo[] | undefined> {
    const result = await this.sql.unsafe(
      `SHOW INDEX FROM \`${tableName}\``
    );

    return result
      .filter((row) => row.Key_name !== 'PRIMARY')
      .map((row) => {
        return {
          table: tableName,
          indexName: row.Key_name,
          columnName: row.Column_name,
        };
      });
  }

  async constraints(
    tableName: string,
    options: any
  ): Promise<SnapshotConstraintInfo[] | undefined> {
    const result = await this.sql.unsafe(
      `SELECT
        CONSTRAINT_NAME as index_name,
        CONCAT('REFERENCES \`', REFERENCED_TABLE_NAME, '\` (\`', REFERENCED_COLUMN_NAME, '\`)') as consdef,
        'FOREIGN KEY' as constraint_type
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_NAME = '${tableName}'
         AND TABLE_SCHEMA = DATABASE()
         AND REFERENCED_TABLE_NAME IS NOT NULL`
    );

    return result.map((row) => {
      return {
        indexName: row.index_name,
        type: row.constraint_type,
        consDef: row.consdef,
      };
    });
  }
}
