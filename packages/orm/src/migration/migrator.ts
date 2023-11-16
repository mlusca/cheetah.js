import 'reflect-metadata';
import { ColDiff, ConnectionSettings, DriverInterface, SnapshotTable } from '@cheetah.js/orm/driver/driver.interface';
import { globby } from 'globby'
import { Orm, OrmService } from '@cheetah.js/orm';
import { InjectorService, LoggerService } from '@cheetah.js/core';
import { EntityStorage } from '@cheetah.js/orm/domain/entities';
import * as path from 'path';
import * as fs from 'fs';
import { DiffCalculator } from './diff-calculator';

export class Migrator {
  config: ConnectionSettings<any>;
  orm: Orm<any>;
  entities: EntityStorage = new EntityStorage();

  constructor() {
  }

  async initConfigFile(basePath: string = process.cwd()) {
    const paths = await globby(['cheetah.config.ts'], {absolute: true, cwd: basePath})

    if (paths.length === 0) {
      throw new Error('Config file not found');
    }

    const config = await import(paths[0]);
    this.config = config.default;

    if (typeof this.config.entities === 'string') {
      const paths = await globby(this.config.entities, {absolute: true, cwd: basePath})
      for (const path of paths) {
        await import(path);
      }
    }

    this.orm = new Orm(this.config, new LoggerService(new InjectorService()));
    await this.orm.connect();
  }

  async initMigration() {
    this.entities = new EntityStorage();
    const serv = new OrmService(this.entities)
    serv.onInit();
    const snapshotBd = await this.snapshotBd();
    const snapshotEntities = await this.snapshotEntities();
    const calculator = new DiffCalculator(this.entities);

    return calculator.diff(snapshotBd, snapshotEntities);
  }

  private async snapshotBd(): Promise<SnapshotTable[]> {
    const snapshot = []
    for (let [_, values] of this.entities.entries()) {
      const bd = await this.orm.driverInstance.snapshot(values.tableName);
      if (!bd) {
        continue;
      }
      snapshot.push(bd)
    }
    return snapshot;
  }

  private async snapshotEntities() {
    const snapshot = []
    for (let [_, values] of this.entities.entries()) {
      snapshot.push(await this.entities.snapshot(values))
    }
    return snapshot;
  }


  async createMigration(forceName: string | null = null): Promise<void> {
    const diff = await this.initMigration();
    const migrationDirectory = path.join(process.cwd(), this.config.migrationPath ?? 'database/migrations');
    const migrationFileName = (forceName ?? `migration_${new Date().toISOString().replace(/[^\d]/g, '')}`) + `.sql`;
    const migrationFilePath = path.join(migrationDirectory, migrationFileName);

    if (!fs.existsSync(migrationDirectory)) {
      fs.mkdirSync(migrationDirectory, {recursive: true});
    }

    let sqlInstructions: string[] = [];

    diff.forEach(tableDiff => {
      const tableName = tableDiff.tableName;
      const schema = tableDiff.schema;

      if (tableDiff.newTable) {
        const indexes = tableDiff.colDiffs.filter(colDiff => colDiff.actionType === 'INDEX');
        const creates = tableDiff.colDiffs.filter(colDiff => colDiff.actionType === 'CREATE');
        const fks = tableDiff.colDiffs.filter(colDiff => colDiff.colChanges?.foreignKeys);

        sqlInstructions.push(this.orm.driverInstance.getCreateTableInstruction(schema, tableName, creates));

        indexes.forEach(colDiff => {
          colDiff.indexTables = colDiff.indexTables?.filter(index => index.name !== `${tableName}_pkey`);
        });

        fks.forEach(colDiff => {
          colDiff.colChanges?.foreignKeys?.forEach(fk => {
            sqlInstructions.push(this.orm.driverInstance.getAlterTableFkInstruction(schema, tableName, colDiff, fk));
          });
        });

        sqlInstructions = sqlInstructions.map(sql => sql.replace(/' '/g, ''));
        indexes.forEach(colDiff => {
          if (colDiff.indexTables) {
            colDiff.indexTables.forEach(index => {
              if (index.properties) {
                sqlInstructions.push(this.orm.driverInstance.getCreateIndex(index, schema, tableName));
              }
            });
          }
        })
        return;
      }

      // Agrupar alterações por coluna
      const colChangesMap = new Map<string, ColDiff[]>();

      tableDiff.colDiffs.reverse().forEach(colDiff => {
        const colName = colDiff.colName;

        if (!colChangesMap.has(colName)) {
          colChangesMap.set(colName, []);
        }

        colChangesMap.get(colName)?.push(colDiff);
      });

      // Gerar instruções SQL agrupadas por coluna
      colChangesMap.forEach((colDiffs, colName) => {
        const colDiffInstructions: string[] = [];

        colDiffs.forEach(colDiff => {
          switch (colDiff.actionType) {
            case 'CREATE':
              (this.orm.driverInstance as DriverInterface).getAddColumn(schema, tableName, colName, colDiff, colDiffInstructions);
              break;
            case 'DELETE':
              (this.orm.driverInstance as DriverInterface).getDropColumn(colDiffInstructions, schema, tableName, colName);
              break;
            case 'ALTER':
              this.applyColumnChanges(colDiff, colDiffInstructions, schema, tableName, colName);
              break;
            case "INDEX":
              if (colDiff.indexTables) {
                colDiff.indexTables.forEach(index => {
                  // if already exists instruction for this index, skip
                  if (colDiffInstructions.find(instruction => instruction.includes(index.name))) {
                    return;
                  }

                  if (this.alreadyConstraint(sqlInstructions, index.name)) {
                    return;
                  }

                  if (index.properties) {
                    colDiffInstructions.push((this.orm.driverInstance as DriverInterface).getCreateIndex(index, schema, tableName));
                  } else {
                    colDiffInstructions.push((this.orm.driverInstance as DriverInterface).getDropIndex(index, schema, tableName));
                  }
                });
              }
              break;
            // Adicione lógica para outros tipos de ação, se necessário
          }
        });

        // Se houver instruções para a coluna, agrupe-as
        if (colDiffInstructions.length > 0) {
          sqlInstructions.push(colDiffInstructions.join('\n'));
        }
      });
    });
    const migrationContent = sqlInstructions.join('\n');

    if (migrationContent.length === 0) {
      console.log('No changes detected');
      return;
    } else {
      fs.writeFileSync(migrationFilePath, migrationContent);

      console.log(`Migration file created: ${migrationFilePath}`);
    }
  }

