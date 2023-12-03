import { CONTROLLER_EVENTS } from "../constants"
import { Metadata } from "../domain"
import { OnEvent, EventType } from "./on-event"

export function OnApplicationInit(): MethodDecorator {
    return (target, propertyKey: any) => {
        const anotherEvents: OnEvent[] = Metadata.get(CONTROLLER_EVENTS, Reflect) || []
        anotherEvents.push({ methodName: propertyKey, eventName: EventType.OnApplicationInit, target: target.constructor })

        Metadata.set(CONTROLLER_EVENTS, anotherEvents, Reflect)
    }
}

export function OnApplicationShutdown(): MethodDecorator {
    return (target, propertyKey: any) => {
        const anotherEvents: OnEvent[] = Metadata.get(CONTROLLER_EVENTS, Reflect) || []
        anotherEvents.push({ methodName: propertyKey, eventName: EventType.OnApplicationShutdown, target: target.constructor })

        Metadata.set(CONTROLLER_EVENTS, anotherEvents, Reflect)
    }
}

export function OnApplicationBoot() {
    return (target: Function, propertyKey: any) => {
        const anotherEvents: OnEvent[] = Metadata.get(CONTROLLER_EVENTS, Reflect) || []
        anotherEvents.push({ methodName: propertyKey, eventName: EventType.OnApplicationBoot, target: target.constructor })

        Metadata.set(CONTROLLER_EVENTS, anotherEvents, Reflect)
    }
}