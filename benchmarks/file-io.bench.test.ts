import { test, describe, afterAll, beforeAll } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	bench,
	benchAsync,
	formatTable,
	formatComparison,
	generateData,
	tmpDir,
	type BenchResult
} from './helpers.ts';

const SIZES = [
	{ label: '1KB', bytes: 1024, iterations: 1000 },
	{ label: '10KB', bytes: 10240, iterations: 1000 },
	{ label: '100KB', bytes: 102400, iterations: 500 },
	{ label: '1MB', bytes: 1048576, iterations: 200 }
] as const;

let tmp: { path: string; cleanup: () => void };

const allReadResults: Array<{ label: string; results: BenchResult[] }> = [];
const allWriteResults: Array<{ label: string; results: BenchResult[] }> = [];

beforeAll(() => {
	tmp = tmpDir('file-io');

	// Create fixture files
	for (const { label, bytes } of SIZES) {
		const data = generateData(bytes);
		writeFileSync(join(tmp.path, `read-${label}.bin`), data);
	}
});

describe('File read', () => {
	for (const { label, bytes, iterations } of SIZES) {
		const data = generateData(bytes);

		describe(`Size: ${label}`, () => {
			const results: BenchResult[] = [];
			let readPath: string;

			test('setup', () => {
				readPath = join(tmp.path, `read-${label}.bin`);
			});

			test('Bun.file().arrayBuffer()', async () => {
				results.push(
					await benchAsync(
						'Bun.file().arrayBuffer()',
						async () => {
							await Bun.file(readPath).arrayBuffer();
						},
						iterations
					)
				);
			});

			test('fs.promises.readFile', async () => {
				results.push(
					await benchAsync(
						'fs.promises.readFile',
						async () => {
							await readFile(readPath);
						},
						iterations
					)
				);
			});

			test('fs.readFileSync', () => {
				results.push(
					bench(
						'fs.readFileSync',
						() => {
							readFileSync(readPath);
						},
						iterations
					)
				);
			});

			test(`collect: ${label}`, () => {
				allReadResults.push({ label, results });
			});
		});
	}
});

describe('File write', () => {
	for (const { label, bytes, iterations } of SIZES) {
		const data = generateData(bytes);

		describe(`Size: ${label}`, () => {
			const results: BenchResult[] = [];

			test('Bun.write()', async () => {
				const p = join(tmp.path, `write-bun-${label}.bin`);
				results.push(
					await benchAsync(
						'Bun.write()',
						async () => {
							await Bun.write(p, data);
						},
						iterations
					)
				);
			});

			test('fs.promises.writeFile', async () => {
				const p = join(tmp.path, `write-node-async-${label}.bin`);
				results.push(
					await benchAsync(
						'fs.promises.writeFile',
						async () => {
							await writeFile(p, data);
						},
						iterations
					)
				);
			});

			test('fs.writeFileSync', () => {
				const p = join(tmp.path, `write-node-sync-${label}.bin`);
				results.push(
					bench(
						'fs.writeFileSync',
						() => {
							writeFileSync(p, data);
						},
						iterations
					)
				);
			});

			test(`collect: ${label}`, () => {
				allWriteResults.push({ label, results });
			});
		});
	}
});

afterAll(() => {
	console.log('\n╔══════════════════════════════════════════════════╗');
	console.log('║             File Read Benchmark                  ║');
	console.log('╠══════════════════════════════════════════════════╣');

	for (const { label, results } of allReadResults) {
		if (results.length >= 2) {
			formatTable(`Size: ${label}`, results);
			const bunResult = results.find((r) => r.name === 'Bun.file().arrayBuffer()');
			const nodeAsync = results.find((r) => r.name === 'fs.promises.readFile');
			if (bunResult && nodeAsync) formatComparison(nodeAsync, bunResult);
		}
	}

	console.log('\n╔══════════════════════════════════════════════════╗');
	console.log('║             File Write Benchmark                 ║');
	console.log('╠══════════════════════════════════════════════════╣');

	for (const { label, results } of allWriteResults) {
		if (results.length >= 2) {
			formatTable(`Size: ${label}`, results);
			const bunResult = results.find((r) => r.name === 'Bun.write()');
			const nodeAsync = results.find((r) => r.name === 'fs.promises.writeFile');
			if (bunResult && nodeAsync) formatComparison(nodeAsync, bunResult);
		}
	}

	tmp.cleanup();
});
