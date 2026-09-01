---
sidebar_position: 4
---

# Client adapters

Every framework adapter is a thin view over the same `LiveStore` contract. The
client owns transport selection, deduplication, reconnection, revisions,
patches, and optimistic overlays; an adapter only connects that store to the
framework's lifecycle.

## The `LiveStore` contract

```ts
interface LiveStore<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): LiveState<T>;
}
```

`getSnapshot()` returns `{ data, pending, error, stale }`. It is synchronous and
stable when nothing changed. `subscribe()` starts the store's hold on the live
resource and returns the release function. Several components asking for the
same resource and canonical inputs share one store and one subscription.

This is exactly the shape required by React's `useSyncExternalStore`. React can
read a snapshot during render, subscribe after commit, and ask for the same
snapshot again without the adapter inventing a second state machine. The
stable snapshot identity also prevents an unchanged `current` response from
causing a render loop. The third argument, `getServerSnapshot`, is the same
function, so a server-rendered React tree can read the hydrated value safely.

## React

Use `LiveProvider` once near the application root. `useLive` accepts either a
resource id or a typed live descriptor:

```tsx
import { LiveClient } from '@carno.js/live/client';
import { LiveProvider, useLive } from '@carno.js/live/react';

const client = new LiveClient({ url: 'ws://localhost:3000/live' });

function TaskList() {
  const { data, pending, error } = useLive<{ id: number; title: string }[]>(
    'TasksController.list',
    { query: { tenant: 'acme' } }
  );

  if (pending) return <p>Loading...</p>;
  if (error) return <p role="alert">{error}</p>;

  return <ul>{data?.map(task => <li key={task.id}>{task.title}</li>)}</ul>;
}

export function App() {
  return <LiveProvider client={client}><TaskList /></LiveProvider>;
}
```

`useLiveAction` wraps an application action and can project an optimistic
change over one or more typed live descriptors. The confirmed server snapshot
remains underneath the projection, so a patch that arrives while the action is
in flight is not lost:

```tsx
const createTask = useLiveAction(
  (dto: { title: string }) => api.tasks.create(dto),
  {
    optimistic: [{
      on: TasksController.list,
      apply: (draft, dto) => draft.push({ id: 'optimistic', title: dto.title })
    }]
  }
);
```

The adapter does not put selected rows, open dialogs, or input values into the
live store. Keep that interaction state in the component.

## Angular

Provide one client at the application boundary and call `liveSignal` inside an
injection context:

```ts
import { Component, signal } from '@angular/core';
import { LiveClient } from '@carno.js/live/client';
import { liveSignal, provideLive } from '@carno.js/live/angular';

const client = new LiveClient({ url: 'ws://localhost:3000/live' });

@Component({
  selector: 'task-list',
  providers: [provideLive(client)],
  template: `
    @if (tasks().pending) { <p>Loading...</p> }
    @for (task of tasks().data ?? []; track task.id) {
      <li>{{ task.title }}</li>
    }
  `
})
export class TaskListComponent {
  readonly tenant = signal('acme');
  readonly tasks = liveSignal('TasksController.list', () => ({
    query: { tenant: this.tenant() }
  }));
}
```

The inputs function is read reactively. When a signal it touches changes, the
adapter points the slot at the new resource identity and releases the old
subscription. Teardown is owned by Angular's `DestroyRef`; there is no manual
unsubscribe and no requirement for `zone.js`.

## Vue

Call `provideLiveClient` high in the component tree. `useLiveQuery` returns a
`ShallowRef`:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { LiveClient } from '@carno.js/live/client';
import { provideLiveClient, useLiveQuery } from '@carno.js/live/vue';

const client = new LiveClient({ url: 'ws://localhost:3000/live' });
provideLiveClient(client);

const tenant = ref('acme');
const tasks = useLiveQuery<{ id: number; title: string }[]>(
  'TasksController.list',
  () => ({ query: { tenant: tenant.value } })
);
</script>

<template>
  <p v-if="tasks.pending">Loading...</p>
  <ul v-else>
    <li v-for="task in tasks.data ?? []" :key="task.id">{{ task.title }}</li>
  </ul>
</template>
```

The ref is shallow because the server replaces the snapshot as a whole. A deep
proxy would track mutations that application code cannot make to server-owned
data. Inputs are evaluated in `watchEffect`; scope disposal calls the adapter's
cleanup through `onScopeDispose`.

## Vanilla JavaScript

For code that has no component lifecycle, use `liveStore`. It returns a small
handle with explicit ownership:

```ts
import { LiveClient, liveStore } from '@carno.js/live/client';

const client = new LiveClient({ url: 'ws://localhost:3000/live' });
const tasks = liveStore<{ id: number; title: string }>(
  client,
  'TasksController.list',
  { query: { tenant: 'acme' } }
);

const stop = tasks.subscribe(state => renderTasks(state));
renderTasks(tasks.get());

// When the widget is removed:
stop();
tasks.close();
```

`liveStoreOf` is available when an integration needs the raw `LiveStore`
contract. `LiveSlot` is the shared lifecycle primitive used by the framework
adapters when reactive inputs can point at a different resource instance.

None of these adapters touches the DOM. They expose server-owned state to the
host framework, while rendering remains the responsibility of React, Angular,
Vue, or the caller. Component-local state stays local.
