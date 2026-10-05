// The repo's single test entry point: runs every check there is, one after
// the other, and prints a table.
//
// Zero dependencies. Run with:
//   node scripts/test-all.mjs            every check that needs no browser
//   node scripts/test-all.mjs --smoke    also the browser smoke test of every toy
//                                        (node scripts/qa/smoke.mjs --all)
//   node scripts/test-all.mjs --site     also the smoke test of the site shell
//                                        (with --smoke they share one browser run)
// Exit code 1 if anything failed, else 0.
//
// What runs, in this order, each as its own node process:
//   node scripts/build-cards.mjs --check     the cards in index.html match the manifests
//   node scripts/test-cards.mjs --allow-new
//   node scripts/check-tables.mjs
//   node scripts/build-publications-json.mjs --check   assets/data/publications.json matches index.html
//   node scripts/build-places-json.mjs --check         assets/data/places.json matches toy 34
//   node misc/_kit/test.js
//   node misc/55-paper-theatre/test.js
//   every other misc/*/test*.js (underscore folders included), scripts/**/test*.mjs and desk/test/test-*.mjs,
//   then desk/vendor/fetch-vendor.mjs --check (the vendored libraries match their recorded hashes)
// and then, in this process: every misc/*/toy.json must parse as JSON and its
// "slug" must equal the name of its folder.
// A file that does not exist yet is reported as "skipped: not present"; that
// is not a failure.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(scriptDir, '..');
const self = 'scripts/test-all.mjs';

// The byte-order mark some Windows tools put at the start of a file, built
// from its code so that no invisible character sits in this source.
const BOM_RE = new RegExp('^' + String.fromCharCode(0xfeff));

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
	console.log('Usage: node scripts/test-all.mjs [--smoke] [--site]');
	process.exit(0);
}
const unknownArgs = args.filter((a) => a !== '--smoke' && a !== '--site');
if (unknownArgs.length) {
	console.error(`Unknown option: ${unknownArgs.join(' ')}\nUsage: node scripts/test-all.mjs [--smoke] [--site]`);
	process.exit(2);
}

const rows = [];

function lastLine(text) {
	const lines = String(text || '')
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	return lines.length ? lines[lines.length - 1] : '';
}

