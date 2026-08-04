import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Container, ExecutionContext, Metadata, ObservabilityService } from "@carno.js/core";
import { SchedulerOrchestration } from "../src/scheduler-orchestration.service";
import { SchedulerRegistry } from "../src/scheduler.registry";
import { Schedule } from "../src/decorator/schedule.decorator";
import {
  SCHEDULE_CRON_OPTIONS,
  SCHEDULE_INTERVAL_OPTIONS,
  SCHEDULE_TIMEOUT_OPTIONS,
} from "../src/utils/constants";

const cronJobName = "scheduler-orchestration-test-cron";
const invocationFlag = "invoked";

const baselineCronMetadata = snapshotMetadata(SCHEDULE_CRON_OPTIONS);
const baselineIntervalMetadata = snapshotMetadata(SCHEDULE_INTERVAL_OPTIONS);
const baselineTimeoutMetadata = snapshotMetadata(SCHEDULE_TIMEOUT_OPTIONS);

class SampleScheduledService {
  public readonly events: string[] = [];

  @Schedule("* * * * * *", { name: cronJobName, disabled: true })
  async handle(): Promise<void> {
    this.events.push(invocationFlag);
  }
}

const sampleCronEntries = selectServiceEntries();

describe("SchedulerOrchestration", () => {
  beforeEach(() => {
    isolateScheduleMetadata();
  });

  it("should create orchestration instance", () => {
    const context = givenSchedulerOrchestration();

    expect(context.orchestration).toBeInstanceOf(SchedulerOrchestration);
    expect(context.registry).toBeInstanceOf(SchedulerRegistry);
  });

  it("should mount cron jobs on init", () => {
    const context = givenSchedulerOrchestration();

    context.orchestration.onApplicationInit();

    const cronJob = context.registry.getCronJob(cronJobName);
    expect(cronJob).toBeDefined();
  });

  it("creates isolated context for concurrent scheduled executions", async () => {
    const contexts: any[] = [];
    class ContextScheduledService {
      async handle(): Promise<void> {
        await Promise.resolve();
        contexts.push(ExecutionContext.get());
      }
    }

    const container = new Container();
    const registry = new SchedulerRegistry();
    container.register(ContextScheduledService);
    container.register({ token: SchedulerRegistry, useValue: registry });
    container.register({ token: Container, useValue: container });
    const orchestration = new SchedulerOrchestration(registry, container);

    const callback = (orchestration as any).bindMethod(
      { target: ContextScheduledService.prototype, methodName: "handle" },
      "interval",
      "heartbeat"
    );
    await Promise.all([callback(), callback()]);

    expect(contexts).toHaveLength(2);
    expect(contexts[0]).toMatchObject({ kind: "schedule", scheduleType: "interval", scheduleName: "heartbeat" });
    expect(contexts[0].requestId).not.toBe(contexts[1].requestId);
  });

  it("reports callback errors to stderr when no observability plugin is registered", async () => {
    class FailingScheduledService {
      async handle(): Promise<void> {
        throw new Error("scheduled failure");
      }
    }
    const container = new Container();
    const registry = new SchedulerRegistry();
    container.register(FailingScheduledService);
    container.register({ token: SchedulerRegistry, useValue: registry });
    container.register({ token: Container, useValue: container });
    const orchestration = new SchedulerOrchestration(registry, container);
    const callback = (orchestration as any).bindMethod(
      { target: FailingScheduledService.prototype, methodName: "handle" },
      "timeout",
      "failing-task"
    );

    const originalError = console.error;
    const errors: unknown[][] = [];
    console.error = ((...args: unknown[]) => { errors.push(args); }) as typeof console.error;
    try {
      await callback();
      expect(errors).toHaveLength(1);
      expect(String(errors[0][0])).toContain("Unhandled scheduled execution error");
    } finally {
      console.error = originalError;
    }
  });

  it("keeps reporting callback errors when the core no-op observability bridge is registered", async () => {
    class FailingScheduledService {
      async handle(): Promise<void> {
        throw new Error("scheduled failure");
      }
    }
    const container = new Container();
    const registry = new SchedulerRegistry();
    container.register(FailingScheduledService);
    container.register({ token: SchedulerRegistry, useValue: registry });
    container.register({ token: Container, useValue: container });
    container.register({ token: ObservabilityService, useValue: new ObservabilityService() });
    const orchestration = new SchedulerOrchestration(registry, container);
    const callback = (orchestration as any).bindMethod(
      { target: FailingScheduledService.prototype, methodName: "handle" },
      "timeout",
      "failing-task"
    );

    const originalError = console.error;
    const errors: unknown[][] = [];
    console.error = ((...args: unknown[]) => { errors.push(args); }) as typeof console.error;
    try {
      await callback();
      expect(errors).toHaveLength(1);
      expect(String(errors[0][0])).toContain("Unhandled scheduled execution error");
    } finally {
      console.error = originalError;
    }
  });
});

afterAll(() => {
  restoreMetadata(SCHEDULE_CRON_OPTIONS, baselineCronMetadata);
  restoreMetadata(SCHEDULE_INTERVAL_OPTIONS, baselineIntervalMetadata);
  restoreMetadata(SCHEDULE_TIMEOUT_OPTIONS, baselineTimeoutMetadata);
});

function snapshotMetadata(key: string) {
  const entries = Metadata.get(key, Reflect);

  if (!entries) {
    return [];
  }

  return [...entries];
}

function restoreMetadata(key: string, entries: any[]) {
  Metadata.set(key, [...entries], Reflect);
}

function selectServiceEntries() {
  const entries = Metadata.get(SCHEDULE_CRON_OPTIONS, Reflect) || [];

  return entries
    .filter(
      (entry: any) =>
        entry.methodName === "handle" &&
        entry.target === SampleScheduledService.prototype
    )
    .map((entry: any) => ({
      ...entry,
      options: { ...entry.options },
    }));
}

function isolateScheduleMetadata() {
  Metadata.set(SCHEDULE_CRON_OPTIONS, cloneEntries(sampleCronEntries), Reflect);
  Metadata.set(SCHEDULE_INTERVAL_OPTIONS, [], Reflect);
  Metadata.set(SCHEDULE_TIMEOUT_OPTIONS, [], Reflect);
}

function cloneEntries(entries: any[]) {
  return entries.map((entry: any) => ({
    ...entry,
    options: { ...entry.options },
  }));
}

function givenSchedulerOrchestration() {
  const container = new Container();
  const registry = new SchedulerRegistry();

  container.register(SampleScheduledService);
  container.register({ token: SchedulerRegistry, useValue: registry });
  container.register({ token: Container, useValue: container });

  const orchestration = new SchedulerOrchestration(registry, container);

  return {
    container,
    registry,
    orchestration,
  };
}
