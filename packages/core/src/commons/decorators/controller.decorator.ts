import { ProviderScope, registerController } from '@cheetah.js/core'

type ControllerOptions = {
  path?: string,
  scope?: ProviderScope,
}

export function Controller(options?: ControllerOptions): ClassDecorator {
  return (target) => {
    registerController({provide: target, ...options})
  }
}
