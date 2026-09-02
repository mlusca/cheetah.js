# Live Route Pipeline Design

## Goal

Make a `@Live()` resource execute the same compiled route pipeline as its HTTP
route, including global, plugin, controller, and method middleware plus body DTO
validation, without adding work to the ordinary HTTP hotpath.

## Invariants

1. `Carno` compiles one route pipeline per decorated handler at startup. The
   native HTTP route and Live both call that compiled pipeline.
2. The HTTP route keeps its current fast paths and response handling. Live
   execution is an integration API and is not inserted into `Bun.serve()`.
3. Live builds a synthetic `Request` from route params, query, body, and the
   resolved live scope. The route pipeline remains the only place that invokes
   middleware, parses bodies, validates DTOs, and calls the controller.
4. `LiveScope.headers` is optional request metadata for middleware replay. It is
   never included in instance identity; authorization of each connection still
   belongs to `LiveAuthorizer` and the selected sharing boundary.
5. A live pipeline response with status `401` or `403` never becomes data. A
   subscription is rejected/revoked as forbidden. Other client errors reject
   the subscription as invalid input. A failed recompute keeps the existing
   stale behavior except for authorization failures, which revoke access.
6. `LiveService.prefetch()` remains a one-shot compute and creates no live
   instance. It accepts optional execution context so authenticated SSR can
   replay the request headers/scope; without credentials, protected middleware
   fails closed.

## Core integration contract

`Carno` exposes the compiled route executor:

```ts
executeCompiledRoute(
    controllerClass: new (...args: any[]) => any,
    handlerName: string,
    request: Request,
    params?: Record<string, string>
): Promise<Response>;
```

The executor is populated while `compileController()` builds each route. The
existing HTTP registration continues to use the same handler and keeps static,
parameterless, and middleware-free fast paths unchanged.

## Live integration contract

`ResourceRegistry` receives a `LiveResourceExecutor` when the plugin is built.
The executor calls `Carno.executeCompiledRoute()`, checks the status, and
decodes a successful response into the live data value. `ResourceRegistry`
continues to own dependency collection and resource metadata; it no longer
stores a direct controller-method call in production.

`LiveEngine` passes the subscription scope to initial computes and stores it on
the live instance for later recomputes. `prefetchLive()` accepts the same
execution context without registering an instance.

## Validation and failure mapping

The live registration rules continue to reject request-bound handler parameters
that cannot be recomputed (`@Req`, `@Ctx`, `@Header`, `@Locals`). Middleware may
still use the synthetic request/context for authorization and context setup.
Missing path parameters, DTO validation failures, and other 4xx route results
are rejected before data is sent. A route response outside 2xx is never hashed
or stored as live data.

## Verification

Regression tests must prove that:

- a global, controller, and method middleware run for Live prefetch and can
  short-circuit the controller;
- invalid POST DTO input is rejected by Live exactly as HTTP rejects it;
- a subscription recompute runs through the pipeline with its scope and revokes
  access when the pipeline starts returning `403`;
- a normal HTTP request still receives the same JSON/error responses;
- prefetch does not create a dependency-graph instance.