function clip(text, max) {
	return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

// Runs `node <file> <args>` from the repo root and records the outcome.
function run(file, extraArgs = [], { timeoutMs = 5 * 60 * 1000 } = {}) {
	const label = [file, ...extraArgs].join(' ');
	if (!fs.existsSync(path.join(root, file))) {
		rows.push({ result: 'skipped', label, ms: 0, detail: 'skipped: not present' });
		console.log(`skipped  ${label}  (skipped: not present)`);
		return;
	}
	const started = Date.now();
	const r = spawnSync(process.execPath, [file, ...extraArgs], {
		cwd: root,
		encoding: 'utf8',
		timeout: timeoutMs,
		maxBuffer: 64 * 1024 * 1024,
		windowsHide: true,
	});
	const ms = Date.now() - started;
	const out = (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '');
	let ok = r.status === 0;
	let detail = lastLine(r.stdout) || lastLine(r.stderr);
	if (r.error) {
		ok = false;
		detail = r.error.code === 'ETIMEDOUT' ? `timed out after ${Math.round(timeoutMs / 1000)} s` : r.error.message;
	} else if (!ok) {
		detail = `exit ${r.status === null ? r.signal : r.status}${detail ? ': ' + detail : ''}`;
	}
	rows.push({ result: ok ? 'pass' : 'FAIL', label, ms, detail });
	console.log(`${ok ? 'pass   ' : 'FAIL   '}  ${label}  (${(ms / 1000).toFixed(1)} s)`);
	if (!ok) {
		const tail = out.split(/\r?\n/).filter((l) => l.trim()).slice(-40);
		for (const line of tail) console.log('    | ' + line);
	}
}

function glob(pattern) {
	return fs
		.globSync(pattern, { cwd: root })
		.map((p) => p.replace(/\\/g, '/'))
		.filter((p) => !p.startsWith('scripts/qa/out/') && !p.includes('/node_modules/'))
		.sort();
}

// ---- the fixed list, then everything else that looks like a test -----------

// test-cards runs with --allow-new: cards for toys added since the last commit
// are fine, every card of the last commit must still be there unchanged.
const fixed = [
	['scripts/build-cards.mjs', ['--check']],
	['scripts/test-cards.mjs', ['--allow-new']],
	['scripts/check-tables.mjs', []],
	['scripts/build-publications-json.mjs', ['--check']],
	['scripts/build-places-json.mjs', ['--check']],
	['misc/_kit/test.js', []],
	['misc/55-paper-theatre/test.js', []],
];
for (const [file, extra] of fixed) run(file, extra);

const done = new Set([...fixed.map(([file]) => file), self]);
const others = [...glob('misc/*/test*.js'), ...glob('scripts/**/test*.mjs'), ...glob('desk/test/test-*.mjs')];
if (fs.existsSync(path.join(root, 'desk/vendor/fetch-vendor.mjs'))) run('desk/vendor/fetch-vendor.mjs', ['--check']);
for (const file of others) {
	if (done.has(file)) continue;
	done.add(file);
	run(file);
}

// ---- toy.json manifests -----------------------------------------------------

{
	const started = Date.now();
	const problems = [];
	const files = glob('misc/*/toy.json');
	for (const file of files) {
		const folder = file.split('/')[1];
		let data;
		try {
			data = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(BOM_RE, ''));
		} catch (e) {
			problems.push(`${file}: does not parse as JSON (${e.message})`);
			continue;
		}
		if (!data || typeof data !== 'object' || Array.isArray(data)) problems.push(`${file}: must be a JSON object`);
		else if (data.slug !== folder) problems.push(`${file}: "slug" is ${JSON.stringify(data.slug)} but the folder is "${folder}"`);
	}
	const ok = problems.length === 0;
	const label = 'misc/*/toy.json manifests';
	const detail = ok ? `${files.length} parse, slug matches the folder` : `${problems.length} of ${files.length} wrong`;
	rows.push({ result: ok ? 'pass' : 'FAIL', label, ms: Date.now() - started, detail });
	console.log(`${ok ? 'pass   ' : 'FAIL   '}  ${label}  (${detail})`);
	for (const p of problems) console.log('    | ' + p);
}

// ---- the browser runs, on request ---------------------------------------------

const wantSmoke = args.includes('--smoke');
const wantSite = args.includes('--site');
if (wantSmoke || wantSite) {
	const extra = [];
	if (wantSmoke) extra.push('--all', '--path', 'desk');
	if (wantSite) extra.push('--site');
	run('scripts/qa/smoke.mjs', extra, { timeoutMs: 30 * 60 * 1000 });
}

// ---- the table --------------------------------------------------------------

const width = Math.min(60, Math.max(...rows.map((r) => r.label.length), 5));
console.log('');
console.log(`${'Result'.padEnd(8)} ${'Time'.padStart(7)}  ${'Check'.padEnd(width)}  Detail`);
console.log(`${'-'.repeat(8)} ${'-'.repeat(7)}  ${'-'.repeat(width)}  ${'-'.repeat(40)}`);
for (const r of rows) {
	const time = r.result === 'skipped' ? '' : (r.ms / 1000).toFixed(1) + ' s';
	console.log(`${r.result.padEnd(8)} ${time.padStart(7)}  ${clip(r.label, width).padEnd(width)}  ${clip(r.detail, 90)}`);
}
const failed = rows.filter((r) => r.result === 'FAIL').length;
const skipped = rows.filter((r) => r.result === 'skipped').length;
console.log('');
console.log(`${rows.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`);
process.exitCode = failed ? 1 : 0;
