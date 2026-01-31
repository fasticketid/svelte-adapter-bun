# svelte-adapter-bun

SvelteKit adapter that produces a standalone Bun server via `Bun.serve()`. Zero runtime dependencies.

**I'm not vibing, I am cooking.**

This is copy-paste source code, not an npm package. You drop it into your project and own it. Or install directly from GitHub if you prefer.

## Requirements

- Bun >= 1.3.6
- SvelteKit >= 2.0.0

## Installation

Two ways to install. Pick one.

### Option A: Copy-paste (recommended)

Full control, no dependency, you own the code. Best for AI-assisted workflows.

1. Copy the `src/` directory into your SvelteKit project (e.g. as `src/adapter-bun/`)
2. Update `svelte.config.js`:

```js
import adapter from './src/adapter-bun/index.js';

export default {
  kit: {
    adapter: adapter({
      out: 'build',
      precompress: true
    })
  }
};
```

3. Add the lifecycle plugin to `vite.config.js`:

```js
import { sveltekit } from '@sveltejs/kit/vite';
import { lifecyclePlugin } from './src/adapter-bun/plugin.js';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit(), lifecyclePlugin()]
});
```

This is **required** for `sveltekit:startup` and `sveltekit:shutdown` events to work in dev and preview modes. Without it, lifecycle hooks in `hooks.server.js` won't fire during development.

If you use WebSocket, pass the handler path:

```js
lifecyclePlugin({ websocket: 'src/websocket.js' })
```

For AI-assisted installation with more detail, use the `/install` skill in Claude Code.

### Option B: Install from GitHub

If you prefer a traditional dependency install:

```bash
bun add github:binsarjr/svelte-adapter-bun
```

Then in `svelte.config.js`:

```js
import adapter from 'svelte-adapter-bun';

export default {
  kit: {
    adapter: adapter({
      out: 'build',
      precompress: true
    })
  }
};
```

And in `vite.config.js`:

```js
import { sveltekit } from '@sveltejs/kit/vite';
import { lifecyclePlugin } from 'svelte-adapter-bun/plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit(), lifecyclePlugin()]
});
```

> **Note:** This pulls directly from the GitHub repo, not npm. Updates require `bun update svelte-adapter-bun` or re-installing. You won't be able to edit the adapter source directly — use Option A if you want that.

### After installing (both options)

4. Run dev with Bun native APIs:

```bash
bunx --bun vite dev
```

Plain `vite dev` runs under Node.js — Bun-specific APIs like `Bun.serve()`, `Bun.file()`, etc. won't be available. The plugin warns you if Bun runtime is not detected.

5. Build and run production:

```bash
bun run build
cd build && bun ./index.js
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `out` | `string` | `'build'` | Build output directory |
| `precompress` | `boolean \| CompressOptions` | `true` | Precompress static assets with gzip/brotli |
| `envPrefix` | `string` | `''` | Prefix for environment variable lookups |
| `development` | `boolean` | `false` | Enable development mode |
| `websocket` | `string \| false` | `false` | Path to WebSocket handler file |

### Compression Options

When `precompress` is an object:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `files` | `string[]` | (see below) | File extensions to compress |
| `gzip` | `boolean` | `true` | Enable gzip compression |
| `brotli` | `boolean` | `true` | Enable brotli compression |

Default compressed extensions: `html, js, json, css, svg, xml, wasm, txt, ico, mjs, cjs, map`

## Environment Variables

All variables support an optional prefix configured via `envPrefix`.

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | Server listen address |
| `PORT` | `3000` | Server listen port |
| `ORIGIN` | (auto) | Override origin URL for request construction |
| `SOCKET_PATH` | — | Unix socket path (overrides HOST/PORT) |
| `PROTOCOL_HEADER` | — | Header for protocol detection behind proxy |
| `HOST_HEADER` | — | Header for host detection behind proxy |
| `PORT_HEADER` | — | Header for port detection behind proxy |
| `ADDRESS_HEADER` | — | Header for client IP (e.g. `x-forwarded-for`) |
| `XFF_DEPTH` | `1` | Trusted proxy depth for X-Forwarded-For |
| `BODY_SIZE_LIMIT` | `Infinity` | Max request body size (supports K/M/G suffixes) |
| `SHUTDOWN_TIMEOUT` | `30` | Seconds to wait during graceful shutdown |
| `IDLE_TIMEOUT` | `0` | Connection idle timeout in seconds |

## WebSocket Support

Create a WebSocket handler file:

```js
// src/websocket.js

