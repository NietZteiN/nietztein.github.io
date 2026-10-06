// Tests for desk/store.js: the encrypted local store on an in-memory backend,
// and the offline queue against desk/test/fake-github.mjs.
// Run with: node desk/test/test-store.mjs
// (The IndexedDB backend itself needs a browser; the drive script covers it.)

import { createRequire } from 'node:module';
import { startFakeGitHub, TOKENS, SITE } from './fake-github.mjs';

const require = createRequire(import.meta.url);
const Vault = require('../vault.js');
const Store = require('../store.js');
const GH = require('../gh.js');
const E = GH.errors;

let failed = 0;
let count = 0;
function check(name, ok, detail = '') {
	count++;
	if (!ok) failed++;
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ' : ' + detail : ''}`);
}
async function rejects(promise) {
	try {
		await promise;
		return null;
	} catch (e) {
		return e;
	}
}

const session = { token: TOKENS.full, login: 'NietZteiN' };
const { keys } = await Vault.newRecord('correct horse battery staple', session);
const other = await Vault.newRecord('a different passphrase!', session);

// ---- the key-value store ------------------------------------------------------
const backend = Store.memoryBackend();
const store = Store.create({ backend, Vault, keys });

await store.put('notes-view', 'last-opened', { path: 'notes/secret-plan.md', scroll: 120 });
await store.put('notes-view', 'filter', 'inbox');
await store.put('reading', '2026', ['a', 'b']);
check('get: an object comes back', (await store.get('notes-view', 'last-opened')).path === 'notes/secret-plan.md');
check('get: a string, an array', (await store.get('notes-view', 'filter')) === 'inbox' && (await store.get('reading', '2026')).length === 2);
check('get: missing is null, or the fallback', (await store.get('notes-view', 'nope')) === null && (await store.get('notes-view', 'nope', 7)) === 7);
check('keys: per space, sorted', (await store.keys('notes-view')).join(',') === 'filter,last-opened' && (await store.keys('reading')).join(',') === '2026' && (await store.keys('empty')).length === 0);
const raw = JSON.stringify([...backend.records.values()]);
check('at rest: no key name and no value is readable', !raw.includes('last-opened') && !raw.includes('secret-plan') && !raw.includes('inbox') && !raw.includes('scroll'));
check('at rest: ids are keyed fingerprints, values are sealed boxes', [...backend.records.values()].every((r) => /^[0-9a-f]{64}$/.test(r.id) && r.box && r.box.iv && r.box.ct && Object.keys(r).sort().join(',') === 'box,id,space'));
await store.put('notes-view', 'filter', 'all');
check('put: replaces, does not add', (await store.get('notes-view', 'filter')) === 'all' && backend.records.size === 3);
await store.del('notes-view', 'filter');
check('del: gone', (await store.get('notes-view', 'filter')) === null && (await store.keys('notes-view')).join(',') === 'last-opened');

const stranger = Store.create({ backend, Vault, keys: other.keys });
check('other keys: cannot read a value', (await stranger.get('notes-view', 'last-opened')) === null);
// A record moved to another space does not open (the space is bound into the seal).
const moved = [...backend.records.values()].find((r) => r.space === 'reading');
backend.records.set('x'.repeat(64), { id: 'x'.repeat(64), space: 'notes-view', box: moved.box });
check('a sealed value moved to another space is dropped, not read', (await store.keys('notes-view')).join(',') === 'last-opened' && !backend.records.has('x'.repeat(64)));
check('bad arguments are refused', (await rejects(store.get('', 'k'))) !== null && (await rejects(store.put('s', '', 1))) !== null);
await store.clear('notes-view');
check('clear: one space only', (await store.keys('notes-view')).length === 0 && (await store.keys('reading')).length === 1);
await store.wipe();
check('wipe: everything', backend.records.size === 0);

// ---- reading and writing the private repository ------------------------------
const fake = await startFakeGitHub();
const repo = fake.repo('NietZteiN/desk-ready');
const changes = [];
const client = GH.create({ apiBase: fake.url, token: () => TOKENS.full, site: SITE, priv: { owner: 'NietZteiN', repo: 'desk-ready', branch: 'main' } }).client;
const sync = Store.createSync({ store, gh: client, onChange: (s) => changes.push(s) });
const NOTE = 'notes/inbox/20261001T101500Z-aa.md';

const first = await sync.read(NOTE);
check('read: from GitHub', first.text === repo.text(NOTE) && first.sha === repo.sha(NOTE) && first.cached === false && first.pending === false);
check('read: a missing file is null', (await sync.read('notes/none.md')) === null);
fake.setDown(true);
const offline = await sync.read(NOTE);
check('read offline: the copy kept on the device', offline.text === first.text && offline.cached === true);
check('read offline: nothing cached is an Offline error', (await rejects(sync.read('README.md'))) instanceof E.Offline);
check('state: offline is noticed', sync.state().offline === true);
check('list offline: nothing cached is an Offline error', (await rejects(sync.list('notes/inbox'))) instanceof E.Offline);
fake.setDown(false);
check('read with prefer: cache does not ask GitHub', await (async () => { const n = fake.requests.length; const r = await sync.read(NOTE, { prefer: 'cache' }); return r.cached === true && fake.requests.length === n; })());
const listing = await sync.list('notes/inbox');
check('list: the folder', listing.length === 1 && listing[0].path === NOTE && listing.cached === false);

// Saving with the network up.
const s1 = await sync.save('notes/a.md', 'one\n', { message: 'Add a' });
check('save online: written at once', s1.state === 'saved' && repo.text('notes/a.md') === 'one\n' && s1.sha === repo.sha('notes/a.md') && (await sync.pending()).length === 0);
const s2 = await sync.save('notes/a.md', 'two\n');
check('save online again: the remembered sha is used', s2.state === 'saved' && repo.text('notes/a.md') === 'two\n');
check('state: a time of the last save', typeof sync.state().lastSaved === 'number');

// Saving with the network down.
fake.setDown(true);
const q1 = await sync.save('notes/a.md', 'three (offline)\n');
const q2 = await sync.save('notes/inbox/new.md', 'captured offline\n', { message: 'Capture' });
check('save offline: queued, not lost', q1.state === 'queued' && q2.state === 'queued' && repo.text('notes/a.md') === 'two\n');
check('pending: both, oldest first', (await sync.pending()).map((p) => p.path).join(',') === 'notes/a.md,notes/inbox/new.md');
const mine = await sync.read('notes/a.md');
check('read: your queued version wins over the cached one', mine.text === 'three (offline)\n' && mine.pending === true);
await sync.save('notes/a.md', 'four (offline)\n');
check('save offline twice: one queue entry per file, the newest text', (await sync.pending()).length === 2 && (await sync.read('notes/a.md')).text === 'four (offline)\n');
const rawQueue = JSON.stringify([...backend.records.values()]);
check('at rest: the queued text is sealed', !rawQueue.includes('captured offline') && !rawQueue.includes('four (offline)') && !rawQueue.includes('notes/inbox/new.md'));
check('state: pending is counted', sync.state().pending === 2 && changes[changes.length - 1].pending === 2);
const stuck = await sync.flush();
check('flush offline: nothing sent, nothing lost', stuck.sent === 0 && stuck.left === 2);
fake.setDown(false);
const offlineList = await sync.list('notes/inbox');
check('list: a queued new file shows up as pending', offlineList.length === 2 && offlineList.find((e) => e.name === 'new.md').pending === true);
const flushed = await sync.flush();
check('flush online: both sent', flushed.sent === 2 && flushed.left === 0 && repo.text('notes/a.md') === 'four (offline)\n' && repo.text('notes/inbox/new.md') === 'captured offline\n');
check('flush: the commit message given at save time is used', repo.log().some((c) => c.message === 'Capture'));
check('state: back to nothing pending, online', sync.state().pending === 0 && sync.state().offline === false);

// A deletion queued offline.
fake.setDown(true);
const d1 = await sync.remove('notes/inbox/new.md');
check('remove offline: queued; read and list already say it is gone', d1.state === 'queued' && (await sync.read('notes/inbox/new.md')) === null && repo.text('notes/inbox/new.md') !== null);
fake.setDown(false);
check('list: a queued deletion is hidden', (await sync.list('notes/inbox')).length === 1);
await sync.flush();
check('flush: the deletion happened', repo.text('notes/inbox/new.md') === null && (await sync.pending()).length === 0);
const d2 = await sync.remove('notes/never-existed.md');
check('remove: a file that never existed is simply done', d2.state === 'saved');

// A conflict: the file changed on GitHub (another device) since it was read.
await sync.read('notes/a.md');
repo.put('notes/a.md', 'changed on the phone\n');
const conflict = await rejects(sync.save('notes/a.md', 'changed on the laptop\n'));
check('conflict: save rejects with Conflict; GitHub is not overwritten', conflict instanceof E.Conflict && repo.text('notes/a.md') === 'changed on the phone\n');
const afterConflict = await sync.pending();
check('conflict: your version is kept, flagged', afterConflict.length === 1 && afterConflict[0].conflict === true && (await sync.read('notes/a.md')).text === 'changed on the laptop\n' && sync.state().conflicts === 1);
check('conflict: flush leaves it alone', (await sync.flush()).sent === 0 && repo.text('notes/a.md') === 'changed on the phone\n');
const won = await sync.resolve('notes/a.md', 'mine');
check('resolve mine: your version replaces theirs', won.state === 'saved' && repo.text('notes/a.md') === 'changed on the laptop\n' && (await sync.pending()).length === 0);
repo.put('notes/a.md', 'theirs again\n');
await rejects(sync.save('notes/a.md', 'mine again\n'));
const lost = await sync.resolve('notes/a.md', 'theirs');
check('resolve theirs: your version is dropped', lost.state === 'dropped' && repo.text('notes/a.md') === 'theirs again\n' && (await sync.pending()).length === 0 && (await sync.read('notes/a.md')).text === 'theirs again\n');
// After "Keep GitHub's", the next save builds on GitHub's version (no read in between).
repo.put('notes/a.md', 'theirs a third time\n');
await rejects(sync.save('notes/a.md', 'mine a third time\n'));
await sync.resolve('notes/a.md', 'theirs');
const next = await sync.save('notes/a.md', 'theirs a third time, then edited\n').catch((e) => e);
check('resolve theirs: the next save is not a conflict', next && next.state === 'saved' && repo.text('notes/a.md') === 'theirs a third time, then edited\n' && (await sync.pending()).length === 0 && sync.state().conflicts === 0, String(next && (next.name || next.state)));

// A write whose answer was lost: GitHub has it, the device thinks it failed.
await sync.read('notes/a.md');
const staleSha = repo.sha('notes/a.md');
repo.put('notes/a.md', 'sent twice\n');
const twice = await sync.save('notes/a.md', 'sent twice\n', { sha: staleSha });
check('a conflict with identical text is not a conflict', twice.state === 'saved' && (await sync.pending()).length === 0);

// A token that may not write: the error is shown, the text is not lost.
const roClient = GH.create({ apiBase: fake.url, token: () => TOKENS.readonly, site: SITE, priv: { owner: 'NietZteiN', repo: 'desk-ready', branch: 'main' } }).client;
const roStore = Store.create({ backend: Store.memoryBackend(), Vault, keys });
const roSync = Store.createSync({ store: roStore, gh: roClient });
const denied = await rejects(roSync.save('notes/x.md', 'kept\n'));
const kept = await roSync.pending();
check('read-only token: save rejects with Forbidden and the text stays queued', denied instanceof E.Forbidden && kept.length === 1 && /Contents/.test(kept[0].error) && (await roSync.read('notes/x.md')).text === 'kept\n');

// Rate limited: waits like offline.
fake.setRate(0);
const limited = await sync.save('notes/rate.md', 'later\n');
fake.setRate(4000);
check('rate limited: queued, then sent', limited.state === 'queued' && (await sync.flush()).sent === 1 && repo.text('notes/rate.md') === 'later\n');

// Many saves at once are sent one after the other, none twice.
const before = repo.log().length;
await Promise.all([1, 2, 3, 4, 5].map((i) => sync.save(`notes/many-${i}.md`, `n${i}\n`)));
check('five saves at once: five commits, all there', repo.log().length === before + 5 && [1, 2, 3, 4, 5].every((i) => repo.text(`notes/many-${i}.md`) === `n${i}\n`));
check('the site repository was never written by the queue', fake.requests.every((r) => r.method === 'GET' || !r.path.toLowerCase().includes('nietztein.github.io')));

await fake.close();
console.log(`${count - failed} of ${count} passed`);
process.exit(failed ? 1 : 0);
