import { Cheetah } from '@cheetah.js/core';
import { SchedulerOrchestration } from './scheduler-orchestration.service';

export const Scheduler = new Cheetah({
  exports: [SchedulerOrchestration]
})