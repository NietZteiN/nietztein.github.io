// Takes the 800x500 card thumbnails of the toys, and arbitrary screenshots of
// any page of the site for visual review.
//
// Zero dependencies (Chrome or Edge must be installed). It starts its own
// server on a free port and its own browser.
//
// Thumbnails:
//   node scripts/qa/shot.mjs 44-text-tartan 45-reading-room   retake these (overwrites)
//   node scripts/qa/shot.mjs --missing                         only toys that have none yet
//   node scripts/qa/shot.mjs --all                             retake every one (overwrites)
//   ... --out <file.jpg | dir>                                 write there instead of assets/img/misc/
// Each toy is loaded at its thumbnail URL (toy.json thumb.query, default
// "?thumb=1") in its thumbnail viewport (thumb.viewport, default [800,500]; a
// toy may ask for [1600,1000], which is captured at half scale), waited for
// (window.__toyReady if the toy defines it, then thumb.settleMs, default 800)
// and saved as a JPEG at quality 82. The file must come out exactly 800x500
// and between 6 KB and 150 KB; the quality is lowered step by step to get
// under 150 KB. A thumbnail that fails the check is not written.
// An existing thumbnail is only replaced when its toy is named or --all is
// given. --all and --missing skip "wip" toys, and --all also leaves the old
// hand-made thumbnails alone (toy.json thumb.legacy); name those to retake them.
//
// Any page:
//   node scripts/qa/shot.mjs --url "index.html#/misc" --out misc-dark.png --theme dark
//   node scripts/qa/shot.mjs --url "misc/44-text-tartan/?x=1" --out tartan.jpg --width 1600 --height 1000
// Options: --width 1280 --height 800 --theme dark|light --full-page --wait <ms>
//          --mobile (390x844 at 2x unless a size is given) --reduced-motion --dpr N --quality N
// The URL is relative to the site root; the format follows the file extension
// (.png, or .jpg/.jpeg).
//
// Both forms take --mount <url path>=<dir> and --root <dir> like serve.mjs,
// and --theme. Exit code: 0 fine, 1 a capture failed, 2 bad command line.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { launch } from './cdp.mjs';
import { jpegSize } from './jpeg.mjs';
import { listToys, pickToys } from './smoke.mjs';
import { startServer, parseMounts, repoRoot, isMainModule } from '../serve.mjs';

const THUMB_W = 800;
const THUMB_H = 500;
const MIN_BYTES = 6 * 1024;
const MAX_BYTES = 150 * 1024;
const QUALITIES = [82, 74, 66, 58, 50, 42, 34];

const USAGE = [
	'Usage: node scripts/qa/shot.mjs <slug...> | --missing | --all  [--out <file.jpg | dir>] [--theme dark|light]',
	'       node scripts/qa/shot.mjs --url "<site-relative url>" --out <file.png|.jpg> [--width 1280 --height 800 --theme dark|light --full-page --wait <ms> --mobile --reduced-motion --dpr N --quality N]',
].join('\n');

function kb(bytes) {
	return (bytes / 1024).toFixed(1) + ' KB';
}

function shown(file) {
	const rel = path.relative(repoRoot, file);
	return rel.startsWith('..') || path.isAbsolute(rel) ? file : rel.replace(/\\/g, '/');
}

function pngSize(buf) {
	if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
	return null;
}

// Uncaught exceptions do not stop a capture, but whoever looks at the picture
// should know about them.
function noteErrors(page, label) {
	const bad = page.errors.filter((e) => e.type === 'exception');
	if (bad.length) process.stderr.write(`note: ${label}: ${bad.length} uncaught exception${bad.length === 1 ? '' : 's'} on the page: ${bad[0].text}\n`);
}

// ---- one thumbnail ----------------------------------------------------------

