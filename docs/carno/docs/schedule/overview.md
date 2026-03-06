---
sidebar_position: 1
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Schedule

Schedule recurring tasks easily using Cron expressions, intervals, or timeouts.

## Installation

<Tabs groupId="os">
  <TabItem value="mac" label="macOS / Linux">
    ```bash
    bun install @carno.js/schedule
    ```
  </TabItem>
  <TabItem value="windows" label="Windows">
    ```bash
    bun install "@carno.js/schedule"
    ```
  </TabItem>
</Tabs>

## Setup

Register the module in your application.

```ts
import { Carno } from '@carno.js/core';
import { CarnoScheduler } from '@carno.js/schedule';

const app = new Carno()
  .use(CarnoScheduler);

await app.listen(3000);
```

## Decorators

### `@Schedule(cronTime, options?)`

Schedules a method using a **Cron expression**. The method runs repeatedly according to the cron schedule.

```ts
import { Service } from '@carno.js/core';
import { Schedule, CronExpression } from '@carno.js/schedule';

@Service()
export class TasksService {

  @Schedule('0 * * * *')
  handleEveryHour() {
    console.log('Runs at the start of every hour');
  }

  // Using the CronExpression helper
  @Schedule(CronExpression.EVERY_5_SECONDS)
  handleEvery5Seconds() {
    console.log('Runs every 5 seconds');
  }

  // With options
  @Schedule(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'nightly-cleanup', timeZone: 'America/Sao_Paulo' })
  handleNightlyCleanup() {
    console.log('Runs every day at midnight in São Paulo');
  }
}
```

**Options** (`CronOptions`):

| Option | Type | Description |
|--------|------|-------------|
| `name` | `string` | Name for the job, used to retrieve it from `SchedulerRegistry`. |
| `timeZone` | `string` | Timezone for execution (e.g. `'America/Sao_Paulo'`). Cannot be used together with `utcOffset`. |
| `utcOffset` | `number` | UTC offset in minutes instead of a timezone name. Cannot be used together with `timeZone`. |
| `disabled` | `boolean` | When `true`, the job is registered but will not run. Defaults to `false`. |
| `unrefTimeout` | `boolean` | Allows the Node.js process to exit even if the job is still scheduled. Defaults to `false`. |

---

### `@Interval(timeout)` / `@Interval(name, timeout)`

Schedules a method using `setInterval`. The method runs repeatedly at a fixed millisecond interval.

```ts
import { Service } from '@carno.js/core';
import { Interval } from '@carno.js/schedule';

@Service()
export class TasksService {

  // Anonymous interval – runs every 10 seconds
  @Interval(10_000)
  handleEvery10Seconds() {
    console.log('Called every 10 seconds');
  }

  // Named interval – can be managed via SchedulerRegistry
  @Interval('heartbeat', 5_000)
  handleHeartbeat() {
    console.log('Heartbeat every 5 seconds');
  }
}
```

---

### `@Timeout(timeout)` / `@Timeout(name, timeout)`

Schedules a method using `setTimeout`. The method runs **once** after the specified delay in milliseconds.

```ts
import { Service } from '@carno.js/core';
import { Timeout } from '@carno.js/schedule';

@Service()
export class TasksService {

  // Anonymous timeout – runs once after 5 seconds
  @Timeout(5_000)
  handleOnce() {
    console.log('Called once after 5 seconds');
  }

  // Named timeout – can be managed via SchedulerRegistry
  @Timeout('startup-check', 3_000)
  handleStartupCheck() {
    console.log('Startup check after 3 seconds');
  }
}
```

---

## CronExpression

`CronExpression` is a built-in enum with ready-to-use cron expressions. Import and use it instead of writing raw cron strings.

```ts
import { CronExpression } from '@carno.js/schedule';

@Schedule(CronExpression.EVERY_DAY_AT_NOON)
handleDailyReport() { ... }
```

### Available expressions

#### Seconds

| Constant | Cron | Description |
|----------|------|-------------|
| `EVERY_SECOND` | `* * * * * *` | Every second |
| `EVERY_5_SECONDS` | `*/5 * * * * *` | Every 5 seconds |
| `EVERY_10_SECONDS` | `*/10 * * * * *` | Every 10 seconds |
| `EVERY_30_SECONDS` | `*/30 * * * * *` | Every 30 seconds |

#### Minutes

| Constant | Cron | Description |
|----------|------|-------------|
| `EVERY_MINUTE` | `*/1 * * * *` | Every minute |
| `EVERY_5_MINUTES` | `0 */5 * * * *` | Every 5 minutes |
| `EVERY_10_MINUTES` | `0 */10 * * * *` | Every 10 minutes |
| `EVERY_30_MINUTES` | `0 */30 * * * *` | Every 30 minutes |

#### Hours

| Constant | Description |
|----------|-------------|
| `EVERY_HOUR` | Every hour |
| `EVERY_2_HOURS` | Every 2 hours |
| `EVERY_3_HOURS` | Every 3 hours |
| `EVERY_4_HOURS` | Every 4 hours |
| `EVERY_6_HOURS` | Every 6 hours |
| `EVERY_8_HOURS` | Every 8 hours |
| `EVERY_12_HOURS` | Every 12 hours |

