// Desk store: what the Desk keeps on the device, and the queue of private
// writes that waits for the network.
//
// Everything here is ENCRYPTED with the vault keys (desk/vault.js) before it
// reaches IndexedDB: values, and the names they are stored under. Another page
// on this origin, or someone holding the phone while the Desk is locked, finds
// only ciphertext and the name of the "space" each record belongs to.
//
//   var store = DeskStore.create({ backend: DeskStore.indexedDBBackend(), Vault: DeskVault, keys: keys });
//   store.put('notes-view', 'last-opened', { path: 'notes/a.md' })   -> Promise
//   store.get('notes-view', 'last-opened', fallback)                 -> Promise<value>
//   store.del(space, key) ; store.keys(space) ; store.entries(space) ; store.clear(space) ; store.wipe()
//
//   var sync = DeskStore.createSync({ store: store, gh: client, onChange: fn });
//   sync.read(path)                 the private repo's file, or the queued version of it, or (offline) the cached one
//   sync.list(dir)                  a folder of the private repo, with queued changes merged in
//   sync.save(path, text, opts)     write now; when offline, queue it and write when the network returns
//   sync.remove(path, opts)         the same for a deletion
//   sync.pending() ; sync.flush() ; sync.resolve(path, 'mine' | 'theirs')
//
// The queue is for the PRIVATE repository only. Nothing is ever published
// from a queue: a write to the public site happens while the owner looks at
// the confirm dialog, or not at all.
//
// Loads in the browser (window.DeskStore) and in Node (module.exports), where
// desk/test/test-store.mjs runs it on an in-memory backend.

