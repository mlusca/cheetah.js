import { ConnectionSettings, DriverInterface, InstanceOf } from './driver/driver.interface';
import { LoggerService } from '@cheetah.js/core';
import { SqlBuilder } from './SqlBuilder';

export class Orm<T extends DriverInterface = DriverInterface> {
  driverInstance: T;
  static instance: Orm<any>

  static getInstance() {
    return Orm.instance
  }

  constructor(public connection: ConnectionSettings<T>, public logger: LoggerService) {
    // @ts-ignore
    this.driverInstance = new this.connection.driver(connection)
    Orm.instance = this
  }

  createQueryBuilder<Model>(model: new() => Model): SqlBuilder<Model> {
    return new SqlBuilder<Model>(model)
  }

  connect(): Promise<void> {
    return this.driverInstance.connect()
  }

  disconnect(): Promise<void> {
    return this.driverInstance.disconnect()
  }
}