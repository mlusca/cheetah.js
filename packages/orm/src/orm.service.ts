import { Metadata, OnApplicationInit, Service } from '@carno.js/core';
import { EntityStorage, Property } from './domain/entities';
import { ENTITIES, EVENTS_METADATA, PROPERTIES_METADATA, PROPERTIES_RELATIONS } from './constants';
import { Project, SyntaxKind } from 'ts-morph';
import { Orm } from './orm';
import * as globby from 'globby';
import { Relationship } from './driver/driver.interface';
import path from 'path';
import { toSnakeCase } from './utils';


@Service()
export class OrmService {
  private allEntities = new Map<string, { nullables: string[], defaults: { [key: string]: any } }>();
  private project: Project;

  constructor(private orm: Orm, private storage: EntityStorage, entityFile?: string) {
    this.project = new Project({skipLoadingLibFiles: true});
    const files = this.project.addSourceFilesAtPaths(entityFile ?? this.getSourceFilePaths());
    
    files.forEach(file => {
      file.getClasses().forEach(classDeclaration => {
        if (classDeclaration.getDecorator('Entity')) {

          const properties = classDeclaration.getProperties();
          const nullables: string[] = [];
          const defaults: { [key: string]: any } = {};

          const extendsClass = classDeclaration.getBaseClass();
          if (extendsClass) {
            const extendsProperties = extendsClass.getProperties();
            properties.push(...extendsProperties)
          }

          properties.forEach(property => {
            const propertyName = property.getName();
            const isNullable = property.hasQuestionToken();
            const initializer = property.getInitializer();
            if (isNullable) {
              nullables.push(propertyName);
            }
            if (initializer) {
              const initializerKind = initializer.getKind();

              switch (initializerKind) {
                case SyntaxKind.StringLiteral:
                  defaults[propertyName] = initializer.getText();
                  break;
                case SyntaxKind.NumericLiteral:
                  defaults[propertyName] = parseFloat(initializer.getText());
                  break;
                case SyntaxKind.NewExpression:
                case SyntaxKind.CallExpression:
                  break;
                default:
                  break;
              }
            }

            this.allEntities.set(classDeclaration.getName() as string, {nullables, defaults});
          });
        }
      });
    })
  }

  private discoverRelationshipTypes(files: any[]): void {
    const entityNameToClass = new Map<string, Function>();
    const processedClasses = new Set<string>();

    const entities = Metadata.get(ENTITIES, Reflect) || [];
    for (const entity of entities) {
      entityNameToClass.set(entity.target.name, entity.target);
    }

    files.forEach(file => {
      file.getClasses().forEach(classDeclaration => {
        if (!classDeclaration.getDecorator('Entity')) return;

        const className = classDeclaration.getName();
        const targetClass = entityNameToClass.get(className!);
        if (!targetClass) return;

        processedClasses.add(className!);
        const relationships: any[] = Metadata.get(PROPERTIES_RELATIONS, targetClass) || [];

        classDeclaration.getProperties().forEach(property => {
          const propertyName = property.getName();
          const relationship = relationships.find(r => r.propertyKey === propertyName);

          if (relationship && relationship.entity === '__AUTO_DETECT__' && relationship.relation === 'many-to-one') {
            const typeNode = property.getTypeNode();
            if (!typeNode) return;

            const entityTypeName = typeNode.getText().trim();

            if (entityTypeName) {
              const entityClass = entityNameToClass.get(entityTypeName);
              if (entityClass) {
                relationship.entity = () => entityClass;
              } else {
                console.warn(
                  `Warning: Could not find entity "${entityTypeName}" for relationship ` +
                  `"${className}.${propertyName}". Please define it explicitly.`
                );
              }
            }
          }
        });

        Metadata.set(PROPERTIES_RELATIONS, relationships, targetClass);
      });
    });

    for (const entity of entities) {
      if (processedClasses.has(entity.target.name)) continue;

      const relationships: any[] = Metadata.get(PROPERTIES_RELATIONS, entity.target) || [];
      let updated = false;

      for (const relationship of relationships) {
        if (relationship.entity === '__AUTO_DETECT__' && relationship.relation === 'many-to-one') {
          const propertyKey = relationship.propertyKey as string;
          const capitalizedName = propertyKey.charAt(0).toUpperCase() + propertyKey.slice(1);
          let entityClass = entityNameToClass.get(capitalizedName);

          if (!entityClass) {
            for (const [name, cls] of entityNameToClass) {
              if (name.toLowerCase() === propertyKey.toLowerCase()) {
                entityClass = cls;
                break;
              }
            }
          }

          if (entityClass) {
            relationship.entity = () => entityClass;
            updated = true;
          } else {
            console.warn(
              `Warning: Could not auto-detect entity for "${entity.target.name}.${propertyKey}". ` +
              `Please define it explicitly.`
            );
          }
        }
      }

      if (updated) {
        Metadata.set(PROPERTIES_RELATIONS, relationships, entity.target);
      }
    }
  }

