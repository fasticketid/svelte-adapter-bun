import { test, describe, afterAll, beforeAll } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { benchAsync, formatTable, formatComparison, tmpDir, type BenchResult } from './helpers.ts';

let tmp: { path: string; cleanup: () => void };
let srcDir: string;
let bunOutDir: string;
let rollupOutDir: string;

const ITERATIONS = 20;
const allResults: BenchResult[] = [];

beforeAll(() => {
	tmp = tmpDir('build');
	srcDir = join(tmp.path, 'src');
	bunOutDir = join(tmp.path, 'out-bun');
	rollupOutDir = join(tmp.path, 'out-rollup');

	mkdirSync(srcDir, { recursive: true });
	mkdirSync(bunOutDir, { recursive: true });
	mkdirSync(rollupOutDir, { recursive: true });

	// Generate a realistic bundle — multiple modules with imports, ~50KB total
	writeFileSync(
		join(srcDir, 'index.js'),
		`
import { greet } from './utils.js';
import { processData } from './data.js';
import { render } from './render.js';
import config from './config.json';

const app = {
	init() {
		console.log(greet(config.name));
		const data = processData(config.items);
		render(data);
	}
};

export default app;
`.trim()
	);

	writeFileSync(
		join(srcDir, 'utils.js'),
		`
export function greet(name) {
	return \`Hello, \${name}! Welcome to the application.\`;
}

export function capitalize(str) {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

export function debounce(fn, ms) {
	let timer;
	return (...args) => {
		clearTimeout(timer);
		timer = setTimeout(() => fn(...args), ms);
	};
}

export function deepClone(obj) {
	if (obj === null || typeof obj !== 'object') return obj;
	const clone = Array.isArray(obj) ? [] : {};
	for (const key in obj) {
		clone[key] = deepClone(obj[key]);
	}
	return clone;
}

${generateFiller('utils', 8000)}
`.trim()
	);

	writeFileSync(
		join(srcDir, 'data.js'),
		`
import { capitalize, deepClone } from './utils.js';

export function processData(items) {
	return items.map(item => ({
		...deepClone(item),
		label: capitalize(item.name),
		processed: true,
		timestamp: Date.now()
	}));
}

export function filterData(items, predicate) {
	return items.filter(predicate);
}

export function sortData(items, key) {
	return [...items].sort((a, b) => {
		if (a[key] < b[key]) return -1;
		if (a[key] > b[key]) return 1;
		return 0;
	});
}

${generateFiller('data', 8000)}
`.trim()
	);

	writeFileSync(
		join(srcDir, 'render.js'),
		`
import { debounce } from './utils.js';

export function render(data) {
	const container = typeof document !== 'undefined'
		? document.createElement('div')
		: { innerHTML: '' };

	container.innerHTML = data.map(item =>
		\`<div class="item">
			<h2>\${item.label}</h2>
			<p>Processed: \${item.processed}</p>
		</div>\`
	).join('');

	return container;
}

export const debouncedRender = debounce(render, 100);

${generateFiller('render', 8000)}
`.trim()
	);

	writeFileSync(
		join(srcDir, 'config.json'),
		JSON.stringify(
			{
				name: 'BenchmarkApp',
				version: '1.0.0',
				items: Array.from({ length: 50 }, (_, i) => ({
					id: i,
					name: `item_${i}`,
					value: Math.random() * 100
				}))
			},
			null,
			2
		)
	);

	// Additional modules for more realistic bundle size
	for (let i = 0; i < 5; i++) {
		writeFileSync(
			join(srcDir, `module${i}.js`),
			`
export const MODULE_ID = ${i};

export function compute${i}(input) {
	let result = input;
	for (let j = 0; j < 10; j++) {
		result = result * 1.01 + ${i};
	}
	return result;
}

${generateFiller(`module${i}`, 4000)}
`.trim()
		);
	}

	// Update index to import all modules
	const moduleImports = Array.from(
		{ length: 5 },
		(_, i) => `import { compute${i} } from './module${i}.js';`
	).join('\n');
	const moduleUses = Array.from({ length: 5 }, (_, i) => `compute${i}(${i})`).join(', ');

	writeFileSync(
		join(srcDir, 'index.js'),
		`
import { greet } from './utils.js';
import { processData } from './data.js';
import { render } from './render.js';
import config from './config.json';
${moduleImports}

const results = [${moduleUses}];

const app = {
	init() {
		console.log(greet(config.name));
		const data = processData(config.items);
		render(data);
		return results;
	}
};

export default app;
`.trim()
	);
});

