# AI Installation Guide: svelte-adapter-bun

This guide helps AI assistants install the svelte-adapter-bun adapter into a SvelteKit project.

## Prerequisites

Before starting, verify:
1. The target project uses SvelteKit 2.x (`@sveltejs/kit` in package.json)
2. The project uses Bun as its runtime (bun.lock exists or user confirms)
3. Bun >= 1.3.6 is installed

## Step 1: Copy Source Files

Copy the entire `src/` directory from this repository into the target project. The recommended location is alongside the project's own source:

```
target-project/
├── src/
│   ├── adapter-bun/       ← Copy src/ contents here
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── compress.ts
│   │   ├── ambient.d.ts
│   │   └── files/
│   │       ├── index.js
│   │       ├── handler.js
│   │       └── env.js
│   ├── routes/
│   └── ...
```

## Step 2: Configure svelte.config.js

Update the SvelteKit config to use the adapter:

```js
import adapter from './src/adapter-bun/index.ts';

/** @type {import('@sveltejs/kit').Config} */
export default {
  kit: {
    adapter: adapter({
      // Ask user about these options:
      out: 'build',           // Where to write build output
      precompress: true,      // Precompress static assets?
      envPrefix: '',          // Environment variable prefix?
      development: false,     // Development mode?
      websocket: false        // Path to WebSocket handler, or false
    })
  }
};
```

## Step 3: Ask the User

Before finalizing configuration, ask about:

1. **Output directory**: Where should the build go? (default: `build`)
2. **Compression**: Should static assets be precompressed? (default: yes)
3. **Environment prefix**: Do they use a prefix for env vars? (default: none)
4. **WebSocket**: Do they need WebSocket support? If yes, ask for the handler file path.
5. **Proxy setup**: Are they behind a reverse proxy? If yes, they should set `PROTOCOL_HEADER`, `HOST_HEADER`, and `PORT_HEADER` environment variables.

## Step 4: Add Type Reference

If the project uses TypeScript, add the ambient types reference. In the project's `src/app.d.ts`:

```ts
/// <reference types="./adapter-bun/ambient" />

declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    interface Platform {
      req: Request;
      server: import('bun').Server;
    }
  }
}

export {};
```

## Step 5: Verify

Run these commands to verify the installation:

```bash
# Type check
bunx tsc --noEmit

# Build
bun run build

# Test the server
cd build && bun ./index.js
```

Then visit `http://localhost:3000` to confirm the app works.

## WebSocket Setup (Optional)

If the user needs WebSocket support:

1. Create a WebSocket handler file (e.g. `src/websocket.ts`):

```ts
import type { ServerWebSocket, Server } from 'bun';

export function upgrade(request: Request, server: Server): Response | undefined {
  const success = server.upgrade(request);
  if (success) return undefined;
  return new Response('Upgrade failed', { status: 500 });
}

export function open(ws: ServerWebSocket) {
  // Handle new connection
}

export function message(ws: ServerWebSocket, message: string | Buffer) {
  // Handle incoming message
  ws.send(message);
}

export function close(ws: ServerWebSocket) {
  // Handle disconnection
}
```

2. Update the adapter config:

```js
adapter({
  websocket: 'src/websocket.ts'
})
```

## Troubleshooting

| Issue | Solution |
|-------|---------|
| Build fails with "module not found" | Ensure `@sveltejs/kit` is installed as a dependency |
| CSRF errors behind proxy | Set `PROTOCOL_HEADER=x-forwarded-proto` and `HOST_HEADER=x-forwarded-host` |
| WebSocket not connecting | Verify the websocket handler file path is correct and exports `upgrade` |
| Port already in use | Set `PORT` env var to a different port |
| Static files not found | Check that `out` matches where you're running the server from |
