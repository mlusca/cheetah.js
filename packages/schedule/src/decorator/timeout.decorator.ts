import {
    SCHEDULE_INTERVAL_OPTIONS,
    SCHEDULE_TIMEOUT_OPTIONS,
    SCHEDULER_NAME,
    SCHEDULER_TYPE,
} from '../utils/constants';
import { SchedulerType } from '../utils/scheduler-type.enum';
import { isString, Metadata } from '@cheetah.js/core';

/**
 * Schedules an timeout (`setTimeout`).
 */
export function Timeout(timeout: number): MethodDecorator;
/**
 * Schedules an timeout (`setTimeout`).
 */
export function Timeout(name: string, timeout: number): MethodDecorator;
/**
 * Schedules an timeout (`setTimeout`).
 */
export function Timeout(
    nameOrTimeout: string | number,
    timeout?: number,
): MethodDecorator {
    const [name, timeoutValue] = isString(nameOrTimeout)
        ? [nameOrTimeout, timeout]
        : [undefined, nameOrTimeout];

    return function (target, propertyKey) {
        const anotherMetadata = Metadata.get(SCHEDULE_TIMEOUT_OPTIONS, Reflect) || [];
        Metadata.set(SCHEDULE_TIMEOUT_OPTIONS,
          [
            ...anotherMetadata,
              {
                  name: name, methodName: propertyKey, target: target, type: SchedulerType.INTERVAL, timeout: timeoutValue,
              },
          ], Reflect);
    }
}