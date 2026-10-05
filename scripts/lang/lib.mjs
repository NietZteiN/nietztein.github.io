// Shared helpers of the Japanese data kit's build scripts (scripts/lang/build-*.mjs).
// Node 24 built-ins only. Nothing here writes Japanese: every string that ends
// up in misc/_lang/ is copied out of a downloaded source.
//
// Downloads are cached in scripts/lang/.cache/ (gitignored, never committed).
// A build that finds its files in the cache makes no request at all and writes
// byte-identical output. Requests go out one at a time, at least a second
// apart, and name the site (and no person) in the User-Agent.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.join(scriptDir, '..', '..');
export const cacheDir = path.join(scriptDir, '.cache');
export const outDir = path.join(repoRoot, 'misc', '_lang');

export const USER_AGENT = 'nietztein-lang-kit/1.0 (https://nietztein.github.io; static site data build)';
const MIN_GAP_MS = 1000;
let lastRequestAt = 0;

export function sha256(buf) {
	return crypto.createHash('sha256').update(buf).digest('hex');
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Downloads `url` once and keeps it as scripts/lang/.cache/<name>, with a
// sidecar <name>.meta.json that remembers when it was fetched. Returns
// { buf, sha256, fetched, url, fromCache }. `fetched` is the day of the real
// download (UTC), so a rebuild from the cache repeats it.
export async function fetchCached(url, name, { expectSha256 = null } = {}) {
	if (!/^[A-Za-z0-9._+-]+$/.test(name)) throw new Error('bad cache name: ' + name);
	fs.mkdirSync(cacheDir, { recursive: true });
	const file = path.join(cacheDir, name);
	const metaFile = file + '.meta.json';
	if (fs.existsSync(file) && fs.existsSync(metaFile)) {
		const buf = fs.readFileSync(file);
		const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
		const hash = sha256(buf);
		if (meta.url !== url) throw new Error(`cache entry ${name} was fetched from ${meta.url}, not ${url}`);
		if (meta.sha256 !== hash) throw new Error(`cache entry ${name} does not match its recorded hash; delete it and rebuild`);
		if (expectSha256 && expectSha256 !== hash) throw new Error(`${name}: sha256 ${hash} is not the pinned ${expectSha256}`);
		return { buf, sha256: hash, fetched: meta.fetched, url, fromCache: true };
	}
	if (process.env.LANG_OFFLINE) throw new Error(`LANG_OFFLINE is set and ${name} is not in the cache`);
	const wait = lastRequestAt + MIN_GAP_MS - Date.now();
	if (wait > 0) await sleep(wait);
	let res;
	let buf;
	for (let attempt = 1; ; attempt++) {
		lastRequestAt = Date.now();
		try {
			res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' }, redirect: 'follow' });
			if (res.ok) {
				buf = Buffer.from(await res.arrayBuffer());
				break;
			}
			await res.arrayBuffer().catch(() => {});
			if (attempt >= 3 || (res.status < 500 && res.status !== 429)) throw new Error(`HTTP ${res.status} for ${url}`);
		} catch (err) {
			if (attempt >= 3 || /^HTTP 4/.test(err.message)) throw err;
		}
		await sleep(5000 * attempt);
	}
	const hash = sha256(buf);
	if (expectSha256 && expectSha256 !== hash) throw new Error(`${name}: sha256 ${hash} is not the pinned ${expectSha256}`);
	const meta = { url, fetched: new Date().toISOString().slice(0, 10), fetchedAt: new Date().toISOString(), sha256: hash, bytes: buf.length };
	fs.writeFileSync(file, buf);
	fs.writeFileSync(metaFile, JSON.stringify(meta, null, '\t') + '\n');
	console.error(`fetched ${url} (${buf.length} bytes)`);
	return { buf, sha256: hash, fetched: meta.fetched, url, fromCache: false };
}

// ---- archives ---------------------------------------------------------------

// A .tgz as a Map of file name to Buffer (regular files only).
export function untarGz(buf) {
	const tar = zlib.gunzipSync(buf);
	const files = new Map();
	let off = 0;
	while (off + 512 <= tar.length) {
		const header = tar.subarray(off, off + 512);
		if (header.every((b) => b === 0)) break;
		const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
		const size = parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(), 8);
		const type = String.fromCharCode(header[156] || 48);
		if (!Number.isFinite(size)) throw new Error('tar: bad size field for ' + name);
		off += 512;
		if (type === '0') files.set(name, tar.subarray(off, off + size));
		off += Math.ceil(size / 512) * 512;
	}
	return files;
}

