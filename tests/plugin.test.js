import { test, expect, describe, beforeEach, afterEach, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import { lifecyclePlugin } from '../src/plugin.js';

/**
 * Mock httpServer using EventEmitter to simulate Node's http.Server.
 * @returns {EventEmitter & { listening: boolean, address: () => { address: string, port: number } }}
 */
function createMockHttpServer() {
	const emitter = new EventEmitter();
	// @ts-ignore — bolt on http.Server-like props
	emitter.listening = false;
	// @ts-ignore
	emitter.address = () => ({ address: '127.0.0.1', port: 5173 });
	return /** @type {any} */ (emitter);
}

/**
 * Creates a minimal mock Vite server with the given httpServer.
 * @param {any} httpServer
 */
function createMockViteServer(httpServer) {
	return /** @type {any} */ ({
		httpServer,
		config: {
			logger: {
				info: mock(() => {}),
				warn: mock(() => {})
			}
		}
	});
}

describe('lifecyclePlugin', () => {
	/** @type {ReturnType<typeof createMockHttpServer>} */
	let httpServer;
	/** @type {ReturnType<typeof lifecyclePlugin>} */
	let plugin;

	beforeEach(() => {
		httpServer = createMockHttpServer();
		plugin = lifecyclePlugin();
	});

	afterEach(() => {
		process.removeAllListeners('sveltekit:startup');
		process.removeAllListeners('sveltekit:shutdown');
	});

	describe('factory', () => {
		test('returns plugin with correct name', () => {
			expect(plugin.name).toBe('svelte-adapter-bun:lifecycle');
		});

		test('apply is serve', () => {
			expect(plugin.apply).toBe('serve');
		});

		test('has configureServer hook', () => {
			expect(typeof plugin.configureServer).toBe('function');
		});
	});

	describe('startup', () => {
		test('emits sveltekit:startup when httpServer fires listening', async () => {
			/** @type {any} */
			let received;
			process.on('sveltekit:startup', (payload) => {
				received = payload;
			});

			const postHook = /** @type {Function} */ (
				/** @type {any} */ (plugin).configureServer(
					createMockViteServer(httpServer)
				)
			);
			postHook();

			httpServer.emit('listening');
			// Give the async emit_and_await a tick to resolve
			await new Promise((r) => setTimeout(r, 10));

			expect(received).toBeDefined();
		});

		test('startup payload contains server, host, port, socket_path', async () => {
			/** @type {any} */
			let received;
			process.on('sveltekit:startup', (payload) => {
				received = payload;
			});

			const postHook = /** @type {Function} */ (
				/** @type {any} */ (plugin).configureServer(
					createMockViteServer(httpServer)
				)
			);
			postHook();

			httpServer.emit('listening');
			await new Promise((r) => setTimeout(r, 10));

			expect(received).toHaveProperty('server');
			expect(received.server).toBe(httpServer);
			expect(received).toHaveProperty('host', '127.0.0.1');
			expect(received).toHaveProperty('port', 5173);
			expect(received).toHaveProperty('socket_path', undefined);
		});

		test('emits startup immediately if httpServer already listening', async () => {
			/** @type {any} */
			let received;
			process.on('sveltekit:startup', (payload) => {
				received = payload;
			});

			// @ts-ignore
			httpServer.listening = true;

			const postHook = /** @type {Function} */ (
				/** @type {any} */ (plugin).configureServer(
					createMockViteServer(httpServer)
				)
			);
			postHook();

			await new Promise((r) => setTimeout(r, 10));

			expect(received).toBeDefined();
			expect(received.server).toBe(httpServer);
		});

		test('startup error is caught and does not throw', async () => {
			process.on('sveltekit:startup', () => {
				throw new Error('startup boom');
			});

			const postHook = /** @type {Function} */ (
				/** @type {any} */ (plugin).configureServer(
					createMockViteServer(httpServer)
				)
			);
			postHook();

			httpServer.emit('listening');
			// Should not throw — error is caught internally
			await new Promise((r) => setTimeout(r, 10));
		});
	});

	describe('shutdown', () => {
		test('emits sveltekit:shutdown with reason close on httpServer close', async () => {
			/** @type {any} */
			let received;
			process.on('sveltekit:shutdown', (reason) => {
				received = reason;
			});

			const postHook = /** @type {Function} */ (
				/** @type {any} */ (plugin).configureServer(
					createMockViteServer(httpServer)
				)
			);
			postHook();

			httpServer.emit('close');
			await new Promise((r) => setTimeout(r, 10));

			expect(received).toBe('close');
		});

		test('double shutdown only emits once', async () => {
			/** @type {string[]} */
			const reasons = [];
			process.on('sveltekit:shutdown', (reason) => {
				reasons.push(reason);
			});

			const postHook = /** @type {Function} */ (
				/** @type {any} */ (plugin).configureServer(
					createMockViteServer(httpServer)
				)
			);
			postHook();

			// First close triggers shutdown
			httpServer.emit('close');
			await new Promise((r) => setTimeout(r, 10));

			// Second close should be a no-op
			httpServer.emit('close');
			await new Promise((r) => setTimeout(r, 10));

			expect(reasons).toEqual(['close']);
		});
	});

	describe('signal listener cleanup', () => {
		test('SIGINT listener is removed after httpServer close', async () => {
			const before = process.listenerCount('SIGINT');

			const postHook = /** @type {Function} */ (
				/** @type {any} */ (plugin).configureServer(
					createMockViteServer(httpServer)
				)
			);
			postHook();

			expect(process.listenerCount('SIGINT')).toBe(before + 1);

			httpServer.emit('close');
			await new Promise((r) => setTimeout(r, 10));

			expect(process.listenerCount('SIGINT')).toBe(before);
		});

		test('SIGTERM listener is removed after httpServer close', async () => {
			const before = process.listenerCount('SIGTERM');

			const postHook = /** @type {Function} */ (
				/** @type {any} */ (plugin).configureServer(
					createMockViteServer(httpServer)
				)
			);
			postHook();

			expect(process.listenerCount('SIGTERM')).toBe(before + 1);

			httpServer.emit('close');
			await new Promise((r) => setTimeout(r, 10));

			expect(process.listenerCount('SIGTERM')).toBe(before);
		});
	});

	describe('null httpServer', () => {
		test('no-op when httpServer is null (middleware mode)', () => {
			const result = /** @type {any} */ (plugin).configureServer(
				createMockViteServer(null)
			);
			expect(result).toBeUndefined();
		});
	});

	describe('options', () => {
		test('accepts custom shutdownTimeout', () => {
			const custom = lifecyclePlugin({ shutdownTimeout: 5 });
			expect(custom.name).toBe('svelte-adapter-bun:lifecycle');
		});
	});

	describe('announce', () => {
		test('logs plugin active via Vite logger', () => {
			const viteServer = createMockViteServer(httpServer);

			const postHook = /** @type {Function} */ (
				/** @type {any} */ (plugin).configureServer(viteServer)
			);
			postHook();

			expect(viteServer.config.logger.info).toHaveBeenCalledWith(
				'lifecycle plugin active',
				{ timestamp: true }
			);
		});
	});

	describe('bun detection', () => {
		test('does not warn when running under Bun', () => {
			const viteServer = createMockViteServer(httpServer);

			const postHook = /** @type {Function} */ (
				/** @type {any} */ (plugin).configureServer(viteServer)
			);
			postHook();

			expect(viteServer.config.logger.warn).not.toHaveBeenCalled();
		});
	});
});
