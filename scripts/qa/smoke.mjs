// The gate every toy under misc/ must pass: loads each toy in a headless
// browser a few times and fails it on script errors, broken local files and
// requests to hosts it has no business contacting.
//
// Zero dependencies (Chrome or Edge must be installed). Run with:
//   node scripts/qa/smoke.mjs 44-text-tartan 18-zipf-karaoke   named toys (a bare number works: 44)
//   node scripts/qa/smoke.mjs --all                             every toy that is not "wip"
//   node scripts/qa/smoke.mjs --path misc/_kit/template         any folder with an index.html
//   node scripts/qa/smoke.mjs --site                            the site shell (index.html)
// Flags:
//   --json               print one JSON document instead of the lines
//   --update-baseline    record the current noise of the old toys (see below)
//   --concurrency N      pages loaded in parallel inside the one browser (default 4)
//   --mount <url path>=<dir>   serve a folder from outside the repo (repeatable)
//   --root <dir>         serve and test another folder instead of the repo
//   --verbose            also print warnings and tolerated noise for passing toys
// Exit code: 0 all passed, 1 something failed, 2 bad command line.
//
// It starts its own server on a free port and its own browser, so any number
// of runs can go at once (browsers queue machine-wide, see cdp.mjs).
//
// Per toy, each in a fresh browser context:
//   default          the page at 1280x800
//   thumb            the thumbnail URL (?thumb=1) at the thumbnail viewport
//   reduced-motion   the page with prefers-reduced-motion: reduce
// A toy fails on an uncaught exception, a console.error, a local file that is
// missing or fails to load, a request to a host outside the allowlist (plus the
// toy's "origins"), or window.__toyReady staying false.
//
// Toys whose toy.json says "kit": true are also checked for: a.kit-back with
// the right href, <html data-theme> following localStorage.theme, the help
// dialog opening and closing, no horizontal overflow at 390x844, class
// is-thumb under the thumbnail URL, and surviving a blocked CDN.
//
// Old toys (no toy.json, or "kit": false) have known noise. --update-baseline
// writes it to scripts/qa/baseline.json; after that an old toy fails only on
// something that is NOT in its baseline. Kit toys never get a baseline.
//
// --all also writes scripts/qa/out/smoke-last.json (report.mjs reads it).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { launch, sleep } from './cdp.mjs';
import { startServer, parseMounts, repoRoot, isMainModule } from '../serve.mjs';

export const qaDir = path.dirname(fileURLToPath(import.meta.url));
export const outDir = path.join(qaDir, 'out');
export const baselineFile = path.join(qaDir, 'baseline.json');

// A toy folder is misc/<two or three digits>-<slug> (same rule as build-cards.mjs).
export const TOY_DIR_RE = /^\d{2,3}-[a-z0-9-]+$/;

// The byte-order mark some Windows tools put at the start of a file, built
// from its code so that no invisible character sits in this source.
const BOM_RE = new RegExp('^' + String.fromCharCode(0xfeff));

const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];
const BASELINE_KINDS = new Set(['exception', 'console.error', 'log.error', 'request', 'host']);
const SITE_ROUTES = ['about', 'misc', 'bookshelf'];
const SITE_THEMES = ['light', 'dark'];
const SITE_HOSTS = ['api.open-meteo.com', 'api.github.com', 'avatars.githubusercontent.com', 'github.com', 'giscus.app'];

const USAGE = 'Usage: node scripts/qa/smoke.mjs <slug...> | --all | --path <dir> | --site  [--json] [--update-baseline] [--concurrency N] [--mount <url path>=<dir>] [--root <dir>] [--verbose]';

// ---- toys and their manifests ---------------------------------------------

// The thumbnail recipe of a manifest, with the defaults filled in.
export function thumbSpec(manifest) {
	const t = (manifest && typeof manifest.thumb === 'object' && manifest.thumb) || {};
	let query = typeof t.query === 'string' ? t.query : '?thumb=1';
	if (query && !/^[?#]/.test(query)) query = '?' + query;
	const v = t.viewport;
	const viewport = Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n) && n >= 100 && n <= 4000) ? [Math.round(v[0]), Math.round(v[1])] : [800, 500];
	const settleMs = Number.isFinite(t.settleMs) && t.settleMs >= 0 ? Math.min(t.settleMs, 15000) : 800;
	return { query, viewport, settleMs, legacy: t.legacy === true };
}

