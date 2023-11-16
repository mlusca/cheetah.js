import Pino from "pino";
import { InjectorService, Service } from '@cheetah.js/core';

export interface LoggerAdapter {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
  fatal(message: string, ...args: any[]): void;
  trace(message: string, ...args: any[]): void;
}

@Service()
export class LoggerService implements LoggerAdapter {
  private logger: Pino.Logger;

  constructor(private injector: InjectorService){
    const pinoConfig = this.injector.applicationConfig.logger || {};
    // @ts-ignore
    this.logger = Pino(pinoConfig);
  }

  info(message: string, ...args: any[]) {
    this.logger.info(message, ...args);
  }

  warn(message: string, ...args: any[]) {
    this.logger.warn(message, ...args);
  }

  error(message: string, ...args: any[]) {
    this.logger.error(message, ...args);
  }

  debug(message: string, ...args: any[]) {
    this.logger.debug(message, ...args);
  }

  fatal(message: string, ...args: any[]) {
    this.logger.fatal(message, ...args);
  }

  trace(message: string, ...args: any[]) {
    this.logger.trace(message, ...args);
  }
}