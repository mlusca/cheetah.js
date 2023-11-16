import { Cheetah } from '@cheetah.js/core';
import { OrmService } from '@cheetah.js/orm/orm.service';
import { EntityStorage } from '@cheetah.js/orm/domain/entities';

export * from './decorators/entity.decorator';
export * from './decorators/property.decorator';
export * from './decorators/primary-key.decorator';
export * from './decorators/one-many.decorator';
export * from './decorators/index.decorator';
export * from './orm'
export * from './orm.service'
export * from './domain/base-entity'
export * from './driver/pg-driver'
export * from './utils'
export * from './driver/driver.interface'

export const CheetahOrm = new Cheetah({exports: [OrmService, EntityStorage]})