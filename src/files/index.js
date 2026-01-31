/* global HANDLER, ENV */

import createHandler, { env } from 'HANDLER';
import { timeout_env } from 'ENV';

const { httpserver, websocket } = createHandler();

const socket_path = env('SOCKET_PATH');
const host = env('HOST', '0.0.0.0');
const port = parseInt(env('PORT', '3000'));
const idle_timeout = timeout_env('IDLE_TIMEOUT', 0) || undefined;
const shutdown_timeout = timeout_env('SHUTDOWN_TIMEOUT', 30);

/** @param {string} event @param {...any} args */
async function emit_and_await(event, ...args) {
	const listeners = process.listeners(event);
	await Promise.all(listeners.map((fn) => fn(...args)));
}

const server = Bun.serve({
	fetch: httpserver,
	hostname: socket_path ? undefined : host,
	port: socket_path ? undefined : port,
	unix: socket_path || undefined,
	websocket,
	idleTimeout: idle_timeout,
	development: false
});

// Graceful shutdown (issues #52, #69)
async function shutdown(reason) {
	console.log('Shutting down gracefully...');
	server.stop();

	const timer = setTimeout(() => {
		console.log('Shutdown timeout reached, forcing exit');
		process.exit(1);
	}, shutdown_timeout * 1000);

	// Don't let the timer keep the process alive
	timer.unref();

	try {
		await emit_and_await('sveltekit:shutdown', reason);
	} catch (e) {
		console.error('Error in sveltekit:shutdown listener:', e);
	}
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
	await emit_and_await('sveltekit:startup', {
		server,
		host: socket_path ? undefined : host,
		port: socket_path ? undefined : server.port,
		socket_path: socket_path || undefined
	});
} catch (e) {
	console.error('Error in sveltekit:startup listener:', e);
}

if (socket_path) {
	console.log(`Listening on ${socket_path}`);
} else {
	console.log(`Listening on ${host}:${server.port}`);
}

export { server, host, port };
