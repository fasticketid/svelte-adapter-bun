# WebSocket Example — Chat Room

Simple chat room using Bun's `ServerWebSocket` API. One handler file works in both dev (Vite) and production (Bun.serve()).

## Setup

### 1. Copy the handler into your SvelteKit project

```
cp websocket-handler.js your-project/src/websocket.js
```

### 2. Configure the adapter and plugin

```js
// vite.config.js
import { sveltekit } from '@sveltejs/kit/vite';
import { lifecyclePlugin } from 'svelte-adapter-bun/plugin';

export default {
  plugins: [
    sveltekit(),
    lifecyclePlugin({ websocket: 'src/websocket.js' })
  ]
};
```

```js
// svelte.config.js
import adapter from 'svelte-adapter-bun';

export default {
  kit: {
    adapter: adapter({
      websocket: 'src/websocket.js'
    })
  }
};
```

### 3. Connect from the client

```js
const name = 'alice';
const ws = new WebSocket(`ws://localhost:5173?name=${name}`);

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log(msg);
  // { type: 'system', text: 'welcome, alice' }
  // { type: 'message', from: 'bob', text: 'hello' }
};

ws.onopen = () => {
  ws.send('hello everyone');
};
```

## Handler API

The handler exports up to 4 callbacks that mirror Bun's `ServerWebSocket` handlers:

| Export | Signature | Description |
|--------|-----------|-------------|
| `upgrade` | `(request, server) => void` | Optional. Decide whether to accept. Call `server.upgrade(request, { data })` to accept with per-connection data. |
| `open` | `(ws) => void` | Client connected. Subscribe to topics, send welcome message. |
| `message` | `(ws, message) => void` | Received a message. `message` is `string` or `ArrayBuffer`. |
| `close` | `(ws, code, reason) => void` | Client disconnected. Subscriptions are auto-cleaned. |

## How It Works

**Production:** `Bun.serve({ websocket })` passes your handler callbacks directly. `ws` is a native `ServerWebSocket`.

**Dev mode:** The lifecycle plugin intercepts HTTP upgrade requests on Vite's server, wraps the Node `ws` library connection in a `BunWebSocketShim` that exposes the same `ServerWebSocket` API. Your handler code doesn't need to change.

### Key `ServerWebSocket` methods available in both modes

- `ws.send(data)` / `ws.sendText(data)` / `ws.sendBinary(data)`
- `ws.subscribe(topic)` / `ws.unsubscribe(topic)` / `ws.isSubscribed(topic)`
- `ws.publish(topic, data)` / `ws.publishText()` / `ws.publishBinary()`
- `ws.close(code?, reason?)` / `ws.terminate()`
- `ws.data` — per-connection data set during upgrade
- `ws.remoteAddress` — client IP
- `ws.readyState` — 0 (connecting), 1 (open), 2 (closing), 3 (closed)

## Dev Mode Specifics

- Handler changes are picked up on the next WebSocket connection (HMR for WebSocket handlers)
- Vite's own HMR WebSocket is not intercepted
- Pub/sub works across connections via an in-memory topic registry
- `cork()` is a no-op in dev (no batching needed)