(function (root, factory) {
	'use strict';
	var api = factory(root);
	if (typeof module === 'object' && module.exports) module.exports = api;
	else root.DeskStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (root) {
	'use strict';

	var DB_NAME = 'desk';
	var DB_STORE = 'kv';

	// ---- backends -------------------------------------------------------------
	// A backend stores opaque records { id, space, box } and knows nothing else.

	function memoryBackend() {
		var map = new Map();
		return {
			records: map,
			get: function (id) {
				return Promise.resolve(map.get(id));
			},
			put: function (record) {
				map.set(record.id, record);
				return Promise.resolve();
			},
			del: function (id) {
				map.delete(id);
				return Promise.resolve();
			},
			all: function (space) {
				var out = [];
				map.forEach(function (r) {
					if (r.space === space) out.push(r);
				});
				return Promise.resolve(out);
			},
			clear: function () {
				map.clear();
				return Promise.resolve();
			},
		};
	}

	function indexedDBBackend() {
		var dbPromise = null;

		function open() {
			if (dbPromise) return dbPromise;
			dbPromise = new Promise(function (resolve, reject) {
				var req;
				try {
					req = root.indexedDB.open(DB_NAME, 1);
				} catch (e) {
					reject(e);
					return;
				}
				req.onupgradeneeded = function () {
					var db = req.result;
					if (!db.objectStoreNames.contains(DB_STORE)) {
						var os = db.createObjectStore(DB_STORE, { keyPath: 'id' });
						os.createIndex('space', 'space', { unique: false });
					}
				};
				req.onsuccess = function () {
					var db = req.result;
					// Another tab is deleting the database ("Forget this device").
					db.onversionchange = function () {
						db.close();
						dbPromise = null;
					};
					resolve(db);
				};
				req.onerror = function () {
					dbPromise = null;
					reject(req.error || new Error('The browser refused to open local storage.'));
				};
				req.onblocked = function () {
					dbPromise = null;
					reject(new Error('Local storage is busy in another tab.'));
				};
			});
			return dbPromise;
		}

		function run(mode, work) {
			return open().then(function (db) {
				return new Promise(function (resolve, reject) {
					var tx = db.transaction(DB_STORE, mode);
					var result;
					var req = work(tx.objectStore(DB_STORE));
					if (req) {
						req.onsuccess = function () {
							result = req.result;
						};
					}
					tx.oncomplete = function () {
						resolve(result);
					};
					tx.onerror = tx.onabort = function () {
						reject(tx.error || new Error('Local storage failed.'));
					};
				});
			});
		}

		return {
			get: function (id) {
				return run('readonly', function (os) {
					return os.get(id);
				});
			},
			put: function (record) {
				return run('readwrite', function (os) {
					return os.put(record);
				});
			},
			del: function (id) {
				return run('readwrite', function (os) {
					return os.delete(id);
				});
			},
			all: function (space) {
				return run('readonly', function (os) {
					return os.index('space').getAll(space);
				}).then(function (list) {
					return list || [];
				});
			},
			clear: function () {
				return run('readwrite', function (os) {
					return os.clear();
				});
			},
			close: function () {
				if (!dbPromise) return Promise.resolve();
				var p = dbPromise;
				dbPromise = null;
				return p.then(
					function (db) {
						db.close();
					},
					function () {}
				);
			},
		};
	}

	// Deletes the whole local database. Needs no key: "Forget this device"
	// must work from the lock screen too.
	function destroy() {
		return new Promise(function (resolve) {
			if (!root.indexedDB) {
				resolve(false);
				return;
			}
			var req;
			try {
				req = root.indexedDB.deleteDatabase(DB_NAME);
			} catch (e) {
				resolve(false);
				return;
			}
			req.onsuccess = function () {
				resolve(true);
			};
			req.onerror = req.onblocked = function () {
				resolve(false);
			};
		});
	}

	// ---- the encrypted key-value store ---------------------------------------

	function create(config) {
		var backend = config.backend;
		var Vault = config.Vault;
		var keys = config.keys;

		function idOf(space, key) {
			return Vault.mac(keys, 'store\n' + space + '\n' + key);
		}

		function open(record) {
			if (!record || !record.box) return Promise.resolve(null);
			return Vault.unseal(keys, 'store:' + record.space, record.box).then(
				function (text) {
					try {
						return JSON.parse(text);
					} catch (e) {
						return null;
					}
				},
				function () {
					// Sealed with other keys (an older sign-in on this device): useless now.
					return null;
				}
			);
		}

		function check(space, key) {
			if (typeof space !== 'string' || !space) throw new Error('store: a space name is needed.');
			if (key !== undefined && (typeof key !== 'string' || !key)) throw new Error('store: a key is needed.');
		}

		function get(space, key, fallback) {
			try {
				check(space, key);
			} catch (e) {
				return Promise.reject(e);
			}
			return idOf(space, key)
				.then(function (id) {
					return backend.get(id);
				})
				.then(open)
				.then(function (pair) {
					return pair && pair.k === key ? pair.v : fallback === undefined ? null : fallback;
				});
		}

		function put(space, key, value) {
			try {
				check(space, key);
			} catch (e) {
				return Promise.reject(e);
			}
			var json = JSON.stringify({ k: key, v: value === undefined ? null : value });
			return Promise.all([idOf(space, key), Vault.seal(keys, 'store:' + space, json)]).then(function (r) {
				return backend.put({ id: r[0], space: space, box: r[1] });
			});
		}

		function del(space, key) {
			try {
				check(space, key);
			} catch (e) {
				return Promise.reject(e);
			}
			return idOf(space, key).then(function (id) {
				return backend.del(id);
			});
		}

		// -> [{ key, value }] sorted by key. Records this key cannot open are dropped.
		function entries(space) {
			try {
				check(space);
			} catch (e) {
				return Promise.reject(e);
			}
			return backend.all(space).then(function (records) {
				return Promise.all(
					records.map(function (record) {
						return open(record).then(function (pair) {
							if (!pair) return backend.del(record.id).then(function () {
								return null;
							});
							return { key: pair.k, value: pair.v };
						});
					})
				).then(function (list) {
					return list
						.filter(Boolean)
						.sort(function (a, b) {
							return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
						});
				});
			});
		}

		function keysOf(space) {
			return entries(space).then(function (list) {
				return list.map(function (e) {
					return e.key;
				});
			});
		}

		function clear(space) {
			try {
				check(space);
			} catch (e) {
				return Promise.reject(e);
			}
			return backend.all(space).then(function (records) {
				return Promise.all(
					records.map(function (r) {
						return backend.del(r.id);
					})
				).then(function () {});
			});
		}

		function wipe() {
			return backend.clear();
		}

		return { get: get, put: put, del: del, keys: keysOf, entries: entries, clear: clear, wipe: wipe, backend: backend };
	}

	// ---- reading and writing the private repository, offline or not --------

	var QUEUE = 'desk.queue';
	var FILES = 'desk.files';
	var DIRS = 'desk.dirs';

	function cleanPath(path) {
		return String(path == null ? '' : path).replace(/^\/+|\/+$/g, '');
	}

	function parentOf(path) {
		var i = path.lastIndexOf('/');
		return i === -1 ? '' : path.slice(0, i);
	}

	function createSync(config) {
		var store = config.store;
		var gh = config.gh;
		var target = config.target || 'private';
		var E = gh.errors;
		var chain = Promise.resolve();
		var state = { pending: 0, conflicts: 0, flushing: false, offline: false, lastSaved: null, lastError: '' };
		var seq = 0;

		function report() {
			return store.entries(QUEUE).then(function (list) {
				state.pending = list.length;
				state.conflicts = list.filter(function (e) {
					return e.value && e.value.conflict;
				}).length;
				if (config.onChange) {
					try {
						config.onChange({ pending: state.pending, conflicts: state.conflicts, flushing: state.flushing, offline: state.offline, lastSaved: state.lastSaved, lastError: state.lastError });
					} catch (e) {
						/* a listener's problem */
					}
				}
			});
		}

		// One thing at a time: two flushes must never send the same entry twice.
		function serial(work) {
			var next = chain.then(work, work);
			chain = next.then(
				function () {},
				function () {}
			);
			return next;
		}

		function waits(err) {
			return err instanceof E.Offline || err instanceof E.RateLimited || err instanceof E.Locked || err instanceof E.Unauthorized || (err instanceof E.GitHubError && err.status >= 500);
		}

		// Sends one queued entry. -> 'saved' | 'queued' | 'conflict'; throws on
		// anything the owner has to look at (the entry stays queued).
		function send(entry) {
			var work;
			if (entry.remove) {
				if (!entry.baseSha) work = Promise.resolve({ sha: null });
				else {
					work = gh.remove(target, entry.path, { message: entry.message, sha: entry.baseSha }).then(
						function () {
							return { sha: null };
						},
						function (err) {
							if (err instanceof E.NotFound) return { sha: null }; // already gone
							throw err;
						}
					);
				}
			} else {
				work = gh.write(target, entry.path, entry.text, { message: entry.message, sha: entry.baseSha || undefined });
			}
			return work.then(
				function (res) {
					return settle(entry, res.sha);
				},
				function (err) {
					if (waits(err)) {
						state.offline = err instanceof E.Offline;
						state.lastError = err.message;
						return 'queued';
					}
					if (err instanceof E.Conflict) {
						// Did an earlier attempt get through although its answer never
						// arrived? Then GitHub already has exactly this text.
						return gh.read(target, entry.path).then(
							function (remote) {
								if (entry.remove ? remote === null : remote && remote.text === entry.text) return settle(entry, remote ? remote.sha : null);
								entry.conflict = true;
								entry.remoteSha = remote ? remote.sha : null;
								return store.put(QUEUE, entry.path, entry).then(function () {
									return 'conflict';
								});
							},
							function () {
								entry.conflict = true;
								return store.put(QUEUE, entry.path, entry).then(function () {
									return 'conflict';
								});
							}
						);
					}
					entry.error = err.message;
					state.lastError = err.message;
					return store.put(QUEUE, entry.path, entry).then(function () {
						throw err;
					});
				}
			);
		}

		// The write is on GitHub: drop the queue entry (unless a newer save
		// replaced it meanwhile) and remember the file.
		function settle(entry, sha) {
			state.offline = false;
			state.lastError = '';
			state.lastSaved = Date.now();
			var cache = entry.remove ? store.del(FILES, entry.path) : store.put(FILES, entry.path, { text: entry.text, sha: sha, at: Date.now() });
			return cache
				.then(function () {
					return store.get(QUEUE, entry.path);
				})
				.then(function (now) {
					if (now && now.seq !== entry.seq) {
						now.baseSha = sha;
						return store.put(QUEUE, entry.path, now);
					}
					return store.del(QUEUE, entry.path);
				})
				.then(function () {
					return 'saved';
				});
		}

		function queued() {
			return store.entries(QUEUE).then(function (list) {
				return list
					.map(function (e) {
						return e.value;
					})
					.filter(Boolean)
					.sort(function (a, b) {
						return a.at - b.at || a.seq - b.seq;
					});
			});
		}

		// Sends everything that is waiting, oldest first. Stops at the first
		// entry that has to wait (no network); skips entries in conflict.
		// -> { sent, left, conflicts }
		function flush() {
			return serial(function () {
				state.flushing = true;
				var sent = 0;
				return report()
					.then(queued)
					.then(function (list) {
						var todo = list.filter(function (e) {
							return !e.conflict;
						});
						function step(i) {
							if (i >= todo.length) return Promise.resolve();
							return send(todo[i]).then(
								function (result) {
									if (result === 'saved') sent++;
									if (result === 'queued') return undefined; // no network: stop here
									return step(i + 1);
								},
								function () {
									return step(i + 1); // that entry keeps its error; try the others
								}
							);
						}
						return step(0);
					})
					.then(function () {
						state.flushing = false;
						return report();
					})
					.then(function () {
						return { sent: sent, left: state.pending, conflicts: state.conflicts };
					});
			});
		}

		function baseFor(path, given) {
			if (given !== undefined) return Promise.resolve(given || null);
			return store.get(QUEUE, path).then(function (q) {
				if (q) return q.baseSha || null;
				return store.get(FILES, path).then(function (f) {
					return (f && f.sha) || gh.shaOf(target, path) || null;
				});
			});
		}

		function enqueue(path, fields, opts) {
			var p = cleanPath(path);
			if (!p) return Promise.reject(new E.GitHubError('A file path is needed.'));
			opts = opts || {};
			return serial(function () {
				return baseFor(p, opts.sha).then(function (base) {
					var entry = { path: p, text: fields.text, remove: !!fields.remove, message: opts.message || (fields.remove ? 'Delete ' : base ? 'Update ' : 'Add ') + p, baseSha: base, at: Date.now(), seq: ++seq, conflict: false, error: '' };
					return store
						.put(QUEUE, p, entry)
						.then(function () {
							state.flushing = true;
							return report();
						})
						.then(function () {
							return send(entry);
						})
						.then(
							function (result) {
								state.flushing = false;
								return report().then(function () {
									if (result === 'conflict') {
										throw new E.Conflict(p + ' changed on GitHub since it was read here. Your version is kept on this device; choose which one wins.', { target: target, path: p, status: 409 });
									}
									return { state: result, sha: result === 'saved' ? gh.shaOf(target, p) : null };
								});
							},
							function (err) {
								state.flushing = false;
								return report().then(function () {
									throw err;
								});
							}
						);
				});
			});
		}

		// Writes a text file to the private repository now; without a network it
		// is kept (encrypted) on the device and written when the network returns.
		// -> { state: 'saved', sha } or { state: 'queued' }. Rejects with Conflict
		// when GitHub has a newer version (yours stays queued, flagged).
		function save(path, text, opts) {
			return enqueue(path, { text: String(text == null ? '' : text) }, opts);
		}

		function remove(path, opts) {
			return enqueue(path, { text: '', remove: true }, opts);
		}

		// -> { text, sha, pending, cached } or null.
		//   pending: this is a version of yours that GitHub does not have yet
		//   cached:  GitHub could not be reached; this is the copy kept on the device
		// opts.prefer === 'cache' answers from the device when it can, without asking GitHub.
		function read(path, opts) {
			var p = cleanPath(path);
			return store.get(QUEUE, p).then(function (q) {
				if (q) return q.remove ? null : { text: q.text, sha: q.baseSha || null, pending: true, cached: false, conflict: !!q.conflict };
				var cachedCopy = function () {
					return store.get(FILES, p).then(function (f) {
						return f ? { text: f.text, sha: f.sha, pending: false, cached: true } : undefined;
					});
				};
				var network = function () {
					return gh.read(target, p).then(function (r) {
						state.offline = false;
						if (!r) {
							return store.del(FILES, p).then(function () {
								return null;
							});
						}
						return store.put(FILES, p, { text: r.text, sha: r.sha, at: Date.now() }).then(function () {
							return { text: r.text, sha: r.sha, pending: false, cached: false };
						});
					});
				};
				if (opts && opts.prefer === 'cache') {
					return cachedCopy().then(function (c) {
						return c !== undefined ? c : network();
					});
				}
				return network().catch(function (err) {
					if (!waits(err)) throw err;
					if (err instanceof E.Offline) state.offline = true;
					return cachedCopy().then(function (c) {
						if (c === undefined) throw err;
						return c;
					});
				});
			});
		}

		// -> [{ name, path, sha, size, type, pending? }]; the array has .cached === true
		// when GitHub could not be reached and this is the listing kept on the device.
		function list(dir) {
			var d = cleanPath(dir);
			var fromCache = false;
			return gh
				.list(target, d)
				.then(
					function (entries) {
						state.offline = false;
						return store.put(DIRS, d || '/', entries).then(function () {
							return entries;
						});
					},
					function (err) {
						if (!waits(err)) throw err;
						if (err instanceof E.Offline) state.offline = true;
						return store.get(DIRS, d || '/').then(function (cachedList) {
							if (!cachedList) throw err;
							fromCache = true;
							return cachedList;
						});
					}
				)
				.then(function (entries) {
					return queued().then(function (q) {
						var out = entries.map(function (e) {
							return { name: e.name, path: e.path, sha: e.sha, size: e.size, type: e.type };
						});
						q.forEach(function (entry) {
							if (parentOf(entry.path) !== d) return;
							var at = -1;
							out.forEach(function (e, i) {
								if (e.path === entry.path) at = i;
							});
							if (entry.remove) {
								if (at !== -1) out.splice(at, 1);
							} else if (at !== -1) out[at].pending = true;
							else out.push({ name: entry.path.slice(d ? d.length + 1 : 0), path: entry.path, sha: null, size: entry.text.length, type: 'file', pending: true });
						});
						out.sort(function (a, b) {
							return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
						});
						out.cached = fromCache;
						return out;
					});
				});
		}

		// -> [{ path, at, remove, conflict, error }], oldest first.
		function pending() {
			return queued().then(function (list) {
				return list.map(function (e) {
					return { path: e.path, at: e.at, remove: !!e.remove, conflict: !!e.conflict, error: e.error || '' };
				});
			});
		}

		// Settles a conflict. 'mine': your queued version replaces what GitHub
		// has now. 'theirs': your queued version is dropped.
		function resolve(path, winner) {
			var p = cleanPath(path);
			if (winner === 'theirs') {
				return serial(function () {
					return store
						.del(QUEUE, p)
						.then(function () {
							// GitHub's version is now the base of the next save: cache it,
							// with its sha. Unreachable: forget the old copy, so the next
							// save takes the sha the client last saw.
							return gh.read(target, p).then(
								function (remote) {
									return remote ? store.put(FILES, p, { text: remote.text, sha: remote.sha, at: Date.now() }) : store.del(FILES, p);
								},
								function () {
									return store.del(FILES, p);
								}
							);
						})
						.then(report)
						.then(function () {
							return { state: 'dropped' };
						});
				});
			}
			return serial(function () {
				return store.get(QUEUE, p).then(function (entry) {
					if (!entry) return { state: 'saved' };
					return gh.read(target, p).then(function (remote) {
						entry.baseSha = remote ? remote.sha : null;
						entry.conflict = false;
						entry.error = '';
						return store
							.put(QUEUE, p, entry)
							.then(function () {
								return send(entry);
							})
							.then(function (result) {
								return report().then(function () {
									return { state: result };
								});
							});
					});
				});
			});
		}

		return {
			read: read,
			list: list,
			save: save,
			remove: remove,
			pending: pending,
			flush: flush,
			resolve: resolve,
			state: function () {
				return { pending: state.pending, conflicts: state.conflicts, flushing: state.flushing, offline: state.offline, lastSaved: state.lastSaved, lastError: state.lastError };
			},
			refresh: report,
		};
	}

	return {
		create: create,
		createSync: createSync,
		memoryBackend: memoryBackend,
		indexedDBBackend: indexedDBBackend,
		destroy: destroy,
		DB_NAME: DB_NAME,
	};
});