/**
 * Generate filler code to simulate realistic module sizes.
 */
function generateFiller(prefix: string, targetBytes: number): string {
	const lines: string[] = [];
	let size = 0;
	let i = 0;
	while (size < targetBytes) {
		const line = `export const ${prefix}_CONST_${i} = "${prefix}_value_${i}_".repeat(3) + "${i}";`;
		lines.push(line);
		size += line.length + 1;
		i++;
	}
	return lines.join('\n');
}

describe('Build time', () => {
	test('correctness: Bun.build() produces output', async () => {
		const result = await Bun.build({
			entrypoints: [join(srcDir, 'index.js')],
			outdir: join(bunOutDir, 'check'),
			target: 'bun',
			format: 'esm',
			splitting: true
		});
		if (!result.success) {
			throw new Error(
				`Bun.build() failed: ${result.logs.map((l) => l.message).join('\n')}`
			);
		}
		if (result.outputs.length === 0) {
			throw new Error('Bun.build() produced no output files');
		}
	});

	test('correctness: Rollup produces output', async () => {
		const { rollup } = await import('rollup');
		const { default: resolve } = await import('@rollup/plugin-node-resolve');
		const { default: commonjs } = await import('@rollup/plugin-commonjs');
		const { default: json } = await import('@rollup/plugin-json');

		const bundle = await rollup({
			input: join(srcDir, 'index.js'),
			plugins: [resolve(), commonjs(), json()]
		});
		const { output } = await bundle.write({
			dir: join(rollupOutDir, 'check'),
			format: 'esm'
		});
		await bundle.close();
		if (output.length === 0) throw new Error('Rollup produced no output');
	});

	test('Bun.build()', async () => {
		let counter = 0;
		allResults.push(
			await benchAsync(
				'Bun.build()',
				async () => {
					const result = await Bun.build({
						entrypoints: [join(srcDir, 'index.js')],
						outdir: join(bunOutDir, `run-${counter++}`),
						target: 'bun',
						format: 'esm',
						splitting: true
					});
					if (!result.success) throw new Error('Bun.build() failed');
				},
				ITERATIONS
			)
		);
	});

	test('Rollup + plugins', async () => {
		const { rollup } = await import('rollup');
		const { default: resolve } = await import('@rollup/plugin-node-resolve');
		const { default: commonjs } = await import('@rollup/plugin-commonjs');
		const { default: json } = await import('@rollup/plugin-json');

		let counter = 0;
		allResults.push(
			await benchAsync(
				'Rollup + plugins',
				async () => {
					const bundle = await rollup({
						input: join(srcDir, 'index.js'),
						plugins: [resolve(), commonjs(), json()]
					});
					await bundle.write({
						dir: join(rollupOutDir, `run-${counter++}`),
						format: 'esm'
					});
					await bundle.close();
				},
				ITERATIONS
			)
		);
	});
});

afterAll(() => {
	console.log('\n╔══════════════════════════════════════════════════╗');
	console.log('║            Build Time Benchmark                  ║');
	console.log('╠══════════════════════════════════════════════════╣');

	formatTable('Bundle time', allResults);

	const bunResult = allResults.find((r) => r.name === 'Bun.build()');
	const rollupResult = allResults.find((r) => r.name === 'Rollup + plugins');
	if (bunResult && rollupResult) {
		formatComparison(rollupResult, bunResult);
	}

	tmp.cleanup();
});
