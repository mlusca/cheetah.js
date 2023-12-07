import { Controller, Get, InjectorService, OnApplicationInit, TokenRouteWithProvider } from "@cheetah.js/core";
import { OpenAPIV3 } from "openapi-types";
import { SwaggerUIOptions } from "swagger-ui";

import { ClassDeclaration, Project } from 'ts-morph';

export const filterPaths = (
  paths: Record<string, any>,
  {
    excludeStaticFile = true,
    exclude = [],
  }: {
    excludeStaticFile: boolean;
    exclude: (string | RegExp)[];
  }
) => {
  const newPaths: Record<string, any> = {};

  for (const [key, value] of Object.entries(paths))
    if (
      !exclude.some((x) => {
        if (typeof x === "string") return key === x;

        return x.test(key);
      }) &&
      !key.includes("/swagger") &&
      !key.includes("*") &&
      (excludeStaticFile ? !key.includes(".") : true)
    ) {
      Object.keys(value).forEach((method) => {
        const schema = value[method];

        if (key.includes("{")) {
          if (!schema.parameters) schema.parameters = [];

          schema.parameters = [
            ...key
              .split("/")
              .filter(
                (x) =>
                  x.startsWith("{") &&
                  !schema.parameters.find(
                    (params: Record<string, any>) =>
                      params.in === "path" &&
                      params.name === x.slice(1, x.length - 1)
                  )
              )
              .map((x) => ({
                schema: { type: "string" },
                in: "path",
                name: x.slice(1, x.length - 1),
                required: true,
              })),
            ...schema.parameters,
          ];
        }

        if (!schema.responses)
          schema.responses = {
            200: {},
          };
      });

      newPaths[key] = value;
    }

  return newPaths;
};

// export function convertToOpenApiRoute(routes: [string, string, TokenRouteWithProvider][]){
//   const newRoutes: Record<string, any> = {};
//
//   for (const [key, value] of Object.entries(routes)){
//     const [method, path, route] = value;
//     if (!newRoutes[path]) newRoutes[path] = {};
//     newRoutes[path][method] = route;
//   }
//
//   const project = new Project();
//
//   return newRoutes;
// }

export interface CheetahSwaggerConfig {
  /**
   * Customize Swagger config, refers to Swagger 2.0 config
   *
   * @see https://swagger.io/specification/v2/
   */
  documentation?: Omit<
    Partial<OpenAPIV3.Document>,
    | "x-express-openapi-additional-middleware"
    | "x-express-openapi-validation-strict"
  >;
  /**
   * Version to use for swagger cdn bundle
   *
   * @see unpkg.com/swagger-ui-dist
   *
   * @default 4.18.2
   */
  version?: string;
  /**
   * Determine if Swagger should exclude static files.
   *
   * @default true
   */
  excludeStaticFile?: boolean;
  /**
   * The endpoint to expose Swagger
   *
   * @default '/swagger'
   */
  path?: string;
  /**
   * Paths to exclude from Swagger endpoint
   *
   * @default []
   */
  exclude?: string | RegExp | (string | RegExp)[];
  /**
   * Options to send to SwaggerUIBundle
   * Currently, options that are defined as functions such as requestInterceptor
   * and onComplete are not supported.
   */
  swaggerOptions?: Omit<
    Partial<SwaggerUIOptions>,
    | "dom_id"
    | "dom_node"
    | "spec"
    | "url"
    | "urls"
    | "layout"
    | "pluginsOptions"
    | "plugins"
    | "presets"
    | "onComplete"
    | "requestInterceptor"
    | "responseInterceptor"
    | "modelPropertyMacro"
    | "parameterMacro"
  >;
  /**
   * Custom Swagger CSS
   */
  theme?:
    | string
    | {
        light: string;
        dark: string;
      };
  /**
   * Using poor man dark mode 😭
   */
  autoDarkMode?: boolean;
}

let path = "/swagger";
export let config: CheetahSwaggerConfig = {};

export function useConfig(newConfig: CheetahSwaggerConfig) {
  config = newConfig;
}

@Controller()
export class SwaggerService {
  private routes: OpenAPIV3.PathsObject<{}, {}> = {};
  constructor(private injector: InjectorService) {
    const version = config.version || "5.9.0";

    config = {
      documentation: {},
      version: "5.9.0",
      excludeStaticFile: true,
      path: "/swagger",
      exclude: [],
      swaggerOptions: {},
      theme: `https://unpkg.com/swagger-ui-dist@${version}/swagger-ui.css`,
      autoDarkMode: true,
      ...config,
    };
    path = config.path;

    this.setDocumentation(config.documentation);
  }

  setDocumentation(documentation: CheetahSwaggerConfig["documentation"]): void {
    const info = {
      title: "Cheetah.js",
      description: "Cheetah.js API documentation",
      version: "0.0.0",
      ...config.documentation?.info,
    };

    config.documentation = {
      ...config.documentation,
      info,
    };
  }

