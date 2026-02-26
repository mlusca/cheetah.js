import type { Context } from '../context/Context';

/**
 * Closure function to call the next middleware in the chain.
 * Returns the Response produced by the next layer, allowing
 * middlewares to inspect or transform it.
 */
export type CarnoClosure = () => Promise<Response>;

/**
 * Interface for onion-style middleware.
 * Middleware must call next() to continue the chain.
 *
 * Returning a Response from handle() replaces the response
 * produced by the downstream chain (useful for response transformers
 * like compression).
 */
export interface CarnoMiddleware {
  handle(ctx: Context, next: CarnoClosure): void | Response | Promise<void | Response>;
}
