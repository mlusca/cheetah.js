---
sidebar_position: 1
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Queue

Carno.js integrates [BullMQ](https://docs.bullmq.io/) for robust background job processing.

## Installation

<Tabs groupId="os">
  <TabItem value="mac" label="macOS / Linux">
    ```bash
    bun install @carno.js/queue
    ```
  </TabItem>
  <TabItem value="windows" label="Windows">
    ```bash
    bun install "@carno.js/queue"
    ```
  </TabItem>
</Tabs>

## Setup

Register the module in your application.

```ts
import { Carno } from '@carno.js/core';
import { CarnoQueue } from '@carno.js/queue';

const app = new Carno()
  .use(CarnoQueue({
    connection: {
      host: 'localhost',
      port: 6379
    }
  }));

await app.listen(3000);
```

## Creating a Queue

Use the `@Queue()` decorator to define a processor for a named queue.

```ts
import { Queue, Process } from '@carno.js/queue';
import { LoggerService } from '@carno.js/logger';
import { Job } from 'bullmq';

@Queue('email')
export class EmailConsumer {
  constructor(private logger: LoggerService) {}
  
  @Process('send-welcome')
  async sendWelcomeEmail(job: Job) {
    this.logger.info('Sending welcome email', { email: job.data.email });
    // logic...
  }
}
```

When `CarnoLogger` is registered, jobs receive an isolated context for each execution. Jobs enqueued during a request automatically preserve the originating `requestId`, including when a worker processes jobs concurrently.

## Adding Jobs

Inject the queue into your services using `@InjectQueue()`.

```ts
import { Service } from '@carno.js/core';
import { InjectQueue, BullQueue } from '@carno.js/queue';

@Service()
export class AuthService {
  constructor(
    @InjectQueue('email') private emailQueue: BullQueue
  ) {}

  async register(user: User) {
    // ... create user
    await this.emailQueue.add('send-welcome', {
      email: user.email
    });
  }
}
```

## Events

You can listen to queue events (like completed, failed) using decorators.

```ts
import { Queue, OnQueueCompleted } from '@carno.js/queue';

@Queue('email')
export class EmailConsumer {
  
  @OnQueueCompleted()
  onCompleted(job: Job) {
    console.log(`Job ${job.id} completed!`);
  }
}
```
