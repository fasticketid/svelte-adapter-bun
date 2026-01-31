/**
 * @typedef {Object} CompressOptions
 * @property {string[]} [files]
 * @property {boolean} [gzip]
 * @property {boolean} [brotli]
 */

/**
 * @typedef {Object} AdapterOptions
 * @property {string} [out] Build output directory. Default: 'build'
 * @property {boolean | CompressOptions} [precompress] Enable precompression of static assets. Default: true
 * @property {string} [envPrefix] Prefix for environment variable lookups. Default: ''
 * @property {boolean} [development] Enable development mode. Default: false
 * @property {string | false} [websocket] Path to websocket handler file, or false to disable. Default: false
 */

/**
 * @typedef {Object} LifecyclePluginOptions
 * @property {number} [shutdownTimeout] Timeout in seconds before forced exit during shutdown. Default: 30
 */

export {};
