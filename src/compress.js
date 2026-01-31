import { statSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';

/** @typedef {import('./types.js').CompressOptions} CompressOptions */

const DEFAULT_EXTENSIONS = [
	'html',
	'js',
	'json',
	'css',
	'svg',
	'xml',
	'wasm',
	'txt',
	'ico',
	'mjs',
	'cjs',
	'map'
];

/**
 * Precompress static assets with gzip and/or brotli.
 * Scans directory for matching extensions, writes .gz and .br files alongside originals.
 * @param {string} directory
 * @param {CompressOptions} [options={}]
 * @example await compress('/build/client')
 * @example await compress('/build', { files: ['html'], gzip: false })
 */
export async function compress(directory, options = {}) {
	const extensions = options.files ?? DEFAULT_EXTENSIONS;
	const do_gzip = options.gzip !== false;
	const do_brotli = options.brotli !== false;

	if (!do_gzip && !do_brotli) return;

	// Skip if directory doesn't exist (e.g. no prerendered pages)
	const stat = statSync(directory, { throwIfNoEntry: false });
	if (!stat?.isDirectory()) return;

	const pattern = `**/*.{${extensions.join(',')}}`;
	const glob = new Bun.Glob(pattern);
	const files = [...glob.scanSync({ cwd: directory, absolute: true })];

	await Promise.all(
		files.map(async (file_path) => {
			const data = await Bun.file(file_path).arrayBuffer();
			const buffer = new Uint8Array(data);

			/** @type {Promise<number>[]} */
			const tasks = [];

			if (do_gzip) {
				const compressed = Bun.gzipSync(buffer, { level: 9 });
				tasks.push(Bun.write(file_path + '.gz', compressed));
			}

			if (do_brotli) {
				const compressed = brotliCompressSync(buffer, {
					params: {
						[constants.BROTLI_PARAM_QUALITY]: 11
					}
				});
				tasks.push(Bun.write(file_path + '.br', compressed));
			}

			await Promise.all(tasks);
		})
	);
}
