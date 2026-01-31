// Chat room WebSocket handler
// Works identically in dev (Vite) and prod (Bun.serve())

/**
 * Decide whether to accept the upgrade.
 * Return value is ignored in prod (Bun handles it).
 * In dev, calling server.upgrade() accepts the connection.
 *
 * @param {Request} request
 * @param {object} server
 */
export function upgrade(request, server) {
	const url = new URL(request.url);
	const name = url.searchParams.get('name') || 'anon';

	// Pass per-connection data through upgrade
	server.upgrade(request, {
		data: { name, joinedAt: Date.now() }
	});
}

/**
 * Called when a client connects.
 * @param {import('bun').ServerWebSocket} ws
 */
export function open(ws) {
	ws.subscribe('chat');
	ws.publish('chat', JSON.stringify({
		type: 'system',
		text: `${ws.data.name} joined`
	}));
	ws.send(JSON.stringify({
		type: 'system',
		text: `welcome, ${ws.data.name}`
	}));
}

/**
 * Called when a message is received.
 * @param {import('bun').ServerWebSocket} ws
 * @param {string | ArrayBuffer} message
 */
export function message(ws, message) {
	const text = typeof message === 'string' ? message : new TextDecoder().decode(message);

	// Broadcast to all subscribers (excluding sender)
	ws.publish('chat', JSON.stringify({
		type: 'message',
		from: ws.data.name,
		text
	}));

	// Echo back to sender as confirmation
	ws.send(JSON.stringify({
		type: 'message',
		from: ws.data.name,
		text,
		self: true
	}));
}

/**
 * Called when a client disconnects.
 * @param {import('bun').ServerWebSocket} ws
 * @param {number} code
 * @param {string} reason
 */
export function close(ws, code, reason) {
	ws.publish('chat', JSON.stringify({
		type: 'system',
		text: `${ws.data.name} left`
	}));
}
