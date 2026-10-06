// Desk view "write": drafts, the editor, and publishing posts to the blog.
//
// Drafts live in the private repository as drafts/*.md: a post file whose front
// matter also carries `slug` and, once it is on the site, `published` (the path
// in the public repository) and `publishedSha`. Their images live beside them in
// drafts/images/<slug>/ and are linked as drafts/images/<slug>/<name>; at
// publish time they are copied to assets/img/blog/<slug>/ and the links rewritten.
//
// Nothing typed is ever lost: every change is kept (encrypted) on this device a
// moment later in the store space "write" (key "doc:<draft path | local:id |
// site:path>"), images that could not be uploaded yet in "write.img"; "Save
// draft" goes through api.store.save, which queues when there is no network.
//
// The public site is written only after api.ui.confirmPublish, in one commit,
// and only with what the owner typed. The file format and the checks are in
// desk/postfile.js (window.DeskPostfile), loaded by this file with write.css.
//
// Routes: #/write (the lists), #/write?new=1, #/write?draft=drafts/x.md,
// #/write?local=local:..., #/write?post=2026-10-05-slug.md (a published post).

(function () {
	'use strict';

	var BASE = (function () {
		var s = document.currentScript;
		return s && s.src ? s.src.replace(/[^/]*$/, '') : new URL('views/', location.href).href;
	})();

	var SPACE = 'write';
	var IMG_SPACE = 'write.img';
	var LOCAL_DELAY = 300; // keep on this device this long after the last key
	var LOCAL_MAX = 1000; // ...and at least this often while typing (the first change at once)

	// What this tab knows about each open document's copy on the device. Kept
	// beside the document, not in it (the document is what gets stored):
	//   rev     bumped on every change, synchronously
	//   stored  the rev of the last copy the device confirmed it has
	//   start   when the last write to the device began
	//   failed  the device refused the last write (storage gone, quota)
	// UNSTORED is the memory buffer: every document with changes the device
	// does not have yet, by its key, so that nothing typed depends on a timer.
	// It lives only while the Desk is unlocked (dropped on lock).
	var LOCAL_META = new WeakMap();
	var UNSTORED = {};
	var PREVIEW_DELAY = 500;
	var BIG_TEXT = 200000; // characters: past this the preview waits for a button, the count for a pause
	var MAX_IMAGE = 15 * 1024 * 1024;
	var BIG_IMAGE = 1.5 * 1024 * 1024;

	var P = null; // window.DeskPostfile
	var S = null; // the mounted view's state

	// ---- loading postfile.js and write.css ------------------------------------------

	var depsPromise = null;
	function loadDeps() {
		if (!document.querySelector('link[data-desk-write]')) {
			var link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = BASE + 'write.css';
			link.setAttribute('data-desk-write', '');
			document.head.appendChild(link);
		}
		if (!depsPromise) {
			depsPromise = new Promise(function (resolve, reject) {
				if (window.DeskPostfile) {
					resolve(window.DeskPostfile);
					return;
				}
				var s = document.createElement('script');
				s.src = new URL('../postfile.js', BASE).href;
				s.onload = function () {
					if (window.DeskPostfile) resolve(window.DeskPostfile);
					else reject(new Error('desk/postfile.js loaded but did not start.'));
				};
				s.onerror = function () {
					depsPromise = null;
					reject(new Error('Could not load desk/postfile.js. Check the connection and try again.'));
				};
				document.head.appendChild(s);
			});
		}
		return depsPromise;
	}

	// ---- small helpers ---------------------------------------------------------------

	function toB64(bytes) {
		var s = '';
		for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
		return btoa(s);
	}

	function fromB64(b64) {
		var s = atob(b64);
		var out = new Uint8Array(s.length);
		for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
		return out;
	}

	function kb(n) {
		return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
	}

	function rand2() {
		return Math.random().toString(36).slice(2, 6).replace(/[^a-z0-9]/g, 'x');
	}

	function errText(err) {
		if (!err) return 'Something went wrong.';
		var msg = err.message || String(err);
		if (err.name === 'Forbidden' && err.permission && msg.indexOf(err.permission) === -1) msg += ' (the token needs ' + err.permission + ')';
		return msg;
	}

	function alive(gen) {
		return S && S.gen === gen;
	}

	function isWide() {
		return window.matchMedia ? window.matchMedia('(min-width: 1200px)').matches : window.innerWidth >= 1200;
	}

	function siteLink(slug) {
		return S.api.siteUrl + '#/post/' + encodeURIComponent(slug);
	}

	// ---- documents ---------------------------------------------------------------------

	// One post being written. Plain data: it is what is kept on the device.
	function blankDoc(key) {
		return {
			key: key,
			draftPath: '',
			title: '',
			date: S.ui.date.iso(),
			summary: '',
			tags: [],
			slug: '',
			slugAuto: true,
			body: '',
			published: '',
			publishedSha: '',
			synced: '', // the draft's text as GitHub has it (or as queued for it)
			localAt: 0,
			created: Date.now(),
		};
	}

	function docFromText(text, key, draftPath) {
		var d = P.readDraft(text, draftPath || '');
		var doc = blankDoc(key);
		doc.draftPath = draftPath || '';
		doc.title = d.title;
		doc.date = d.date || S.ui.date.iso();
		doc.summary = d.summary;
		doc.tags = d.tags;
		doc.body = d.body;
		doc.published = d.published;
		doc.publishedSha = d.publishedSha;
		if (doc.published) doc.slug = P.slugFromFile(doc.published);
		else doc.slug = d.slug || P.suggestSlug(d.title, doc.date).slug;
		doc.slugAuto = !doc.published && (!d.slug || d.slug === P.suggestSlug(d.title, doc.date).slug);
		doc.synced = text;
		return doc;
	}

	function draftText(doc) {
		return P.buildDraft(doc, doc.body);
	}

	function publicText(doc, body) {
		return P.buildPost(doc, body === undefined ? doc.body : body);
	}

	function isDirty(doc) {
		return !!doc && draftText(doc) !== doc.synced;
	}

	function isEmpty(doc) {
		return !doc.title.trim() && !doc.body.trim() && !doc.summary.trim();
	}

	function localKey(doc) {
		return 'doc:' + doc.key;
	}

	// ---- the view ----------------------------------------------------------------------

	window.Desk.registerView({
		id: 'write',
		title: 'Write',
		icon: 'write',
		order: 10,
		description: 'Drafts, the editor, and publishing posts to the blog.',

		mount: function (el, api) {
			S = {
				api: api,
				ui: api.ui,
				el: el,
				gen: 0,
				doc: null,
				blobs: {}, // image path -> blob: URL
				bytes: {}, // image path -> Uint8Array
				loading: {}, // image path -> Promise
				index: null, // blog/index.json as GitHub has it
				timers: {},
				previewTheme: null,
				pane: 'edit',
				watch: null,
			};
			el.appendChild(api.ui.el('p', { class: 'muted', text: 'Loading...' }));
			api.on('lock', function () {
				// Store what is open, then forget the memory buffer: nothing private
				// stays in this page after a lock.
				return saveLocal().then(function () {
					UNSTORED = {};
				});
			});
			api.on('online', function () {
				uploadPending();
			});
			api.on('theme', function () {
				if (S && S.doc && !S.previewTheme) schedulePreview(0);
			});
			api.on('sync', function () {
				if (S && S.doc) showStatus();
			});
			el.addEventListener('keydown', onViewKey);
			S.onHide = function () {
				saveLocal();
			};
			// A phone puts the page away (another app, the tab switcher) long before
			// it unloads it: store then, while the page can still finish the write.
			S.onVisibility = function () {
				if (document.visibilityState === 'hidden') saveLocal();
			};
			window.addEventListener('pagehide', S.onHide);
			document.addEventListener('visibilitychange', S.onVisibility);
			return loadDeps().then(function (p) {
				P = p;
				return route(api.params || {});
			});
		},

		update: function (params) {
			if (!S || !P) return;
			route(params || {});
		},

		unmount: function () {
			if (!S) return;
			saveLocal();
			stopWatch();
			Object.keys(S.timers).forEach(function (k) {
				clearTimeout(S.timers[k]);
			});
			Object.keys(S.blobs).forEach(function (k) {
				try {
					URL.revokeObjectURL(S.blobs[k]);
				} catch (e) {
					/* already gone */
				}
			});
			window.removeEventListener('pagehide', S.onHide);
			document.removeEventListener('visibilitychange', S.onVisibility);
			S = null;
		},
	});

	// ---- routing -----------------------------------------------------------------------

	function sameTarget(params) {
		var d = S.doc;
		if (!d) return false;
		if (params.draft) return params.draft === d.draftPath || params.draft === d.key;
		if (params.local) return params.local === d.key;
		if (params.post) return 'blog/posts/' + params.post === d.published && d.key.indexOf('site:') === 0;
		return false;
	}

	function route(params) {
		if (S.doc && sameTarget(params)) return Promise.resolve();
		// What was open is written to the device first, so the next screen reads it back.
		var left = leaveEditor();
		var gen = ++S.gen;
		return left.then(function () {
			if (!alive(gen)) return;
			if (params.draft) return openDraft(String(params.draft), gen);
			if (params.local) return openLocal(String(params.local), gen);
			if (params.post) return openPost(String(params.post), gen);
			if (params['new']) return newDoc(gen);
			return showList(gen);
		});
	}

	function leaveEditor() {
		var p = Promise.resolve();
		if (S.doc) {
			p = saveLocal();
			S.api.dirty(false);
		}
		stopWatch();
		clearTimeout(S.timers.local);
		clearTimeout(S.timers.preview);
		S.doc = null;
		S.edit = null;
		return p;
	}

	function fresh(gen) {
		if (!alive(gen)) return null;
		S.ui.clear(S.el);
		return S.el;
	}

	function goList() {
		S.api.nav('write', {});
	}

	// ---- the lists ---------------------------------------------------------------------

	function showList(gen) {
		var ui = S.ui;
		var h = ui.el;
		var el = fresh(gen);
		if (!el) return Promise.resolve();
		var head = h('div', { class: 'w-head' }, [
			h('h2', { text: 'Posts' }),
			ui.button('New post', {
				kind: 'primary',
				icon: 'plus',
				id: 'w-new',
				onClick: function () {
					S.api.nav('write', { 'new': '1' });
				},
			}),
		]);
		var drafts = h('section', { class: 'card w-drafts', 'aria-labelledby': 'w-drafts-h' }, [h('div', { class: 'card-head' }, h('h3', { id: 'w-drafts-h', text: 'Drafts' })), h('p', { class: 'muted', text: 'Loading drafts...' })]);
		var pub = h('section', { class: 'card w-published', 'aria-labelledby': 'w-pub-h' }, [h('div', { class: 'card-head' }, h('h3', { id: 'w-pub-h', text: 'Published' })), h('p', { class: 'muted', text: 'Loading the blog...' })]);
		el.appendChild(head);
		el.appendChild(h('div', { class: 'w-lists' }, [drafts, pub]));
		var a = fillDrafts(drafts, gen);
		var b = fillPublished(pub, gen);
		return Promise.all([a, b]).then(function () {});
	}

	// Every draft: the private repository's drafts/*.md, plus what is only on this device.
	function collectDrafts() {
		var api = S.api;
		var remote = api.store.list('drafts').then(
			function (entries) {
				var files = entries.filter(function (e) {
					return e.type === 'file' && e.name.charAt(0) !== '.' && /\.md$/i.test(e.name);
				});
				return Promise.all(
					files.map(function (f) {
						return api.store.read(f.path, { prefer: 'cache' }).then(
							function (r) {
								return { path: f.path, text: r ? r.text : '', pending: !!f.pending || !!(r && r.pending), conflict: !!(r && r.conflict) };
							},
							function () {
								return { path: f.path, text: '', pending: !!f.pending, unreadable: true };
							}
						);
					})
				).then(function (list) {
					list.cached = !!entries.cached;
					return list;
				});
			},
			function (err) {
				var list = [];
				list.error = err;
				return list;
			}
		);
		var local = api.store.entries(SPACE).then(function (rows) {
			return rows
				.filter(function (r) {
					return r.key.indexOf('doc:') === 0 && r.value;
				})
				.map(function (r) {
					return r.value;
				});
		});
		return Promise.all([remote, local]).then(function (both) {
			var remoteList = both[0];
			var locals = both[1];
			var byKey = {};
			locals.forEach(function (d) {
				byKey[d.key] = d;
			});
			var rows = remoteList.map(function (r) {
				var d = r.text ? P.readDraft(r.text, r.path) : { title: '', date: '', slug: '', published: '' };
				var loc = byKey[r.path];
				delete byKey[r.path];
				return {
					kind: 'draft',
					path: r.path,
					title: (loc && isDirty(loc) ? loc.title : d.title) || '',
					date: d.date,
					slug: d.slug || '',
					published: d.published,
					pending: r.pending,
					conflict: r.conflict,
					unsaved: !!(loc && isDirty(loc)),
					at: loc ? loc.localAt : 0,
					unreadable: r.unreadable,
				};
			});
			Object.keys(byKey).forEach(function (k) {
				var d = byKey[k];
				if (d.draftPath) {
					// A draft whose file is gone from the listing (deleted elsewhere,
					// or the listing is old): what is on the device still counts.
					rows.push({ kind: 'draft', path: d.draftPath, title: d.title, date: d.date, slug: d.slug, published: d.published, unsaved: isDirty(d), at: d.localAt, missing: !remoteList.error && !remoteList.cached });
				} else if (k.indexOf('site:') === 0) {
					if (isDirty(d)) rows.push({ kind: 'site', key: k, title: d.title, date: d.date, slug: d.slug, published: d.published, unsaved: true, at: d.localAt });
				} else if (!isEmpty(d)) {
					rows.push({ kind: 'local', key: k, title: d.title, date: d.date, slug: d.slug, at: d.localAt || d.created, localOnly: true });
				}
			});
			rows.sort(function (a, b) {
				return (b.at || 0) - (a.at || 0) || String(b.date || '').localeCompare(String(a.date || '')) || String(a.title).localeCompare(String(b.title));
			});
			return { rows: rows, error: remoteList.error, cached: remoteList.cached };
		});
	}

	function fillDrafts(card, gen) {
		var ui = S.ui;
		var h = ui.el;
		return collectDrafts().then(
			function (res) {
				if (!alive(gen)) return;
				while (card.childNodes.length > 1) card.removeChild(card.lastChild);
				if (res.error) card.appendChild(ui.errorBox(new Error('Could not list the drafts in the private repository: ' + errText(res.error)), function () {
					fillDrafts(card, gen);
				}));
				else if (res.cached) card.appendChild(ui.notice('GitHub cannot be reached. This is the list kept on this device.', 'warn'));
				if (!res.rows.length) {
					card.appendChild(h('p', { class: 'muted', text: res.error ? 'Nothing is kept on this device either.' : 'No drafts yet. "New post" starts one.' }));
					return;
				}
				var list = h('div', { class: 'w-rows', role: 'list' });
				res.rows.forEach(function (r) {
					var badge = '';
					var kind = '';
					if (r.conflict) {
						badge = 'conflict';
						kind = 'bad';
					} else if (r.localOnly) {
						badge = 'this device only';
						kind = 'warn';
					} else if (r.unsaved) {
						badge = 'unsaved changes';
						kind = 'warn';
					} else if (r.pending) {
						badge = 'not sent yet';
						kind = 'warn';
					} else if (r.missing) {
						badge = 'not on GitHub';
						kind = 'bad';
					} else if (r.published) {
						badge = 'published';
						kind = 'ok';
					}
					var meta = [r.date, r.slug ? '/' + r.slug : '', r.at ? 'edited ' + ui.date.ago(r.at) : ''].filter(Boolean).join(' · ');
					var row = ui.row({
						title: r.title || (r.unreadable ? r.path : 'Untitled'),
						meta: meta,
						badge: badge,
						badgeKind: kind,
						onClick: function () {
							if (r.kind === 'draft') S.api.nav('write', { draft: r.path });
							else S.api.nav('write', { local: r.key });
						},
					});
					row.setAttribute('role', 'listitem');
					row.dataset.path = r.path || r.key;
					list.appendChild(row);
				});
				card.appendChild(list);
			},
			function (err) {
				if (!alive(gen)) return;
				card.appendChild(ui.errorBox(err, function () {
					showList(++S.gen);
				}));
			}
		);
	}

	// blog/index.json as GitHub has it (fresher than the live site), and the files
	// in blog/posts that it does not list yet. Kept on the device for offline use.
	function loadPublished() {
		var api = S.api;
		var gh = api.gh;
		return Promise.all([gh.readJSON('site', 'blog/index.json', []), gh.list('site', 'blog/posts')]).then(
			function (both) {
				var index = Array.isArray(both[0]) ? both[0] : [];
				var files = both[1].filter(function (f) {
					return f.type === 'file' && /\.md$/i.test(f.name);
				});
				var inIndex = {};
				index.forEach(function (e) {
					if (e && e.file) inIndex[e.file] = true;
				});
				var rows = index
					.filter(function (e) {
						return e && typeof e.file === 'string';
					})
					.map(function (e) {
						return { file: String(e.file), slug: String(e.slug || ''), title: String(e.title || e.slug || ''), date: String(e.date || ''), summary: String(e.summary || ''), tags: Array.isArray(e.tags) ? e.tags.map(String) : [], present: false };
					});
				var present = {};
				files.forEach(function (f) {
					present[f.name] = true;
				});
				rows.forEach(function (r) {
					r.present = !!present[r.file];
				});
				files.forEach(function (f) {
					if (!inIndex[f.name]) rows.unshift({ file: f.name, slug: P.slugFromFile(f.name), title: f.name, date: P.dateFromFile(f.name), summary: '', tags: [], present: true, notIndexed: true });
				});
				var out = { rows: rows, cached: false };
				S.index = out;
				return api.store.put(SPACE, 'cache:published', { rows: rows, at: Date.now() }).then(function () {
					return out;
				});
			},
			function (err) {
				return api.store.get(SPACE, 'cache:published', null).then(function (c) {
					if (!c) throw err;
					var out = { rows: c.rows || [], cached: true, at: c.at, error: err };
					S.index = out;
					return out;
				});
			}
		);
	}

	function fillPublished(card, gen) {
		var ui = S.ui;
		var h = ui.el;
		return loadPublished().then(
			function (res) {
				if (!alive(gen)) return;
				while (card.childNodes.length > 1) card.removeChild(card.lastChild);
				if (res.cached) card.appendChild(ui.notice('GitHub cannot be reached (' + errText(res.error) + '). This is the list from ' + ui.date.ago(res.at) + '.', 'warn'));
				if (!res.rows.length) {
					card.appendChild(h('p', { class: 'muted', text: 'No posts on the site yet.' }));
					return;
				}
				var list = h('div', { class: 'w-rows', role: 'list' });
				res.rows.forEach(function (r) {
					var row = ui.row({
						title: r.title,
						meta: [r.date, '/' + r.slug].filter(Boolean).join(' · '),
						badge: r.notIndexed ? 'not in the list yet' : !r.present ? 'file missing' : '',
						badgeKind: r.notIndexed ? 'warn' : 'bad',
						onClick: function () {
							S.api.nav('write', { post: r.file });
						},
					});
					row.setAttribute('role', 'listitem');
					row.dataset.file = r.file;
					list.appendChild(row);
				});
				card.appendChild(list);
			},
			function (err) {
				if (!alive(gen)) return;
				while (card.childNodes.length > 1) card.removeChild(card.lastChild);
				card.appendChild(ui.errorBox(new Error('Could not read the blog from GitHub: ' + errText(err)), function () {
					fillPublished(card, gen);
				}));
			}
		);
	}

	function ensureIndex() {
		if (S.index && !S.index.cached) return Promise.resolve(S.index);
		return loadPublished().catch(function () {
			return { rows: [], cached: true };
		});
	}

	// ---- opening a document --------------------------------------------------------------

	function newDoc(gen) {
		var key = 'local:' + S.ui.date.stamp() + '-' + rand2();
		var doc = blankDoc(key);
		S.doc = doc;
		renderEditor(gen);
		return saveLocal().then(function () {
			if (!alive(gen)) return;
			S.api.nav('write', { local: key });
		});
	}

	function openLocal(key, gen) {
		return S.api.store.get(SPACE, 'doc:' + key, null).then(function (doc) {
			if (!alive(gen)) return;
			// The device could not keep it (yet): this tab still has it in memory.
			if (!doc && UNSTORED['doc:' + key]) doc = UNSTORED['doc:' + key];
			if (!doc) {
				var el = fresh(gen);
				el.appendChild(S.ui.notice('This draft is not on this device any more. It may have been saved to GitHub or deleted from another tab.', 'warn'));
				el.appendChild(S.ui.button('Back to the posts', { icon: 'back', onClick: goList }));
				return;
			}
			if (doc.draftPath) {
				S.api.nav('write', { draft: doc.draftPath });
				return;
			}
			S.doc = doc;
			renderEditor(gen);
		});
	}

	function openDraft(path, gen) {
		var api = S.api;
		var ui = S.ui;
		if (!/^drafts\/[^/]+\.md$/i.test(path)) {
			var el0 = fresh(gen);
			el0.appendChild(ui.errorBox(new Error('"' + path + '" is not a draft (drafts are drafts/<name>.md).')));
			return Promise.resolve();
		}
		var loading = fresh(gen);
		loading.appendChild(ui.el('p', { class: 'muted', text: 'Opening ' + path + '...' }));
		return Promise.all([
			api.store.get(SPACE, 'doc:' + path, null),
			api.store.read(path).then(
				function (r) {
					return { r: r };
				},
				function (err) {
					return { error: err };
				}
			),
		]).then(function (both) {
			if (!alive(gen)) return;
			var local = both[0];
			var remote = both[1];
			if (remote.error) {
				if (local) {
					S.doc = local;
					renderEditor(gen, ui.notice('GitHub cannot be reached (' + errText(remote.error) + '). This is the copy kept on this device; saving waits for the network.', 'warn'));
					return;
				}
				var el = fresh(gen);
				el.appendChild(ui.errorBox(new Error('Could not open the draft: ' + errText(remote.error)), function () {
					openDraft(path, ++S.gen);
				}));
				el.appendChild(ui.button('Back to the posts', { icon: 'back', onClick: goList }));
				return;
			}
			var r = remote.r;
			if (!r) {
				if (local) {
					local.synced = '';
					S.doc = local;
					renderEditor(gen, ui.notice('This draft is no longer in the private repository (deleted elsewhere?). The copy on this device is shown; "Save draft" puts it back.', 'warn'));
					return;
				}
				var el2 = fresh(gen);
				el2.appendChild(ui.errorBox(new Error(path + ' is not in the private repository.')));
				el2.appendChild(ui.button('Back to the posts', { icon: 'back', onClick: goList }));
				return;
			}
			var fromRemote = docFromText(r.text, path, path);
			if (r.conflict) {
				S.doc = fromRemote;
				renderEditor(gen);
				return settleQueueConflict(path, r.text, gen);
			}
			if (local && isDirty(local)) {
				if (local.synced === r.text) {
					S.doc = local;
					renderEditor(gen, ui.notice('Changes made on this device ' + ui.date.ago(local.localAt) + ' and not saved as a draft yet were restored.', 'info'));
					return checkLive(gen);
				}
				S.doc = fromRemote;
				renderEditor(gen);
				return chooseVersion({
					title: 'This draft changed in two places',
					intro: 'This device has changes that were never saved, and the draft on GitHub changed meanwhile (another device?). Choose which one to keep, or merge them by hand.',
					mineLabel: 'This device (' + ui.date.ago(local.localAt) + ')',
					theirsLabel: 'GitHub',
					mine: draftText(local),
					theirs: r.text,
				}).then(function (res) {
					if (!alive(gen)) return;
					if (!res) {
						// Decide later: keep both (the device copy stays as it is).
						S.doc = local;
						renderEditor(gen, ui.notice('The changes on this device are shown. The draft on GitHub is newer; "Save draft" will ask again.', 'warn'));
						return;
					}
					applyChoice(res, r.text, path);
					renderEditor(gen);
				});
			}
			S.doc = fromRemote;
			renderEditor(gen, r.cached ? ui.notice('GitHub cannot be reached. This is the copy kept on this device.', 'warn') : null);
			return checkLive(gen);
		});
	}

	// After a choice between two versions of a draft: the doc becomes the chosen
	// text, with `theirs` as what GitHub has (so a merge or "mine" is unsaved).
	function applyChoice(res, theirs, path) {
		var key = S.doc ? S.doc.key : path;
		var text = res.choice === 'theirs' ? theirs : res.text;
		var doc = docFromText(text, key, path);
		doc.synced = theirs;
		S.doc = doc;
		saveLocal();
	}

	// A draft linked to a published post: is the live file still the one it published?
	function checkLive(gen) {
		var doc = S.doc;
		if (!doc || !doc.published) return Promise.resolve();
		return S.api.gh.read('site', doc.published).then(
			function (live) {
				if (!alive(gen) || S.doc !== doc) return;
				if (!live) {
					S.edit.notices.appendChild(S.ui.notice('This draft says it is published as ' + doc.published + ', but that file is not on the site any more. Publishing it makes a new post.', 'warn'));
					doc.published = '';
					doc.publishedSha = '';
					doc.slugAuto = false;
					refreshEditorFields();
					return;
				}
				if (live.sha === doc.publishedSha) return;
				var liveDoc = docFromText(live.text, doc.key, doc.draftPath);
				if (publicText(liveDoc) === publicText(doc)) {
					doc.publishedSha = live.sha;
					return;
				}
				var box = S.ui.notice(
					[
						S.ui.el('p', { text: 'The live post changed since this draft was published (by hand, or from another device). "Update" will refuse to overwrite it until you compare.' }),
						S.ui.button('Compare with the live post', {
							kind: 'quiet',
							onClick: function () {
								compareWithLive(live, box);
							},
						}),
					],
					'warn'
				);
				S.edit.notices.appendChild(box);
			},
			function () {
				/* offline: the check waits for the next open */
			}
		);
	}

	function compareWithLive(live, box) {
		var doc = S.doc;
		var liveDoc = docFromText(live.text, doc.key, doc.draftPath);
		liveDoc.published = doc.published;
		liveDoc.publishedSha = live.sha;
		chooseVersion({
			title: 'The draft and the live post differ',
			intro: 'Left is the draft; right is the post as it is on the site now. Keep one, or merge by hand. The result is what "Update" will publish.',
			mineLabel: 'Draft',
			theirsLabel: 'Live post',
			mine: draftText(doc),
			theirs: draftText(liveDoc),
		}).then(function (res) {
			if (!res || !S || S.doc !== doc) return;
			var text = res.choice === 'theirs' ? draftText(liveDoc) : res.text;
			var next = docFromText(text, doc.key, doc.draftPath);
			next.synced = doc.synced;
			next.published = doc.published;
			next.publishedSha = live.sha;
			next.slug = P.slugFromFile(doc.published);
			next.slugAuto = false;
			S.doc = next;
			if (box && box.parentNode) box.parentNode.removeChild(box);
			refreshEditorFields();
			changed();
		});
	}

	function openPost(file, gen) {
		var api = S.api;
		var ui = S.ui;
		if (!/^[^/\\]+\.md$/i.test(file)) {
			fresh(gen).appendChild(ui.errorBox(new Error('"' + file + '" is not a post file name.')));
			return Promise.resolve();
		}
		var path = 'blog/posts/' + file;
		var key = 'site:' + path;
		fresh(gen).appendChild(ui.el('p', { class: 'muted', text: 'Opening ' + path + '...' }));
		return findLinkedDraft(path).then(function (draftPath) {
			if (!alive(gen)) return;
			if (draftPath) {
				api.nav('write', { draft: draftPath });
				return;
			}
			return Promise.all([
				api.store.get(SPACE, 'doc:' + key, null),
				api.gh.read('site', path).then(
					function (r) {
						return { r: r };
					},
					function (err) {
						return { error: err };
					}
				),
			]).then(function (both) {
				if (!alive(gen)) return;
				var local = both[0];
				var remote = both[1];
				if (remote.error || !remote.r) {
					if (local) {
						S.doc = local;
						renderEditor(gen, ui.notice(remote.error ? 'GitHub cannot be reached (' + errText(remote.error) + '). These are the changes kept on this device.' : 'This post is not on the site any more. These are the changes kept on this device.', 'warn'));
						return;
					}
					var el = fresh(gen);
					el.appendChild(ui.errorBox(remote.error ? new Error('Could not read ' + path + ': ' + errText(remote.error)) : new Error(path + ' is not on the site.'), remote.error ? function () {
						openPost(file, ++S.gen);
					} : null));
					el.appendChild(ui.button('Back to the posts', { icon: 'back', onClick: goList }));
					return;
				}
				var r = remote.r;
				var doc = docFromText(r.text, key, '');
				doc.published = path;
				doc.publishedSha = r.sha;
				doc.slug = P.slugFromFile(file);
				doc.slugAuto = false;
				doc.synced = draftText(doc);
				if (local && isDirty(local)) {
					if (local.publishedSha === r.sha) {
						S.doc = local;
						renderEditor(gen, ui.notice('Changes made on this device ' + ui.date.ago(local.localAt) + ' were restored. They are not on the site yet.', 'info'));
						return;
					}
					S.doc = doc;
					renderEditor(gen);
					return chooseVersion({
						title: 'The post changed on the site',
						intro: 'This device has unpublished changes to this post, and the post on the site changed meanwhile. Choose which to keep, or merge by hand.',
						mineLabel: 'This device',
						theirsLabel: 'Live post',
						mine: draftText(local),
						theirs: draftText(doc),
					}).then(function (res) {
						if (!alive(gen) || !res) return;
						var text = res.choice === 'theirs' ? draftText(doc) : res.text;
						var next = docFromText(text, key, '');
						next.published = path;
						next.publishedSha = r.sha;
						next.slug = doc.slug;
						next.slugAuto = false;
						next.synced = doc.synced;
						S.doc = next;
						saveLocal();
						renderEditor(gen);
					});
				}
				S.doc = doc;
				renderEditor(gen);
			});
		});
	}

	// The draft in the private repository that says it published `path`, or ''.
	function findLinkedDraft(path) {
		return collectDrafts().then(
			function (res) {
				for (var i = 0; i < res.rows.length; i++) {
					var r = res.rows[i];
					if (r.kind === 'draft' && r.published === path && !r.missing) return r.path;
				}
				return '';
			},
			function () {
				return '';
			}
		);
	}

	// ---- the editor --------------------------------------------------------------------------

	var TOOLS = [
		{ id: 'bold', label: 'Bold', keys: 'Ctrl+B', icon: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z' },
		{ id: 'italic', label: 'Italic', keys: 'Ctrl+I', icon: 'M10 5h8M6 19h8M14 5l-4 14' },
		{ id: 'heading', label: 'Heading', keys: 'Ctrl+Alt+2', icon: 'M6 5v14M18 5v14M6 12h12' },
		{ id: 'quote', label: 'Quote', keys: 'Ctrl+Shift+9', icon: 'M5 7h5v5H7l-2 4M14 7h5v5h-3l-2 4' },
		{ id: 'code', label: 'Code', keys: 'Ctrl+E', icon: 'M9 7l-5 5 5 5M15 7l5 5-5 5' },
		{ id: 'link', label: 'Link', keys: 'Ctrl+K', icon: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' },
		{ id: 'list', label: 'List', keys: 'Ctrl+Shift+8', icon: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01' },
		{ id: 'image', label: 'Image', keys: '', icon: 'image' },
		{ id: 'math', label: 'Math', keys: 'Ctrl+Shift+M', icon: 'M18 5H6l6 7-6 7h12' },
	];

	function renderEditor(gen, firstNotice) {
		var ui = S.ui;
		var h = ui.el;
		var el = fresh(gen);
		if (!el) return;
		var doc = S.doc;
		var E = (S.edit = { gen: gen });

		// The bar: back, state, the actions.
		E.status = h('span', { class: 'w-status small', id: 'w-status', role: 'status', 'aria-live': 'polite' });
		E.save = ui.button('Save draft', { icon: 'saved', id: 'w-save', title: 'Save draft (Ctrl+S)', onClick: function () {
			saveDraft();
		} });
		E.publish = ui.button(doc.published ? 'Update' : 'Publish', { kind: 'primary', icon: 'globe', id: 'w-publish', onClick: function () {
			publish();
		} });
		E.more = h('details', { class: 'w-more' }, [
			h('summary', { class: 'btn btn-quiet w-more-sum', 'aria-label': 'More actions', title: 'More actions' }, [ui.icon('M5 12h.01M12 12h.01M19 12h.01', 20), h('span', { class: 'w-more-label', text: 'More' })]),
			h('div', { class: 'w-more-menu' }),
		]);
		el.appendChild(
			h('div', { class: 'w-bar' }, [
				ui.button('Posts', { icon: 'back', kind: 'quiet', id: 'w-back', onClick: goList }),
				E.status,
				h('div', { class: 'w-bar-actions' }, [E.more, E.save, E.publish]),
			])
		);
		E.notices = h('div', { class: 'w-notices' });
		if (firstNotice) E.notices.appendChild(firstNotice);
		el.appendChild(E.notices);
		E.watch = h('div', { class: 'w-watch-host' });
		el.appendChild(E.watch);

		// The front matter.
		E.title = h('input', { class: 'input w-title-input', id: 'w-title', type: 'text', autocomplete: 'off', spellcheck: 'true', value: doc.title, placeholder: 'Title' });
		E.date = h('input', { class: 'input', id: 'w-date', type: 'date', value: doc.date });
		E.summary = h('input', { class: 'input', id: 'w-summary', type: 'text', autocomplete: 'off', spellcheck: 'true', value: doc.summary, placeholder: 'One line shown in the post list' });
		E.slug = h('input', { class: 'input mono', id: 'w-slug', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: doc.slug, inputmode: 'url' });
		E.slugHint = h('div', { class: 'field-hint', id: 'w-slug-hint' });
		E.slug.setAttribute('aria-describedby', 'w-slug-hint');
		E.slugChange = ui.button('Change address...', { kind: 'quiet', id: 'w-slug-change', onClick: unlockSlug });
		E.tags = h('div', { class: 'w-chips', id: 'w-tags' });
		E.tagInput = h('input', { class: 'w-tag-input', id: 'w-tag-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', list: 'w-tag-list', placeholder: 'Add a tag', 'aria-describedby': 'w-tags-hint' });
		E.tagList = h('datalist', { id: 'w-tag-list' });
		E.tagBox = h('div', { class: 'w-tagbox' }, [E.tags, E.tagInput, E.tagList]);

		E.meta = h('details', { class: 'card w-meta', open: !doc.title.trim() || !doc.summary.trim() }, [
			h('summary', { class: 'w-meta-sum' }, [h('span', { class: 'w-meta-title', text: 'Post details' }), h('span', { class: 'w-meta-line small muted' })]),
			h('div', { class: 'w-meta-grid' }, [
				h('div', { class: 'field w-f-title' }, [h('label', { for: 'w-title', text: 'Title' }), E.title]),
				h('div', { class: 'field w-f-summary' }, [h('label', { for: 'w-summary', text: 'Summary' }), E.summary]),
				h('div', { class: 'field w-f-date' }, [h('label', { for: 'w-date', text: 'Date' }), E.date]),
				h('div', { class: 'field w-f-slug' }, [h('label', { for: 'w-slug', text: 'Address (slug)' }), h('div', { class: 'w-slug-row' }, [h('span', { class: 'w-slug-pre mono small muted', text: '#/post/' }), E.slug, E.slugChange]), E.slugHint]),
				h('div', { class: 'field w-f-tags' }, [h('label', { for: 'w-tag-input', text: 'Tags' }), E.tagBox, h('div', { class: 'field-hint', id: 'w-tags-hint', text: 'Enter or comma adds a tag; lowercase with dashes.' })]),
			]),
		]);
		el.appendChild(E.meta);

		// Edit and Preview: side by side on a wide screen, two tabs on a phone.
		E.tabEdit = h('button', { type: 'button', class: 'w-tab', role: 'tab', id: 'w-tab-edit', 'aria-controls': 'w-pane-edit', text: 'Edit' });
		E.tabPreview = h('button', { type: 'button', class: 'w-tab', role: 'tab', id: 'w-tab-preview', 'aria-controls': 'w-pane-preview', text: 'Preview' });
		E.tabs = h('div', { class: 'w-tabs', role: 'tablist', 'aria-label': 'Edit or preview' }, [E.tabEdit, E.tabPreview]);
		E.tabEdit.addEventListener('click', function () {
			setPane('edit', true);
		});
		E.tabPreview.addEventListener('click', function () {
			setPane('preview', true);
		});
		E.tabs.addEventListener('keydown', function (e) {
			if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
				e.preventDefault();
				setPane(S.pane === 'edit' ? 'preview' : 'edit', true);
			}
		});

		E.tools = h('div', { class: 'w-tools', role: 'toolbar', 'aria-label': 'Formatting', 'aria-controls': 'w-text' });
		TOOLS.forEach(function (t) {
			var b = h('button', { type: 'button', class: 'btn btn-quiet w-tool', title: t.label + (t.keys ? ' (' + t.keys + ')' : ''), 'aria-label': t.label + (t.keys ? ', ' + t.keys : ''), data: { tool: t.id } }, [ui.icon(t.icon, 18)]);
			// Keep the text area's selection when a tool is pressed with the mouse.
			b.addEventListener('mousedown', function (e) {
				e.preventDefault();
			});
			b.addEventListener('click', function () {
				tool(t.id);
			});
			E.tools.appendChild(b);
		});
		E.file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/avif', multiple: true, hidden: true, id: 'w-file', tabindex: '-1', 'aria-hidden': 'true' });
		E.file.addEventListener('change', function () {
			var files = Array.prototype.slice.call(E.file.files || []);
			E.file.value = '';
			addImages(files);
		});

		E.text = h('textarea', {
			class: 'input w-text',
			id: 'w-text',
			'aria-label': 'Post text (Markdown)',
			spellcheck: 'true',
			autocapitalize: 'sentences',
			autocomplete: 'off',
			placeholder: 'Write here. Markdown: **bold**, _italic_, # heading, > quote, `code`, $math$.',
		});
		E.text.value = doc.body;
		E.count = h('div', { class: 'w-count small muted', id: 'w-count' });
		E.uploads = h('div', { class: 'w-uploads small', id: 'w-uploads', role: 'status', 'aria-live': 'polite' });

		E.previewHost = h('div', { class: 'w-preview-host', id: 'w-preview-host' });
		E.themeLight = h('button', { type: 'button', class: 'btn btn-quiet w-ptheme', data: { theme: 'light' }, text: 'Light' });
		E.themeDark = h('button', { type: 'button', class: 'btn btn-quiet w-ptheme', data: { theme: 'dark' }, text: 'Dark' });
		[E.themeLight, E.themeDark].forEach(function (b) {
			b.addEventListener('click', function () {
				S.previewTheme = b.dataset.theme;
				markPreviewTheme();
				schedulePreview(0);
			});
		});

		E.panes = h('div', { class: 'w-panes', data: { pane: S.pane } }, [
			h('section', { class: 'w-pane w-edit', id: 'w-pane-edit', role: 'tabpanel', 'aria-labelledby': 'w-tab-edit' }, [E.tools, E.file, E.text, h('div', { class: 'w-under' }, [E.count, E.uploads])]),
			h('section', { class: 'w-pane w-preview', id: 'w-pane-preview', role: 'tabpanel', 'aria-labelledby': 'w-tab-preview' }, [
				h('div', { class: 'w-preview-bar' }, [h('span', { class: 'small muted', text: 'As the site will show it' }), h('div', { class: 'w-ptheme-group', role: 'group', 'aria-label': 'Preview theme' }, [E.themeLight, E.themeDark])]),
				E.previewHost,
			]),
		]);
		el.appendChild(E.tabs);
		el.appendChild(E.panes);

		wireInputs();
		refreshEditorFields();
		renderMore();
		setPane(S.pane, false);
		markPreviewTheme();
		showStatus();
		schedulePreview(0);
		loadTagSuggestions();
		pendingImages().then(function (list) {
			if (S && S.edit === E) showUploads(list);
		});
		if (doc.body || doc.title) {
			// A phone keyboard would cover the form; focus only on a wide screen.
			if (isWide()) E.text.focus({ preventScroll: true });
		} else if (isWide()) E.title.focus({ preventScroll: true });
	}

	function setPane(pane, focus) {
		S.pane = pane === 'preview' ? 'preview' : 'edit';
		var E = S.edit;
		if (!E) return;
		E.panes.dataset.pane = S.pane;
		E.tabEdit.setAttribute('aria-selected', S.pane === 'edit' ? 'true' : 'false');
		E.tabPreview.setAttribute('aria-selected', S.pane === 'preview' ? 'true' : 'false');
		E.tabEdit.tabIndex = S.pane === 'edit' ? 0 : -1;
		E.tabPreview.tabIndex = S.pane === 'preview' ? 0 : -1;
		if (focus) (S.pane === 'edit' ? E.tabEdit : E.tabPreview).focus();
		if (S.pane === 'preview') schedulePreview(0);
	}

	function markPreviewTheme() {
		var E = S.edit;
		if (!E) return;
		var t = S.previewTheme || S.ui.theme.get();
		E.themeLight.setAttribute('aria-pressed', t === 'light' ? 'true' : 'false');
		E.themeDark.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
	}

	function previewVisible() {
		return S.edit && (isWide() || S.pane === 'preview');
	}

	function wireInputs() {
		var E = S.edit;
		E.title.addEventListener('input', function () {
			var doc = S.doc;
			doc.title = E.title.value;
			if (doc.slugAuto && !doc.published) {
				doc.slug = P.suggestSlug(doc.title, doc.date).slug;
				E.slug.value = doc.slug;
			}
			slugHint();
			changed();
		});
		E.summary.addEventListener('input', function () {
			S.doc.summary = E.summary.value;
			changed();
		});
		E.date.addEventListener('input', function () {
			var doc = S.doc;
			doc.date = E.date.value;
			if (doc.slugAuto && !doc.published) {
				doc.slug = P.suggestSlug(doc.title, doc.date).slug;
				E.slug.value = doc.slug;
			}
			slugHint();
			changed();
		});
		E.slug.addEventListener('input', function () {
			var doc = S.doc;
			var v = E.slug.value.toLowerCase().replace(/\s+/g, '-');
			if (v !== E.slug.value) {
				var at = E.slug.selectionStart;
				E.slug.value = v;
				try {
					E.slug.setSelectionRange(at, at);
				} catch (e) {
					/* not a text field any more */
				}
			}
			doc.slug = v;
			doc.slugAuto = v === '' || v === P.suggestSlug(doc.title, doc.date).slug;
			if (!v && !doc.published) {
				doc.slugAuto = true;
			}
			slugHint();
			changed();
		});
		E.slug.addEventListener('blur', function () {
			// The editor may already be gone (New, or another draft, while the
			// field had the focus): then this field belongs to nothing.
			if (!S || S.edit !== E || !S.doc) return;
			var doc = S.doc;
			if (!doc.slug && !doc.published) {
				doc.slug = P.suggestSlug(doc.title, doc.date).slug;
				doc.slugAuto = true;
				E.slug.value = doc.slug;
				slugHint();
				changed();
			}
		});
		E.tagInput.addEventListener('keydown', function (e) {
			if (e.isComposing || e.keyCode === 229) return;
			if (e.key === 'Enter' || e.key === ',') {
				if (!E.tagInput.value.trim()) return;
				e.preventDefault();
				addTag(E.tagInput.value);
			} else if (e.key === 'Backspace' && !E.tagInput.value && S.doc.tags.length) {
				e.preventDefault();
				removeTag(S.doc.tags[S.doc.tags.length - 1], true);
			}
		});
		E.tagInput.addEventListener('input', function () {
			// A comma typed through an IME or pasted, or a pick from the suggestions.
			var v = E.tagInput.value;
			if (/,/.test(v)) {
				v.split(',').slice(0, -1).forEach(addTag);
				E.tagInput.value = v.split(',').pop();
			} else if (S.tagSuggestions && S.tagSuggestions.indexOf(v) !== -1 && S.doc.tags.indexOf(v) === -1) {
				addTag(v);
			}
		});
		E.tagInput.addEventListener('blur', function () {
			// Not into another document's tags when the editor was replaced.
			if (!S || S.edit !== E || !S.doc) return;
			if (E.tagInput.value.trim()) addTag(E.tagInput.value);
		});

		var composing = false;
		E.text.addEventListener('compositionstart', function () {
			composing = true;
		});
		E.text.addEventListener('compositionend', function () {
			composing = false;
			S.doc.body = E.text.value;
			changed();
		});
		E.text.addEventListener('input', function () {
			S.doc.body = E.text.value;
			// While an IME is composing, the text is not final: count it, keep it, but
			// do not re-render the preview on every keystroke.
			changed(composing);
		});
		E.text.addEventListener('keydown', onTextKey);
		E.text.addEventListener('paste', function (e) {
			var files = imageFilesOf(e.clipboardData);
			if (!files.length) return;
			e.preventDefault();
			addImages(files);
		});
		E.text.addEventListener('dragover', function (e) {
			if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1) {
				e.preventDefault();
				E.text.classList.add('is-drop');
			}
		});
		E.text.addEventListener('dragleave', function () {
			E.text.classList.remove('is-drop');
		});
		E.text.addEventListener('drop', function (e) {
			E.text.classList.remove('is-drop');
			var files = imageFilesOf(e.dataTransfer);
			if (!files.length) return;
			e.preventDefault();
			addImages(files);
		});
	}

	function imageFilesOf(dt) {
		if (!dt) return [];
		var out = [];
		Array.prototype.forEach.call(dt.files || [], function (f) {
			if (f && /^image\//.test(f.type)) out.push(f);
		});
		if (!out.length && dt.items) {
			Array.prototype.forEach.call(dt.items, function (it) {
				if (it.kind === 'file' && /^image\//.test(it.type)) {
					var f = it.getAsFile();
					if (f) out.push(f);
				}
			});
		}
		return out;
	}

	// The fields from S.doc (after a version was chosen, say).
	function refreshEditorFields() {
		var E = S.edit;
		var doc = S.doc;
		if (!E || !doc) return;
		if (E.title.value !== doc.title) E.title.value = doc.title;
		if (E.summary.value !== doc.summary) E.summary.value = doc.summary;
		if (E.date.value !== doc.date) E.date.value = doc.date;
		if (E.slug.value !== doc.slug) E.slug.value = doc.slug;
		if (E.text.value !== doc.body) E.text.value = doc.body;
		var locked = !!doc.published && !S.slugUnlocked;
		E.slug.readOnly = locked;
		E.slugChange.hidden = !locked;
		E.publish.lastChild.textContent = doc.published ? 'Update' : 'Publish';
		renderTags();
		slugHint();
		renderMore();
		count();
		showStatus();
		schedulePreview(0);
	}

	function slugHint() {
		if (!S || !S.edit || !S.doc) return;
		var E = S.edit;
		var doc = S.doc;
		var ui = S.ui;
		ui.clear(E.slugHint);
		E.slugHint.className = 'field-hint';
		if (doc.published && !S.slugUnlocked) {
			E.slugHint.appendChild(document.createTextNode('Published at '));
			E.slugHint.appendChild(ui.el('a', { href: siteLink(P.slugFromFile(doc.published)), target: '_blank', rel: 'noopener noreferrer', text: siteLink(P.slugFromFile(doc.published)).replace(/^https?:\/\//, '') }));
			E.slugHint.appendChild(document.createTextNode('. Its comments and view count are tied to this address.'));
			return;
		}
		if (doc.published && S.slugUnlocked && doc.slug !== P.slugFromFile(doc.published)) {
			E.slugHint.className = 'field-hint w-hint-warn';
			E.slugHint.textContent = 'Changing the address of a published post: the old link stops working, and its comments and view count stay with the old address.';
			return;
		}
		if (doc.slug && !P.isValidSlug(doc.slug)) {
			E.slugHint.className = 'field-hint w-hint-bad';
			E.slugHint.textContent = 'Only lowercase letters a to z, digits and single dashes between them.';
			return;
		}
		if (P.isDateSlug(doc.slug) && doc.title.trim()) {
			E.slugHint.className = 'field-hint w-hint-warn';
			E.slugHint.textContent = 'The title has no ASCII words, so the address is made from the date. Name it yourself: lowercase a to z, digits, dashes.';
			return;
		}
		E.slugHint.textContent = doc.slugAuto ? 'Made from the title. Edit it to choose your own.' : 'The post will be at #/post/' + (doc.slug || '...') + '.';
	}

	function unlockSlug() {
		var ui = S.ui;
		var doc = S.doc;
		var old = P.slugFromFile(doc.published);
		ui.confirm({
			title: 'Change the address of a published post?',
			body: [
				'"' + old + '" is live. If you publish it under another address:',
				ui.el('ul', {}, [
					ui.el('li', { text: 'every link to ' + siteLink(old) + ' stops working;' }),
					ui.el('li', { text: 'its comments (the GitHub Discussion titled "' + old + '") are no longer shown under the post;' }),
					ui.el('li', { text: 'its view count starts again from zero.' }),
				]),
				'You will be asked once more before anything is published.',
			],
			action: 'Let me change it',
			danger: true,
		}).then(function (yes) {
			if (!yes || !S || S.doc !== doc) return;
			S.slugUnlocked = true;
			refreshEditorFields();
			S.edit.slug.focus();
		});
	}

	// ---- tags ---------------------------------------------------------------------------

	function renderTags() {
		var E = S.edit;
		var ui = S.ui;
		ui.clear(E.tags);
		S.doc.tags.forEach(function (t) {
			E.tags.appendChild(
				ui.el('span', { class: 'w-chip' }, [
					ui.el('span', { class: 'w-chip-text', text: t }),
					ui.el('button', { type: 'button', class: 'w-chip-x', 'aria-label': 'Remove tag ' + t, title: 'Remove', on: { click: function () {
						removeTag(t, false);
					} } }, [ui.icon('close', 16)]),
				])
			);
		});
		fillTagList();
	}

	function addTag(raw) {
		var add = P.cleanTags(String(raw).split(','));
		var doc = S.doc;
		var before = doc.tags.length;
		doc.tags = P.cleanTags(doc.tags.concat(add));
		S.edit.tagInput.value = '';
		if (doc.tags.length !== before) {
			renderTags();
			changed();
		}
	}

	function removeTag(t, keepFocus) {
		var doc = S.doc;
		doc.tags = doc.tags.filter(function (x) {
			return x !== t;
		});
		renderTags();
		changed();
		S.edit.tagInput.focus();
		if (!keepFocus) S.ui.toast('Removed the tag "' + t + '".');
	}

	function loadTagSuggestions() {
		ensureIndex().then(function (idx) {
			if (!S || !S.edit) return;
			var seen = {};
			var all = [];
			idx.rows.forEach(function (r) {
				(r.tags || []).forEach(function (t) {
					var n = P.normalizeTag(t);
					if (n && !seen[n]) {
						seen[n] = true;
						all.push(n);
					}
				});
			});
			all.sort();
			S.tagSuggestions = all;
			fillTagList();
		});
	}

	function fillTagList() {
		var E = S.edit;
		if (!E || !S.tagSuggestions) return;
		S.ui.clear(E.tagList);
		S.tagSuggestions.forEach(function (t) {
			if (S.doc.tags.indexOf(t) === -1) E.tagList.appendChild(S.ui.el('option', { value: t }));
		});
	}

	// ---- the "More" menu ---------------------------------------------------------------

	function renderMore() {
		var E = S.edit;
		var ui = S.ui;
		var doc = S.doc;
		var menu = E.more.querySelector('.w-more-menu');
		ui.clear(menu);
		var items = [];
		if (doc.published) {
			items.push(ui.el('a', { class: 'btn btn-quiet', href: siteLink(P.slugFromFile(doc.published)), target: '_blank', rel: 'noopener noreferrer' }, [ui.icon('external', 18), ui.el('span', { text: 'Open on the site' })]));
			items.push(ui.button('Unpublish...', { kind: 'quiet', icon: 'warning', id: 'w-unpublish', onClick: function () {
				E.more.open = false;
				unpublish();
			} }));
		}
		if (doc.draftPath || doc.key.indexOf('local:') === 0 || doc.key.indexOf('site:') === 0) {
			items.push(ui.button(doc.draftPath ? 'Delete draft...' : 'Discard...', { kind: 'quiet', icon: 'trash', id: 'w-delete', onClick: function () {
				E.more.open = false;
				deleteDraft();
			} }));
		}
		items.forEach(function (n) {
			menu.appendChild(n);
		});
		E.more.hidden = !items.length;
	}

	// ---- typing, autosave --------------------------------------------------------------

	function metaOf(doc) {
		var m = LOCAL_META.get(doc);
		if (!m) {
			m = { rev: 0, stored: 0, start: 0, failed: false, chain: Promise.resolve() };
			LOCAL_META.set(doc, m);
		}
		return m;
	}

	function unstored(doc) {
		var m = metaOf(doc);
		return m.rev !== m.stored;
	}

	function changed(composing) {
		if (!S || !S.doc) return;
		var doc = S.doc;
		var m = metaOf(doc);
		m.rev++;
		UNSTORED[localKey(doc)] = doc;
		count();
		showStatus();
		var now = Date.now();
		clearTimeout(S.timers.local);
		// The first change after a quiet moment goes to the device at once;
		// while typing, at most every LOCAL_MAX, and LOCAL_DELAY after the
		// last key.
		var since = now - m.start;
		if (m.rev === m.stored + 1 || since >= LOCAL_MAX) saveLocal();
		else {
			S.timers.local = setTimeout(function () {
				S && saveLocal();
			}, Math.max(0, Math.min(LOCAL_DELAY, LOCAL_MAX - since)));
		}
		if (!composing) schedulePreview(PREVIEW_DELAY);
	}

	function count() {
		var E = S.edit;
		if (!E) return;
		// Counting a very long text on every key makes typing lag: count once
		// the keys stop.
		if (S.doc.body.length > BIG_TEXT && !S.countNow) {
			clearTimeout(S.timers.count);
			S.timers.count = setTimeout(function () {
				if (!S || S.edit !== E) return;
				S.countNow = true;
				count();
				S.countNow = false;
			}, 400);
			return;
		}
		var c = P.wordCount(S.doc.body);
		E.count.textContent = c.words.toLocaleString('en-US') + (c.words === 1 ? ' word' : ' words') + ' · ' + c.chars.toLocaleString('en-US') + ' characters';
		var line = E.meta.querySelector('.w-meta-line');
		if (line) line.textContent = [S.doc.date, S.doc.slug ? '/' + S.doc.slug : '', S.doc.tags.join(', ')].filter(Boolean).join(' · ');
	}

	// Keeps the document on this device (encrypted). Never fails loudly: the
	// worst case is the in-memory copy, which is still on screen.
	// Writes for one document run one after another, so an older copy can
	// never land after a newer one. Each write stores the document as it is
	// when the write begins (callers also use it after replacing S.doc).
	function saveLocal() {
		if (!S || !S.doc) return Promise.resolve();
		clearTimeout(S.timers.local);
		return storeLocal(S.api, S.doc);
	}

	function storeLocal(api, doc) {
		var m = metaOf(doc);
		m.start = Date.now();
		var run = m.chain.then(function () {
			var rev = m.rev;
			var key = localKey(doc);
			var work;
			var kept = false;
			if ((!isDirty(doc) && (doc.draftPath || doc.key.indexOf('site:') === 0)) || (doc.key.indexOf('local:') === 0 && isEmpty(doc) && !doc.draftPath)) {
				work = api.store.del(SPACE, key);
			} else {
				kept = true;
				doc.localAt = Date.now();
				work = api.store.put(SPACE, key, JSON.parse(JSON.stringify(doc)));
			}
			return work.then(
				function () {
					m.stored = rev;
					m.failed = false;
					m.keptAt = kept ? doc.localAt : 0;
					if (m.rev === m.stored) {
						Object.keys(UNSTORED).forEach(function (k) {
							if (UNSTORED[k] === doc) delete UNSTORED[k];
						});
					}
					if (S && S.doc === doc) showStatus();
				},
				function () {
					// Locked or storage gone: the text is still in the editor and in
					// UNSTORED, and the status says it is not on the device.
					m.failed = true;
					if (S && S.doc === doc) showStatus();
				}
			);
		});
		m.chain = run;
		return run;
	}

	function showStatus() {
		var E = S && S.edit;
		var doc = S && S.doc;
		if (!E || !doc) return;
		var ui = S.ui;
		var dirty = isDirty(doc);
		var m = metaOf(doc);
		// Say "kept on this device" only once the device has confirmed it.
		var at = m.keptAt || doc.localAt;
		var device = m.failed
			? 'Not stored on this device: it refused to keep the text (storage full or cleared). Keep this tab open and use "Save draft".'
			: unstored(doc)
				? 'Writing the latest changes to this device...'
				: '';
		var t;
		var state;
		if (device && (dirty || !isEmpty(doc))) {
			t = device + (doc.draftPath || doc.key.indexOf('site:') === 0 ? ' Not saved as a draft yet.' : ' Not in the private repository yet.');
			state = 'unsaved';
		} else if (doc.draftPath) {
			if (dirty) {
				t = 'Changes kept on this device' + (at ? ' (' + ui.date.time(at) + ')' : '') + '; not saved as a draft yet';
				state = 'unsaved';
			} else if (S.queued) {
				t = 'Draft kept on this device; it goes to GitHub when the network returns';
				state = 'queued';
			} else {
				t = 'Draft saved' + (S.savedAt ? ' at ' + ui.date.time(S.savedAt) : '');
				state = 'saved';
			}
		} else if (doc.key.indexOf('site:') === 0) {
			t = dirty ? 'Changes kept on this device; not on the site and not a draft yet' : 'The live version. Edit, then "Update" or "Save draft".';
			state = dirty ? 'unsaved' : 'saved';
		} else {
			t = isEmpty(doc) ? 'New post' : 'On this device only' + (at ? ' (' + ui.date.time(at) + ')' : '') + '. "Save draft" puts it in the private repository.';
			state = isEmpty(doc) ? 'saved' : 'unsaved';
		}
		E.status.textContent = t;
		E.status.dataset.state = state;
		S.api.dirty(state === 'unsaved' || state === 'queued');
	}

	// ---- toolbar and shortcuts -----------------------------------------------------------

	function onViewKey(e) {
		if (!S || !S.edit) return;
		if (e.isComposing || e.keyCode === 229) return;
		var mod = e.ctrlKey || e.metaKey;
		if (mod && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
			e.preventDefault();
			saveDraft();
		}
	}

	function onTextKey(e) {
		if (e.isComposing || e.keyCode === 229) return;
		var mod = e.ctrlKey || e.metaKey;
		if (!mod) return;
		var k = (e.key || '').toLowerCase();
		var code = e.code || '';
		var act = null;
		if (!e.shiftKey && !e.altKey) {
			if (k === 'b') act = 'bold';
			else if (k === 'i') act = 'italic';
			else if (k === 'k') act = 'link';
			else if (k === 'e') act = 'code';
		} else if (e.shiftKey && !e.altKey) {
			if (code === 'Digit8') act = 'list';
			else if (code === 'Digit9') act = 'quote';
			else if (k === 'm') act = 'math';
		} else if (e.altKey && !e.shiftKey && code === 'Digit2') act = 'heading';
		if (!act) return;
		e.preventDefault();
		tool(act);
	}

	// Replaces the selection with `text` so that the browser's undo still works,
	// then selects [selStart, selEnd] relative to where the text went.
	function replaceSelection(text, selStart, selEnd) {
		var ta = S.edit.text;
		var start = ta.selectionStart;
		ta.focus();
		var done = false;
		try {
			done = document.execCommand && document.execCommand('insertText', false, text);
		} catch (e) {
			done = false;
		}
		if (!done || ta.value.substr(start, text.length) !== text) {
			ta.setRangeText(text, start, ta.selectionEnd, 'end');
			ta.dispatchEvent(new Event('input', { bubbles: true }));
		}
		if (selStart !== undefined) ta.setSelectionRange(start + selStart, start + (selEnd === undefined ? selStart : selEnd));
	}

	function wrapSel(before, after, placeholder) {
		var ta = S.edit.text;
		var sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
		var inner = sel || placeholder;
		replaceSelection(before + inner + after, before.length, before.length + inner.length);
	}

	// Adds (or removes, when every line has it) a prefix to each selected line.
	function prefixLines(prefix, test) {
		var ta = S.edit.text;
		var v = ta.value;
		var a = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
		var b = v.indexOf('\n', ta.selectionEnd);
		if (b === -1) b = v.length;
		if (ta.selectionEnd > ta.selectionStart && v.charAt(ta.selectionEnd - 1) === '\n') b = ta.selectionEnd - 1;
		var lines = v.slice(a, b).split('\n');
		var all = lines.every(function (l) {
			return test.test(l);
		});
		var next = lines
			.map(function (l) {
				return all ? l.replace(test, '') : prefix + l.replace(/^(#{1,6} |> |- |\* |\d+\. )/, '');
			})
			.join('\n');
		ta.setSelectionRange(a, b);
		replaceSelection(next, 0, next.length);
	}

	function tool(id) {
		var E = S.edit;
		var ta = E.text;
		if (S.pane !== 'edit' && !isWide()) setPane('edit', false);
		var sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
		switch (id) {
			case 'bold':
				wrapSel('**', '**', 'bold text');
				break;
			case 'italic':
				wrapSel('_', '_', 'italic text');
				break;
			case 'heading':
				prefixLines('## ', /^#{1,6} /);
				break;
			case 'quote':
				prefixLines('> ', /^> /);
				break;
			case 'list':
				prefixLines('- ', /^[-*] /);
				break;
			case 'code':
				if (/\n/.test(sel)) wrapSel('```\n', sel.charAt(sel.length - 1) === '\n' ? '```' : '\n```', '');
				else wrapSel('`', '`', 'code');
				break;
			case 'math':
				if (/\n/.test(sel)) wrapSel('$$\n', '\n$$', '');
				else wrapSel('$', '$', 'x^2');
				break;
			case 'link':
				var label = sel || 'link text';
				var text = '[' + label + '](https://)';
				replaceSelection(text, label.length + 3, label.length + 11);
				break;
			case 'image':
				E.file.click();
				return;
		}
		ta.focus();
	}

	// ---- images ---------------------------------------------------------------------------

	function imageDir() {
		var doc = S.doc;
		var s = doc.slug && P.isValidSlug(doc.slug) ? doc.slug : 'untitled-' + String(doc.created || Date.now()).slice(-6);
		return P.DRAFT_IMG_DIR + s + '/';
	}

	function addImages(files) {
		var ui = S.ui;
		var api = S.api;
		var doc = S.doc;
		var dir = imageDir();
		var taken = {};
		Object.keys(S.blobs).forEach(function (p) {
			if (p.indexOf(dir) === 0) taken[p.slice(dir.length)] = true;
		});
		var listing = api.gh.list('private', dir.replace(/\/$/, '')).then(
			function (entries) {
				entries.forEach(function (e) {
					taken[e.name] = true;
				});
			},
			function () {
				/* offline: names from this session are enough, a clash is caught on upload */
			}
		);
		return listing.then(function () {
			var chain = Promise.resolve();
			files.forEach(function (file) {
				chain = chain.then(function () {
					if (!S || S.doc !== doc) return;
					if (!P.isImageType(file.type)) {
						ui.toast(file.name + ' is not an image this Desk can publish (PNG, JPEG, GIF, WebP, SVG, AVIF).', { kind: 'warn' });
						return;
					}
					if (file.size > MAX_IMAGE) {
						ui.toast(file.name + ' is ' + kb(file.size) + '. Images over ' + kb(MAX_IMAGE) + ' are refused; make it smaller first.', { kind: 'bad' });
						return;
					}
					var name = P.imageName(file.name, file.type, taken);
					if (name === 'image.' + name.split('.').pop() || /^image-\d+\./.test(name)) name = P.imageName('image-' + S.ui.date.stamp().slice(9, 15) + '.' + name.split('.').pop(), file.type, taken);
					taken[name] = true;
					var path = dir + name;
					return readFile(file).then(function (bytes) {
						S.bytes[path] = bytes;
						S.blobs[path] = URL.createObjectURL(new Blob([bytes], { type: P.mimeFor(name) }));
						// Kept on the device first, so that a failed upload loses nothing.
						return api.store.put(IMG_SPACE, path, { b64: toB64(bytes), type: P.mimeFor(name), at: Date.now(), draft: doc.key }).then(function () {
							var alt = file.name ? file.name.replace(/\.[A-Za-z0-9]+$/, '').replace(/[\[\]]/g, '') : 'image';
							if (!alt || /^image$/i.test(alt)) alt = 'image';
							var md = '![' + alt + '](' + path + ')';
							var ta = S.edit.text;
							var v = ta.value;
							var atStart = ta.selectionStart === 0 || v.charAt(ta.selectionStart - 1) === '\n';
							replaceSelection((atStart ? '' : '\n\n') + md + '\n\n');
							if (file.size > BIG_IMAGE) ui.toast(name + ' is ' + kb(file.size) + '. Readers on a phone will download all of it.', { kind: 'warn' });
						});
					});
				});
			});
			return chain.then(uploadPending);
		});
	}

	function readFile(file) {
		if (file.arrayBuffer) {
			return file.arrayBuffer().then(function (buf) {
				return new Uint8Array(buf);
			});
		}
		return new Promise(function (resolve, reject) {
			var r = new FileReader();
			r.onload = function () {
				resolve(new Uint8Array(r.result));
			};
			r.onerror = function () {
				reject(new Error('Could not read ' + file.name + '.'));
			};
			r.readAsArrayBuffer(file);
		});
	}

	function pendingImages() {
		if (!S) return Promise.resolve([]);
		return S.api.store.keys(IMG_SPACE).catch(function () {
			return [];
		});
	}

	// Sends images that are only on this device to the private repository.
	function uploadPending() {
		if (!S) return Promise.resolve();
		if (S.uploading) return S.uploading;
		var api = S.api;
		var ui = S.ui;
		var mine = S;
		S.uploading = pendingImages()
			.then(function (paths) {
				var failed = null;
				var chain = Promise.resolve();
				paths.forEach(function (path) {
					chain = chain.then(function () {
						if (failed || S !== mine) return;
						return api.store.get(IMG_SPACE, path, null).then(function (rec) {
							if (!rec) return;
							var bytes = fromB64(rec.b64);
							return api.gh.write('private', path, bytes, { message: 'Add image ' + path, sha: null }).then(
								function () {
									return api.store.del(IMG_SPACE, path);
								},
								function (err) {
									if (err.name === 'Conflict') {
										// Already there: the same picture if this device sent it before
										// without hearing back. Otherwise keep it here and say so.
										return api.gh.readBytes('private', path).then(function (r) {
											return api.gh.blobSha(bytes).then(function (sha) {
												if (r && r.sha === sha) return api.store.del(IMG_SPACE, path);
												failed = new Error(path + ' already exists in the private repository with other content.');
											});
										});
									}
									failed = err;
								}
							);
						});
					});
				});
				return chain.then(function () {
					return failed;
				});
			})
			.then(
				function (failed) {
					mine.uploading = null;
					return pendingImages().then(function (left) {
						if (S === mine) showUploads(left, failed);
						return { left: left, error: failed };
					});
				},
				function (err) {
					mine.uploading = null;
					if (S === mine) showUploads([], err);
					return { left: [], error: err };
				}
			);
		return S.uploading;
	}

	function showUploads(left, err) {
		var E = S && S.edit;
		if (!E) return;
		var ui = S.ui;
		ui.clear(E.uploads);
		if (!left || !left.length) return;
		E.uploads.appendChild(document.createTextNode(left.length + (left.length === 1 ? ' image is' : ' images are') + ' kept on this device, not uploaded yet' + (err ? ' (' + errText(err) + ')' : '') + '. '));
		E.uploads.appendChild(ui.button('Upload now', { kind: 'quiet', id: 'w-upload-retry', onClick: function (e) {
			ui.busy(e.currentTarget, uploadPending());
		} }));
	}

	// The bytes of a private image: this session, this device, or GitHub.
	function imageBytes(path) {
		if (S.bytes[path]) return Promise.resolve(S.bytes[path]);
		if (S.loading[path]) return S.loading[path];
		var api = S.api;
		var mine = S;
		var p = api.store
			.get(IMG_SPACE, path, null)
			.then(function (rec) {
				if (rec) return fromB64(rec.b64);
				return api.gh.readBytes('private', path).then(function (r) {
					return r ? r.bytes : null;
				});
			})
			.then(
				function (bytes) {
					delete mine.loading[path];
					if (bytes) mine.bytes[path] = bytes;
					return bytes;
				},
				function (err) {
					delete mine.loading[path];
					throw err;
				}
			);
		S.loading[path] = p;
		return p;
	}

	function blobFor(path) {
		if (S.blobs[path]) return Promise.resolve(S.blobs[path]);
		return imageBytes(path).then(function (bytes) {
			if (!bytes || !S) return null;
			if (!S.blobs[path]) S.blobs[path] = URL.createObjectURL(new Blob([bytes], { type: P.mimeFor(path) }));
			return S.blobs[path];
		});
	}

	function resolveUrl(url) {
		var clean = String(url || '').replace(/^\.?\//, '');
		try {
			clean = decodeURI(clean);
		} catch (e) {
			/* as written */
		}
		return S.blobs[clean] || null;
	}

	// ---- preview ----------------------------------------------------------------------------

	function schedulePreview(delay) {
		if (!S || !S.edit) return;
		clearTimeout(S.timers.preview);
		S.timers.preview = setTimeout(renderPreview, delay || 0);
	}

	// A very long text (a pasted book) takes seconds to draw with maths and
	// highlighting, and the page would not answer meanwhile: then the preview
	// waits for a button press instead of following every key.
	function previewPaused(E, doc) {
		var big = doc.body.length > BIG_TEXT;
		if (!big || S.previewOnce) {
			S.previewOnce = false;
			if (E.previewPaused && E.previewPaused.parentNode) E.previewPaused.parentNode.removeChild(E.previewPaused);
			E.previewPaused = null;
			return false;
		}
		var say = 'This post is very long (' + doc.body.length.toLocaleString('en-US') + ' characters), so the preview no longer follows every key: drawing it takes a while, and the page would not answer meanwhile.';
		if (E.previewPaused) E.previewPausedText.textContent = say;
		else {
			var ui = S.ui;
			E.previewPausedText = ui.el('p', { text: say });
			E.previewPaused = ui.notice([
				E.previewPausedText,
				ui.button('Draw the preview now', { icon: 'refresh', id: 'w-preview-draw', onClick: function () {
					if (!S || S.edit !== E) return;
					S.previewOnce = true;
					renderPreview();
				} }),
			], 'warn');
			E.previewPaused.id = 'w-preview-paused';
			E.previewHost.parentNode.insertBefore(E.previewPaused, E.previewHost);
		}
		return true;
	}

	function renderPreview() {
		if (!S || !S.edit || !previewVisible()) return;
		var E = S.edit;
		var doc = S.doc;
		if (previewPaused(E, doc)) return;
		var refs = P.privateImages(doc.body).concat(P.siteImages(doc.body).filter(function (p) {
			return !!S.bytes[p];
		}));
		var missing = refs.filter(function (p) {
			return !S.blobs[p];
		});
		var theme = S.previewTheme || S.ui.theme.get();
		E.previewHost.dataset.theme = theme;
		S.ui
			.renderMarkdown(E.previewHost, publicText(doc), { post: true, theme: theme, resolveUrl: resolveUrl })
			.then(
				function () {
					if (E.previewError && E.previewError.parentNode) E.previewError.parentNode.removeChild(E.previewError);
				},
				function (err) {
					if (!S || S.edit !== E) return;
					if (E.previewError && E.previewError.parentNode) E.previewError.parentNode.removeChild(E.previewError);
					E.previewError = S.ui.errorBox(new Error('The preview could not be drawn: ' + errText(err)), function () {
						schedulePreview(0);
					});
					E.previewHost.parentNode.insertBefore(E.previewError, E.previewHost);
				}
			);
		if (missing.length) {
			Promise.all(
				missing.map(function (p) {
					return blobFor(p).catch(function () {
						return null;
					});
				})
			).then(function (urls) {
				if (S && S.edit === E && urls.some(Boolean)) schedulePreview(0);
			});
		}
	}

	// ---- saving the draft -------------------------------------------------------------------

	function draftPathFor(doc) {
		var base = doc.slug && P.isValidSlug(doc.slug) ? doc.slug : 'untitled-' + S.ui.date.stamp().toLowerCase();
		return S.api.store.list('drafts').then(
			function (entries) {
				var taken = {};
				entries.forEach(function (e) {
					taken[e.name] = true;
				});
				var name = base + '.md';
				var n = 2;
				while (taken[name]) name = base + '-' + n++ + '.md';
				return 'drafts/' + name;
			},
			function () {
				return 'drafts/' + base + '-' + rand2() + '.md';
			}
		);
	}

	// -> Promise that settles once the draft is saved, queued, or the problem shown.
	function saveDraft(opts) {
		opts = opts || {};
		if (!S || !S.doc) return Promise.resolve(false);
		if (S.saving) return S.saving;
		var ui = S.ui;
		var api = S.api;
		var doc = S.doc;
		var E = S.edit;
		var isNew = !doc.draftPath;
		var p = saveLocal()
			.then(function () {
				uploadPending();
				return isNew ? draftPathFor(doc) : doc.draftPath;
			})
			.then(function (path) {
				var text = draftText(doc);
				var title = doc.title.trim() || 'untitled';
				return api.store
					.save(path, text, { message: (isNew ? 'Start draft: ' : 'Save draft: ') + title, sha: isNew ? null : undefined })
					.then(function (res) {
						if (!S || S.doc !== doc) return true;
						var oldKey = doc.key;
						doc.draftPath = path;
						doc.synced = text;
						S.queued = res.state === 'queued';
						S.savedAt = Date.now();
						if (oldKey !== path) {
							doc.key = path;
							api.store.del(SPACE, 'doc:' + oldKey).catch(function () {});
						}
						return saveLocal().then(function () {
							if (!S || S.doc !== doc) return true;
							renderMore();
							showStatus();
							if (!opts.quiet) ui.toast(res.state === 'queued' ? 'No network: the draft is kept on this device and goes to GitHub when the network returns.' : 'Draft saved to the private repository.', { kind: res.state === 'queued' ? 'warn' : 'ok' });
							if (oldKey !== path) api.nav('write', { draft: path });
							return true;
						});
					})
					.catch(function (err) {
						if (err && err.name === 'Conflict') {
							if (isNew) {
								// The name was taken meanwhile: pick another and try once more.
								return api.store.pending().then(function () {
									return api.store.resolve(path, 'theirs');
								}).then(function () {
									S.saving = null;
									return saveDraft(opts);
								});
							}
							return settleQueueConflict(path, text, S.gen);
						}
						throw err;
					});
			})
			.then(
				function (r) {
					if (S) S.saving = null;
					return r;
				},
				function (err) {
					if (S) S.saving = null;
					if (!S || S.doc !== doc) return false;
					showStatus();
					var box = ui.errorBox(new Error('The draft was not saved to GitHub: ' + errText(err) + ' It is kept on this device.'), function () {
						if (box.parentNode) box.parentNode.removeChild(box);
						saveDraft(opts);
					});
					E.notices.appendChild(box);
					return false;
				}
			);
		S.saving = p;
		if (E && E.save) ui.busy(E.save, p);
		return p;
	}

	// The private draft changed on GitHub since it was read here: show both.
	function settleQueueConflict(path, mineText, gen) {
		var api = S.api;
		var ui = S.ui;
		return api.gh.read('private', path).then(
			function (remote) {
				if (!alive(gen)) return false;
				var theirs = remote ? remote.text : '';
				return chooseVersion({
					title: 'This draft changed somewhere else',
					intro: 'The draft on GitHub changed since this device read it (another device, or an edit on github.com). Nothing was overwritten. Keep one version, or merge them by hand.',
					mineLabel: 'This device',
					theirsLabel: remote ? 'GitHub' : 'GitHub (deleted there)',
					mine: mineText,
					theirs: theirs,
				}).then(function (res) {
					if (!alive(gen)) return false;
					if (!res) {
						ui.toast('Left undecided. Your version stays on this device; Home lists the conflict.', { kind: 'warn' });
						return false;
					}
					if (res.choice === 'theirs') {
						return api.store.resolve(path, 'theirs').then(function () {
							applyChoice(res, theirs, path);
							S.doc.synced = theirs;
							refreshEditorFields();
							ui.toast('Kept the version from GitHub.');
							return true;
						});
					}
					var text = res.text;
					return api.store.save(path, text, { message: 'Save draft: ' + (S.doc.title.trim() || 'untitled') + (res.choice === 'merged' ? ' (merged)' : ''), sha: remote ? remote.sha : null }).then(function (r) {
						if (!alive(gen)) return true;
						var doc = docFromText(text, path, path);
						doc.synced = text;
						S.doc = doc;
						S.queued = r.state === 'queued';
						S.savedAt = Date.now();
						saveLocal();
						refreshEditorFields();
						ui.toast(res.choice === 'merged' ? 'Saved the merged draft.' : 'Kept the version from this device.');
						return true;
					});
				});
			},
			function (err) {
				ui.toast('The draft changed on GitHub, and GitHub\'s version could not be read (' + errText(err) + '). Yours is kept on this device; try again later.', { kind: 'bad' });
				return false;
			}
		);
	}

	// Two versions side by side; keep one or merge by hand.
	// -> Promise<{ choice: 'mine' | 'theirs' | 'merged', text } | undefined>
	function chooseVersion(o) {
		var ui = S.ui;
		var h = ui.el;
		return ui.dialog(
			function (dlg, close) {
				dlg.classList.add('w-choose');
				var mine = h('textarea', { class: 'input mono w-version', readOnly: true, id: 'w-v-mine', 'aria-label': o.mineLabel });
				mine.value = o.mine;
				var theirs = h('textarea', { class: 'input mono w-version', readOnly: true, id: 'w-v-theirs', 'aria-label': o.theirsLabel });
				theirs.value = o.theirs;
				var mineHead = h('div', { class: 'label', text: o.mineLabel });
				var cols = h('div', { class: 'w-versions' }, [h('div', {}, [mineHead, mine]), h('div', {}, [h('div', { class: 'label', text: o.theirsLabel }), theirs])]);
				var diff = diffSummary(o.mine, o.theirs);
				var actions = h('div', { class: 'dialog-actions' });
				function choices() {
					ui.clear(actions);
					var keepMine = ui.button(o.keepMine || 'Keep ' + lower(o.mineLabel), { onClick: function () {
						close({ choice: 'mine', text: o.mine });
					} });
					keepMine.setAttribute('data-role', 'mine');
					var keepTheirs = ui.button(o.keepTheirs || 'Keep ' + lower(o.theirsLabel), { onClick: function () {
						close({ choice: 'theirs', text: o.theirs });
					} });
					keepTheirs.setAttribute('data-role', 'theirs');
					var merge = ui.button('Merge by hand', { kind: 'primary', onClick: startMerge });
					merge.setAttribute('data-role', 'merge');
					merge.setAttribute('data-autofocus', '');
					var later = ui.button('Decide later', { kind: 'quiet', onClick: function () {
						close(undefined);
					} });
					later.setAttribute('data-role', 'cancel');
					actions.appendChild(later);
					actions.appendChild(keepMine);
					actions.appendChild(keepTheirs);
					actions.appendChild(merge);
				}
				function startMerge() {
					mine.readOnly = false;
					mineHead.textContent = 'Your merge (edit this; the other version is on the right)';
					mine.setAttribute('aria-label', 'Your merge');
					mine.focus();
					ui.clear(actions);
					var back = ui.button('Back', { onClick: function () {
						mine.value = o.mine;
						mine.readOnly = true;
						mineHead.textContent = o.mineLabel;
						choices();
					} });
					var done = ui.button('Use the merge', { kind: 'primary', onClick: function () {
						close({ choice: 'merged', text: mine.value });
					} });
					done.setAttribute('data-role', 'use-merge');
					actions.appendChild(back);
					actions.appendChild(done);
				}
				choices();
				dlg.appendChild(h('h2', { id: 'dlg-title', text: o.title }));
				dlg.appendChild(h('div', { class: 'dialog-body' }, [h('p', { text: o.intro }), diff ? h('p', { class: 'small muted', text: diff }) : null, cols]));
				dlg.appendChild(actions);
			},
			{ wide: true }
		);
	}

	// 'This device (5 min ago)' -> 'this device'; names such as 'GitHub' keep their case.
	function lower(s) {
		s = String(s).replace(/\s*\(.*\)$/, '');
		return /^(This|Draft|Live)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
	}

	function diffSummary(a, b) {
		var la = String(a).split('\n');
		var lb = String(b).split('\n');
		var inB = {};
		lb.forEach(function (l) {
			inB[l] = (inB[l] || 0) + 1;
		});
		var onlyA = 0;
		la.forEach(function (l) {
			if (inB[l]) inB[l]--;
			else onlyA++;
		});
		var onlyB = 0;
		Object.keys(inB).forEach(function (k) {
			onlyB += inB[k];
		});
		if (!onlyA && !onlyB) return 'The two versions have the same lines (in a different order, or with different spaces).';
		return onlyA + (onlyA === 1 ? ' line is' : ' lines are') + ' only on the left, ' + onlyB + (onlyB === 1 ? ' line is' : ' lines are') + ' only on the right.';
	}

	// ---- deleting ------------------------------------------------------------------------------

	function deleteDraft() {
		var ui = S.ui;
		var api = S.api;
		var doc = S.doc;
		var body = doc.draftPath
			? ['This removes ' + doc.draftPath + ' from the private repository (git history keeps it) and the copy on this device.', doc.published ? 'The published post stays on the site.' : '', 'Its images in ' + imageDir() + ' stay where they are.'].filter(Boolean)
			: ['This throws away what is on this device for this post. It is not on GitHub.'];
		ui.confirm({ title: doc.draftPath ? 'Delete this draft?' : 'Discard this?', body: body, action: doc.draftPath ? 'Delete draft' : 'Discard', danger: true }).then(function (yes) {
			if (!yes || !S || S.doc !== doc) return;
			var work = doc.draftPath ? api.store.remove(doc.draftPath, { message: 'Delete draft: ' + (doc.title.trim() || doc.draftPath) }) : Promise.resolve({ state: 'saved' });
			work.then(
				function (r) {
					return api.store.del(SPACE, localKey(doc)).then(function () {
						if (!S) return;
						S.doc = null;
						ui.toast(r && r.state === 'queued' ? 'Deleted here; GitHub hears of it when the network returns.' : 'Deleted.');
						goList();
					});
				},
				function (err) {
					ui.toast('Not deleted: ' + errText(err), { kind: 'bad' });
				}
			);
		});
	}

	// ---- publishing ------------------------------------------------------------------------------

	// Everything the commit needs, checked. -> { check, changes, paths, plan, sources, body, rename }
	function preparePublish(doc) {
		var api = S.api;
		var gh = api.gh;
		var refs = P.privateImages(doc.body);
		var sources = {}; // private path -> bytes
		var shas = {}; // private path -> blob sha
		var missing = [];
		return gh
			.tree('site', { refresh: true })
			.then(function (tree) {
				var siteFiles = {};
				var existing = {};
				tree.forEach(function (t) {
					if (t.type === 'dir') return;
					siteFiles[t.path] = t.sha;
					var m = /^blog\/posts\/([^/]+\.md)$/i.exec(t.path);
					if (m) existing[P.slugFromFile(m[1])] = m[1];
				});
				return Promise.all(
					refs.map(function (p) {
						return imageBytes(p).then(
							function (bytes) {
								if (!bytes) {
									missing.push(p);
									return;
								}
								sources[p] = bytes;
								return gh.blobSha(bytes).then(function (sha) {
									shas[p] = sha;
								});
							},
							function (err) {
								if (err && err.name === 'NotFound') missing.push(p);
								else throw err;
							}
						);
					})
				).then(function () {
					return { siteFiles: siteFiles, existing: existing };
				});
			})
			.then(function (site) {
				// An earlier attempt whose answer was lost: if the site holds
				// exactly what it wrote, it went through. The post is live there,
				// and this attempt (the text perhaps edited since) is an update
				// of it, not a new post fighting its own address.
				var att = S.publishAttempt;
				var adopted = false;
				if (att && att.key === doc.key && att.sha && site.siteFiles[att.path] === att.sha) {
					adopted = true;
					S.publishAttempt = null;
					doc.published = att.path;
					doc.publishedSha = att.sha;
					if (doc.slugAuto) {
						doc.slug = P.slugFromFile(att.path);
						doc.slugAuto = false;
					}
					refreshEditorFields();
					if (S.doc === doc) clearLost('publish');
				}
				var slug = doc.slug.trim();
				var okRefs = refs.filter(function (p) {
					return !!sources[p];
				});
				var plan = P.isValidSlug(slug)
					? P.planImages(
							okRefs,
							slug,
							function (path) {
								return site.siteFiles[path] || null;
							},
							function (priv, siteSha) {
								return shas[priv] === siteSha;
							}
					  )
					: [];
				var body = P.rewriteImages(doc.body, plan);
				var ownFile = doc.published ? doc.published.replace(/^.*\//, '') : '';
				// A published post being edited: its own file may have been removed meanwhile.
				if (ownFile && !site.siteFiles[doc.published]) ownFile = '';
				var check = P.checkPublish({
					title: doc.title,
					date: doc.date,
					summary: doc.summary,
					tags: doc.tags,
					slug: slug,
					body: body,
					existing: site.existing,
					ownFile: ownFile,
					today: S.ui.date.iso(),
					missingImages: missing,
				});
				var changes = [];
				var paths = [];
				var rename = false;
				// "Another post uses this address": is it this very post, already
				// live because an earlier publish went through although its answer
				// was lost? Then the file on the site is exactly what we would send.
				var taken = !check.ok && !ownFile && site.existing[slug] && check.errors.length === 1 && check.errors[0].code === 'slug-taken';
				if (taken) {
					var again = P.checkPublish({ title: doc.title, date: doc.date, summary: doc.summary, tags: doc.tags, slug: slug, body: body, existing: site.existing, ownFile: site.existing[slug], today: S.ui.date.iso(), missingImages: missing });
					var livePath = 'blog/posts/' + site.existing[slug];
					var imagesLive = plan.every(function (x) {
						return x.existing || site.siteFiles[x.to] === shas[x.from];
					});
					if (again.ok && again.path === livePath && imagesLive) {
						return S.api.gh.blobSha(again.text).then(function (sha) {
							var same = sha === site.siteFiles[livePath];
							return { check: same ? again : check, already: same ? sha : '', changes: [], paths: [], plan: plan, sources: sources, body: body, rename: false, ownFile: '' };
						});
					}
				}
				if (check.ok) {
					var postChange = { path: check.path, content: check.text };
					if (ownFile && check.path === doc.published) postChange.sha = doc.publishedSha || site.siteFiles[doc.published];
					else postChange.sha = null;
					changes.push(postChange);
					paths.push({ path: check.path, note: ownFile ? (check.path === doc.published ? 'the post, updated' : 'the post at its new address') : 'the new post' });
					plan.forEach(function (x) {
						if (x.existing) return;
						changes.push({ path: x.to, bytes: sources[x.from], sha: null });
						paths.push({ path: x.to, note: 'image, ' + kb(sources[x.from].length) });
					});
					if (ownFile && check.path !== doc.published) {
						rename = true;
						changes.push({ path: doc.published, remove: true, sha: doc.publishedSha || site.siteFiles[doc.published] });
						paths.push({ path: doc.published, note: 'removed: the old address' });
					}
				}
				var prep = { check: check, changes: changes, paths: paths, plan: plan, sources: sources, body: body, rename: rename, ownFile: ownFile, adopted: adopted };
				// An update whose text is on the site already (an earlier attempt
				// went through although its answer was lost): nothing to send.
				if (!check.ok || !ownFile || rename || changes.length !== 1 || !site.siteFiles[check.path]) return prep;
				return S.api.gh.blobSha(check.text).then(function (sha) {
					if (sha === site.siteFiles[check.path] && (sha !== doc.publishedSha || adopted)) prep.already = sha;
					return prep;
				});
			});
	}

	function publish() {
		if (!S || !S.doc) return;
		var ui = S.ui;
		var api = S.api;
		var doc = S.doc;
		var E = S.edit;
		var gen = S.gen;
		var settled = false; // an unsure unpublish turned out to have gone through
		var work = saveLocal()
			.then(function () {
				// An unpublish of this post may have landed without an answer.
				// Settle that first: never offer to put back a post that the
				// owner has just taken down.
				if (!unpubPending(doc, doc.published)) return;
				var path = doc.published;
				return api.gh.read('site', path).then(function (live) {
					if (!alive(gen) || S.doc !== doc) return;
					if (live) {
						// Still there: the earlier unpublish did not land.
						S.unpubPending = null;
						clearLost('unpublish');
						ui.toast('The earlier unpublish did not go through: the post is still on the site.', { kind: 'warn' });
						return;
					}
					settled = true;
					return finishUnpublish(doc, P.slugFromFile(path), 'The earlier unpublish went through: ' + path + ' is off the site, and the post is a draft again. Nothing was published; press Publish to put it back.');
				});
			})
			.then(function () {
				if (settled || !alive(gen) || S.doc !== doc) return null;
				return preparePublish(doc);
			})
			.then(function (prep) {
				if (!prep || !alive(gen) || S.doc !== doc) return;
				if (prep.adopted && !prep.already && prep.check.ok) ui.toast('An earlier publish went through although its answer was lost: the post is live at ' + prep.check.path + '. Your changes go out as an update.');
				if (prep.already) {
					ui.toast('This post is already on the site, exactly as it is here: an earlier publish went through. Nothing was sent.');
					return adoptPublished(doc, prep, prep.already, '', false);
				}
				if (!prep.check.ok) {
					showChecks(prep.check);
					return;
				}
				var go = Promise.resolve(true);
				if (prep.rename) {
					go = ui.confirm({
						title: 'Publish under a new address?',
						body: [
							'"' + P.slugFromFile(doc.published) + '" becomes "' + doc.slug + '".',
							'Links to the old address stop working, its comments stay with the old address and are no longer shown, and the view count starts again.',
						],
						action: 'Yes, change the address',
						danger: true,
					});
				}
				return go.then(function (yes) {
					if (!yes || !alive(gen)) return;
					// An update is a change to a file that is on the site now.
					return confirmAndCommit(doc, prep, !!prep.ownFile, gen);
				});
			})
			.catch(function (err) {
				if (!alive(gen)) return;
				if (err && err.name === 'Conflict') {
					publishConflict(err);
					return;
				}
				var text;
				if (unpubPending(doc, doc.published)) text = UNPUB_UNSURE + ' Nothing was published.';
				else if ((err && err.maybeCommitted) || (S.publishAttempt && S.publishAttempt.key === doc.key)) text = 'The post may or may not be live: ' + errText(err) + ' "Try again" first looks at the site, and publishes only if the post is not there.';
				else text = 'Nothing was published: ' + errText(err);
				var box = ui.errorBox(new Error(text), function () {
					if (box.parentNode) box.parentNode.removeChild(box);
					publish();
				});
				box.setAttribute('data-lost', 'publish');
				E.notices.appendChild(box);
			});
		ui.busy(E.publish, work);
		return work;
	}

	function showChecks(check) {
		var ui = S.ui;
		var h = ui.el;
		var FIELD = { title: 'w-title', date: 'w-date', summary: 'w-summary', slug: 'w-slug', 'slug-taken': 'w-slug', body: 'w-text', 'private-image': 'w-text', 'missing-image': 'w-text', 'blob-link': 'w-text', parse: 'w-title' };
		ui.dialog(function (dlg, close) {
			dlg.classList.add('w-checks');
			var ok = ui.button('Back to the post', { kind: 'primary', onClick: function () {
				close(true);
			} });
			ok.setAttribute('data-autofocus', '');
			dlg.appendChild(h('h2', { id: 'dlg-title', text: 'Not ready to publish' }));
			dlg.appendChild(
				h('div', { class: 'dialog-body' }, [
					h('p', { text: 'Nothing was sent. Fix these first:' }),
					h('ul', { class: 'w-check-list' }, check.errors.map(function (x) {
						return h('li', { class: 'is-bad', data: { code: x.code } }, [ui.icon('warning', 16), h('span', { text: x.text })]);
					})),
					check.warnings.length ? h('p', { class: 'small muted', text: 'Also worth a look:' }) : null,
					check.warnings.length ? h('ul', { class: 'w-check-list' }, check.warnings.map(function (x) {
						return h('li', { class: 'is-warn', data: { code: x.code } }, [ui.icon('info', 16), h('span', { text: x.text })]);
					})) : null,
				])
			);
			dlg.appendChild(h('div', { class: 'dialog-actions' }, [ok]));
		}).then(function () {
			if (!S || !S.edit) return;
			var id = FIELD[check.errors[0] && check.errors[0].code];
			var field = id && document.getElementById(id);
			if (field) {
				if (id !== 'w-text') S.edit.meta.open = true;
				else if (!isWide()) setPane('edit', false);
				field.focus();
			}
		});
	}

	function confirmAndCommit(doc, prep, isUpdate, gen) {
		var ui = S.ui;
		var api = S.api;
		var h = ui.el;
		var check = prep.check;
		var slug = doc.slug.trim();
		var summary = h('div', { class: 'w-pub-summary' }, [
			h('p', { class: 'publish-summary', text: (isUpdate ? 'Update "' : 'Publish "') + doc.title.trim() + '" in one commit to ' + api.site.owner + '/' + api.site.repo + ' (' + api.site.branch + ').' }),
			h('p', {}, ['Address: ', h('span', { class: 'mono', text: siteLink(slug) })]),
			check.warnings.length
				? h('ul', { class: 'w-check-list' }, check.warnings.map(function (x) {
						return h('li', { class: 'is-warn' }, [ui.icon('info', 16), h('span', { text: x.text })]);
				  }))
				: null,
			h('p', { class: 'small muted', text: 'Afterwards a GitHub Action rebuilds blog/index.json, the list of posts. The post shows in the list once it has run and Pages has deployed, usually within two minutes. This page watches for it.' }),
		]);
		var previewHost = h('div', { class: 'w-pub-preview' });
		var siteToBlob = {};
		prep.plan.forEach(function (x) {
			siteToBlob[x.to] = x.from;
		});
		var ticketP = ui.confirmPublish({
			title: isUpdate ? 'Update the post on the live site?' : 'Publish to the live site?',
			action: isUpdate ? 'Update' : 'Publish',
			paths: prep.paths,
			summary: summary,
			previewNode: previewHost,
		});
		// The dialog is in the page now: draw the post into it.
		ui.renderMarkdown(previewHost, check.text, {
			post: true,
			theme: S.previewTheme || ui.theme.get(),
			resolveUrl: function (url) {
				var clean = String(url || '').replace(/^\.?\//, '');
				return siteToBlob[clean] ? S && S.blobs[siteToBlob[clean]] : resolveUrl(url);
			},
		}).catch(function () {
			if (previewHost.isConnected) previewHost.appendChild(ui.notice('The preview could not be drawn here; the list of files above is what will be sent.', 'warn'));
		});
		return ticketP.then(function (ticket) {
			if (!ticket) {
				ui.toast('Nothing was published.');
				return;
			}
			var message = (isUpdate ? 'Update post: ' : 'Publish post: ') + doc.title.trim();
			return api.gh.commit('site', prep.changes, message, { ticket: ticket }).then(
				function (res) {
					if (!S) return;
					ui.toast(isUpdate ? 'Updated on the site.' : 'Published.');
					return adoptPublished(doc, prep, res.files[check.path], res.commit, isUpdate);
				},
				function (err) {
					// The answer was lost and GitHub could not be asked: remember
					// where the post went and what was written, so that the next
					// attempt (even with the text edited meanwhile) recognises it.
					if (!err || !err.maybeCommitted || !S) throw err;
					return api.gh.blobSha(check.text).then(
						function (sha) {
							if (S) S.publishAttempt = { key: doc.key, path: check.path, sha: sha, rename: prep.rename ? doc.published : '' };
							throw err;
						},
						function () {
							throw err;
						}
					);
				}
			);
		});
	}

	// The post is on the site: the draft becomes the published text (images
	// now on the site), says where it is, and is marked so in the private
	// repository. commitSha is '' when the commit is not known (an earlier
	// publish whose answer was lost); then nothing is watched.
	function adoptPublished(doc, prep, fileSha, commitSha, isUpdate) {
		if (!S) return;
		var ui = S.ui;
		var check = prep.check;
		var slug = doc.slug.trim();
		prep.plan.forEach(function (x) {
			if (S.blobs[x.from]) S.blobs[x.to] = S.blobs[x.from];
			if (S.bytes[x.from]) S.bytes[x.to] = S.bytes[x.from];
		});
		if (S.publishAttempt && S.publishAttempt.key === doc.key) S.publishAttempt = null;
		if (S.doc === doc) clearLost('publish');
		if (S.doc === doc) {
			doc.body = prep.body;
			doc.published = check.path;
			doc.publishedSha = fileSha || '';
			doc.slug = slug;
			doc.slugAuto = false;
			S.slugUnlocked = false;
			refreshEditorFields();
		}
		if (commitSha) startWatch({ kind: isUpdate ? 'update' : 'publish', slug: slug, commit: commitSha, entry: check.entry, oldSlug: prep.rename ? P.slugFromFile(prep.ownFile) : '' });
		// Mark the draft as published (or create it) in the private repository.
		return saveDraft({ quiet: true }).then(function (saved) {
			if (!saved && S) ui.toast('The post is live, but the draft could not be marked as published yet; "Save draft" tries again.', { kind: 'warn' });
		});
	}

	function publishConflict(err) {
		var ui = S.ui;
		var api = S.api;
		var doc = S.doc;
		ui.confirm({
			title: 'The post changed on the site',
			body: [errText(err), 'Somebody (another device, or an edit on github.com) changed it after it was opened here. Compare the two versions before publishing.'],
			action: 'Compare',
		}).then(function (yes) {
			if (!yes || !S || S.doc !== doc) return;
			var path = doc.published || (err && err.path) || '';
			if (!path || !P.isPostPath(path)) {
				ui.toast('Another post now uses this address. Choose another slug.', { kind: 'warn' });
				return;
			}
			api.gh.read('site', path).then(
				function (live) {
					if (!live) {
						ui.toast(path + ' is no longer on the site. Publishing makes it new.', { kind: 'warn' });
						doc.published = '';
						doc.publishedSha = '';
						refreshEditorFields();
						return;
					}
					compareWithLive(live, null);
				},
				function (e) {
					ui.toast('Could not read the live post: ' + errText(e), { kind: 'bad' });
				}
			);
		});
	}

	// ---- unpublishing ----------------------------------------------------------------------------

	function unpublish() {
		var ui = S.ui;
		var api = S.api;
		var gh = api.gh;
		var h = ui.el;
		var doc = S.doc;
		var gen = S.gen;
		var E = S.edit;
		var path = doc.published;
		var slug = P.slugFromFile(path);
		var withImages = h('input', { type: 'checkbox', id: 'w-unpub-images', checked: true });
		var ctx = {};
		var done = false; // the post turned out to be off the site already
		var work = Promise.all([gh.read('site', path), gh.tree('site', { refresh: true })])
			.then(function (both) {
				var live = both[0];
				if (!live) {
					// Gone already: an earlier unpublish whose answer was lost went
					// through (or it was removed elsewhere). That is what was asked for.
					done = true;
					var earlier = unpubPending(doc, path);
					return finishUnpublish(doc, slug, earlier ? 'The earlier unpublish went through: ' + path + ' is off the site. The post is a draft again, kept in the private repository.' : path + ' is not on the site any more, so there was nothing to remove. The post is a draft again, kept in the private repository.');
				}
				if (unpubPending(doc, path)) S.unpubPending = null; // still there: the earlier attempt did not land
				ctx.live = live;
				var inTree = {};
				both[1].forEach(function (t) {
					inTree[t.path] = t.sha;
				});
				ctx.images = P.siteImages(live.text).filter(function (p) {
					return p.indexOf(P.SITE_IMG_DIR + slug + '/') === 0 && inTree[p];
				});
				return ui.confirm({
					title: 'Take this post off the site?',
					body: [
						'"' + (doc.title.trim() || slug) + '" will no longer be at ' + siteLink(slug) + ' and leaves the post list once the index is rebuilt.',
						'Its comments (the GitHub Discussion "' + slug + '") stay on GitHub, and its view count stays in GoatCounter; both come back if you publish it again under the same address.',
						'It is kept as a draft in the private repository' + (ctx.images.length ? ', with its images copied there first.' : '.'),
						ctx.images.length ? h('label', { class: 'check' }, [withImages, h('span', { text: 'Also remove its ' + ctx.images.length + (ctx.images.length === 1 ? ' image' : ' images') + ' from the site' })]) : '',
					].filter(Boolean),
					action: 'Continue',
					danger: true,
				});
			})
			.then(function (yes) {
				if (done || !yes || !alive(gen) || S.doc !== doc) return;
				var removeImages = ctx.images.length && withImages.checked;
				// 1. The draft, complete with its images, in the private repository.
				return copyImagesToPrivate(ctx.images, slug).then(function (map) {
					if (!alive(gen) || S.doc !== doc) return;
					var liveDoc = docFromText(ctx.live.text, doc.key, doc.draftPath);
					var keepBody = isDirty(doc) ? doc.body : liveDoc.body;
					doc.body = P.rewriteToPrivate(keepBody, map);
					if (!isDirty(doc) || !doc.title) {
						doc.title = liveDoc.title;
						doc.summary = liveDoc.summary;
						doc.date = liveDoc.date;
						doc.tags = liveDoc.tags;
					}
					refreshEditorFields();
					return saveDraft({ quiet: true }).then(function (saved) {
						if (!saved) throw new Error('The draft could not be kept in the private repository, so the post was left on the site.');
						// 2. The commit that removes it from the site.
						var changes = [{ path: path, remove: true, sha: ctx.live.sha }];
						var paths = [{ path: path, note: 'removed' }];
						if (removeImages) {
							ctx.images.forEach(function (p) {
								changes.push({ path: p, remove: true });
								paths.push({ path: p, note: 'removed image' });
							});
						}
						return ui
							.confirmPublish({
								title: 'Unpublish from the live site?',
								action: 'Unpublish',
								paths: paths,
								summary: 'One commit to ' + api.site.owner + '/' + api.site.repo + ' that removes ' + (paths.length === 1 ? 'this file' : 'these files') + '. The draft is safe in the private repository.',
							})
							.then(function (ticket) {
								if (!ticket) {
									ui.toast('Nothing was removed from the site.');
									return;
								}
								return gh.commit('site', changes, 'Unpublish post: ' + (doc.title.trim() || slug), { ticket: ticket }).then(
									function (res) {
										if (!S) return;
										startWatch({ kind: 'unpublish', slug: slug, commit: res.commit });
										return finishUnpublish(doc, slug, 'Taken off the site. It is a draft again.');
									},
									function (err) {
										// The answer was lost and GitHub could not be asked: the
										// file may be gone. Remember it, so that the next look
										// (Try again, or the main button) settles it first.
										if (err && err.maybeCommitted && S) S.unpubPending = { key: doc.key, path: path };
										throw err;
									}
								);
							});
					});
				});
			})
			.catch(function (err) {
				if (!alive(gen)) return;
				// While an earlier attempt may have landed, any failure to look is
				// "we do not know", never "it was not unpublished".
				var unsure = (err && err.maybeCommitted) || unpubPending(doc, path);
				var box = ui.errorBox(new Error(unsure ? UNPUB_UNSURE : 'The post was not unpublished: ' + errText(err)), function () {
					if (box.parentNode) box.parentNode.removeChild(box);
					unpublish();
				});
				box.setAttribute('data-lost', 'unpublish');
				E.notices.appendChild(box);
			});
		return work;
	}

	var UNPUB_UNSURE = 'The unpublish may or may not have happened: GitHub\'s answer was lost, and GitHub could not be asked afterwards whether the post is gone. "Try again" first looks at the site: if the post is not there, the unpublish is done. The draft is safe in the private repository either way.';

	// Is there an unpublish of this post whose outcome is not known?
	function unpubPending(doc, path) {
		var p = S && S.unpubPending;
		return !!p && !!doc && p.key === doc.key && (!path || p.path === path);
	}

	// The post is off the site: the draft stops pointing at it, the main
	// button goes back to Publish, and the private draft records it.
	// Takes down the "may or may not" boxes once the question is settled.
	function clearLost(kind) {
		var host = S && S.edit && S.edit.notices;
		if (!host) return;
		Array.prototype.slice.call(host.querySelectorAll('[data-lost="' + kind + '"]')).forEach(function (n) {
			if (n.parentNode) n.parentNode.removeChild(n);
		});
	}

	function finishUnpublish(doc, slug, message) {
		if (!S) return;
		var ui = S.ui;
		if (unpubPending(doc)) S.unpubPending = null;
		if (S.doc === doc) {
			clearLost('unpublish');
			clearLost('publish');
		}
		if (S.doc === doc) {
			doc.published = '';
			doc.publishedSha = '';
			doc.slugAuto = false;
			refreshEditorFields();
		}
		ui.toast(message);
		return saveDraft({ quiet: true }).then(function (saved) {
			if (!saved && S) ui.toast('The post is off the site, but the draft could not be marked as unpublished yet; "Save draft" tries again.', { kind: 'warn' });
		});
	}

	// Copies site images into drafts/images/<slug>/. -> { sitePath: privatePath }
	function copyImagesToPrivate(images, slug) {
		var gh = S.api.gh;
		var dir = P.DRAFT_IMG_DIR + slug;
		var map = {};
		if (!images.length) return Promise.resolve(map);
		return gh
			.list('private', dir)
			.catch(function () {
				return [];
			})
			.then(function (entries) {
				var have = {};
				entries.forEach(function (e) {
					have[e.name] = e.sha;
				});
				var chain = Promise.resolve();
				images.forEach(function (sitePath) {
					chain = chain.then(function () {
						return gh.readBytes('site', sitePath).then(function (r) {
							if (!r) return;
							var name = sitePath.replace(/^.*\//, '');
							var dot = name.lastIndexOf('.');
							var n = 2;
							var target = name;
							while (have[target] && have[target] !== r.sha) target = name.slice(0, dot) + '-' + n++ + name.slice(dot);
							var priv = dir + '/' + target;
							map[sitePath] = priv;
							S.bytes[priv] = r.bytes;
							if (have[target] === r.sha) return;
							have[target] = r.sha;
							return gh.write('private', priv, r.bytes, { message: 'Keep image ' + priv + ' (unpublished)', sha: null });
						});
					});
				});
				return chain.then(function () {
					return map;
				});
			});
	}

	// ---- after a commit to the site: watch the Action and the index ------------------------

	function stopWatch() {
		if (S && S.watch) {
			clearTimeout(S.watch.timer);
			S.watch.stopped = true;
			S.watch = null;
		}
	}

	function startWatch(o) {
		stopWatch();
		var ui = S.ui;
		var api = S.api;
		var h = ui.el;
		var E = S.edit;
		if (!E) return;
		var test = !!(api.env && api.env.test);
		var w = { stopped: false, started: Date.now(), o: o, steps: {} };
		S.watch = w;
		function step(id, text) {
			var li = h('li', { data: { step: id, state: 'wait' } }, [ui.icon('dot', 18), h('div', {}, [h('span', { class: 'what', text: text }), h('span', { class: 'detail small muted' })])]);
			w.steps[id] = li;
			return li;
		}
		function set(id, state, detail, node) {
			var li = w.steps[id];
			if (!li) return;
			li.dataset.state = state;
			var icon = state === 'ok' ? 'check' : state === 'fail' ? 'warning' : state === 'run' ? 'syncing' : state === 'skip' ? 'info' : 'dot';
			li.replaceChild(ui.icon(icon, 18), li.firstChild);
			var d = li.querySelector('.detail');
			ui.clear(d);
			if (detail) d.appendChild(document.createTextNode(detail));
			if (node) {
				d.appendChild(document.createTextNode(' '));
				d.appendChild(node);
			}
		}
		var verb = o.kind === 'unpublish' ? 'removed from' : 'in';
		var list = h('ul', { class: 'checks w-watch-steps' }, [
			step('commit', 'Committed to ' + api.site.repo),
			step('action', 'The index is rebuilt by a GitHub Action'),
			step('index', 'blog/index.json on GitHub ' + (o.kind === 'unpublish' ? 'no longer lists it' : 'lists it')),
			step('live', 'The live site ' + (o.kind === 'unpublish' ? 'no longer lists it' : 'lists it')),
		]);
		var final = h('div', { class: 'w-watch-final' });
		var card = h('section', { class: 'card w-watch', id: 'w-watch', 'aria-live': 'polite' }, [
			h('div', { class: 'card-head' }, [
				h('h3', { text: o.kind === 'unpublish' ? 'Taking it off the site' : o.kind === 'update' ? 'Updating the site' : 'Publishing' }),
				ui.button('', { kind: 'quiet', icon: 'close', label: 'Hide this', onClick: function () {
					stopWatch();
					if (card.parentNode) card.parentNode.removeChild(card);
				} }),
			]),
			h('p', { class: 'small muted', text: 'Only GitHub writes blog/index.json: a GitHub Action rebuilds it after every push that touches blog/posts/, then Pages deploys the site. That usually takes one to two minutes.' }),
			list,
			final,
		]);
		ui.clear(E.watch);
		E.watch.appendChild(card);
		set('commit', 'ok', String(o.commit || '').slice(0, 7), o.commit ? h('a', { href: 'https://github.com/' + api.site.owner + '/' + api.site.repo + '/commit/' + o.commit, target: '_blank', rel: 'noopener noreferrer', text: 'see it on GitHub' }) : null);
		set('action', 'run', 'waiting for it to start...');
		set('index', 'run', 'waiting...');
		set('live', 'wait', test ? '' : 'after the index');

		var done = { action: false, index: false, live: false };
		var actionsHidden = false;
		var interval = test ? 600 : 8000;
		var limit = 15 * 60 * 1000;

		function listed(index) {
			if (!Array.isArray(index)) return false;
			var e = null;
			index.forEach(function (x) {
				if (x && x.slug === o.slug) e = x;
			});
			if (o.kind === 'unpublish') return !e;
			if (!e) return false;
			if (o.oldSlug && index.some(function (x) {
				return x && x.slug === o.oldSlug;
			})) return false;
			if (!o.entry) return true;
			return e.title === o.entry.title && e.date === o.entry.date && e.summary === o.entry.summary && JSON.stringify(e.tags || []) === JSON.stringify(o.entry.tags || []);
		}

		function checkAction() {
			if (done.action || actionsHidden) return Promise.resolve();
			return api.gh.get(api.gh.repoPath('site', '/actions/runs'), { per_page: 15, branch: api.site.branch }).then(
				function (data) {
					var runs = (data && data.workflow_runs) || [];
					var run = null;
					runs.forEach(function (r) {
						if (!run && r && r.head_sha === o.commit && (/build-blog/.test(String(r.path || '')) || r.name === 'Build blog and story indexes')) run = r;
					});
					if (!run) return;
					var link = run.html_url && /^https:\/\/github\.com\//.test(run.html_url) ? h('a', { href: run.html_url, target: '_blank', rel: 'noopener noreferrer', text: 'open the run' }) : null;
					if (run.status !== 'completed') set('action', 'run', 'running (' + String(run.status) + ')', link);
					else if (run.conclusion === 'success') {
						done.action = true;
						set('action', 'ok', 'finished', link);
					} else {
						done.action = true;
						set('action', 'fail', 'it ended with "' + String(run.conclusion) + '". The post file is on the site, but the list was not rebuilt. Open the run to see why; Settings, Actions, General needs "Read and write permissions".', link);
					}
				},
				function (err) {
					if (err && err.name === 'Forbidden') {
						actionsHidden = true;
						set('action', 'skip', 'the token cannot read Actions (optional permission "Actions: read"); watching the index instead.');
					}
					/* other errors: try again next round */
				}
			);
		}

		function checkIndex() {
			if (done.index) return Promise.resolve();
			return api.gh.readJSON('site', 'blog/index.json', []).then(
				function (index) {
					if (listed(index)) {
						done.index = true;
						set('index', 'ok', o.kind === 'unpublish' ? 'gone from the list' : 'listed');
						if (!done.action && !actionsHidden) {
							done.action = true;
							set('action', 'ok', 'finished');
						}
						if (test) {
							done.live = true;
							set('live', 'skip', 'not checked: in test mode this page is not served by the live site.');
						} else set('live', 'run', 'waiting for Pages to deploy...');
					}
				},
				function () {
					/* try again next round */
				}
			);
		}

		function checkLiveIndex() {
			if (done.live || !done.index) return Promise.resolve();
			return fetch(api.siteRoot + 'blog/index.json?desk=' + Date.now(), { cache: 'no-store', credentials: 'omit' })
				.then(function (r) {
					return r.ok ? r.json() : r.text().then(function () {
						return null;
					});
				})
				.then(
					function (index) {
						if (listed(index)) {
							done.live = true;
							set('live', 'ok', 'live');
						}
					},
					function () {
						/* try again next round */
					}
				);
		}

		function finish() {
			ui.clear(final);
			if (o.kind === 'unpublish') {
				final.appendChild(ui.notice('Done. The post is off the site and kept as a draft.', 'ok'));
				return;
			}
			var url = siteLink(o.slug);
			final.appendChild(
				ui.notice([h('p', { text: o.kind === 'update' ? 'The update is live.' : 'The post is live.' }), h('p', {}, [h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', id: 'w-live-link', class: 'mono', text: url.replace(/^https?:\/\//, '') })])], 'ok')
			);
		}

		function round() {
			if (w.stopped || !S || S.watch !== w) return;
			Promise.all([checkAction(), checkIndex()])
				.then(checkLiveIndex)
				.then(function () {
					if (w.stopped || !S || S.watch !== w) return;
					if (done.index && done.live) {
						finish();
						S.watch = null;
						return;
					}
					if (Date.now() - w.started > limit) {
						if (!done.index) set('index', 'fail', 'not after 15 minutes. Check the Actions tab on GitHub.');
						else if (!done.live) set('live', 'fail', 'not after 15 minutes. Pages may still be deploying; reload the site later.');
						if (o.kind !== 'unpublish') {
							var url = siteLink(o.slug);
							final.appendChild(h('p', { class: 'small' }, ['The post\'s address: ', h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: url })]));
						}
						S.watch = null;
						return;
					}
					w.timer = setTimeout(round, interval);
				});
		}
		w.timer = setTimeout(round, test ? 300 : 4000);
	}
})();
