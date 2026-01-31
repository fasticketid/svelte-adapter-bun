import { test, describe, afterAll, beforeAll } from 'bun:test';
import { mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { bench, formatTable, formatComparison, tmpDir } from './helpers.js';

/** @typedef {import('./helpers.js').BenchResult} BenchResult */

const DIR_SIZES = [
	{ label: 'small (50 files)', count: 50, iterations: 2000 },
	{ label: 'medium (500 files)', count: 500, iterations: 500 },
	{ label: 'large (2000 files)', count: 2000, iterations: 100 }
];

const EXTENSIONS = ['.html', '.js', '.css', '.json', '.svg', '.txt', '.map', '.png', '.woff2'];

/** @type {{ path: string, cleanup: () => void }} */
let tmp;

/** @type {Array<{ label: string, results: BenchResult[] }>} */
const allResults = [];

/**
 * Recursive readdirSync + filter (tiny-glob/totalist style approach used by adapter-node).
 *
 * @param {string} dir
 * @param {RegExp} pattern
 * @param {string[]} [results=[]]
 * @returns {string[]}
 */
function recursiveReaddir(dir, pattern, results = []) {
	const entries = readdirSync(dir);
	for (const entry of entries) {
		const abs = join(dir, entry);
		const stats = statSync(abs);
		if (stats.isDirectory()) {
			recursiveReaddir(abs, pattern, results);
		} else if (pattern.test(entry)) {
			results.push(abs);
		}
	}
	return results;
}

/**
 * Modern Node.js recursive readdir + filter.
 *
 * @param {string} dir
 * @param {RegExp} pattern
 * @returns {string[]}
 */
function modernReaddir(dir, pattern) {
	const all = /** @type {string[]} */ (readdirSync(dir, { recursive: true }));
	return all.filter((f) => pattern.test(f)).map((f) => join(dir, f));
}

beforeAll(() => {
	tmp = tmpDir('glob');

	for (const { label, count } of DIR_SIZES) {
		const dirName = label.replace(/[^a-z0-9]/gi, '_');
		const baseDir = join(tmp.path, dirName);
		mkdirSync(baseDir, { recursive: true });

		// Create subdirectories for realism
		const subdirs = ['assets', 'components', 'routes', 'lib', 'api'];
		for (const sub of subdirs) {
			mkdirSync(join(baseDir, sub), { recursive: true });
		}
		const allDirs = [baseDir, ...subdirs.map((s) => join(baseDir, s))];

		for (let i = 0; i < count; i++) {
			const ext = /** @type {string} */ (EXTENSIONS[i % EXTENSIONS.length]);
			const dir = /** @type {string} */ (allDirs[i % allDirs.length]);
			writeFileSync(join(dir, `file${i}${ext}`), `content-${i}`);
		}
	}
});

describe('Glob / file discovery', () => {
	for (const { label, count, iterations } of DIR_SIZES) {
		const dirName = label.replace(/[^a-z0-9]/gi, '_');

		describe(label, () => {
			/** @type {BenchResult[]} */
			const results = [];
			/** @type {string} */
			let baseDir;

			test('setup', () => {
				baseDir = join(tmp.path, dirName);
			});

			test('correctness: same file count for JS glob', () => {
				const glob = new Bun.Glob('**/*.js');
				const bunFiles = [...glob.scanSync({ cwd: baseDir, absolute: true })];
				const tinyGlobFiles = recursiveReaddir(baseDir, /\.js$/);
				const modernFiles = modernReaddir(baseDir, /\.js$/);

				// All should find the same number of .js files
				if (bunFiles.length !== tinyGlobFiles.length) {
					throw new Error(
						`Bun.Glob found ${bunFiles.length} files, recursive readdir found ${tinyGlobFiles.length}`
					);
				}
				if (bunFiles.length !== modernFiles.length) {
					throw new Error(
						`Bun.Glob found ${bunFiles.length} files, modern readdir found ${modernFiles.length}`
					);
				}
			});

			test('Bun.Glob.scanSync', () => {
				const pattern = '**/*.{html,js,css,json,svg}';
				results.push(
					bench(
						'Bun.Glob.scanSync',
						() => {
							const glob = new Bun.Glob(pattern);
							// Consume the iterator
							const files = [...glob.scanSync({ cwd: baseDir, absolute: true })];
							if (files.length === 0) throw new Error('No files found');
						},
						iterations
					)
				);
			});

			test('recursive readdirSync + filter', () => {
				const pattern = /\.(html|js|css|json|svg)$/;
				results.push(
					bench(
						'recursive readdir+filter',
						() => {
							const files = recursiveReaddir(baseDir, pattern);
							if (files.length === 0) throw new Error('No files found');
						},
						iterations
					)
				);
			});

			test('Node recursive readdir', () => {
				const pattern = /\.(html|js|css|json|svg)$/;
				results.push(
					bench(
						'Node recursive readdir',
						() => {
							const files = modernReaddir(baseDir, pattern);
							if (files.length === 0) throw new Error('No files found');
						},
						iterations
					)
				);
			});

			test(`collect: ${label}`, () => {
				allResults.push({ label, results });
			});
		});
	}
});

afterAll(() => {
	console.log('\n╔══════════════════════════════════════════════════╗');
	console.log('║          File Discovery / Glob Benchmark         ║');
	console.log('╠══════════════════════════════════════════════════╣');

	for (const { label, results } of allResults) {
		if (results.length >= 2) {
			formatTable(label, results);
			const bunResult = results.find((r) => r.name === 'Bun.Glob.scanSync');
			const tinyGlob = results.find((r) => r.name === 'recursive readdir+filter');
			const modernNode = results.find((r) => r.name === 'Node recursive readdir');
			if (bunResult && tinyGlob) formatComparison(tinyGlob, bunResult);
			if (bunResult && modernNode) formatComparison(modernNode, bunResult);
		}
	}

	tmp.cleanup();
});
