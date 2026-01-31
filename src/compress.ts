import { brotliCompressSync, constants } from 'node:zlib';
import type { CompressOptions } from './types.ts';

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

export async function compress(directory: string, options: CompressOptions = {}) {
	const extensions = options.files ?? DEFAULT_EXTENSIONS;
	const do_gzip = options.gzip !== false;
	const do_brotli = options.brotli !== false;

	if (!do_gzip && !do_brotli) return;

	const pattern = `**/*.{${extensions.join(',')}}`;
	const glob = new Bun.Glob(pattern);
	const files = [...glob.scanSync({ cwd: directory, absolute: true })];

	await Promise.all(
		files.map(async (file_path) => {
			const data = await Bun.file(file_path).arrayBuffer();
			const buffer = new Uint8Array(data);

			const tasks: Promise<number>[] = [];

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
