// Headless browser driver for the QA harness: launches Chrome (or Edge) and
// talks to it over the DevTools protocol. A library only, there is no CLI.
//
// Zero dependencies, Node 24 built-ins only. Used by smoke.mjs, shot.mjs and
// drive.mjs in this folder:
//   import { launch } from './cdp.mjs';
//   const browser = await launch();
//   const page = await browser.newPage({ width: 1280, height: 800, theme: 'dark' });
//   await page.goto('http://127.0.0.1:1234/misc/44-text-tartan/');
//   console.log(page.errors, page.badRequests);
//   await browser.close();
// The whole API is described in scripts/qa/README.md.
//
// How it works:
//   - Transport is --remote-debugging-pipe: NUL-terminated JSON on the child's
//     fd 3 (we write) and fd 4 (we read). No port, so parallel runs cannot
//     collide, and the browser exits by itself when this process dies.
//   - Every browser gets a fresh profile from fs.mkdtempSync, removed on close.
//   - At most QA_MAX_BROWSERS (default 4) browsers run at once across ALL node
//     processes on the machine: each one holds a lock file in
//     <tmp>/nietztein-qa/. Later callers wait and poll.
//   - The analytics hosts are always blocked, so QA never sends a page view.
//
// Environment:
//   QA_BROWSER        full path of the browser to use instead of Chrome/Edge
//   QA_MAX_BROWSERS   how many browsers may run at once, machine-wide (4)
//   QA_HEADFUL=1      show the browser window (for debugging by hand)
//   QA_DEBUG=1        pass the browser's stderr through

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Requests to these hosts (and their subdomains) are always blocked.
export const ANALYTICS_HOSTS = ['googletagmanager.com', 'google-analytics.com', 'gc.zgo.at', 'goatcounter.com'];

// Hosts a page may contact besides the server it was loaded from.
export const DEFAULT_ALLOWED_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

const LOCK_DIR = path.join(os.tmpdir(), 'nietztein-qa');
const HEARTBEAT_MS = 15000;
const STALE_MS = 120000;

// How much one page may record before the rest is dropped.
const MAX_ERRORS = 500;
const MAX_REQUESTS = 5000;

const FLAGS = [
	'--no-first-run',
	'--no-default-browser-check',
	'--disable-extensions',
	'--hide-scrollbars',
	'--mute-audio',
	'--force-color-profile=srgb',
	'--disable-background-timer-throttling',
	'--disable-renderer-backgrounding',
	'--enable-unsafe-swiftshader',
	// Beyond the basic list: keep every page painting at full rate, and keep
	// the browser itself from phoning anywhere.
	'--disable-backgrounding-occluded-windows',
	'--disable-background-networking',
	'--disable-component-update',
	'--disable-sync',
	'--disable-default-apps',
	'--no-pings',
	'--disable-search-engine-choice-screen',
	'--window-size=1280,800',
	// A second lock on analytics, below the protocol-level block: these names
	// do not resolve for anything in this browser.
	'--host-resolver-rules=' + ANALYTICS_HOSTS.flatMap((h) => [`MAP ${h} ~NOTFOUND`, `MAP *.${h} ~NOTFOUND`]).join(', '),
	'--remote-debugging-pipe',
];

export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- which browser ------------------------------------------------------------

function findBrowser() {
	const override = process.env.QA_BROWSER;
	if (override) {
		if (!fs.existsSync(override)) throw new Error(`QA_BROWSER points at a file that does not exist: ${override}`);
		return override;
	}
	let candidates;
	if (process.platform === 'win32') {
		const pf = process.env.ProgramFiles || 'C:\\Program Files';
		const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
		const local = process.env.LOCALAPPDATA || '';
		candidates = [
			path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
			path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
			local ? path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
			path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
			path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
		];
	} else if (process.platform === 'darwin') {
		candidates = [
			'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
			'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
			'/Applications/Chromium.app/Contents/MacOS/Chromium',
		];
	} else {
		candidates = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
	}
	const found = candidates.find((c) => c && fs.existsSync(c));
	if (!found) throw new Error('No Chrome or Edge found. Set QA_BROWSER to the full path of a Chromium-based browser.');
	return found;
}

// ---- cross-process semaphore ------------------------------------------------
//
// One lock file per slot, created with the exclusive 'wx' flag and holding the
// owner's PID. A lock is stale when its PID is gone, or when its owner stopped
// refreshing the file's mtime (covers a PID that Windows handed to another
// program). The worst a lost race can do is let one extra browser run.

function maxBrowsers() {
	const n = parseInt(process.env.QA_MAX_BROWSERS || '', 10);
	return Number.isInteger(n) && n > 0 ? n : 4;
}

function pidAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return e.code === 'EPERM';
	}
}

