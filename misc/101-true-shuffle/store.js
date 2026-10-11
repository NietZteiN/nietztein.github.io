/*
 * True Shuffle: where the listener's data lives. It lives in this browser
 * (IndexedDB) and nowhere else; nothing here talks to a network.
 *
 *     TrueShuffle.store.open().then(function (store) { ... })
 *
 * Four object stores hold the listener's data: tracks and playlists (one
 * record each, keyed by id), kv (small named records: the library's aliases
 * and rules, the bags, the queue, the listening plan, the quota tally, import
 * progress), and history (one record per listen). A fifth, cache (since
 * database version 2), keeps other sites' answers for a while (sources.js):
 * rows { key, value, exp, at, size } that expire, are never exported, and go
 * with wipe(). The same interface is offered by an in-memory twin
 * (TrueShuffle.store.memory()), which the tests use, which the demo uses, and
 * which open() falls back to where IndexedDB is refused (some private
 * windows): then store.kind is 'memory' and store.fallback is true, and the
 * page should say that nothing will be remembered.
 *
 * Every method returns a Promise. Records are copied on the way in and on the
 * way out, in the twin as in IndexedDB, so a caller can never change stored
 * data by changing an object it holds.
 *
 * UMD: window.TrueShuffle.store in the browser, module.exports in Node.
 */
