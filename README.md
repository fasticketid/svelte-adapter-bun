# svelte-adapter-bun

SvelteKit adapter that produces a standalone Bun server via `Bun.serve()`. Zero runtime dependencies.

This is copy-paste source code, not an npm package. You drop it into your project and own it. See [SKILL_INSTALL.md](./SKILL_INSTALL.md) for AI-assisted installation.

## Requirements

- Bun >= 1.3.6
- SvelteKit >= 2.0.0

## Installation

1. Copy the `src/` directory into your SvelteKit project (e.g. as `src/adapter-bun/`)
2. Update `svelte.config.js`:

```js
import adapter from './src/adapter-bun/index.ts';

export default {
  kit: {
    adapter: adapter({
      out: 'build',
      precompress: true
    })
  }
};
```

3. Build and run:

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

```ts
// src/websocket.ts
import type { ServerWebSocket, Server } from 'bun';

export function upgrade(request: Request, server: Server): Response | undefined {
  const success = server.upgrade(request, {
    data: { /* custom data */ }
  });
  if (success) return undefined;
  return new Response('Upgrade failed', { status: 500 });
}

export function open(ws: ServerWebSocket) {
  console.log('Client connected');
}

export function message(ws: ServerWebSocket, message: string | Buffer) {
  ws.send(message);
}

export function close(ws: ServerWebSocket) {
  console.log('Client disconnected');
}
```

Point the adapter at it:

```js
adapter({
  websocket: 'src/websocket.ts'
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

### `sveltekit:startup`

Fires after `Bun.serve()` starts.

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
