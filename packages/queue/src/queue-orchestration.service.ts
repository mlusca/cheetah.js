import {
  Service,
  OnApplicationInit,
  OnApplicationShutdown,
  Container,
  Context,
  Scope,
  ExecutionContext,
  ObservabilityService,
} from '@carno.js/core';
import { QueueRegistry } from './queue.registry';
import { QueueDiscoveryService } from './services/queue-discovery.service';
import { QueueBuilderService } from './services/queue-builder.service';
import { EventBinderService } from './services/event-binder.service';
import { getQueueToken } from './decorators/inject-queue.decorator';
import { createQueueProxyFactory } from './services/queue-proxy-factory.service';
import { getOriginRequestId } from './services/observability-context';

@Service()
export class QueueOrchestration {
  constructor(
    private queueRegistry: QueueRegistry,
    private discoveryService: QueueDiscoveryService,
    private builderService: QueueBuilderService,
    private eventBinder: EventBinderService,
    private container: Container
  ) {}

  @OnApplicationInit(100)
  async onApplicationInit(): Promise<void> {
    this.setupQueues();
  }

  @OnApplicationShutdown()
  async onApplicationShutdown(): Promise<void> {
    await this.queueRegistry.closeAll();
  }

  private setupQueues(): void {
    const queues = this.discoveryService.discoverQueues();

    // First pass: Create all queues and register their providers
    queues.forEach(queueMetadata => {
      try {
        const queue = this.createQueue(queueMetadata);
        this.registerQueueProvider(queueMetadata.name, queue);
      } catch (error) {
        if (this.isProviderNotFoundError(error)) {
          return;
        }

        throw error;
      }
    });

    // Second pass: Setup processors and workers for all queues
    queues.forEach(queueMetadata => {
      try {
        this.setupProcessors(queueMetadata);
        const queue = this.queueRegistry.getQueue(queueMetadata.name);
        this.setupQueueEvents(queueMetadata, queue);
      } catch (error) {
        if (this.isProviderNotFoundError(error)) {
          return;
        }

        throw error;
      }
    });
  }

  private isProviderNotFoundError(error: any): boolean {
    return error?.message?.includes('Provider not found');
  }

  private setupQueue(queueMetadata: any): void {
    const queue = this.createQueue(queueMetadata);

    this.registerQueueProvider(queueMetadata.name, queue);

    this.setupProcessors(queueMetadata);

    this.setupQueueEvents(queueMetadata, queue);
  }

  private createQueue(metadata: any): any {
    return this.builderService.createQueue(
      metadata.name,
      metadata.options
    );
  }

  private setupProcessors(queueMetadata: any): void {
    const processors = this.findProcessors(queueMetadata);

    if (processors.length === 0) {
      return;
    }

    this.createUnifiedWorker(queueMetadata, processors);
  }

  private findProcessors(queueMetadata: any): any[] {
    const all = this.discoveryService.discoverProcessors();

    const filtered = all.filter(p => {
      const matches = p.target === queueMetadata.target.prototype;
      return matches;
    });

    return filtered;
  }

  private createUnifiedWorker(
    queueMetadata: any,
    processors: any[]
  ): void {

   try {
     const instance = this.getOrCreateInstance(queueMetadata);

    const processorMap = this.buildProcessorMap(
      instance,
      processors
    );

    const routerProcessor = this.createRouterProcessor(
      queueMetadata,
      processorMap
    );

    const maxConcurrency = this.calculateMaxConcurrency(processors);

    const worker = this.builderService.createWorker(
      queueMetadata.name,
      queueMetadata.name,
      routerProcessor,
      { concurrency: maxConcurrency }
    );

    // Add worker event listeners for debugging
    worker.on('ready', () => {
      console.log(`[WORKER READY] Worker for queue ${queueMetadata.name} is ready and waiting for jobs`);
    });

    this.setupAllJobEvents(
      queueMetadata,
      worker,
      instance,
      processors
    );
   } catch (error) {
			console.error(`[ERROR] Failed to create unified worker for queue ${queueMetadata.name}:`, error);
			throw error;
		}
  }

  private buildWorkerId(queueName: string, jobName: string): string {
    return `${queueName}:${jobName}`;
  }

  private getOrCreateInstance(metadata: any): any {
    return this.container.get(metadata.target);
  }

  private createProcessorFunction(
    instance: any,
    metadata: any
  ): any {
    return instance[metadata.methodName].bind(instance);
  }

  private buildProcessorMap(
    instance: any,
    processors: any[]
  ): Map<string, Function> {
    const map = new Map<string, Function>();

    processors.forEach(processor => {
      const jobName = processor.name || '__default__';
      const fn = instance[processor.methodName].bind(instance);
      map.set(jobName, fn);
    });

    return map;
  }

