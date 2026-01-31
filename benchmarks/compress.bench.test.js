import { test, describe, afterAll } from 'bun:test';
import { gzipSync, gunzipSync, createGzip, constants, brotliCompressSync } from 'node:zlib';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
	bench,
	benchAsync,
	formatTable,
	formatComparison,
	generateData
} from './helpers.js';

/** @typedef {import('./helpers.js').BenchResult} BenchResult */

const SIZES = [
	{ label: '1KB', bytes: 1024, iterations: 2000 },
	{ label: '10KB', bytes: 10240, iterations: 2000 },
	{ label: '100KB', bytes: 102400, iterations: 500 },
	{ label: '1MB', bytes: 1048576, iterations: 100 }
];

// Pre-generate buffers for each size
/** @type {Map<string, Uint8Array>} */
const buffers = new Map();
for (const s of SIZES) {
	buffers.set(s.label, generateData(s.bytes));
}

/** @type {Array<{ label: string, results: BenchResult[] }>} */
const allGzipResults = [];
/** @type {Array<{ label: string, results: BenchResult[] }>} */
const allDecompressResults = [];

// Writable that collects chunks into a buffer
class CollectStream extends (await import('node:stream')).Writable {
	chunks = /** @type {Buffer[]} */ ([]);
	/**
	 * @override
	 * @param {Buffer} chunk
	 * @param {string} _encoding
	 * @param {() => void} callback
	 */
	_write(chunk, _encoding, callback) {
		this.chunks.push(chunk);
		callback();
	}
	toBuffer() {
		return Buffer.concat(this.chunks);
	}
}

describe('Gzip compression', () => {
	for (const { label, iterations } of SIZES) {
		const buffer = /** @type {Uint8Array} */ (buffers.get(label));

		describe(`Size: ${label}`, () => {
			/** @type {BenchResult[]} */
			const results = [];

			test('correctness: outputs match', () => {
				const buf = /** @type {Uint8Array<ArrayBuffer>} */ (new Uint8Array(buffer.buffer));
				const bunResult = Bun.gzipSync(buf, { level: 9 });
				const nodeResult = gzipSync(buffer, { level: 9 });

				// Verify decompression roundtrip produces the same original
				const bunDecompressed = Bun.gunzipSync(
					new Uint8Array(bunResult.buffer)
				);
				const nodeDecompressed = gunzipSync(nodeResult);

				const original = Buffer.from(buffer);
				if (Buffer.compare(Buffer.from(bunDecompressed), original) !== 0) {
					throw new Error('Bun gzip roundtrip mismatch');
				}
				if (Buffer.compare(nodeDecompressed, original) !== 0) {
					throw new Error('Node gzip roundtrip mismatch');
				}
			});

			test('Bun.gzipSync', () => {
				const buf = /** @type {Uint8Array<ArrayBuffer>} */ (new Uint8Array(buffer.buffer));
				results.push(
					bench(
						'Bun.gzipSync',
						() => {
							Bun.gzipSync(buf, { level: 9 });
						},
						iterations
					)
				);
			});

			test('zlib.gzipSync (Node)', () => {
				results.push(
					bench(
						'zlib.gzipSync (Node)',
						() => {
							gzipSync(buffer, { level: 9 });
						},
						iterations
					)
				);
			});

			test('zlib stream pipeline', async () => {
				results.push(
					await benchAsync(
						'zlib stream pipeline',
						async () => {
							const input = new PassThrough();
							const gzip = createGzip({ level: 9 });
							const collector = new CollectStream();

							const done = pipeline(input, gzip, collector);
							input.end(buffer);
							await done;
						},
						// Streams have higher overhead, use fewer iterations for large sizes
						Math.max(50, Math.floor(iterations / 2))
					)
				);
			});

			test(`results: ${label}`, () => {
				allGzipResults.push({ label, results });
			});
		});
	}
});

describe('Brotli compression', () => {
	for (const { label, bytes } of SIZES) {
		const buffer = /** @type {Uint8Array} */ (buffers.get(label));

		// Brotli quality 11 is extremely slow for large inputs
		const brotliIterations =
			bytes <= 1024 ? 200 : bytes <= 10240 ? 50 : bytes <= 102400 ? 5 : 2;

		test(
			`brotliCompressSync — ${label}`,
			() => {
				const result = bench(
					`brotli ${label}`,
					() => {
						brotliCompressSync(buffer, {
							params: { [constants.BROTLI_PARAM_QUALITY]: 11 }
						});
					},
					brotliIterations,
					1 // minimal warmup
				);
				console.log(
					`  brotli ${label}: ${result.ops_per_sec.toLocaleString('en-US')} ops/sec, avg ${(result.avg_ns / 1_000_000).toFixed(2)} ms`
				);
			},
			60_000 // 60s timeout for large brotli
		);
	}
});

describe('Gzip decompression', () => {
	for (const { label, iterations } of SIZES) {
		const buffer = /** @type {Uint8Array} */ (buffers.get(label));
		const buf = /** @type {Uint8Array<ArrayBuffer>} */ (new Uint8Array(buffer.buffer));
		const compressed = Bun.gzipSync(buf, { level: 9 });

		describe(`Size: ${label}`, () => {
			/** @type {BenchResult[]} */
			const results = [];

			test('Bun.gunzipSync', () => {
				const comp = new Uint8Array(compressed.buffer);
				results.push(
					bench(
						'Bun.gunzipSync',
						() => {
							Bun.gunzipSync(comp);
						},
						iterations
					)
				);
			});

			test('zlib.gunzipSync (Node)', () => {
				results.push(
					bench(
						'zlib.gunzipSync (Node)',
						() => {
							gunzipSync(compressed);
						},
						iterations
					)
				);
			});

			test(`results: ${label}`, () => {
				allDecompressResults.push({ label, results });
			});
		});
	}
});

afterAll(() => {
	console.log('\n╔══════════════════════════════════════════════════╗');
	console.log('║           Compression Benchmark (Gzip)           ║');
	console.log('╠══════════════════════════════════════════════════╣');

	for (const { label, results } of allGzipResults) {
		if (results.length >= 2) {
			formatTable(`Size: ${label}`, results);
			const bunResult = results.find((r) => r.name === 'Bun.gzipSync');
			const nodeResult = results.find((r) => r.name === 'zlib.gzipSync (Node)');
			const streamResult = results.find((r) => r.name === 'zlib stream pipeline');
			if (bunResult && nodeResult) formatComparison(nodeResult, bunResult);
			if (bunResult && streamResult) formatComparison(streamResult, bunResult);
		}
	}

	console.log('\n╔══════════════════════════════════════════════════╗');
	console.log('║         Decompression Benchmark (Gunzip)         ║');
	console.log('╠══════════════════════════════════════════════════╣');

	for (const { label, results } of allDecompressResults) {
		if (results.length >= 2) {
			formatTable(`Size: ${label}`, results);
			const bunResult = results.find((r) => r.name === 'Bun.gunzipSync');
			const nodeResult = results.find((r) => r.name === 'zlib.gunzipSync (Node)');
			if (bunResult && nodeResult) formatComparison(nodeResult, bunResult);
		}
	}
});
