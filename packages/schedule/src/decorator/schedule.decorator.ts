import { CronJobParams } from 'cron';
import { Metadata } from '@cheetah.js/core';
import { SCHEDULE_CRON_OPTIONS, SCHEDULER_NAME, SCHEDULER_TYPE } from '../utils/constants';
import { SchedulerType } from '../utils/scheduler-type.enum';
import { CronOptions } from '@cheetah.js/schedule';

/**
 * Creates a scheduled job.
 * @param cronTime The time to fire off your job. This can be in the form of cron syntax, a JS ```Date``` object or a Luxon ```DateTime``` object.
 * @param options Job execution options.
 */
export function Schedule(
  cronTime: CronJobParams['cronTime'],
  options: CronOptions = {},
): MethodDecorator {
  const name = options?.name;
  return (target, propertyKey) => {
    const anotherMetadata = Metadata.get(SCHEDULE_CRON_OPTIONS, Reflect) || [];

    Metadata.set(SCHEDULE_CRON_OPTIONS,
      [
        ...anotherMetadata,
        {
          options: {...options, cronTime},
          ...{name: name, methodName: propertyKey, target: target, type: SchedulerType.CRON},
        },
      ], Reflect);
  }
}