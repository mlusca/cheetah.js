import { Metadata } from '@carno.js/core';
import { VERSION_PROPERTY } from '../constants';

export function Version(): PropertyDecorator {
  return (target, propertyKey) => {
    Metadata.set(VERSION_PROPERTY, propertyKey, target.constructor);
  };
}