#### Specific times (daily)

| Constant | Description |
|----------|-------------|
| `EVERY_DAY_AT_1AM` … `EVERY_DAY_AT_11PM` | Daily at the given hour |
| `EVERY_DAY_AT_NOON` | Daily at 12:00 PM |
| `EVERY_DAY_AT_MIDNIGHT` | Daily at 12:00 AM |

#### Weekdays (Monday–Friday)

| Constant | Description |
|----------|-------------|
| `MONDAY_TO_FRIDAY_AT_9AM` | Mon–Fri at 09:00 |
| `MONDAY_TO_FRIDAY_AT_09_30AM` | Mon–Fri at 09:30 |
| `MONDAY_TO_FRIDAY_AT_12PM` | Mon–Fri at 12:00 |
| `MONDAY_TO_FRIDAY_AT_6PM` | Mon–Fri at 18:00 |
| *(and many more…)* | Mon–Fri at various hours |

#### Week / Month / Year

| Constant | Description |
|----------|-------------|
| `EVERY_WEEK` | Every week (Sunday midnight) |
| `EVERY_WEEKDAY` | Every weekday (Mon–Fri midnight) |
| `EVERY_WEEKEND` | Every weekend (Sat & Sun midnight) |
| `EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT` | 1st of every month at midnight |
| `EVERY_1ST_DAY_OF_MONTH_AT_NOON` | 1st of every month at noon |
| `EVERY_2ND_MONTH` | Every 2 months |
| `EVERY_QUARTER` | Every quarter (every 3 months) |
| `EVERY_6_MONTHS` | Every 6 months |
| `EVERY_YEAR` | Every year |

#### Business-hours windows

| Constant | Description |
|----------|-------------|
| `EVERY_30_MINUTES_BETWEEN_9AM_AND_5PM` | Every 30 min, 09:00–17:00 |
| `EVERY_30_MINUTES_BETWEEN_9AM_AND_6PM` | Every 30 min, 09:00–18:00 |
| `EVERY_30_MINUTES_BETWEEN_10AM_AND_7PM` | Every 30 min, 10:00–19:00 |

---

## SchedulerRegistry

`SchedulerRegistry` lets you inspect and manage scheduled jobs at runtime. Inject it into any service.

```ts
import { Inject, Service } from '@carno.js/core';
import { SchedulerRegistry } from '@carno.js/schedule';

@Service()
export class AppService {

  constructor(@Inject() private readonly registry: SchedulerRegistry) {}

  stopJob() {
    this.registry.deleteCronJob('nightly-cleanup');
  }

  pauseInterval() {
    this.registry.deleteInterval('heartbeat');
  }

  listAllCrons() {
    const jobs = this.registry.getCronJobs();
    jobs.forEach((job, name) => console.log(name, job.running));
  }
}
```

### Cron jobs

| Method | Description |
|--------|-------------|
| `getCronJob(name)` | Returns the `CronJob` instance by name. Throws if not found. |
| `getCronJobs()` | Returns a `Map<string, CronJob>` with all registered cron jobs. |
| `addCronJob(name, job)` | Registers a `CronJob` manually. Throws if name is already taken. |
| `deleteCronJob(name)` | Stops and removes the cron job by name. |
| `doesExist('cron', name)` | Returns `true` if a cron job with that name exists. |

### Intervals

| Method | Description |
|--------|-------------|
| `getInterval(name)` | Returns the interval ID by name. Throws if not found. |
| `getIntervals()` | Returns all registered interval names. |
| `addInterval(name, id)` | Registers an interval ID manually. |
| `deleteInterval(name)` | Clears and removes the interval by name. |
| `doesExist('interval', name)` | Returns `true` if an interval with that name exists. |

### Timeouts

| Method | Description |
|--------|-------------|
| `getTimeout(name)` | Returns the timeout ID by name. Throws if not found. |
| `getTimeouts()` | Returns all registered timeout names. |
| `addTimeout(name, id)` | Registers a timeout ID manually. |
| `deleteTimeout(name)` | Clears and removes the timeout by name. |
| `doesExist('timeout', name)` | Returns `true` if a timeout with that name exists. |

---

## Complete example

```ts
import { Service } from '@carno.js/core';
import { Schedule, Interval, Timeout, CronExpression } from '@carno.js/schedule';

@Service()
export class TasksService {

  @Schedule(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'cleanup', timeZone: 'America/Sao_Paulo' })
  handleCleanup() {
    console.log('Daily cleanup at midnight (São Paulo)');
  }

  @Schedule(CronExpression.EVERY_30_MINUTES_BETWEEN_9AM_AND_5PM, { name: 'business-sync' })
  handleBusinessSync() {
    console.log('Sync every 30 min during business hours');
  }

  @Interval('heartbeat', 5_000)
  handleHeartbeat() {
    console.log('Heartbeat every 5 seconds');
  }

  @Timeout('startup', 2_000)
  handleStartup() {
    console.log('Runs once, 2 seconds after startup');
  }
}
```
