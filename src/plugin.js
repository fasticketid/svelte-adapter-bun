/** @typedef {import('./types.js').LifecyclePluginOptions} LifecyclePluginOptions */

/** @param {string} event @param {...any} args */
async function emit_and_await(event, ...args) {
	const listeners = process.listeners(event);
	await Promise.all(listeners.map((fn) => fn(...args)));
}

/**
 * Vite plugin that emits sveltekit:startup and sveltekit:shutdown events in dev mode,
 * matching the production runtime behavior in src/files/index.js.
 *
 * @param {LifecyclePluginOptions} [options={}]
 * @returns {import('vite').Plugin}
 */
export function lifecyclePlugin(options = {}) {
	const { shutdownTimeout = 30 } = options;

	return {
		name: 'svelte-adapter-bun:lifecycle',
		apply: 'serve',

		configureServer(server) {
			const httpServer = server.httpServer;

			// Middleware mode — no httpServer to hook into
			if (!httpServer) return;

			/** @type {boolean} */
			let shutting_down = false;

			async function shutdown(/** @type {string} */ reason) {
				if (shutting_down) return;
				shutting_down = true;

				const timer = setTimeout(() => {
					console.log('Shutdown timeout reached, forcing exit');
					process.exit(1);
				}, shutdownTimeout * 1000);
				timer.unref();

				try {
					await emit_and_await('sveltekit:shutdown', reason);
				} catch (e) {
					console.error('Error in sveltekit:shutdown listener:', e);
				}
			}

			/** @param {string} signal */
			function onSignal(signal) {
				shutdown(signal);
			}

			// Post-middleware hook — runs after Vite sets up its own middleware
			return () => {
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

				process.on('SIGINT', onSignal);
				process.on('SIGTERM', onSignal);

				// Cleanup on server close (HMR restart) — prevent listener leaks
				httpServer.on('close', () => {
					process.removeListener('SIGINT', onSignal);
					process.removeListener('SIGTERM', onSignal);

					if (!shutting_down) {
						shutdown('close');
					}
				});
			};
		}
	};
}
