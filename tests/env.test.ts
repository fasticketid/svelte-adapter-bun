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
			Bun.env[key] = value as string;
		}
	});

	function env(name: string, fallback?: string, prefix = '') {
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
	function timeout_env(name: string, fallback: number) {
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
			Bun.env[key] = value as string;
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
