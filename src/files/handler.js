/* global SERVER, MANIFEST, ENV, ENV_PREFIX, BUILD_OPTIONS */

import { Server } from 'SERVER';
import { manifest, prerendered, base_path } from 'MANIFEST';
import { env } from 'ENV';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const server = new Server(manifest);
await server.init({ env: Bun.env });

/** @type {Record<string, string>} */
const MIME_TYPES = {
	'.html': 'text/html',
	'.htm': 'text/html',
	'.css': 'text/css',
	'.js': 'application/javascript',
	'.mjs': 'application/javascript',
	'.cjs': 'application/javascript',
	'.json': 'application/json',
	'.xml': 'application/xml',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.eot': 'application/vnd.ms-fontobject',
	'.wasm': 'application/wasm',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.mp3': 'audio/mpeg',
	'.ogg': 'audio/ogg',
	'.wav': 'audio/wav',
	'.pdf': 'application/pdf',
	'.zip': 'application/zip',
	'.gz': 'application/gzip',
	'.br': 'application/x-brotli',
	'.map': 'application/json',
	'.txt': 'text/plain',
	'.md': 'text/markdown',
	'.yaml': 'text/yaml',
	'.yml': 'text/yaml',
	'.toml': 'text/toml',
	'.webmanifest': 'application/manifest+json'
};

/**
 * Get MIME type from file extension. Falls back to application/octet-stream.
 * @param {string} name
 * @returns {string}
 * @example get_mime('app.js') // 'application/javascript'
 * @example get_mime('font.woff2') // 'font/woff2'
 */
