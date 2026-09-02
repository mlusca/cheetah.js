# Live Route Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make Live subscriptions and `LiveService.prefetch()` execute the same compiled middleware and DTO-validation pipeline as their HTTP routes while keeping HTTP hotpaths unchanged.

**Architecture:** `Carno` stores one compiled executor per controller method while compiling routes. The existing Bun handler and the Live adapter call that executor; Live creates a synthetic request from normalized inputs and scope, then decodes only successful responses. `LiveEngine` carries the scope into every compute and treats pipeline authorization failures as subscription revocations.

**Tech Stack:** Bun, TypeScript 5.9, `bun:test`, `@carno.js/core`, `@carno.js/live`, legacy decorators, `reflect-metadata`.

**Spec:** `docs/superpowers/specs/2026-09-01-live-route-pipeline.md`

## Global Constraints

- Preserve the existing native Bun route fast paths.
- Do not invoke a Live controller method directly in the production plugin path.
- Keep `prefetch()` one-shot; it must not create a graph or subscription instance.
- Keep authorization fail-closed: `401`/`403` responses never become live data.
- Preserve the already-uncommitted controller-registration fix in `packages/live/src/LivePlugin.ts` and its acceptance-test adjustments.

---

### Task 1: Regression tests for the shared route pipeline

**Files:**
- Create: `packages/core/test/compiled-route-executor.spec.ts`
- Create: `packages/live/test/route-pipeline.test.ts`
- Modify: `packages/live/test/helpers/resource-registry.ts` if a shared test executor is needed
- Modify: existing `packages/live/test/*registry*.test.ts` and `packages/live/test/prefetch.test.ts` to use the explicit test executor

**Interfaces:**
- Tests consume the intended `Carno.executeCompiledRoute()` and Live pipeline behavior.
- Tests must continue using real decorators, `createTestHarness()`, and real middleware functions; mocks may only stand in for transport boundaries.

- [ ] **Step 1: Write a core failing test**

Create a controller with global, controller, and method middleware that append
markers to `ctx.locals`, plus a POST body DTO with a schema. Assert that the
compiled executor returns the same successful JSON and that invalid input throws
the same validation exception. The test must call the new public method before
it exists so it fails for the missing API.

- [ ] **Step 2: Run the core test and verify the expected failure**

Run: `bun test packages/core/test/compiled-route-executor.spec.ts`

Expected: FAIL because `Carno.executeCompiledRoute()` is not implemented.

- [ ] **Step 3: Write Live failing tests**

Add tests that create a real `Carno` app with `LivePlugin.create()` and assert:

```ts
const response = await harness.get('/guarded', { headers: { 'x-allow': 'no' } });
expect(response.status).toBe(403);
await expect(live.prefetch('GuardedController.read')).rejects.toThrow(/403|forbidden/i);
```

Add a POST DTO case where HTTP returns status `400` and `prefetch()` rejects
without invoking the controller. Add a transport-backed subscription case where
the first compute succeeds, the pipeline later returns `403`, and the engine
sends `forbidden` instead of a stale snapshot.

- [ ] **Step 4: Run the Live tests and verify the expected failure**

Run: `bun test packages/live/test/route-pipeline.test.ts`

Expected: FAIL because Live still calls the controller method directly and the
engine has no route-pipeline executor.

---

### Task 2: Store and expose the compiled executor in `Carno`

**Files:**
- Modify: `packages/core/src/Carno.ts`
- Modify: `packages/core/src/index.ts` only if a public executor type is exported

**Interfaces:**
- Produces `Carno.executeCompiledRoute(controllerClass, handlerName, request, params?): Promise<Response>`.
- The executor accepts optional params so Live does not mutate a native `Request` with Bun-only `req.params`.

- [x] **Step 1: Add the executor map and method**

Store each route’s dynamic compiled handler in a `WeakMap` keyed by controller
class and handler name. Throw a descriptive error when an integration asks for
a route that was not compiled. Normalize synchronous handler returns with
`Promise.resolve()`.

- [x] **Step 2: Populate it during route compilation**

Build the normal `createHandler()` once, store it in the map, and keep the
existing static-response registration branch. This makes the executor available
for static live handlers without replacing the HTTP static fast path.

- [x] **Step 3: Preserve Bun's one-argument handler contract**

Keep the compiled handler's one-argument Bun contract and let the integration
executor clone the request and attach explicit params before calling it. The
HTTP handler continues to read `(req as any).params` without changing any
native route call sites.

- [x] **Step 4: Run the core test and verify it passes**

Run: `bun test packages/core/test/compiled-route-executor.spec.ts`

Expected: PASS, including middleware order and DTO validation behavior.

---

### Task 3: Adapt Live resource execution to the compiled route

**Files:**
- Modify: `packages/live/src/resource/types.ts`
- Modify: `packages/live/src/resource/ResourceRegistry.ts`
- Create: `packages/live/src/resource/route-executor.ts`
- Modify: `packages/live/src/resource/prefetch.ts`
- Modify: `packages/live/src/LivePlugin.ts`
- Modify: `packages/live/src/LiveService.ts`
- Modify: `packages/live/src/shared/inputs.ts`
- Modify: `packages/live/src/index.ts`

