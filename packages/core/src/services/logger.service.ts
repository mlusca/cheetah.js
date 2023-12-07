import Pino from "pino";
import { Service } from "../commons/decorators/service.decorator";
import { InjectorService } from "../container/InjectorService";

export interface LoggerAdapter {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
  fatal(message: string, ...args: any[]): void;
  trace(message: string, ...args: any[]): void;
}

export class LoggerService implements LoggerAdapter {
  private logger: Pino.Logger;

  constructor(private injector: InjectorService){
    const pinoConfig = this.injector.applicationConfig.logger || {};
    pinoConfig['transport'] = pinoConfig.transport || {
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'pid,hostname',
      },
    }

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

  getLogger(): Pino.Logger {
    return this.logger;
  }
}