import { Container, Controller, Get, InjectorService } from "@cheetah.js/core";
import { OpenAPIV3 } from "openapi-types";
import { SwaggerUIOptions } from "swagger-ui";

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

@Controller()
export class SwaggerService {
  private injector;

  constructor(private config: CheetahSwaggerConfig) {
    const version = this.config.version || "5.9.0";

    this.config = {
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
    path = this.config.path;

    this.setDocumentation(this.config.documentation);
  }

  setDocumentation(documentation: CheetahSwaggerConfig["documentation"]): void {
    const info = {
      title: "Cheetah.js",
      description: "Cheetah.js API documentation",
      version: "0.0.0",
      ...this.config.documentation?.info,
    };

    this.config.documentation = {
      ...this.config.documentation,
      info,
    };
  }

  @Get(`${path}`)
  onApplicationInit() {
    const relativePath = this.config.path.startsWith("/")
      ? this.config.path
      : `/${this.config.path}`;

    const combinedSwaggerOptions = {
      url: `${relativePath}/json`,
      dom_id: "#swagger-ui",
      ...this.config.swaggerOptions,
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
<title>${this.config.documentation.info.title}</title>
<meta
name="description"
content="${this.config.documentation.info.description}"
/>
<meta
name="og:description"
content="${this.config.documentation.info.description}"
/>
${
  this.config.autoDarkMode && typeof this.config.theme === "string"
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
  typeof this.config.theme === "string"
    ? `<link rel="stylesheet" href="${this.config.theme}" />`
    : `<link rel="stylesheet" media="(prefers-color-scheme: light)" href="${this.config.theme.light}" />
<link rel="stylesheet" media="(prefers-color-scheme: dark)" href="${this.config.theme.dark}" />`
}
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@${
        this.config.version
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

  @Get(`${path}/json`)
  getDocumentation() {
    // const routes = t
    return {
      openapi: "3.0.3",
      ...{
        ...this.config.documentation,
        info: {
          title: "Cheetah.js Documentation",
          description: "Development documentation",
          version: "0.0.0",
          ...this.config.documentation.info,
        },
      },
      paths: filterPaths(
        {},
        {
          excludeStaticFile: this.config.excludeStaticFile,
          exclude: Array.isArray(this.config.exclude)
            ? this.config.exclude
            : [this.config.exclude],
        }
      ),
      components: {
        ...this.config.documentation.components,
        schemas: {
          // @ts-ignore
          ...app.definitions?.type,
          ...this.config.documentation.components?.schemas,
        },
      },
    } satisfies OpenAPIV3.Document;
  }
}