async function shootThumb(browser, base, toy, dest, theme) {
	const [vw, vh] = toy.thumb.viewport;
	if (!toy.hasIndex) return { ok: false, why: `${toy.path}/index.html does not exist` };
	const page = await browser.newPage({ width: vw, height: vh, deviceScaleFactor: 1, theme: theme || null, extraAllowedHosts: toy.origins });
	try {
		await page.goto(base + toy.path + '/' + toy.thumb.query, { settleMs: toy.thumb.settleMs });
		noteErrors(page, toy.slug);
		const clip = { x: 0, y: 0, width: vw, height: vh, scale: THUMB_W / vw };
		let last = null;
		for (const quality of QUALITIES) {
			const buf = await page.screenshot(null, { format: 'jpeg', quality, clip });
			const size = jpegSize(buf);
			last = { buf, quality, ...size };
			if (size.width !== THUMB_W || size.height !== THUMB_H) {
				return { ok: false, why: `the capture is ${size.width}x${size.height}, not ${THUMB_W}x${THUMB_H}: thumb.viewport ${vw}x${vh} is not 16:10` };
			}
			if (buf.length < MIN_BYTES) return { ok: false, why: `only ${kb(buf.length)} at quality ${quality} (under 6 KB): the page is blank or nearly so` };
			if (buf.length <= MAX_BYTES) break;
		}
		if (last.buf.length > MAX_BYTES) return { ok: false, why: `still ${kb(last.buf.length)} at quality ${last.quality} (over 150 KB)` };
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, last.buf);
		return { ok: true, bytes: last.buf.length, quality: last.quality };
	} catch (e) {
		return { ok: false, why: e.message };
	} finally {
		await page.close().catch(() => {});
	}
}

async function pool(items, limit, fn) {
	let next = 0;
	const results = new Array(items.length);
	await Promise.all(
		Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
			for (;;) {
				const i = next++;
				if (i >= items.length) return;
				results[i] = await fn(items[i]);
			}
		})
	);
	return results;
}

// ---- main ---------------------------------------------------------------------

