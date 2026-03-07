---
sidebar_position: 1
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# WebSocket

`@carno.js/websocket` adds native, decorator-based WebSocket support to Carno.js. It is built on top of Bun's built-in WebSocket server — no external dependencies, no wrappers, no overhead.

It brings a **Socket.io-inspired API** to Bun: rooms, namespaces, server-side broadcasting, and a clean event-handler model via TypeScript decorators.

## Installation

<Tabs groupId="os">
  <TabItem value="mac" label="macOS / Linux">
    ```bash
    bun install @carno.js/websocket
    ```
  </TabItem>
  <TabItem value="windows" label="Windows">
    ```bash
    bun install "@carno.js/websocket"
    ```
  </TabItem>
</Tabs>

:::info
`@carno.js/websocket` requires `@carno.js/core` and Bun `>=1.0.0`.
:::

## Quick Start

```ts
import { Carno } from '@carno.js/core';
import {
  WebSocketPlugin,
  Gateway,
  OnOpen,
  OnClose,
  SubscribeMessage,
  CarnoSocket,
} from '@carno.js/websocket';

@Gateway('/chat')
class ChatGateway {
  @OnOpen()
  onOpen(socket: CarnoSocket) {
    socket.join('general');
    socket.emit('welcome', { id: socket.id });
  }

  @SubscribeMessage('send')
  onSend(socket: CarnoSocket, payload: { message: string }) {
    socket.to('general').emit('message', {
      from: socket.id,
      text: payload.message,
    });
  }

  @OnClose()
  onClose(socket: CarnoSocket, code: number, reason: string) {
    console.log(`${socket.id} disconnected (${code})`);
  }
}

const app = new Carno();
app.use(WebSocketPlugin.create([ChatGateway]));
app.listen(3000);

// Clients connect to: ws://localhost:3000/chat
```

## Registering the Plugin

`WebSocketPlugin.create()` wraps your gateway classes into a Carno plugin. Pass it to `app.use()` before calling `app.listen()`.

```ts
import { WebSocketPlugin } from '@carno.js/websocket';

app.use(WebSocketPlugin.create([ChatGateway, NotificationsGateway]));
```

