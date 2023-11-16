import {
  ColDiff,
  ConnectionSettings,
  DriverInterface, ForeignKeyInfo,
  SnapshotConstraintInfo,
  SnapshotIndexInfo,
  SnapshotTable,
  Statement,
} from './driver.interface';
import { Client } from 'pg'

export class PgDriver implements DriverInterface {
  connectionString: string;

  private client: Client;

  constructor(options: ConnectionSettings) {
    if (options.connectionString) {
      this.connectionString = options.connectionString;
    } else {
      const {host, port, username, password, database} = options;
      this.connectionString = `postgres://${username}:${password}@${host}:${port}/${database}`;
    }

    this.client = new Client({
      connectionString: this.connectionString,
    })
  }

  getCreateTableInstruction(schema: string | undefined, tableName: string, creates: ColDiff[]) {
    return `CREATE TABLE "${schema}"."${tableName}" (${creates.map(colDiff => {
      let sql = `"${colDiff.colName}" ${colDiff.colType}${(colDiff.colLength ? `(${colDiff.colLength})` : '')}`;

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
    })});`;
  }
  getAlterTableFkInstruction(schema: string | undefined, tableName: string, colDiff: ColDiff, fk: ForeignKeyInfo) {
    return `ALTER TABLE "${schema}"."${tableName}" ADD CONSTRAINT "${tableName}_${colDiff.colName}_fk" FOREIGN KEY ("${colDiff.colName}") REFERENCES "${fk.referencedTableName}" ("${fk.referencedColumnName}");`;
  }
  getCreateIndex(index: { name: string; properties: string[] }, schema: string | undefined, tableName: string) {
    return `CREATE INDEX "${index.name}" ON "${schema}"."${tableName}" (${index.properties.map(prop => `"${prop}"`).join(', ')});`;
  }
  getAddColumn(schema: string | undefined, tableName: string, colName: string, colDiff: ColDiff, colDiffInstructions: string[]): void{
    let sql = `ALTER TABLE "${schema}"."${tableName}" ADD COLUMN "${colName}" ${colDiff.colType}${(colDiff.colLength ? `(${colDiff.colLength})` : '')}`

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
      colDiff.colChanges.foreignKeys.forEach(fk => {
        colDiffInstructions.push(`ALTER TABLE "${schema}"."${tableName}" ADD CONSTRAINT "${tableName}_${colName}_fk" FOREIGN KEY ("${colName}") REFERENCES "${fk.referencedTableName}" ("${fk.referencedColumnName}");`);
      });
    }
  }
  getDropColumn(colDiffInstructions: string[], schema: string | undefined, tableName: string, colName: string) {
    colDiffInstructions.push(`ALTER TABLE "${schema}"."${tableName}" DROP COLUMN IF EXISTS "${colName}";`);
  }
  getDropIndex(index: { name: string; properties?: string[] }, schema: string | undefined, tableName: string) {
    return `DROP INDEX "${index.name}" ON "${schema}"."${tableName}";`;
  }
  getAlterTableType(schema: string | undefined, tableName: string, colName: string, colDiff: ColDiff): string {
    return `ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${colName}" TYPE ${colDiff.colType}${(colDiff.colLength ? `(${colDiff.colLength})` : '')};`;
  }
  getAlterTableDefaultInstruction(schema: string | undefined, tableName: string, colName: string, colDiff: ColDiff): string {
    return `ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${colName}" SET DEFAULT ${colDiff.colChanges!.default};`;
  }
  getAlterTablePrimaryKeyInstruction(schema: string | undefined, tableName: string, colName: string, colDiff: ColDiff): string {
    return `ALTER TABLE "${schema}"."${tableName}" ADD PRIMARY KEY ("${colName}");`
  }
  getDropConstraint(param: { name: string }, schema: string | undefined, tableName: string): string {
    return `ALTER TABLE "${schema}"."${tableName}" DROP CONSTRAINT "${param.name}";`;
  }
  getAddUniqueConstraint(schema: string | undefined, tableName: string, colName: string): string {
    return `ALTER TABLE "${schema}"."${tableName}" ADD UNIQUE ("${colName}");`
  }
  getAlterTableDropNullInstruction(schema: string | undefined, tableName: string, colName: string, colDiff: ColDiff): string {
    return `ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${colName}" DROP NOT NULL;`
  }
  getAlterTableDropNotNullInstruction(schema: string | undefined, tableName: string, colName: string, colDiff: ColDiff): string {
    return `ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${colName}" SET NOT NULL;`;
  }

  async startTransaction(): Promise<void> {
    await this.client.query('BEGIN;');
  }

  async commitTransaction(): Promise<void> {
    await this.client.query('COMMIT;');
  }

  async rollbackTransaction(): Promise<void> {
    await this.client.query('ROLLBACK;');
  }

  async executeStatement(statement: Statement<any>): Promise<{ query: any, startTime: number, sql: string }>{
    let {statement: statementType, table, columns, where, limit, alias} = statement;
    let sql = '';

    switch (statementType) {
      case 'select':
        sql = `SELECT ${columns ? columns.join(', ') : '*'} FROM ${table} ${alias}`;
        break;
      case 'insert': // TODO: Tratar corretamente os valores string, number
        const fields = Object.keys(statement.values).map(v => `"${v}"`).join(', ');
        const values = Object.values(statement.values).map(value => this.toDatabaseValue(value)).join(', ');

        sql = `INSERT INTO ${table} (${fields}) VALUES (${values}) RETURNING ${statement.columns!.join(', ').replaceAll(`${alias}.`, '')}`;
        break;
      case 'update':
        sql = `UPDATE ${table} as ${alias} SET ${Object.entries(statement.values).map(([key, value]) => `${key} = '${value}'`).join(', ')}`;
        break;
      case 'delete':
        break;
    }

    if (statement.join) {
      statement.join.forEach(join => {
        sql += ` ${join.type} JOIN ${join.joinSchema}.${join.joinTable} ${join.joinAlias} ON ${join.on}`;
      });
    }

    if (statementType !== 'insert') {
      if (where) {
        sql += ` WHERE ${where}`;
      }

      if (statement.orderBy) {
        sql += ` ORDER BY ${statement.orderBy.join(', ')}`;
      }

      if (statement.offset) {
        sql += ` OFFSET ${statement.offset}`;
      }

      if (limit) {
        sql += ` LIMIT ${statement.limit}`;
      }
    }

    const startTime = Date.now();
    return {
      query: await this.client.query(sql),
      startTime,
      sql
    };
  }


  connect(): Promise<void> {
    return this.client.connect()
  }

  disconnect(): Promise<void> {
    return this.client.end()
  }

  executeSql(s: string) {
    return this.client.query(s)
  }

  async snapshot(tableName: string, options: any): Promise<SnapshotTable | undefined> {
    const schema = (options && options.schema) || 'public';
    const sql = `SELECT * FROM information_schema.columns WHERE table_name = '${tableName}' AND table_schema = '${schema}'`;
    const result = await this.client.query(sql);

    if (!result.rows || result.rows.length === 0) {
      return;
    }

    const indexes = await this.index(tableName, options) || [];
    const constraints = await this.constraints(tableName, options) || [];

    return {
      tableName,
      schema,
      indexes,
      columns: result.rows.map(row => {
        // console.log(this.getForeignKeys(constraints, row), row.column_name)
        return {
          default: row.column_default,
          length: row.character_maximum_length || row.numeric_precision || row.datetime_precision,
          name: row.column_name,
          nullable: row.is_nullable === 'YES',
          primary: constraints.some(c => c.type === 'PRIMARY KEY' && c.consDef.includes(row.column_name)),
          unique: constraints.some(c => (c.type === 'UNIQUE' || c.type === 'PRIMARY KEY') && c.consDef.includes(row.column_name)),
          type: row.data_type,
          foreignKeys: this.getForeignKeys(constraints, row)
        }
      })
    }
  }

  private getForeignKeys(constraints: SnapshotConstraintInfo[], row: any) {
    const name = row.column_name
    return constraints.filter(c => c.type === 'FOREIGN KEY'  && c.consDef.match(new RegExp(`FOREIGN KEY \\("${row.column_name}"\\)`))).map(c => {
      const filter = c.consDef.match(/REFERENCES\s+"([^"]+)"\s*\(([^)]+)\)/);

      if (!filter) throw new Error('Invalid constraint definition');

      return {
        referencedColumnName: filter[2].split(',')[0].trim(),
        referencedTableName: filter[1],
      }
    });
  }

  async index(tableName: string, options: any): Promise<SnapshotIndexInfo[] | undefined> {
    const schema = (options && options.schema) || 'public';
    const result = await this.client.query(
      `SELECT indexname AS index_name, indexdef AS column_name, tablename AS table_name
       FROM pg_indexes
       WHERE tablename = '${tableName}' AND schemaname = '${schema}'`
    );

    return result.rows.map(row => {
      return {
        table: tableName,
        indexName: row.index_name,
        columnName: row.column_name
      }
    });
  }

  async constraints(tableName: string, options: any): Promise<SnapshotConstraintInfo[] | undefined> {
    const schema = (options && options.schema) || 'public';
    const result = await this.client.query(
      `SELECT 
        conname AS index_name,
        pg_get_constraintdef(pg_constraint.oid) as consdef,
        CASE contype
            WHEN 'c' THEN 'CHECK'
            WHEN 'f' THEN 'FOREIGN KEY'
            WHEN 'p' THEN 'PRIMARY KEY'
            WHEN 'u' THEN 'UNIQUE'
            WHEN 't' THEN 'TRIGGER'
            WHEN 'x' THEN 'EXCLUSION'
            ELSE 'UNKNOWN'
            END AS constraint_type
       FROM pg_constraint 
       where conrelid =  (
           SELECT oid
           FROM pg_class
           WHERE relname = '${tableName}'
             AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = '${schema}')
       )
         AND conkey @> ARRAY(
           SELECT attnum
    FROM pg_attribute
    WHERE attrelid = conrelid
      AND attname = '${schema}'
  )`
    );

    return result.rows.map(row => {
      return {
        indexName: row.index_name,
        type: row.constraint_type,
        consDef: row.consdef
      }
    });
  }

  private toDatabaseValue(value: unknown) {
    if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    }

    switch (typeof value) {
      case 'string':
        return `'${value}'`;
      case 'number':
        return value;
      case 'boolean':
        return value;
      case 'object':
        return `'${JSON.stringify(value)}'`;
      default:
        return `'${value}'`;
    }
  }
}