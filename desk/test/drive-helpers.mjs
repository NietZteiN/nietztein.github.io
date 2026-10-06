// Helpers for scripts/qa/drive.mjs scripts that test the Desk in a real browser
// against desk/test/fake-github.mjs. Keep the drive scripts themselves in a
// scratch folder; this file only saves them the sign-in boilerplate.
//
//   import { startFakeGitHub, TOKENS } from '<repo>/desk/test/fake-github.mjs';
//   import { openDesk, signIn, lock, unlock, screen, storageDump, PASSPHRASE } from '<repo>/desk/test/drive-helpers.mjs';
//
//   export default async function (ctx) {
//   	const fake = await startFakeGitHub();
//   	try {
//   		const page = await openDesk(ctx, fake, { width: 390, height: 844, mobile: true, theme: 'dark' });
//   		await signIn(page);                     // the owner, repository desk-ready, PASSPHRASE
//   		await page.goto(page.deskUrl + '#/notes');
//   		...
//   	} finally {
//   		await fake.close();
//   	}
//   }
//
// Run:  node scripts/qa/drive.mjs <scratch>/my-check.mjs
// (An import of this file from a scratch folder needs its full file:// URL or
// absolute path.)

import { TOKENS } from './fake-github.mjs';

export const PASSPHRASE = 'correct horse battery staple';

// Opens the Desk pointed at the fake GitHub. -> page, with page.deskUrl (no hash).
//   pageOptions: anything browser.newPage takes (width, height, mobile, theme, reducedMotion ...)
//   extra: { goat: 'http://127.0.0.1:<port>' , route: 'notes' }
export async function openDesk(ctx, fake, pageOptions = {}, extra = {}) {
	const page = await ctx.newPage({ width: 1280, height: 800, theme: 'dark', ...pageOptions, extraAllowedHosts: ['127.0.0.1', 'localhost', ...(pageOptions.extraAllowedHosts || [])] });
	let url = `${ctx.baseUrl}desk/?api=${encodeURIComponent(fake.url)}`;
	if (extra.goat) url += `&goat=${encodeURIComponent(extra.goat)}`;
	page.deskUrl = url;
	await page.goto(url + (extra.route ? '#/' + extra.route : ''));
	return page;
}

export function screen(page) {
	return page.eval(() => window.Desk.screen());
}

// Sets an input's value the way typing would leave it (one input event), fast.
export async function fill(page, selector, value) {
	const ok = await page.eval(
		(sel, v) => {
			const el = document.querySelector(sel);
			if (!el) return false;
			el.focus();
			el.value = v;
			el.dispatchEvent(new Event('input', { bubbles: true }));
			el.dispatchEvent(new Event('change', { bubbles: true }));
			return true;
		},
		selector,
		value
	);
	if (!ok) throw new Error(`fill: nothing matches "${selector}"`);
}

// Goes through the wizard's last step and waits until the Desk is open.
// The page must be showing the wizard (a fresh context does).
//   repo: 'desk-ready' (set up already; the default), 'desk' (empty), ...
export async function signIn(page, { token = TOKENS.full, repo = 'desk-ready', passphrase = PASSPHRASE } = {}) {
	if ((await screen(page)) !== 'wizard') throw new Error(`signIn: the Desk is showing "${await screen(page)}", not the wizard`);
	await page.eval((r) => sessionStorage.setItem('desk.wizard', JSON.stringify({ step: 4, repo: r })), repo);
	await page.reload();
	await fill(page, '#wizard-token', token);
	await fill(page, '#wizard-pass', passphrase);
	await fill(page, '#wizard-pass2', passphrase);
	await page.click('#wizard-finish');
	try {
		await page.waitFor(() => window.Desk.screen() === 'open', { timeoutMs: 20000 });
	} catch (e) {
		const why = await page.eval(() => [...document.querySelectorAll('#checks li[data-state="fail"], #wizard-error')].map((n) => n.textContent.trim()).join(' | '));
		throw new Error(`signIn: the wizard did not finish: ${why || e.message}`);
	}
	await page.waitNetworkIdle({ idleMs: 400, timeoutMs: 8000 });
}

export async function lock(page) {
	await page.click('#desk-lock');
	await page.waitFor(() => window.Desk.screen() === 'locked');
}

export async function unlock(page, passphrase = PASSPHRASE) {
	await fill(page, '#lock-pass', passphrase);
	await page.click('#lock-submit');
	await page.waitFor(() => window.Desk.screen() === 'open', { timeoutMs: 15000 });
	await page.waitNetworkIdle({ idleMs: 400, timeoutMs: 8000 });
}

// Everything the page has stored in this browser, for "the token is nowhere" checks:
// { local, session, cookie, idb: [{ db, store, rows }] }
export function storageDump(page) {
	return page.eval(async () => {
		const out = { local: {}, session: {}, cookie: document.cookie, idb: [] };
		for (let i = 0; i < localStorage.length; i++) out.local[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
		for (let i = 0; i < sessionStorage.length; i++) out.session[sessionStorage.key(i)] = sessionStorage.getItem(sessionStorage.key(i));
		const dbs = indexedDB.databases ? await indexedDB.databases() : [];
		for (const info of dbs) {
			const db = await new Promise((resolve, reject) => {
				const r = indexedDB.open(info.name);
				r.onsuccess = () => resolve(r.result);
				r.onerror = () => reject(r.error);
			});
			for (const name of db.objectStoreNames) {
				const rows = await new Promise((resolve, reject) => {
					const r = db.transaction(name).objectStore(name).getAll();
					r.onsuccess = () => resolve(r.result);
					r.onerror = () => reject(r.error);
				});
				out.idb.push({ db: info.name, store: name, rows });
			}
			db.close();
		}
		return out;
	});
}

// Registers a do-nothing view that hands its api to the test: after this,
// page.eval(() => window.__api.gh.read('private', 'README.md')) and so on.
export async function stubView(page, id = 'stub') {
	await page.eval((viewId) => {
		window.Desk.registerView({
			id: viewId,
			title: 'Stub',
			icon: 'dot',
			order: 99,
			mount(el, api) {
				window.__api = api;
				window.__stubEl = el;
				el.textContent = 'stub view';
			},
			unmount() {
				window.__unmounted = (window.__unmounted || 0) + 1;
			},
		});
		location.hash = '#/' + viewId;
	}, id);
	await page.waitFor(() => !!window.__api && !!window.__stubEl && window.__stubEl.isConnected);
}