/** @param {Request} request @param {import('bun').Server} server */
export function upgrade(request, server) {
  const success = server.upgrade(request, {
    data: { /* custom data */ }
  });
  if (success) return undefined;
  return new Response('Upgrade failed', { status: 500 });
}

/** @param {import('bun').ServerWebSocket} ws */
export function open(ws) {
  console.log('Client connected');
}

/** @param {import('bun').ServerWebSocket} ws @param {string | Buffer} message */
export function message(ws, message) {
  ws.send(message);
}

/** @param {import('bun').ServerWebSocket} ws */
export function close(ws) {
  console.log('Client disconnected');
}
```

Point the adapter at it:

```js
adapter({
  websocket: 'src/websocket.js'
})
```

The `Bun.Server` instance is on `event.platform.server` in SvelteKit hooks and endpoints — use it for pub/sub, `requestIP()`, etc.

## Custom Server Usage

The handler is exported as a composable function:

```js
import createHandler from './handler.js';

const { httpserver, websocket } = createHandler();

Bun.serve({
  fetch: httpserver,
  websocket,
  port: 8080
});
```

## Lifecycle Hooks

The server emits process-level events for startup and shutdown. Use them to init and tear down resources like DB connections or caches.

These events work in all modes:
- **Production** — fired by the Bun runtime (`src/files/index.js`)
- **Dev / Preview** — fired by the Vite lifecycle plugin (`src/plugin.js`). You **must** add `lifecyclePlugin()` to your `vite.config.js` (see Installation step 3)

In dev mode, `hooks.server.js` loads lazily on the first request. The plugin handles this with sticky event replay — late listeners automatically receive events they missed.

### `sveltekit:startup`

Fires after `Bun.serve()` starts (production) or after the Vite HTTP server is listening (dev/preview).

```js
process.on('sveltekit:startup', async ({ server, host, port, socket_path }) => {
  await db.connect();
  console.log(`DB connected, server listening on ${host}:${port}`);
});
```

### `sveltekit:shutdown`

Fires on `SIGINT`/`SIGTERM` after `server.stop()`. A `SHUTDOWN_TIMEOUT` guard (default 30s) force-exits if listeners hang.

```js
process.on('sveltekit:shutdown', async (reason) => {
  await db.disconnect();
  await cache.flush();
});
```

## Type Augmentations

The adapter augments `App.Platform`:

```ts
interface Platform {
  req: Request;           // Original Bun request
  server: import('bun').Server;  // Bun server instance
}
```

Access in hooks or endpoints:

```ts
export function handle({ event, resolve }) {
  const bunServer = event.platform.server;
  return resolve(event);
}
```

## Differences from adapter-node

| Feature | adapter-node | adapter-bun |
|---------|-------------|-------------|
| Runtime | Node.js | Bun |
| Bundler | Rollup | Bun.build() |
| Static server | sirv (npm) | Built-in (zero deps) |
| Compression | node:zlib streams | Bun.gzipSync + node:zlib brotli |
| WebSocket | Not supported | Native Bun WebSocket |
| File serving | fs streams | Bun.file() |
| Client IP | Hardcoded fallback | Bun server.requestIP() |
| Dependencies | rollup, sirv, tiny-glob, etc. | Zero runtime deps |
