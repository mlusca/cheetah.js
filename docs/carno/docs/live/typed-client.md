---
sidebar_position: 3
---

# Typed subscriptions

`useLive('CardsController.list')` works, and the string tells the compiler
nothing. It does not say what comes back, and a typo becomes an
`unknown_resource` error in production rather than a red squiggle in the editor.

A route descriptor fixes that. It is one object per route, emitted by the client
codegen, carrying the method, the path, the resource identifier when the route
is live, and — as a phantom type — everything the route accepts and returns. It
serves three uses: calling the route over HTTP, subscribing to it, and
prefetching its value for server-side rendering with `LiveService.prefetch()`.

## What the codegen emits

The generated file gains a `routes` tree alongside the `paths` tree it already
had:

```ts
export const routes = {
  cards: {
    list: { method: "get", path: "/cards", resourceId: "CardsController.list", live: { shared: "tenant", key: "id" } } as RouteDescriptor<App["cards"]["get"]>,
    create: { method: "post", path: "/cards" } as RouteDescriptor<App["cards"]["post"]>,
  },
} as const;
```

Two things are deliberately absent. `dependsOn` never appears: it is how the
server decides what to recompute, and the browser has no use for it. And the
controller name appears **only** on `@Live()` routes — the subscription protocol
addresses a resource as `Controller.handler`, so those routes have to carry it,
while everything else keeps the client ignorant of how the server organises its
classes. `create` above is a plain `POST` and has neither `resourceId` nor
`live`.

## One object, two uses

`createApi` walks the tree and replaces each descriptor with a function that
still carries the descriptor's own fields:

```ts
import { createApi } from '@carno.js/client';
import { routes } from './generated/app';

export const api = createApi(routes, { baseUrl: 'http://localhost:3000' });
```

```tsx
// An HTTP call.
const { data } = await api.cards.list({ query: { status: 'open' } });

// A subscription to the same route, from the same object.
const cards = useLive(api.cards.list, { query: { status: 'open' } });
```

`cards.data` is `Card[] | undefined`, inferred from the handler's return type.
Passing a route without `@Live()` to `useLive` throws with a message naming the
route, rather than failing at the server as an unknown resource.

The input is `{ params, query, body }` rather than one flat object. The flat
form cannot distinguish `/cards/:id` from `?id=` when the two names coincide,
and the structured form is the same shape the subscription already puts on the
wire.

`createApi` is additive. The existing `client<App>(baseUrl)` proxy is unchanged
and keeps working; nothing forces a migration.

## Optimistic updates

An action can show its expected result before the server confirms it:

```tsx
const create = useLiveAction(api.cards.create, {
    optimistic: [
        { on: api.cards.list, apply: (draft, dto) => draft.push({ id: 'temp', title: dto.title }) },
    ],
});
```

`on` names the resource the projection targets, and that is what makes `draft`
typed: here it is `Card[]` and `dto` is the action's own payload type, both
inferred. Without naming a target the draft could only be `any`, and an
optimistic update on `any` is a guess the compiler cannot check. One action may
list several targets, or none.

`apply` mutates a draft — push, splice, assign — rather than returning a new
value.

What makes this safe is where the overlay lives. It is a projection **above**
the confirmed snapshot, never a write into it. A server patch that arrives while
the action is still in flight applies to the snapshot underneath, and the
overlay is re-projected on top of the result. The screen never falls back to a
state the server does not know about, and a failed optimistic update cannot
corrupt the real data.

The overlay is removed when the action settles, success or failure. On success
there is a short window — from the HTTP response to the server's patch arriving
— in which the screen shows the last confirmed state without the optimistic row.
Closing that window entirely would require the action's response to carry the
revision it produced, which the protocol does not do today.

## Build-time validation

The server refuses a badly declared live resource at startup. That is late: by
then you have written the handler, run the codegen and built the screen. The
scanner now reports the same rules while you are still typing, with the file and
line:

- **Wrong verb.** `replace carries @Live() on @PUT(). Subscribing re-runs the
  handler whenever the data changes, so it has to be idempotent: only @Get() and
  @Post() may be live.`
- **Request-bound parameters.** `withRequest is a live resource and takes
  @Req(). There is no request, no header set and no middleware locals during a
  recompute.`
- **Inputs that cannot be hashed.** `withDate takes 'since: Date', which cannot
  be canonicalized into an instance key. Live inputs must be JSON.`
- **A keyed collection with no key.** `needsKey returns rows with an 'id', but
  its @Live() declares no 'key'. Patches would be positional: inserting at the
  top rebuilds the whole list, so the user loses input focus and animations
  restart.`
- **Two resources with one identifier.** `Two live resources share the id
  'BoardController.list'. Rename one of the controllers.`

Same rule, two moments. The build-time check is a warning and never blocks the
codegen; the startup check still refuses to boot.
