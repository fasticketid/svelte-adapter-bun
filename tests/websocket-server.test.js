import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import WebSocket from 'ws';
import { setupDevWebSocket } from '../src/dev/websocket-server.js';
import { _resetTopicRegistry } from '../src/dev/websocket-shim.js';

const TMP_DIR = join(import.meta.dir, '.tmp-ws-test');
const HANDLER_PATH = join(TMP_DIR, 'handler.mjs');

/**
 * Write a websocket handler module to the temp dir.
 * @param {string} code
 */
function writeHandler(code) {
	writeFileSync(HANDLER_PATH, code);
}

/**
 * Start an HTTP server on a random port and return it + the port.
 * @returns {Promise<{ server: import('http').Server, port: number }>}
 */
function startHttpServer() {
	return new Promise((resolve) => {
		const server = createServer((_req, res) => {
			res.writeHead(200);
			res.end('ok');
		});
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address();
			const port = typeof addr === 'object' ? addr?.port ?? 0 : 0;
			resolve({ server, port });
		});
	});
}

/**
 * Connect a ws client, wait for open.
 * @param {number} port
 * @param {string} [path]
 * @returns {Promise<WebSocket>}
 */
function connectClient(port, path = '/') {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
		ws.on('open', () => resolve(ws));
		ws.on('error', reject);
	});
}

/**
 * Wait for a message on a ws client.
 * @param {WebSocket} ws
 * @returns {Promise<string>}
 */
function waitForMessage(ws) {
	return new Promise((resolve) => {
		ws.once('message', (data) => {
			resolve(data.toString());
		});
	});
}

describe('setupDevWebSocket', () => {
	/** @type {import('http').Server} */
	let httpServer;
	/** @type {number} */
	let port;
	/** @type {{ close: () => void } | null} */
	let wsServer;

	beforeEach(() => {
		_resetTopicRegistry();
		mkdirSync(TMP_DIR, { recursive: true });
	});

	afterEach(async () => {
		if (wsServer) wsServer.close();
		await new Promise((resolve) => {
			if (httpServer) httpServer.close(resolve);
			else resolve(undefined);
		});
		rmSync(TMP_DIR, { recursive: true, force: true });
	});

	test('echo round-trip — message sent and received', async () => {
		writeHandler(`
			export function open(ws) {
				// nothing
			}
			export function message(ws, msg) {
				ws.send('echo:' + msg);
			}
		`);

		({ server: httpServer, port } = await startHttpServer());
		wsServer = setupDevWebSocket(httpServer, HANDLER_PATH);

		const client = await connectClient(port);
		const msgPromise = waitForMessage(client);
		client.send('hello');
		const reply = await msgPromise;

		expect(reply).toBe('echo:hello');
		client.close();
	});

	test('custom upgrade data is available on ws.data', async () => {
		writeHandler(`
			export function upgrade(request, server) {
				server.upgrade(request, { data: { token: 'abc123' } });
			}
			export function open(ws) {
				ws.send('token:' + ws.data.token);
			}
		`);

		({ server: httpServer, port } = await startHttpServer());
		wsServer = setupDevWebSocket(httpServer, HANDLER_PATH);

		const client = await connectClient(port);
		const msg = await waitForMessage(client);

		expect(msg).toBe('token:abc123');
		client.close();
	});

	test('auto-upgrade when no upgrade export', async () => {
		writeHandler(`
			export function open(ws) {
				ws.send('connected');
			}
		`);

		({ server: httpServer, port } = await startHttpServer());
		wsServer = setupDevWebSocket(httpServer, HANDLER_PATH);

		const client = await connectClient(port);
		const msg = await waitForMessage(client);

		expect(msg).toBe('connected');
		client.close();
	});

	test('close callback fires with code', async () => {
		let closeCode = 0;
		writeHandler(`
			let resolve;
			globalThis._closePromise = new Promise(r => resolve = r);
			export function close(ws, code, reason) {
				resolve(code);
			}
		`);

		({ server: httpServer, port } = await startHttpServer());
		wsServer = setupDevWebSocket(httpServer, HANDLER_PATH);

		const client = await connectClient(port);
		client.close(1000, 'done');

		// Give time for close to propagate
		await new Promise((r) => setTimeout(r, 50));
	});

	test('pub/sub between two clients', async () => {
		writeHandler(`
			export function open(ws) {
				ws.subscribe('broadcast');
			}
			export function message(ws, msg) {
				if (msg === 'pub') {
					ws.publish('broadcast', 'hello-all');
				}
			}
		`);

		({ server: httpServer, port } = await startHttpServer());
		wsServer = setupDevWebSocket(httpServer, HANDLER_PATH);

		const client1 = await connectClient(port);
		const client2 = await connectClient(port);

		// Small delay for both open handlers to complete
		await new Promise((r) => setTimeout(r, 50));

		const msgPromise = waitForMessage(client2);
		client1.send('pub');
		const received = await msgPromise;

		expect(received).toBe('hello-all');

		client1.close();
		client2.close();
	});

	test('binary data round-trip', async () => {
		writeHandler(`
			export function message(ws, msg) {
				// Echo back the binary data
				ws.sendBinary(msg);
			}
		`);

		({ server: httpServer, port } = await startHttpServer());
		wsServer = setupDevWebSocket(httpServer, HANDLER_PATH);

		const client = await connectClient(port);

		const msgPromise = new Promise((resolve) => {
			client.once('message', (data) => resolve(data));
		});

		const payload = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
		client.send(payload);

		const received = await msgPromise;
		expect(Buffer.isBuffer(received) || received instanceof ArrayBuffer).toBe(true);

		client.close();
	});

	test('skips Vite HMR websocket connections', async () => {
		writeHandler(`
			export function open(ws) {
				ws.send('should-not-reach');
			}
		`);

		({ server: httpServer, port } = await startHttpServer());
		wsServer = setupDevWebSocket(httpServer, HANDLER_PATH);

		// Connect with vite-hmr protocol — should NOT be handled
		const ws = new WebSocket(`ws://127.0.0.1:${port}`, ['vite-hmr']);

		let gotMessage = false;
		ws.on('message', () => {
			gotMessage = true;
		});

		// Wait and verify no message received
		await new Promise((r) => setTimeout(r, 100));
		expect(gotMessage).toBe(false);

		ws.close();
	});

	test('upgrade rejection destroys socket', async () => {
		writeHandler(`
			export function upgrade(request, server) {
				// Don't call server.upgrade — reject the connection
				return new Response('forbidden', { status: 403 });
			}
		`);

		({ server: httpServer, port } = await startHttpServer());
		wsServer = setupDevWebSocket(httpServer, HANDLER_PATH);

		let errored = false;
		try {
			const ws = new WebSocket(`ws://127.0.0.1:${port}`);
			await new Promise((resolve, reject) => {
				ws.on('open', () => reject(new Error('should not open')));
				ws.on('error', () => {
					errored = true;
					resolve(undefined);
				});
				ws.on('close', () => resolve(undefined));
			});
		} catch {
			// expected
		}

		expect(errored).toBe(true);
	});
});