// Describes the toy in the folder `dir`, served at the site-relative `urlPath`
// ("misc/44-text-tartan").
export function readToy(dir, urlPath) {
	const slug = path.basename(dir);
	const toy = {
		slug,
		path: urlPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''),
		dir,
		manifest: null,
		manifestError: '',
		hasIndex: fs.existsSync(path.join(dir, 'index.html')),
		kit: false,
		wip: false,
		origins: [],
		title: '',
		group: '',
	};
	const file = path.join(dir, 'toy.json');
	if (fs.existsSync(file)) {
		try {
			const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(BOM_RE, ''));
			if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
			toy.manifest = data;
			toy.kit = data.kit === true;
			toy.wip = data.status === 'wip';
			toy.origins = Array.isArray(data.origins) ? data.origins.filter((o) => typeof o === 'string' && o.trim()) : [];
			toy.title = typeof data.title === 'string' ? data.title : '';
			toy.group = typeof data.group === 'string' ? data.group : '';
		} catch (e) {
			toy.manifestError = e.message;
		}
	}
	toy.thumb = thumbSpec(toy.manifest);
	return toy;
}

// Every toy under <root>/misc, sorted by folder name.
export function listToys(root = repoRoot) {
	const miscDir = path.join(root, 'misc');
	if (!fs.existsSync(miscDir)) return [];
	return fs
		.readdirSync(miscDir, { withFileTypes: true })
		.filter((d) => d.isDirectory() && TOY_DIR_RE.test(d.name))
		.map((d) => readToy(path.join(miscDir, d.name), 'misc/' + d.name))
		.filter((t) => t.hasIndex || t.manifest || t.manifestError)
		.sort((a, b) => a.slug.localeCompare(b.slug, 'en'));
}

// Turns what was typed ("44", "44-text-tartan", "misc/44-text-tartan/") into toys.
export function pickToys(toys, names) {
	const picked = [];
	const unknown = [];
	for (const raw of names) {
		const name = raw.replace(/\\/g, '/').replace(/^misc\//, '').replace(/\/+$/, '');
		const hit = toys.find((t) => t.slug === name) || (/^\d+$/.test(name) ? toys.find((t) => Number(t.slug.split('-')[0]) === Number(name)) : null);
		if (hit) {
			if (!picked.includes(hit)) picked.push(hit);
		} else unknown.push(raw);
	}
	return { picked, unknown };
}

export function loadBaseline() {
	try {
		const data = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
		return data && typeof data.toys === 'object' && data.toys ? data : { toys: {} };
	} catch (e) {
		return { toys: {} };
	}
}

// Writes through a temporary file so a reader never sees half a file. Other
// runs may be writing the same file at the same moment, and Windows refuses to
// replace a file someone has open, hence the retries and the plain fallback.
function writeFileAtomic(file, data) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, data);
	const pause = new Int32Array(new SharedArrayBuffer(4));
	for (let i = 0; i < 6; i++) {
		try {
			fs.renameSync(tmp, file);
			return;
		} catch (e) {
			Atomics.wait(pause, 0, 0, 60);
		}
	}
	try {
		fs.writeFileSync(file, data);
	} finally {
		fs.rmSync(tmp, { force: true });
	}
}

// ---- small helpers ----------------------------------------------------------

// Runs fn over items with at most `limit` in flight; results keep item order.
async function pool(items, limit, fn) {
	const results = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
		for (;;) {
			const i = next++;
			if (i >= items.length) return;
			results[i] = await fn(items[i], i);
		}
	});
	await Promise.all(workers);
	return results;
}

// Error text without the things that change from run to run: the server's
// port and long digit runs (timestamps, cache busters).
function normalise(text, origin) {
	let s = String(text || '');
	if (origin) s = s.split(origin + '/').join('/').split(origin).join('<site>');
	s = s.replace(/\d{6,}/g, '<n>').replace(/\s+/g, ' ').trim();
	return s.length > 300 ? s.slice(0, 297) + '...' : s;
}

// ---- one load of one toy ----------------------------------------------------