function lockIsStale(file) {
	let stat;
	let info = null;
	try {
		stat = fs.statSync(file);
		info = JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch (e) {
		if (!stat) return false; // vanished, or unreadable right now: let the next poll decide
	}
	const age = Date.now() - stat.mtimeMs;
	if (!info) return age > 5000; // created but never written: its owner died in between
	if (!pidAlive(info.pid)) return true;
	return age > STALE_MS;
}

function tryTakeSlot(index) {
	const file = path.join(LOCK_DIR, `browser-${index}.lock`);
	const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const fd = fs.openSync(file, 'wx');
			try {
				fs.writeSync(fd, JSON.stringify({ pid: process.pid, token, since: new Date().toISOString() }));
			} finally {
				fs.closeSync(fd);
			}
			const slot = { file, token, index, timer: null };
			slot.timer = setInterval(() => {
				try {
					const now = new Date();
					fs.utimesSync(file, now, now);
				} catch (e) {
					/* the lock is gone; nothing to refresh */
				}
			}, HEARTBEAT_MS);
			slot.timer.unref();
			return slot;
		} catch (e) {
			// EEXIST: taken. EPERM/EACCES/EBUSY: Windows is still deleting it.
			if (!['EEXIST', 'EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
			if (e.code !== 'EEXIST') return null;
		}
		if (!lockIsStale(file)) return null;
		try {
			fs.unlinkSync(file);
		} catch (e) {
			return null;
		}
	}
	return null;
}

function releaseSlot(slot) {
	if (!slot || slot.released) return;
	slot.released = true;
	clearInterval(slot.timer);
	try {
		const info = JSON.parse(fs.readFileSync(slot.file, 'utf8'));
		if (info.token === slot.token) fs.unlinkSync(slot.file);
	} catch (e) {
		/* already gone */
	}
}

function slotHolders() {
	const pids = [];
	for (let i = 0; i < maxBrowsers(); i++) {
		try {
			pids.push(JSON.parse(fs.readFileSync(path.join(LOCK_DIR, `browser-${i}.lock`), 'utf8')).pid);
		} catch (e) {
			/* free or unreadable */
		}
	}
	return pids;
}

async function acquireSlot() {
	fs.mkdirSync(LOCK_DIR, { recursive: true });
	const limit = Number(process.env.QA_LOCK_TIMEOUT_MS) || 15 * 60 * 1000;
	const started = Date.now();
	let told = false;
	for (;;) {
		const max = maxBrowsers();
		for (let i = 0; i < max; i++) {
			const slot = tryTakeSlot(i);
			if (slot) return slot;
		}
		const waited = Date.now() - started;
		if (waited > limit) {
			throw new Error(`No free browser slot after ${Math.round(waited / 1000)} s (QA_MAX_BROWSERS=${max}; held by PIDs ${slotHolders().join(', ') || 'unknown'}). Lock files live in ${LOCK_DIR}.`);
		}
		if (!told && waited > 20000) {
			told = true;
			process.stderr.write(`qa: waiting for a browser slot (QA_MAX_BROWSERS=${max}, held by PIDs ${slotHolders().join(', ')})\n`);
		}
		await sleep(150 + Math.random() * 250);
	}
}

// Profiles left behind by a process that was killed outright.
function sweepStaleProfiles() {
	let names;
	try {
		names = fs.readdirSync(LOCK_DIR);
	} catch (e) {
		return;
	}
	for (const name of names) {
		const m = /^profile-(\d+)-/.exec(name);
		if (!m || pidAlive(Number(m[1]))) continue;
		// One try only: if a dying browser still holds it, the next launch gets it.
		removeDirSync(path.join(LOCK_DIR, name), 1);
	}
}

// ---- cleanup that survives errors and Ctrl+C -------------------------------

const liveBrowsers = new Set();
let exitHooked = false;

function hookExit() {
	if (exitHooked) return;
	exitHooked = true;
	process.on('exit', () => {
		for (const b of [...liveBrowsers]) b._destroySync();
	});
	const codes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129, SIGBREAK: 149 };
	for (const sig of Object.keys(codes)) {
		process.on(sig, () => {
			for (const b of [...liveBrowsers]) b._destroySync();
			process.exit(codes[sig]);
		});
	}
}

// Windows keeps a dead browser's files locked for a moment, and fs.rm's own
// maxRetries does not cover that case here, so both removers retry by hand.
function removeDirSync(dir, tries = 40) {
	const pause = new Int32Array(new SharedArrayBuffer(4));
	for (let i = 0; i < tries; i++) {
		if (i) Atomics.wait(pause, 0, 0, 100);
		try {
			fs.rmSync(dir, { recursive: true, force: true });
			if (!fs.existsSync(dir)) return true;
		} catch (e) {
			/* locked; wait and retry */
		}
	}
	return false;
}

async function removeDir(dir, tries = 60) {
	for (let i = 0; i < tries; i++) {
		if (i) await sleep(100);
		try {
			await fs.promises.rm(dir, { recursive: true, force: true });
			if (!fs.existsSync(dir)) return true;
		} catch (e) {
			/* locked; wait and retry */
		}
	}
	return false;
}

function killTree(child) {
	if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
	if (process.platform === 'win32') {
		spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
	} else {
		try {
			child.kill('SIGKILL');
		} catch (e) {
			/* already gone */
		}
	}
}

// ---- protocol connection over the pipe ---------------------------------------

class Connection {
	constructor(child) {
		this._w = child.stdio[3];
		this._r = child.stdio[4];
		this._nextId = 0;
		this._pending = new Map();
		this._chunks = [];
		this.closed = false;
		this.onEvent = null; // (method, params, sessionId) => void
		this._r.on('data', (chunk) => this._onData(chunk));
		this._r.on('close', () => this._onClose());
		this._r.on('error', () => this._onClose());
		this._w.on('error', () => this._onClose());
	}

	_onData(chunk) {
		let start = 0;
		for (;;) {
			const end = chunk.indexOf(0, start);
			if (end === -1) {
				if (start < chunk.length) this._chunks.push(start ? chunk.subarray(start) : chunk);
				return;
			}
			this._chunks.push(chunk.subarray(start, end));
			const text = Buffer.concat(this._chunks).toString('utf8');
			this._chunks = [];
			start = end + 1;
			if (text) this._onMessage(text);
		}
	}

