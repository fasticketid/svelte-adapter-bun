import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {Object} BenchResult
 * @property {string} name
 * @property {number} ops_per_sec
 * @property {number} avg_ns
 * @property {number} min_ns
 * @property {number} max_ns
 * @property {number} iterations
 */

/**
 * Run a benchmark function, returning timing statistics.
 * Performs a warmup phase then a measurement phase using Bun.nanoseconds().
 *
 * @param {string} name
 * @param {() => void | Promise<void>} fn
 * @param {number} [iterations=1000]
 * @param {number} [warmup]
 * @returns {BenchResult}
 */
export function bench(
	name,
	fn,
	iterations = 1000,
	warmup = Math.max(10, Math.floor(iterations * 0.1))
) {
	// Warmup
	for (let i = 0; i < warmup; i++) {
		fn();
	}

	/** @type {number[]} */
	const times = new Array(iterations);
	for (let i = 0; i < iterations; i++) {
		const start = Bun.nanoseconds();
		fn();
		times[i] = Bun.nanoseconds() - start;
	}

	let total = 0;
	let min = Infinity;
	let max = -Infinity;
	for (let i = 0; i < iterations; i++) {
		const t = /** @type {number} */ (times[i]);
		total += t;
		if (t < min) min = t;
		if (t > max) max = t;
	}

	const avg_ns = total / iterations;

	return {
		name,
		ops_per_sec: Math.round(1e9 / avg_ns),
		avg_ns: Math.round(avg_ns),
		min_ns: Math.round(min),
		max_ns: Math.round(max),
		iterations
	};
}

/**
 * Async variant of bench() for async functions.
 *
 * @param {string} name
 * @param {() => Promise<void>} fn
 * @param {number} [iterations=1000]
 * @param {number} [warmup]
 * @returns {Promise<BenchResult>}
 */
export async function benchAsync(
	name,
	fn,
	iterations = 1000,
	warmup = Math.max(10, Math.floor(iterations * 0.1))
) {
	// Warmup
	for (let i = 0; i < warmup; i++) {
		await fn();
	}

	/** @type {number[]} */
	const times = new Array(iterations);
	for (let i = 0; i < iterations; i++) {
		const start = Bun.nanoseconds();
		await fn();
		times[i] = Bun.nanoseconds() - start;
	}

	let total = 0;
	let min = Infinity;
	let max = -Infinity;
	for (let i = 0; i < iterations; i++) {
		const t = /** @type {number} */ (times[i]);
		total += t;
		if (t < min) min = t;
		if (t > max) max = t;
	}

	const avg_ns = total / iterations;

	return {
		name,
		ops_per_sec: Math.round(1e9 / avg_ns),
		avg_ns: Math.round(avg_ns),
		min_ns: Math.round(min),
		max_ns: Math.round(max),
		iterations
	};
}

/**
 * @param {string} s
 * @param {number} len
 * @returns {string}
 */
function pad(s, len) {
	return s + ' '.repeat(Math.max(0, len - s.length));
}

/**
 * @param {string} s
 * @param {number} len
 * @returns {string}
 */
function padLeft(s, len) {
	return ' '.repeat(Math.max(0, len - s.length)) + s;
}

/**
 * @param {number} n
 * @returns {string}
 */
function formatNum(n) {
	return n.toLocaleString('en-US');
}

/**
 * @param {number} ns
 * @returns {string}
 */
function nsToMicros(ns) {
	return (ns / 1000).toFixed(2);
}

/**
 * Print a markdown-style comparison table for a set of benchmark results.
 *
 * @param {string} title
 * @param {BenchResult[]} results
 */
export function formatTable(title, results) {
	const COL_NAME = 25;
	const COL_OPS = 13;
	const COL_AVG = 10;

	const border = '─'.repeat(COL_NAME) + '┬' + '─'.repeat(COL_OPS) + '┬' + '─'.repeat(COL_AVG);

	console.log('');
	console.log(`  ${title}`);
	console.log(
		`  ┌─${border}─┐`
	);
	console.log(
		`  │ ${pad('Method', COL_NAME)}│ ${pad('Ops/sec', COL_OPS)}│ ${pad('Avg (μs)', COL_AVG)}│`
	);
	console.log(
		`  ├─${'─'.repeat(COL_NAME)}┼${'─'.repeat(COL_OPS)}┼${'─'.repeat(COL_AVG)}┤`
	);

	for (const r of results) {
		console.log(
			`  │ ${pad(r.name, COL_NAME)}│ ${padLeft(formatNum(r.ops_per_sec), COL_OPS)}│ ${padLeft(nsToMicros(r.avg_ns), COL_AVG)}│`
		);
	}

	console.log(
		`  └─${'─'.repeat(COL_NAME)}┴${'─'.repeat(COL_OPS)}┴${'─'.repeat(COL_AVG)}┘`
	);
}

/**
 * Print a speedup comparison line between two results.
 *
 * @param {BenchResult} baseline
 * @param {BenchResult} contender
 */
export function formatComparison(baseline, contender) {
	const factor = (baseline.avg_ns / contender.avg_ns).toFixed(1);
	if (contender.avg_ns < baseline.avg_ns) {
		console.log(`  → ${contender.name} is ${factor}x faster than ${baseline.name}`);
	} else {
		const inverse = (contender.avg_ns / baseline.avg_ns).toFixed(1);
		console.log(`  → ${baseline.name} is ${inverse}x faster than ${contender.name}`);
	}
}

/**
 * Generate a pseudo-random compressible Uint8Array of the given size.
 * Uses repeating patterns to be somewhat compressible (like real HTML/JS).
 *
 * @param {number} sizeBytes
 * @returns {Uint8Array}
 */
export function generateData(sizeBytes) {
	const buf = new Uint8Array(sizeBytes);
	// Mix of ASCII chars that compress well (like real text content)
	const pattern = 'The quick brown fox jumps over the lazy dog. Lorem ipsum dolor sit amet. ';
	const patternBytes = new TextEncoder().encode(pattern);
	for (let i = 0; i < sizeBytes; i++) {
		buf[i] = /** @type {number} */ (patternBytes[i % patternBytes.length]);
	}
	// Add some variation so it's not perfectly repeating
	for (let i = 0; i < sizeBytes; i += 97) {
		buf[i] = (/** @type {number} */ (buf[i]) + (i & 0xff)) & 0xff;
	}
	return buf;
}

/**
 * Generate repeating HTML-like content (realistic SvelteKit output).
 *
 * @param {number} sizeBytes
 * @returns {Uint8Array}
 */
export function generateHtml(sizeBytes) {
	const chunk =
		'<div class="container"><h1>Page Title</h1><p>Some paragraph text content here.</p>' +
		'<ul><li>Item one</li><li>Item two</li><li>Item three</li></ul>' +
		'<script type="module" src="/_app/immutable/entry/start.js"></script></div>\n';
	const encoder = new TextEncoder();
	const chunkBytes = encoder.encode(chunk);
	const buf = new Uint8Array(sizeBytes);
	for (let i = 0; i < sizeBytes; i++) {
		buf[i] = /** @type {number} */ (chunkBytes[i % chunkBytes.length]);
	}
	return buf;
}

/**
 * Create a temp directory under the benchmarks dir, returns path and cleanup function.
 *
 * @param {string} name
 * @returns {{ path: string, cleanup: () => void }}
 */
export function tmpDir(name) {
	const dir = join(import.meta.dir, `.tmp-${name}-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	return {
		path: dir,
		cleanup: () => rmSync(dir, { recursive: true, force: true })
	};
}