  private createRouterProcessor(
    queueMetadata: any,
    processorMap: Map<string, Function>
  ): (job: any) => Promise<any> {
    return async (job: any) => {
      const jobName = job.name;
      const processor = processorMap.get(jobName);

      if (!processor) {
        const defaultProcessor = processorMap.get('__default__');

        if (defaultProcessor) {
          return this.executeProcessorWithContext(
            queueMetadata,
            defaultProcessor,
            job
          );
        }

        throw new Error(
          `No processor found for job \"${jobName}\"`
        );
      }

      return this.executeProcessorWithContext(
        queueMetadata,
        processor,
        job
      );
    };
  }


  private async executeProcessorWithContext(
    queueMetadata: any,
    processor: Function,
    job: any
  ): Promise<any> {
    const instance = this.container.get(queueMetadata.target);

    const boundProcessor = instance[this.findProcessorMethodName(
      queueMetadata,
      job.name
    )].bind(instance);

    const context = {
      requestId: getOriginRequestId(job) ?? ExecutionContext.createRequestId(),
      kind: 'queue' as const,
      queueName: queueMetadata.name,
      jobName: job.name,
      jobId: String(job.id ?? '')
    };

    return ExecutionContext.run(context, async () => {
      try {
        return await boundProcessor(job);
      } catch (error) {
        this.reportExecutionError(context, error);
        throw error;
      }
    });
  }

  private reportExecutionError(context: any, error: unknown): void {
    if (!this.container.has(ObservabilityService)) {
      return;
    }

    try {
      this.container.get(ObservabilityService).onExecutionError(context, error);
    } catch (observerError) {
      try {
        console.error('Observability queue error reporting failed:', observerError);
      } catch {
        // Observability must never replace the processor error.
      }
    }
  }


  private findProcessorMethodName(
    queueMetadata: any,
    jobName: string
  ): string {
    const processors = this.findProcessors(queueMetadata);

    const processor = processors.find(
      p => (p.name || '__default__') === jobName
    );

    if (!processor) {
      const defaultProcessor = processors.find(
        p => !p.name || p.name === '__default__'
      );

      return defaultProcessor?.methodName;
    }

    return processor.methodName;
  }

  private calculateMaxConcurrency(processors: any[]): number {
    const concurrencies = processors
      .map(p => p.concurrency ?? 1)
      .filter(c => typeof c === 'number');

    if (concurrencies.length === 0) {
      return 1;
    }

    return Math.max(...concurrencies);
  }

  private setupAllJobEvents(
    queueMetadata: any,
    worker: any,
    instance: any,
    processors: any[]
  ): void {
    const allEvents = processors.flatMap(processor => {
      return this.findJobEvents(queueMetadata, processor);
    });

    const uniqueEvents = this.deduplicateEvents(allEvents);

    this.eventBinder.bindJobEvents(worker, uniqueEvents, instance);
  }

  private deduplicateEvents(events: any[]): any[] {
    const seen = new Set<string>();
    const unique: any[] = [];

    events.forEach(event => {
      const key = `${event.eventName}:${event.methodName}`;

      if (!seen.has(key)) {
        seen.add(key);
        unique.push(event);
      }
    });

    return unique;
  }

  private setupJobEvents(
    queueMetadata: any,
    worker: any,
    instance: any,
    processorMetadata: any
  ): void {
    const events = this.findJobEvents(
      queueMetadata,
      processorMetadata
    );

    this.eventBinder.bindJobEvents(worker, events, instance);
  }

  private findJobEvents(
    queueMetadata: any,
    processorMetadata: any
  ): any[] {
    const all = this.discoveryService.discoverJobEvents();

    return all.filter(e => {
      return this.isEventForProcessor(
        e,
        queueMetadata,
        processorMetadata
      );
    });
  }

  private isEventForProcessor(
    event: any,
    queueMetadata: any,
    processorMetadata: any
  ): boolean {
    const sameTarget = event.target === queueMetadata.target.prototype;

    const sameJob = !event.jobName ||
      event.jobName === processorMetadata.name;

    return sameTarget && sameJob;
  }

  private setupQueueEvents(
    queueMetadata: any,
    queue: any
  ): void {
    const events = this.findQueueEvents(queueMetadata);

    const instance = this.getOrCreateInstance(queueMetadata);

    this.eventBinder.bindQueueEvents(queue, events, instance);
  }

  private findQueueEvents(queueMetadata: any): any[] {
    const all = this.discoveryService.discoverQueueEvents();

    return all.filter(e => {
      return e.target === queueMetadata.target.prototype;
    });
  }

  private registerQueueProvider(name: string, queue: any): void {
    const token = getQueueToken(name);
    const ProxyFactory = createQueueProxyFactory(queue);

    this.container.register({
      token,
      useClass: ProxyFactory,
      scope: Scope.SINGLETON,
    });
  }
}