  private discoverEnumTypes(files: any[], entities: any[]): void {
    const entityNameToClass = new Map<string, Function>();

    for (const entity of entities) {
      entityNameToClass.set(entity.target.name, entity.target);
    }

    files.forEach(file => {
      file.getClasses().forEach(classDeclaration => {
        if (!classDeclaration.getDecorator('Entity')) return;

        const className = classDeclaration.getName();
        const targetClass = entityNameToClass.get(className!);
        if (!targetClass) return;

        const properties: { [key: string]: Property } = Metadata.get(PROPERTIES_METADATA, targetClass) || {};

        classDeclaration.getProperties().forEach(property => {
          const propertyName = property.getName();
          const propertyMetadata = properties[propertyName];

          if (propertyMetadata?.options?.enumItems === '__AUTO_DETECT__') {
            const typeNode = property.getTypeNode();
            if (!typeNode) return;

            const enumTypeName = typeNode.getText().trim();
            const enumArrayMatch = enumTypeName.match(/^(.+)\[\]$/);
            const actualEnumName = enumArrayMatch ? enumArrayMatch[1] : enumTypeName;

            const sourceFile = file;
            const enumDeclaration = sourceFile.getEnum(actualEnumName);

            if (enumDeclaration) {
              const enumMembers = enumDeclaration.getMembers();
              const enumValues = enumMembers.map(member => {
                const value = member.getValue();
                return value !== undefined ? value : member.getName();
              });

              propertyMetadata.options.enumItems = enumValues;

              if (enumArrayMatch) {
                propertyMetadata.options.array = true;
              }
            } else {
              const allSourceFiles = sourceFile.getProject().getSourceFiles();
              let foundEnum = false;

              for (const sf of allSourceFiles) {
                const importedEnum = sf.getEnum(actualEnumName);
                if (importedEnum) {
                  const enumMembers = importedEnum.getMembers();
                  const enumValues = enumMembers.map(member => {
                    const value = member.getValue();
                    return value !== undefined ? value : member.getName();
                  });

                  propertyMetadata.options.enumItems = enumValues;

                  if (enumArrayMatch) {
                    propertyMetadata.options.array = true;
                  }

                  foundEnum = true;
                  break;
                }
              }

              if (!foundEnum) {
                console.warn(
                  `Warning: Could not find enum "${actualEnumName}" for property ` +
                  `"${className}.${propertyName}". Please define it explicitly.`
                );
              }
            }
          }
        });

        Metadata.set(PROPERTIES_METADATA, properties, targetClass);
      });
    });
  }

