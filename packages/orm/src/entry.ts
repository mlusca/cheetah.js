import { Cheetah } from '@cheetah.js/core';
import { Orm } from './orm';
import { OrmService } from './orm.service';
import { EntityStorage } from './domain/entities';

export const CheetahOrm = new Cheetah({exports: [Orm, OrmService, EntityStorage]})