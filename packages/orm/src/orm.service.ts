import { Metadata, OnApplicationInit, Service } from '@cheetah.js/core';
import { EntityStorage, Property } from './domain/entities';
import { ENTITIES, EVENTS_METADATA, PROPERTIES_METADATA, PROPERTIES_RELATIONS } from './constants';
import { Project, SyntaxKind } from 'ts-morph';
import { Orm } from './orm';
import * as globby from 'globby';


@Service()
export class OrmService {
  private allEntities = new Map<string, { nullables: string[], defaults: { [key: string]: any } }>();

  constructor(private orm: Orm, private storage: EntityStorage, entityFile?: string) {
    console.log('Preparing entities...')
    const files = new Project({skipLoadingLibFiles: true}).addSourceFilesAtPaths(entityFile ?? this.getSourceFilePaths())
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
                  defaults[propertyName] = () => initializer.getText();
                  break;
              }
            }

            this.allEntities.set(classDeclaration.getName() as string, {nullables, defaults});
          });
        }
      });
    })
  }

  @OnApplicationInit()
  async onInit(customConfig: any = {}) {

    const configFile = globby.sync('cheetah.config.ts', {absolute: true});
    if (configFile.length === 0) {
      console.log('No config file found!')
      return;
    }

    const config = await import(configFile[0]);
    const setConfig = Object.keys(customConfig).length > 0 ? customConfig :  config.default;

    this.orm.setConnection(setConfig);
    await this.orm.connect();

    if (typeof config.default.entities === 'string') {
      const files = globby.sync([config.default.entities, '!node_modules'], {gitignore: true, absolute: true})

      for (const file of files) {
        await import(file)
      }
    }

    const entities = Metadata.get(ENTITIES, Reflect);

    if (!entities) {
      console.log('No entities found!')
      return;
    }

    for (const entity of entities) {
      const nullableDefaultEntity = this.allEntities.get(entity.target.name);
      const properties: { [key: string]: Property } = Metadata.get(PROPERTIES_METADATA, entity.target);
      const relationship = Metadata.get(PROPERTIES_RELATIONS, entity.target);
      const hooks = Metadata.get(EVENTS_METADATA, entity.target)

      for (const property in properties) {
        if (nullableDefaultEntity?.nullables.includes(property)) {
          properties[property].options.nullable = true;
        }
        if (nullableDefaultEntity?.defaults[property]) {
          properties[property].options.default = nullableDefaultEntity?.defaults[property];
        }
      }

      this.storage.add(entity, properties, relationship, hooks);
    }
    console.log('Entities prepared!')
  }


  private getSourceFilePaths(): string[] {
    const projectRoot = process.cwd(); // Ajuste conforme a estrutura do seu projeto

    const getAllFiles = (dir: string): string[] => {
      const patterns = [`${dir}/**/*.(ts|js)`, "!**/node_modules/**"];

      try {
        return globby.sync(patterns, {gitignore: true});
      } catch (error) {
        console.error('Erro ao obter arquivos:', error);
        return [];
      }
    }

    // Filtra os arquivos pelo padrão de nomenclatura
    return getAllFiles(projectRoot);
  }
}