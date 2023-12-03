import { CONTROLLER } from "../../constants"
import { Metadata } from "../../domain/Metadata"
import { ProviderScope } from "../../domain/provider-scope"


type ControllerOptions = {
  path?: string,
  scope?: ProviderScope,
  children?: any[],
}

export function Controller(options?: ControllerOptions): ClassDecorator {
  return (target) => {
    const controllers = Metadata.get(CONTROLLER, Reflect) || []
    controllers.push({provide: target, ...options})
    Metadata.set(CONTROLLER, controllers, Reflect)

    // registerController({provide: target, ...options})

    // options?.children && options.children.forEach((child: any[]) => {
    //   registerController({provide: child, parent: target})
    // })
  }
}