// Loads `url` in a fresh page, runs the optional checks, and turns everything
// the page did wrong into findings: { pass, kind, text, where }.
//   only: 'exceptions' keeps uncaught exceptions only (the blocked-CDN pass)
async function runPass(ctx, spec) {
	const started = Date.now();
	const findings = [];
	const warnings = [];
	const info = { name: spec.name, ms: 0, ready: '' };
	const add = (kind, text, where = '') => findings.push({ pass: spec.name, kind, text: normalise(text, ctx.origin), where: normalise(where, ctx.origin) });
	let page = null;
	let hosts = [];
	let flaky = '';
	let stuck = false;
	try {
		page = await ctx.browser.newPage({ width: 1280, height: 800, ...spec.page, extraAllowedHosts: ctx.allowedHosts });
		let loaded = true;
		try {
			if (spec.kitFailOk) {
				// Ready means __toyReady === true, or the kit's failure panel is up.
				await page.goto(spec.url, { waitReady: false });
				await page.waitNetworkIdle({ idleMs: 500, timeoutMs: 10000 });
				const state = await page
					.waitFor(() => (window.__toyReady === true ? 'ready' : document.querySelector('.kit-fail') ? 'kit-fail' : typeof window.__toyReady === 'undefined' ? 'undefined' : ''), { timeoutMs: 20000 })
					.catch(() => '');
				info.ready = state || 'never';
				if (!state) add('ready', 'with the CDNs blocked the page neither set window.__toyReady = true nor showed .kit-fail (20 s)');
				else if (state === 'undefined') add('ready', 'with the CDNs blocked window.__toyReady is not defined and .kit-fail is not shown');
				await sleep(250);
				// Guard against the block silently not working in some future browser.
				const leaked = page.requests.find((r) => !r.blocked && CDN_HOSTS.some((h) => r.host === h || r.host.endsWith('.' + h)));
				if (leaked) add('harness', `the CDN block did not take effect (${leaked.url} was requested); this pass proves nothing`);
			} else {
				await page.goto(spec.url, { settleMs: 0 });
				info.ready = page.ready && page.ready.contract ? 'contract' : 'settle';
				await sleep(page.ready && page.ready.contract ? 250 : 800);
			}
		} catch (e) {
			loaded = false;
			// A page that hangs will hang in every pass; the caller stops after this one.
			if (e.code === 'TOY_NOT_READY') {
				info.ready = 'never';
				stuck = true;
				add('ready', 'window.__toyReady was defined but never became true (20 s)');
			} else if (e.code === 'LOAD_TIMEOUT') {
				stuck = true;
				add('load', 'the page never fired its load event (30 s); a script may be looping', spec.url);
			} else add('load', e.message);
		}
		if (loaded && spec.requireContract && page.ready && !page.ready.contract) {
			add('ready', 'a kit toy must set window.__toyReady (false while loading, true once drawn); it is undefined');
		}
		if (loaded && spec.checks) {
			try {
				await spec.checks(page, (text) => add('check', text));
			} catch (e) {
				add('check', `the check itself failed: ${e.message}`);
			}
		}

		// A worker's uncaught error arrives twice, as the worker's exception and
		// as a log entry on its page; one line is enough.
		const thrown = new Set(page.errors.filter((e) => e.type === 'exception').map((e) => e.text));
		for (const e of page.errors) {
			const where = e.url ? `${e.url}${e.line ? ':' + e.line : ''}` : '';
			if (e.type === 'exception') add('exception', e.text, where);
			else if (spec.only === 'exceptions') continue;
			else if (e.type === 'console.error') add('console.error', e.text, where);
			else if (e.type === 'log.error' && e.source !== 'network' && !thrown.has(e.text)) add('log.error', e.text, where);
		}
		const strayHosts = new Set();
		for (const r of page.badRequests) {
			if (r.host === ctx.host) {
				if (spec.only !== 'exceptions') add('request', `${r.reason} ${r.url}`);
			} else {
				if (!ctx.knownHosts.has(r.host)) strayHosts.add(r.host);
				if (spec.only !== 'exceptions') add('host', r.host, r.url);
			}
		}
		// An outside host the toy may use, but which did not answer properly: not
		// a failure by itself, yet a reason to try the toy again if it then fails.
		for (const r of page.requests) {
			if (r.host === ctx.host || r.blocked || r.canceled || strayHosts.has(r.host) || !/^(https?|wss?):/.test(r.url)) continue;
			if (r.failed || r.status >= 400) {
				warnings.push(`${spec.name}: ${r.failed ? 'failed' : 'HTTP ' + r.status} ${r.url}${r.errorText ? ' (' + r.errorText + ')' : ''}`);
				if (r.failed || r.status >= 500 || r.status === 429) flaky = r.url;
			}
		}
		for (const w of page.warnings) warnings.push(`${spec.name}: ${normalise(w, ctx.origin)}`);
		hosts = page.externalHosts;
	} catch (e) {
		add('harness', e.message);
	} finally {
		if (page) await page.close().catch(() => {});
	}
	info.ms = Date.now() - started;
	return { info, findings, warnings, hosts, flaky, stuck };
}

