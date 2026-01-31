import { test, expect, describe } from 'bun:test';

// Re-implement get_origin logic for unit testing (the runtime version
// lives in handler.js as a template file with global tokens).

/**
 * @param {Headers} headers
 * @param {{ protocol_header?: string, host_header?: string, port_header?: string }} [opts={}]
 */
function get_origin(headers, opts = {}) {
	const { protocol_header, host_header, port_header } = opts;

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

describe('get_origin()', () => {
	test('constructs https origin from host header', () => {
		const headers = new Headers({ host: 'example.com' });
		expect(get_origin(headers)).toBe('https://example.com');
	});

	test('uses protocol header when configured', () => {
		const headers = new Headers({
			host: 'example.com',
			'x-forwarded-proto': 'http'
		});
		expect(
			get_origin(headers, { protocol_header: 'x-forwarded-proto' })
		).toBe('http://example.com');
	});

	test('uses host header override when configured', () => {
		const headers = new Headers({
			host: 'internal.example.com',
			'x-forwarded-host': 'public.example.com'
		});
		expect(
			get_origin(headers, { host_header: 'x-forwarded-host' })
		).toBe('https://public.example.com');
	});

	test('appends port when port header is set', () => {
		const headers = new Headers({
			host: 'example.com',
			'x-forwarded-port': '8080'
		});
		expect(
			get_origin(headers, { port_header: 'x-forwarded-port' })
		).toBe('https://example.com:8080');
	});

	test('uses all proxy headers together', () => {
		const headers = new Headers({
			host: 'internal',
			'x-forwarded-proto': 'http',
			'x-forwarded-host': 'public.example.com',
			'x-forwarded-port': '3000'
		});
		expect(
			get_origin(headers, {
				protocol_header: 'x-forwarded-proto',
				host_header: 'x-forwarded-host',
				port_header: 'x-forwarded-port'
			})
		).toBe('http://public.example.com:3000');
	});

	test('falls back to host when host_header is configured but not present', () => {
		const headers = new Headers({ host: 'fallback.com' });
		expect(
			get_origin(headers, { host_header: 'x-forwarded-host' })
		).toBe('https://fallback.com');
	});

	test('omits port when port header not set', () => {
		const headers = new Headers({ host: 'example.com' });
		expect(
			get_origin(headers, { port_header: 'x-forwarded-port' })
		).toBe('https://example.com');
	});
});

describe('CVE: protocol injection', () => {
	test('rejects protocol containing colon', () => {
		const headers = new Headers({
			host: 'example.com',
			'x-forwarded-proto': 'javascript:'
		});
		expect(() =>
			get_origin(headers, { protocol_header: 'x-forwarded-proto' })
		).toThrow("Invalid protocol header: contains ':'");
	});

	test('rejects URL-encoded protocol with colon', () => {
		const headers = new Headers({
			host: 'example.com',
			'x-forwarded-proto': 'javascript%3A'
		});
		expect(() =>
			get_origin(headers, { protocol_header: 'x-forwarded-proto' })
		).toThrow("Invalid protocol header: contains ':'");
	});

	test('rejects protocol with embedded URL', () => {
		const headers = new Headers({
			host: 'example.com',
			'x-forwarded-proto': 'http://evil.com'
		});
		expect(() =>
			get_origin(headers, { protocol_header: 'x-forwarded-proto' })
		).toThrow("Invalid protocol header: contains ':'");
	});
});

describe('missing host', () => {
	test('throws when no host header at all', () => {
		const headers = new Headers();
		expect(() => get_origin(headers)).toThrow('Could not determine host');
	});

	test('throws when host header is configured but absent and no fallback', () => {
		const headers = new Headers();
		expect(() =>
			get_origin(headers, { host_header: 'x-forwarded-host' })
		).toThrow('Could not determine host');
	});
});

describe('invalid port', () => {
	test('rejects non-numeric port', () => {
		const headers = new Headers({
			host: 'example.com',
			'x-forwarded-port': 'abc'
		});
		expect(() =>
			get_origin(headers, { port_header: 'x-forwarded-port' })
		).toThrow('Invalid port: abc');
	});

	test('rejects port with injection attempt', () => {
		const headers = new Headers({
			host: 'example.com',
			'x-forwarded-port': '8080/evil'
		});
		expect(() =>
			get_origin(headers, { port_header: 'x-forwarded-port' })
		).toThrow('Invalid port');
	});
});
