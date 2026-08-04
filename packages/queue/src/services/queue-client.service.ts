import { Service, Scope } from "@carno.js/core";
import { Queue, JobsOptions } from "bullmq";
import { QueueRegistry } from "../queue.registry";
import { addObservabilityMetadata } from './observability-context';

@Service({ scope: Scope.SINGLETON })
export class QueueClient {
  constructor(private queueRegistry: QueueRegistry) {}

  async add(
    queueName: string,
    jobName: string,
    data: any = {},
    options?: JobsOptions
  ): Promise<any> {
    const queue = this.getQueue(queueName);

    return queue.add(jobName, addObservabilityMetadata(data), options);
  }

  async addBulk(
    queueName: string,
    jobs: Array<{ name: string; data?: any; opts?: JobsOptions }>
  ): Promise<any> {
    const queue = this.getQueue(queueName);

    return queue.addBulk(jobs.map(job => ({ ...job, data: addObservabilityMetadata(job.data) })) as any);
  }

  private getQueue(queueName: string): Queue {
    const queue = this.queueRegistry.getQueue(queueName);

    if (!queue) {
      throw new Error(`Queue "${queueName}" not found`);
    }

    return queue;
  }
}
