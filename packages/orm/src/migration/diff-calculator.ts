import { EntityStorage } from '../domain/entities';
import { ColDiff, ColumnsInfo, SnapshotTable, TableDiff } from '@cheetah.js/orm/driver/driver.interface';

export class DiffCalculator {
  private entities: EntityStorage;

  constructor(entities: EntityStorage) {
    this.entities = entities;
  }

  diff(snapshotBd: SnapshotTable[], snapshotEntities: SnapshotTable[]): TableDiff[] {
    let diffs: TableDiff[] = [];
    // Cria um mapa (dicionário) para facilitar o acesso por nome da tabela
    const bdTablesMap = new Map(snapshotBd.map(table => [table.tableName, table]));
    const entityTablesMap = new Map(snapshotEntities.map(table => [table.tableName, table]));

    // Junta todos os nomes de tabelas
    const allTableNames = new Set([...bdTablesMap.keys(), ...entityTablesMap.keys()]);

    allTableNames.forEach(tableName => {
      const bdTable = bdTablesMap.get(tableName);
      const entityTable = entityTablesMap.get(tableName);

      if (!entityTable) {
        // Se a tabela só está no banco de dados, precisamos deletá-la
        diffs.push({
          tableName,
          colDiffs: [{actionType: 'DELETE', colName: '*'}], // Indica que todas as colunas devem ser deletadas (ou seja, a tabela inteira)
        });
      } else if (!bdTable) {
        const colDiffs: ColDiff[] = entityTable.columns.flatMap(c => {
          return this.createNewColumn(c, [])
        });
        this.checkIndexes(bdTable, entityTable, colDiffs)
        // Se a tabela só está nas entidades, precisamos criá-la
        diffs.push({
          tableName,
          newTable: true,
          schema: entityTable.schema ?? 'public',
          colDiffs,// Indica que todas as colunas devem ser criadas
        });
      } else {
        const colDiffs: ColDiff[] = [];
        // Se a tabela está em ambos, precisamos comparar as colunas
        const bdColumnsMap = new Map(bdTable.columns.map(col => [col.name, col]));
        const entityColumnsMap = new Map(entityTable.columns.map(col => [col.name, col]));
        const allColumnNames = new Set([...bdColumnsMap.keys(), ...entityColumnsMap.keys()]);

        this.checkIndexes(bdTable, entityTable, colDiffs)

        allColumnNames.forEach(colName => {
          const bdCol = bdColumnsMap.get(colName);
          const entityCol = entityColumnsMap.get(colName);

          if (!entityCol) {
            colDiffs.push({
              actionType: 'DELETE',
              colName: bdCol!.name,
            });
          } else if (!bdCol) {
            this.createNewColumn(entityCol, colDiffs);
          } else this.diffColumnSql(bdCol, entityCol, colDiffs);
        });

        if (colDiffs.length > 0) {
          diffs.push({
            tableName: tableName,
            schema: entityTable.schema ?? 'public',
            colDiffs,
          });
        }
      }
    });

    return diffs;
  }

  private checkIndexes(bdTable: SnapshotTable | undefined, entityTable: SnapshotTable | undefined, colDiffs: ColDiff[]) {
    if ((bdTable && bdTable.indexes) || (entityTable && entityTable.indexes)) {
      if (!bdTable || !bdTable.indexes){
        colDiffs.push({
          actionType: 'INDEX',
          colName: '*',
          indexTables: entityTable!.indexes.map(index => ({name: index.indexName, properties: index.columnName.split(',')})),
        });
      }

      if (!entityTable || !entityTable.indexes) {
        colDiffs.push({
          actionType: 'INDEX',
          colName: '*',
          indexTables: bdTable!.indexes.map(index => ({ name: index.indexName })),
        });
      }
    }

    if ((bdTable && bdTable.indexes) && (entityTable && entityTable.indexes)) {
      const bdIndexesMap = new Map(bdTable.indexes.map(index => [index.indexName, index]));
      const entityIndexesMap = new Map(entityTable.indexes.map(index => [index.indexName, index]));
      const allIndexes = new Set([...bdIndexesMap.keys(), ...entityIndexesMap.keys()]);
      allIndexes.forEach(indexName => {
        const bdIndex = bdIndexesMap.get(indexName);
        const entityIndex = entityIndexesMap.get(indexName);
        if (!entityIndex) {
          colDiffs.push({
            actionType: 'INDEX',
            colName: bdIndex!.columnName,
            indexTables: [{name: indexName}],
          });
        } else if (!bdIndex) {
          colDiffs.push({
            actionType: 'INDEX',
            colName: entityIndex.columnName,
            indexTables: [{name: indexName, properties: entityIndex.columnName.split(',')}],
          });
        }
      });
    }
  }

