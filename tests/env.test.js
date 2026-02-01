import { test, expect, beforeEach, afterEach, describe } from 'bun:test';

// We test the env logic directly since the template file uses global tokens.
// We re-implement the env/timeout_env logic here to test the actual behavior.

describe('env()', () => {
	const original_env = { ...Bun.env };

	afterEach(() => {
		// Restore env
		for (const key of Object.keys(Bun.env)) {
			if (!(key in original_env)) {
				delete Bun.env[key];
			}
		}
		for (const [key, value] of Object.entries(original_env)) {
			Bun.env[key] = /** @type {string} */ (value);
		}
	});

	/**
	 * @param {string} name
	 * @param {string} [fallback]
	 * @param {string} [prefix='']
	 */
	function env(name, fallback, prefix = '') {
		const prefixed = prefix + name;
		if (prefixed in Bun.env) return Bun.env[prefixed];
		if (name in Bun.env) return Bun.env[name];
		return fallback;
	}

	test('returns env var value', () => {
		Bun.env.TEST_VAR = 'hello';
		expect(env('TEST_VAR')).toBe('hello');
	});

	test('returns fallback when env var not set', () => {
		delete Bun.env.NONEXISTENT_VAR;
		expect(env('NONEXISTENT_VAR', 'default_val')).toBe('default_val');
	});

	test('returns undefined when no fallback and no env var', () => {
		delete Bun.env.NONEXISTENT_VAR;
		expect(env('NONEXISTENT_VAR')).toBeUndefined();
	});

	test('prefers prefixed env var', () => {
		Bun.env.PORT = '3000';
		Bun.env.APP_PORT = '4000';
		expect(env('PORT', undefined, 'APP_')).toBe('4000');
	});

	test('falls back to unprefixed when prefixed not set', () => {
		Bun.env.PORT = '3000';
		delete Bun.env.APP_PORT;
		expect(env('PORT', undefined, 'APP_')).toBe('3000');
	});

	test('empty prefix works like no prefix', () => {
		Bun.env.HOST = 'localhost';
		expect(env('HOST', undefined, '')).toBe('localhost');
	});
});

describe('timeout_env()', () => {
	/**
	 * @param {string} name
	 * @param {number} fallback
	 */
	function timeout_env(name, fallback) {
		const value = Bun.env[name];
		if (value === undefined) return fallback;

		const parsed = parseInt(value, 10);
		if (isNaN(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
			throw new Error(
				`Invalid value for ${name}: "${value}" (expected a non-negative integer)`
			);
		}
		return parsed;
	}

	const original_env = { ...Bun.env };

	afterEach(() => {
		for (const key of Object.keys(Bun.env)) {
			if (!(key in original_env)) {
				delete Bun.env[key];
			}
		}
		for (const [key, value] of Object.entries(original_env)) {
			Bun.env[key] = /** @type {string} */ (value);
		}
	});

	test('returns fallback when env var not set', () => {
		delete Bun.env.SHUTDOWN_TIMEOUT;
		expect(timeout_env('SHUTDOWN_TIMEOUT', 30)).toBe(30);
	});

	test('parses valid integer', () => {
		Bun.env.SHUTDOWN_TIMEOUT = '60';
		expect(timeout_env('SHUTDOWN_TIMEOUT', 30)).toBe(60);
	});

	test('parses zero', () => {
		Bun.env.IDLE_TIMEOUT = '0';
		expect(timeout_env('IDLE_TIMEOUT', 10)).toBe(0);
	});

	test('throws on negative value', () => {
		Bun.env.SHUTDOWN_TIMEOUT = '-5';
		expect(() => timeout_env('SHUTDOWN_TIMEOUT', 30)).toThrow('non-negative integer');
	});

	test('throws on non-numeric value', () => {
		Bun.env.SHUTDOWN_TIMEOUT = 'abc';
		expect(() => timeout_env('SHUTDOWN_TIMEOUT', 30)).toThrow('non-negative integer');
	});

	test('truncates float value to integer (parseInt behavior)', () => {
		Bun.env.SHUTDOWN_TIMEOUT = '3.5';
		expect(timeout_env('SHUTDOWN_TIMEOUT', 30)).toBe(3);
	});

	test('throws on empty string', () => {
		Bun.env.SHUTDOWN_TIMEOUT = '';
		expect(() => timeout_env('SHUTDOWN_TIMEOUT', 30)).toThrow('non-negative integer');
	});
});

describe('env prefix whitelist validation', () => {
	const expected = new Set([
		'SOCKET_PATH', 'HOST', 'PORT', 'ORIGIN', 'XFF_DEPTH',
		'ADDRESS_HEADER', 'PROTOCOL_HEADER', 'HOST_HEADER', 'PORT_HEADER',
		'BODY_SIZE_LIMIT', 'SHUTDOWN_TIMEOUT', 'IDLE_TIMEOUT'
	]);

	/**
	 * Re-implement the whitelist validation from env.js
	 * @param {string} prefix
	 */
	function validate_env_prefix(prefix) {
		if (prefix) {
			for (const name of Object.keys(Bun.env)) {
				if (name.startsWith(prefix)) {
					const unprefixed = name.slice(prefix.length);
					if (!expected.has(unprefixed)) {
						throw new Error(
							`You should change envPrefix (currently "${prefix}") to avoid conflicts ` +
							`with existing environment variables — unexpectedly saw ${name}`
						);
					}
				}
			}
		}
	}

	const original_env = { ...Bun.env };

	afterEach(() => {
		for (const key of Object.keys(Bun.env)) {
			if (!(key in original_env)) {
				delete Bun.env[key];
			}
		}
		for (const [key, value] of Object.entries(original_env)) {
			Bun.env[key] = /** @type {string} */ (value);
		}
	});

	test('throws on unknown prefixed env var', () => {
		Bun.env.APP_BOGUS = 'oops';
		expect(() => validate_env_prefix('APP_')).toThrow('unexpectedly saw APP_BOGUS');
	});

	test('allows known prefixed env vars', () => {
		Bun.env.APP_PORT = '4000';
		Bun.env.APP_HOST = '0.0.0.0';
		Bun.env.APP_ORIGIN = 'https://example.com';
		expect(() => validate_env_prefix('APP_')).not.toThrow();
	});

	test('skips validation when prefix is empty', () => {
		Bun.env.RANDOM_THING = 'fine';
		expect(() => validate_env_prefix('')).not.toThrow();
	});

	test('ignores env vars that do not match prefix', () => {
		Bun.env.OTHER_BOGUS = 'whatever';
		Bun.env.MY_PORT = '3000';
		expect(() => validate_env_prefix('MY_')).not.toThrow();
	});

	test('allows all known env var names', () => {
		for (const name of expected) {
			Bun.env[`TEST_${name}`] = 'val';
		}
		expect(() => validate_env_prefix('TEST_')).not.toThrow();
		// cleanup
		for (const name of expected) {
			delete Bun.env[`TEST_${name}`];
		}
	});
});
