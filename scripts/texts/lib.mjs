/*
 * Shared helpers of the misc/_texts build scripts. Node built-ins only.
 *
 * get(name, url)      one polite, cached download. The body goes to
 *                     scripts/texts/.cache/<name>, with <name>.meta.json beside it
 *                     ({ url, fetched, sha256, bytes }). A second run reads the cache
 *                     and makes no request, so a build from cache is byte-for-byte
 *                     repeatable. The cache folder is gitignored and never published.
 * fresh(url)          one polite download that skips the cache (spot-check.mjs uses it).
 * writeData(...)      writes one data file of the kit and proves it loads.
 *
 * Flags every build script understands:
 *   --offline   never touch the network; fail if something is not in the cache.
 *
 * Politeness: requests are made one at a time (callers await), at least GAP_MS apart,
 * with a User-Agent that names the site and carries no email address.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const CACHE = path.join(HERE, '.cache');
export const OUT = path.join(ROOT, 'misc', '_texts');
export const UA = 'nietztein.github.io texts kit (+https://nietztein.github.io)';
export const OFFLINE = process.argv.includes('--offline');

const GAP_MS = 1500;
let lastRequest = 0;
let requests = 0;

export function sha256(data) {
	return crypto.createHash('sha256').update(data).digest('hex');
}

export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** How many requests this process has made (the rest came from the cache). */
export function requestCount() {
	return requests;
}

/**
 * Download once, then serve from the cache.
 * Returns { buf, text, source: { url, sha256, fetched }, fromCache }.
 */
export async function get(name, url, opts = {}) {
	const file = path.join(CACHE, name);
	const side = file + '.meta.json';
	if (fs.existsSync(file) && fs.existsSync(side)) {
		const buf = fs.readFileSync(file);
		const meta = JSON.parse(fs.readFileSync(side, 'utf8'));
		if (meta.url !== url) throw new Error('cache entry ' + name + ' was fetched from ' + meta.url + ', not ' + url + ' (delete it to refetch)');
		if (meta.sha256 !== sha256(buf)) throw new Error('cache entry ' + name + ' does not match its recorded SHA-256 (delete it to refetch)');
		return { buf, text: buf.toString('utf8'), source: { url, sha256: meta.sha256, fetched: meta.fetched }, fromCache: true };
	}
	if (OFFLINE) throw new Error('--offline: ' + name + ' is not in the cache (' + url + ')');
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const buf = await fresh(url, opts);
	const meta = { url, fetched: new Date().toISOString().slice(0, 10), sha256: sha256(buf), bytes: buf.length };
	fs.writeFileSync(file, buf);
	fs.writeFileSync(side, JSON.stringify(meta, null, '\t') + '\n');
	process.stderr.write('fetched ' + name + ' (' + buf.length + ' bytes)\n');
	return { buf, text: buf.toString('utf8'), source: { url, sha256: meta.sha256, fetched: meta.fetched }, fromCache: false };
}

/**
 * One polite request that does not touch the cache: at least GAP_MS after the last one, with
 * the site's User-Agent, retried on a network error, a 429 or a 5xx. Resolves with the body.
 */
export async function fresh(url, opts = {}) {
	let lastError = null;
	for (let attempt = 1; attempt <= 4; attempt++) {
		const wait = lastRequest + GAP_MS - Date.now();
		if (wait > 0) await sleep(wait);
		lastRequest = Date.now();
		requests++;
		try {
			const res = await fetch(url, { headers: Object.assign({ 'User-Agent': UA }, opts.headers || {}), redirect: 'follow' });
			if (res.status === 429 || res.status >= 500) {
				const retryAfter = Number(res.headers.get('retry-after')) || 0;
				await res.arrayBuffer().catch(() => null);
				lastError = new Error('HTTP ' + res.status + ' for ' + url);
				await sleep(Math.max(retryAfter * 1000, 4000 * attempt));
				continue;
			}
			const buf = Buffer.from(await res.arrayBuffer());
			if (res.status !== 200) throw Object.assign(new Error('HTTP ' + res.status + ' for ' + url), { fatal: true });
			return buf;
		} catch (err) {
			if (err.fatal) throw err;
			lastError = err;
			await sleep(4000 * attempt);
		}
	}
	throw new Error('could not fetch ' + url + ': ' + (lastError && lastError.message));
}

/** mulberry32 over an FNV-1a seed: the same small generator the toy kit uses. */
export function rng(seed) {
	let h = 2166136261;
	const s = String(seed);
	for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
	let a = h >>> 0;
	return function () {
		a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Load a data file the way a test or a browser would, and return its global. */
export function loadData(file, globalName) {
	const sandbox = { window: {} };
	vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
	return sandbox.window[globalName];
}

/**
 * Write misc/_texts/<file>: a comment, then one expression that sets <globalName> on window
 * (on self in a Web Worker, where there is no window) and module.exports under Node. `body`
 * is the JavaScript source of the object literal; `expected` is the object it must evaluate
 * to, which is checked before returning.
 */
export function writeData(file, globalName, about, body, expected) {
	const head = '/*\n' + about.map((line) => (' * ' + line).trimEnd()).join('\n') + '\n */\n';
	if (head.slice(2).indexOf('*/') !== head.length - 5) throw new Error('comment terminator inside the header of ' + file);
	const src = head +
		'(function (data) {\n' +
		"\tvar root = typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : null;\n" +
		'\tif (root) root.' + globalName + ' = data;\n' +
		"\tif (typeof module === 'object' && module.exports) module.exports = data;\n" +
		'})(' + body + ');\n';
	const target = path.join(OUT, file);
	fs.mkdirSync(OUT, { recursive: true });
	fs.writeFileSync(target, src);
	const back = loadData(target, globalName);
	if (JSON.stringify(back) !== JSON.stringify(expected)) throw new Error(file + ' does not evaluate to the data it was built from');
	const bytes = Buffer.byteLength(src);
	console.log('wrote misc/_texts/' + file + '  ' + bytes + ' bytes  sha256 ' + sha256(src).slice(0, 16));
	return bytes;
}

/** Strip a UTF-8 byte-order mark. */
export function noBom(text) {
	return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}