  private createNewColumn(entityCol: ColumnsInfo, colDiffs: ColDiff[]): ColDiff[] {

    colDiffs.push({
      actionType: 'CREATE',
      colName: entityCol.name,
      colType: this.convertEntityTypeToSqlType(entityCol.type),
      colLength: entityCol.length,
      colChanges: {
        default: entityCol.default,
        primary: entityCol.primary,
        unique: entityCol.unique,
        nullable: entityCol.nullable,
        foreignKeys: entityCol.foreignKeys ?? [],
      },
    });

    return colDiffs;
  }

  private diffColumnType(bdCol: ColumnsInfo, entityCol: ColumnsInfo, colDiffs: ColDiff[]): void {
    if (bdCol.type !== this.convertEntityTypeToSqlType(entityCol.type) || bdCol.length !== entityCol.length) {
      colDiffs.push({
        actionType: 'ALTER',
        colName: entityCol.name,
        colType: this.convertEntityTypeToSqlType(entityCol.type),
        colLength: entityCol.length,
      });
    }
  }

  private diffColumnDefault(bdCol: ColumnsInfo, entityCol: ColumnsInfo, colDiffs: ColDiff[]): void {
    if (bdCol.default !== entityCol.default) {
      colDiffs.push({
        actionType: 'ALTER',
        colName: entityCol.name,
        colChanges: {default: entityCol.default},
        colLength: entityCol.length,
      });
    }
  }

  private diffColumnPrimary(bdCol: ColumnsInfo, entityCol: ColumnsInfo, colDiffs: ColDiff[]): void {
    if (bdCol.primary !== entityCol.primary) {
      colDiffs.push({
        actionType: 'ALTER',
        colName: entityCol.name,
        colChanges: {primary: entityCol.primary},
        colLength: entityCol.length,
      });
    }
  }

  private diffColumnUnique(bdCol: ColumnsInfo, entityCol: ColumnsInfo, colDiffs: ColDiff[]): void {
    if (bdCol.unique !== entityCol.unique) {

      if (bdCol.unique === false && entityCol.unique === undefined) {
        return;
      }

      colDiffs.push({
        actionType: 'ALTER',
        colName: entityCol.name,
        colChanges: {unique: entityCol.unique || false},
        colLength: entityCol.length,
      });
    }
  }

  private diffForeignKey(bdCol: ColumnsInfo, entityCol: ColumnsInfo, colDiffs: ColDiff[]): void {
    if (bdCol.foreignKeys || entityCol.foreignKeys) {
      const bdFKMap = new Map((bdCol.foreignKeys || []).map(fk => [`${fk.referencedTableName}.${fk.referencedColumnName}`, fk]));
      const entityFKMap = new Map((entityCol.foreignKeys || []).map(fk => [`${fk.referencedTableName}.${fk.referencedColumnName}`, fk]));

      const allFKs = new Set([...bdFKMap.keys(), ...entityFKMap.keys()]);

      allFKs.forEach(fkName => {
        const bdFK = bdFKMap.get(fkName);
        const entityFK = entityFKMap.get(fkName);

        if (!entityFK) {
          colDiffs.push({
            actionType: 'ALTER',
            colName: bdCol.name,
            colChanges: {
              foreignKeys: bdCol.foreignKeys?.filter((fk: any) => fk !== bdFK),
            },
          });
        }
        // else if (!bdFK) {
        //   console.log(bdFK, 'lu')
        //   colDiffs.push({
        //     actionType: 'ALTER',
        //     colName: entityCol.name,
        //     colChanges: {
        //       foreignKeys: [...(bdCol.foreignKeys || []), entityFK],
        //     },
        //   });
        // }
      });

    }
  }

  private diffColumnSql(bdCol: ColumnsInfo, entityCol: ColumnsInfo, colDiffs: ColDiff[]) {
    this.diffForeignKey(bdCol, entityCol, colDiffs);
    this.diffColumnType(bdCol, entityCol, colDiffs);
    this.diffColumnDefault(bdCol, entityCol, colDiffs);
    this.diffColumnPrimary(bdCol, entityCol, colDiffs);
    this.diffColumnUnique(bdCol, entityCol, colDiffs);
    this.diffColumnNullable(bdCol, entityCol, colDiffs);

    return colDiffs;
  }

  private diffColumnNullable(bdCol: ColumnsInfo, entityCol: ColumnsInfo, colDiffs: ColDiff[]) {
    if (bdCol.nullable !== entityCol.nullable) {
      colDiffs.push({
        actionType: 'ALTER',
        colName: entityCol.name,
        colChanges: {nullable: entityCol.nullable},
        colLength: entityCol.length,
      });
    }
  }

  // TODO: Precisa ser de acordo com o driver
  private convertEntityTypeToSqlType(entityType: string): string {
    switch (entityType) {
      case "Number":
        return "numeric";
      case "String":
        return "character varying";
      default:
        return "character varying"
      //... mais casos aqui ...
    }
  }
}