	_onMessage(text) {
		let msg;
		try {
			msg = JSON.parse(text);
		} catch (e) {
			return;
		}
		if (msg.id !== undefined) {
			const p = this._pending.get(msg.id);
			if (!p) return;
			this._pending.delete(msg.id);
			clearTimeout(p.timer);
			if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}${msg.error.data ? ' (' + msg.error.data + ')' : ''}`));
			else p.resolve(msg.result || {});
			return;
		}
		if (msg.method && this.onEvent) {
			try {
				this.onEvent(msg.method, msg.params || {}, msg.sessionId || '');
			} catch (e) {
				process.stderr.write(`qa: bug in an event handler for ${msg.method}: ${e && e.stack ? e.stack : e}\n`);
			}
		}
	}

	_onClose() {
		if (this.closed) return;
		this.closed = true;
		for (const p of this._pending.values()) {
			clearTimeout(p.timer);
			p.reject(new Error(`browser closed before answering ${p.method}`));
		}
		this._pending.clear();
	}

	send(method, params = {}, sessionId = '', timeoutMs = 30000) {
		if (this.closed) return Promise.reject(new Error(`browser is closed (${method})`));
		const id = ++this._nextId;
		const msg = { id, method, params };
		if (sessionId) msg.sessionId = sessionId;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this._pending.delete(id);
				reject(new Error(`${method}: no answer from the browser within ${timeoutMs} ms`));
			}, timeoutMs);
			this._pending.set(id, { resolve, reject, timer, method });
			try {
				this._w.write(JSON.stringify(msg) + '\0');
			} catch (e) {
				clearTimeout(timer);
				this._pending.delete(id);
				reject(e);
			}
		});
	}
}

// ---- helpers ------------------------------------------------------------------

function hostOf(url) {
	try {
		return new URL(url).host;
	} catch (e) {
		return '';
	}
}

function hostnameOf(url) {
	try {
		return new URL(url).hostname;
	} catch (e) {
		return '';
	}
}

function matchesHost(hostname, entry) {
	return hostname === entry || hostname.endsWith('.' + entry);
}

function isAnalyticsHost(hostname) {
	return ANALYTICS_HOSTS.some((h) => matchesHost(hostname, h));
}

// Accepts "example.com", "*.example.com" and, leniently, "https://example.com/x".
function normaliseHostEntry(entry) {
	let s = String(entry || '').trim().toLowerCase();
	s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/\/.*$/, '');
	return s;
}

// Network.setBlockedURLs takes two spellings: `urls` (wildcard globs; marked
// deprecated in Chrome 154 but still honoured) and `urlPatterns` (URLPattern
// syntax, where the port must be spelled out or only the default port
// matches). Both are sent, so whichever the browser understands does the job.
function blockParams(analyticsHosts, otherHosts) {
	const urls = analyticsHosts.map((h) => `*${h}*`);
	for (const h of otherHosts) urls.push(`*://${h}/*`, `*://${h}:*/*`, `*://*.${h}/*`, `*://*.${h}:*/*`);
	const urlPatterns = [];
	for (const h of [...analyticsHosts, ...otherHosts]) {
		urlPatterns.push({ urlPattern: `*://${h}:*/*`, block: true }, { urlPattern: `*://*.${h}:*/*`, block: true });
	}
	return { urls, urlPatterns };
}

function remoteToText(arg) {
	if (!arg) return '';
	if (arg.type === 'string') return arg.value;
	if (arg.subtype === 'error' && arg.description) return arg.description.split('\n')[0];
	if (arg.type === 'object' && arg.preview && Array.isArray(arg.preview.properties) && arg.subtype !== 'error') {
		const props = arg.preview.properties.map((p) => (arg.subtype === 'array' ? p.value : `${p.name}: ${p.value}`));
		const body = props.join(', ') + (arg.preview.overflow ? ', ...' : '');
		return arg.subtype === 'array' ? `[${body}]` : `{${body}}`;
	}
	if (arg.value !== undefined) return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
	if (arg.unserializableValue) return arg.unserializableValue;
	return arg.description || arg.type || '';
}

// US-layout key table for page.key() and page.type().
const NAMED_KEYS = {
	Enter: { code: 'Enter', keyCode: 13, text: '\r' },
	Escape: { code: 'Escape', keyCode: 27 },
	Tab: { code: 'Tab', keyCode: 9 },
	Backspace: { code: 'Backspace', keyCode: 8 },
	Delete: { code: 'Delete', keyCode: 46 },
	Insert: { code: 'Insert', keyCode: 45 },
	ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
	ArrowUp: { code: 'ArrowUp', keyCode: 38 },
	ArrowRight: { code: 'ArrowRight', keyCode: 39 },
	ArrowDown: { code: 'ArrowDown', keyCode: 40 },
	Home: { code: 'Home', keyCode: 36 },
	End: { code: 'End', keyCode: 35 },
	PageUp: { code: 'PageUp', keyCode: 33 },
	PageDown: { code: 'PageDown', keyCode: 34 },
	Shift: { code: 'ShiftLeft', keyCode: 16 },
	Control: { code: 'ControlLeft', keyCode: 17 },
	Alt: { code: 'AltLeft', keyCode: 18 },
	Meta: { code: 'MetaLeft', keyCode: 91 },
	' ': { code: 'Space', keyCode: 32, text: ' ' },
};
for (let i = 1; i <= 12; i++) NAMED_KEYS['F' + i] = { code: 'F' + i, keyCode: 111 + i };
const PUNCTUATION = {
	'`': ['Backquote', 192, '~'],
	'-': ['Minus', 189, '_'],
	'=': ['Equal', 187, '+'],
	'[': ['BracketLeft', 219, '{'],
	']': ['BracketRight', 221, '}'],
	'\\': ['Backslash', 220, '|'],
	';': ['Semicolon', 186, ':'],
	"'": ['Quote', 222, '"'],
	',': ['Comma', 188, '<'],
	'.': ['Period', 190, '>'],
	'/': ['Slash', 191, '?'],
};
const DIGIT_SHIFT = ')!@#$%^&*(';
const MODIFIER_BITS = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Shift: 8 };

// Describes one key: { key, code, keyCode, text, shift }.
function keyInfo(key) {
	if (key === 'Space') key = ' ';
	if (key === 'Esc') key = 'Escape';
	if (NAMED_KEYS[key]) return { key, text: '', shift: false, ...NAMED_KEYS[key] };
	if (key.length !== 1 && [...key].length !== 1) throw new Error(`key: unknown key name "${key}"`);
	if (/^[a-z]$/.test(key)) return { key, code: 'Key' + key.toUpperCase(), keyCode: key.toUpperCase().charCodeAt(0), text: key, shift: false };
	if (/^[A-Z]$/.test(key)) return { key, code: 'Key' + key, keyCode: key.charCodeAt(0), text: key, shift: true };
	if (/^[0-9]$/.test(key)) return { key, code: 'Digit' + key, keyCode: 48 + Number(key), text: key, shift: false };
	if (PUNCTUATION[key]) return { key, code: PUNCTUATION[key][0], keyCode: PUNCTUATION[key][1], text: key, shift: false };
	const digit = DIGIT_SHIFT.indexOf(key);
	if (digit !== -1) return { key, code: 'Digit' + digit, keyCode: 48 + digit, text: key, shift: true };
	for (const base of Object.keys(PUNCTUATION)) {
		if (PUNCTUATION[base][2] === key) return { key, code: PUNCTUATION[base][0], keyCode: PUNCTUATION[base][1], text: key, shift: true };
	}
	return null; // not on the table (accents, CJK, emoji): typed with Input.insertText
}

const VISIBLE_FN = `(sel) => {
	const el = document.querySelector(sel);
	if (!el) return false;
	const cs = getComputedStyle(el);
	if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
	const r = el.getBoundingClientRect();
	return r.width > 0 && r.height > 0;
}`;

// ---- Page -----------------------------------------------------------------------

class Page {
	constructor(browser, ids, options) {
		this.browser = browser;
		this.targetId = ids.targetId;
		this.sessionId = ids.sessionId;
		this.contextId = ids.browserContextId;
		this.options = options;
		this.url = 'about:blank';
		this.errors = [];
		this.requests = [];
		this.warnings = [];
		this.dialogs = [];
		this.downloads = [];
		this.ready = null; // { contract: boolean, ms } after a goto with waitReady
		this.closed = false;
		this._host = '';
		this._allowed = [...DEFAULT_ALLOWED_HOSTS, ...(options.extraAllowedHosts || [])].map(normaliseHostEntry).filter(Boolean);
		this._blockHosts = (options.blockHosts || []).map((h) => normaliseHostEntry(h).replace(/^\*\./, '')).filter(Boolean);
		this._reqs = new Map();
		this._inflight = new Map(); // request id -> session that announced it, until it is answered
		this._lastNet = Date.now();
		this._children = new Map();
		this._loaded = new Set(); // loader ids of main-frame documents that fired load
		this._loads = 0;
		this._mainFrame = ids.targetId;
		this._crashed = false;
	}

