---
sidebar_position: 5
---

# Server-rendered islands

A live island is a normal server-rendered region whose initial resource value
is embedded beside the HTML. The browser hydrates that value and subscribes by
hash, so the first live response does not send the same data twice.

There is no island runtime. The template decides which markup is an island;
`liveIsland()` only serializes the payload needed by the client.

## 1. Declare the live resource

```ts
import { Controller, Get } from '@carno.js/core';
import { Live } from '@carno.js/live';

@Controller('/notes')
export class NotesController {
  @Get('/')
  @Live({ key: 'id', shared: 'public' })
  async list() {
    const notes = await Note.find({});
    return notes.map(note => ({ id: note.id, body: note.body }));
  }
}
```

`key: 'id'` lets subsequent writes become keyed `upsert`, `remove`, and
`order` operations instead of replacing the whole collection.

## 2. Prefetch from the page controller

`LiveService.prefetch()` computes the resource without creating a subscription
or registering a dependency-graph instance. Pass the resulting payload to the
view:

```ts
import { Controller, Get } from '@carno.js/core';
import { LiveService } from '@carno.js/live';
import { ViewService } from '@carno.js/views';

@Controller('/dashboard')
export class DashboardController {
  constructor(
    private readonly live: LiveService,
    private readonly views: ViewService
  ) {}

  @Get('/notes')
  async notesPage() {
    const payload = await this.live.prefetch('NotesController.list', {
      params: {},
      query: {}
    });

    return this.views.html('notes', { payload });
  }
}
```

The prefetch and the live subscription use the same resource id and canonical
inputs. The hash in the payload is calculated from the same value the client
will display.

## 3. Embed it in the Handlebars template

Render the data normally for the first request, and call the helper next to the
region that will later be subscribed:

```hbs
<h1>Notes</h1>

<section id="notes-island">
  <ul>
    {{#each payload.data}}
      <li data-note-id="{{id}}">{{body}}</li>
    {{/each}}
  </ul>

  {{{liveIsland payload}}}
</section>

<p id="static-help">This text was rendered once and is not live.</p>
```

`ViewService` registers `liveIsland` as a helper by default. The triple braces
are intentional: the helper returns a `<script>` element and must not be
HTML-escaped. The helper also escapes parser-sensitive sequences inside the
JSON payload so database text cannot terminate the script element.

The helper also accepts an array of payloads when one page has several
independent live regions. Pass that array from the page controller using the
normal data-shaping code for your template engine; each payload remains an
independent resource/input identity.

## 4. Hydrate on the client

`readHydrationPayload()` finds every `script[data-carno-live]` element and
builds the map expected by `LiveClient`:

```ts
import { LiveClient, readHydrationPayload } from '@carno.js/live/client';
import { routes } from './generated/app';

const websocketProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const client = new LiveClient({
  url: `${websocketProtocol}//${location.host}/live`,
  hydrate: readHydrationPayload(),
  routes
});

const notes = client.store('NotesController.list', {
  params: {},
  query: {}
});
```

The store starts with `pending: false` and the prefetched data. When it
subscribes, it sends the payload hash. If the server agrees, it answers with
`current` and no snapshot body; if a write happened between page rendering and
subscription, it sends a snapshot and the client corrects the screen.

The static help text above never becomes part of the live store. Only code that
subscribes to `NotesController.list` updates the notes region, and a page with
JavaScript disabled still has the server-rendered list.
