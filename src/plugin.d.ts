import type { Plugin } from 'vite';

export function lifecyclePlugin(opts?: {
	websocket?: string | false;
}): Plugin;