// A .zip as a Map of file name (raw bytes read as latin1) to Buffer.
// Handles the two methods that occur in practice: stored and deflate.
export function unzip(buf) {
	let eocd = -1;
	for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
		if (buf.readUInt32LE(i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error('zip: no end-of-central-directory record');
	const count = buf.readUInt16LE(eocd + 10);
	let off = buf.readUInt32LE(eocd + 16);
	const files = new Map();
	for (let i = 0; i < count; i++) {
		if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('zip: bad central directory entry');
		const method = buf.readUInt16LE(off + 10);
		const compressedSize = buf.readUInt32LE(off + 20);
		const size = buf.readUInt32LE(off + 24);
		const nameLen = buf.readUInt16LE(off + 28);
		const extraLen = buf.readUInt16LE(off + 30);
		const commentLen = buf.readUInt16LE(off + 32);
		const localOff = buf.readUInt32LE(off + 42);
		const name = buf.subarray(off + 46, off + 46 + nameLen).toString('latin1');
		off += 46 + nameLen + extraLen + commentLen;
		if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('zip: bad local header for ' + name);
		const dataStart = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
		const raw = buf.subarray(dataStart, dataStart + compressedSize);
		let data;
		if (method === 0) data = raw;
		else if (method === 8) data = zlib.inflateRawSync(raw);
		else throw new Error(`zip: method ${method} not supported (${name})`);
		if (data.length !== size) throw new Error(`zip: ${name} inflated to ${data.length} bytes, expected ${size}`);
		if (!name.endsWith('/')) files.set(name, data);
	}
	return files;
}

// ---- character classes --------------------------------------------------------

export function isKanjiCp(cp) {
	return (
		(cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
		(cp >= 0x3400 && cp <= 0x4dbf) || // Extension A
		(cp >= 0x20000 && cp <= 0x323af) || // Extensions B to H
		(cp >= 0xf900 && cp <= 0xfaff) // Compatibility Ideographs
	);
}
export function isKanji(ch) {
	return isKanjiCp(ch.codePointAt(0));
}
export function isHiraganaCp(cp) {
	return (cp >= 0x3041 && cp <= 0x3096) || cp === 0x309d || cp === 0x309e;
}
export function isKatakanaCp(cp) {
	return (cp >= 0x30a1 && cp <= 0x30fa) || cp === 0x30fc || cp === 0x30fd || cp === 0x30fe;
}
export function allChars(str, test) {
	for (const ch of str) if (!test(ch.codePointAt(0), ch)) return false;
	return str.length > 0;
}

// ---- output -------------------------------------------------------------------

// JSON that is also safe inside a <script>: the two line separators that old
// engines reject in string literals are escaped, and so is "</".
const BACKSLASH = String.fromCharCode(92);
export function json(value) {
	return JSON.stringify(value)
		.split(String.fromCharCode(0x2028))
		.join(BACKSLASH + 'u2028')
		.split(String.fromCharCode(0x2029))
		.join(BACKSLASH + 'u2029')
		.split('</')
		.join('<' + BACKSLASH + '/');
}

// Writes misc/_lang/<relPath>: a plain script that sets window.<globalName>
// (and, under Node's require, module.exports). `body` is the object literal
// as text, so each build script decides where the line breaks go.
export function writeDataFile(relPath, globalName, body, headerLines) {
	const file = path.join(outDir, relPath);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const header = ['/* ' + headerLines[0], ...headerLines.slice(1).map((l) => '   ' + l)].join('\n') + ' */\n';
	if (header.slice(2, -3).includes('*/')) throw new Error('header comment contains a comment end');
	const text =
		header +
		'(function (data) {\n' +
		"\tvar root = typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : null;\n" +
		`\tif (root) root.${globalName} = data;\n` +
		"\tif (typeof module === 'object' && module && module.exports) module.exports = data;\n" +
		'})(' +
		body +
		');\n';
	const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
	fs.writeFileSync(file, text);
	const bytes = Buffer.byteLength(text);
	console.log(`${before === text ? 'unchanged' : 'wrote    '} misc/_lang/${relPath.replace(/\\/g, '/')}  ${bytes} bytes  sha256 ${sha256(Buffer.from(text)).slice(0, 16)}`);
	return { file, bytes };
}

// Loads a data file written by writeDataFile the way a browser would: as a
// script, in a sandbox that has only `window`. Returns the global it set.
export function loadDataFile(relPath, globalName) {
	const file = path.join(outDir, relPath);
	const sandbox = { window: {} };
	vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
	const data = sandbox.window[globalName];
	if (!data) throw new Error(`${relPath} did not set window.${globalName}; run its build script first`);
	return data;
}

// Mulberry32 seeded from a string: the spot checks pick "random" items that are
// the same on every run.
export function seededRng(seed) {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	let a = h >>> 0;
	return function () {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
