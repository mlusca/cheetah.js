import { CheetahClosure } from "./CheetahClosure";
import { Context } from "./Context";

export interface CheetahMiddleware {
  handle(context: Context, next: CheetahClosure): void;
}
