import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compress } from './compress.js';

export { lifecyclePlugin } from './plugin.js';

/** @typedef {import('@sveltejs/kit').Adapter} Adapter */
/** @typedef {import('./types.js').AdapterOptions} AdapterOptions */
/** @typedef {import('./types.js').CompressOptions} CompressOptions */

// Node built-in modules to externalize from the bundle
const NODE_BUILTINS = [
	'assert',
	'buffer',
	'child_process',
	'cluster',
	'console',
	'constants',
	'crypto',
	'dgram',
	'dns',
	'domain',
	'events',
	'fs',
	'http',
	'http2',
	'https',
	'module',
	'net',
	'os',
	'path',
	'perf_hooks',
	'process',
	'punycode',
	'querystring',
	'readline',
	'repl',
	'stream',
	'string_decoder',
	'sys',
	'timers',
	'tls',
	'tty',
	'url',
	'util',
	'v8',
	'vm',
	'wasi',
	'worker_threads',
	'zlib'
];

// Both prefixed and unprefixed forms (issue #80)
const EXTERNAL_BUILTINS = [
	...NODE_BUILTINS,
	...NODE_BUILTINS.map((m) => `node:${m}`)
];

/**
 * SvelteKit adapter for Bun. Produces a standalone server via Bun.serve().
 * @param {AdapterOptions} [opts={}]
 * @returns {Adapter}
 * @example adapter({ out: 'build', precompress: true })
 * @example adapter({ websocket: 'src/websocket.ts', envPrefix: 'APP_' })
 */
export default function adapter(opts = {}) {
	const {
		out = 'build',
		precompress = true,
		envPrefix = '',
		development = false,
		websocket = false
	} = opts;

	return {
		name: 'svelte-adapter-bun',

		/**
		 * Build pipeline: copy assets → compress → bundle with Bun.build() → copy runtime templates.
		 * @param {import('@sveltejs/kit').Builder} builder
		 */
		async adapt(builder) {
			const tmp = builder.getBuildDirectory('adapter-bun');
			const out_dir = resolve(out);

			// 1. Clean output directory
			builder.rimraf(out_dir);
			builder.mkdirp(out_dir);
			builder.mkdirp(tmp);

			builder.log.minor('Copying client assets...');
			const client_dir = join(out_dir, 'client');
			builder.writeClient(client_dir);

			builder.log.minor('Copying prerendered pages...');
			const prerendered_dir = join(out_dir, 'prerendered');
			builder.writePrerendered(prerendered_dir);

			// 2. Compress static assets
			if (precompress) {
				builder.log.minor('Compressing assets...');

				/** @type {CompressOptions} */
				const compress_options =
					typeof precompress === 'object' ? precompress : {};

				await compress(client_dir, compress_options);
				await compress(prerendered_dir, compress_options);
			}

			// 3. Write server code to temp directory
			builder.log.minor('Writing server code...');
			builder.writeServer(tmp);

			// 4. Generate manifest
			const prerendered_entries = new Set(builder.prerendered.paths);

			// Build websocket info
			let websocket_path = '';
			if (websocket) {
				const ws_file = resolve(websocket);
				if (!existsSync(ws_file)) {
					throw new Error(
						`WebSocket handler file not found: ${websocket}\n` +
							`Create the file or set websocket: false in adapter options.`
					);
				}
				websocket_path = ws_file;
			}

			const manifest_content = `
import { Server } from './index.js';

export const manifest = ${builder.generateManifest({ relativePath: './' })};

export const prerendered = new Set(${JSON.stringify([...prerendered_entries])});

export const base_path = ${JSON.stringify(builder.config.kit.paths.base)};
`;

			await Bun.write(join(tmp, 'manifest.js'), manifest_content);

			// 5. Bundle with Bun.build()
			builder.log.minor('Bundling with Bun.build()...');

			// Read package.json for external dependencies
			/** @type {string[]} */
			let pkg_dependencies = [];
			try {
				const pkg_path = resolve('package.json');
				const pkg = JSON.parse(readFileSync(pkg_path, 'utf-8'));
				pkg_dependencies = Object.keys(pkg.dependencies || {});
			} catch {
				// No package.json or no dependencies
			}

			const build_result = await Bun.build({
				entrypoints: [join(tmp, 'index.js'), join(tmp, 'manifest.js')],
				outdir: join(out_dir, 'server'),
				target: 'bun',
				format: 'esm',
				sourcemap: 'linked',
				splitting: true,
				external: [...EXTERNAL_BUILTINS, ...pkg_dependencies],
				naming: {
					chunk: 'chunks/[name]-[hash].[ext]'
				}
			});

			if (!build_result.success) {
				const errors = build_result.logs.filter((l) => l.level === 'error');
				throw new Error(
					`Bun.build() failed:\n${errors.map((e) => e.message).join('\n')}`
				);
			}

			// 6. Build options for template token replacement
			const protocol_header = opts.envPrefix
				? `${opts.envPrefix}PROTOCOL_HEADER`
				: 'PROTOCOL_HEADER';
			const host_header = opts.envPrefix
				? `${opts.envPrefix}HOST_HEADER`
				: 'HOST_HEADER';
			const port_header = opts.envPrefix
				? `${opts.envPrefix}PORT_HEADER`
				: 'PORT_HEADER';

			const build_options = JSON.stringify({
				client_directory: './client',
				prerendered_directory: './prerendered',
				protocol_header: Bun.env[protocol_header] || '',
				host_header: Bun.env[host_header] || '',
				port_header: Bun.env[port_header] || '',
				websocket: !!websocket,
				websocket_path: websocket_path ? `./websocket.js` : '',
				development
			});

			// 7. Copy template files with token replacement
			builder.log.minor('Copying runtime files...');

			const files_dir = new URL('./files', import.meta.url).pathname;

			builder.copy(files_dir, out_dir, {
				replace: {
					SERVER: './server/index.js',
					MANIFEST: './server/manifest.js',
					HANDLER: './handler.js',
					ENV: './env.js',
					ENV_PREFIX: JSON.stringify(envPrefix),
					BUILD_OPTIONS: build_options
				}
			});

			// 8. Copy websocket handler if configured
			if (websocket && websocket_path) {
				const ws_content = readFileSync(websocket_path, 'utf-8');
				await Bun.write(join(out_dir, 'websocket.js'), ws_content);
			}

			// 9. Write output package.json
			const output_pkg = {
				type: 'module',
				scripts: {
					start: 'bun ./index.js'
				}
			};

			await Bun.write(
				join(out_dir, 'package.json'),
				JSON.stringify(output_pkg, null, '\t')
			);

			builder.log.success(`Adapter output written to ${out_dir}`);
			builder.log.minor(`  Start with: cd ${out} && bun ./index.js`);
		}
	};
}
