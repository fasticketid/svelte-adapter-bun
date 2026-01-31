import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import { BunWebSocketShim, _resetTopicRegistry } from '../src/dev/websocket-shim.js';

// WebSocket readyState constants
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/**
 * Minimal mock of a Node ws WebSocket.
 * Enough to test the shim without pulling in the real ws library.
 */
function createMockWs(overrides = {}) {
	const emitter = new EventEmitter();

	/** @type {any[]} */
	const sent = [];
	/** @type {any[]} */
	const pings = [];
	/** @type {any[]} */
	const pongs = [];

	const ws = Object.assign(emitter, {
		readyState: OPEN,
		binaryType: 'nodebuffer',
		bufferedAmount: 0,
		send(/** @type {any} */ data, /** @type {any} */ _opts) {
			sent.push(data);
		},
		close(/** @type {number} */ _code, /** @type {string} */ _reason) {
			ws.readyState = CLOSING;
		},
		terminate() {
			ws.readyState = CLOSED;
		},
		ping(/** @type {any} */ data) {
			pings.push(data);
		},
		pong(/** @type {any} */ data) {
			pongs.push(data);
		},
		// Expose for assertions
		_sent: sent,
		_pings: pings,
		_pongs: pongs,
		...overrides
	});

	return ws;
}

