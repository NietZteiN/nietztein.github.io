// Desk music sync: moves True Shuffle's sync bundle between the browser and
// the owner's PRIVATE repository, so that the GitHub token never leaves the
// Desk page. True Shuffle (misc/101-true-shuffle/, same origin) keeps its data
// in IndexedDB; nothing of its code is loaded here.
//
//   IndexedDB 'true-shuffle', object store 'kv', records { key, value }:
//     'sync:outbox'   written by True Shuffle; the Desk reads it to Push
//     'sync:inbox'    written by the Desk on Pull; True Shuffle merges it the
//                     next time it opens or regains focus, then deletes it
//   The private repository: music/true-shuffle-sync.json
//
// The bundle:
//   { format: 'true-shuffle-sync', version: 1, savedAt: ISO string,
//     labels: {...}, state: {...}, stations: [...], history: [...] }
// Everything else in it is carried as it is.
//
// The database is opened WITHOUT a version number, so the Desk never creates
// or upgrades it. If opening would create it (an upgrade from version 0), the
// upgrade is aborted and the answer is "not opened yet". Each operation opens,
// works and closes, so the Desk never holds the database while True Shuffle
// wants to upgrade it.
//
// The functions that touch IndexedDB take the indexedDB object as an argument
// (window.indexedDB in the page, a fake in desk/test/test-music.mjs); the ones
// that touch GitHub take the gh client the views receive. Loads in the browser
// (window.DeskMusicSync) and in Node (module.exports).

