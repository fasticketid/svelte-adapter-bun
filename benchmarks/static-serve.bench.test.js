import { test, describe, afterAll, beforeAll } from 'bun:test';
import { mkdirSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { bench, formatTable, tmpDir } from './helpers.js';

/** @typedef {import('./helpers.js').BenchResult} BenchResult */

/** @type {Record<string, string>} */
const MIME_TYPES = {
	'.html': 'text/html',
	'.css': 'text/css',
	'.js': 'application/javascript',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.txt': 'text/plain',
	'.wasm': 'application/wasm',
	'.map': 'application/json'
};

/**
 * @param {string} name
 * @returns {string}
 */
function get_mime(name) {
	const ext = name.slice(name.lastIndexOf('.'));
	return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * @typedef {Object} FileEntry
 * @property {string} abs
 * @property {number} size
 * @property {number} mtime
 * @property {string} etag
 * @property {string} type
 * @property {boolean} has_br
 * @property {boolean} has_gz
 */

/**
 * Build a static file server handler (ported from tests/handler.test.js).
 * This is the exact runtime logic our adapter uses.
 *
 * @param {string} dir
 * @returns {(request: Request) => Response | null}
 */
function build_file_server(dir) {
	/** @type {Map<string, FileEntry>} */
	const files = new Map();

	/**
	 * @param {string} current_dir
	 * @param {string} [prefix='']
	 */
	function scan(current_dir, prefix = '') {
		const entries = readdirSync(current_dir);
		for (const entry of entries) {
			const abs = join(current_dir, entry);
			const rel = prefix ? prefix + '/' + entry : entry;
			const stats = statSync(abs);
			if (stats.isDirectory()) {
				scan(abs, rel);
			} else if (!rel.endsWith('.br') && !rel.endsWith('.gz')) {
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

				files.set('/' + rel, {
					abs,
					size: stats.size,
					mtime: stats.mtimeMs,
					etag: `W/"${stats.size}-${stats.mtimeMs}"`,
					type: get_mime(rel),
					has_br,
					has_gz
				});
			}
		}
	}
	scan(dir);

	/**
	 * @param {Request} request
	 * @returns {Response | null}
	 */
	return function handle(request) {
		const url = new URL(request.url);
		const file = files.get(url.pathname);
		if (!file) return null;

		const headers = new Headers({
			'Content-Type': file.type,
			'Content-Length': String(file.size),
			'Last-Modified': new Date(file.mtime).toUTCString(),
			ETag: file.etag
		});

		// 304 Not Modified
		const if_none_match = request.headers.get('if-none-match');
		if (if_none_match === file.etag) {
			return new Response(null, { status: 304, headers });
		}

		// Content negotiation
		const accept_encoding = request.headers.get('accept-encoding') || '';
		let serve_path = file.abs;
		/** @type {string | null} */
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
			headers.set('Vary', 'Accept-Encoding');
		}

		// Range requests
		const range_header = request.headers.get('range');
		if (range_header && !content_encoding) {
			const match = range_header.match(/bytes=(\d+)-(\d*)/);
			if (match) {
				const start = parseInt(/** @type {string} */ (match[1]), 10);
				const end = match[2] ? parseInt(match[2], 10) : file.size - 1;

				if (start >= file.size || end >= file.size || start > end) {
					return new Response(null, {
						status: 416,
						headers: { 'Content-Range': `bytes */${file.size}` }
					});
				}

				headers.set('Content-Range', `bytes ${start}-${end}/${file.size}`);
				headers.set('Content-Length', String(end - start + 1));

				return new Response(Bun.file(serve_path).slice(start, end + 1), {
					status: 206,
					headers
				});
			}
		}

		return new Response(Bun.file(serve_path), { headers });
	};
}

/** @type {{ path: string, cleanup: () => void }} */
let tmp;
/** @type {(request: Request) => Response | null} */
let handle;
/** @type {string} */
let etag;

const ITERATIONS = 5000;
/** @type {BenchResult[]} */
const allResults = [];

beforeAll(() => {
	tmp = tmpDir('static-serve');

	// Create fixture files with precompressed variants
	const htmlContent =
		'<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>';
	const jsContent = 'console.log("hello world"); export default function main() { return 42; }';
	const cssContent =
		'body { margin: 0; padding: 0; } h1 { color: blue; } .container { max-width: 1200px; }';

	writeFileSync(join(tmp.path, 'index.html'), htmlContent);
	writeFileSync(join(tmp.path, 'app.js'), jsContent);
	writeFileSync(join(tmp.path, 'style.css'), cssContent);

	// Create precompressed files
	const htmlBuf = new TextEncoder().encode(htmlContent);
	const jsBuf = new TextEncoder().encode(jsContent);

	writeFileSync(join(tmp.path, 'index.html.gz'), Bun.gzipSync(htmlBuf));
	writeFileSync(join(tmp.path, 'index.html.br'), Bun.gzipSync(htmlBuf)); // Simulated .br
	writeFileSync(join(tmp.path, 'app.js.gz'), Bun.gzipSync(jsBuf));
	writeFileSync(join(tmp.path, 'app.js.br'), Bun.gzipSync(jsBuf)); // Simulated .br

	handle = build_file_server(tmp.path);

	// Get ETag for 304 tests
	const first = /** @type {Response} */ (handle(new Request('http://localhost/index.html')));
	etag = /** @type {string} */ (first.headers.get('etag'));
});

describe('Static file handler latency', () => {
	test('200 — normal response', () => {
		allResults.push(
			bench(
				'200 response',
				() => {
					handle(new Request('http://localhost/index.html'));
				},
				ITERATIONS
			)
		);
	});

	test('304 — ETag cache hit', () => {
		allResults.push(
			bench(
				'304 ETag cache hit',
				() => {
					handle(
						new Request('http://localhost/index.html', {
							headers: { 'If-None-Match': etag }
						})
					);
				},
				ITERATIONS
			)
		);
	});

	test('200 — Brotli content negotiation', () => {
		allResults.push(
			bench(
				'200 + br negotiation',
				() => {
					handle(
						new Request('http://localhost/app.js', {
							headers: { 'Accept-Encoding': 'gzip, br' }
						})
					);
				},
				ITERATIONS
			)
		);
	});

	test('200 — Gzip content negotiation', () => {
		allResults.push(
			bench(
				'200 + gzip negotiation',
				() => {
					handle(
						new Request('http://localhost/app.js', {
							headers: { 'Accept-Encoding': 'gzip' }
						})
					);
				},
				ITERATIONS
			)
		);
	});

	test('206 — Range request', () => {
		allResults.push(
			bench(
				'206 range request',
				() => {
					handle(
						new Request('http://localhost/index.html', {
							headers: { Range: 'bytes=0-50' }
						})
					);
				},
				ITERATIONS
			)
		);
	});

	test('null — cache miss (non-existent)', () => {
		allResults.push(
			bench(
				'null (cache miss)',
				() => {
					handle(new Request('http://localhost/nonexistent.html'));
				},
				ITERATIONS
			)
		);
	});
});

afterAll(() => {
	console.log('\n╔══════════════════════════════════════════════════╗');
	console.log('║        Static File Handler Latency               ║');
	console.log('╠══════════════════════════════════════════════════╣');

	formatTable('Handler response types', allResults);

	tmp.cleanup();
});
