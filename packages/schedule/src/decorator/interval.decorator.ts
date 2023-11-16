import { isString, Metadata } from '@cheetah.js/core';
import { SCHEDULE_CRON_OPTIONS, SCHEDULE_INTERVAL_OPTIONS, SCHEDULER_NAME, SCHEDULER_TYPE } from '../utils/constants';
import { SchedulerType } from '../utils/scheduler-type.enum';

/**
 * Schedules an interval (`setInterval`).
 */
export function Interval(timeout: number): MethodDecorator;
/**
 * Schedules an interval (`setInterval`).
 */
export function Interval(name: string, timeout: number): MethodDecorator;
/**
 * Schedules an interval (`setInterval`).
 */
export function Interval(
    nameOrTimeout: string | number,
    timeout?: number,
): MethodDecorator {
    const [name, intervalTimeout] = isString(nameOrTimeout)
        ? [nameOrTimeout, timeout]
        : [undefined, nameOrTimeout];

    return (target, propertyKey) => {
        const anotherMetadata = Metadata.get(SCHEDULE_INTERVAL_OPTIONS, Reflect) || [];
        Metadata.set(SCHEDULE_INTERVAL_OPTIONS,
          [
            ...anotherMetadata,
              {
                  name: name, methodName: propertyKey, target: target, type: SchedulerType.INTERVAL, timeout: intervalTimeout,
              },
          ], Reflect);
    };
}