The second argument is an optional [configuration object](#configuration).

```ts
app.use(WebSocketPlugin.create([ChatGateway], {
  idleTimeout: 60,
  sendPings: true,
  perMessageDeflate: true,
}));
```

## Gateways

A **gateway** is a class decorated with `@Gateway(path)`. Each gateway is responsible for WebSocket connections made to a specific HTTP upgrade path, which also acts as its **namespace**.

```ts
import { Gateway } from '@carno.js/websocket';

@Gateway('/chat')           // Clients connect to ws://host/chat
class ChatGateway { }

@Gateway('/notifications')  // Clients connect to ws://host/notifications
class NotificationsGateway { }
```

- The path must start with `/`. If it doesn't, a leading `/` is added automatically.
- Gateways are resolved through [Dependency Injection](/docs/core/dependency-injection), so you can inject services into their constructors.

```ts
import { Gateway, OnOpen, CarnoSocket } from '@carno.js/websocket';
import { UserService } from './user.service';

@Gateway('/chat')
class ChatGateway {
  constructor(private readonly users: UserService) {}

  @OnOpen()
  async onOpen(socket: CarnoSocket) {
    const user = await this.users.findById(socket.id);
    socket.emit('welcome', { name: user.name });
  }
}
```

## Event Handlers

Decorate methods on your gateway to handle WebSocket lifecycle events.

### `@OnOpen()`

Invoked when a new connection is established.

```ts
@OnOpen()
onOpen(socket: CarnoSocket) {
  socket.join('lobby');
  socket.emit('connected', { id: socket.id });
}
```

### `@OnClose()`

Invoked when a connection is closed. Receives the [close code](https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code) and reason string.

```ts
@OnClose()
onClose(socket: CarnoSocket, code: number, reason: string) {
  console.log(`Socket ${socket.id} closed with code ${code}: ${reason}`);
}
```

### `@OnMessage()`

Invoked for every incoming message in its raw form, regardless of content type. Receives the raw payload — use this for binary data or when you want to handle raw strings yourself.

```ts
@OnMessage()
onMessage(socket: CarnoSocket, message: string | Buffer) {
  console.log('Raw message:', message);
}
```

:::tip
For JSON-based event dispatch, prefer [`@SubscribeMessage()`](#subscribemessageevent) over `@OnMessage()`. When a JSON message arrives, **both** `@OnMessage` and any matching `@SubscribeMessage` handler are called.
:::

### `@OnError()`

Invoked when a WebSocket error occurs.

```ts
@OnError()
onError(socket: CarnoSocket, error: Error) {
  console.error(`Socket ${socket.id} error:`, error.message);
}
```

### `@OnDrain()`

Invoked when the send buffer has drained and the socket is ready to accept more data. Useful for implementing backpressure-aware senders.

```ts
@OnDrain()
onDrain(socket: CarnoSocket) {
  console.log(`Socket ${socket.id} ready to receive more data`);
}
```

### `@SubscribeMessage(event)`

Subscribes a method to a specific named event. The client must send messages following the JSON protocol:

```json
{ "event": "send", "data": { "message": "Hello!" } }
```

The second argument to the handler is the `data` payload, already parsed.

```ts
@SubscribeMessage('send')
onSend(socket: CarnoSocket, payload: { message: string }) {
  socket.to('general').emit('message', {
    from: socket.id,
    text: payload.message,
  });
}
```

A single gateway can have multiple `@SubscribeMessage` handlers for different events:

```ts
@Gateway('/game')
class GameGateway {
  @SubscribeMessage('move')
  onMove(socket: CarnoSocket, payload: { x: number; y: number }) { ... }

  @SubscribeMessage('attack')
  onAttack(socket: CarnoSocket, payload: { targetId: string }) { ... }

  @SubscribeMessage('chat')
  onChat(socket: CarnoSocket, payload: { text: string }) { ... }
}
```

Multiple handlers for the **same event** are all called, in declaration order:

```ts
@SubscribeMessage('message')
logMessage(socket: CarnoSocket, data: any) {
  this.logger.log(data);
}

@SubscribeMessage('message')
handleMessage(socket: CarnoSocket, data: any) {
  // also called
}
```

## CarnoSocket

Every handler receives a `CarnoSocket` instance — a thin, Socket.io-inspired wrapper around Bun's native `ServerWebSocket`.

### Sending Messages

| Method | Description |
| :--- | :--- |
| `socket.emit(event, data?)` | Send a named event as JSON: `{ event, data }` |
| `socket.send(message, compress?)` | Send a raw string, `ArrayBuffer`, or `Uint8Array` |

```ts
socket.emit('notification', { title: 'New message', body: 'Hello!' });

socket.send('ping');
socket.send(new Uint8Array([1, 2, 3]));
```

### Rooms

Rooms use Bun's built-in pub/sub. Subscribing a socket to a room allows broadcasting to all members.

| Method | Description |
| :--- | :--- |
| `socket.join(room)` | Subscribe this socket to a room |
| `socket.leave(room)` | Unsubscribe this socket from a room |
| `socket.isSubscribed(room)` | Returns `true` if the socket is in the room |
| `socket.rooms` | Array of rooms this socket currently belongs to |

```ts
@OnOpen()
onOpen(socket: CarnoSocket) {
  socket.join('general');
  socket.join(`user:${socket.id}`);
}
```

### Broadcasting to a Room

Use `socket.to(room)` to get a [`RoomBroadcaster`](#roombroadcaster) that sends to all subscribers of that room **except the sender**, following the same semantics as Socket.io's `to()`.

```ts
// Emit a named event to everyone in 'general'
socket.to('general').emit('message', { from: socket.id, text: 'Hi!' });

// Send a raw message to everyone in 'alerts'
socket.to('alerts').send('SYSTEM ALERT');
```

### Publishing to a Topic

`socket.publish()` sends to **all** subscribers of a topic, including the sender (depending on `publishToSelf` config).

```ts
socket.publish('global', 'broadcast', { text: 'Hello, everyone!' });
```

### Closing the Connection

```ts
socket.close();             // Clean close
socket.close(1000, 'Done'); // With code and reason
```

### Socket Properties

| Property | Type | Description |
| :--- | :--- | :--- |
| `socket.id` | `string` | Unique UUID assigned at connection time |
| `socket.namespace` | `string` | The gateway path this socket connected to |
| `socket.remoteAddress` | `string` | Client's remote IP address |
| `socket.rooms` | `string[]` | List of rooms this socket is subscribed to |
| `socket.readyState` | `number` | WebSocket ready state (`0`–`3`) |
| `socket.raw` | `ServerWebSocket` | The underlying Bun `ServerWebSocket` instance |

## RoomBroadcaster

`RoomBroadcaster` is returned by `socket.to(room)` and targets all subscribers of a room.

| Method | Description |
| :--- | :--- |
| `broadcaster.emit(event, data?)` | Send a named JSON event to all room subscribers |
| `broadcaster.send(message)` | Send a raw string/binary to all room subscribers |

```ts
const broadcaster = socket.to('general');

broadcaster.emit('typing', { user: socket.id });
broadcaster.send('RAW_BROADCAST');
```

## Rooms in Practice

Here is the typical pattern for a chat application:

```ts
@Gateway('/chat')
class ChatGateway {
  @OnOpen()
  onOpen(socket: CarnoSocket) {
    socket.join('general');

    // Notify others in the room
    socket.to('general').emit('user:joined', { id: socket.id });

    // Send the room list to the new connection
    socket.emit('rooms', socket.rooms);
  }

  @SubscribeMessage('join')
  onJoinRoom(socket: CarnoSocket, payload: { room: string }) {
    socket.join(payload.room);
    socket.to(payload.room).emit('user:joined', { id: socket.id });
  }

  @SubscribeMessage('leave')
  onLeaveRoom(socket: CarnoSocket, payload: { room: string }) {
    socket.leave(payload.room);
    socket.to(payload.room).emit('user:left', { id: socket.id });
  }

  @SubscribeMessage('message')
  onMessage(socket: CarnoSocket, payload: { room: string; text: string }) {
    socket.to(payload.room).emit('message', {
      from: socket.id,
      text: payload.text,
    });
  }

  @OnClose()
  onClose(socket: CarnoSocket) {
    socket.to('general').emit('user:left', { id: socket.id });
  }
}
```

## Namespaces

Each gateway path is its own **namespace**. Different gateways are completely isolated — they have separate event handlers and separate room scopes. A `@SubscribeMessage('ping')` in `/chat` will never be invoked for a message sent to `/notifications`.

```ts
@Gateway('/chat')
class ChatGateway {
  @OnOpen()
  onOpen(socket: CarnoSocket) {
    // socket.namespace === '/chat'
  }
}

@Gateway('/notifications')
class NotificationsGateway {
  @OnOpen()
  onOpen(socket: CarnoSocket) {
    // socket.namespace === '/notifications'
  }
}

// Register both with the plugin:
app.use(WebSocketPlugin.create([ChatGateway, NotificationsGateway]));
```

## Server-Side Broadcasting

To broadcast from **outside a WebSocket handler** — in a controller, a service, a queue job — inject `RoomManager`.

```ts
import { Service } from '@carno.js/core';
import { RoomManager } from '@carno.js/websocket';

@Service()
class AlertService {
  constructor(private readonly rooms: RoomManager) {}

  sendAlert(message: string) {
    // Broadcast a named event to all subscribers of 'alerts'
    this.rooms.broadcast('alerts', 'alert', { message });
  }

  sendRaw(payload: string) {
    this.rooms.broadcastRaw('alerts', payload);
  }
}
```

`RoomManager` is automatically registered in the DI container when you call `WebSocketPlugin.create()`. You can inject it into any service or controller.

:::warning
`RoomManager.broadcast()` and `broadcastRaw()` require the server to be running. Call them after `app.listen()` — for example, inside HTTP handlers or lifecycle hooks, not during bootstrap.
:::

### Broadcasting from a Controller

```ts
import { Controller, Post, Body } from '@carno.js/core';
import { RoomManager } from '@carno.js/websocket';

@Controller('/api/notifications')
class NotificationsController {
  constructor(private readonly rooms: RoomManager) {}

  @Post('/broadcast')
  send(@Body() body: { room: string; message: string }) {
    this.rooms.broadcast(body.room, 'notification', { text: body.message });
    return { sent: true };
  }
}
```

### `RoomManager` API

| Method / Property | Description |
| :--- | :--- |
| `broadcast(room, event, data?)` | Broadcast a named event to all subscribers of `room` |
| `broadcastRaw(room, message)` | Broadcast a raw string/binary to all subscribers of `room` |
| `pendingWebSockets` | Number of buffered (pending) WebSocket connections |

## Connection Statistics

`NamespaceRegistry` tracks the count of active connections per namespace. It is automatically updated by the plugin on every open/close event.

Inject it into any service to monitor connection state:

```ts
import { Service } from '@carno.js/core';
import { NamespaceRegistry } from '@carno.js/websocket';

@Service()
class StatsService {
  constructor(private readonly registry: NamespaceRegistry) {}

  getStats() {
    return {
      total: this.registry.getTotalConnections(),
      namespaces: this.registry.getNamespaces(),
      chatConnections: this.registry.getCount('/chat'),
    };
  }
}
```

### `NamespaceRegistry` API

| Method | Returns | Description |
| :--- | :--- | :--- |
| `getCount(namespace)` | `number` | Active connections for a specific namespace |
| `getNamespaces()` | `string[]` | All namespaces with at least one active connection |
| `getTotalConnections()` | `number` | Sum of active connections across all namespaces |

## Configuration

Pass a `WebSocketPluginConfig` object as the second argument to `WebSocketPlugin.create()`.

```ts
app.use(WebSocketPlugin.create([ChatGateway], {
  idleTimeout: 120,
  maxPayloadLength: 16 * 1024 * 1024, // 16 MB
  sendPings: true,
  perMessageDeflate: true,
  publishToSelf: false,
}));
```

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `perMessageDeflate` | `boolean \| object` | `false` | Enable per-message deflate compression. Pass `{ compress, decompress }` for fine-grained control. |
| `maxPayloadLength` | `number` | `16777216` | Maximum allowed message size in bytes (16 MB). |
| `idleTimeout` | `number` | `120` | Idle connection timeout in seconds. |
| `backpressureLimit` | `number` | `1048576` | Backpressure limit in bytes (1 MB). |
| `closeOnBackpressureLimit` | `boolean` | `false` | Close the connection when the backpressure limit is reached. |
| `sendPings` | `boolean` | `true` | Send periodic ping frames to keep connections alive. |
| `publishToSelf` | `boolean` | `false` | Include the sender when using pub/sub. |

## Complete Example

A fully-featured chat server with rooms, authentication via DI, and server broadcasting:

```ts
// chat.gateway.ts
import { Gateway, OnOpen, OnClose, SubscribeMessage, CarnoSocket } from '@carno.js/websocket';
import { AuthService } from './auth.service';

@Gateway('/chat')
export class ChatGateway {
  constructor(private readonly auth: AuthService) {}

  @OnOpen()
  async onOpen(socket: CarnoSocket) {
    const user = await this.auth.resolveSocket(socket);

    if (!user) {
      socket.close(4001, 'Unauthorized');
      return;
    }

    socket.join('general');
    socket.to('general').emit('user:joined', { username: user.name });
    socket.emit('welcome', { id: socket.id, rooms: socket.rooms });
  }

  @SubscribeMessage('join')
  onJoin(socket: CarnoSocket, payload: { room: string }) {
    socket.join(payload.room);
    socket.to(payload.room).emit('user:joined', { id: socket.id });
  }

  @SubscribeMessage('leave')
  onLeave(socket: CarnoSocket, payload: { room: string }) {
    socket.to(payload.room).emit('user:left', { id: socket.id });
    socket.leave(payload.room);
  }

  @SubscribeMessage('message')
  onMessage(socket: CarnoSocket, payload: { room: string; text: string }) {
    socket.to(payload.room).emit('message', {
      from: socket.id,
      room: payload.room,
      text: payload.text,
      at: new Date().toISOString(),
    });
  }

  @OnClose()
  onClose(socket: CarnoSocket) {
    socket.to('general').emit('user:left', { id: socket.id });
  }
}
```

```ts
// notifications.controller.ts
import { Controller, Post, Body } from '@carno.js/core';
import { RoomManager } from '@carno.js/websocket';

@Controller('/api/notifications')
export class NotificationsController {
  constructor(private readonly rooms: RoomManager) {}

  @Post('/announce')
  announce(@Body() body: { room: string; message: string }) {
    this.rooms.broadcast(body.room, 'announcement', { text: body.message });
    return { ok: true };
  }
}
```

```ts
// main.ts
import { Carno } from '@carno.js/core';
import { WebSocketPlugin } from '@carno.js/websocket';
import { ChatGateway } from './chat.gateway';
import { NotificationsController } from './notifications.controller';
import { AuthService } from './auth.service';

const app = new Carno();

app.use(WebSocketPlugin.create([ChatGateway], {
  idleTimeout: 120,
  sendPings: true,
}));

app.services([AuthService]);
app.controllers([NotificationsController]);

app.listen(3000);
// WS:   ws://localhost:3000/chat
// HTTP: POST http://localhost:3000/api/notifications/announce
```

## Client-Side Protocol

The client uses a simple JSON protocol to send named events:

```ts
const ws = new WebSocket('ws://localhost:3000/chat');

// Send a named event
ws.send(JSON.stringify({ event: 'message', data: { room: 'general', text: 'Hello!' } }));

// Receive events
ws.onmessage = (e) => {
  const { event, data } = JSON.parse(e.data);
  console.log(event, data);
};
```

For raw messages (non-JSON), use `@OnMessage()` on the server side — anything that is not valid JSON or lacks an `event` field is handled exclusively by `@OnMessage()` handlers.