function get_mime(name) {
	const ext = extname(name).toLowerCase();
	return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Recursively scan a directory and invoke callback for each file.
 * @param {string} dir
 * @param {(relative_path: string, absolute_path: string, stats: import('node:fs').Stats) => void} callback
 * @param {string} [prefix]
 */
function totalist(dir, callback, prefix = '') {
	const entries = readdirSync(dir);
	for (const entry of entries) {
		const abs = join(dir, entry);
		const rel = prefix ? prefix + '/' + entry : entry;
		const stats = statSync(abs);
		if (stats.isDirectory()) {
			totalist(abs, callback, rel);
		} else {
			callback(rel, abs, stats);
		}
	}
}

/**
 * Build an inline static file server (replaces sirv).
 * @param {string} dir - Directory to serve
 * @param {{ etag?: boolean, setHeaders?: (headers: Headers, pathname: string) => void }} [opts]
 */
function sirv(dir, opts = {}) {
	const use_etag = opts.etag !== false;

	/** @type {Map<string, { abs: string, size: number, mtime: number, etag: string | null, type: string, has_br: boolean, has_gz: boolean }>} */
	const files = new Map();

	// Scan all files (skip if directory doesn't exist, e.g. no prerendered pages)
	if (!existsSync(dir)) return () => null;

	totalist(dir, (rel, abs, stats) => {
		// Skip precompressed variants
		if (rel.endsWith('.br') || rel.endsWith('.gz')) return;

		const type = get_mime(rel);
		const mtime = stats.mtimeMs;
		const etag = use_etag ? `W/"${stats.size}-${mtime}"` : null;

		// Check for precompressed versions
		let has_br = false;
		let has_gz = false;
		try {
			statSync(abs + '.br');
			has_br = true;
		} catch {}
		try {
			statSync(abs + '.gz');
			has_gz = true;
		} catch {}

		files.set('/' + rel, { abs, size: stats.size, mtime, etag, type, has_br, has_gz });
	});

	/**
	 * @param {Request} request
	 * @returns {Response | null}
	 */
	return function handle(request) {
		const url = new URL(request.url);
		let pathname = url.pathname;

		// Strip base path
		if (base_path && pathname.startsWith(base_path)) {
			pathname = pathname.slice(base_path.length) || '/';
		}

		const file = files.get(pathname);
		if (!file) return null;

		const headers = new Headers({
			'Content-Type': file.type,
			'Content-Length': String(file.size),
			'Last-Modified': new Date(file.mtime).toUTCString()
		});

		if (file.etag) {
			headers.set('ETag', file.etag);
		}

		// Custom headers callback
		if (opts.setHeaders) {
			opts.setHeaders(headers, pathname);
		}

		// Handle If-None-Match → 304
		if (file.etag) {
			const if_none_match = request.headers.get('if-none-match');
			if (if_none_match === file.etag) {
				return new Response(null, { status: 304, headers });
			}
		}

		// Content negotiation for precompressed files
		const accept_encoding = request.headers.get('accept-encoding') || '';
		let serve_path = file.abs;
		let content_encoding = null;

		if (file.has_br && accept_encoding.includes('br')) {
			serve_path = file.abs + '.br';
			content_encoding = 'br';
			headers.set('Content-Encoding', 'br');
			headers.set('Vary', 'Accept-Encoding');
			headers.delete('Content-Length');
		} else if (file.has_gz && accept_encoding.includes('gzip')) {
			serve_path = file.abs + '.gz';
			content_encoding = 'gzip';
			headers.set('Content-Encoding', 'gzip');
			headers.set('Vary', 'Accept-Encoding');
			headers.delete('Content-Length');
		} else if (file.has_br || file.has_gz) {
			// Even uncompressed response should have Vary if compressed exists
			headers.set('Vary', 'Accept-Encoding');
		}

		// Range requests (only for non-compressed files)
		const range_header = request.headers.get('range');
		if (range_header && !content_encoding) {
			const match = range_header.match(/bytes=(\d+)-(\d*)/);
			if (match) {
				const start = parseInt(match[1], 10);
				const end = match[2] ? parseInt(match[2], 10) : file.size - 1;

				if (start >= file.size || end >= file.size || start > end) {
					return new Response(null, {
						status: 416,
						headers: {
							'Content-Range': `bytes */${file.size}`
						}
					});
				}

				headers.set('Content-Range', `bytes ${start}-${end}/${file.size}`);
				headers.set('Content-Length', String(end - start + 1));

				// Bun.file().slice() uses exclusive end — fix issue #65
				return new Response(Bun.file(serve_path).slice(start, end + 1), {
					status: 206,
					headers
				});
			}
		}

		return new Response(Bun.file(serve_path), { headers });
	};
}

const protocol_header = BUILD_OPTIONS.protocol_header?.toLowerCase();
const host_header = BUILD_OPTIONS.host_header?.toLowerCase();
const port_header = BUILD_OPTIONS.port_header?.toLowerCase();

/**
 * Reconstruct request origin from proxy headers.
 * CVE fix: rejects protocol injection via colon in header value (issues #83, #62, #54, #58).
 * @param {Headers} headers
 * @returns {string}
 */
function get_origin(headers) {
	const protocol = decodeURIComponent(
		(protocol_header && headers.get(protocol_header)) || 'https'
	);

	// CVE fix: reject protocol injection
	if (protocol.includes(':')) {
		throw new Error(`Invalid protocol header: contains ':'`);
	}

	const host = (host_header && headers.get(host_header)) || headers.get('host');
	if (!host) {
		throw new Error('Could not determine host');
	}

	const port = port_header && headers.get(port_header);
	if (port && isNaN(+port)) {
		throw new Error(`Invalid port: ${port}`);
	}

	return port ? `${protocol}://${host}:${port}` : `${protocol}://${host}`;
}

// --- Body size limit ---

/**
 * Parse a human-readable byte size string (e.g. "512K", "10M", "1G").
 * @param {string | number | undefined} input
 * @returns {number} bytes, or Infinity if unset
 * @example parse_body_size_limit('10M') // 10485760
 * @example parse_body_size_limit(undefined) // Infinity
 */
function parse_body_size_limit(input) {
	if (input === undefined || input === null) return Infinity;
	if (typeof input === 'number') return input;

	const match = input.toString().toUpperCase().match(/^(\d+(?:\.\d+)?)\s*(K|M|G|KB|MB|GB)?B?$/);
	if (!match) {
		throw new Error(`Invalid BODY_SIZE_LIMIT value: "${input}"`);
	}

	const num = parseFloat(match[1]);
	const unit = match[2];

	switch (unit) {
		case 'K':
		case 'KB':
			return num * 1024;
		case 'M':
		case 'MB':
			return num * 1024 * 1024;
		case 'G':
		case 'GB':
			return num * 1024 * 1024 * 1024;
		default:
			return num;
	}
}

// --- Build handler ---

const origin = env('ORIGIN');
const xff_depth = parseInt(env('XFF_DEPTH', '1'));
const address_header = env('ADDRESS_HEADER')?.toLowerCase();
const body_size_limit = parse_body_size_limit(env('BODY_SIZE_LIMIT'));

/**
 * Create a composable fetch handler with static file serving, prerendered pages, and SSR.
 * Returns httpserver (fetch handler) and websocket config for Bun.serve().
 * @param {{ build_options?: typeof BUILD_OPTIONS }} [options]
 * @example const { httpserver, websocket } = createHandler()
 */
export default function createHandler(options = {}) {
	const build_options = options.build_options || BUILD_OPTIONS;

	// Set up static file servers — resolve relative to this file, not CWD
	const client_dir = join(import.meta.dir, build_options.client_directory);
	const prerendered_dir = join(import.meta.dir, build_options.prerendered_directory);

	const serve_client = sirv(client_dir, {
		etag: true,
		setHeaders(headers, pathname) {
			if (pathname.startsWith('/_app/immutable/')) {
				headers.set('Cache-Control', 'public,max-age=31536000,immutable');
			}
		}
	});

	const serve_prerendered = sirv(prerendered_dir, { etag: true });

	/**
	 * Main fetch handler.
	 * @param {Request} request
	 * @param {import('bun').Server} bun_server
	 * @returns {Promise<Response>}
	 */
	async function httpserver(request, bun_server) {
		const url = new URL(request.url);

		// Check if this is a WebSocket upgrade request
		if (build_options.websocket) {
			const connection = request.headers.get('connection')?.toLowerCase();
			const upgrade = request.headers.get('upgrade')?.toLowerCase();

			if (connection?.includes('upgrade') && upgrade === 'websocket') {
				try {
					const ws_module = await import(build_options.websocket_path);
					if (ws_module.upgrade) {
						const result = ws_module.upgrade(request, bun_server);
						if (result) return result;
					} else {
						// Default upgrade behavior
						const success = bun_server.upgrade(request);
						if (success) return undefined;
					}
				} catch (e) {
					console.error('WebSocket upgrade failed:', e);
				}
			}
		}

		// Try static files first
		const static_response = serve_client(request);
		if (static_response) return static_response;

		// Try prerendered pages
		let prerendered_path = url.pathname;
		if (base_path && prerendered_path.startsWith(base_path)) {
			prerendered_path = prerendered_path.slice(base_path.length) || '/';
		}

		// Exact match — serve directly
		if (prerendered.has(prerendered_path)) {
			const prerendered_response = serve_prerendered(request);
			if (prerendered_response) return prerendered_response;
		}

		// Toggle trailing slash — 308 redirect if alternate exists
		const toggled = prerendered_path.endsWith('/')
			? prerendered_path.slice(0, -1)
			: prerendered_path + '/';

		if (prerendered.has(toggled)) {
			let location = base_path ? base_path + toggled : toggled;
			if (url.search) location += url.search;
			return new Response(null, {
				status: 308,
				headers: { location }
			});
		}

		// SSR handler
		let request_for_ssr = request;

		// Reconstruct request with correct origin if needed
		const request_origin = origin || get_origin(request.headers);

		if (request.url !== request_origin + url.pathname + url.search) {
			request_for_ssr = new Request(request_origin + url.pathname + url.search, {
				method: request.method,
				headers: request.headers,
				body: request.body,
				// @ts-ignore - Bun supports duplex
				duplex: request.body ? 'half' : undefined
			});
		}

		// Check body size limit
		if (request.body && body_size_limit !== Infinity) {
			const content_length = request.headers.get('content-length');
			if (content_length && parseInt(content_length) > body_size_limit) {
				return new Response('Payload Too Large', { status: 413 });
			}
		}

		// Get client address
		const getClientAddress = () => {
			if (address_header) {
				const value = request.headers.get(address_header);
				if (value) {
					// XFF can be a comma-separated list
					if (xff_depth > 0 && address_header === 'x-forwarded-for') {
						const addresses = value.split(',').map((s) => s.trim());
						// XFF depth of 1 means trust the last proxy
						return addresses[Math.max(0, addresses.length - xff_depth)] || value;
					}
					return value;
				}
			}

			// Bun-native fallback — use server.requestIP()
			const ip = bun_server.requestIP(request);
			return ip?.address || '127.0.0.1';
		};

		return server.respond(request_for_ssr, {
			getClientAddress,
			platform: {
				req: request,
				server: bun_server
			}
		});
	}

	// Build websocket config if enabled
	let websocket = undefined;
	if (build_options.websocket) {
		try {
			// Dynamic import handled at runtime
			const ws_path = build_options.websocket_path;
			websocket = {
				async open(ws) {
					const ws_module = await import(ws_path);
					ws_module.open?.(ws);
				},
				async message(ws, message) {
					const ws_module = await import(ws_path);
					ws_module.message?.(ws, message);
				},
				async close(ws, code, reason) {
					const ws_module = await import(ws_path);
					ws_module.close?.(ws, code, reason);
				},
				async drain(ws) {
					const ws_module = await import(ws_path);
					ws_module.drain?.(ws);
				}
			};
		} catch {
			// WebSocket module not found, skip
		}
	}

	return { httpserver, websocket };
}

const build_options = BUILD_OPTIONS;
export { env, build_options };