	_send(method, params = {}, timeoutMs = 30000) {
		if (this.closed) return Promise.reject(new Error(`page is closed (${method})`));
		return this.browser._conn.send(method, params, this.sessionId, timeoutMs);
	}

	async _init() {
		const o = this.options;
		const conn = this.browser._conn;
		await Promise.all([this._send('Page.enable'), this._send('Runtime.enable'), this._send('Log.enable'), this._send('Network.enable')]);
		await this._send('Page.setLifecycleEventsEnabled', { enabled: true });
		try {
			const tree = await this._send('Page.getFrameTree');
			if (tree.frameTree && tree.frameTree.frame) this._mainFrame = tree.frameTree.frame.id;
		} catch (e) {
			/* the target id is the main frame id in every Chrome so far */
		}
		await this._blockRequests(this.sessionId);
		await this.setViewport(o);
		const features = [{ name: 'prefers-reduced-motion', value: o.reducedMotion ? 'reduce' : 'no-preference' }];
		const scheme = o.colorScheme || o.theme || null;
		if (scheme) features.push({ name: 'prefers-color-scheme', value: scheme });
		await this._send('Emulation.setEmulatedMedia', { features });
		await this._send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
		const storage = { ...(o.storage || {}) };
		if (o.theme) storage.theme = o.theme;
		if (Object.keys(storage).length) {
			const source = `(() => { try { const s = ${JSON.stringify(storage)}; for (const k of Object.keys(s)) { if (localStorage.getItem(k) === null) localStorage.setItem(k, String(s[k])); } } catch (e) {} })();`;
			await this._send('Page.addScriptToEvaluateOnNewDocument', { source });
		}
		// Downloads land in the throwaway profile, never in the user's Downloads.
		await conn
			.send('Browser.setDownloadBehavior', {
				behavior: 'allowAndName',
				browserContextId: this.contextId,
				downloadPath: path.join(this.browser.profileDir, 'downloads'),
				eventsEnabled: true,
			})
			.catch(() => {});
		// Workers and cross-site iframes are separate targets; follow them so
		// their errors and requests are seen and their analytics is blocked too.
		await this._send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
	}

	// Blocks the analytics hosts and options.blockHosts for one session (the
	// page itself, or a worker or iframe of it).
	async _blockRequests(sessionId) {
		const { urls, urlPatterns } = blockParams(ANALYTICS_HOSTS, this._blockHosts);
		const send = (params) => this.browser._conn.send('Network.setBlockedURLs', params, sessionId);
		try {
			await send({ urls, urlPatterns });
		} catch (e) {
			try {
				await send({ urlPatterns });
			} catch (e2) {
				await send({ urls });
			}
		}
	}

	_isHarnessBlocked(url) {
		const hostname = hostnameOf(url);
		if (!hostname) return false;
		return isAnalyticsHost(hostname) || this._blockHosts.some((h) => matchesHost(hostname, h));
	}

	_isAllowed(url) {
		let u;
		try {
			u = new URL(url);
		} catch (e) {
			return true;
		}
		if (!/^(https?|wss?):$/.test(u.protocol)) return true; // data:, blob:, about:
		if (u.host === this._host) return true;
		return this._allowed.some((entry) => (entry.startsWith('*.') ? u.hostname.endsWith(entry.slice(1)) : u.hostname === entry || u.host === entry));
	}

	// ---- events ------------------------------------------------------------------

	// A worker's uncaught error is reported by the worker and again by its page;
	// keep one. The cap stops a toy that logs every frame from eating memory.
	_pushError(err) {
		if (this.errors.length >= MAX_ERRORS) return;
		const dup = this.errors.some((e) => e.type === err.type && e.text === err.text && e.url === err.url && e.line === err.line && e.target !== err.target);
		if (!dup) this.errors.push(err);
	}