  @Get(`${path}`)
  ui() {
    const relativePath = config.path.startsWith("/")
      ? config.path
      : `/${config.path}`;

    const combinedSwaggerOptions = {
      url: `${relativePath}/json`,
      dom_id: "#swagger-ui",
      ...config.swaggerOptions,
    };
    const stringifiedSwaggerOptions = JSON.stringify(
      combinedSwaggerOptions,
      (_key, value) => {
        if (typeof value == "function") {
          return undefined;
        } else {
          return value;
        }
      }
    );

    return new Response(
      `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${config.documentation.info.title}</title>
<meta
name="description"
content="${config.documentation.info.description}"
/>
<meta
name="og:description"
content="${config.documentation.info.description}"
/>
${
  config.autoDarkMode && typeof config.theme === "string"
    ? `
<style>
@media (prefers-color-scheme: dark) {
  body {
      background-color: #222;
      color: #faf9a;
  }
  .swagger-ui {
      filter: invert(92%) hue-rotate(180deg);
  }

  .swagger-ui .microlight {
      filter: invert(100%) hue-rotate(180deg);
  }
}
</style>`
    : ""
}
${
  typeof config.theme === "string"
    ? `<link rel="stylesheet" href="${config.theme}" />`
    : `<link rel="stylesheet" media="(prefers-color-scheme: light)" href="${config.theme.light}" />
<link rel="stylesheet" media="(prefers-color-scheme: dark)" href="${config.theme.dark}" />`
}
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@${
        config.version
      }/swagger-ui-bundle.js" crossorigin></script>
<script>
window.onload = () => {
  window.ui = SwaggerUIBundle(${stringifiedSwaggerOptions});
};
</script>
</body>
</html>`,
      {
        headers: {
          "content-type": "text/html; charset=utf8",
        },
      }
    );
  }

  @OnApplicationInit()
  onApplicationInit() {
    const swaggerObject = {
      openapi: '3.0.0',
      info: {
        title: 'API Title',
        version: '1.0.0',
      },
      paths: {},
    };
    const project = new Project({skipLoadingLibFiles: true, tsConfigFilePath: process.cwd() + '/tsconfig.json'});
    const sourceFiles = project.getSourceFiles()
      /**
       * Search controllers classes
       */
      // Percorra todos os arquivos de origem
      for (const sourceFile of sourceFiles) {
        // Obtenha todas as classes no arquivo de origem
        const classes = sourceFile.getClasses();

        // Percorra todas as classes
        for (const cls of classes) {
          // Verifique se a classe tem um decorador 'Controller'
          const controllerDecorator = cls.getDecorator('Controller');
          if (controllerDecorator) {
            // Obtenha o prefixo do controlador do decorador 'Controller'
            const controllerPrefix = controllerDecorator.getArguments()[0]?.getText();

            // Percorra todos os métodos na classe
            for (const method of cls.getMethods()) {
              // Verifique se o método tem um decorador HTTP
              const httpDecorator = method.getDecorators().find(decorator => ['Get', 'Post', 'Put', 'Delete'].includes(decorator.getName()));
              if (httpDecorator) {
                // Obtenha o caminho da rota do decorador HTTP
                let routePath = httpDecorator.getArguments()[0]?.getText();
                routePath = controllerPrefix + routePath;

                // Obtenha o tipo de método HTTP do nome do decorador
                const httpMethod = httpDecorator.getName().toLowerCase();

                // Adicione a rota ao objeto Swagger
                if (!swaggerObject.paths[routePath]) {
                  swaggerObject.paths[routePath] = {};
                }
                swaggerObject.paths[routePath][httpMethod] = {
                  summary: method.getJsDocs().map(jsDoc => jsDoc.getComment()).join('\n'),
                  // Adicione mais propriedades conforme necessário
                };
              }
            }
          }
        }
      }

      console.log(swaggerObject)
  }

  private parseRoutesMethods(classDeclaration: ClassDeclaration) {
    const methods = classDeclaration.getMethods().filter(method => {
      const decorator = method.getDecorator('Get') || method.getDecorator('Post') || method.getDecorator('Put') || method.getDecorator('Delete') || method.getDecorator('Patch');
      if (decorator) {
        return true;
      }
      return false;
    });

    methods.forEach(method => {
      const decorator = method.getDecorator('Get') || method.getDecorator('Post') || method.getDecorator('Put') || method.getDecorator('Delete') || method.getDecorator('Patch');
      if (decorator) {
        const methodType = decorator.getName().toLowerCase();
        const summary = method.getJsDocs().map(jsDoc => jsDoc.getComment()).join('\n');
        const response = method.getReturnType().getText();
        decorator.getArguments()
        const parameters = method.getParameters().map(parameter => {
          if (parameter.getDecorator('Body') || parameter.getDecorator('Query')) {
            const type = parameter.getType().getText();
            const name = parameter.getName();
            return {
              name: name,
              in: type === 'Body' ? 'body' : 'query',
              required: true,
              schema: {
                type: type,
              }
            }
          }
        });
        const route = {
          path: path,
          method: methodType,
          controller: classDeclaration.getName(),
          action: method.getName(),
          middleware: [],
          provider: classDeclaration.getName(),
        };
        console.log(path, methodType)
        this.routes[path] = {
          ...this.routes[path],
          [methodType]: {
            summary: summary,
            parameters: parameters,
          }
        };
      }
    });
  }

  @Get(`${path}/json`)
  getDocumentation() {
    // console.log(convertToOpenApiRoute(this.injector.router.history), 'lu')
    // const routes = t
    return {
      openapi: "3.0.3",
      ...{
        ...config.documentation,
        info: {
          title: "Cheetah.js Documentation",
          description: "Development documentation",
          version: "0.0.0",
          ...config.documentation.info,
        },
      },
      paths: this.routes,
      // paths: filterPaths(
      //   {},
      //   {
      //     excludeStaticFile: config.excludeStaticFile,
      //     exclude: Array.isArray(config.exclude)
      //       ? config.exclude
      //       : [config.exclude],
      //   }
      // ),
      components: {
        ...config.documentation.components,
        schemas: {
          // ...app.definitions?.type,
          ...config.documentation.components?.schemas,
        },
      },
    } satisfies OpenAPIV3.Document;
  }
}