describe('BunWebSocketShim', () => {
	beforeEach(() => {
		_resetTopicRegistry();
	});

	afterEach(() => {
		_resetTopicRegistry();
	});

	describe('constructor', () => {
		test('sets data from options', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws, { data: { userId: 42 } });
			expect(shim.data).toEqual({ userId: 42 });
		});

		test('defaults data to empty object', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			expect(shim.data).toEqual({});
		});

		test('sets remoteAddress from options', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws, { remoteAddress: '10.0.0.1' });
			expect(shim.remoteAddress).toBe('10.0.0.1');
		});

		test('defaults remoteAddress to 127.0.0.1', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			expect(shim.remoteAddress).toBe('127.0.0.1');
		});
	});

	describe('readyState', () => {
		test('proxies from underlying ws', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			expect(shim.readyState).toBe(OPEN);

			ws.readyState = CLOSED;
			expect(shim.readyState).toBe(CLOSED);
		});
	});

	describe('binaryType', () => {
		test('maps nodebuffer to uint8array', () => {
			const ws = createMockWs({ binaryType: 'nodebuffer' });
			const shim = new BunWebSocketShim(ws);
			expect(shim.binaryType).toBe('uint8array');
		});

		test('maps fragments to uint8array', () => {
			const ws = createMockWs({ binaryType: 'fragments' });
			const shim = new BunWebSocketShim(ws);
			expect(shim.binaryType).toBe('uint8array');
		});

		test('passes through arraybuffer', () => {
			const ws = createMockWs({ binaryType: 'arraybuffer' });
			const shim = new BunWebSocketShim(ws);
			expect(shim.binaryType).toBe('arraybuffer');
		});

		test('setting uint8array maps to nodebuffer on ws', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			shim.binaryType = 'uint8array';
			expect(ws.binaryType).toBe('nodebuffer');
		});

		test('setting arraybuffer passes through', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			shim.binaryType = 'arraybuffer';
			expect(ws.binaryType).toBe('arraybuffer');
		});
	});

	describe('send', () => {
		test('sends string data', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			const result = shim.send('hello');
			expect(ws._sent).toEqual(['hello']);
			expect(result).toBe(5);
		});

		test('sends binary data', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			const buf = new Uint8Array([1, 2, 3]);
			const result = shim.send(buf);
			expect(ws._sent).toEqual([buf]);
			expect(result).toBe(3);
		});

		test('returns 0 when not OPEN', () => {
			const ws = createMockWs({ readyState: CLOSED });
			const shim = new BunWebSocketShim(ws);
			const result = shim.send('nope');
			expect(ws._sent).toEqual([]);
			expect(result).toBe(0);
		});
	});

	describe('sendText', () => {
		test('delegates to send', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			shim.sendText('hi');
			expect(ws._sent).toEqual(['hi']);
		});
	});

	describe('sendBinary', () => {
		test('delegates to send', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			const buf = new ArrayBuffer(4);
			shim.sendBinary(buf);
			expect(ws._sent).toEqual([buf]);
		});
	});

	describe('close', () => {
		test('calls ws.close with code and reason', () => {
			let closed = false;
			const ws = createMockWs({
				close(/** @type {number} */ code, /** @type {string} */ reason) {
					closed = true;
					expect(code).toBe(1000);
					expect(reason).toBe('bye');
				}
			});
			const shim = new BunWebSocketShim(ws);
			shim.close(1000, 'bye');
			expect(closed).toBe(true);
		});

		test('no-op if already closing', () => {
			let callCount = 0;
			const ws = createMockWs({
				readyState: CLOSING,
				close() {
					callCount++;
				}
			});
			const shim = new BunWebSocketShim(ws);
			shim.close();
			expect(callCount).toBe(0);
		});
	});

	describe('terminate', () => {
		test('calls ws.terminate', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			shim.terminate();
			expect(ws.readyState).toBe(CLOSED);
		});
	});

	describe('ping/pong', () => {
		test('ping sends data', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			shim.ping('test');
			expect(ws._pings).toEqual(['test']);
		});

		test('pong sends data', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			shim.pong('test');
			expect(ws._pongs).toEqual(['test']);
		});

		test('ping no-op when not OPEN', () => {
			const ws = createMockWs({ readyState: CLOSED });
			const shim = new BunWebSocketShim(ws);
			shim.ping('test');
			expect(ws._pings).toEqual([]);
		});

		test('pong no-op when not OPEN', () => {
			const ws = createMockWs({ readyState: CLOSED });
			const shim = new BunWebSocketShim(ws);
			shim.pong('test');
			expect(ws._pongs).toEqual([]);
		});
	});

	describe('subscribe/unsubscribe/isSubscribed', () => {
		test('subscribe adds to topic registry', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			shim.subscribe('chat');
			expect(shim.isSubscribed('chat')).toBe(true);
		});

		test('unsubscribe removes from topic registry', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			shim.subscribe('chat');
			shim.unsubscribe('chat');
			expect(shim.isSubscribed('chat')).toBe(false);
		});

		test('isSubscribed returns false for unsubscribed topic', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			expect(shim.isSubscribed('nonexistent')).toBe(false);
		});

		test('subscriptions getter returns array of subscribed topics', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			shim.subscribe('alpha');
			shim.subscribe('beta');
			const subs = shim.subscriptions;
			expect(subs).toContain('alpha');
			expect(subs).toContain('beta');
			expect(subs.length).toBe(2);
		});
	});

	describe('publish', () => {
		test('sends to all subscribers except self', () => {
			const ws1 = createMockWs();
			const ws2 = createMockWs();
			const ws3 = createMockWs();
			const shim1 = new BunWebSocketShim(ws1);
			const shim2 = new BunWebSocketShim(ws2);
			const shim3 = new BunWebSocketShim(ws3);

			shim1.subscribe('room');
			shim2.subscribe('room');
			shim3.subscribe('room');

			shim1.publish('room', 'hello');

			// shim1 should NOT receive (skip self)
			expect(ws1._sent).toEqual([]);
			// shim2 and shim3 should receive
			expect(ws2._sent).toEqual(['hello']);
			expect(ws3._sent).toEqual(['hello']);
		});

		test('skips subscribers with non-OPEN readyState', () => {
			const ws1 = createMockWs();
			const ws2 = createMockWs({ readyState: CLOSING });
			const shim1 = new BunWebSocketShim(ws1);
			const shim2 = new BunWebSocketShim(ws2);

			shim1.subscribe('room');
			shim2.subscribe('room');

			shim1.publish('room', 'test');

			expect(ws2._sent).toEqual([]);
		});

		test('returns 0 for nonexistent topic', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			expect(shim.publish('nope', 'data')).toBe(0);
		});
	});

	describe('publishText', () => {
		test('delegates to publish', () => {
			const ws1 = createMockWs();
			const ws2 = createMockWs();
			const shim1 = new BunWebSocketShim(ws1);
			const shim2 = new BunWebSocketShim(ws2);
			shim1.subscribe('topic');
			shim2.subscribe('topic');

			shim1.publishText('topic', 'text');
			expect(ws2._sent).toEqual(['text']);
		});
	});

	describe('publishBinary', () => {
		test('delegates to publish', () => {
			const ws1 = createMockWs();
			const ws2 = createMockWs();
			const shim1 = new BunWebSocketShim(ws1);
			const shim2 = new BunWebSocketShim(ws2);
			shim1.subscribe('topic');
			shim2.subscribe('topic');

			const buf = new Uint8Array([1, 2, 3]);
			shim1.publishBinary('topic', buf);
			expect(ws2._sent).toEqual([buf]);
		});
	});

	describe('cork', () => {
		test('executes callback immediately', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			let called = false;
			shim.cork((s) => {
				called = true;
				expect(s).toBe(shim);
			});
			expect(called).toBe(true);
		});
	});

	describe('getBufferedAmount', () => {
		test('returns ws.bufferedAmount', () => {
			const ws = createMockWs({ bufferedAmount: 1024 });
			const shim = new BunWebSocketShim(ws);
			expect(shim.getBufferedAmount()).toBe(1024);
		});
	});

	describe('cleanup on close', () => {
		test('removes from all topic subscriptions on ws close', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			shim.subscribe('a');
			shim.subscribe('b');

			expect(shim.isSubscribed('a')).toBe(true);
			expect(shim.isSubscribed('b')).toBe(true);

			// Simulate ws close event
			ws.emit('close');

			expect(shim.isSubscribed('a')).toBe(false);
			expect(shim.isSubscribed('b')).toBe(false);
			expect(shim.subscriptions).toEqual([]);
		});

		test('cleanup does not affect other shims', () => {
			const ws1 = createMockWs();
			const ws2 = createMockWs();
			const shim1 = new BunWebSocketShim(ws1);
			const shim2 = new BunWebSocketShim(ws2);

			shim1.subscribe('room');
			shim2.subscribe('room');

			ws1.emit('close');

			expect(shim1.isSubscribed('room')).toBe(false);
			expect(shim2.isSubscribed('room')).toBe(true);
		});
	});

	describe('binary data types', () => {
		test('send handles ArrayBuffer', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			const ab = new ArrayBuffer(8);
			const result = shim.send(ab);
			expect(ws._sent).toEqual([ab]);
			expect(result).toBe(8);
		});

		test('send handles Uint8Array', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			const u8 = new Uint8Array([10, 20, 30, 40]);
			const result = shim.send(u8);
			expect(ws._sent).toEqual([u8]);
			expect(result).toBe(4);
		});

		test('send handles Buffer', () => {
			const ws = createMockWs();
			const shim = new BunWebSocketShim(ws);
			const buf = Buffer.from([1, 2, 3]);
			const result = shim.send(buf);
			expect(ws._sent).toEqual([buf]);
			expect(result).toBe(3);
		});
	});
});