	_onEvent(method, params, sessionId) {
		const childType = sessionId === this.sessionId ? '' : this._children.get(sessionId) || 'child';
		switch (method) {
			case 'Runtime.exceptionThrown': {
				const d = params.exceptionDetails || {};
				const ex = d.exception || {};
				let what = '';
				if (ex.description) what = ex.description.split('\n')[0];
				else if (ex.value !== undefined) what = typeof ex.value === 'string' ? ex.value : JSON.stringify(ex.value);
				else if (ex.unserializableValue) what = ex.unserializableValue;
				const prefix = d.text || 'Uncaught';
				const text = what ? (what.startsWith(prefix) ? what : `${prefix} ${what}`) : prefix;
				const frame = d.stackTrace && d.stackTrace.callFrames && d.stackTrace.callFrames[0];
				const err = {
					type: 'exception',
					text,
					url: d.url || (frame && frame.url) || '',
					line: d.url || !frame ? (d.lineNumber ?? -1) + 1 : frame.lineNumber + 1,
					stack: ex.description || '',
				};
				if (childType) err.target = childType;
				this._pushError(err);
				break;
			}
			case 'Runtime.consoleAPICalled': {
				if (params.type !== 'error' && params.type !== 'assert') break;
				const frame = params.stackTrace && params.stackTrace.callFrames && params.stackTrace.callFrames[0];
				const text = (params.args || []).map(remoteToText).join(' ');
				const err = {
					type: 'console.error',
					text: params.type === 'assert' ? `Assertion failed: ${text}` : text,
					url: frame ? frame.url : '',
					line: frame ? frame.lineNumber + 1 : 0,
				};
				if (childType) err.target = childType;
				this._pushError(err);
				break;
			}
			case 'Log.entryAdded': {
				const entry = params.entry || {};
				if (entry.level !== 'error') break;
				// Not the page's doing: what the harness blocked, and the browser's
				// own /favicon.ico probe on a page that declares no icon.
				if (entry.source === 'network' && entry.url && (this._isHarnessBlocked(entry.url) || /^https?:\/\/[^/]+\/favicon\.ico$/.test(entry.url))) break;
				const err = { type: 'log.error', text: entry.text || '', url: entry.url || '', line: entry.lineNumber ? entry.lineNumber + 1 : 0, source: entry.source || '' };
				if (childType) err.target = childType;
				this._pushError(err);
				break;
			}
			case 'Network.requestWillBeSent': {
				// Keyed by request id alone: a worker's script is announced on the
				// page's session and answered on the worker's.
				const key = params.requestId;
				const prev = this._reqs.get(key);
				const url = params.request.url;
				if (prev && params.redirectResponse) {
					prev.status = params.redirectResponse.status;
					prev.done = true;
				} else if (prev && prev.url === url) {
					break; // the same request, reported by a second session
				}
				if (url.startsWith('data:')) {
					this._reqs.delete(key);
					this._inflight.delete(key);
					break;
				}
				const rec = {
					url,
					host: hostOf(url),
					method: params.request.method,
					resourceType: params.type || 'Other',
					status: 0,
					failed: false,
					errorText: '',
					canceled: false,
					blocked: false,
					done: false,
				};
				if (this.requests.length < MAX_REQUESTS) this.requests.push(rec);
				this._reqs.set(key, rec);
				this._inflight.set(key, sessionId);
				this._lastNet = Date.now();
				break;
			}
			case 'Network.responseReceived': {
				const key = params.requestId;
				// Answered: no longer "in flight". A fetch() whose body is never read
				// gets no loadingFinished at all, so that event cannot be the test.
				this._inflight.delete(key);
				this._lastNet = Date.now();
				const rec = this._reqs.get(key);
				if (!rec) break;
				rec.status = params.response.status;
				if (params.type) rec.resourceType = params.type;
				break;
			}
			case 'Network.dataReceived': {
				this._lastNet = Date.now();
				break;
			}
			case 'Network.loadingFinished': {
				const key = params.requestId;
				const rec = this._reqs.get(key);
				if (rec) rec.done = true;
				this._inflight.delete(key);
				this._lastNet = Date.now();
				break;
			}
			case 'Network.loadingFailed': {
				const key = params.requestId;
				const rec = this._reqs.get(key);
				if (rec) {
					rec.failed = true;
					rec.done = true;
					rec.canceled = !!params.canceled;
					rec.blocked = params.blockedReason === 'inspector' || this._isHarnessBlocked(rec.url);
					rec.errorText = params.errorText || (rec.blocked ? 'blocked by the harness' : params.blockedReason || '');
				}
				this._inflight.delete(key);
				this._lastNet = Date.now();
				break;
			}
			case 'Network.webSocketCreated': {
				const rec = { url: params.url, host: hostOf(params.url), method: 'GET', resourceType: 'WebSocket', status: 0, failed: false, errorText: '', canceled: false, blocked: false, done: true };
				this.requests.push(rec);
				this._reqs.set(params.requestId, rec);
				break;
			}
			case 'Network.webSocketHandshakeResponseReceived': {
				const rec = this._reqs.get(params.requestId);
				if (rec && params.response) rec.status = params.response.status;
				break;
			}
			case 'Network.webSocketFrameError': {
				const rec = this._reqs.get(params.requestId);
				if (rec) {
					rec.failed = true;
					rec.errorText = params.errorMessage || '';
					rec.blocked = this._isHarnessBlocked(rec.url);
				}
				break;
			}
			case 'Page.lifecycleEvent': {
				if (!childType && params.name === 'load' && params.frameId === this._mainFrame) {
					this._loads++;
					this._loaded.add(params.loaderId);
					if (this._loaded.size > 32) this._loaded.delete(this._loaded.values().next().value);
				}
				break;
			}
			case 'Page.javascriptDialogOpening': {
				this.dialogs.push({ type: params.type, message: params.message });
				this.browser._conn.send('Page.handleJavaScriptDialog', { accept: true, promptText: params.defaultPrompt || '' }, sessionId).catch(() => {});
				break;
			}
			case 'Target.attachedToTarget': {
				const child = params.sessionId;
				const type = (params.targetInfo && params.targetInfo.type) || 'child';
				this._children.set(child, type);
				this.browser._sessions.set(child, this);
				const conn = this.browser._conn;
				const quiet = () => {};
				conn.send('Runtime.enable', {}, child).catch(quiet);
				conn.send('Network.enable', {}, child).catch(quiet);
				this._blockRequests(child).catch(quiet);
				if (type === 'iframe') conn.send('Page.enable', {}, child).catch(quiet);
				conn.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, child).catch(quiet);
				conn.send('Runtime.runIfWaitingForDebugger', {}, child).catch(quiet);
				break;
			}
			case 'Target.detachedFromTarget': {
				const child = params.sessionId;
				if (this._children.has(child)) {
					this._children.delete(child);
					this.browser._sessions.delete(child);
					for (const [key, owner] of [...this._inflight]) if (owner === child) this._inflight.delete(key);
				}
				break;
			}
			case 'Inspector.targetCrashed': {
				if (!childType) this._crashed = true;
				this._pushError({ type: 'exception', text: childType ? `A ${childType} crashed` : 'The page crashed', url: this.url, line: 0 });
				break;
			}
			default:
				break;
		}
	}

	_onDownload(method, params) {
		if (method === 'Browser.downloadWillBegin') {
			this.downloads.push({
				guid: params.guid,
				url: params.url,
				filename: params.suggestedFilename,
				path: path.join(this.browser.profileDir, 'downloads', params.guid),
				state: 'inProgress',
				bytes: 0,
			});
		} else {
			const d = this.downloads.find((x) => x.guid === params.guid);
			if (d) {
				d.state = params.state;
				d.bytes = params.receivedBytes;
			}
		}
	}

	// ---- derived views -------------------------------------------------------------

	// Requests that should not have happened: local ones that failed or answered
	// >= 400 (the browser's own /favicon.ico probe is ignored), and anything sent
	// to a host outside the allowlist. Each has a `reason`.
	get badRequests() {
		const out = [];
		for (const r of this.requests) {
			let reason = '';
			if (!/^(https?|wss?):/.test(r.url)) continue;
			if (r.host === this._host) {
				let pathname = '';
				try {
					pathname = new URL(r.url).pathname;
				} catch (e) {
					/* keep empty */
				}
				if (pathname === '/favicon.ico') continue;
				// The status comes first: Chrome cancels the body of a 404 script or
				// stylesheet, and that must still count. A cancel alone does not
				// (media elements and aborted fetches cancel all the time).
				if (r.status >= 400) reason = `HTTP ${r.status}`;
				else if (r.failed && !r.canceled) reason = `failed (${r.errorText || 'network error'})`;
			} else if (!this._isAllowed(r.url)) {
				reason = isAnalyticsHost(hostnameOf(r.url)) ? 'analytics host (blocked by the harness)' : 'host not in the allowlist';
			}
			if (reason) out.push({ ...r, reason });
		}
		return out;
	}

	// Every host contacted other than the server the page came from, sorted.
	// Requests the harness blocked never left the machine and are not counted.
	get externalHosts() {
		const set = new Set();
		for (const r of this.requests) {
			if (/^(https?|wss?):/.test(r.url) && r.host && r.host !== this._host && !r.blocked) set.add(r.host);
		}
		return [...set].sort();
	}

	// ---- navigation ----------------------------------------------------------------

	async _poll(fn, timeoutMs, intervalMs = 25) {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const v = await fn();
			if (v) return v;
			if (this.closed || this._crashed || this.browser._conn.closed) return false;
			if (Date.now() >= deadline) return false;
			await sleep(intervalMs);
		}
	}

	// True once the network has been quiet for idleMs: no request is waiting
	// for its answer and no bytes have arrived. False on timeout.
	async waitNetworkIdle({ idleMs = 500, timeoutMs = 10000 } = {}) {
		const ok = await this._poll(() => this._inflight.size === 0 && Date.now() - this._lastNet >= idleMs, timeoutMs);
		return !!ok;
	}

	// Loads a URL. With waitReady (the default) it then waits for: the load
	// event, 500 ms without network activity, document.fonts.ready, the
	// window.__toyReady contract, and finally settleMs.
	async goto(url, { waitReady = true, settleMs = 800, timeoutMs = 30000, readyTimeoutMs = 20000 } = {}) {
		const started = Date.now();
		let parsed;
		try {
			parsed = new URL(url);
		} catch (e) {
			throw new Error(`goto: not an absolute URL: ${url}`);
		}
		this._host = parsed.host;
		this.url = url;
		this.ready = null;
		const nav = await this._send('Page.navigate', { url }, timeoutMs);
		if (nav.errorText) throw new Error(`goto ${url}: ${nav.errorText}`);
		// No loader id means the document stayed (only the #fragment changed).
		if (nav.loaderId) await this._waitLoad(() => this._loaded.has(nav.loaderId), `goto ${url}`, started, timeoutMs);
		if (!waitReady) return { ms: Date.now() - started };
		return this._waitReady(started, settleMs, readyTimeoutMs);
	}

	// Reloads the current document and waits like goto(). (goto() with the URL
	// the page is already on, #fragment included, does not reload.)
	async reload({ waitReady = true, settleMs = 800, timeoutMs = 30000, readyTimeoutMs = 20000 } = {}) {
		const started = Date.now();
		const before = this._loads;
		this.ready = null;
		await this._send('Page.reload', {}, timeoutMs);
		await this._waitLoad(() => this._loads > before, `reload ${this.url}`, started, timeoutMs);
		if (!waitReady) return { ms: Date.now() - started };
		return this._waitReady(started, settleMs, readyTimeoutMs);
	}

	async _waitLoad(isLoaded, label, started, timeoutMs) {
		const loaded = await this._poll(isLoaded, Math.max(1000, timeoutMs - (Date.now() - started)));
		if (loaded) return;
		const waiting = [...this._inflight.keys()].map((k) => this._reqs.get(k)).filter(Boolean).map((r) => r.url).slice(0, 3);
		const err = new Error(this._crashed ? `${label}: the page crashed` : `${label}: no load event within ${timeoutMs} ms${waiting.length ? ' (still waiting for ' + waiting.join(', ') + ')' : ''}`);
		err.code = 'LOAD_TIMEOUT';
		throw err;
	}

	async _waitReady(started, settleMs, readyTimeoutMs) {
		const idle = await this.waitNetworkIdle({ idleMs: 500, timeoutMs: 10000 });
		if (!idle) {
			const busy = [...this._inflight.keys()].map((k) => this._reqs.get(k)).filter(Boolean).map((r) => r.url);
			this.warnings.push(`network still busy 10 s after load${busy.length ? ': no answer yet from ' + busy.slice(0, 3).join(', ') : ''}`);
		}
		await this.eval('document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready.then(() => true), new Promise((r) => setTimeout(r, 5000, false))]) : true').catch(() => {});
		await this.waitToyReady({ timeoutMs: readyTimeoutMs });
		if (settleMs > 0) await sleep(settleMs);
		this.ready.ms = Date.now() - started;
		return { ms: this.ready.ms, ready: this.ready };
	}

	// The ready contract: a page that defines window.__toyReady must set it to
	// true (else this throws with code TOY_NOT_READY); a page that does not
	// define it is an old toy and is taken as ready.
	async waitToyReady({ timeoutMs = 20000 } = {}) {
		const probe = 'typeof window.__toyReady === "undefined" ? "undefined" : window.__toyReady === true ? "true" : "pending"';
		const started = Date.now();
		let state = 'undefined';
		const ok = await this._poll(
			async () => {
				try {
					state = await this.eval(probe);
				} catch (e) {
					state = 'pending'; // mid-navigation; ask again
				}
				return state !== 'pending';
			},
			timeoutMs,
			50
		);
		this.ready = { contract: state !== 'undefined', ms: Date.now() - started };
		if (!ok) {
			const err = new Error(`window.__toyReady was still not true after ${timeoutMs} ms`);
			err.code = 'TOY_NOT_READY';
			throw err;
		}
		return this.ready;
	}

	// ---- script ----------------------------------------------------------------------

	// Runs an expression (string) or a function (called with ...args) in the
	// page and returns its JSON-serialisable result. Promises are awaited. An
	// exception in the page is thrown here; it is not added to page.errors.
	async eval(expressionOrFunction, ...args) {
		const expression =
			typeof expressionOrFunction === 'function'
				? `(${expressionOrFunction.toString()})(...${JSON.stringify(args)})`
				: String(expressionOrFunction);
		const res = await this._send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, 60000);
		if (res.exceptionDetails) {
			const d = res.exceptionDetails;
			const what = d.exception && (d.exception.description || d.exception.value);
			throw new Error(`page.eval: ${what !== undefined && what !== '' ? (typeof what === 'string' ? what : JSON.stringify(what)) : d.text}`);
		}
		return res.result ? res.result.value : undefined;
	}

	// Waits until a selector matches (string) or a function returns something
	// truthy in the page (called with ...args), and returns that value. For a
	// selector, `visible` waits until it is actually showing and `hidden` until
	// it is gone or no longer showing. Throws on timeout.
	async waitFor(selectorOrFunction, { timeoutMs = 10000, intervalMs = 50, visible = false, hidden = false, args = [] } = {}) {
		const isFn = typeof selectorOrFunction === 'function';
		let lastError = '';
		const check = async () => {
			try {
				if (isFn) return await this.eval(selectorOrFunction, ...args);
				if (hidden) return !(await this.eval(`(${VISIBLE_FN})(${JSON.stringify(selectorOrFunction)})`));
				if (visible) return await this.eval(`(${VISIBLE_FN})(${JSON.stringify(selectorOrFunction)})`);
				return await this.eval(`!!document.querySelector(${JSON.stringify(selectorOrFunction)})`);
			} catch (e) {
				lastError = e.message;
				return false;
			}
		};
		const value = await this._poll(check, timeoutMs, intervalMs);
		if (!value) {
			const what = isFn ? 'the condition' : `"${selectorOrFunction}"${hidden ? ' (hidden)' : visible ? ' (visible)' : ''}`;
			throw new Error(`waitFor: ${what} not met within ${timeoutMs} ms${lastError ? ` (last error: ${lastError})` : ''}`);
		}
		return value;
	}

	// Is the first match of the selector actually showing (rendered, not
	// display:none, visibility:hidden or fully transparent)?
	isVisible(selector) {
		return this.eval(`(${VISIBLE_FN})(${JSON.stringify(selector)})`);
	}

	// ---- input -----------------------------------------------------------------------

	_mouse(type, x, y, extra = {}) {
		return this._send('Input.dispatchMouseEvent', { type, x, y, ...extra });
	}

	async moveTo(x, y) {
		await this._mouse('mouseMoved', x, y);
	}

	async clickAt(x, y, { button = 'left', clickCount = 1, holdMs = 0 } = {}) {
		const buttons = button === 'right' ? 2 : button === 'middle' ? 4 : 1;
		await this._mouse('mouseMoved', x, y);
		for (let i = 1; i <= clickCount; i++) {
			await this._mouse('mousePressed', x, y, { button, buttons, clickCount: i });
			if (holdMs) await sleep(holdMs);
			await this._mouse('mouseReleased', x, y, { button, buttons: 0, clickCount: i });
		}
	}

	// Scrolls the first match into view and clicks its centre with a real mouse
	// event (so it counts as a user gesture). Returns the point clicked.
	async click(selector, options = {}) {
		const box = await this.eval((sel) => {
			const el = document.querySelector(sel);
			if (!el) return null;
			el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
			const r = el.getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
		}, selector);
		if (!box) throw new Error(`click: nothing matches "${selector}"`);
		if (!box.w || !box.h) throw new Error(`click: "${selector}" has no size (hidden?)`);
		await this.clickAt(box.x, box.y, options);
		return { x: box.x, y: box.y };
	}

	async drag(x1, y1, x2, y2, { steps = 12, button = 'left', holdMs = 0 } = {}) {
		const buttons = button === 'right' ? 2 : button === 'middle' ? 4 : 1;
		await this._mouse('mouseMoved', x1, y1);
		await this._mouse('mousePressed', x1, y1, { button, buttons, clickCount: 1 });
		if (holdMs) await sleep(holdMs);
		const n = Math.max(1, steps);
		for (let i = 1; i <= n; i++) {
			await this._mouse('mouseMoved', x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n, { button, buttons });
		}
		await this._mouse('mouseReleased', x2, y2, { button, buttons: 0, clickCount: 1 });
	}

	// Turns the mouse wheel at a point. Unlike the other mouse events, the
	// browser answers before the page has seen a wheel event, so this waits for
	// the event to arrive (at most half a second) before it returns.
	async wheel(x, y, deltaY, deltaX = 0) {
		await this.eval(() => {
			window.__qaWheel = new Promise((resolve) => {
				window.addEventListener('wheel', () => resolve(true), { once: true, capture: true, passive: true });
				setTimeout(() => resolve(false), 500);
			});
		});
		await this._mouse('mouseMoved', x, y);
		await this._mouse('mouseWheel', x, y, { deltaX, deltaY });
		await this.eval(() => {
			const seen = window.__qaWheel;
			delete window.__qaWheel;
			return seen;
		}).catch(() => {});
	}

	async tapAt(x, y) {
		await this._send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
		await this._send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	}

	// Presses one key: 'Escape', 'Enter', 'ArrowLeft', 'a', '?', ' ' ... A chord
	// is written with plus signs: 'Shift+Tab', 'Control+a'.
	async key(key) {
		let name = key;
		let modifiers = 0;
		if (key.length > 1 && key.includes('+')) {
			const parts = key.split('+');
			name = parts.pop() || '+';
			if (name === '+' && parts[parts.length - 1] === '') parts.pop();
			for (const m of parts) {
				if (!MODIFIER_BITS[m]) throw new Error(`key: unknown modifier "${m}" in "${key}"`);
				modifiers |= MODIFIER_BITS[m];
			}
		}
		const info = keyInfo(name);
		if (!info) {
			await this._send('Input.insertText', { text: name });
			return;
		}
		if (info.shift) modifiers |= 8;
		const sendsText = info.text && !(modifiers & 7);
		const base = { key: info.key, code: info.code, windowsVirtualKeyCode: info.keyCode, nativeVirtualKeyCode: info.keyCode, modifiers };
		await this._send('Input.dispatchKeyEvent', sendsText ? { type: 'keyDown', text: info.text, unmodifiedText: info.text, ...base } : { type: 'rawKeyDown', ...base });
		await this._send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
	}

	// Focuses the first match (pass null to keep the current focus) and types
	// the text key by key, so keydown, input and keyup all fire.
	async type(selector, text, { delayMs = 0 } = {}) {
		if (selector) {
			const ok = await this.eval((sel) => {
				const el = document.querySelector(sel);
				if (!el) return false;
				el.focus();
				return true;
			}, selector);
			if (!ok) throw new Error(`type: nothing matches "${selector}"`);
		}
		for (const ch of String(text)) {
			if (ch === '\n') await this.key('Enter');
			else if (ch === '\t') await this.key('Tab');
			else await this.key(ch);
			if (delayMs) await sleep(delayMs);
		}
	}

	// ---- viewport and capture --------------------------------------------------------

	async setViewport({ width = 1280, height = 800, deviceScaleFactor = 1, mobile = false } = {}) {
		await this._send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile, screenWidth: width, screenHeight: height });
		await this._send('Emulation.setTouchEmulationEnabled', { enabled: !!mobile, maxTouchPoints: mobile ? 5 : 1 }).catch(() => {});
		this.viewport = { width, height, deviceScaleFactor, mobile };
	}

	// Captures the viewport (or `clip`, or the whole page with fullPage) and
	// writes it to `file` when one is given. The format comes from the option or
	// the file extension. Returns the image as a Buffer.
	async screenshot(file, { format, quality, clip, fullPage = false } = {}) {
		const fmt = format || (/\.jpe?g$/i.test(file || '') ? 'jpeg' : 'png');
		const params = { format: fmt, fromSurface: true, captureBeyondViewport: false };
		if (fmt === 'jpeg') params.quality = quality ?? 82;
		if (fullPage) {
			const m = await this._send('Page.getLayoutMetrics');
			const size = m.cssContentSize || m.contentSize;
			params.clip = { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 };
			params.captureBeyondViewport = true;
		} else if (clip) {
			params.clip = { x: clip.x || 0, y: clip.y || 0, width: clip.width, height: clip.height, scale: clip.scale || 1 };
		}
		const res = await this._send('Page.captureScreenshot', params, 60000);
		const buffer = Buffer.from(res.data, 'base64');
		if (file) {
			fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
			fs.writeFileSync(file, buffer);
		}
		return buffer;
	}

	async close() {
		if (this.closed) return;
		this.closed = true;
		const b = this.browser;
		b._pages.delete(this);
		b._sessions.delete(this.sessionId);
		for (const child of this._children.keys()) b._sessions.delete(child);
		await b._conn.send('Target.closeTarget', { targetId: this.targetId }, '', 10000).catch(() => {});
		await b._conn.send('Target.disposeBrowserContext', { browserContextId: this.contextId }, '', 10000).catch(() => {});
	}
}