// ---- the kit checks --------------------------------------------------------

async function checkKitDefault(page, fail) {
	const back = await page.eval(() => {
		const a = document.querySelector('a.kit-back');
		if (!a) return null;
		const u = new URL(a.href, location.href);
		return { attr: a.getAttribute('href') || '', hash: u.hash, pathname: u.pathname, sameOrigin: u.origin === location.origin };
	});
	if (!back) fail('a.kit-back is missing');
	else if (!/^#\/(misc|bookshelf)$/.test(back.hash)) fail(`a.kit-back href must end in #/misc or #/bookshelf (found "${back.attr}")`);
	else if (!back.sameOrigin || !/^\/(index\.html)?$/.test(back.pathname)) fail(`a.kit-back must point at the site root (href "${back.attr}" resolves to ${back.pathname}${back.hash})`);

	if (await page.eval(() => !!document.querySelector('button.kit-help'))) {
		await page.click('button.kit-help');
		const shown = await page.waitFor('.kit-dialog', { visible: true, timeoutMs: 3000 }).catch(() => false);
		if (!shown) fail('clicking button.kit-help did not show .kit-dialog');
		else {
			await page.key('Escape');
			const hidden = await page.waitFor('.kit-dialog', { hidden: true, timeoutMs: 3000 }).catch(() => false);
			if (!hidden) fail('Escape did not hide .kit-dialog');
		}
	}
}

async function checkKitThumb(page, fail) {
	if (!(await page.eval(() => document.documentElement.classList.contains('is-thumb')))) fail('<html> lacks the class is-thumb under the thumbnail URL');
}

// Under mobile emulation window.innerWidth grows to the width of an overflowing
// page (the browser zooms out to fit it), so scrollWidth > innerWidth can never
// be true there. documentElement.clientWidth stays at the real 390.
async function checkKitMobile(page, fail) {
	const m = await page.eval(() => ({ scroll: document.documentElement.scrollWidth, view: Math.min(window.innerWidth, document.documentElement.clientWidth) }));
	if (m.scroll > m.view + 1) fail(`horizontal overflow at 390x844: the page is ${m.scroll}px wide in a ${m.view}px viewport`);
}

function checkKitTheme(theme) {
	return async (page, fail) => {
		const got = await page.eval(() => document.documentElement.getAttribute('data-theme'));
		if (got !== theme) fail(`with localStorage.theme = "${theme}", <html data-theme> is ${got === null ? 'missing' : `"${got}"`}`);
	};
}

// ---- one toy ------------------------------------------------------------------

function passesFor(toy, base) {
	const url = base + toy.path + '/';
	const [tw, th] = toy.thumb.viewport;
	const kit = toy.kit;
	const list = [
		{ name: 'default', url, page: {}, requireContract: kit, checks: kit ? checkKitDefault : null },
		{ name: 'thumb', url: url + toy.thumb.query, page: { width: tw, height: th }, requireContract: kit, checks: kit ? checkKitThumb : null },
		{ name: 'reduced-motion', url, page: { reducedMotion: true }, requireContract: kit },
	];
	if (kit) {
		list.push(
			{ name: 'mobile', url, page: { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 }, requireContract: true, checks: checkKitMobile },
			// The emulated OS preference is the opposite one, so only localStorage can explain a match.
			{ name: 'theme-dark', url, page: { storage: { theme: 'dark' }, colorScheme: 'light' }, requireContract: true, checks: checkKitTheme('dark') },
			{ name: 'theme-light', url, page: { storage: { theme: 'light' }, colorScheme: 'dark' }, requireContract: true, checks: checkKitTheme('light') },
			{ name: 'cdn-blocked', url, page: { blockHosts: CDN_HOSTS }, only: 'exceptions', kitFailOk: true }
		);
	}
	return list;
}

async function runToyOnce(env, toy) {
	const started = Date.now();
	const result = {
		slug: toy.slug,
		path: toy.path,
		kit: toy.kit,
		ok: true,
		ms: 0,
		passes: [],
		failures: [],
		tolerated: [],
		warnings: [],
		hosts: [],
	};
	const fail = (kind, text, where = '', passes = []) => result.failures.push({ kind, text, where, passes });

	if (toy.manifestError) fail('manifest', `toy.json does not parse: ${toy.manifestError}`);
	if (!toy.hasIndex) fail('load', `${toy.path}/index.html does not exist`);
	if (result.failures.length) {
		result.ok = false;
		result.ms = Date.now() - started;
		return { result, flaky: '' };
	}

	const known = toy.baselined ? env.baseline.toys[toy.slug] || { errors: [], hosts: [] } : null;
	const knownErrors = new Set(known ? known.errors || [] : []);
	const knownHosts = new Set(known ? known.hosts || [] : []);
	const ctx = { browser: env.browser, origin: env.origin, host: env.host, allowedHosts: toy.origins, knownHosts };

	const merged = new Map(); // "kind: text" -> finding with every pass it showed in
	const hostSet = new Set();
	let flaky = '';
	let stuck = false;
	const specs = passesFor(toy, env.base);
	for (let i = 0; i < specs.length; i++) {
		const r = await runPass(ctx, specs[i]);
		result.passes.push(r.info);
		if (r.stuck) stuck = true;
		if (r.stuck && i < specs.length - 1) {
			result.warnings.push(`the page hung in the "${specs[i].name}" pass; skipped: ${specs.slice(i + 1).map((s) => s.name).join(', ')}`);
			specs.length = i + 1;
		}
		for (const h of r.hosts) hostSet.add(h);
		for (const w of r.warnings) if (!result.warnings.includes(w)) result.warnings.push(w);
		if (r.flaky && !flaky) flaky = r.flaky;
		for (const f of r.findings) {
			const key = `${f.kind}: ${f.text}`;
			const prev = merged.get(key);
			if (prev) {
				if (!prev.passes.includes(f.pass)) prev.passes.push(f.pass);
			} else merged.set(key, { kind: f.kind, text: f.text, where: f.where, passes: [f.pass], key });
		}
	}
	result.hosts = [...hostSet].sort();

	const noiseErrors = [];
	const noiseHosts = [];
	for (const f of merged.values()) {
		const entry = { kind: f.kind, text: f.text, where: f.where, passes: f.passes };
		// Only what a page logs can be known noise. A page that hangs, does not
		// load or trips the harness fails whatever the baseline says.
		if (!toy.baselined || !BASELINE_KINDS.has(f.kind)) {
			result.failures.push(entry);
			continue;
		}
		if (f.kind === 'host') noiseHosts.push(f.text);
		else noiseErrors.push(f.key);
		const isKnown = f.kind === 'host' ? knownHosts.has(f.text) : knownErrors.has(f.key);
		if (isKnown || env.updateBaseline) result.tolerated.push(entry);
		else result.failures.push(entry);
	}
	if (toy.baselined) result.noise = { errors: [...new Set(noiseErrors)].sort(), hosts: [...new Set(noiseHosts)].sort() };
	result.ok = result.failures.length === 0;
	result.ms = Date.now() - started;
	return { result, flaky, stuck };
}

// A toy that fails while an outside host was unreachable, or by timing out
// (this machine runs many of these at once), gets one more go: a hiccup should
// not fail the gate, and a real bug fails twice.
// The same goes for recording a baseline: noise seen while a CDN was down is
// not the toy's usual noise.
async function runToy(env, toy) {
	const first = await runToyOnce(env, toy);
	const noisy = env.updateBaseline && first.result.noise && (first.result.noise.errors.length || first.result.noise.hosts.length);
	const again = first.result.ok ? noisy && first.flaky : first.flaky || first.stuck;
	if (!again) return first.result;
	const second = await runToyOnce(env, toy);
	second.result.retried = true;
	second.result.ms += first.result.ms;
	second.result.warnings.unshift(first.flaky ? `retried once: an outside request had failed in the first run (${first.flaky})` : 'retried once: the page had timed out in the first run');
	if (noisy && second.flaky) second.result.warnings.unshift(`baseline recorded while an outside request was failing (${second.flaky}); record it again later`);
	return second.result;
}

// ---- the site shell ---------------------------------------------------------

async function runSite(env, concurrency) {
	const started = Date.now();
	const jobs = [];
	for (const route of SITE_ROUTES) for (const theme of SITE_THEMES) jobs.push({ route, theme });
	const pages = await pool(jobs, concurrency, async ({ route, theme }) => {
		const t0 = Date.now();
		const out = { route, theme, ok: true, ms: 0, failures: [], consoleErrors: 0, hosts: [], screenshot: '', cards: null, targets: [] };
		let page = null;
		try {
			page = await env.browser.newPage({ width: 1280, height: 800, theme, extraAllowedHosts: SITE_HOSTS });
			await page.goto(`${env.base}index.html#/${route}`, { settleMs: 1200 });
			const state = await page.eval(() => {
				const cards = [...document.querySelectorAll('#miscContent .misc-card[href], #bs-views .misc-card[href]')];
				return {
					theme: document.documentElement.getAttribute('data-theme'),
					misc: document.querySelectorAll('#miscContent .misc-card[href]').length,
					views: document.querySelectorAll('#bs-views .misc-card[href]').length,
					targets: cards.map((a) => {
						const img = a.querySelector('img');
						return { href: a.getAttribute('href') || '', img: img ? img.getAttribute('src') || '' : '' };
					}),
				};
			});
			out.cards = { misc: state.misc, views: state.views };
			out.targets = state.targets;
			if (state.theme !== theme) out.failures.push({ kind: 'check', text: `seeded localStorage.theme = "${theme}" but <html data-theme> is "${state.theme}"` });
			const file = path.join(outDir, `site-${route}-${theme}.png`);
			const shot = await page.screenshot(null, { format: 'png' });
			try {
				writeFileAtomic(file, shot);
				out.screenshot = path.relative(repoRoot, file).replace(/\\/g, '/');
			} catch (e) {
				out.screenshot = ''; // another run holds the file; the check itself is unaffected
			}
			for (const e of page.errors) {
				if (e.type === 'exception' && e.target !== 'iframe') out.failures.push({ kind: 'exception', text: normalise(e.text, env.origin), where: normalise(e.url ? `${e.url}:${e.line}` : '', env.origin) });
				else if (e.type === 'console.error') out.consoleErrors++;
			}
			for (const r of page.badRequests) {
				if (r.host === env.host) out.failures.push({ kind: 'request', text: normalise(`${r.reason} ${r.url}`, env.origin), where: '' });
			}
			out.hosts = page.externalHosts;
		} catch (e) {
			out.failures.push({ kind: e.code === 'TOY_NOT_READY' ? 'ready' : 'load', text: e.message, where: '' });
		} finally {
			if (page) await page.close().catch(() => {});
		}
		out.ok = out.failures.length === 0;
		out.ms = Date.now() - t0;
		return out;
	});

	// Every card must lead somewhere: its page and its thumbnail have to exist
	// with the exact spelling (GitHub Pages is case-sensitive).
	const site = { ok: true, ms: 0, pages, cards: { misc: 0, views: 0 }, cardTargets: 0, broken: [] };
	const seen = new Set();
	for (const p of pages) {
		if (p.cards) {
			site.cards.misc = Math.max(site.cards.misc, p.cards.misc);
			site.cards.views = Math.max(site.cards.views, p.cards.views);
		}
		for (const t of p.targets) {
			for (const ref of [t.href, t.img]) {
				if (!ref || seen.has(ref)) continue;
				seen.add(ref);
				let u;
				try {
					u = new URL(ref, env.base);
				} catch (e) {
					site.broken.push(`${ref} (not a URL)`);
					continue;
				}
				if (u.origin !== env.origin) continue;
				site.cardTargets++;
				if (!env.server.resolve(u.pathname)) site.broken.push(ref);
			}
		}
		delete p.targets;
	}
	if (!site.cards.misc) site.broken.push('no card matches #miscContent .misc-card[href]');
	site.ok = pages.every((p) => p.ok) && site.broken.length === 0;
	site.ms = Date.now() - started;
	return site;
}

// ---- output -------------------------------------------------------------------

function describe(f) {
	const where = f.where ? `  (${f.where})` : '';
	const passes = f.passes && f.passes.length ? `  [${f.passes.join(', ')}]` : '';
	return `${f.kind}: ${f.text}${where}${passes}`;
}

function toyLines(r, verbose) {
	if (r.skipped) return [`SKIP ${r.slug} (${r.skipped})`];
	const extra = [];
	if (r.retried) extra.push('retried');
	if (r.tolerated.length) extra.push(`${r.tolerated.length} known`);
	const lines = [`${r.ok ? 'PASS' : 'FAIL'} ${r.slug} ${r.ms} ms${extra.length ? ' (' + extra.join(', ') + ')' : ''}`];
	for (const f of r.failures) lines.push('     ' + describe(f));
	if (!r.ok || verbose) {
		for (const w of r.warnings) lines.push('     warning: ' + w);
	}
	if (verbose) for (const f of r.tolerated) lines.push('     known: ' + describe(f));
	return lines;
}

function siteLines(site) {
	const lines = [];
	for (const p of site.pages) {
		lines.push(`${p.ok ? 'PASS' : 'FAIL'} site #/${p.route} ${p.theme} ${p.ms} ms${p.consoleErrors ? ` (${p.consoleErrors} console errors, not counted)` : ''}`);
		for (const f of p.failures) lines.push('     ' + describe(f));
	}
	lines.push(`     cards: #miscContent .misc-card[href] = ${site.cards.misc}, #bs-views .misc-card[href] = ${site.cards.views}`);
	lines.push(`     card links and thumbnails checked on disk: ${site.cardTargets}, broken: ${site.broken.length}`);
	for (const b of site.broken) lines.push('     broken: ' + b);
	lines.push(`     screenshots: scripts/qa/out/site-<route>-<theme>.png`);
	return lines;
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
				path: { type: 'string', multiple: true },
				json: { type: 'boolean', default: false },
				'update-baseline': { type: 'boolean', default: false },
				site: { type: 'boolean', default: false },
				concurrency: { type: 'string', default: '4' },
				mount: { type: 'string', multiple: true },
				root: { type: 'string' },
				verbose: { type: 'boolean', default: false },
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
	const concurrency = Math.max(1, Math.min(16, parseInt(values.concurrency, 10) || 4));
	const root = values.root ? path.resolve(values.root) : repoRoot;
	let mounts;
	try {
		mounts = parseMounts(values.mount);
	} catch (e) {
		console.error(e.message);
		return 2;
	}
	if (!values.all && !values.site && !positionals.length && !(values.path || []).length) {
		console.error(USAGE);
		return 2;
	}
	// The baseline and smoke-last.json describe this repo's toys, nothing else.
	const isRepo = root === path.resolve(repoRoot);
	if (values['update-baseline'] && !isRepo) {
		console.error('--update-baseline records the noise of the toys in this repo; it cannot be combined with --root.');
		return 2;
	}

	const server = await startServer({ port: 0, root, mounts });
	const origin = server.url.slice(0, -1);
	const all = listToys(root);
	const targets = [];
	const skipped = [];

	if (values.all) {
		for (const toy of all) {
			if (toy.wip) skipped.push({ slug: toy.slug, path: toy.path, skipped: 'wip' });
			else targets.push(toy);
		}
	}
	const { picked, unknown } = pickToys(all, positionals);
	for (const toy of picked) if (!targets.includes(toy)) targets.push(toy);
	for (const p of values.path || []) {
		const rel = p.replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
		const same = all.find((t) => t.path === rel);
		if (same) {
			if (!targets.includes(same)) targets.push(same);
			continue;
		}
		const index = server.resolve('/' + rel + '/index.html');
		if (!index) {
			unknown.push(`--path ${p} (no index.html there)`);
			continue;
		}
		const toy = readToy(path.dirname(index), rel);
		toy.slug = rel; // shown by its path; such a target never gets a baseline
		toy.viaPath = true;
		targets.push(toy);
	}
	if (unknown.length) {
		await server.close();
		console.error(`Unknown toy: ${unknown.join(', ')}`);
		console.error(`Known toys: ${all.map((t) => t.slug).join(' ')}`);
		return 2;
	}
	for (const toy of targets) toy.baselined = isRepo && !toy.kit && !toy.viaPath;

	const env = {
		server,
		base: server.url,
		origin,
		host: new URL(server.url).host,
		baseline: loadBaseline(),
		updateBaseline: values['update-baseline'],
		browser: null,
	};
	const say = (lines) => {
		if (!values.json) process.stdout.write(lines.join('\n') + '\n');
	};

	const started = Date.now();
	const startedAt = new Date().toISOString();
	let results = [];
	let site = null;
	let fatal = '';
	try {
		env.browser = await launch();
		if (targets.length) {
			results = await pool(targets, concurrency, async (toy) => {
				const r = await runToy(env, toy);
				say(toyLines(r, values.verbose));
				return r;
			});
		}
		if (values.site) {
			site = await runSite(env, concurrency);
			say(siteLines(site));
		}
	} catch (e) {
		fatal = e && e.stack ? e.stack : String(e);
	} finally {
		if (env.browser) await env.browser.close();
		await server.close();
	}
	if (fatal) {
		console.error(`smoke: the harness itself failed: ${fatal}`);
		return 1;
	}

	if (skipped.length) say(skipped.map((s) => `SKIP ${s.slug} (${s.skipped})`));

	// Baseline: replace the entry of every old toy that was run.
	let baselineNote = '';
	if (env.updateBaseline) {
		const data = loadBaseline();
		const next = { ...data.toys };
		for (const r of results) {
			// A toy that hung or did not load was not seen whole: keep its old entry.
			if (!r.noise || r.failures.length) continue;
			if (r.noise.errors.length || r.noise.hosts.length) next[r.slug] = { errors: r.noise.errors, hosts: r.noise.hosts };
			else delete next[r.slug];
		}
		if (values.all) {
			const live = new Set(all.filter((t) => !t.kit).map((t) => t.slug));
			for (const slug of Object.keys(next)) if (!live.has(slug)) delete next[slug];
		}
		const sorted = {};
		for (const slug of Object.keys(next).sort()) sorted[slug] = next[slug];
		const doc = {
			about: 'Known noise of the toys that predate the kit. Written by `node scripts/qa/smoke.mjs --all --update-baseline`; a toy without "kit": true fails the smoke test only on an error or an outside host that is not listed here. Kit toys never get an entry.',
			updated: startedAt.slice(0, 10),
			toys: sorted,
		};
		writeFileAtomic(baselineFile, JSON.stringify(doc, null, '\t') + '\n');
		baselineNote = `baseline.json updated: ${Object.keys(sorted).length} toys with known noise`;
	}

	const failed = results.filter((r) => !r.ok).length;
	const ok = failed === 0 && (!site || site.ok);
	const doc = {
		ok,
		startedAt,
		ms: Date.now() - started,
		browser: env.browser ? env.browser.version : '',
		counts: { toys: results.length, passed: results.length - failed, failed, skipped: skipped.length },
		toys: [...results, ...skipped].map((r) => {
			const { noise, ...rest } = r;
			return rest;
		}),
		site,
	};
	if (values.all && isRepo) {
		try {
			writeFileAtomic(path.join(outDir, 'smoke-last.json'), JSON.stringify(doc, null, '\t') + '\n');
		} catch (e) {
			process.stderr.write(`smoke: could not write scripts/qa/out/smoke-last.json (${e.message})\n`);
		}
	}

	if (values.json) process.stdout.write(JSON.stringify(doc, null, '\t') + '\n');
	else {
		const parts = [];
		if (results.length || skipped.length) parts.push(`${results.length} toys: ${results.length - failed} passed, ${failed} failed${skipped.length ? `, ${skipped.length} skipped (wip)` : ''}`);
		if (site) parts.push(`site ${site.ok ? 'passed' : 'FAILED'}`);
		say([`${parts.join('; ')} in ${(doc.ms / 1000).toFixed(1)} s`]);
		if (baselineNote) say([baselineNote]);
	}
	return ok ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
	process.stdout.on('error', () => {}); // a closed pipe (| head) must not turn a pass into a crash
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
