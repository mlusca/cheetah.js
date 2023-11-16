import { ProviderScope, registerController } from '@cheetah.js/core'

type ControllerOptions = {
  path?: string,
  scope?: ProviderScope,
  children?: any[],
}

export function Controller(options?: ControllerOptions): ClassDecorator {
  return (target) => {
    registerController({provide: target, ...options})

    options?.children && options.children.forEach((child: any[]) => {
      registerController({provide: child, parent: target})
    })
  }
}