// ---- Browser --------------------------------------------------------------------

class Browser {
	constructor() {
		this.executable = '';
		this.version = '';
		this.profileDir = '';
		this.closed = false;
		this._slot = null;
		this._child = null;
		this._conn = null;
		this._pages = new Set();
		this._sessions = new Map(); // sessionId -> Page (page sessions and their children)
		this._closing = null;
	}

	get pid() {
		return this._child ? this._child.pid : 0;
	}

	// The pages that are open right now.
	get pages() {
		return [...this._pages];
	}

	// A new page in a fresh browser context (own cookies, storage and cache).
	//   width, height, deviceScaleFactor, mobile   the emulated viewport
	//   theme            'dark' | 'light' | null: seeds localStorage.theme and
	//                    sets prefers-color-scheme to match
	//   colorScheme      overrides prefers-color-scheme alone
	//   reducedMotion    prefers-reduced-motion: reduce
	//   storage          { key: value } seeded into localStorage before any page script
	//   blockHosts       extra hosts to block (requests fail as if offline)
	//   extraAllowedHosts  hosts that do not count as bad requests
	async newPage(options = {}) {
		if (this.closed) throw new Error('newPage: the browser is closed');
		const o = {
			width: 1280,
			height: 800,
			deviceScaleFactor: 1,
			mobile: false,
			theme: null,
			colorScheme: null,
			reducedMotion: false,
			blockHosts: [],
			storage: {},
			extraAllowedHosts: [],
			...options,
		};
		if (o.theme && o.theme !== 'dark' && o.theme !== 'light') throw new Error(`newPage: theme must be 'dark', 'light' or null, got "${o.theme}"`);
		const { browserContextId } = await this._conn.send('Target.createBrowserContext', { disposeOnDetach: true });
		const { targetId } = await this._conn.send('Target.createTarget', { url: 'about:blank', browserContextId, width: o.width, height: o.height, newWindow: true });
		const { sessionId } = await this._conn.send('Target.attachToTarget', { targetId, flatten: true });
		const page = new Page(this, { targetId, sessionId, browserContextId }, o);
		this._pages.add(page);
		this._sessions.set(sessionId, page);
		try {
			await page._init();
		} catch (e) {
			await page.close();
			throw e;
		}
		return page;
	}

