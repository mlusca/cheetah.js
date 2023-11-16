import { CheetahMiddleware, CONTROLLER_MIDDLEWARES, ROUTE_MIDDLEWARES } from '@cheetah.js/core';


export function Middleware(...middlewares: (new () => CheetahMiddleware)[]): ClassDecorator & MethodDecorator {
  return (target: any, propertyKey?: any) => {
    let definedMiddlewares: any[]
    if (propertyKey)
      definedMiddlewares = getMethodMiddlewares(target, propertyKey.toString())
    else
      definedMiddlewares = getControllerMiddlewares(target)

    definedMiddlewares.push(...middlewares)

    if (propertyKey)
      setMethodMiddlewares(target, propertyKey.toString(), definedMiddlewares)
    else
      setControllerMiddlewares(target, definedMiddlewares)
  }
}

function getControllerMiddlewares(target: any) {
  return Reflect.getMetadata(CONTROLLER_MIDDLEWARES, target) || [];
}

function setControllerMiddlewares(target: any, middlewares: any) {
  Reflect.defineMetadata(CONTROLLER_MIDDLEWARES, middlewares, target);
}

function getMethodMiddlewares(target: any, methodName: any) {
  return Reflect.getMetadata(ROUTE_MIDDLEWARES, target.constructor, methodName) || [];
}

function setMethodMiddlewares(target: any, methodName: any, middlewares: any) {
  Reflect.defineMetadata(ROUTE_MIDDLEWARES, middlewares, target.constructor, methodName);
}