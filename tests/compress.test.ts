import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { compress } from '../src/compress.ts';

const TMP_DIR = join(import.meta.dir, '.tmp-compress');

beforeEach(() => {
	mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
	rmSync(TMP_DIR, { recursive: true, force: true });
});

async function writeFile(name: string, content: string) {
	await Bun.write(join(TMP_DIR, name), content);
}

test('creates .gz and .br files for html', async () => {
	await writeFile('index.html', '<html><body>Hello World</body></html>');

	await compress(TMP_DIR);

	expect(Bun.file(join(TMP_DIR, 'index.html.gz')).size).toBeGreaterThan(0);
	expect(Bun.file(join(TMP_DIR, 'index.html.br')).size).toBeGreaterThan(0);
});

test('creates .gz and .br files for js', async () => {
	await writeFile('app.js', 'console.log("hello world");');

	await compress(TMP_DIR);

	expect(Bun.file(join(TMP_DIR, 'app.js.gz')).size).toBeGreaterThan(0);
	expect(Bun.file(join(TMP_DIR, 'app.js.br')).size).toBeGreaterThan(0);
});

test('creates .gz and .br files for css', async () => {
	await writeFile('style.css', 'body { color: red; }');

	await compress(TMP_DIR);

	expect(Bun.file(join(TMP_DIR, 'style.css.gz')).size).toBeGreaterThan(0);
	expect(Bun.file(join(TMP_DIR, 'style.css.br')).size).toBeGreaterThan(0);
});

test('compresses nested files', async () => {
	mkdirSync(join(TMP_DIR, 'sub'), { recursive: true });
	await writeFile('sub/nested.json', '{"key":"value"}');

	await compress(TMP_DIR);

	expect(Bun.file(join(TMP_DIR, 'sub/nested.json.gz')).size).toBeGreaterThan(0);
	expect(Bun.file(join(TMP_DIR, 'sub/nested.json.br')).size).toBeGreaterThan(0);
});

test('skips non-matching extensions', async () => {
	await writeFile('image.png', 'fake png data');

	await compress(TMP_DIR);

	expect(await Bun.file(join(TMP_DIR, 'image.png.gz')).exists()).toBe(false);
	expect(await Bun.file(join(TMP_DIR, 'image.png.br')).exists()).toBe(false);
});

test('gzip only when brotli disabled', async () => {
	await writeFile('data.json', '{"hello":"world"}');

	await compress(TMP_DIR, { brotli: false });

	expect(Bun.file(join(TMP_DIR, 'data.json.gz')).size).toBeGreaterThan(0);
	expect(await Bun.file(join(TMP_DIR, 'data.json.br')).exists()).toBe(false);
});

test('brotli only when gzip disabled', async () => {
	await writeFile('data.json', '{"hello":"world"}');

	await compress(TMP_DIR, { gzip: false });

	expect(await Bun.file(join(TMP_DIR, 'data.json.gz')).exists()).toBe(false);
	expect(Bun.file(join(TMP_DIR, 'data.json.br')).size).toBeGreaterThan(0);
});

test('no compression when both disabled', async () => {
	await writeFile('data.json', '{"hello":"world"}');

	await compress(TMP_DIR, { gzip: false, brotli: false });

	expect(await Bun.file(join(TMP_DIR, 'data.json.gz')).exists()).toBe(false);
	expect(await Bun.file(join(TMP_DIR, 'data.json.br')).exists()).toBe(false);
});

test('custom file extensions', async () => {
	await writeFile('data.json', '{"hello":"world"}');
	await writeFile('page.html', '<h1>test</h1>');

	await compress(TMP_DIR, { files: ['json'] });

	expect(Bun.file(join(TMP_DIR, 'data.json.gz')).size).toBeGreaterThan(0);
	expect(await Bun.file(join(TMP_DIR, 'page.html.gz')).exists()).toBe(false);
});

test('compressed output is smaller than original for repetitive content', async () => {
	const content = 'x'.repeat(10000);
	await writeFile('big.txt', content);

	await compress(TMP_DIR);

	const original_size = Bun.file(join(TMP_DIR, 'big.txt')).size;
	const gz_size = Bun.file(join(TMP_DIR, 'big.txt.gz')).size;
	const br_size = Bun.file(join(TMP_DIR, 'big.txt.br')).size;

	expect(gz_size).toBeLessThan(original_size);
	expect(br_size).toBeLessThan(original_size);
});

test('decompressed gzip matches original', async () => {
	const content = 'Hello, this is a test of compression!';
	await writeFile('test.txt', content);

	await compress(TMP_DIR);

	const compressed = await Bun.file(join(TMP_DIR, 'test.txt.gz')).arrayBuffer();
	const decompressed = Bun.gunzipSync(new Uint8Array(compressed));
	const result = new TextDecoder().decode(decompressed);

	expect(result).toBe(content);
});