	_onEvent(method, params, sessionId) {
		if (!sessionId) {
			if (method === 'Browser.downloadWillBegin' || method === 'Browser.downloadProgress') {
				let page = null;
				for (const p of this._pages) {
					if (p._mainFrame === params.frameId || p.downloads.some((d) => d.guid === params.guid)) page = p;
				}
				if (!page && this._pages.size === 1) page = [...this._pages][0];
				if (page) page._onDownload(method, params);
			}
			return;
		}
		const page = this._sessions.get(sessionId);
		if (page) page._onEvent(method, params, sessionId);
	}

	// Closes every page, quits the browser, deletes its profile and frees the
	// machine-wide slot. Safe to call twice; never throws.
	close() {
		if (!this._closing) this._closing = this._close();
		return this._closing;
	}

	async _close() {
		const child = this._child;
		if (child && child.exitCode === null && child.signalCode === null) {
			const exited = new Promise((resolve) => child.once('exit', resolve));
			if (this._conn && !this._conn.closed) this._conn.send('Browser.close', {}, '', 5000).catch(() => {});
			const timer = setTimeout(() => killTree(child), 5000);
			await exited;
			clearTimeout(timer);
		}
		this.closed = true;
		for (const p of this._pages) p.closed = true;
		this._pages.clear();
		this._sessions.clear();
		// If it stays locked, sweepStaleProfiles() of a later launch removes it.
		if (this.profileDir) await removeDir(this.profileDir);
		releaseSlot(this._slot);
		liveBrowsers.delete(this);
	}