  @OnApplicationInit()
  async onInit(customConfig: any = {}) {
    const hasCustomConfig = Object.keys(customConfig).length > 0;
    let config: any = null;
    let setConfig: any;

    if (!hasCustomConfig) {
      const configFile = globby.sync('carno.config.ts', {absolute: true});
      if (configFile.length === 0) {
        console.log('No config file found!')
        return;
      }

      config = await import(configFile[0]);
      setConfig = config.default;
    } else {
      setConfig = customConfig;
    }

    this.orm.setConnection(setConfig);
    await this.orm.connect();

    if (config && typeof config.default.entities === 'string') {
      const files = globby.sync([config.default.entities, '!node_modules'], {gitignore: true, absolute: true})

      for (const file of files) {
        await import(file)
      }
    }

    let entities = Metadata.get(ENTITIES, Reflect);

    if (!entities) {
      const entityPaths = this.getSourceFilePaths();
      const entityFiles = globby.sync(entityPaths.filter(path => path.includes('.entity.') || path.includes('entities/')));

      for (const file of entityFiles) {
        try {
          await import(file);
        } catch (error) {
          console.warn(`Failed to import entity file ${file}:`, error);
        }
      }

      entities = Metadata.get(ENTITIES, Reflect);
    }

    if (!entities) {
      console.log('No entities found!')
      return;
    }

    const files = this.project.getSourceFiles();
    this.discoverRelationshipTypes(files);
    this.discoverEnumTypes(files, entities);

    for (const entity of entities) {
      const nullableDefaultEntity = this.allEntities.get(entity.target.name);
      const propertiesFromMetadata: { [key: string]: Property } = Metadata.get(PROPERTIES_METADATA, entity.target);
      const relationshipsFromMetadata: Relationship<any>[] = Metadata.get(PROPERTIES_RELATIONS, entity.target) || [];
      const hooks = Metadata.get(EVENTS_METADATA, entity.target)

      // Create a deep copy of properties to avoid shared mutation
      const properties: { [key: string]: Property } = {};
      if (propertiesFromMetadata) {
        for (const [key, value] of Object.entries(propertiesFromMetadata)) {
          properties[key] = {
            type: value.type,
            options: { ...value.options }
          };
        }
      }

      for (const property in properties) {
        if (nullableDefaultEntity?.nullables.includes(property)) {
          properties[property].options.nullable = true;
        }
        if (nullableDefaultEntity?.defaults[property]) {
          properties[property].options.default = nullableDefaultEntity?.defaults[property];
        }
      }

      const relationships = relationshipsFromMetadata.map((relation) => ({ ...relation }));

      for (const relation of relationships) {
        const relationKey = String(relation.propertyKey);

        if (nullableDefaultEntity?.nullables.includes(relationKey)) {
          relation.nullable = true;
        }
      }

      this.storage.add(entity, properties, relationships, hooks);
    }

    this.resolveManyToManyRelations();
  }

  private resolveManyToManyRelations(): void {
    for (const [entityClass, options] of this.storage.entries()) {
      for (const relation of options.relations) {
        if (relation.relation !== 'many-to-many') continue;

        const relatedEntity = this.storage.get(relation.entity() as Function);
        if (!relatedEntity) continue;

        // Auto-generate pivot table name if not provided
        if (!relation.pivotTable) {
          const tables = [options.tableName, relatedEntity.tableName].sort();
          relation.pivotTable = `${tables[0]}_${tables[1]}`;
        }

        // Auto-generate inverseJoinColumn if not provided
        if (!relation.inverseJoinColumn) {
          relation.inverseJoinColumn = `${relatedEntity.tableName}_id`;
        }

        // Ensure joinColumn uses the actual table name from storage
        if (relation.joinColumn === `${toSnakeCase(entityClass.name)}_id`) {
          relation.joinColumn = `${options.tableName}_id`;
        }
      }
    }
  }


  private getSourceFilePaths(): string[] {
    const projectRoot = process.cwd();
    const patterns = [
      '**/*.entity.ts',
      '**/entities/**/*.ts',
      '**/entity/**/*.ts',
      '**/*.entity.js',
      '**/entities/**/*.js',
      '**/entity/**/*.js',
      '!**/node_modules/**',
      '!**/test/**',
      '!**/tests/**',
      '!**/*.spec.ts',
      '!**/*.test.ts',
      '!**/*.spec.js',
      '!**/*.test.js',
      '!**/dist/**',
      '!**/build/**'
    ];

    try {
      return globby
        .sync(patterns, { cwd: projectRoot, gitignore: true, absolute: false })
        .map((filePath) => path.resolve(projectRoot, filePath))
    } catch (error) {
      console.error('Erro ao obter arquivos:', error);
      return [];
    }
  }
}
