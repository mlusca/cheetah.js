---
sidebar_position: 6
---

# Transport degradation

Live uses one protocol and a descending client transport ladder. The component
does not need to know which rung is active.

| Rung | Transport | What it provides | Requirement |
| --- | --- | --- | --- |
| 1 | WebSocket | Bidirectional protocol, patches, `current`, and snapshots | A WebSocket upgrade can reach the live gateway |
| 2 | Server-Sent Events | Downstream events and patches; client messages by `POST` | `sse: true` and a browser `EventSource` |
| 3 | Conditional polling | HTTP snapshots and `304 Not Modified` responses | Live `GET` routes plus the generated `routes` tree |
| 4 | No JavaScript | The server-rendered page remains usable | No live client |

The first three rungs keep the same resource ids, inputs, hashes, and server
messages. Polling is intentionally less expressive: it sends full snapshots
when the ETag changes rather than trying to reconstruct a patch history for a
client that may have been offline.

## Enabling SSE

SSE is opt-in because it adds two public HTTP routes:

```ts
app.use(LivePlugin.create({
  controllers: [TasksController],
  sse: true
}));
```

By default, the routes are:

- `GET /live/sse` — the downstream event stream;
- `POST /live/control` — the upstream endpoint for `hello`, `sub`, `unsub`, and
  `resync` messages.

The paths, heartbeat interval, and stream limit are configurable with
`ssePath`, `sseControlPath`, `sseHeartbeatMs`, and `sseMaxConnections` in the
live config. The stream's connection id is a bearer for that stream while it is
open, so deploy the control route with the same network and authentication
controls as the rest of the live surface. Never put the id in a URL that a
proxy or analytics system will log.

The browser's `EventSource` receives the server frames. The client posts its
protocol messages to the control route and includes the stream id, so the
server can associate each POST with the correct SSE connection.

## Conditional polling and ETags

ETag support is enabled by default for live `GET` routes. It can be made
explicit or disabled:

```ts
app.use(LivePlugin.create({
  controllers: [TasksController],
  etag: true // default; use false to disable
}));
```

When the polling rung first subscribes, it calls the route normally. On later
ticks it sends:

```http
If-None-Match: "previous-content-hash"
```

An unchanged response is `304 Not Modified`, so the client keeps the same
snapshot object and does not rerender. When the content changes, the route
returns JSON with a new `ETag`, and polling emits a snapshot to the store.

Only live `GET` routes are indexed for polling. A live `POST` handler can still
be used over WebSocket or SSE, but it is not a conditional-GET fallback.

## Passing the generated routes

The protocol contains a resource id, not an HTTP URL. Polling therefore needs
the route tree emitted by `@carno.js/client` to translate each live resource to
its path:

```ts
import { LiveClient } from '@carno.js/live/client';
import { routes } from './generated/app';

const client = new LiveClient({
  url: 'wss://app.example.com/live',
  httpBaseUrl: 'https://app.example.com',
  routes
});
```

Without `routes`, the client cannot construct a polling URL and the ladder
stops at SSE. This is deliberate: an invented URL could poll an unrelated
endpoint or silently produce incorrect live state.

## Descend, do not promote

The ladder descends when a rung fails to open or when its probe times out. Once
it has settled on a lower rung, reconnects stay there until the page is
reloaded. A proxy that blocks WebSocket is likely to block it on every retry;
probing the same failed upgrade before every reconnect would add a round trip
to every recovery cycle. A fresh page load starts at WebSocket again, so a
temporary deployment issue can recover to the best available transport without
making the steady-state degraded client pay for repeated failed probes.
