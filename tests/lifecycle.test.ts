import { test, expect, describe, beforeEach, afterEach, mock } from 'bun:test';

// Re-implement emit_and_await for isolated unit testing.
// The runtime version lives in index.js as a template file with global tokens.

async function emit_and_await(event: string, ...args: unknown[]) {
	const listeners = process.listeners(event);
	await Promise.all(listeners.map((fn) => fn(...args)));
}

describe('emit_and_await()', () => {
	const EVENT = 'test:lifecycle';

	afterEach(() => {
		process.removeAllListeners(EVENT);
	});

	test('calls all listeners with correct args', async () => {
		const calls: unknown[][] = [];
		process.on(EVENT, (...args: unknown[]) => {
			calls.push(args);
		});
		process.on(EVENT, (...args: unknown[]) => {
			calls.push(args);
		});

		await emit_and_await(EVENT, 'a', 'b');

		expect(calls).toEqual([
			['a', 'b'],
			['a', 'b']
		]);
	});

	test('awaits async listeners', async () => {
		const order: number[] = [];

		process.on(EVENT, async () => {
			await new Promise((r) => setTimeout(r, 10));
			order.push(1);
		});

		await emit_and_await(EVENT);

		expect(order).toEqual([1]);
	});

	test('runs listeners in parallel', async () => {
		const start = Date.now();

		process.on(EVENT, async () => {
			await new Promise((r) => setTimeout(r, 50));
		});
		process.on(EVENT, async () => {
			await new Promise((r) => setTimeout(r, 50));
		});

		await emit_and_await(EVENT);
		const elapsed = Date.now() - start;

		// If parallel, ~50ms. If sequential, ~100ms.
		expect(elapsed).toBeLessThan(90);
	});

	test('resolves immediately with zero listeners', async () => {
		await expect(emit_and_await(EVENT)).resolves.toBeUndefined();
	});

	test('propagates errors from listeners', async () => {
		process.on(EVENT, () => {
			throw new Error('boom');
		});

		await expect(emit_and_await(EVENT)).rejects.toThrow('boom');
	});

	test('handles mixed sync and async listeners', async () => {
		const order: string[] = [];

		process.on(EVENT, () => {
			order.push('sync');
		});
		process.on(EVENT, async () => {
			await new Promise((r) => setTimeout(r, 10));
			order.push('async');
		});

		await emit_and_await(EVENT);

		expect(order).toContain('sync');
		expect(order).toContain('async');
		expect(order.length).toBe(2);
	});
});

describe('sveltekit:startup contract', () => {
	const EVENT = 'sveltekit:startup';

	afterEach(() => {
		process.removeAllListeners(EVENT);
	});

	test('payload contains server, host, port, socket_path', async () => {
		let received: Record<string, unknown> = {};

		process.on(EVENT, (payload: Record<string, unknown>) => {
			received = payload;
		});

		const payload = {
			server: { stop: () => {} },
			host: '0.0.0.0',
			port: 3000,
			socket_path: undefined
		};

		await emit_and_await(EVENT, payload);

		expect(received).toHaveProperty('server');
		expect(received).toHaveProperty('host');
		expect(received).toHaveProperty('port');
		expect(received).toHaveProperty('socket_path');
		expect(received.host).toBe('0.0.0.0');
		expect(received.port).toBe(3000);
		expect(received.socket_path).toBeUndefined();
	});

	test('socket_path mode sets host and port to undefined', async () => {
		let received: Record<string, unknown> = {};

		process.on(EVENT, (payload: Record<string, unknown>) => {
			received = payload;
		});

		const payload = {
			server: { stop: () => {} },
			host: undefined,
			port: undefined,
			socket_path: '/tmp/app.sock'
		};

		await emit_and_await(EVENT, payload);

		expect(received.host).toBeUndefined();
		expect(received.port).toBeUndefined();
		expect(received.socket_path).toBe('/tmp/app.sock');
	});
});

describe('sveltekit:shutdown contract', () => {
	const EVENT = 'sveltekit:shutdown';

	afterEach(() => {
		process.removeAllListeners(EVENT);
	});

	test('receives reason string SIGINT', async () => {
		let received: unknown;

		process.on(EVENT, (reason: unknown) => {
			received = reason;
		});

		await emit_and_await(EVENT, 'SIGINT');

		expect(received).toBe('SIGINT');
	});

	test('receives reason string SIGTERM', async () => {
		let received: unknown;

		process.on(EVENT, (reason: unknown) => {
			received = reason;
		});

		await emit_and_await(EVENT, 'SIGTERM');

		expect(received).toBe('SIGTERM');
	});
});

describe('shutdown sequence', () => {
	const SHUTDOWN_EVENT = 'sveltekit:shutdown';

	afterEach(() => {
		process.removeAllListeners(SHUTDOWN_EVENT);
	});

	test('server.stop() is called before listeners execute', async () => {
		const order: string[] = [];

		const mock_server = {
			stop: () => {
				order.push('server.stop');
			}
		};

		process.on(SHUTDOWN_EVENT, async () => {
			order.push('listener');
		});

		// Simulate shutdown sequence from index.js
		mock_server.stop();
		await emit_and_await(SHUTDOWN_EVENT, 'SIGTERM');

		expect(order).toEqual(['server.stop', 'listener']);
	});

	test('listener error does not prevent shutdown completion', async () => {
		const completed: string[] = [];

		process.on(SHUTDOWN_EVENT, () => {
			throw new Error('listener failed');
		});

		// Simulate the try/catch from index.js
		try {
			await emit_and_await(SHUTDOWN_EVENT, 'SIGINT');
		} catch {
			completed.push('caught');
		}

		expect(completed).toEqual(['caught']);
	});
});
