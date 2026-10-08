// Tests for desk/musicsync.js (the Music sync view's engine): True Shuffle's
// database read without being created, Push to the private repository with
// sha concurrency, Pull into the inbox, and bundles refused for their format.
// Run with: node desk/test/test-music.mjs
// Uses desk/gh.js against desk/test/fake-github.mjs and a small in-memory fake
// of the IndexedDB calls the engine makes. No network beyond 127.0.0.1.

import { createRequire } from 'node:module';
import { startFakeGitHub, TOKENS, SITE } from './fake-github.mjs';

const require = createRequire(import.meta.url);
const GH = require('../gh.js');
const S = require('../musicsync.js');

let failed = 0;
let count = 0;
function check(name, ok, detail = '') {
	count++;
	if (!ok) failed++;
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ' : ' + detail : ''}`);
}
async function rejects(promise) {
	try {
		return { resolved: true, value: await promise };
	} catch (e) {
		return e;
	}
}

// ---- a fake IndexedDB: open (with and without a version), objectStoreNames,
// transaction on one store, get and put, abort, close, deleteDatabase never.
function fakeIDB() {
	const dbs = new Map(); // name -> { version, stores: Map(name -> Map(key -> value)) }
	const log = [];
	const later = (fn) => setTimeout(fn, 0);
	const clone = (v) => (v === undefined ? undefined : structuredClone(v));
	function connection(name, rec) {
		let closed = false;
		return {
			name,
			get version() {
				return rec.version;
			},
			objectStoreNames: { contains: (n) => rec.stores.has(n), get length() { return rec.stores.size; } },
			createObjectStore(n) {
				rec.stores.set(n, new Map());
			},
			close() {
				closed = true;
				log.push('close');
			},
			get closed() {
				return closed;
			},
			transaction(storeName, mode) {
				if (closed) throw new Error('InvalidStateError: the connection is closed');
				if (!rec.stores.has(storeName)) throw new Error('NotFoundError');
				const staged = new Map(rec.stores.get(storeName));
				let aborted = false;
				const t = {
					error: null,
					abort() {
						aborted = true;
						later(() => t.onabort && t.onabort());
					},
					objectStore() {
						return {
							get(key) {
								const r = { result: undefined };
								later(() => {
									r.result = clone(staged.get(key));
									r.onsuccess && r.onsuccess();
								});
								return r;
							},
							put(value) {
								if (mode !== 'readwrite') throw new Error('ReadOnlyError');
								staged.set(value.key, clone(value));
								return {};
							},
						};
					},
				};
				later(() =>
					later(() => {
						if (aborted) return;
						if (mode === 'readwrite') rec.stores.set(storeName, staged);
						t.oncomplete && t.oncomplete();
					})
				);
				log.push('tx ' + storeName + ' ' + mode);
				return t;
			},
		};
	}
	return {
		dbs,
		log,
		// What True Shuffle's own open() would leave behind.
		seed(name, kv) {
			const stores = new Map([['tracks', new Map()], ['playlists', new Map()], ['kv', new Map()], ['history', new Map()]]);
			for (const [k, v] of Object.entries(kv || {})) stores.get('kv').set(k, { key: k, value: clone(v) });
			dbs.set(name, { version: 1, stores });
		},
		kv(name, key) {
			const r = dbs.get(name) && dbs.get(name).stores.get('kv').get(key);
			return r ? clone(r.value) : undefined;
		},
		open(name, version) {
			log.push('open ' + name + (version === undefined ? '' : ' v' + version));
			const req = { result: null, error: null, transaction: null };
			later(() => {
				const have = dbs.get(name);
				const want = version === undefined ? (have ? have.version : 1) : version;
				if (have && want === have.version) {
					req.result = connection(name, have);
					req.onsuccess && req.onsuccess({ target: req });
					return;
				}
				// An upgrade: from 0 when the database does not exist.
				const rec = { version: want, stores: have ? new Map(have.stores) : new Map() };
				const oldVersion = have ? have.version : 0;
				let aborted = false;
				req.result = connection(name, rec);
				req.transaction = {
					abort() {
						aborted = true;
						log.push('abort upgrade');
					},
				};
				req.onupgradeneeded && req.onupgradeneeded({ oldVersion, newVersion: want, target: req });
				if (aborted) {
					req.result = undefined;
					req.error = new Error('AbortError');
					req.onerror && req.onerror({ target: req, preventDefault() {} });
					return;
				}
				dbs.set(name, rec);
				req.onsuccess && req.onsuccess({ target: req });
			});
			return req;
		},
		deleteDatabase(name) {
			log.push('delete ' + name);
			dbs.delete(name);
			return {};
		},
	};
}

function bundle(over = {}) {
	return {
		format: 'true-shuffle-sync',
		version: 1,
		savedAt: '2026-10-07T10:00:00.000Z',
		labels: { tracks: { a: ['calm'], b: ['loud'], c: [] }, names: { calm: 'Calm' } },
		state: { tracks: { a: { rating: 4, ratedAt: 1 }, b: { plays: 3 } } },
		stations: [{ id: 's1', name: 'Morning' }],
		history: [{ id: 'a', at: 1 }, { id: 'b', at: 2 }, { id: 'a', at: 3 }, { id: 'c', at: 4 }],
		extra: { kept: true },
		...over,
	};
}

const fake = await startFakeGitHub();
const PRIV = 'NietZteiN/desk-ready';
const repo = () => fake.repo(PRIV);
const made = GH.create({ apiBase: fake.url, token: () => TOKENS.full, site: SITE, priv: { owner: 'NietZteiN', repo: 'desk-ready', branch: 'main' } });
const gh = made.client;
const siteWrites = () => fake.requests.filter((r) => r.method !== 'GET' && r.path.toLowerCase().includes('/nietztein.github.io/')).length;

try {
	// ---- the keys and the path ----------------------------------------------
	check('constants: kv keys, database and repository path', S.OUTBOX === 'sync:outbox' && S.INBOX === 'sync:inbox' && S.DB_NAME === 'true-shuffle' && S.PATH === 'music/true-shuffle-sync.json');

	// ---- a missing database -------------------------------------------------
	const idb0 = fakeIDB();
	const missing = await S.readLocal(idb0);
	check('missing database: reported as not opened yet', missing.state === 'missing');
	check('missing database: opened without a version number', idb0.log[0] === 'open true-shuffle');
	check('missing database: the upgrade is aborted and nothing is created or deleted', idb0.log.includes('abort upgrade') && !idb0.dbs.has('true-shuffle') && !idb0.log.some((l) => l.startsWith('delete')));
	const pullMissing = await rejects(S.pull(gh, idb0));
	check('missing database: Pull refuses with plain words and creates nothing', pullMissing instanceof Error && pullMissing.notOpened === true && /not been opened in this browser yet/.test(pullMissing.message) && !idb0.dbs.has('true-shuffle'));
	check('missing database: writeInbox refuses too', (await rejects(S.writeInbox(idb0, bundle()))).notOpened === true && !idb0.dbs.has('true-shuffle'));
	check('no IndexedDB at all: a plain error', /no IndexedDB/.test((await rejects(S.readLocal(null))).message));

	// ---- opened, but no outbox ----------------------------------------------
	const idb1 = fakeIDB();
	idb1.seed('true-shuffle', {});
	check('no outbox yet: "empty"', (await S.readLocal(idb1)).state === 'empty');
	const idbOdd = fakeIDB();
	idbOdd.dbs.set('true-shuffle', { version: 3, stores: new Map([['other', new Map()]]) });
	check('a database without a kv store: treated as not opened, left as it is', (await S.readLocal(idbOdd)).state === 'missing' && idbOdd.dbs.get('true-shuffle').version === 3);

	// ---- the outbox ----------------------------------------------------------
	const idb = fakeIDB();
	idb.seed('true-shuffle', { 'sync:outbox': bundle() });
	const local = await S.readLocal(idb);
	check('outbox: read and counted', local.state === 'ok' && local.inbox === false && JSON.stringify(local.summary) === JSON.stringify({ savedAt: '2026-10-07T10:00:00.000Z', labelled: 3, withState: 2, stations: 1, history: 4 }), JSON.stringify(local.summary));
	check('outbox: every connection is closed again', idb.log.filter((l) => l.startsWith('open')).length === idb.log.filter((l) => l === 'close').length);

	// ---- nothing pushed yet -------------------------------------------------
	check('repository: nothing pushed yet is null', (await S.readRemote(gh)) === null);
	check('Pull with nothing in the repository: refused', /nothing in the repository/.test((await rejects(S.pull(gh, idb))).message) && idb.kv('true-shuffle', 'sync:inbox') === undefined);

	// ---- push ----------------------------------------------------------------
	const n0 = siteWrites();
	const w1 = await S.push(gh, local.bundle, null);
	const onDisk = JSON.parse(repo().text(S.PATH));
	check('push: creates the file in the private repository', JSON.stringify(onDisk) === JSON.stringify(bundle()) && w1.sha === repo().sha(S.PATH));
	check('push: unknown fields are carried as they are', onDisk.extra && onDisk.extra.kept === true);
	check('push: the commit message names the date', /Sync True Shuffle \(saved 2026-10-07T10:00:00.000Z\)/.test(repo().log()[0].message));
	const remote1 = await S.readRemote(gh);
	check('repository: read back with counts and sha', remote1.sha === w1.sha && remote1.summary.history === 4 && remote1.summary.labelled === 3);

	const newer = bundle({ savedAt: '2026-10-08T09:00:00.000Z', stations: [{ id: 's1' }, { id: 's2' }] });
	await S.push(gh, newer, remote1.sha);
	check('push: an update with the sha read before', JSON.parse(repo().text(S.PATH)).stations.length === 2);
	check('compare: savedAt order', S.compare(newer.savedAt, bundle().savedAt) === 1 && S.compare(bundle().savedAt, newer.savedAt) === -1 && S.compare(newer.savedAt, newer.savedAt) === 0);

	// ---- a sha conflict --------------------------------------------------------
	const seen = await S.readRemote(gh);
	repo().put(S.PATH, S.serialize(bundle({ savedAt: '2026-10-08T12:00:00.000Z' })), 'Pushed from another device');
	const before = repo().text(S.PATH);
	const conflict = await rejects(S.push(gh, newer, seen.sha));
	check('conflict: a stale sha is refused with Conflict', conflict instanceof GH.errors.Conflict, conflict && conflict.message);
	check('conflict: nothing was overwritten', repo().text(S.PATH) === before);
	const conflict2 = await rejects(S.push(gh, newer, null));
	check('conflict: no sha while a file exists is refused too', conflict2 instanceof GH.errors.Conflict && repo().text(S.PATH) === before);

	// ---- pull into the inbox ----------------------------------------------------
	const pulled = await S.pull(gh, idb);
	const inbox = idb.kv('true-shuffle', 'sync:inbox');
	check('pull: the repository copy is in the inbox', inbox && inbox.savedAt === '2026-10-08T12:00:00.000Z' && inbox.format === 'true-shuffle-sync' && pulled.summary.savedAt === inbox.savedAt);
	check('pull: the outbox is untouched', idb.kv('true-shuffle', 'sync:outbox').savedAt === '2026-10-07T10:00:00.000Z');
	check('pull: readLocal now sees the inbox', (await S.readLocal(idb)).inbox === true);
	check('pull: opened without a version every time, nothing deleted', idb.log.filter((l) => l.startsWith('open')).every((l) => l === 'open true-shuffle') && !idb.log.some((l) => l.startsWith('delete') || l === 'abort upgrade'));

	// ---- bad formats --------------------------------------------------------------
	const bads = [
		['wrong format', bundle({ format: 'true-shuffle-export' })],
		['newer version', bundle({ version: 2 })],
		['no version', bundle({ version: '1' })],
		['bad date', bundle({ savedAt: 'yesterday' })],
		['labels a list', bundle({ labels: [] })],
		['state missing', bundle({ state: null })],
		['stations not a list', bundle({ stations: {} })],
		['history not a list', bundle({ history: 'x' })],
		['not an object', [bundle()]],
	];
	for (const [name, b] of bads) check('check refuses: ' + name, (() => { try { S.check(b); return false; } catch (e) { return e instanceof Error && e.message.length > 0; } })());
	check('check: a newer version says so', /newer True Shuffle/.test((() => { try { S.check(bundle({ version: 2 })); } catch (e) { return e.message; } })()));

	const pushBad = await rejects(Promise.resolve().then(() => S.push(gh, bundle({ format: 'nope' }), null)));
	check('push: a bad bundle is refused before any request', pushBad instanceof Error && !(pushBad instanceof GH.errors.GitHubError) && repo().text(S.PATH) === before);

	const idbBadOut = fakeIDB();
	idbBadOut.seed('true-shuffle', { 'sync:outbox': { format: 'something-else', version: 1 } });
	const badLocal = await S.readLocal(idbBadOut);
	check('outbox in a bad format: "bad", with a message', badLocal.state === 'bad' && /not a True Shuffle sync bundle/.test(badLocal.error.message));

	repo().put(S.PATH, JSON.stringify({ format: 'true-shuffle-export', version: 1 }), 'An export by mistake');
	const idb2 = fakeIDB();
	idb2.seed('true-shuffle', {});
	const badRemote = await S.readRemote(gh);
	check('repository file in a bad format: an error, with its sha', badRemote && badRemote.error instanceof Error && typeof badRemote.sha === 'string');
	const pullBad = await rejects(S.pull(gh, idb2));
	check('pull: a bad format is refused and the inbox stays empty', pullBad instanceof Error && /not a True Shuffle sync bundle/.test(pullBad.message) && idb2.kv('true-shuffle', 'sync:inbox') === undefined);
	repo().put(S.PATH, '{ not json', 'Broken');
	const pullBroken = await rejects(S.pull(gh, idb2));
	check('pull: bad JSON is refused', /not valid JSON/.test(pullBroken.message) && idb2.kv('true-shuffle', 'sync:inbox') === undefined);

	// ---- the public repository is never touched ------------------------------------
	check('the public repository saw no write', siteWrites() === n0);
} finally {
	await fake.close();
}

console.log(`\n${count - failed}/${count} passed`);
if (failed) process.exit(1);
