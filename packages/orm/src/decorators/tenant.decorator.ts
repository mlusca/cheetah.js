import { Metadata } from '@carno.js/core';
import { TENANT_PROPERTY } from '../constants';

export function Tenant(): PropertyDecorator {
  return (target, propertyKey) => {
    Metadata.set(TENANT_PROPERTY, propertyKey, target.constructor);
  };
}