import { Metadata } from "../../domain/Metadata";
import { TokenRoute } from "../../container/ContainerConfiguration";
import { CONTROLLER_ROUTES, ROUTE_PARAM } from "../../constants";
import { Context } from "../../domain/Context";

const createMethodDecorator = (methodType: string) => {
  return (path: string = ""): MethodDecorator => {
    return (target, propertyKey) => {
      const routes: TokenRoute[] = [];
      if (!path.startsWith("/")) {
        path = `/${path}`;
      }

      if (Metadata.has(CONTROLLER_ROUTES, target)) {
        routes.push(...Metadata.get(CONTROLLER_ROUTES, target));
      }

      routes.push({
        method: methodType,
        path,
        methodName: propertyKey.toString(),
        middlewares: [],
      });
      Metadata.set(CONTROLLER_ROUTES, routes, target);
    };
  };
};

export function createParamDecorator(
  func: (context: Context, data?: any) => any
) {
  return (data?: any): ParameterDecorator =>
    (target, propertyKey, parameterIndex) => {
      const existingArgs: Record<number, any> =
        Metadata.get(ROUTE_PARAM, target.constructor, propertyKey) || {};
      existingArgs[parameterIndex] = { fun: func, param: data };

      Metadata.set(ROUTE_PARAM, existingArgs, target.constructor, propertyKey);
    };
}

export const Body = createParamDecorator((context: Context, data: string) =>
  data ? context.body[data] : context.body || {}
);
export const Query = createParamDecorator((context: Context, data: string) =>
  data ? context.query[data] : context.query || {}
);
export const Param = createParamDecorator((context: Context, data: string) =>
  data ? context.param[data] : null
);
export const Req = createParamDecorator((context: Context) => context.req);
export const Headers = createParamDecorator((context: Context, data: string) =>
  data ? context.headers[data] : context.headers || {}
);
export const Locals = createParamDecorator(
  (context: Context) => context.locals || {}
);
export const Get = createMethodDecorator("GET");
export const Post = createMethodDecorator("POST");
export const Put = createMethodDecorator("PUT");
export const Delete = createMethodDecorator("DELETE");
