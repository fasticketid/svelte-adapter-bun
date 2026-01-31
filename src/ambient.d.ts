declare namespace App {
	interface Platform {
		/** The original Bun request object */
		req: Request;
		/** The Bun server instance (useful for WebSocket pub/sub) */
		server: import('bun').Server;
	}
}
