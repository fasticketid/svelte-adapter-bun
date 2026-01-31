import { test, describe, afterAll, beforeAll } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { benchAsync, formatTable, tmpDir, generateHtml, type BenchResult } from './helpers.ts';

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let tmp: { path: string; cleanup: () => void };

const ITERATIONS = 2000;
const allResults: BenchResult[] = [];

beforeAll(() => {
	tmp = tmpDir('http-throughput');

	// Create a fixture HTML file for the /file endpoint
	const htmlData = generateHtml(4096);
	writeFileSync(join(tmp.path, 'page.html'), htmlData);

	const filePath = join(tmp.path, 'page.html');

	server = Bun.serve({
		port: 0, // random available port
		fetch(req) {
			const url = new URL(req.url);

			switch (url.pathname) {
				case '/json':
					return new Response(
						JSON.stringify({ message: 'Hello, World!', timestamp: Date.now() }),
						{ headers: { 'Content-Type': 'application/json' } }
					);

				case '/static':
					return new Response(
						'<!DOCTYPE html><html><body><h1>Hello, World!</h1></body></html>',
						{ headers: { 'Content-Type': 'text/html' } }
					);

				case '/file':
					return new Response(Bun.file(filePath));

				default:
					return new Response('Not Found', { status: 404 });
			}
		}
	});

	baseUrl = `http://localhost:${server.port}`;
});

describe('HTTP throughput (Bun.serve)', () => {
	test('correctness: endpoints respond correctly', async () => {
		const jsonRes = await fetch(`${baseUrl}/json`);
		const json = (await jsonRes.json()) as { message: string };
		if (!json.message) throw new Error('JSON endpoint broken');

		const staticRes = await fetch(`${baseUrl}/static`);
		const html = await staticRes.text();
		if (!html.includes('Hello')) throw new Error('Static endpoint broken');

		const fileRes = await fetch(`${baseUrl}/file`);
		if (fileRes.status !== 200) throw new Error('File endpoint broken');
		await fileRes.arrayBuffer(); // consume body
	});

	test('/json — JSON.stringify response', async () => {
		allResults.push(
			await benchAsync(
				'/json (JSON.stringify)',
				async () => {
					const res = await fetch(`${baseUrl}/json`);
					await res.arrayBuffer(); // consume body
				},
				ITERATIONS
			)
		);
	});

	test('/static — static HTML string', async () => {
		allResults.push(
			await benchAsync(
				'/static (HTML string)',
				async () => {
					const res = await fetch(`${baseUrl}/static`);
					await res.arrayBuffer();
				},
				ITERATIONS
			)
		);
	});

	test('/file — Bun.file() response', async () => {
		allResults.push(
			await benchAsync(
				'/file (Bun.file)',
				async () => {
					const res = await fetch(`${baseUrl}/file`);
					await res.arrayBuffer();
				},
				ITERATIONS
			)
		);
	});
});

afterAll(() => {
	console.log('\n╔══════════════════════════════════════════════════╗');
	console.log('║         HTTP Throughput (Bun.serve)              ║');
	console.log('╠══════════════════════════════════════════════════╣');

	formatTable('Endpoint throughput', allResults);

	// Also compute requests/sec summary
	for (const r of allResults) {
		const rps = r.ops_per_sec;
		console.log(`  ${r.name}: ${rps.toLocaleString('en-US')} req/sec`);
	}

	server.stop();
	tmp.cleanup();
});