async function main() {
	let values;
	let positionals;
	try {
		({ values, positionals } = parseArgs({
			allowPositionals: true,
			options: {
				all: { type: 'boolean', default: false },
				missing: { type: 'boolean', default: false },
				out: { type: 'string' },
				url: { type: 'string' },
				width: { type: 'string' },
				height: { type: 'string' },
				theme: { type: 'string' },
				'full-page': { type: 'boolean', default: false },
				wait: { type: 'string' },
				mobile: { type: 'boolean', default: false },
				'reduced-motion': { type: 'boolean', default: false },
				dpr: { type: 'string' },
				quality: { type: 'string' },
				concurrency: { type: 'string', default: '4' },
				mount: { type: 'string', multiple: true },
				root: { type: 'string' },
				help: { type: 'boolean', short: 'h', default: false },
			},
		}));
	} catch (e) {
		console.error(e.message);
		console.error(USAGE);
		return 2;
	}
	if (values.help) {
		console.log(USAGE);
		return 0;
	}
	const usage = (msg) => {
		console.error(msg);
		console.error(USAGE);
		return 2;
	};
	if (values.theme && values.theme !== 'dark' && values.theme !== 'light') return usage(`--theme must be dark or light, got "${values.theme}"`);
	const num = (name, fallback) => {
		if (values[name] === undefined) return fallback;
		const n = Number(values[name]);
		return Number.isFinite(n) && n > 0 ? n : NaN;
	};
	const root = values.root ? path.resolve(values.root) : repoRoot;
	let mounts;
	try {
		mounts = parseMounts(values.mount);
	} catch (e) {
		return usage(e.message);
	}

	// ---- any page -------------------------------------------------------------
	if (values.url !== undefined) {
		if (!values.out) return usage('--url needs --out <file>');
		if (positionals.length || values.all || values.missing) return usage('--url cannot be combined with toy names, --all or --missing');
		const out = path.resolve(values.out);
		const ext = path.extname(out).toLowerCase();
		if (!['.png', '.jpg', '.jpeg'].includes(ext)) return usage(`--out must end in .png, .jpg or .jpeg, got "${values.out}"`);
		const width = num('width', values.mobile ? 390 : 1280);
		const height = num('height', values.mobile ? 844 : 800);
		const dpr = num('dpr', values.mobile ? 2 : 1);
		const quality = num('quality', 82);
		const wait = values.wait === undefined ? 800 : Number(values.wait);
		if ([width, height, dpr, quality].some(Number.isNaN) || !Number.isFinite(wait) || wait < 0) return usage('--width, --height, --dpr, --quality and --wait must be positive numbers');

		const server = await startServer({ port: 0, root, mounts });
		let browser = null;
		try {
			const target = /^https?:\/\//i.test(values.url) ? values.url : new URL(values.url.replace(/^\/+/, ''), server.url).href;
			browser = await launch();
			const page = await browser.newPage({
				width: Math.round(width),
				height: Math.round(height),
				deviceScaleFactor: dpr,
				mobile: values.mobile,
				theme: values.theme || null,
				reducedMotion: values['reduced-motion'],
			});
			await page.goto(target, { settleMs: wait });
			noteErrors(page, values.url);
			const buf = await page.screenshot(out, { format: ext === '.png' ? 'png' : 'jpeg', quality: Math.round(quality), fullPage: values['full-page'] });
			const size = ext === '.png' ? pngSize(buf) : jpegSize(buf);
			console.log(`wrote ${shown(out)}  ${size ? size.width + 'x' + size.height : '?'}  ${kb(buf.length)}`);
			return 0;
		} catch (e) {
			console.error(`FAIL ${values.url}: ${e.message}`);
			return 1;
		} finally {
			if (browser) await browser.close();
			await server.close();
		}
	}

	// ---- thumbnails -------------------------------------------------------------
	if (!positionals.length && !values.all && !values.missing) return usage('Name a toy, or pass --missing, --all or --url.');
	const all = listToys(root);
	const { picked, unknown } = pickToys(all, positionals);
	if (unknown.length) return usage(`Unknown toy: ${unknown.join(', ')}`);

	const thumbDir = path.join(root, 'assets', 'img', 'misc');
	const have = new Set(fs.existsSync(thumbDir) ? fs.readdirSync(thumbDir) : []); // exact spelling: Pages is case-sensitive
	const targets = [...picked];
	const notes = [];
	if (values.all) {
		for (const toy of all) {
			if (targets.includes(toy)) continue;
			if (toy.wip) notes.push(`skip ${toy.slug} (wip)`);
			else if (toy.thumb.legacy && have.has(`${toy.slug}.jpg`)) notes.push(`skip ${toy.slug} (legacy thumbnail; name the toy to retake it)`);
			else targets.push(toy);
		}
	}
	if (values.missing) {
		for (const toy of all) {
			if (targets.includes(toy) || toy.wip || have.has(`${toy.slug}.jpg`)) continue;
			targets.push(toy);
		}
	}
	if (!targets.length) {
		for (const n of notes) console.log(n);
		console.log(values.missing ? 'No toy is missing a thumbnail.' : 'Nothing to do.');
		return 0;
	}

	let outFile = '';
	let outDirPath = thumbDir;
	if (values.out) {
		if (/\.jpe?g$/i.test(values.out)) {
			if (targets.length !== 1) return usage(`--out ${values.out} is one file but ${targets.length} toys were selected; give a folder instead`);
			outFile = path.resolve(values.out);
		} else outDirPath = path.resolve(values.out);
	}

	const server = await startServer({ port: 0, root, mounts });
	let browser = null;
	let failed = 0;
	try {
		browser = await launch();
		const concurrency = Math.max(1, Math.min(8, parseInt(values.concurrency, 10) || 4));
		await pool(targets, concurrency, async (toy) => {
			const dest = outFile || path.join(outDirPath, `${toy.slug}.jpg`);
			const r = await shootThumb(browser, server.url, toy, dest, values.theme);
			if (r.ok) console.log(`wrote ${shown(dest)}  ${THUMB_W}x${THUMB_H}  ${kb(r.bytes)}  q${r.quality}`);
			else {
				failed++;
				console.log(`FAIL ${toy.slug}: ${r.why}`);
			}
		});
	} catch (e) {
		console.error(`shot: ${e && e.stack ? e.stack : e}`);
		failed++;
	} finally {
		if (browser) await browser.close();
		await server.close();
	}
	for (const n of notes) console.log(n);
	if (targets.length > 1 || failed) console.log(`${targets.length - failed} of ${targets.length} thumbnails written${failed ? `, ${failed} FAILED` : ''}`);
	return failed ? 1 : 0;
}

if (isMainModule(import.meta.url)) {
	process.stdout.on('error', () => {}); // a closed pipe (| head) must not crash the run
	main().then(
		(code) => {
			process.exitCode = code;
			process.stdout.write('', () => process.exit(code));
		},
		(e) => {
			console.error(e && e.stack ? e.stack : e);
			process.exit(1);
		}
	);
}
