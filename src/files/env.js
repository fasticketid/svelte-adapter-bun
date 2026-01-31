/* global ENV_PREFIX */

/**
 * Look up an environment variable with the configured prefix.
 * @param {string} name
 * @param {string} [fallback]
 * @returns {string}
 */
export function env(name, fallback) {
	const prefix = ENV_PREFIX;
	const prefixed = prefix + name;

	// Check prefixed first, then unprefixed
	if (prefixed in Bun.env) return Bun.env[prefixed];
	if (name in Bun.env) return Bun.env[name];

	return fallback;
}

/**
 * Parse an environment variable as a non-negative integer (for timeouts).
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
export function timeout_env(name, fallback) {
	const value = env(name);

	if (value === undefined) return fallback;

	const parsed = parseInt(value, 10);

	if (isNaN(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
		throw new Error(
			`Invalid value for ${name}: "${value}" (expected a non-negative integer)`
		);
	}

	return parsed;
}
