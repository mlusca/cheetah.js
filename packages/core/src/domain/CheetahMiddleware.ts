import { Context } from '@cheetah.js/core';
import { CheetahClosure } from './CheetahClosure';

export interface CheetahMiddleware {
  handle(context: Context, next: CheetahClosure): void
}