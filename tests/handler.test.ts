import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TMP_DIR = join(import.meta.dir, '.tmp-handler');

// Re-implement the static file server logic for unit testing.
// The runtime version lives in handler.js as a template file with global tokens.

const MIME_TYPES: Record<string, string> = {
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

function get_mime(name: string): string {
	const ext = name.slice(name.lastIndexOf('.'));
	return MIME_TYPES[ext] || 'application/octet-stream';
}

function build_file_server(dir: string) {
	const { readdirSync } = require('node:fs');

	type FileEntry = {
		abs: string;
		size: number;
		mtime: number;
		etag: string;
		type: string;
		has_br: boolean;
		has_gz: boolean;
	};

	const files = new Map<string, FileEntry>();

	function scan(current_dir: string, prefix = '') {
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

	return function handle(request: Request): Response | null {
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
		let content_encoding: string | null = null;

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
				const start = parseInt(match[1]!, 10);
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

beforeEach(() => {
	mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
	rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('ETag and 304', () => {
	test('returns 200 with ETag on first request', () => {
		writeFileSync(join(TMP_DIR, 'index.html'), '<h1>Hello</h1>');

		const handle = build_file_server(TMP_DIR);
		const req = new Request('http://localhost/index.html');
		const res = handle(req);

		expect(res).not.toBeNull();
		expect(res!.status).toBe(200);
		expect(res!.headers.get('etag')).toMatch(/^W\/"/);
	});

	test('returns 304 when ETag matches', () => {
		writeFileSync(join(TMP_DIR, 'index.html'), '<h1>Hello</h1>');

		const handle = build_file_server(TMP_DIR);

		// First request to get ETag
		const first = handle(new Request('http://localhost/index.html'));
		const etag = first!.headers.get('etag')!;

		// Second request with If-None-Match
		const second = handle(
			new Request('http://localhost/index.html', {
				headers: { 'If-None-Match': etag }
			})
		);

		expect(second!.status).toBe(304);
	});

	test('returns 200 when ETag does not match', () => {
		writeFileSync(join(TMP_DIR, 'index.html'), '<h1>Hello</h1>');

		const handle = build_file_server(TMP_DIR);
		const res = handle(
			new Request('http://localhost/index.html', {
				headers: { 'If-None-Match': 'W/"wrong"' }
			})
		);

		expect(res!.status).toBe(200);
	});
});

describe('Range requests (206)', () => {
	test('returns 206 for valid byte range', async () => {
		const content = 'Hello, World!';
		writeFileSync(join(TMP_DIR, 'data.txt'), content);

		const handle = build_file_server(TMP_DIR);
		const res = handle(
			new Request('http://localhost/data.txt', {
				headers: { Range: 'bytes=0-4' }
			})
		);

		expect(res!.status).toBe(206);
		expect(res!.headers.get('content-range')).toBe(`bytes 0-4/${content.length}`);

		const body = await res!.text();
		expect(body).toBe('Hello');
	});

	test('returns correct range at end of file', async () => {
		const content = 'Hello, World!';
		writeFileSync(join(TMP_DIR, 'data.txt'), content);

		const handle = build_file_server(TMP_DIR);
		const res = handle(
			new Request('http://localhost/data.txt', {
				headers: { Range: 'bytes=7-12' }
			})
		);

		expect(res!.status).toBe(206);
		const body = await res!.text();
		expect(body).toBe('World!');
	});

	test('returns 416 for out-of-range request', () => {
		writeFileSync(join(TMP_DIR, 'small.txt'), 'hi');

		const handle = build_file_server(TMP_DIR);
		const res = handle(
			new Request('http://localhost/small.txt', {
				headers: { Range: 'bytes=100-200' }
			})
		);

		expect(res!.status).toBe(416);
	});
});

describe('precompressed file negotiation', () => {
	test('serves brotli when client accepts br', () => {
		writeFileSync(join(TMP_DIR, 'app.js'), 'console.log("hello")');
		writeFileSync(join(TMP_DIR, 'app.js.br'), 'brotli-compressed');
		writeFileSync(join(TMP_DIR, 'app.js.gz'), 'gzip-compressed');

		const handle = build_file_server(TMP_DIR);
		const res = handle(
			new Request('http://localhost/app.js', {
				headers: { 'Accept-Encoding': 'gzip, br' }
			})
		);

		expect(res!.headers.get('content-encoding')).toBe('br');
		expect(res!.headers.get('vary')).toBe('Accept-Encoding');
	});

	test('serves gzip when client only accepts gzip', () => {
		writeFileSync(join(TMP_DIR, 'app.js'), 'console.log("hello")');
		writeFileSync(join(TMP_DIR, 'app.js.br'), 'brotli-compressed');
		writeFileSync(join(TMP_DIR, 'app.js.gz'), 'gzip-compressed');

		const handle = build_file_server(TMP_DIR);
		const res = handle(
			new Request('http://localhost/app.js', {
				headers: { 'Accept-Encoding': 'gzip' }
			})
		);

		expect(res!.headers.get('content-encoding')).toBe('gzip');
	});

	test('serves original when client accepts no encoding', () => {
		writeFileSync(join(TMP_DIR, 'app.js'), 'console.log("hello")');
		writeFileSync(join(TMP_DIR, 'app.js.br'), 'brotli-compressed');
		writeFileSync(join(TMP_DIR, 'app.js.gz'), 'gzip-compressed');

		const handle = build_file_server(TMP_DIR);
		const res = handle(new Request('http://localhost/app.js'));

		expect(res!.headers.get('content-encoding')).toBeNull();
		expect(res!.headers.get('vary')).toBe('Accept-Encoding');
	});

	test('sets Vary header even for uncompressed response when compressed exists', () => {
		writeFileSync(join(TMP_DIR, 'style.css'), 'body{}');
		writeFileSync(join(TMP_DIR, 'style.css.gz'), 'gzipped');

		const handle = build_file_server(TMP_DIR);
		const res = handle(new Request('http://localhost/style.css'));

		expect(res!.headers.get('vary')).toBe('Accept-Encoding');
	});
});

describe('MIME types', () => {
	test('serves html with correct content type', () => {
		writeFileSync(join(TMP_DIR, 'page.html'), '<h1>Test</h1>');

		const handle = build_file_server(TMP_DIR);
		const res = handle(new Request('http://localhost/page.html'));

		expect(res!.headers.get('content-type')).toBe('text/html');
	});

	test('serves js with correct content type', () => {
		writeFileSync(join(TMP_DIR, 'script.js'), 'void 0');

		const handle = build_file_server(TMP_DIR);
		const res = handle(new Request('http://localhost/script.js'));

		expect(res!.headers.get('content-type')).toBe('application/javascript');
	});

	test('returns null for non-existent files', () => {
		const handle = build_file_server(TMP_DIR);
		const res = handle(new Request('http://localhost/nonexistent.html'));

		expect(res).toBeNull();
	});
});

describe('Content-Length', () => {
	test('includes content-length header', () => {
		const content = 'Hello, World!';
		writeFileSync(join(TMP_DIR, 'test.txt'), content);

		const handle = build_file_server(TMP_DIR);
		const res = handle(new Request('http://localhost/test.txt'));

		expect(res!.headers.get('content-length')).toBe(String(content.length));
	});

	test('omits content-length for compressed responses', () => {
		writeFileSync(join(TMP_DIR, 'app.js'), 'console.log("hello")');
		writeFileSync(join(TMP_DIR, 'app.js.gz'), 'gzipped-content');

		const handle = build_file_server(TMP_DIR);
		const res = handle(
			new Request('http://localhost/app.js', {
				headers: { 'Accept-Encoding': 'gzip' }
			})
		);

		expect(res!.headers.get('content-length')).toBeNull();
	});
});
