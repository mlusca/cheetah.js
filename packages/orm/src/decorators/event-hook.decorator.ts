import { EVENTS_METADATA } from '../constants';

export function BeforeCreate() {
    return function (target, propertyName) {
        const metadata = Reflect.getMetadata(EVENTS_METADATA, target.constructor) || [];
        Reflect.defineMetadata(EVENTS_METADATA, [...metadata, { type: 'beforeCreate', propertyName }], target.constructor);
    };
}

export function AfterCreate() {
    return function (target, propertyName) {
        const metadata = Reflect.getMetadata(EVENTS_METADATA, target.constructor) || [];
        Reflect.defineMetadata(EVENTS_METADATA, [...metadata, { type: 'afterCreate', propertyName }], target.constructor);
    };
}

export function BeforeUpdate() {
    return function (target, propertyName) {
        const metadata = Reflect.getMetadata(EVENTS_METADATA, target.constructor) || [];
        Reflect.defineMetadata(EVENTS_METADATA, [...metadata, { type: 'beforeUpdate', propertyName }], target.constructor);
    };
}

export function AfterUpdate() {
    return function (target, propertyName) {
        const metadata = Reflect.getMetadata(EVENTS_METADATA, target.constructor) || [];
        Reflect.defineMetadata(EVENTS_METADATA, [...metadata, { type: 'afterUpdate', propertyName }], target.constructor);
    };
}