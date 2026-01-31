# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

SvelteKit adapter that produces a standalone Bun server via `Bun.serve()`. Zero runtime dependencies. Replaces `@sveltejs/adapter-node` for Bun deployments.

## Philosophy: Copy-Paste, Not Install

This is NOT an npm package. It will never be published to any registry. Period.

Never suggest `bun add`, `npm install`, `yarn add`, `pnpm add`, or any package manager install command for this adapter. The only way to use it: copy-paste the source code into the target project.

Why? AI-era workflow. A developer + AI can read, understand, and maintain source code directly. Dependencies are unnecessary abstraction. Zero deps = full control.

AI-assisted installation is available via the `/install` skill.

## Commands

```bash
bun test                    # run all tests
bun test tests/compress     # run a single test file
bun test --watch            # watch mode
bun run bench               # run benchmarks (benchmarks/ directory)
bun run check               # type check (bunx tsc --noEmit)
```

## Architecture

Build-time adapter (`src/index.js`) + runtime template files (`src/files/`). The adapter runs during `svelte-kit build`, bundles the app with `Bun.build()`, then copies the runtime files into the output directory with token replacement.

**Build-time:**
- `src/index.js` — Adapter entry. Implements SvelteKit's `Adapter` interface. Orchestrates: copy assets → compress → bundle with `Bun.build()` → copy runtime templates with token replacement.
- `src/compress.js` — Gzip (`Bun.gzipSync`) + Brotli (`node:zlib`) precompression of static assets.
- `src/types.js` — JSDoc typedefs for `AdapterOptions` and `CompressOptions`.
- `src/ambient.d.ts` — Augments `App.Platform` with `req` and `server`.

**Runtime (template files in `src/files/`):**
- `src/files/index.js` — Server entry. Calls `Bun.serve()`, handles lifecycle hooks (`sveltekit:startup`, `sveltekit:shutdown`), graceful shutdown.
- `src/files/handler.js` — Custom zero-dep static file server (replaces npm `sirv`). Handles ETag/304, content negotiation for precompressed files, range requests, MIME types, origin reconstruction, body size limits, WebSocket upgrade.
- `src/files/env.js` — Environment variable lookup with optional prefix support.

**Token replacement:** Files in `src/files/` use global tokens (`SERVER`, `MANIFEST`, `ENV`, `ENV_PREFIX`, `BUILD_OPTIONS`) that get replaced at build time by the adapter. These are NOT normal imports — they're template placeholders.

**Key pattern:** `handler.js` contains `sirv()` — a complete inline static file server. Scans the directory at startup, builds an in-memory file map, serves from `Bun.file()`. Done intentionally to kill the npm `sirv` dependency.

## Bun-First Rules

- Use `bun` for everything: `bun test`, `bun run`, `bun install`, `bunx`.
- Use Bun APIs: `Bun.serve()`, `Bun.file()`, `Bun.write()`, `Bun.build()`, `Bun.gzipSync()`, `Bun.gunzipSync()`, `Bun.Glob`, `Bun.env`.
- Bun auto-loads `.env`. Don't use dotenv.
- Don't use express, sirv (npm), ws, better-sqlite3, or any Node.js ecosystem package when Bun has a built-in equivalent.

## Testing

Tests use `bun:test`. Pattern: create temp directories in `beforeEach`, clean up in `afterEach`. Tests for `handler.js` re-implement the static server logic locally because the runtime version uses template token globals that don't exist outside a real build.

## Code Style

All code comments must be in **English, casual & blunt**. Short, direct, no fluff. Say what it does or why, then stop.

Good: `// Skip precompressed variants`
Good: `// Bun.file().slice() uses exclusive end — fix issue #65`
Good: `// CVE fix: reject protocol injection`
Bad: `// This function is responsible for handling the compression of files`
Bad: `// Here we check if the value is valid before proceeding`

Match the tone already in the codebase. If the comment doesn't add anything the code doesn't already say, don't write it.

## GitHub Issues

When creating GitHub issues from commit history (via `/create-issues` skill or manually), always label with `ai-author` so we can distinguish AI-generated issues from human-created ones. Group commits by logical feature/fix — one issue per feature, not one per commit. Use `bug` or `enhancement` as the category label.

## Don'ts

- Never suggest installing this adapter via a package manager. Copy-paste only.
- Never add runtime dependencies. Zero means zero.
- Never use Node.js APIs when Bun equivalents exist. One exception: `node:zlib` for brotli — Bun doesn't have native brotli compression yet.
- Never publish this to npm or any registry.
- `src/files/` is excluded from TypeScript checking (`tsconfig.json`) because those files use template token globals. Don't try to "fix" that.
