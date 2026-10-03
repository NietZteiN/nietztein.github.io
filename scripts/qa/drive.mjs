// Runs a scripted check against the site in a headless browser: starts the
// server and a browser, calls the default export of the script you give it,
// then closes everything. Verifier agents use it to click through a toy.
//
// Zero dependencies (Chrome or Edge must be installed). Run with:
//   node scripts/qa/drive.mjs [options] <script.mjs> [args for the script...]
// Options (they go BEFORE the script; everything after it belongs to the script):
//   --mount <url path>=<dir>   serve a folder from outside the repo (repeatable)
//   --root <dir>               serve another folder instead of the repo
//   --timeout <seconds>        give up after this long (default 300, 0 = never)
//
// The script is an ES module, kept outside the repo (a scratch folder):
//   export default async function ({ browser, baseUrl, newPage, args, assert, outDir, root }) {
//   	const page = await newPage({ width: 1280, height: 800, theme: 'dark' });
//   	await page.goto(baseUrl + 'misc/44-text-tartan/');
//   	await page.click('#kilt');
//   	assert.equal(await page.eval(() => document.title), 'Text Tartan');
//   	assert.deepEqual(page.errors, []);
//   }
//   browser   the launched browser (see README.md for the page API)
//   baseUrl   "http://127.0.0.1:<port>/", the site root
//   newPage   shorthand for browser.newPage(options)
//   args      the arguments after the script path
//   assert    node:assert/strict
//   outDir    scripts/qa/out (gitignored), a place for screenshots
//   root      the folder being served
//
// To fail, throw (a failed assert throws). The error is printed with whatever
// the open pages logged, and the exit code is 1. Returning normally prints
// "PASS" and exits 0. Exit code 2 means a bad command line.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './cdp.mjs';
import { outDir } from './smoke.mjs';
import { startServer, parseMounts, repoRoot } from '../serve.mjs';

const USAGE = 'Usage: node scripts/qa/drive.mjs [--mount <url path>=<dir>] [--root <dir>] [--timeout <seconds>] <script.mjs> [args...]';

function describeError(e) {
	if (e && e.stack) return e.stack;
	return String(e);
}

// What every open page saw go wrong: the usual explanation for a failed check.
function pageNotes(browser) {
	const lines = [];
	if (!browser) return lines;
	for (const page of browser.pages) {
		const bad = page.badRequests;
		if (!page.errors.length && !bad.length) continue;
		lines.push(`  page ${page.url}`);
		for (const e of page.errors.slice(0, 12)) lines.push(`    ${e.type}: ${e.text}${e.url ? ` (${e.url}${e.line ? ':' + e.line : ''})` : ''}`);
		if (page.errors.length > 12) lines.push(`    ... ${page.errors.length - 12} more`);
		for (const r of bad.slice(0, 12)) lines.push(`    request: ${r.reason} ${r.url}`);
	}
	return lines;
}

async function main() {
	const argv = process.argv.slice(2);
	const mountArgs = [];
	let root = repoRoot;
	let timeoutS = 300;
	let i = 0;
	for (; i < argv.length; i++) {
		const a = argv[i];
		const value = () => {
			i++;
			if (i >= argv.length) throw new Error(`${a} needs a value`);
			return argv[i];
		};
		try {
			if (a === '--help' || a === '-h') {
				console.log(USAGE);
				return 0;
			} else if (a === '--mount') mountArgs.push(value());
			else if (a.startsWith('--mount=')) mountArgs.push(a.slice('--mount='.length));
			else if (a === '--root') root = path.resolve(value());
			else if (a.startsWith('--root=')) root = path.resolve(a.slice('--root='.length));
			else if (a === '--timeout') timeoutS = Number(value());
			else if (a.startsWith('--timeout=')) timeoutS = Number(a.slice('--timeout='.length));
			else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
			else break;
		} catch (e) {
			console.error(e.message);
			console.error(USAGE);
			return 2;
		}
	}
	const script = argv[i];
	const args = argv.slice(i + 1);
	if (!script) {
		console.error(USAGE);
		return 2;
	}
	const scriptPath = path.resolve(script);
	if (!fs.existsSync(scriptPath)) {
		console.error(`No such script: ${scriptPath}`);
		return 2;
	}
	if (!Number.isFinite(timeoutS) || timeoutS < 0) {
		console.error('--timeout must be a number of seconds (0 = never)');
		return 2;
	}
	let mounts;
	try {
		mounts = parseMounts(mountArgs);
	} catch (e) {
		console.error(e.message);
		return 2;
	}

	const started = Date.now();
	const name = path.basename(scriptPath);
	let mod;
	try {
		mod = await import(pathToFileURL(scriptPath).href);
	} catch (e) {
		console.error(`FAIL ${name}: the script could not be loaded\n${describeError(e)}`);
		return 1;
	}
	if (typeof mod.default !== 'function') {
		console.error(`FAIL ${name}: the script must have a default export: export default async function ({ browser, baseUrl, newPage, args }) { ... }`);
		return 1;
	}

	let server = null;
	let browser = null;
	let timer = null;
	const fail = (label, e) => {
		console.error(`FAIL ${name} after ${Date.now() - started} ms${label ? ' (' + label + ')' : ''}`);
		console.error(describeError(e));
		const notes = pageNotes(browser);
		if (notes.length) console.error('What the open pages reported:\n' + notes.join('\n'));
	};
	// A promise the script forgot to await must not pass silently.
	process.on('unhandledRejection', (e) => {
		fail('unhandled promise rejection', e);
		process.exit(1);
	});
	process.on('uncaughtException', (e) => {
		fail('uncaught exception', e);
		process.exit(1);
	});

	try {
		server = await startServer({ port: 0, root, mounts });
		browser = await launch();
		const context = {
			browser,
			baseUrl: server.url,
			newPage: (options) => browser.newPage(options),
			args,
			assert,
			outDir,
			root,
			server,
		};
		const run = Promise.resolve().then(() => mod.default(context));
		if (timeoutS > 0) {
			const limit = new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(`timed out after ${timeoutS} s (raise it with --timeout)`)), timeoutS * 1000);
			});
			await Promise.race([run, limit]);
		} else await run;
		console.log(`PASS ${name} ${Date.now() - started} ms`);
		return 0;
	} catch (e) {
		fail('', e);
		return 1;
	} finally {
		clearTimeout(timer);
		if (browser) await browser.close();
		if (server) await server.close();
	}
}

main().then(
	(code) => {
		process.exitCode = code;
		process.stdout.write('', () => process.exit(code));
	},
	(e) => {
		console.error(describeError(e));
		process.exit(1);
	}
);
