/* global HANDLER, ENV */

import createHandler, { env } from 'HANDLER';
import { timeout_env } from 'ENV';

const { httpserver, websocket } = createHandler();

const socket_path = env('SOCKET_PATH');
const host = env('HOST', '0.0.0.0');
const port = parseInt(env('PORT', '3000'));
const idle_timeout = timeout_env('IDLE_TIMEOUT', 0) || undefined;
const shutdown_timeout = timeout_env('SHUTDOWN_TIMEOUT', 30);

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
function shutdown() {
	console.log('Shutting down gracefully...');
	server.stop();

	const timer = setTimeout(() => {
		console.log('Shutdown timeout reached, forcing exit');
		process.exit(1);
	}, shutdown_timeout * 1000);

	// Don't let the timer keep the process alive
	timer.unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (socket_path) {
	console.log(`Listening on ${socket_path}`);
} else {
	console.log(`Listening on ${host}:${server.port}`);
}

export { server, host, port };