(function (root, factory) {
	var api = factory(root);
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.store = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
	'use strict';

	var DB_NAME = 'true-shuffle';
	var DB_VERSION = 2;             // 1: the four data stores; 2: and the cache
	var FORMAT = 'true-shuffle-export';
	var FORMAT_VERSION = 1;
	var KEYS = { tracks: 'id', playlists: 'id', kv: 'key', history: 'n', cache: 'key' };
	var NAMES = ['tracks', 'playlists', 'kv', 'history'];   // the listener's data: exported and imported
	var STORES = NAMES.concat(['cache']);                    // every object store: wiped and destroyed
	var MAX_IMPORT = 200000;        // records of one kind in an imported file
	var PUT_CHUNK = 400;            // tracks per transaction in putTracks
	var CACHE_ROWS = 5000;          // cacheSweep's limits, by default
	var CACHE_BYTES = 12e6;
	// The upper end of a key range that holds every string starting with a prefix.
	var HIGH = String.fromCharCode(0xFFFF);

	function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
	function fail(message, detail) { var e = new Error(message); if (detail) e.detail = String(detail); return e; }
	function startsWith(key, prefix) { return String(key).indexOf(prefix) === 0; }
	// The approximate size of a cache row: its key and its value as JSON.
	function sizeOf(key, value) { return String(key).length + (JSON.stringify(value === undefined ? null : value) || '').length; }
	function rowOut(r, full) { return full ? { value: r.value, exp: r.exp, at: r.at } : r.value; }
	// What cacheSweep removes: expired rows first, then the rows nearest to
	// expiry until both limits hold. metas: [{ key, exp, size }], soonest first.
	function sweepPlan(metas, now, maxRows, maxBytes) {
		var rows = metas.length, bytes = 0, expired = 0, evicted = 0, drop = [];
		metas.forEach(function (m) { bytes += m.size; });
		metas.forEach(function (m) {
			if (m.exp <= now) { drop.push(m.key); expired++; rows--; bytes -= m.size; }
			else if (rows > maxRows || bytes > maxBytes) { drop.push(m.key); evicted++; rows--; bytes -= m.size; }
		});
		return { drop: drop, result: { expired: expired, evicted: evicted, rows: rows, bytes: bytes } };
	}
	function soonestFirst(a, b) { return a.exp - b.exp || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0); }

	// ---- The in-memory backend -----------------------------------------------------

	function memoryBackend() {
		var data = { tracks: new Map(), playlists: new Map(), kv: new Map(), history: new Map(), cache: new Map() }, auto = 0, closed = false;
		function guard() { if (closed) throw fail('The store is closed.'); }
		function run(fn) { return new Promise(function (resolve, reject) { try { guard(); resolve(fn()); } catch (e) { reject(e); } }); }
		return {
			kind: 'memory',
			all: function (name) { return run(function () { return Array.from(data[name].values()).map(clone); }); },
			get: function (name, key) { return run(function () { return clone(data[name].get(key)); }); },
			put: function (name, values) {
				return run(function () {
					values.forEach(function (v) {
						v = clone(v);
						if (name === 'history' && v.n == null) v.n = ++auto;
						if (name === 'history' && v.n > auto) auto = v.n;
						var key = v[KEYS[name]];
						if (key == null || key === '') throw fail('A record without a key cannot be stored.');
						data[name].set(key, v);
					});
					return values.length;
				});
			},
			del: function (name, keys) { return run(function () { keys.forEach(function (k) { data[name].delete(k); }); }); },
			clear: function (name) { return run(function () { data[name].clear(); }); },
			count: function (name) { return run(function () { return data[name].size; }); },
			destroy: function () { return run(function () { STORES.forEach(function (n) { data[n].clear(); }); closed = true; }); },
			close: function () { closed = true; },

			// the cache
			cacheGet: function (keys, now, full) {
				return run(function () {
					var out = {};
					keys.forEach(function (k) { var r = data.cache.get(k); if (r && r.exp > now) out[k] = clone(rowOut(r, full)); });
					return out;
				});
			},
			cacheRange: function (prefix, now) {
				return run(function () {
					var out = [];
					data.cache.forEach(function (r, k) { if (startsWith(k, prefix) && r.exp > now) out.push({ key: k, value: clone(r.value), exp: r.exp, at: r.at }); });
					return out.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
				});
			},
			cacheClear: function (prefix) { return run(function () { Array.from(data.cache.keys()).forEach(function (k) { if (startsWith(k, prefix)) data.cache.delete(k); }); }); },
			cacheSweep: function (now, maxRows, maxBytes) {
				return run(function () {
					var metas = [];
					data.cache.forEach(function (r, k) { metas.push({ key: k, exp: r.exp, size: r.size || sizeOf(k, r.value) }); });
					var plan = sweepPlan(metas.sort(soonestFirst), now, maxRows, maxBytes);
					plan.drop.forEach(function (k) { data.cache.delete(k); });
					return plan.result;
				});
			},
			cacheBytes: function () { return run(function () { var b = 0; data.cache.forEach(function (r, k) { b += r.size || sizeOf(k, r.value); }); return b; }); }
		};
	}

	// ---- The IndexedDB backend ----------------------------------------------------------

	function openDb(name) {
		return new Promise(function (resolve, reject) {
			var idb = root.indexedDB, req;
			if (!idb) { reject(fail('This browser has no IndexedDB.')); return; }
			try { req = idb.open(name, DB_VERSION); } catch (e) { reject(fail('IndexedDB could not be opened.', e && e.message)); return; }
			// A new database gets every store; a version 1 database gets only
			// the cache, and its four data stores are left exactly as they are.
			req.onupgradeneeded = function () {
				var db = req.result;
				NAMES.forEach(function (n) {
					if (db.objectStoreNames.contains(n)) return;
					db.createObjectStore(n, n === 'history' ? { keyPath: 'n', autoIncrement: true } : { keyPath: KEYS[n] });
				});
				var cache = db.objectStoreNames.contains('cache') ? req.transaction.objectStore('cache') : db.createObjectStore('cache', { keyPath: 'key' });
				if (!cache.indexNames.contains('exp')) cache.createIndex('exp', 'exp', { unique: false });
			};
			req.onsuccess = function () {
				var db = req.result;
				// Another tab that needs a newer layout may take over.
				db.onversionchange = function () { db.close(); };
				resolve(db);
			};
			req.onerror = function () { reject(fail('IndexedDB could not be opened.', req.error && req.error.message)); };
		});
	}

	function idbBackend(db, name) {
		function prefixRange(prefix) { return root.IDBKeyRange.bound(prefix, prefix + HIGH); }
		function tx(storeName, mode, work) {
			return new Promise(function (resolve, reject) {
				var t, result;
				try { t = db.transaction(storeName, mode); } catch (e) { reject(fail('The store is closed.', e && e.message)); return; }
				t.oncomplete = function () { resolve(result); };
				t.onerror = function () { reject(fail('The browser refused to store this.', t.error && t.error.message)); };
				t.onabort = function () { reject(fail('The browser refused to store this.', t.error && t.error.message)); };
				try { work(t.objectStore(storeName), function (v) { result = v; }); } catch (e) { try { t.abort(); } catch (e2) { /* already over */ } reject(fail('The browser refused to store this.', e && e.message)); }
			});
		}
		return {
			kind: 'indexeddb',
			all: function (storeName) { return tx(storeName, 'readonly', function (s, done) { var r = s.getAll(); r.onsuccess = function () { done(r.result); }; }); },
			get: function (storeName, key) { return tx(storeName, 'readonly', function (s, done) { var r = s.get(key); r.onsuccess = function () { done(r.result); }; }); },
			put: function (storeName, values) { return tx(storeName, 'readwrite', function (s, done) { values.forEach(function (v) { s.put(v); }); done(values.length); }); },
			del: function (storeName, keys) { return tx(storeName, 'readwrite', function (s) { keys.forEach(function (k) { s.delete(k); }); }); },
			clear: function (storeName) { return tx(storeName, 'readwrite', function (s) { s.clear(); }); },
			count: function (storeName) { return tx(storeName, 'readonly', function (s, done) { var r = s.count(); r.onsuccess = function () { done(r.result); }; }); },
			destroy: function () {
				return new Promise(function (resolve, reject) {
					try { db.close(); } catch (e) { /* closed already */ }
					var req = root.indexedDB.deleteDatabase(name);
					req.onsuccess = function () { resolve(); };
					req.onerror = function () { reject(fail('The database could not be deleted.', req.error && req.error.message)); };
					req.onblocked = function () { resolve(); };   // it goes when the last tab holding it closes
				});
			},
			close: function () { try { db.close(); } catch (e) { /* closed already */ } },

			// the cache
			cacheGet: function (keys, now, full) {
				return tx('cache', 'readonly', function (s, done) {
					var out = {}, left = keys.length;
					keys.forEach(function (k) {
						var r = s.get(k);
						r.onsuccess = function () {
							var v = r.result;
							if (v && v.exp > now) out[k] = rowOut(v, full);
							if (--left === 0) done(out);
						};
					});
				});
			},
			cacheRange: function (prefix, now) {
				return tx('cache', 'readonly', function (s, done) {
					var r = prefix ? s.getAll(prefixRange(prefix)) : s.getAll();
					r.onsuccess = function () {
						done(r.result.filter(function (v) { return v.exp > now; }).map(function (v) { return { key: v.key, value: v.value, exp: v.exp, at: v.at }; }));
					};
				});
			},
			cacheClear: function (prefix) { return tx('cache', 'readwrite', function (s) { s.delete(prefixRange(prefix)); }); },
			// One transaction: read every row's expiry and size in expiry order
			// (the 'exp' index), then delete what the plan says.
			cacheSweep: function (now, maxRows, maxBytes) {
				return tx('cache', 'readwrite', function (s, done) {
					var metas = [], r = s.index('exp').openCursor();
					r.onsuccess = function () {
						var c = r.result;
						if (c) { var v = c.value; metas.push({ key: v.key, exp: v.exp, size: v.size || sizeOf(v.key, v.value) }); c.continue(); return; }
						var plan = sweepPlan(metas, now, maxRows, maxBytes);
						plan.drop.forEach(function (k) { s.delete(k); });
						done(plan.result);
					};
				});
			},
			cacheBytes: function () {
				return tx('cache', 'readonly', function (s, done) {
					var b = 0, r = s.openCursor();
					r.onsuccess = function () {
						var c = r.result;
						if (c) { b += c.value.size || sizeOf(c.value.key, c.value.value); c.continue(); return; }
						done(b);
					};
				});
			}
		};
	}

	// ---- The interface --------------------------------------------------------------------

	function wrap(be) {
		var store = {
			kind: be.kind,
			fallback: false,

			// tracks and playlists
			getTracks: function () { return be.all('tracks'); },
			// Many tracks are written a few hundred per transaction, with the
			// page given a turn in between: copying 10,000 tracks into IndexedDB
			// in one call held the page for a third of a second. Each part is
			// whole; a page closed half way keeps the parts already written.
			putTracks: function (tracks) {
				if (!tracks || !tracks.length) return Promise.resolve(0);
				if (tracks.length <= PUT_CHUNK) return be.put('tracks', tracks);
				var at = 0, total = 0;
				function next() {
					if (at >= tracks.length) return Promise.resolve(total);
					var part = tracks.slice(at, at + PUT_CHUNK);
					at += PUT_CHUNK;
					return be.put('tracks', part).then(function (n) {
						total += typeof n === 'number' ? n : part.length;
						return new Promise(function (resolve) { setTimeout(resolve, 0); });
					}).then(next);
				}
				return next();
			},
			deleteTracks: function (ids) { return ids && ids.length ? be.del('tracks', ids) : Promise.resolve(); },
			getPlaylists: function () { return be.all('playlists'); },
			putPlaylists: function (list) { return list && list.length ? be.put('playlists', list) : Promise.resolve(0); },
			deletePlaylists: function (ids) { return ids && ids.length ? be.del('playlists', ids) : Promise.resolve(); },

			// small named records
			get: function (key, fallback) { return be.get('kv', key).then(function (r) { return r && r.value !== undefined ? r.value : fallback; }); },
			set: function (key, value) { return value === undefined || value === null ? be.del('kv', [key]) : be.put('kv', [{ key: String(key), value: value }]).then(function () {}); },
			remove: function (key) { return be.del('kv', [key]); },
			entries: function (prefix) {
				return be.all('kv').then(function (rows) {
					var out = {};
					rows.forEach(function (r) { if (!prefix || String(r.key).indexOf(prefix) === 0) out[r.key] = r.value; });
					return out;
				});
			},
			keys: function (prefix) { return store.entries(prefix).then(function (o) { return Object.keys(o).sort(); }); },

			// the listening history: { id, at (ms), kind: 'play'|'skip'|'error', listenedSec, code }
			addHistory: function (entry) {
				var e = clone(entry) || {};
				delete e.n;
				return be.put('history', [e]).then(function () {});
			},
			// newest first; opts: { limit, since (ms) }
			getHistory: function (opts) {
				opts = opts || {};
				return be.all('history').then(function (rows) {
					rows.sort(function (a, b) { return b.n - a.n; });
					if (opts.since != null) rows = rows.filter(function (r) { return r.at >= opts.since; });
					return opts.limit > 0 ? rows.slice(0, opts.limit) : rows;
				});
			},
			clearHistory: function () { return be.clear('history'); },

			// the library, in the parts library.js's fromParts() takes
			loadLibrary: function () {
				return Promise.all([be.all('tracks'), be.all('playlists'), store.get('library', null)]).then(function (r) {
					return { tracks: r[0], playlists: r[1], meta: r[2] || {} };
				});
			},
			saveLibraryMeta: function (meta) { return store.set('library', meta); },

			// Everything in one object, for a backup file. Import progress is left
			// out: it only makes sense on the machine that was importing. So is
			// the cache, which holds other sites' answers, not the listener's data.
			exportAll: function (now) {
				return Promise.all(NAMES.map(function (n) { return be.all(n); })).then(function (r) {
					var kv = {};
					r[2].forEach(function (row) { if (String(row.key).indexOf('import:') !== 0) kv[row.key] = row.value; });
					return {
						format: FORMAT, version: FORMAT_VERSION, app: 'True Shuffle',
						exportedAt: new Date(now == null ? Date.now() : now).toISOString(),
						tracks: r[0], playlists: r[1], kv: kv,
						history: r[3].sort(function (a, b) { return a.n - b.n; }).map(function (h) { var c = clone(h); delete c.n; return c; })
					};
				});
			},
			// Take a backup file back. mode 'replace' (the default) empties the
			// store first; 'merge' keeps what the file does not mention and lets
			// the file win where both have a record. Rejects, changing nothing, if
			// the file is not an export of this page. -> counts of what was read
			importAll: function (data, opts) {
				var mode = opts && opts.mode === 'merge' ? 'merge' : 'replace', clean;
				try { clean = checkExport(data); } catch (e) { return Promise.reject(e); }
				var kvRows = Object.keys(clean.kv).map(function (k) { return { key: k, value: clean.kv[k] }; });
				var start = mode === 'replace' ? Promise.all(NAMES.map(function (n) { return be.clear(n); })) : Promise.resolve();
				return start.then(function () { return clean.tracks.length ? be.put('tracks', clean.tracks) : 0; })
					.then(function () { return clean.playlists.length ? be.put('playlists', clean.playlists) : 0; })
					.then(function () { return kvRows.length ? be.put('kv', kvRows) : 0; })
					.then(function () { return clean.history.length ? be.put('history', clean.history) : 0; })
					.then(function () { return { mode: mode, tracks: clean.tracks.length, playlists: clean.playlists.length, kv: kvRows.length, history: clean.history.length }; });
			},

			// Delete everything this page has stored, the cache included. The
			// store stays open and empty. (The sign-in token is not here: yt.js
			// keeps it in sessionStorage and clears it on disconnect.)
			wipe: function () { return Promise.all(STORES.map(function (n) { return be.clear(n); })).then(function () {}); },
			// wipe(), and the database itself is removed. The store cannot be
			// used afterwards.
			destroy: function () { return be.destroy(); },

			// -> { tracks, playlists, kv, history, bytes }, and, while the cache
			// holds anything, cache (its rows) and cacheBytes (their size).
			usage: function () {
				return Promise.all(NAMES.map(function (n) { return be.count(n); })).then(function (c) {
					var out = { tracks: c[0], playlists: c[1], kv: c[2], history: c[3], bytes: null };
					return be.count('cache').then(function (rows) {
						if (!rows) return out;
						out.cache = rows;
						return be.cacheBytes().then(function (b) { out.cacheBytes = b; return out; });
					}).then(null, function () { return out; });
				}).then(function (out) {
					var est = root.navigator && root.navigator.storage && root.navigator.storage.estimate;
					if (be.kind !== 'indexeddb' || !est) return out;
					return root.navigator.storage.estimate().then(function (e) { out.bytes = e && e.usage != null ? e.usage : null; return out; }, function () { return out; });
				});
			},
			close: function () { be.close(); },

			// The cache: other sites' answers, kept until `exp` (ms). Rows are
			// { key, value, exp, at, size }; an expired row counts as missing.
			// opts.now (default Date.now()) is the clock the expiry is read
			// against; cacheGet's opts.rows gives { value, exp, at } per key
			// instead of the bare value.
			// -> { key: value } for the keys that are there
			cacheGet: function (keys, opts) {
				keys = listOf(keys);
				return keys.length ? be.cacheGet(keys, nowOf(opts), !!(opts && opts.rows)) : Promise.resolve({});
			},
			// rows: [{ key, value, exp, at }] (`at` defaults to now). Stores
			// `size` too, the length of the value as JSON. Refuses the lot,
			// storing nothing, if a row has no key or no expiry.
			cachePut: function (rows, opts) {
				rows = listOf(rows);
				var t = nowOf(opts), clean = [];
				for (var i = 0; i < rows.length; i++) {
					var r = rows[i] || {}, exp = +r.exp;
					if (typeof r.key !== 'string' || !r.key || !isFinite(exp)) return Promise.reject(fail('A cache row needs a key and an expiry time.'));
					var value = r.value === undefined ? null : r.value;
					clean.push({ key: r.key, value: value, exp: exp, at: r.at != null ? +r.at : t, size: sizeOf(r.key, value) });
				}
				return clean.length ? be.put('cache', clean).then(function () { return clean.length; }) : Promise.resolve(0);
			},
			// -> [{ key, value, exp, at }] for every unexpired row whose key
			// starts with prefix, in key order
			cacheRange: function (prefix, opts) { return be.cacheRange(String(prefix || ''), nowOf(opts)); },
			cacheDelete: function (keys) { keys = listOf(keys); return keys.length ? be.del('cache', keys) : Promise.resolve(); },
			// Expired rows go first, then the rows nearest to expiry until there
			// are at most maxRows (5,000) of at most maxBytes (12 MB) in all.
			// -> { expired, evicted, rows, bytes } (what was removed, what is left)
			cacheSweep: function (opts) {
				opts = opts || {};
				return be.cacheSweep(nowOf(opts), opts.maxRows == null ? CACHE_ROWS : +opts.maxRows, opts.maxBytes == null ? CACHE_BYTES : +opts.maxBytes);
			},
			// The rows whose key starts with prefix; all of them without one.
			cacheClear: function (prefix) { return prefix ? be.cacheClear(String(prefix)) : be.clear('cache'); }
		};
		return store;
	}
	function listOf(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }
	function nowOf(opts) { return opts && opts.now != null ? +opts.now : Date.now(); }

	// An export file, checked. Throws a sentence a reader can be shown.
	function checkExport(data) {
		if (!data || typeof data !== 'object' || data.format !== FORMAT) throw fail('This file is not a True Shuffle export.');
		if (!(data.version >= 1) || data.version > FORMAT_VERSION) throw fail('This export was written by a newer version of the page.', 'version ' + data.version);
		function listOf(name, needsId) {
			var v = data[name];
			if (v == null) return [];
			if (!Array.isArray(v)) throw fail('This export is damaged: "' + name + '" is not a list.');
			if (v.length > MAX_IMPORT) throw fail('This export is too large to be one of this page\'s.');
			v.forEach(function (r) {
				if (!r || typeof r !== 'object' || Array.isArray(r)) throw fail('This export is damaged: a record in "' + name + '" is not an object.');
				if (needsId && (typeof r.id !== 'string' || !r.id)) throw fail('This export is damaged: a record in "' + name + '" has no id.');
			});
			return clone(v);
		}
		var kv = {};
		if (data.kv != null) {
			if (typeof data.kv !== 'object' || Array.isArray(data.kv)) throw fail('This export is damaged: "kv" is not an object.');
			Object.keys(data.kv).forEach(function (k) { if (data.kv[k] != null) kv[k] = clone(data.kv[k]); });
		}
		var history = listOf('history', false);
		history.forEach(function (h) { delete h.n; });
		return { tracks: listOf('tracks', true), playlists: listOf('playlists', true), kv: kv, history: history };
	}

	// A store that forgets everything when the page goes.
	function memory() { return wrap(memoryBackend()); }

	// open({ name, memory, fallback }) -> Promise of a store. IndexedDB unless
	// `memory` is set; if IndexedDB is refused and `fallback` is not false, an
	// in-memory store with .fallback = true and .reason saying why.
	function open(opts) {
		opts = opts || {};
		if (opts.memory) return Promise.resolve(memory());
		var name = opts.name || DB_NAME;
		return openDb(name).then(function (db) { return wrap(idbBackend(db, name)); }, function (err) {
			if (opts.fallback === false) throw err;
			var s = memory();
			s.fallback = true;
			s.reason = err && err.message || 'IndexedDB is not available.';
			return s;
		});
	}

	return { open: open, memory: memory, checkExport: checkExport, DB_NAME: DB_NAME, DB_VERSION: DB_VERSION, FORMAT: FORMAT, FORMAT_VERSION: FORMAT_VERSION };
});