  async migrate() {
    const migrationTable = 'cheetah_migrations';
    const migrationDirectory = path.join(process.cwd(), this.config.migrationPath ?? 'database/migrations');
    const migrationFiles = fs
      .readdirSync(migrationDirectory)
      .filter(file => file.endsWith('.sql'))
      .sort();

    if (migrationFiles.length === 0) {
      console.log('No migration files found');
      return;
    }

    this.orm.driverInstance.executeSql(`CREATE TABLE IF NOT EXISTS "${migrationTable}" ("migration_file" character varying(255) NOT NULL PRIMARY KEY UNIQUE);`);
    // get the migration fil
    const migrated = await this.orm.driverInstance.executeSql(`SELECT * FROM "${migrationTable}" ORDER BY "migration_file" ASC;`);
    const lastMigration = migrated.rows[migrated.rows.length - 1];
    const lastMigrationIndex = migrationFiles.indexOf(lastMigration?.migration_file ?? '');
    const migrationsToExecute = migrationFiles.slice(lastMigrationIndex + 1);

    if (migrationsToExecute.length === 0) {
      console.log('Database is up to date');
      return;
    }

    for (const migrationFile of migrationsToExecute) {
      const migrationFilePath = path.join(migrationDirectory, migrationFile);
      const migrationContent = fs.readFileSync(migrationFilePath, {encoding: 'utf-8'});
      const sqlInstructions = migrationContent.split(';').filter(sql => sql.trim().length > 0);

      for (const sqlInstruction of sqlInstructions) {
        await this.orm.driverInstance.executeSql(sqlInstruction);
      }

      await this.orm.driverInstance.executeSql(`INSERT INTO "${migrationTable}" ("migration_file") VALUES ('${migrationFile}');`);

      console.log(`Migration executed: ${migrationFile}`);
    }
  }

  private applyColumnChanges(colDiff: ColDiff, sqlInstructions: string[], schema: string | undefined, tableName: string, colName: string) {
    if (colDiff.colType) {
      sqlInstructions.push( (this.orm.driverInstance as DriverInterface).getAlterTableType(schema, tableName, colName, colDiff));
    }

    if (colDiff.colChanges) {
      if (colDiff.colChanges.default !== undefined) {
        sqlInstructions.push((this.orm.driverInstance as DriverInterface).getAlterTableDefaultInstruction(schema, tableName, colName, colDiff));
      }

      if (colDiff.colChanges.primary !== undefined) {
        if (colDiff.colChanges.primary) {
          sqlInstructions.push((this.orm.driverInstance as DriverInterface).getAlterTablePrimaryKeyInstruction(schema, tableName, colName, colDiff));
        } else {
          sqlInstructions.push((this.orm.driverInstance as DriverInterface).getDropConstraint({name: `${tableName}_pkey`}, schema, tableName));
        }
      }

      if (colDiff.colChanges.unique !== undefined && !this.alreadyConstraint(sqlInstructions, `${tableName}_${colName}_key`)) {
        if (colDiff.colChanges.unique) {
          sqlInstructions.push((this.orm.driverInstance as DriverInterface).getAddUniqueConstraint(schema, tableName, colName));
        } else {
          sqlInstructions.push((this.orm.driverInstance as DriverInterface).getDropConstraint({name: `${tableName}_${colName}_key`}, schema, tableName));
        }
      }

      if(colDiff.colChanges.nullable !== undefined) {
        if (colDiff.colChanges.nullable) {
          sqlInstructions.push((this.orm.driverInstance as DriverInterface).getAlterTableDropNullInstruction(schema, tableName, colName, colDiff));
        } else {
          sqlInstructions.push((this.orm.driverInstance as DriverInterface).getAlterTableDropNotNullInstruction(schema, tableName, colName, colDiff));
        }
      }

      if (colDiff.colChanges.foreignKeys !== undefined) {
        if (colDiff.colChanges.foreignKeys.length === 0) {
          sqlInstructions.push((this.orm.driverInstance as DriverInterface).getDropConstraint({name: `${tableName}_${colName}_fk`}, schema, tableName));
        }

        colDiff.colChanges.foreignKeys.forEach(fk => {
          sqlInstructions.push((this.orm.driverInstance as DriverInterface).getAlterTableFkInstruction(schema, tableName, colDiff, fk))
        });
      }
      // Adicione lógica para outras alterações necessárias
    }
  }

  private alreadyConstraint(sqlInstructions: string[], s: string): boolean {
    return sqlInstructions.some(sql => sql.includes(`"${s}"`));
  }
}
