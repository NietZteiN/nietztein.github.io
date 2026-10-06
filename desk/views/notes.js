// Desk view "notes": private Markdown notes in the private repository.
//
// One file per note:
//   notes/<year>/<YYYYMMDD>T<HHMMSS>Z-<slug>.md     written here
//   notes/inbox/<YYYYMMDD>T<HHMMSS>Z-<xx>.md        quick captures from Home
// with front matter
//   ---
//   created: 2026-10-05T14:03:22Z
//   updated: 2026-10-05T15:00:00Z
//   tags: [idea, reading]
//   pinned: false
//   archived: false
//   ---
//
// Everything goes through api.store (read / list / save / remove), so the view
// works offline from the device's cache and edits wait in the queue until the
// network returns. Nothing here ever writes to the public site: there is no
// call on the 'site' target anywhere in this file.
//
// Under Node the file exports its pure helpers (for desk/test/test-readinglog.mjs)
// and registers nothing.

(function (root) {
	'use strict';

	// ---- pure helpers ------------------------------------------------------------

	function chr(code) {
		return String.fromCharCode(code);
	}

	var COMBINING = new RegExp('[' + chr(0x300) + '-' + chr(0x36f) + ']', 'g');
	var APOSTROPHES = new RegExp("['" + chr(0x2018) + chr(0x2019) + chr(0x2032) + ']', 'g');
	var NOT_WORD = /[^\p{L}\p{N}]+/gu;
	var ELLIPSIS = chr(0x2026);
	var SLUG_MAX = 48;
	var TITLE_MAX = 80;

	function pad(n) {
		return (n < 10 ? '0' : '') + n;
	}

	// One spelling for comparing: no accents, lower case, full-width alike.
	function fold(text) {
		var t = String(text == null ? '' : text);
		if (t.normalize) t = t.normalize('NFKD').replace(COMBINING, '').normalize('NFKC');
		return t.toLowerCase();
	}

	// 'Sōseki's "Kokoro" -- notes' -> 'sosekis-kokoro-notes'. Letters of every
	// script stay; nothing that could name another folder (no dot, no slash).
	function slugify(text) {
		var s = fold(text).replace(APOSTROPHES, '').replace(NOT_WORD, '-').replace(/^-+|-+$/g, '');
		if (s.length > SLUG_MAX) s = s.slice(0, SLUG_MAX).replace(/-+$/, '');
		return s || 'note';
	}

	function stampOf(d) {
		return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
	}

	function utcOf(d) {
		return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
	}

	// -> 'notes/2026/20261005T140322Z-a-first-thought.md'
	function pathFor(date, title) {
		var d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
		return 'notes/' + d.getUTCFullYear() + '/' + stampOf(d) + '-' + slugify(title) + '.md';
	}

	// A line without its Markdown marks: headings, list bullets, task boxes, quotes.
	function stripMarks(line) {
		return line
			.replace(/^\s*>+\s*/, '')
			.replace(/^\s*#{1,6}\s+/, '')
			.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
			.replace(/^\[[ xX]\]\s+/, '')
			.replace(/[*`]+/g, '')
			.trim();
	}

	function firstLineIndex(lines) {
		for (var i = 0; i < lines.length; i++) if (stripMarks(lines[i])) return i;
		return -1;
	}

	// The first line that says something, without its marks, at most 80 characters.
	function titleOf(body) {
		var lines = String(body == null ? '' : body).split(/\r?\n/);
		var i = firstLineIndex(lines);
		if (i === -1) return '';
		var t = stripMarks(lines[i]).replace(/\s+/g, ' ');
		return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX) + ELLIPSIS : t;
	}

	// What follows the title, on one line.
	function excerptOf(body, max) {
		var lines = String(body == null ? '' : body).split(/\r?\n/);
		var i = firstLineIndex(lines);
		if (i === -1) return '';
		var t = lines
			.slice(i + 1)
			.map(stripMarks)
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
		var m = max || 160;
		return t.length > m ? t.slice(0, m) + ELLIPSIS : t;
	}

	// 'Idea, #Reading list' or ['Idea', 'reading list'] -> ['idea', 'reading-list']
	function cleanTags(input) {
		var list = Array.isArray(input) ? input : input == null ? [] : String(input).split(',');
		var seen = {};
		var out = [];
		list.forEach(function (t) {
			var s = String(t == null ? '' : t)
				.replace(/[\[\]#,]/g, ' ')
				.trim()
				.toLowerCase()
				.replace(/\s+/g, '-')
				.replace(/-+/g, '-')
				.replace(/^-+|-+$/g, '')
				.slice(0, 40);
			if (!s || Object.prototype.hasOwnProperty.call(seen, s)) return;
			seen[s] = true;
			out.push(s);
		});
		return out;
	}

	function truthy(v) {
		return v === true || v === 'true' || v === 'yes';
	}

	// The note's own fields first, in a fixed order; any other key that was in
	// the file is kept after them.
	function toFrontMatter(meta, oldFm) {
		var fm = {
			created: meta.created || '',
			updated: meta.updated || meta.created || '',
			tags: cleanTags(meta.tags),
			pinned: meta.pinned ? 'true' : 'false',
			archived: meta.archived ? 'true' : 'false',
		};
		Object.keys(oldFm || {}).forEach(function (k) {
			if (Object.prototype.hasOwnProperty.call(fm, k)) return;
			if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(k)) return;
			fm[k] = oldFm[k];
		});
		return fm;
	}

	// The date in a file name: 20250314T091500Z -> 2025-03-14T09:15:00Z
	function createdFromName(path) {
		var m = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(String(path || '').split('/').pop());
		return m ? m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + 'Z' : '';
	}

	// Front matter (as ui.parsePost reads it) and the path -> the note's fields.
	function metaOf(fm, path) {
		fm = fm || {};
		var created = typeof fm.created === 'string' && fm.created ? fm.created : createdFromName(path);
		var updated = typeof fm.updated === 'string' && fm.updated ? fm.updated : created;
		return {
			created: created,
			updated: updated,
			tags: cleanTags(fm.tags),
			pinned: truthy(fm.pinned),
			archived: truthy(fm.archived),
			inbox: /^notes\/inbox\//.test(String(path || '')),
		};
	}

	function sortKey(n) {
		return n.updated || n.created || '';
	}

	// opts: { show: 'all' | 'pinned' | 'inbox' | 'archived', tag, q }
	// "all" hides the archive. Pinned notes first, then the newest.
	function filterNotes(notes, opts) {
		opts = opts || {};
		var show = opts.show || 'all';
		var tag = opts.tag || '';
		var words = fold(opts.q || '')
			.split(/\s+/)
			.filter(Boolean);
		var out = (notes || []).filter(function (n) {
			if (show === 'archived') {
				if (!n.archived) return false;
			} else {
				if (n.archived) return false;
				if (show === 'pinned' && !n.pinned) return false;
				if (show === 'inbox' && !n.inbox) return false;
			}
			if (tag && (n.tags || []).indexOf(tag) === -1) return false;
			if (words.length) {
				var hay = fold((n.title || '') + '\n' + (n.body || '') + '\n' + (n.tags || []).join(' '));
				for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) === -1) return false;
			}
			return true;
		});
		out.sort(function (a, b) {
			if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
			var x = sortKey(a);
			var y = sortKey(b);
			if (x !== y) return x > y ? -1 : 1;
			return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
		});
		return out;
	}

	// [{ tag, count }] over the notes that are not archived, most used first.
	function tagCounts(notes) {
		var counts = {};
		(notes || []).forEach(function (n) {
			if (n.archived) return;
			(n.tags || []).forEach(function (t) {
				counts[t] = (Object.prototype.hasOwnProperty.call(counts, t) ? counts[t] : 0) + 1;
			});
		});
		return Object.keys(counts)
			.map(function (t) {
				return { tag: t, count: counts[t] };
			})
			.sort(function (a, b) {
				return b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0);
			});
	}

	// A note -> what the Write view starts a draft post from:
	//   { title, body, tags, date, slug }
	// A first line that is a heading becomes the title and leaves the body.
	function draftFrom(note, today) {
		var body = String((note && note.body) || '').replace(/\r\n?/g, '\n');
		var lines = body.split('\n');
		var i = firstLineIndex(lines);
		var title = '';
		var rest = body;
		if (i !== -1 && /^\s*#{1,6}\s+/.test(lines[i])) {
			title = stripMarks(lines[i]);
			rest = lines.slice(i + 1).join('\n');
		} else {
			title = titleOf(body);
		}
		rest = rest.replace(/^\s*\n/, '').replace(/^(\s*\n)+/, '').replace(/\s+$/, '');
		return {
			title: title,
			body: rest ? rest + '\n' : '',
			tags: cleanTags((note && note.tags) || []).filter(function (t) {
				return t !== 'inbox';
			}),
			date: today || '',
			slug: slugify(title),
		};
	}

	var helpers = {
		fold: fold,
		slugify: slugify,
		pathFor: pathFor,
		titleOf: titleOf,
		excerptOf: excerptOf,
		cleanTags: cleanTags,
		toFrontMatter: toFrontMatter,
		metaOf: metaOf,
		createdFromName: createdFromName,
		filterNotes: filterNotes,
		tagCounts: tagCounts,
		draftFrom: draftFrom,
	};

	if (typeof module === 'object' && module && module.exports) {
		module.exports = helpers;
		return;
	}
	if (!root || !root.Desk || !root.document) return;

	// ---- the view ------------------------------------------------------------------

	var doc = root.document;
	var CSS_HREF = 'views/notes-reading.css';
	var HANDOFF_SPACE = 'notes.handoff';
	var SPACE = 'notes';
	var CONCURRENCY = 6;

	function addStyles() {
		if (doc.querySelector('link[data-desk-css="notes-reading"]')) return;
		var link = doc.createElement('link');
		link.rel = 'stylesheet';
		link.href = CSS_HREF;
		link.setAttribute('data-desk-css', 'notes-reading');
		doc.head.appendChild(link);
	}

	var live = null; // the mounted instance, for unmount

	function mount(el, api) {
		addStyles();
		var ui = api.ui;
		var h = ui.el;
		var E = api.gh.errors;
		var gone = false;

		var st = {
			notes: [],
			byPath: {},
			show: 'all',
			tag: '',
			q: '',
			current: null, // the note open in the editor
			draft: null, // { body, tags } while the editor holds unsaved changes
			preview: false,
			cached: false,
			loaded: false,
			undo: null,
		};

		// ---- layout ----
		var search = h('input', { type: 'search', class: 'input', placeholder: 'Search notes', 'aria-label': 'Search notes', autocomplete: 'off', spellcheck: 'false' });
		var showSel = h('select', { class: 'input', 'aria-label': 'Which notes' }, [h('option', { value: 'all', text: 'All notes' }), h('option', { value: 'pinned', text: 'Pinned' }), h('option', { value: 'inbox', text: 'Inbox' }), h('option', { value: 'archived', text: 'Archive' })]);
		var newBtn = ui.button('New note', { kind: 'primary', icon: 'plus', id: 'notes-new' });
		var refreshBtn = ui.button('', { icon: 'refresh', kind: 'quiet', label: 'Sync the notes again', title: 'Sync again', id: 'notes-refresh' });
		var tagBar = h('div', { class: 'nr-tags', role: 'group', 'aria-label': 'Tags' });
		var info = h('div', { class: 'nr-info small muted', 'aria-live': 'polite' });
		var undoHost = h('div', { class: 'nr-undo-host' });
		var listHost = h('div', { class: 'nr-list', id: 'notes-list' });

		el.appendChild(h('h2', { class: 'sr-only', text: 'Notes' }));
		var ld = ui.listDetail(el, {
			label: 'Notes',
			detailLabel: 'Note',
			onClose: function () {
				leaveNote();
			},
		});
		ld.el.classList.add('nr-ld');
		ld.list.appendChild(h('div', { class: 'nr-toolbar' }, [h('div', { class: 'nr-search' }, [search]), h('div', { class: 'nr-toolrow' }, [showSel, refreshBtn, newBtn])]));
		ld.list.appendChild(tagBar);
		ld.list.appendChild(info);
		ld.list.appendChild(undoHost);
		ld.list.appendChild(listHost);
		renderEmptyDetail();

		// ---- loading ----

		function isNoteFile(entry) {
			return entry && entry.type === 'file' && entry.name.charAt(0) !== '.' && /\.md$/i.test(entry.name);
		}

		function pool(items, fn) {
			var i = 0;
			function next() {
				if (i >= items.length || gone) return Promise.resolve();
				var item = items[i++];
				return Promise.resolve(fn(item)).then(next, next);
			}
			var workers = [];
			for (var k = 0; k < Math.min(CONCURRENCY, items.length); k++) workers.push(next());
			return Promise.all(workers);
		}

		function noteFrom(path, r, entry) {
			var parsed = ui.parsePost(r ? r.text : '');
			var meta = metaOf(parsed.fm, path);
			var body = parsed.body.replace(/^\s*\n/, '');
			return {
				path: path,
				sha: r ? r.sha : entry ? entry.sha : null,
				text: r ? r.text : '',
				fm: parsed.fm,
				body: body,
				title: titleOf(body) || '(empty note)',
				excerpt: excerptOf(body),
				tags: meta.tags,
				pinned: meta.pinned,
				archived: meta.archived,
				inbox: meta.inbox,
				created: meta.created,
				updated: meta.updated,
				pending: !!(r && r.pending),
				conflict: !!(r && r.conflict),
				cached: !!(r && r.cached),
				missing: !r,
			};
		}

		function readNote(entry) {
			return api.store.read(entry.path, { prefer: 'cache' }).then(function (r) {
				// The device's copy is older than what the listing shows: ask GitHub.
				if (r && !r.pending && r.cached && entry.sha && r.sha !== entry.sha && !st.cached) {
					return api.store.read(entry.path).catch(function () {
						return r;
					});
				}
				return r;
			});
		}

		function knownPaths() {
			return api.store.get(SPACE, 'known', []).then(
				function (list) {
					return Array.isArray(list) ? list : [];
				},
				function () {
					return [];
				}
			);
		}

		// Keeps the list of note paths this device knows of up to date.
		function remember(path, present) {
			return knownPaths()
				.then(function (list) {
					var next = list.filter(function (p) {
						return p !== path;
					});
					if (present) next.push(path);
					return api.store.put(SPACE, 'known', next);
				})
				.catch(function () {});
		}

		function load() {
			info.textContent = 'Loading the notes...';
			var failed = [];
			var cachedAny = false;
			return Promise.all([api.store.list('notes'), api.store.pending().catch(function () {
				return [];
			})])
				.then(function (res) {
					var top = res[0];
					var pend = res[1];
					if (top.cached) cachedAny = true;
					var dirs = {};
					dirs['notes/inbox'] = true;
					top.forEach(function (e) {
						if (e.type === 'dir' && e.name.charAt(0) !== '.') dirs[e.path] = true;
					});
					// a note written offline in a folder GitHub does not have yet
					pend.forEach(function (p) {
						var m = /^(notes\/[^/]+)\/[^/]+$/.exec(p.path);
						if (m && !p.remove) dirs[m[1]] = true;
					});
					var files = top.filter(isNoteFile);
					return pool(Object.keys(dirs).sort(), function (dir) {
						return api.store.list(dir).then(
							function (list) {
								if (list.cached) cachedAny = true;
								list.filter(isNoteFile).forEach(function (f) {
									files.push(f);
								});
							},
							function (err) {
								if (!(err instanceof E.NotFound)) failed.push({ dir: dir, err: err });
							}
						);
					}).then(function () {
						// Offline, the device's folder listings may be older than the
						// notes it has written since: add the paths it knows of.
						return knownPaths().then(function (known) {
							var have = {};
							files.forEach(function (f) {
								have[f.path] = true;
							});
							if (cachedAny) {
								known.forEach(function (p) {
									if (have[p] || !/^notes\/.+\.md$/.test(p)) return;
									have[p] = true;
									files.push({ name: p.split('/').pop(), path: p, sha: null, size: 0, type: 'file' });
								});
							} else if (!failed.length) {
								api.store.put(SPACE, 'known', Object.keys(have)).catch(function () {});
							}
							return files;
						});
					});
				})
				.then(function (files) {
					var notes = [];
					return pool(files, function (f) {
						return readNote(f).then(
							function (r) {
								if (r === null && !f.pending) return; // deleted meanwhile
								notes.push(noteFrom(f.path, r, f));
							},
							function (err) {
								failed.push({ dir: f.path, err: err });
							}
						);
					}).then(function () {
						return notes;
					});
				})
				.then(function (notes) {
					if (gone) return;
					st.notes = notes;
					st.byPath = {};
					notes.forEach(function (n) {
						st.byPath[n.path] = n;
					});
					st.cached = cachedAny;
					st.loaded = true;
					// keep the open note's unsaved text
					if (st.current && st.byPath[st.current.path]) st.current = st.byPath[st.current.path];
					renderList();
					var archived = notes.filter(function (n) {
						return n.archived;
					}).length;
					var msg = (notes.length === 1 ? '1 note' : notes.length + ' notes') + (archived ? ' (' + archived + ' archived)' : '');
					if (cachedAny) msg += ', from this device: GitHub cannot be reached, so new notes from other devices are not here yet. Changes are kept and sent when the connection returns.';
					info.textContent = msg;
					info.classList.toggle('nr-offline', cachedAny);
					if (failed.length) {
						var first = failed[0];
						var box = ui.errorBox(new Error((failed.length === 1 ? 'One item' : failed.length + ' items') + ' could not be read (' + first.dir + '): ' + (first.err && first.err.message ? first.err.message : first.err)), function () {
							refresh();
						});
						box.classList.add('nr-load-error');
						info.appendChild(box);
					}
				});
		}

		function refresh() {
			return ui.busy(refreshBtn, load()).catch(showLoadError);
		}

		function showLoadError(err) {
			if (gone) return;
			ui.clear(info);
			var box = ui.errorBox(new Error('The notes could not be loaded. ' + (err && err.message ? err.message : String(err))), function () {
				refresh();
			});
			info.appendChild(box);
			if (!st.loaded) ui.clear(listHost);
		}

		// ---- the list ----

		function renderTags() {
			ui.clear(tagBar);
			var counts = tagCounts(st.notes);
			if (!counts.length) return;
			var make = function (tag, label, count) {
				var on = st.tag === tag;
				var b = h('button', { type: 'button', class: 'nr-chip' + (on ? ' is-on' : ''), 'aria-pressed': on ? 'true' : 'false' }, [label, count != null ? h('span', { class: 'nr-chip-n', text: String(count) }) : null]);
				b.addEventListener('click', function () {
					st.tag = on ? '' : tag;
					renderList();
				});
				return b;
			};
			tagBar.appendChild(make('', 'Every tag'));
			counts.slice(0, 30).forEach(function (c) {
				tagBar.appendChild(make(c.tag, '#' + c.tag, c.count));
			});
		}

		function renderList() {
			renderTags();
			ui.clear(listHost);
			var list = filterNotes(st.notes, { show: st.show, tag: st.tag, q: st.q });
			if (!list.length) {
				var empty = !st.notes.length ? 'No notes yet. Start one with "New note", or capture one on Home.' : st.q || st.tag ? 'No note matches.' : st.show === 'archived' ? 'The archive is empty.' : st.show === 'pinned' ? 'No pinned notes.' : st.show === 'inbox' ? 'The inbox is empty.' : 'Every note is archived.';
				listHost.appendChild(h('p', { class: 'muted nr-empty', text: empty }));
				return;
			}
			var ul = h('ul', { class: 'nr-rows', 'aria-label': list.length + ' notes' });
			list.forEach(function (n) {
				var meta = [n.updated ? ui.date.ago(n.updated) : '', n.tags.length ? n.tags.map(function (t) {
					return '#' + t;
				}).join(' ') : '', n.excerpt].filter(Boolean).join(' · ');
				var badge = n.conflict ? 'conflict' : n.pending ? 'not sent yet' : n.pinned ? 'pinned' : n.inbox ? 'inbox' : '';
				var r = ui.row({
					title: n.title,
					meta: meta,
					badge: badge,
					badgeKind: n.conflict ? 'bad' : n.pending ? 'warn' : n.pinned ? 'accent' : '',
					current: st.current && st.current.path === n.path,
					onClick: function () {
						openNote(n);
					},
				});
				r.setAttribute('data-path', n.path);
				ul.appendChild(h('li', {}, r));
			});
			listHost.appendChild(ul);
		}

		// ---- the editor ----

		var ed = null; // the editor's elements

		function renderEmptyDetail() {
			ui.clear(ld.detail);
			ld.detail.appendChild(h('div', { class: 'nr-placeholder muted' }, [ui.icon('notes', 28), h('p', { text: 'Pick a note, or start a new one.' })]));
			ed = null;
		}

		function currentText() {
			if (!ed) return null;
			return { body: ed.body.value.replace(/\r\n?/g, '\n'), tags: cleanTags(ed.tags.value) };
		}

		function trimEnd(x) {
			return String(x || '').replace(/\s+$/, '');
		}

		function isDirty() {
			if (!ed || !st.current) return false;
			var t = currentText();
			return trimEnd(t.body) !== trimEnd(st.current.body) || t.tags.join(',') !== st.current.tags.join(',');
		}

		function markDirty() {
			var d = isDirty();
			api.dirty(d);
			if (ed) {
				ed.state.textContent = d ? 'Unsaved changes' : st.current && st.current.isNew ? 'New note, not saved yet' : stateLine(st.current);
				ed.wrap.setAttribute('data-dirty', d ? 'true' : 'false');
			}
			bufferSoon();
		}

		function stateLine(n) {
			if (!n) return '';
			if (n.conflict) return 'Changed on another device too: open Home to choose which version wins.';
			if (n.pending) return 'Saved on this device; it goes to GitHub when the connection returns.';
			if (n.cached) return 'From this device (GitHub cannot be reached).';
			return n.updated ? 'Saved ' + ui.date.ago(n.updated) : 'Saved';
		}

		var bufferTimer = null;
		// The unsaved text is also kept (encrypted) on the device, so a crash or
		// a lock does not lose it.
		function bufferSoon() {
			clearTimeout(bufferTimer);
			bufferTimer = setTimeout(writeBuffer, 800);
		}

		function writeBuffer() {
			clearTimeout(bufferTimer);
			if (gone) return Promise.resolve();
			if (!isDirty()) return api.store.del(SPACE, 'buffer').catch(function () {});
			var t = currentText();
			return api.store
				.put(SPACE, 'buffer', { path: st.current.path, isNew: !!st.current.isNew, created: st.current.created, body: t.body, tags: t.tags, at: Date.now() })
				.catch(function () {});
		}

		function openNote(n) {
			if (st.current && st.current.path === n.path && ed) {
				ld.open();
				return;
			}
			var go = function () {
				st.current = n;
				st.preview = false;
				renderEditor();
				renderList();
				ld.open();
				if (!ld.isNarrow() && ed) ed.body.focus({ preventScroll: true });
			};
			if (isDirty()) saveCurrent().then(go, go);
			else go();
		}

		function newNote(body, tags) {
			var now = new Date();
			var n = {
				path: 'new:' + now.getTime(),
				isNew: true,
				sha: null,
				text: '',
				fm: {},
				body: '',
				title: 'New note',
				excerpt: '',
				tags: [],
				pinned: false,
				archived: false,
				inbox: false,
				created: utcOf(now),
				updated: '',
				pending: false,
			};
			var go = function () {
				st.current = n;
				st.preview = false;
				renderEditor();
				if (body) ed.body.value = body;
				if (tags) ed.tags.value = tags.join(', ');
				renderList();
				ld.open();
				ed.body.focus({ preventScroll: true });
				markDirty();
			};
			if (isDirty()) saveCurrent().then(go, go);
			else go();
		}

		function renderEditor() {
			var n = st.current;
			ui.clear(ld.detail);
			if (!n) return renderEmptyDetail();
			var body = h('textarea', { class: 'input nr-body', id: 'notes-body', 'aria-label': 'Note text (Markdown)', spellcheck: 'true', rows: '14' });
			body.value = n.body;
			var tags = h('input', { class: 'input', id: 'notes-tags', type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'idea, reading' });
			tags.value = n.tags.join(', ');
			var stateEl = h('p', { class: 'small muted nr-state', 'aria-live': 'polite', id: 'notes-state' });
			var writeTab = h('button', { type: 'button', class: 'nr-tab', id: 'notes-tab-write', 'aria-pressed': 'true', text: 'Write' });
			var prevTab = h('button', { type: 'button', class: 'nr-tab', id: 'notes-tab-preview', 'aria-pressed': 'false', text: 'Preview' });
			var previewHost = h('div', { class: 'nr-preview', id: 'notes-preview', hidden: true });
			var saveBtn = ui.button('Save', { kind: 'primary', icon: 'check', id: 'notes-save', title: 'Save (Ctrl+S)' });
			var pinBtn = ui.button(n.pinned ? 'Unpin' : 'Pin', { kind: 'quiet', id: 'notes-pin' });
			var archBtn = ui.button(n.archived ? 'Unarchive' : 'Archive', { kind: 'quiet', id: 'notes-archive' });
			var draftBtn = ui.button('Turn into a draft post', { kind: 'quiet', icon: 'write', id: 'notes-draft' });
			var delBtn = ui.button('Delete', { kind: 'danger', icon: 'trash', id: 'notes-delete' });
			var errHost = h('div', { class: 'nr-err' });
			var wrap = h('div', { class: 'nr-editor', data: { dirty: 'false' } }, [
				h('div', { class: 'nr-edhead' }, [h('h2', { class: 'nr-title', id: 'notes-title', text: n.isNew ? 'New note' : n.title }), stateEl]),
				h('p', { class: 'small muted nr-path' }, n.isNew ? 'Saved as notes/' + new Date().getUTCFullYear() + '/<date>-<first line>.md' : [h('span', { class: 'mono', text: n.path }), n.created ? ' · created ' + ui.date.long(n.created) : '']),
				ui.field('Tags', tags, 'Separated by commas.'),
				h('div', { class: 'nr-tabs', role: 'group', 'aria-label': 'Editor or preview' }, [writeTab, prevTab]),
				body,
				previewHost,
				errHost,
				h('div', { class: 'actions nr-actions' }, [saveBtn, pinBtn, archBtn, draftBtn, delBtn]),
			]);
			ld.detail.appendChild(wrap);
			ed = { wrap: wrap, body: body, tags: tags, state: stateEl, preview: previewHost, err: errHost, save: saveBtn, pin: pinBtn, archive: archBtn, title: wrap.querySelector('.nr-title') };
			if (n.isNew) {
				pinBtn.hidden = true;
				archBtn.hidden = true;
				delBtn.hidden = true;
			}
			stateEl.textContent = n.isNew ? 'New note, not saved yet' : stateLine(n);

			body.addEventListener('input', function () {
				markDirty();
				if (ed && st.current) ed.title.textContent = titleOf(body.value) || (st.current.isNew ? 'New note' : '(empty note)');
			});
			tags.addEventListener('input', markDirty);
			wrap.addEventListener('keydown', function (e) {
				if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
					e.preventDefault();
					saveCurrent();
				}
			});
			writeTab.addEventListener('click', function () {
				setPreview(false);
			});
			prevTab.addEventListener('click', function () {
				setPreview(true);
			});
			saveBtn.addEventListener('click', function () {
				saveCurrent();
			});
			pinBtn.addEventListener('click', function () {
				toggle('pinned', pinBtn);
			});
			archBtn.addEventListener('click', function () {
				toggle('archived', archBtn);
			});
			draftBtn.addEventListener('click', toDraft);
			delBtn.addEventListener('click', deleteCurrent);
		}

		function setPreview(on) {
			if (!ed) return;
			st.preview = on;
			ed.wrap.querySelector('#notes-tab-write').setAttribute('aria-pressed', on ? 'false' : 'true');
			ed.wrap.querySelector('#notes-tab-preview').setAttribute('aria-pressed', on ? 'true' : 'false');
			ed.body.hidden = on;
			ed.preview.hidden = !on;
			if (on) {
				var text = ed.body.value;
				if (!ed.preview.firstChild) ed.preview.appendChild(h('p', { class: 'muted small', text: 'Preparing the preview...' }));
				ui.renderMarkdown(ed.preview, text.trim() ? text : '*Nothing written yet.*', { theme: ui.theme.get() })
					.then(function () {
						var p = ed && ed.preview.querySelector('p.muted.small');
						if (p && p.parentNode === ed.preview) ed.preview.removeChild(p);
					})
					.catch(function (err) {
						if (!ed) return;
						ui.clear(ed.preview);
						ed.preview.appendChild(
							ui.errorBox(new Error('The preview could not be drawn: ' + (err && err.message ? err.message : err)), function () {
								setPreview(true);
							})
						);
					});
			} else ed.body.focus({ preventScroll: true });
		}

		function explain(err) {
			if (err instanceof E.Conflict) return 'This note changed on another device since it was read here. Your version is kept on this device; open Home to choose which version wins.';
			if (err instanceof E.Forbidden) return 'GitHub refused: the token may not ' + (err.permission ? 'use "' + err.permission + '"' : 'write to the private repository') + '. ' + err.message;
			return err && err.message ? err.message : String(err);
		}

		function showError(err, retry) {
			if (!ed) {
				ui.toast(explain(err), { kind: 'bad' });
				return;
			}
			ui.clear(ed.err);
			ed.err.appendChild(ui.errorBox(new Error(explain(err)), retry));
		}

		// Writes a note (front matter + body) through the store. -> the saved note
		function writeNote(n, body, tags, flags) {
			var now = new Date();
			var isNew = !!n.isNew;
			var path = isNew ? pathFor(now, titleOf(body)) : n.path;
			var meta = {
				created: n.created || utcOf(now),
				updated: utcOf(now),
				tags: tags,
				pinned: flags && 'pinned' in flags ? flags.pinned : n.pinned,
				archived: flags && 'archived' in flags ? flags.archived : n.archived,
			};
			var text = ui.buildPost(toFrontMatter(meta, n.fm), body);
			var opts = { message: (isNew ? 'Add a note' : 'Update a note') };
			if (isNew) opts.sha = null;
			return api.store.save(path, text, opts).then(function (r) {
				var saved = noteFrom(path, { text: text, sha: r.sha || n.sha, pending: r.state === 'queued' }, null);
				if (st.byPath[n.path]) {
					st.notes = st.notes.filter(function (x) {
						return x.path !== n.path;
					});
				}
				delete st.byPath[n.path];
				st.notes.push(saved);
				st.byPath[path] = saved;
				if (path !== n.path && !n.isNew) remember(n.path, false);
				remember(path, true);
				return { note: saved, state: r.state };
			});
		}

		function saveCurrent() {
			if (!ed || !st.current) return Promise.resolve();
			var n = st.current;
			var t = currentText();
			if (!isDirty()) return Promise.resolve();
			if (n.isNew && !t.body.trim()) {
				ui.toast('There is nothing to save yet.', { kind: 'warn' });
				return Promise.resolve();
			}
			ui.clear(ed.err);
			var p = writeNote(n, t.body, t.tags).then(
				function (res) {
					if (gone) return;
					var still = st.current === n;
					if (still) st.current = res.note;
					api.store.del(SPACE, 'buffer').catch(function () {});
					if (still && ed) {
						if (n.isNew) renderEditor();
						else {
							// the open editor keeps what was typed meanwhile
							ed.state.textContent = res.state === 'queued' ? stateLine(res.note) : 'Saved';
						}
						markDirty();
					}
					if (res.state === 'queued') ui.toast('Saved on this device. It goes to GitHub when the connection returns.', { kind: 'warn' });
					renderList();
				},
				function (err) {
					if (gone) return;
					if (err instanceof E.Conflict) {
						n.conflict = true;
						n.pending = true;
					}
					showError(err, function () {
						saveCurrent();
					});
					throw err;
				}
			);
			ui.busy(ed.save, p);
			return p;
		}

		function toggle(field, btn) {
			var n = st.current;
			if (!n || n.isNew) return;
			var t = currentText();
			var flags = {};
			flags[field] = !n[field];
			ui.clear(ed.err);
			ui.busy(
				btn,
				writeNote(n, t.body, t.tags, flags).then(
					function (res) {
						if (gone) return;
						st.current = res.note;
						renderEditor();
						markDirty();
						renderList();
						ui.toast(field === 'pinned' ? (res.note.pinned ? 'Pinned.' : 'Unpinned.') : res.note.archived ? 'Archived.' : 'Back from the archive.');
					},
					function (err) {
						showError(err, function () {
							toggle(field, btn);
						});
					}
				)
			);
		}

		function deleteCurrent() {
			var n = st.current;
			if (!n || n.isNew) return;
			var body = ed ? currentText().body : n.body;
			var tags = ed ? currentText().tags : n.tags;
			api.store.remove(n.path, { message: 'Delete a note' }).then(
				function (r) {
					if (gone) return;
					st.notes = st.notes.filter(function (x) {
						return x.path !== n.path;
					});
					delete st.byPath[n.path];
					remember(n.path, false);
					st.current = null;
					api.dirty(false);
					api.store.del(SPACE, 'buffer').catch(function () {});
					renderEmptyDetail();
					ld.close();
					renderList();
					offerUndo(n, body, tags, r.state);
				},
				function (err) {
					showError(err, deleteCurrent);
				}
			);
		}

		function offerUndo(n, body, tags, state) {
			clearUndo();
			var restore = ui.button('Undo', { kind: 'quiet', id: 'notes-undo' });
			var box = h('div', { class: 'notice notice-warn nr-undo', role: 'status' }, [ui.icon('trash', 18), h('div', {}, [h('p', { text: 'Deleted "' + n.title + '".' }), restore])]);
			var timer = setTimeout(clearUndo, 15000);
			st.undo = { box: box, timer: timer };
			restore.addEventListener('click', function () {
				var meta = { created: n.created, updated: n.updated || n.created, tags: tags, pinned: n.pinned, archived: n.archived };
				var text = ui.buildPost(toFrontMatter(meta, n.fm), body);
				// A deletion still waiting in the queue: the file is still on GitHub
				// under its old sha. One that went through: the path is free again.
				var opts = { message: 'Restore a note', sha: state === 'queued' ? n.sha || null : null };
				ui.busy(
					restore,
					api.store.save(n.path, text, opts).then(
						function (r) {
							clearUndo();
							var back = noteFrom(n.path, { text: text, sha: r.sha || null, pending: r.state === 'queued' }, null);
							st.notes.push(back);
							st.byPath[back.path] = back;
							remember(back.path, true);
							renderList();
							ui.toast('The note is back.');
						},
						function (err) {
							ui.toast('The note could not be restored: ' + explain(err), { kind: 'bad' });
						}
					)
				);
			});
			undoHost.appendChild(box);
			restore.focus({ preventScroll: true });
		}

		function clearUndo() {
			if (!st.undo) return;
			clearTimeout(st.undo.timer);
			if (st.undo.box.parentNode) st.undo.box.parentNode.removeChild(st.undo.box);
			st.undo = null;
		}

		function toDraft() {
			var n = st.current;
			if (!n) return;
			var t = currentText();
			if (!t.body.trim()) {
				ui.toast('The note is empty.', { kind: 'warn' });
				return;
			}
			var draft = draftFrom({ body: t.body, tags: t.tags }, ui.date.iso());
			draft.from = n.isNew ? '' : n.path;
			draft.at = Date.now();
			var hasWrite = (api.views ? api.views() : []).some(function (v) {
				return v.id === 'write';
			});
			// The Write view opens private drafts by path (#/write?draft=drafts/<name>.md),
			// so the note becomes such a file in the private repository: a post's
			// front matter plus "slug", the format of desk/postfile.js buildDraft().
			// Nothing is published; the owner goes on in Write.
			var slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug) && draft.slug !== 'note' ? draft.slug : '';
			var base = slug || 'note-' + ui.date.stamp().toLowerCase();
			var text = ui.buildPost({ title: draft.title, date: draft.date, tags: draft.tags, slug: slug || undefined }, draft.body);
			var btn = ed && ed.wrap.querySelector('#notes-draft');
			var save = isDirty() && !n.isNew ? saveCurrent().catch(function () {}) : Promise.resolve();
			var work = save
				.then(function () {
					return api.store.list('drafts').then(
						function (entries) {
							var taken = {};
							entries.forEach(function (e) {
								taken[e.name] = true;
							});
							var name = base + '.md';
							var k = 2;
							while (taken[name]) name = base + '-' + k++ + '.md';
							return 'drafts/' + name;
						},
						function () {
							return 'drafts/' + base + '-' + Math.random().toString(36).slice(2, 5) + '.md';
						}
					);
				})
				.then(function (path) {
					draft.path = path;
					return api.store.save(path, text, { message: 'Start a draft post from a note', sha: null });
				})
				.then(function (r) {
					api.store.put(HANDOFF_SPACE, 'draft', draft).catch(function () {});
					if (!hasWrite) {
						ui.toast('Draft saved as ' + draft.path + '. The Write view is not available here.', { kind: 'warn' });
						return;
					}
					if (r.state === 'queued') ui.toast('Draft kept on this device as ' + draft.path + '; it goes to GitHub when the connection returns.', { kind: 'warn' });
					api.nav('write', { draft: draft.path });
				})
				.catch(function (err) {
					ui.toast('Could not start a draft from the note: ' + explain(err), { kind: 'bad' });
				});
			if (btn) ui.busy(btn, work);
		}

		function leaveNote() {
			if (isDirty()) saveCurrent().catch(function () {});
			st.current = null;
			renderList();
			// keep the editor on wide screens; on a phone the list is back
		}

		// ---- events ----

		var searchTimer = null;
		search.addEventListener('input', function () {
			clearTimeout(searchTimer);
			searchTimer = setTimeout(function () {
				st.q = search.value;
				renderList();
			}, 120);
		});
		search.addEventListener('keydown', function (e) {
			if (e.key === 'Escape' && search.value) {
				search.value = '';
				st.q = '';
				renderList();
			}
		});
		showSel.addEventListener('change', function () {
			st.show = showSel.value;
			renderList();
		});
		newBtn.addEventListener('click', function () {
			newNote();
		});
		refreshBtn.addEventListener('click', function () {
			if (isDirty()) saveCurrent().catch(function () {});
			refresh();
		});
		api.on('capture', function () {
			load().catch(function () {});
		});
		api.on('lock', function () {
			if (isDirty()) return writeBuffer();
			return null;
		});

		live = {
			open: function (path) {
				if (st.byPath[path]) openNote(st.byPath[path]);
			},
			stop: function () {
				gone = true;
				clearTimeout(searchTimer);
				clearUndo();
				if (isDirty()) {
					// Leaving the view: keep the text on the device and send it.
					var t = currentText();
					var n = st.current;
					writeBuffer();
					writeNote(n, t.body, t.tags).then(
						function () {
							api.store.del(SPACE, 'buffer').catch(function () {});
						},
						function () {
							/* the buffer keeps it */
						}
					);
				}
				clearTimeout(bufferTimer);
				ed = null;
			},
		};

		// ---- start ----

		return Promise.all([load().catch(showLoadError), api.store.get(SPACE, 'buffer', null).catch(function () {
			return null;
		})]).then(function (res) {
			var buf = res[1];
			if (gone) return;
			if (buf && typeof buf.body === 'string') {
				var target = !buf.isNew && st.byPath[buf.path];
				if (target && target.body === buf.body) {
					api.store.del(SPACE, 'buffer').catch(function () {});
				} else {
					var restoreBtn = ui.button('Open it', { kind: 'quiet', id: 'notes-restore' });
					var dropBtn = ui.button('Discard', { kind: 'quiet' });
					var box = ui.notice([h('p', { text: 'Unsaved text from ' + ui.date.ago(buf.at) + ' was kept on this device.' }), h('div', { class: 'actions' }, [restoreBtn, dropBtn])], 'warn');
					undoHost.appendChild(box);
					restoreBtn.addEventListener('click', function () {
						box.parentNode.removeChild(box);
						if (target) {
							openNote(target);
							ed.body.value = buf.body;
							ed.tags.value = (buf.tags || []).join(', ');
							markDirty();
						} else newNote(buf.body, buf.tags);
					});
					dropBtn.addEventListener('click', function () {
						box.parentNode.removeChild(box);
						api.store.del(SPACE, 'buffer').catch(function () {});
					});
				}
			}
			var want = api.params && api.params.note;
			if (want && st.byPath[want]) openNote(st.byPath[want]);
		});
	}

	root.Desk.registerView({
		id: 'notes',
		title: 'Notes',
		icon: 'notes',
		order: 20,
		description: 'Private notes and the inbox, searchable offline.',
		mount: mount,
		update: function (params) {
			// #/notes?note=<path> while the view is open
			if (live && params && params.note) live.open(params.note);
		},
		unmount: function () {
			if (live) live.stop();
			live = null;
		},
	});
})(typeof window !== 'undefined' ? window : null);
