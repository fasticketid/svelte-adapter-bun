export interface CompressOptions {
	files?: string[];
	gzip?: boolean;
	brotli?: boolean;
}

export interface AdapterOptions {
	/** Build output directory. Default: 'build' */
	out?: string;
	/** Enable precompression of static assets. Default: true */
	precompress?: boolean | CompressOptions;
	/** Prefix for environment variable lookups. Default: '' */
	envPrefix?: string;
	/** Enable development mode. Default: false */
	development?: boolean;
	/** Path to websocket handler file, or false to disable. Default: false */
	websocket?: string | false;
}
