import { Injectable } from './Injectable.decorator';
import { Provider } from '../../domain/provider';

export function Service(options: Partial<Provider> = {}): ClassDecorator {
  return Injectable(options);
}