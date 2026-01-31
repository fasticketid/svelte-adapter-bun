/**
 * Emit a process event and await all listeners in parallel.
 * @param {string} event @param {...any} args
 */
async function emit_and_await(event, ...args) {
	const listeners = process.listeners(event);
	await Promise.all(listeners.map((fn) => fn(...args)));
}

/**
 * Vite plugin that emits sveltekit:startup and sveltekit:shutdown events in dev mode,
 * matching the production runtime behavior in src/files/index.js.
 *
 * @returns {import('vite').Plugin}
 */
export function lifecyclePlugin() {
	return {
		name: 'svelte-adapter-bun:lifecycle',
		apply: 'serve',

		configureServer(server) {
			const httpServer = server.httpServer;

			// Middleware mode — no httpServer to hook into
			if (!httpServer) return;

			/** @type {boolean} */
			let shutting_down = false;

			// Post-middleware hook — runs after Vite sets up its own middleware
			return () => {
				const logger = server.config.logger;

				// Announce
				logger.info('lifecycle plugin active', { timestamp: true });

				// Bun runtime check
				if (typeof Bun === 'undefined') {
					logger.warn(
						'Bun runtime not detected. Some features may not work.\n' +
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
						await emit_and_await('sveltekit:startup', {
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

					emit_and_await('sveltekit:shutdown', 'close').catch((e) => {
						console.error('Error in sveltekit:shutdown listener:', e);
					});
				});
			};
		}
	};
}
