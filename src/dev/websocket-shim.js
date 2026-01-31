// Shared topic registry for pub/sub across all connections
/** @type {Map<string, Set<BunWebSocketShim>>} */
const topicRegistry = new Map();

/**
 * Wraps a Node `ws` WebSocket to expose Bun's ServerWebSocket API.
 * Used in dev mode so the same handler works in both Vite dev and Bun.serve() production.
 */
export class BunWebSocketShim {
	/** @type {import('ws').WebSocket} */
	#ws;

	/** @type {any} */
	data;

	/** @type {string} */
	remoteAddress;

	/**
	 * @param {import('ws').WebSocket} ws - Node ws instance
	 * @param {{ data?: any, remoteAddress?: string }} [opts]
	 */
	constructor(ws, opts = {}) {
		this.#ws = ws;
		this.data = opts.data ?? {};
		this.remoteAddress = opts.remoteAddress ?? '127.0.0.1';

		// Cleanup subscriptions on close
		ws.on('close', () => this.#cleanup());
	}

	/** @returns {0 | 1 | 2 | 3} */
	get readyState() {
		return /** @type {0 | 1 | 2 | 3} */ (this.#ws.readyState);
	}

	get binaryType() {
		const t = this.#ws.binaryType;
		// ws uses 'nodebuffer' | 'arraybuffer' | 'fragments'
		// Bun uses 'arraybuffer' | 'uint8array'
		if (t === 'nodebuffer' || t === 'fragments') return 'uint8array';
		return t;
	}

	set binaryType(value) {
		// Bun accepts 'arraybuffer' | 'uint8array'
		// Map 'uint8array' to 'nodebuffer' for ws
		this.#ws.binaryType = value === 'uint8array' ? 'nodebuffer' : value;
	}

	/** @returns {string[]} */
	get subscriptions() {
		/** @type {string[]} */
		const result = [];
		for (const [topic, subs] of topicRegistry) {
			if (subs.has(this)) result.push(topic);
		}
		return result;
	}

	/**
	 * Send data to the client.
	 * @param {string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer} data
	 * @param {boolean} [compress]
	 * @returns {number} approximate bytes sent (matches ServerWebSocketSendStatus)
	 */
	send(data, compress) {
		if (this.#ws.readyState !== 1) return 0;
		this.#ws.send(data, { compress: compress ?? false });
		return typeof data === 'string' ? data.length : /** @type {any} */ (data).byteLength ?? 0;
	}

	/**
	 * @param {string} data
	 * @param {boolean} [compress]
	 * @returns {number}
	 */
	sendText(data, compress) {
		return this.send(data, compress);
	}

	/**
	 * @param {ArrayBufferView | ArrayBuffer | SharedArrayBuffer} data
	 * @param {boolean} [compress]
	 * @returns {number}
	 */
	sendBinary(data, compress) {
		return this.send(data, compress);
	}

	/**
	 * @param {number} [code]
	 * @param {string} [reason]
	 */
	close(code, reason) {
		if (this.#ws.readyState >= 2) return;
		this.#ws.close(code, reason);
	}

	terminate() {
		this.#ws.terminate();
	}

	/** @param {string | Buffer} [data] */
	ping(data) {
		if (this.#ws.readyState !== 1) return;
		this.#ws.ping(data);
	}

	/** @param {string | Buffer} [data] */
	pong(data) {
		if (this.#ws.readyState !== 1) return;
		this.#ws.pong(data);
	}

	/** @param {string} topic */
	subscribe(topic) {
		let subs = topicRegistry.get(topic);
		if (!subs) {
			subs = new Set();
			topicRegistry.set(topic, subs);
		}
		subs.add(this);
	}

	/** @param {string} topic */
	unsubscribe(topic) {
		const subs = topicRegistry.get(topic);
		if (!subs) return;
		subs.delete(this);
		if (subs.size === 0) topicRegistry.delete(topic);
	}

	/**
	 * @param {string} topic
	 * @returns {boolean}
	 */
	isSubscribed(topic) {
		return topicRegistry.get(topic)?.has(this) ?? false;
	}

	/**
	 * Publish to all subscribers of a topic (excluding self).
	 * @param {string} topic
	 * @param {string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer} data
	 * @param {boolean} [compress]
	 * @returns {number}
	 */
	publish(topic, data, compress) {
		const subs = topicRegistry.get(topic);
		if (!subs) return 0;

		let sent = 0;
		for (const shim of subs) {
			if (shim === this) continue;
			if (shim.readyState !== 1) continue;
			sent += shim.send(data, compress);
		}
		return sent;
	}

	/**
	 * @param {string} topic
	 * @param {string} data
	 * @param {boolean} [compress]
	 * @returns {number}
	 */
	publishText(topic, data, compress) {
		return this.publish(topic, data, compress);
	}

	/**
	 * @param {string} topic
	 * @param {ArrayBufferView | ArrayBuffer | SharedArrayBuffer} data
	 * @param {boolean} [compress]
	 * @returns {number}
	 */
	publishBinary(topic, data, compress) {
		return this.publish(topic, data, compress);
	}

	/**
	 * No-op batching in dev — just runs the callback immediately.
	 * @param {(ws: BunWebSocketShim) => void} callback
	 */
	cork(callback) {
		callback(this);
	}

	/** @returns {number} */
	getBufferedAmount() {
		return this.#ws.bufferedAmount;
	}

	// Cleanup all topic subscriptions for this connection
	#cleanup() {
		for (const [topic, subs] of topicRegistry) {
			subs.delete(this);
			if (subs.size === 0) topicRegistry.delete(topic);
		}
	}
}

/**
 * Reset the shared topic registry. For testing only.
 */
export function _resetTopicRegistry() {
	topicRegistry.clear();
}