(function (root, factory) {
	'use strict';
	var api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else root.DeskMusicSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	var DB_NAME = 'true-shuffle';
	var KV = 'kv';
	var OUTBOX = 'sync:outbox';
	var INBOX = 'sync:inbox';
	var PATH = 'music/true-shuffle-sync.json';
	var FORMAT = 'true-shuffle-sync';
	var VERSION = 1;

	function fail(message, detail) {
		var e = new Error(message);
		if (detail) e.detail = String(detail);
		return e;
	}

	function isObject(v) {
		return v !== null && typeof v === 'object' && !Array.isArray(v);
	}

	function count(v) {
		if (Array.isArray(v)) return v.length;
		if (isObject(v)) return Object.keys(v).length;
		return 0;
	}

	// Throws an Error with a plain message when `b` is not a bundle this page
	// understands; returns it otherwise. `where` names it in the message.
	function check(b, where) {
		where = where || 'The sync bundle';
		if (!isObject(b)) throw fail(where + ' is not a True Shuffle sync bundle.');
		if (b.format !== FORMAT) throw fail(where + ' is not a True Shuffle sync bundle (its format is ' + JSON.stringify(String(b.format)).slice(0, 60) + ').');
		if (typeof b.version !== 'number' || b.version !== Math.floor(b.version) || b.version < 1) throw fail(where + ' has no usable version number.');
		if (b.version > VERSION) throw fail(where + ' was written by a newer True Shuffle (version ' + b.version + '). Update the Desk first.');
		if (typeof b.savedAt !== 'string' || isNaN(Date.parse(b.savedAt))) throw fail(where + ' has no valid savedAt date.');
		if (!isObject(b.labels)) throw fail(where + ' is damaged: "labels" is not an object.');
		if (!isObject(b.state)) throw fail(where + ' is damaged: "state" is not an object.');
		if (!Array.isArray(b.stations)) throw fail(where + ' is damaged: "stations" is not a list.');
		if (!Array.isArray(b.history)) throw fail(where + ' is damaged: "history" is not a list.');
		return b;
	}

	// What a bundle holds, in numbers.
	function summary(b) {
		var st = b.state;
		return {
			savedAt: b.savedAt,
			labelled: isObject(b.labels.tracks) ? Object.keys(b.labels.tracks).length : 0,
			// Per-track state is state.tracks when there is one, else the keys of state.
			withState: isObject(st.tracks) ? Object.keys(st.tracks).length : count(st),
			stations: b.stations.length,
			history: b.history.length,
		};
	}

	function parse(text, where) {
		var b;
		try {
			b = JSON.parse(text);
		} catch (e) {
			throw fail((where || 'The sync file') + ' is not valid JSON.', e && e.message);
		}
		return check(b, where);
	}

	function serialize(b) {
		return JSON.stringify(b, null, 1) + '\n';
	}

	// -1, 0 or 1: is a saved before, at the same time as, or after b.
	function compare(a, b) {
		var x = Date.parse(a);
		var y = Date.parse(b);
		return x < y ? -1 : x > y ? 1 : 0;
	}

	// ---- IndexedDB ------------------------------------------------------------

	// -> Promise of an open database, or null when True Shuffle has never been
	// opened in this browser (nothing is created) or has no kv store yet.
	function openDb(idb) {
		return new Promise(function (resolve, reject) {
			if (!idb) {
				reject(fail('This browser has no IndexedDB, so True Shuffle cannot keep data here.'));
				return;
			}
			var req;
			var fresh = false;
			try {
				req = idb.open(DB_NAME);
			} catch (e) {
				reject(fail('The browser would not open True Shuffle\'s database.', e && e.message));
				return;
			}
			req.onupgradeneeded = function () {
				// Without a version number this happens only when the database
				// does not exist: give it back untouched.
				fresh = true;
				try {
					if (req.transaction) req.transaction.abort();
				} catch (e) {
					/* already over */
				}
				try {
					if (req.result) req.result.close();
				} catch (e) {
					/* closed already */
				}
			};
			req.onsuccess = function () {
				var db = req.result;
				if (fresh) {
					try {
						db.close();
					} catch (e) {
						/* closed already */
					}
					resolve(null);
					return;
				}
				db.onversionchange = function () {
					db.close();
				};
				var names = db.objectStoreNames;
				var hasKv = names && (typeof names.contains === 'function' ? names.contains(KV) : Array.prototype.indexOf.call(names, KV) >= 0);
				if (!hasKv) {
					db.close();
					resolve(null);
					return;
				}
				resolve(db);
			};
			req.onerror = function (ev) {
				if (fresh) {
					if (ev && ev.preventDefault) ev.preventDefault();
					resolve(null);
					return;
				}
				reject(fail('The browser would not open True Shuffle\'s database.', req.error && req.error.message));
			};
			req.onblocked = function () {
				reject(fail('True Shuffle\'s database is busy in another tab. Close that tab, or reload it, and try again.'));
			};
		});
	}

	function kvRun(db, mode, work) {
		return new Promise(function (resolve, reject) {
			var t;
			var result;
			try {
				t = db.transaction(KV, mode);
			} catch (e) {
				reject(fail('True Shuffle\'s database could not be read.', e && e.message));
				return;
			}
			t.oncomplete = function () {
				resolve(result);
			};
			t.onerror = function () {
				reject(fail(mode === 'readonly' ? 'True Shuffle\'s database could not be read.' : 'The browser refused to write into True Shuffle\'s database.', t.error && t.error.message));
			};
			t.onabort = t.onerror;
			try {
				work(t.objectStore(KV), function (v) {
					result = v;
				});
			} catch (e) {
				try {
					t.abort();
				} catch (e2) {
					/* already over */
				}
				reject(fail('True Shuffle\'s database could not be used.', e && e.message));
			}
		});
	}

	function withDb(idb, fn) {
		return openDb(idb).then(function (db) {
			if (!db) return fn(null);
			return Promise.resolve()
				.then(function () {
					return fn(db);
				})
				.then(
					function (v) {
						db.close();
						return v;
					},
					function (e) {
						db.close();
						throw e;
					}
				);
		});
	}

	function getKv(db, key) {
		return kvRun(db, 'readonly', function (s, done) {
			var r = s.get(key);
			r.onsuccess = function () {
				done(r.result);
			};
		});
	}

	// -> Promise of what this browser's True Shuffle has:
	//   { state: 'missing' }                 never opened here
	//   { state: 'empty' }                   opened, but no outbox written yet
	//   { state: 'bad', error }              an outbox this page cannot use
	//   { state: 'ok', bundle, summary, inbox }   inbox: a pulled bundle not merged yet (true or false)
	function readLocal(idb) {
		return withDb(idb, function (db) {
			if (!db) return { state: 'missing' };
			return Promise.all([getKv(db, OUTBOX), getKv(db, INBOX)]).then(function (r) {
				var inbox = !!(r[1] && r[1].value);
				var rec = r[0];
				if (!rec || rec.value === undefined || rec.value === null) return { state: 'empty', inbox: inbox };
				try {
					var b = check(rec.value, 'This browser\'s outbox');
					return { state: 'ok', bundle: b, summary: summary(b), inbox: inbox };
				} catch (e) {
					return { state: 'bad', error: e, inbox: inbox };
				}
			});
		});
	}

	// Writes a checked bundle into the inbox. Rejects when True Shuffle was
	// never opened here (nothing is created).
	function writeInbox(idb, bundle) {
		check(bundle);
		return withDb(idb, function (db) {
			if (!db) throw notOpened();
			return kvRun(db, 'readwrite', function (s) {
				s.put({ key: INBOX, value: JSON.parse(JSON.stringify(bundle)) });
			});
		});
	}

	function notOpened() {
		var e = fail('True Shuffle has not been opened in this browser yet. Open it once, then come back.');
		e.notOpened = true;
		return e;
	}

	// ---- the private repository --------------------------------------------------

	// -> Promise of null (nothing pushed yet), or { sha, text, bundle, summary }
	// or { sha, error } for a file this page cannot use.
	function readRemote(gh) {
		return gh.read('private', PATH).then(function (r) {
			if (!r) return null;
			try {
				var b = parse(r.text, 'The repository copy');
				return { sha: r.sha, text: r.text, bundle: b, summary: summary(b) };
			} catch (e) {
				return { sha: r.sha, error: e };
			}
		});
	}

	// Writes `bundle` to the repository. `sha` is the one read before (null or
	// undefined when there was no file): if the file changed since, gh.write
	// rejects with Conflict and nothing is overwritten.
	function push(gh, bundle, sha) {
		check(bundle);
		var opts = { message: 'Sync True Shuffle (saved ' + bundle.savedAt + ')' };
		if (sha) opts.sha = sha;
		return gh.write('private', PATH, serialize(bundle), opts);
	}

	// Reads the repository copy, checks it and writes it into the inbox.
	// -> Promise of { summary, sha }. Rejects when there is nothing to pull,
	// when the file is not a bundle, or when True Shuffle was never opened here.
	function pull(gh, idb) {
		return openDb(idb)
			.then(function (db) {
				if (!db) throw notOpened();
				db.close();
				return readRemote(gh);
			})
			.then(function (remote) {
				if (!remote) throw fail('There is nothing in the repository to pull yet. Push from a browser first.');
				if (remote.error) throw remote.error;
				return writeInbox(idb, remote.bundle).then(function () {
					return { summary: remote.summary, sha: remote.sha };
				});
			});
	}

	return {
		DB_NAME: DB_NAME,
		OUTBOX: OUTBOX,
		INBOX: INBOX,
		PATH: PATH,
		FORMAT: FORMAT,
		VERSION: VERSION,
		check: check,
		parse: parse,
		serialize: serialize,
		summary: summary,
		compare: compare,
		openDb: openDb,
		readLocal: readLocal,
		writeInbox: writeInbox,
		readRemote: readRemote,
		push: push,
		pull: pull,
	};
});