**Interfaces:**
- Produces `LiveExecutionContext { scope?: LiveScope; headers?: HeadersInit }`.
- Produces `LiveResourceExecutor(instance, resource, inputs, context): Promise<unknown>`.
- `LiveScope` gains optional `headers?: HeadersInit`; identity helpers ignore it.
- `prefetchLive(resources, resourceId, inputs?, context?): Promise<LivePayload>`.
- `LiveService.prefetch(resource, inputs?, context?): Promise<LivePayload>`.

- [x] **Step 1: Build a synthetic request helper**

Create the route request from `httpMethod`, `httpPath`, normalized params/query,
body, and merged scope/context headers. Encode path segments, append repeated
query values, set JSON content type for a POST body, and reject a missing route
parameter before invoking the core executor.

- [x] **Step 2: Decode and classify route responses**

Call `Carno.executeCompiledRoute()`. Accept only 2xx responses and decode JSON,
text, or an empty response. Throw a typed live route error carrying the HTTP
status for 4xx/5xx responses; never hash or return an error response as data.

- [x] **Step 3: Remove the production direct method invocation**

Change `ResourceRegistry.register()` to receive the executor and store an
executor-backed `invoke(inputs, context)` closure. `compute()` passes context
through the dependency collector. Update unit tests with an explicit direct
test executor only where they test argument binding without booting Carno.

- [x] **Step 4: Wire the plugin to the parent Carno**

In the WebSocket builder, resolve `Carno` from the bootstrapped container and
register each Live resource with the adapter from Step 2. The plugin’s existing
`plugin.controllers(options.controllers)` registration remains intact.

- [x] **Step 5: Thread context through prefetch**

Pass the optional execution context from `LiveService.prefetch()` to
`prefetchLive()` and then `ResourceRegistry.compute()`. Preserve normalization,
hashing, and the no-instance behavior.

- [x] **Step 6: Run focused Live tests**

Run: `bun test packages/live/test/route-pipeline.test.ts packages/live/test/prefetch.test.ts packages/live/test/resource-registry.test.ts packages/live/test/live-post.test.ts`

Expected: PASS.

---

### Task 4: Carry scope through subscriptions and handle authorization failures

**Files:**
- Modify: `packages/live/src/LiveEngine.ts`
- Modify: `packages/live/src/resource/ResourceRegistry.ts` only if the error type is shared there
- Modify: `packages/live/test/authorization.test.ts`
- Modify: `packages/live/test/live-engine.test.ts`

**Interfaces:**
- `LiveInstance` stores the scope used to compute it.
- Initial and recompute calls use `compute(resource, inputs, { scope })`.

- [x] **Step 1: Extend the failing subscription regression**

Assert that a scope-provided header reaches the route middleware on initial
subscription and on recompute. Change the middleware to return `403` after an
authorization flag is revoked; assert every bound sid receives `forbidden` and
no stale data is sent.

- [x] **Step 2: Implement scope propagation**

Store the scope on each instance at creation and pass it to every recompute.
Do not include headers in `scopeKeyOf()` or change instance identity.

- [x] **Step 3: Map failures safely**

During initial subscribe, map `401/403` to `forbidden` and other 4xx responses to
`invalid_subscription`. During recompute, revoke the affected instance on
`401/403`; retain existing stale handling for other compute failures.

- [x] **Step 4: Run engine and authorization tests**

Run: `bun test packages/live/test/authorization.test.ts packages/live/test/live-engine.test.ts packages/live/test/route-pipeline.test.ts`

Expected: PASS.

---

### Task 5: Documentation and full verification

**Files:**
- Modify: `docs/carno/docs/live/overview.md`
- Modify: `docs/carno/docs/live/islands.md`

**Interfaces:**
- Documentation explains that live execution reuses the compiled HTTP pipeline,
  protected prefetch can receive `headers`/`scope`, and missing context fails
  closed.

- [x] **Step 1: Update the live execution contract docs**

Replace the statement that authorization is only a handshake concern with the
shared-pipeline behavior. Document that `LiveAuthorizer` remains connection
authorization and that route middleware/DTO validation also run.

- [x] **Step 2: Run the focused suite**

Run: `bun test packages/core/test/compiled-route-executor.spec.ts packages/live/test/route-pipeline.test.ts packages/live/test/prefetch.test.ts packages/live/test/resource-registry.test.ts packages/live/test/live-post.test.ts packages/live/test/authorization.test.ts packages/live/test/live-engine.test.ts`

Expected: PASS.

- [x] **Step 3: Run build and lint**

Run: `bun run build` and `bun run lint`.

Expected: both commands exit with code 0.

- [x] **Step 4: Run the broader non-database Live suite**

Run: `bun test packages/live/test --exclude 'packages/live/test/acceptance*.test.ts' --exclude 'packages/live/test/pg-notify-integration.test.ts'`.

Expected: PASS; if PostgreSQL/Docker is unavailable, report the acceptance
limitation separately rather than weakening the tests.
