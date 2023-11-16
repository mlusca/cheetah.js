import { TokenProvider } from "../commons";

export class LocalsContainer extends Map<TokenProvider, any> {
//    readonly hooks = new Hooks();

    async destroy() {
//        await this.hooks.asyncEmit("$onDestroy");
    }
}