	// Last-resort cleanup from process.on('exit') and the signal handlers.
	_destroySync() {
		liveBrowsers.delete(this);
		this.closed = true;
		killTree(this._child);
		if (this.profileDir) removeDirSync(this.profileDir);
		releaseSlot(this._slot);
	}
}

// Starts a headless browser. Waits for a free machine-wide slot first.
//   args   extra command-line switches for the browser
export async function launch({ args = [] } = {}) {
	const executable = findBrowser();
	hookExit();
	const browser = new Browser();
	browser.executable = executable;
	browser._slot = await acquireSlot();
	liveBrowsers.add(browser);
	try {
		sweepStaleProfiles();
		browser.profileDir = fs.mkdtempSync(path.join(LOCK_DIR, `profile-${process.pid}-`));
		const flags = [...(process.env.QA_HEADFUL ? [] : ['--headless=new']), ...FLAGS, `--user-data-dir=${browser.profileDir}`, ...args, 'about:blank'];
		const child = spawn(executable, flags, {
			stdio: ['ignore', 'ignore', process.env.QA_DEBUG ? 'inherit' : 'ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
		browser._child = child;
		const spawnFailed = new Promise((_, reject) => {
			child.once('error', (e) => reject(new Error(`could not start ${executable}: ${e.message}`)));
			child.once('exit', (code) => reject(new Error(`${executable} exited during startup (code ${code})`)));
		});
		spawnFailed.catch(() => {});
		if (!child.stdio || !child.stdio[3] || !child.stdio[4]) throw new Error(`could not start ${executable}: no debugging pipe`);
		const conn = new Connection(child);
		browser._conn = conn;
		conn.onEvent = (method, params, sessionId) => browser._onEvent(method, params, sessionId);
		const info = await Promise.race([conn.send('Browser.getVersion', {}, '', 30000), spawnFailed]);
		browser.version = info.product || '';
		return browser;
	} catch (e) {
		browser._destroySync();
		throw e;
	}
}

// Runs fn(browser) and always closes the browser afterwards.
export async function withBrowser(fn, options) {
	const browser = await launch(options);
	try {
		return await fn(browser);
	} finally {
		await browser.close();
	}
}
