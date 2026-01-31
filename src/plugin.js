// Stash originals before any patching
const _process_on = process.on;
const _process_once = process.once;

/**
 * Emit a process event and await all listeners in parallel.
 * @param {string} event @param {...any} args
 */
async function emit_and_await(event, ...args) {
	const listeners = process.listeners(event);
	await Promise.all(listeners.map((fn) => fn(...args)));
}

// ---------------------------------------------------------------------------
// Sticky events for sveltekit:* lifecycle
//
// In dev/preview, SvelteKit lazy-loads hooks.server.js on the first HTTP
// request — well after httpServer emits 'listening'. Any process.on() calls
// inside hooks.server.js therefore miss the initial sveltekit:startup event.
//
// We patch process.on/once so that for any sveltekit:* event that already
// fired, late listeners are replayed immediately via nextTick.
// ---------------------------------------------------------------------------

/** @type {Map<string, any[]>} event name → args from the last emit */
let sticky_events = new Map();

/** @param {string} event @param {Function} fn */
function maybe_replay(event, fn) {
	if (event.startsWith('sveltekit:') && sticky_events.has(event)) {
		const args = sticky_events.get(event);
		process.nextTick(() => {
			try {
				fn(...args);
			} catch (e) {
				console.error(`Error in ${event} listener:`, e);
			}
		});
	}
}

function install_sticky() {
	process.on = process.addListener = function (event, fn) {
		const r = _process_on.call(this, event, fn);
		maybe_replay(event, fn);
		return r;
	};
	process.once = function (event, fn) {
		const r = _process_once.call(this, event, fn);
		maybe_replay(event, fn);
		return r;
	};
}

function uninstall_sticky() {
	process.on = process.addListener = _process_on;
	process.once = _process_once;
	sticky_events = new Map();
}

/**
 * Emit and record for sticky replay.
 * @param {string} event @param {...any} args
 */
async function sticky_emit(event, ...args) {
	sticky_events.set(event, args);
	await emit_and_await(event, ...args);
}

/**
 * Wire up lifecycle events on an httpServer.
 * Shared between configureServer (dev) and configurePreviewServer (preview).
 *
 * @param {import('http').Server} httpServer
 * @param {{ info: Function, warn: Function, error?: Function }} logger
 * @param {string | false} websocketPath
 */
function setup_lifecycle(httpServer, logger, websocketPath) {
	/** @type {boolean} */
	let shutting_down = false;

	/** @type {{ close: () => void } | null} */
	let wsServer = null;

	install_sticky();

	// Announce
	logger.info('lifecycle plugin active', { timestamp: true });

	// WebSocket dev server
	if (websocketPath && httpServer) {
		import('./dev/websocket-server.js')
			.then(({ setupDevWebSocket }) => {
				wsServer = setupDevWebSocket(httpServer, websocketPath);
				logger.info('websocket dev server active', {
					timestamp: true
				});
			})
			.catch((e) => {
				if (logger.error) logger.error('Failed to start WebSocket dev server:');
				console.error(e);
			});
	}

	// Bun runtime check
	if (typeof Bun === 'undefined') {
		logger.warn(
			'Bun runtime not detected. Native Bun APIs will not work.\n' +
				'  Run with: bunx --bun vite dev'
		);
	}

	const emitStartup = async () => {
		const addr = httpServer.address();
		const host =
			addr && typeof addr === 'object' ? addr.address : undefined;
		const port =
			addr && typeof addr === 'object' ? addr.port : undefined;

		try {
			await sticky_emit('sveltekit:startup', {
				server: httpServer,
				host,
				port,
				socket_path: undefined
			});
		} catch (e) {
			console.error('Error in sveltekit:startup listener:', e);
		}
	};

	if (httpServer.listening) {
		emitStartup();
	} else {
		httpServer.on('listening', emitStartup);
	}

	// Fire-and-forget shutdown event — Vite handles the actual cleanup
	httpServer.on('close', () => {
		if (shutting_down) return;
		shutting_down = true;

		if (wsServer) wsServer.close();

		sticky_emit('sveltekit:shutdown', 'close')
			.catch((e) => {
				console.error('Error in sveltekit:shutdown listener:', e);
			})
			.finally(() => {
				uninstall_sticky();
			});
	});
}

/**
 * Vite plugin that emits sveltekit:startup and sveltekit:shutdown events in dev
 * and preview modes, matching the production runtime behavior in src/files/index.js.
 *
 * @param {{ websocket?: string | false }} [opts]
 * @returns {import('vite').Plugin}
 */
export function lifecyclePlugin(opts = {}) {
	const websocketPath = opts.websocket || false;
	return {
		name: 'svelte-adapter-bun:lifecycle',
		apply: 'serve',

		configureServer(server) {
			const httpServer = server.httpServer;
			if (!httpServer) return;

			return () => {
				setup_lifecycle(httpServer, server.config.logger, websocketPath);
			};
		},

		configurePreviewServer(server) {
			const httpServer = server.httpServer;
			if (!httpServer) return;

			return () => {
				setup_lifecycle(httpServer, server.config.logger, websocketPath);
			};
		}
	};
}
