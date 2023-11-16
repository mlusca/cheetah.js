import { Type } from "../commons";
import { Container } from './container';

export function createContainer(rootModule?: Type<any>) {
    const container = new Container();
//    const container = new Container(GlobalProvider.entries());

    if (rootModule) {
        container.delete(rootModule);
    }

    return container;
}