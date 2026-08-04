import {
    Container,
    ExecutionContext,
    ObservabilityService,
    Metadata,
    OnApplicationInit,
    OnApplicationShutdown,
    Service,
} from '@carno.js/core';
import { CronOptions } from './utils/cron-options';
import { CronCallback, CronJob, CronJobParams } from 'cron';
import { SchedulerRegistry } from './scheduler.registry';
import { v4 } from 'uuid';
import {
    SCHEDULE_CRON_OPTIONS,
    SCHEDULE_INTERVAL_OPTIONS,
    SCHEDULE_TIMEOUT_OPTIONS,
} from './utils/constants';

@Service()
export class SchedulerOrchestration {

    private readonly cronJobs: Record<string, any> = {};
    private readonly timeouts: Record<string, any> = {};
    private readonly intervals: Record<string, any> = {};

    constructor(
        private readonly schedulerRegistry: SchedulerRegistry,
        private readonly container: Container,
    ) {}

    @OnApplicationInit()
    onApplicationInit() {
        this.discoverSchedulers();
        this.mountTimeouts();
        this.mountIntervals();
        this.mountCron();
    }

    @OnApplicationShutdown()
    onApplicationShutdown() {
        this.clearTimeouts();
        this.clearIntervals();
        this.closeCronJobs();
    }

    mountIntervals() {
        const intervalKeys = Object.keys(this.intervals);
        intervalKeys.forEach((key) => {
            const options = this.intervals[key];
            const intervalRef = setInterval(options.target, options.timeout);

            options.ref = intervalRef;
            this.schedulerRegistry.addInterval(key, intervalRef);
        });
    }

    mountTimeouts() {
        const timeoutKeys = Object.keys(this.timeouts);
        timeoutKeys.forEach((key) => {
            const options = this.timeouts[key];
            const timeoutRef = setTimeout(options.target, options.timeout);

            options.ref = timeoutRef;
            this.schedulerRegistry.addTimeout(key, timeoutRef);
        });
    }

    mountCron() {
        const cronKeys = Object.keys(this.cronJobs);

        cronKeys.forEach((key) => {
            const { options, target } = this.cronJobs[key];

            const cronJob = CronJob.from({
                ...options,
                onTick: target as CronCallback<null, false>,
                start: !(options.disabled ?? false)
            });

            this.cronJobs[key].ref = cronJob;
            this.schedulerRegistry.addCronJob(key, cronJob);
        });
    }

    clearTimeouts() {
        this.schedulerRegistry.getTimeouts().forEach((key) =>
          this.schedulerRegistry.deleteTimeout(key),
        );
    }

    clearIntervals() {
        this.schedulerRegistry.getIntervals().forEach((key) =>
          this.schedulerRegistry.deleteInterval(key),
        );
    }

    closeCronJobs() {
        Array.from(this.schedulerRegistry.getCronJobs().keys()).forEach((key) =>
          this.schedulerRegistry.deleteCronJob(key),
        );
    }

    addTimeout(methodRef: Function, timeout: number, name: string = v4()) {
        this.timeouts[name] = {
            target: methodRef,
            timeout,
        };
    }

    addInterval(methodRef: Function, timeout: number, name: string = v4()) {
        this.intervals[name] = {
            target: methodRef,
            timeout,
        };
    }

    addCron(
      methodRef: Function,
      options: CronOptions & Record<'cronTime', CronJobParams['cronTime']>,
    ) {
        const name = options.name || v4();
        this.cronJobs[name] = {
            target: methodRef,
            options,
        };
    }

    private discoverSchedulers() {
        const schedulers = Metadata.get(SCHEDULE_CRON_OPTIONS, Reflect) || [];
        const interval = Metadata.get(SCHEDULE_INTERVAL_OPTIONS, Reflect) || [];
        const timeout = Metadata.get(SCHEDULE_TIMEOUT_OPTIONS, Reflect) || [];

        schedulers.forEach((scheduler: any) => {
            this.addCron(this.bindMethod(scheduler, 'cron', scheduler.options.name), scheduler.options);
        });

        interval.forEach((scheduler: any) => {
            this.addInterval(this.bindMethod(scheduler, 'interval', scheduler.name), scheduler.timeout, scheduler.name);
        });

        timeout.forEach((scheduler: any) => {
            this.addTimeout(this.bindMethod(scheduler, 'timeout', scheduler.name), scheduler.timeout, scheduler.name);
        });
    }

    private bindMethod(scheduler: any, scheduleType: 'cron' | 'interval' | 'timeout', scheduleName?: string) {
        const instance = this.resolveInstance(scheduler.target);
        const method = instance[scheduler.methodName].bind(instance);

        return async (...args: any[]) => {
            const context = {
                requestId: ExecutionContext.createRequestId(),
                kind: 'schedule' as const,
                scheduleType,
                scheduleName: scheduleName || scheduler.methodName
            };

            return ExecutionContext.run(context, async () => {
                try {
                    return await method(...args);
                } catch (error) {
                    if (!this.reportExecutionError(context, error)) {
                        console.error('Unhandled scheduled execution error:', error);
                    }
                    // Scheduler callbacks have no caller to receive a rejection.
                    // Reporting and consuming it prevents unhandled rejections.
                    return undefined;
                }
            });
        };
    }

    private reportExecutionError(context: any, error: unknown): boolean {
        if (!this.container.has(ObservabilityService)) {
            return false;
        }

        const observability = this.container.get(ObservabilityService);
        if (!observability.enabled) {
            return false;
        }

        try {
            observability.onExecutionError(context, error);
            return true;
        } catch (observerError) {
            try {
                console.error('Observability scheduled error reporting failed:', observerError);
            } catch {
                // Observability must never interfere with scheduled execution.
            }
            return false;
        }
    }

    private resolveInstance(target: any) {
        const token = target.constructor;
        return this.container.get(token);
    }
}
