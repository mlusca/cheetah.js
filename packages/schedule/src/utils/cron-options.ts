/**
 * @ref https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/cron/index.d.ts
 */
export type CronOptions = {
    /**
     * Specify the name of your cron job. This will allow to inject your cron job reference through `@InjectCronRef`.
     */
    name?: string;

    /**
     * Specify the timezone for the execution. This will modify the actual time relative to your timezone. If the timezone is invalid, an error is thrown. You can check all timezones available at [Moment Timezone Website](http://momentjs.com/timezone/). Probably don't use both ```timeZone``` and ```utcOffset``` together or weird things may happen.
     */
    timeZone?: unknown;
    /**
     * This allows you to specify the offset of your timezone rather than using the ```timeZone``` param. Probably don't use both ```timeZone``` and ```utcOffset``` together or weird things may happen.
     */
    utcOffset?: unknown;

    /**
     * If you have code that keeps the event loop running and want to stop the node process when that finishes regardless of the state of your cronjob, you can do so making use of this parameter. This is off by default and cron will run as if it needs to control the event loop. For more information take a look at [timers#timers_timeout_unref](https://nodejs.org/api/timers.html#timers_timeout_unref) from the NodeJS docs.
     */
    unrefTimeout?: boolean;

    /**
     * This flag indicates whether the job will be executed at all.
     * @default false
     */
    disabled?: boolean;
} & (
        // make timeZone & utcOffset mutually exclusive
        | {
            timeZone?: string;
            utcOffset?: never;
        }
        | {
            timeZone?: never;
            utcOffset?: number;
        }
    );