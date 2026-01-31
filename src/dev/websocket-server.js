import { WebSocketServer } from 'ws';
import { BunWebSocketShim } from './websocket-shim.js';

/** @type {number} */
let importCounter = 0;

/**
 * Dynamically import a module with cache busting for HMR.
 * @param {string} modulePath
 */
async function importFresh(modulePath) {
	return import(`${modulePath}?t=${++importCounter}`);
}

/**
 * Set up a dev-mode WebSocket server on Vite's HTTP server.
 * Bridges Node ws → BunWebSocketShim so the same handler works in dev and prod.
 *
 * @param {import('http').Server} httpServer - Vite's underlying HTTP server
 * @param {string} websocketPath - Absolute path to user's websocket handler module
 * @param {{ maxPayloadLength?: number }} [opts]
 * @returns {{ close: () => void }}
 */
export function setupDevWebSocket(httpServer, websocketPath, opts = {}) {
	const maxPayload = opts.maxPayloadLength ?? 16 * 1024 * 1024; // 16MB, matches Bun default

	const wss = new WebSocketServer({
		noServer: true,
		maxPayload
	});

	/**
	 * @param {import('http').IncomingMessage} req
	 * @param {import('net').Socket} socket
	 * @param {Buffer} head
	 */
	async function handleUpgrade(req, socket, head) {
		// Skip Vite's HMR websocket
		if (req.headers['sec-websocket-protocol'] === 'vite-hmr') return;

		try {
			const handler = await importFresh(websocketPath);

			// Let user's upgrade() decide whether to accept
			if (handler.upgrade) {
				// Build a minimal Request-like object from the raw IncomingMessage
				const protocol = req.socket.encrypted ? 'https' : 'http';
				const host = req.headers.host || 'localhost';
				const url = new URL(req.url || '/', `${protocol}://${host}`);
				const headers = new Headers();
				for (const [key, val] of Object.entries(req.headers)) {
					if (val) headers.set(key, Array.isArray(val) ? val.join(', ') : val);
				}
				const request = new Request(url.href, {
					method: req.method,
					headers
				});

				// Fake server.upgrade() — captures the data arg and completes the upgrade
				let upgradeData = {};
				let shouldUpgrade = false;

				const fakeServer = {
					upgrade(/** @type {Request} */ _req, /** @type {{ data?: any }} */ opts) {
						upgradeData = opts?.data ?? {};
						shouldUpgrade = true;
						return true;
					}
				};

				const result = handler.upgrade(request, fakeServer);
				// If upgrade() returned a Response or didn't call server.upgrade(), bail
				if (!shouldUpgrade) {
					if (result instanceof Response) {
						socket.destroy();
					}
					return;
				}

				wss.handleUpgrade(req, socket, head, (ws) => {
					const remoteAddress = req.socket.remoteAddress || '127.0.0.1';
					const shim = new BunWebSocketShim(ws, {
						data: upgradeData,
						remoteAddress
					});
					setupHandlers(ws, shim, websocketPath);
				});
			} else {
				// Auto-upgrade — no user upgrade() function
				wss.handleUpgrade(req, socket, head, (ws) => {
					const remoteAddress = req.socket.remoteAddress || '127.0.0.1';
					const shim = new BunWebSocketShim(ws, { remoteAddress });
					setupHandlers(ws, shim, websocketPath);
				});
			}
		} catch (e) {
			console.error('[ws-dev] upgrade error:', e);
			socket.destroy();
		}
	}

	/**
	 * Wire up ws events → user handler callbacks through the shim.
	 * @param {import('ws').WebSocket} ws
	 * @param {BunWebSocketShim} shim
	 * @param {string} handlerPath
	 */
	function setupHandlers(ws, shim, handlerPath) {
		// open
		importFresh(handlerPath)
			.then((handler) => handler.open?.(shim))
			.catch((e) => console.error('[ws-dev] open error:', e));

		ws.on('message', (data, isBinary) => {
			const message = isBinary ? toArrayBuffer(data) : data.toString();
			importFresh(handlerPath)
				.then((handler) => handler.message?.(shim, message))
				.catch((e) => console.error('[ws-dev] message error:', e));
		});

		ws.on('close', (code, reason) => {
			importFresh(handlerPath)
				.then((handler) =>
					handler.close?.(shim, code, reason.toString())
				)
				.catch((e) => console.error('[ws-dev] close error:', e));
		});

		ws.on('error', (e) => {
			console.error('[ws-dev] connection error:', e);
		});
	}

	httpServer.on('upgrade', handleUpgrade);

	return {
		close() {
			httpServer.off('upgrade', handleUpgrade);
			wss.close();
		}
	};
}

/**
 * Convert ws message data to ArrayBuffer.
 * @param {import('ws').RawData} data
 * @returns {ArrayBuffer}
 */
function toArrayBuffer(data) {
	if (data instanceof ArrayBuffer) return data;
	if (Buffer.isBuffer(data)) {
		return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
	}
	if (Array.isArray(data)) {
		// Fragment list — concat into single Buffer
		const buf = Buffer.concat(data);
		return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
	}
	return new ArrayBuffer(0);
}
