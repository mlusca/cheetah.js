import {classOf} from "./classOf";

export enum DecoratorTypes {
    PARAM = "parameter",
    PARAM_CTOR = "parameter.constructor",
    PARAM_STC = "parameter.static",
    PROP = "property",
    PROP_STC = "property.static",
    METHOD = "method",
    METHOD_STC = "method.static",
    CLASS = "class"
}

export function decoratorTypeOf(args: any[]): DecoratorTypes {
    const [target, propertyKey, descriptor] = args;

    const staticType = (type: string): any => {
        return target !== classOf(target) ? type : `${type}.static`;
    };

    if (typeof descriptor === "number") {
        return propertyKey ? staticType("parameter") : "parameter.constructor";
    }

    if (descriptor && descriptor.value) {
        return staticType("method");
    }

    if ((propertyKey && descriptor === undefined) || descriptor) {
        return staticType("property");
    }

    return DecoratorTypes.CLASS;
}