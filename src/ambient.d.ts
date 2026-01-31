declare namespace App {
	interface Platform {
		/** The original Bun request object */
		req: Request;
		/** The Bun server instance (useful for WebSocket pub/sub) */
		server: import('bun').Server;
	}
}

declare namespace SvelteAdapterBun {
	interface StartupPayload {
		server: import('bun').Server | import('http').Server;
		host: string | undefined;
		port: number | undefined;
		socket_path: string | undefined;
	}
	type ShutdownReason = 'SIGINT' | 'SIGTERM' | 'close';
}
