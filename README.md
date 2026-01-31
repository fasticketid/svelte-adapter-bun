# svelte-adapter-bun

A [SvelteKit](https://kit.svelte.dev) adapter for [Bun](https://bun.sh). Produces a standalone Bun server using `Bun.serve()` with zero external runtime dependencies.

Distributed as copy-paste source code, not an npm package. See [SKILL_INSTALL.md](./SKILL_INSTALL.md) for AI-assisted installation.

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
| `PROTOCOL_HEADER` | — | Header name for protocol detection behind proxy |
| `HOST_HEADER` | — | Header name for host detection behind proxy |
| `PORT_HEADER` | — | Header name for port detection behind proxy |
| `ADDRESS_HEADER` | — | Header name for client IP (e.g. `x-forwarded-for`) |
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

Configure the adapter:

```js
adapter({
  websocket: 'src/websocket.ts'
})
```

The full `Bun.Server` instance is available via `App.Platform.server` in SvelteKit hooks and endpoints, enabling pub/sub patterns.

## Custom Server Usage

The handler is exported as a composable function for custom server setups:

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

The server emits process-level events for startup and shutdown, allowing you to initialize resources (database connections, caches) and clean them up gracefully.

### `sveltekit:startup`

Emitted after `Bun.serve()` starts. Receives an object with `server`, `host`, `port`, and `socket_path`.

```js
process.on('sveltekit:startup', async ({ server, host, port, socket_path }) => {
  await db.connect();
  console.log(`DB connected, server listening on ${host}:${port}`);
});
```

### `sveltekit:shutdown`

Emitted on `SIGINT` or `SIGTERM` after `server.stop()` is called. Receives the signal name as a string. A `SHUTDOWN_TIMEOUT` (default 30s) guard will force-exit if listeners take too long.

```js
process.on('sveltekit:shutdown', async (reason) => {
  console.log(`Shutting down: ${reason}`);
  await db.disconnect();
  await cache.flush();
});
```

## Type Augmentations

The adapter augments `App.Platform` with:

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
  // Use for WebSocket pub/sub, requestIP, etc.
  return resolve(event);
}
```

## Deployment

### Standalone

```bash
bun run build
cd build
bun ./index.js
```

### Docker

```dockerfile
FROM oven/bun:1 AS build
WORKDIR /app
COPY . .
RUN bun install && bun run build

FROM oven/bun:1
WORKDIR /app
COPY --from=build /app/build ./
EXPOSE 3000
CMD ["bun", "./index.js"]
```

### systemd

```ini
[Unit]
Description=SvelteKit App
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/app/build
ExecStart=/usr/local/bin/bun ./index.js
Restart=on-failure
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

### Reverse Proxy

When running behind a reverse proxy, set the appropriate headers so SvelteKit can determine the client's real protocol, host, and IP:

```bash
PROTOCOL_HEADER=x-forwarded-proto
HOST_HEADER=x-forwarded-host
ADDRESS_HEADER=x-forwarded-for
XFF_DEPTH=1
```

#### nginx

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }
}
```

#### Caddy

```caddyfile
example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy automatically sets `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host`.

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
