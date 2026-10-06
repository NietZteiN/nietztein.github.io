/*
 * Theatre Studio, the Files panel (id 'files'): the drafts kept in this browser, real .vn files on disk, and new
 * stories scaffolded from a paper (assets/data/publications.json) or a published post. Scaffolds come from
 * scaffold.js and hold structure only, never prose (see the comment there).
 *
 * Drafts belong to the shell (studio.js), which keeps its draft list in memory. Until the shell exposes a drafts API,
 * this panel works through the shell's own controls: it opens a draft through the #st-draft select, creates one with
 * the 'file:opened' event, and renames or deletes the draft on show with the toolbar buttons, answering their
 * prompt/confirm itself. If window.Studio.drafts ever exists ({open, create, rename, remove}), it is used instead.
 *
 * Disk: with the File System Access API (Chrome, Edge) the author picks a folder once; its handle is kept in
 * IndexedDB and permission is asked again when needed. Files are only ever written through a handle the author
 * picked (a file in that folder, a file picked to open, or a "Save as" target). Elsewhere: <input type=file> and
 * a download.
 */
(function () {
	'use strict';
	var root = window, doc = document, TK = root.ToyKit, Studio = root.Studio;
	if (!Studio || typeof Studio.registerPanel !== 'function') return;
	var THUMB = !!(TK && TK.thumb);
	var FS = typeof root.showDirectoryPicker === 'function' || typeof root.showSaveFilePicker === 'function' || typeof root.showOpenFilePicker === 'function';

	// files.css and scaffold.js are this panel's; index.html belongs to the shell, so they are added from here
	(function () {
		var l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = 'files.css'; doc.head.appendChild(l);
	})();
	var scaffoldReady = new Promise(function (resolve, reject) {
		if (root.StudioScaffold) { resolve(root.StudioScaffold); return; }
		var s = doc.createElement('script'); s.src = 'scaffold.js';
		s.onload = function () { root.StudioScaffold ? resolve(root.StudioScaffold) : reject(new Error('scaffold.js loaded but defined nothing')); };
		s.onerror = function () { reject(new Error('scaffold.js could not be loaded')); };
		doc.head.appendChild(s);
	});
	scaffoldReady.catch(function () { /* reported when used */ });
	var SC = null;
	scaffoldReady.then(function (m) { SC = m; });

	function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
	function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
	function btn(text, cls, title) { var b = el('button', 'kit-btn small' + (cls ? ' ' + cls : ''), text); b.type = 'button'; if (title) b.title = title; return b; }
	function lsGet(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
	function draftText(key) { return lsGet('vn:studio:' + key); }
	function store(k, v) { if (!THUMB && TK) TK.store('panel.files.' + k, v); }
	function load(k, d) { return (!THUMB && TK) ? TK.load('panel.files.' + k, d) : d; }
	function msg(e) { return String(e && e.message || e); }
	function isAbort(e) { return e && (e.name === 'AbortError' || /aborted|cancel/i.test(msg(e))); }

	var api = null, pane = null;

	/* ---------------------------------------------------------------- IndexedDB (handles) */

	// handles cannot go through localStorage; they live in IndexedDB, with an in-memory copy for this visit
	var mem = {};
	var dbp = null;
	function db() {
		if (dbp) return dbp;
		dbp = new Promise(function (resolve, reject) {
			if (THUMB || !root.indexedDB) { reject(new Error('no IndexedDB')); return; }
			var r;
			try { r = root.indexedDB.open('vn-studio-files', 1); } catch (e) { reject(e); return; }
			r.onupgradeneeded = function () { r.result.createObjectStore('handles'); };
			r.onsuccess = function () { resolve(r.result); };
			r.onerror = function () { reject(r.error || new Error('IndexedDB refused')); };
		});
		dbp.catch(function () { /* the in-memory copy still works */ });
		return dbp;
	}
	function idb(mode, fn) {
		return db().then(function (d) {
			return new Promise(function (resolve, reject) {
				var tx = d.transaction('handles', mode), st = tx.objectStore('handles'), req = fn(st);
				tx.oncomplete = function () { resolve(req ? req.result : undefined); };
				tx.onerror = tx.onabort = function () { reject(tx.error || new Error('IndexedDB transaction failed')); };
			});
		});
	}
	function hGet(k) {
		if (mem.hasOwnProperty(k)) return Promise.resolve(mem[k]);
		return idb('readonly', function (st) { return st.get(k); }).then(function (v) { if (v) mem[k] = v; return v || null; }, function () { return null; });
	}
	function hPut(k, v) {
		mem[k] = v;
		return idb('readwrite', function (st) { st.put(v, k); return null; }).then(function () { return true; }, function () { return false; });
	}
	function hDel(k) {
		delete mem[k];
		return idb('readwrite', function (st) { st.delete(k); return null; }).then(function () { return true; }, function () { return false; });
	}

	/* ---------------------------------------------------------------- links: which draft was last written to or read from which file */

	// links[key] = { kind: 'file' | 'opened' | 'download', name, hash, at, inDir }
	//   file: a handle we may write to (in IndexedDB as 'file:<key>'); opened: read from a file with no handle;
	//   download: last downloaded under that name. hash is the text the disk has, as far as this page knows.
	var links = {};
	function saveLinks() { store('links', links); }
	function linkOf(key) { return links[key] || null; }
	function setLink(key, l) { if (l) links[key] = l; else delete links[key]; saveLinks(); drawMark(); }

	/* ---------------------------------------------------------------- the shell's drafts, through its own controls */

	function drafts() {
		var meta = {};
		((TK && !THUMB) ? (TK.load('drafts', []) || []) : []).forEach(function (d) { if (d && d.key) meta[d.key] = d; });
		var sel = $('#st-draft'), out = [];
		if (sel) [].forEach.call(sel.options, function (o) {
			var m = meta[o.value] || {};
			var text = draftText(o.value);
			out.push({ key: o.value, name: m.name || o.value, from: m.from || null, updated: m.updated || 0, text: text, bytes: text == null ? 0 : SC ? SC.byteLength(text) : text.length });
		});
		return out;
	}
	function draftName(key) {
		var d = drafts().filter(function (x) { return x.key === key; })[0];
		return d ? d.name : key;
	}
	function openDraft(key) {
		var A = Studio.drafts;
		if (A && typeof A.open === 'function') return A.open(key) !== false;
		if (api.getDraftKey() === key) return true;
		var sel = $('#st-draft');
		if (!sel || ![].some.call(sel.options, function (o) { return o.value === key; })) return false;
		sel.value = key;
		sel.dispatchEvent(new Event('change', { bubbles: true }));
		return api.getDraftKey() === key;
	}
	// a new draft opened at once; returns its key
	function createDraft(name, text) {
		var A = Studio.drafts;
		if (A && typeof A.create === 'function') return A.create(name, text);
		var before = api.getDraftKey();
		Studio.bus.emit('file:opened', { name: String(name), text: String(text) });
		var k = api.getDraftKey();
		return k && k !== before ? k : null;
	}
	// runs fn with window.prompt / window.confirm answered by `answer` (the shell's Rename and Delete ask through them)
	function answering(answer, fn) {
		var p = root.prompt, c = root.confirm;
		root.prompt = function () { return answer; };
		root.confirm = function () { return !!answer; };
		try { return fn(); } finally { root.prompt = p; root.confirm = c; }
	}
	function renameDraft(key, name) {
		var A = Studio.drafts;
		if (A && typeof A.rename === 'function') return A.rename(key, name);
		var back = api.getDraftKey();
		if (!openDraft(key)) return false;
		var b = $('#st-rename');
		if (!b) return false;
		answering(name, function () { b.click(); });
		if (back && back !== key) openDraft(back);
		return true;
	}
	function removeDraft(key) {
		var A = Studio.drafts;
		if (A && typeof A.remove === 'function') return A.remove(key);
		var back = api.getDraftKey();
		if (!openDraft(key)) return false;
		var b = $('#st-del');
		if (!b) return false;
		answering(true, function () { b.click(); });
		if (back && back !== key) openDraft(back);
		return draftText(key) == null;
	}

	/* ---------------------------------------------------------------- the panel */

	var ui = {};
	var undo = null, undoTimer = 0;

	function build(el0) {
		pane = el0;
		pane.classList.add('fl');
		pane.innerHTML = '';

		// -- drafts
		var s1 = section('Drafts in this browser', 'fl-s-drafts');
		ui.undo = el('div', 'fl-undo'); ui.undo.hidden = true;
		ui.list = el('ul', 'fl-list'); ui.list.id = 'fl-list'; ui.undo.id = 'fl-undo'; ui.list.setAttribute('aria-label', 'Drafts');
		s1.appendChild(ui.undo); s1.appendChild(ui.list);
		s1.appendChild(el('p', 'kit-note', 'Drafts save themselves in this browser as you type. The mark beside a draft says whether the file on disk has its latest text.'));

		// -- disk
		var s2 = section('Files on disk', 'fl-s-disk');
		ui.mark = el('p', 'fl-mark'); ui.mark.setAttribute('aria-live', 'polite');
		s2.appendChild(ui.mark);
		var row = el('div', 'fl-row');
		ui.save = btn('Save', 'primary', 'Write this draft to its file on disk');
		ui.saveAs = btn('Save as…', '', 'Choose a file on disk to write this draft to');
		ui.download = btn('Download .vn', '', 'Download this draft as a .vn file');
		ui.openFile = btn('Open file…', '', 'Open a .vn file from disk as a new draft');
		ui.input = el('input'); ui.input.type = 'file'; ui.input.accept = '.vn,text/plain'; ui.input.hidden = true; ui.input.className = 'fl-input';
		ui.input.setAttribute('aria-label', 'Choose a .vn file');
		[ui.save, ui.saveAs, ui.download, ui.openFile].forEach(function (b) { row.appendChild(b); });
		ui.save.id = 'fl-save'; ui.saveAs.id = 'fl-saveas'; ui.download.id = 'fl-download'; ui.openFile.id = 'fl-openfile'; ui.input.id = 'fl-input';
		row.appendChild(ui.input);
		s2.appendChild(row);
		ui.folder = el('div', 'fl-folder'); ui.folder.id = 'fl-folder';
		s2.appendChild(ui.folder);
		if (!FS) s2.appendChild(el('p', 'kit-note', 'This browser cannot write to files on disk: open a .vn with "Open file…" and keep your work with "Download .vn".'));

		// -- new story
		var s3 = section('New story from…', 'fl-s-new');
		var pRow = el('div', 'fl-row fl-pick');
		var pl = el('label', 'fl-field'); pl.appendChild(el('span', null, 'A paper'));
		ui.paper = el('select'); ui.paper.appendChild(opt('', 'Loading the publication list…'));
		pl.appendChild(ui.paper); pRow.appendChild(pl);
		ui.paperGo = btn('Scaffold', '', 'A new draft with the paper\'s title and authors and empty chapters');
		pRow.appendChild(ui.paperGo);
		s3.appendChild(pRow);
		ui.paperInfo = el('p', 'kit-note fl-info');
		s3.appendChild(ui.paperInfo);
		var bRow = el('div', 'fl-row fl-pick');
		var bl = el('label', 'fl-field'); bl.appendChild(el('span', null, 'A post'));
		ui.post = el('select'); ui.post.appendChild(opt('', 'Loading the posts…'));
		bl.appendChild(ui.post); bRow.appendChild(bl);
		ui.postGo = btn('Scaffold', '', 'A new draft with every paragraph of the post as a line to rewrite');
		bRow.appendChild(ui.postGo);
		ui.paper.id = 'fl-paper'; ui.paperGo.id = 'fl-paper-go'; ui.post.id = 'fl-post'; ui.postGo.id = 'fl-post-go';
		s3.appendChild(bRow);
		s3.appendChild(el('p', 'kit-note', 'A paper scaffold holds the title and authors exactly as the publication list has them, and empty chapters made of comments. A post scaffold holds the post\'s own paragraphs, each with its ¶ chip. Nothing else is written for you.'));

		wire();
	}
	function section(title, cls) {
		var s = el('section', 'fl-sec ' + cls);
		var h = el('h3', 'fl-h', title);
		s.appendChild(h);
		pane.appendChild(s);
		return s;
	}
	function opt(v, t) { var o = el('option', null, t); o.value = v; return o; }

	/* ---- the draft list ---- */

	function drawList() {
		if (!ui.list) return;
		var active = api.getDraftKey(), now = Date.now();
		var list = drafts().filter(function (d) { return d.text != null; }).sort(function (a, b) { return (b.updated - a.updated) || a.name.localeCompare(b.name); });
		var focusedKey = doc.activeElement && pane.contains(doc.activeElement) ? doc.activeElement.getAttribute('data-key') : null;
		var focusedAct = focusedKey ? doc.activeElement.getAttribute('data-act') : null;
		ui.list.innerHTML = '';
		if (!list.length) { ui.list.appendChild(el('li', 'st-empty', 'No drafts yet.')); return; }
		list.forEach(function (d) {
			var li = el('li', 'fl-item' + (d.key === active ? ' is-active' : ''));
			li.setAttribute('data-key', d.key);
			var open = el('button', 'fl-name');
			open.type = 'button';
			open.setAttribute('data-key', d.key); open.setAttribute('data-act', 'open');
			open.title = d.key === active ? 'This draft is open' : 'Open this draft';
			if (d.key === active) open.setAttribute('aria-current', 'true');
			open.appendChild(el('b', null, d.name));
			if (d.name !== d.key) open.appendChild(el('span', 'fl-key', d.key));
			li.appendChild(open);
			var l = linkOf(d.key), st = SC ? SC.diskState(l, d.key === active ? api.getText() : d.text) : 'none';
			var meta = el('span', 'fl-meta');
			meta.appendChild(el('span', null, SC ? SC.formatBytes(d.bytes) : d.bytes + ' B'));
			var when = SC ? SC.relTime(d.updated, now) : '';
			if (when) { var t = el('span', null, when); t.title = new Date(d.updated).toLocaleString(); meta.appendChild(t); }
			if (l) {
				var m = el('span', 'fl-disk is-' + st, (st === 'saved' ? '' : '● ') + l.name);
				m.title = diskWords(l, st);
				meta.appendChild(m);
			}
			li.appendChild(meta);
			var acts = el('span', 'fl-acts');
			[['rename', 'Rename'], ['dup', 'Duplicate'], ['del', 'Delete']].forEach(function (a) {
				var b = el('button', 'fl-act', a[1]); b.type = 'button';
				b.setAttribute('data-key', d.key); b.setAttribute('data-act', a[0]);
				b.setAttribute('aria-label', a[1] + ' ' + d.name);
				acts.appendChild(b);
			});
			li.appendChild(acts);
			ui.list.appendChild(li);
		});
		if (focusedKey) {
			var f = ui.list.querySelector('[data-key="' + cssEsc(focusedKey) + '"][data-act="' + focusedAct + '"]');
			if (f) f.focus();
		}
	}
	function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
	function diskWords(l, st) {
		var at = l.at ? ' (' + new Date(l.at).toLocaleString() + ')' : '';
		if (l.kind === 'file') return st === 'saved' ? 'Saved: ' + l.name + ' on disk has this text' + at : 'Not saved: changed since the last save to ' + l.name + at;
		if (l.kind === 'download') return st === 'saved' ? 'Downloaded as ' + l.name + at + '; no change since' : 'Changed since it was downloaded as ' + l.name + at;
		return st === 'saved' ? 'Same text as ' + l.name + ' when it was opened' + at : 'Changed since ' + l.name + ' was opened' + at + '; Save as or Download to keep it on disk';
	}

	function onListClick(e) {
		var b = e.target.closest ? e.target.closest('button[data-act]') : null;
		if (!b || !ui.list.contains(b)) return;
		var key = b.getAttribute('data-key'), act = b.getAttribute('data-act');
		if (act === 'open') {
			if (!openDraft(key)) api.toast('Could not open the draft “' + key + '”.');
			drawList();
		} else if (act === 'rename') startRename(key, b.closest('li'));
		else if (act === 'dup') {
			var text = draftText(key);
			if (text == null) return;
			var k = createDraft(draftName(key) + ' copy', text);
			if (k) { api.setStatus('Duplicated ' + key + ' as ' + k + '.'); }
			drawList();
		} else if (act === 'del') doDelete(key);
	}

	// rename in place: the name becomes a text field; Enter keeps it, Escape cancels
	function startRename(key, li) {
		if (!li) return;
		var nameBtn = li.querySelector('.fl-name');
		var input = el('input', 'kit-input fl-rename');
		input.value = draftName(key);
		input.setAttribute('aria-label', 'New name for ' + key + ' (Enter keeps it, Escape cancels)');
		li.replaceChild(input, nameBtn);
		input.focus(); input.select();
		var done = false;
		function finish(keep) {
			if (done) return; done = true;
			var n = String(input.value).trim().slice(0, 80);
			if (keep && n && n !== draftName(key)) {
				renameDraft(key, n);
				api.setStatus('Renamed ' + key + ' to “' + n + '”.');
			}
			drawList();
			var f = ui.list.querySelector('[data-key="' + cssEsc(key) + '"][data-act="rename"]'); if (f) f.focus();
		}
		input.addEventListener('keydown', function (e) {
			if (e.key === 'Enter') { e.preventDefault(); finish(true); }
			else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
		});
		input.addEventListener('blur', function () { finish(true); });
	}

	function doDelete(key) {
		var text = draftText(key);
		if (text == null) return;
		var name = draftName(key), l = linkOf(key), handleKey = 'file:' + key;
		var handle = mem[handleKey] || null;
		if (!removeDraft(key)) { api.toast('Could not delete ' + key + '.'); return; }
		setLink(key, null);
		hDel(handleKey);
		undo = { key: key, name: name, text: text, link: l, handle: handle };
		clearTimeout(undoTimer);
		ui.undo.innerHTML = '';
		ui.undo.appendChild(el('span', null, 'Deleted “' + name + '”. '));
		var u = btn('Undo', '', 'Bring the draft back');
		u.addEventListener('click', doUndo);
		ui.undo.appendChild(u);
		ui.undo.hidden = false;
		undoTimer = setTimeout(function () { undo = null; ui.undo.hidden = true; }, 30000);
		api.setStatus('Deleted the draft ' + key + '. Undo is in the Files panel for 30 seconds.');
		drawList();
		u.focus();
	}
	function doUndo() {
		if (!undo) return;
		var u = undo; undo = null;
		clearTimeout(undoTimer);
		ui.undo.hidden = true;
		var k = createDraft(u.name, u.text);
		if (!k) { api.toast('Could not bring the draft back.'); return; }
		if (u.name !== k && u.name !== draftName(k)) renameDraft(k, u.name);
		if (u.link) setLink(k, u.link);
		if (u.handle) hPut('file:' + k, u.handle);
		api.setStatus('Brought back “' + u.name + '” as ' + k + '.');
		drawList();
	}

	/* ---- the disk mark ---- */

	var statusMark = null;
	function drawMark() {
		var key = api && api.getDraftKey();
		if (!key) return;
		var l = linkOf(key), st = SC ? SC.diskState(l, api.getText()) : 'none';
		var words = !l ? 'Not on disk yet: kept in this browser only.' : diskWords(l, st) + '.';
		if (ui.mark) {
			ui.mark.textContent = '';
			var dot = el('span', 'fl-dot is-' + st); dot.setAttribute('aria-hidden', 'true');
			ui.mark.appendChild(dot);
			ui.mark.appendChild(doc.createTextNode(words));
		}
		if (ui.save) {
			ui.save.disabled = false;
			ui.save.title = l && l.kind === 'file' ? 'Write this draft to ' + l.name : FS ? 'Choose a file to save this draft to' : 'Download this draft';
		}
		// a small mark in the status line too, since this pane is often hidden
		if (!statusMark) {
			var bar = $('#st-status'), saved = $('#st-saved');
			if (bar) {
				statusMark = el('span', 'kit-note fl-statusmark kit-nothumb');
				statusMark.id = 'fl-statusmark';
				bar.insertBefore(statusMark, saved || null);
			}
		}
		if (statusMark) {
			statusMark.textContent = !l ? '' : st === 'saved' ? l.name + ' ✓' : l.name + ' ●';
			statusMark.className = 'kit-note fl-statusmark kit-nothumb is-' + st;
			statusMark.title = l ? diskWords(l, st) : '';
			statusMark.setAttribute('data-state', st);
		}
	}

	/* ---- disk: save, save as, download, open ---- */

	function currentName() {
		var key = api.getDraftKey(), l = linkOf(key);
		return l && l.name ? l.name : SC.fileName(draftName(key));
	}
	function permitted(handle, write) {
		var o = { mode: write ? 'readwrite' : 'read' };
		if (!handle || typeof handle.queryPermission !== 'function') return Promise.resolve(true);
		return Promise.resolve(handle.queryPermission(o)).then(function (p) {
			if (p === 'granted') return true;
			if (typeof handle.requestPermission !== 'function') return false;
			return Promise.resolve(handle.requestPermission(o)).then(function (q) { return q === 'granted'; });
		});
	}
	function writeTo(handle, text) {
		return permitted(handle, true).then(function (ok) {
			if (!ok) throw new Error('Permission to write ' + handle.name + ' was not given.');
			return handle.createWritable();
		}).then(function (w) {
			return Promise.resolve(w.write(text)).then(function () { return w.close(); });
		});
	}
	function inFolder(handle) {
		return hGet('dir').then(function (dir) {
			if (!dir || typeof dir.resolve !== 'function') return false;
			return Promise.resolve(dir.resolve(handle)).then(function (p) { return !!(p && p.length); }, function () { return false; });
		});
	}
	function save() {
		var key = api.getDraftKey(), l = linkOf(key);
		if (!key) return Promise.resolve(false);
		if (!(l && l.kind === 'file')) return FS ? saveAs() : download();
		return hGet('file:' + key).then(function (h) {
			if (!h) return saveAs();
			var text = api.getText();
			return writeTo(h, text).then(function () {
				setLink(key, { kind: 'file', name: h.name, hash: SC.hash(text), at: Date.now(), inDir: !!l.inDir });
				Studio.bus.emit('file:saved', { name: h.name });
				drawList();
				return true;
			});
		}).catch(diskFail('save'));
	}
	function saveAs() {
		var key = api.getDraftKey();
		if (!key) return Promise.resolve(false);
		if (typeof root.showSaveFilePicker !== 'function') return download();
		var text = api.getText();
		return hGet('dir').then(function (dir) {
			var o = { suggestedName: currentName(), types: [{ description: 'Paper Theatre script', accept: { 'text/plain': ['.vn'] } }] };
			if (dir) o.startIn = dir;
			return Promise.resolve(root.showSaveFilePicker(o)).catch(function (e) {
				// an old handle as startIn can be refused; ask once more without it
				if (o.startIn && !isAbort(e)) { delete o.startIn; return root.showSaveFilePicker(o); }
				throw e;
			});
		}).then(function (h) {
			return writeTo(h, text).then(function () { return inFolder(h); }).then(function (inDir) {
				hPut('file:' + key, h);
				setLink(key, { kind: 'file', name: h.name, hash: SC.hash(text), at: Date.now(), inDir: inDir });
				Studio.bus.emit('file:saved', { name: h.name });
				drawList();
				if (inDir) listFolder(false);
				return true;
			});
		}).catch(diskFail('save'));
	}
	function download() {
		var key = api.getDraftKey();
		if (!key) return Promise.resolve(false);
		var text = api.getText(), name = currentName();
		if (TK && TK.download) TK.download(name, text, 'text/plain;charset=utf-8');
		var l = linkOf(key);
		if (!l || l.kind !== 'file') setLink(key, { kind: 'download', name: name, hash: SC.hash(text), at: Date.now() });
		api.setStatus('Downloaded ' + name + '.');
		drawList();
		return Promise.resolve(true);
	}
	function diskFail(what) {
		return function (e) {
			if (isAbort(e)) return false;
			api.toast('Could not ' + what + ': ' + msg(e));
			api.setStatus('Could not ' + what + ': ' + msg(e));
			return false;
		};
	}

	// a file's text arrives: reuse the draft already linked to that file when there is one, else a new draft
	function opened(name, text, handle, inDir) {
		text = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
		var h = SC.hash(text);
		var existing = Object.keys(links).filter(function (k) {
			var l = links[k];
			return l && l.name === name && (l.kind === 'file' || l.kind === 'opened') && !!l.inDir === !!inDir && draftText(k) != null;
		})[0];
		if (existing) {
			var cur = draftText(existing), l = links[existing];
			openDraft(existing);
			if (cur === text) { api.setStatus('Opened ' + name + ' (the draft ' + existing + ' already has its text).'); }
			else if (SC.diskState(l, cur) === 'saved') {
				api.setText(text);
				api.setStatus('Opened ' + name + ': the file had changed on disk, so the draft ' + existing + ' now has the file\'s text.');
			} else {
				api.toast('The draft ' + existing + ' has changes that are not in ' + name + ', and the file differs too. The draft was kept; use Save to write it, or open the file elsewhere.');
				drawList();
				return existing;
			}
			setLink(existing, { kind: handle ? 'file' : 'opened', name: name, hash: h, at: Date.now(), inDir: !!inDir });
			if (handle) hPut('file:' + existing, handle);
			drawList();
			return existing;
		}
		var key = createDraft(name, text);
		if (!key) { api.toast('Could not make a draft of ' + name + '.'); return null; }
		setLink(key, { kind: handle ? 'file' : 'opened', name: name, hash: h, at: Date.now(), inDir: !!inDir });
		if (handle) hPut('file:' + key, handle);
		drawList();
		return key;
	}
	function openFile() {
		if (typeof root.showOpenFilePicker !== 'function') { ui.input.value = ''; ui.input.click(); return Promise.resolve(null); }
		return hGet('dir').then(function (dir) {
			var o = { multiple: false, types: [{ description: 'Paper Theatre script', accept: { 'text/plain': ['.vn'] } }] };
			if (dir) o.startIn = dir;
			return root.showOpenFilePicker(o);
		}).then(function (hs) {
			var h = hs && hs[0];
			if (!h) return null;
			return Promise.all([h.getFile(), inFolder(h)]).then(function (r) {
				return r[0].text().then(function (t) { return opened(h.name, t, h, r[1]); });
			});
		}).catch(diskFail('open the file'));
	}
	function onInput() {
		var f = ui.input.files && ui.input.files[0];
		if (!f) return;
		var read = typeof f.text === 'function' ? f.text() : new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; r.readAsText(f); });
		read.then(function (t) { opened(f.name, t, null, false); }).catch(diskFail('read ' + f.name));
	}

	/* ---- the stories folder ---- */

	var folderFiles = [];
	function drawFolder(state, dir) {
		var box = ui.folder;
		box.innerHTML = '';
		if (typeof root.showDirectoryPicker !== 'function') return;
		var row = el('div', 'fl-row');
		if (state === 'none') {
			var b = btn('Open folder…', '', 'Pick the stories folder once; its .vn files are listed here and Save writes back to them');
			b.addEventListener('click', pickFolder);
			row.appendChild(b);
			row.appendChild(el('span', 'kit-note', 'Pick your stories folder (misc/55-paper-theatre/stories in your copy of the site).'));
			box.appendChild(row);
			return;
		}
		row.appendChild(el('span', 'fl-dirname', dir.name + '/'));
		if (state === 'ask') {
			var r = btn('Reconnect', 'primary', 'Ask the browser again for access to ' + dir.name);
			r.addEventListener('click', function () { permitted(dir, true).then(function (ok) { if (ok) listFolder(false); else api.toast('Access to ' + dir.name + ' was not given.'); }).catch(diskFail('reconnect')); });
			row.appendChild(r);
		} else {
			var rf = btn('Refresh', '', 'List the folder again');
			rf.addEventListener('click', function () { listFolder(false); });
			row.appendChild(rf);
		}
		var other = btn('Other folder…', '', 'Pick a different folder');
		other.addEventListener('click', pickFolder);
		var forget = btn('Forget', '', 'Forget this folder (the files stay as they are)');
		forget.addEventListener('click', function () {
			hDel('dir');
			Object.keys(links).forEach(function (k) { if (links[k].inDir) { links[k].inDir = false; } });
			saveLinks();
			folderFiles = [];
			drawFolder('none');
		});
		row.appendChild(other); row.appendChild(forget);
		box.appendChild(row);
		if (state === 'ask') { box.appendChild(el('p', 'kit-note', 'The browser needs your permission again to read and write this folder.')); return; }
		var ul = el('ul', 'fl-files'); ul.setAttribute('aria-label', 'The .vn files in ' + dir.name);
		if (!folderFiles.length) ul.appendChild(el('li', 'st-empty', 'No .vn files in this folder.'));
		folderFiles.forEach(function (f) {
			var li = el('li');
			var b = el('button', 'fl-file', f.name); b.type = 'button';
			b.title = 'Open ' + f.name + ' as a draft';
			var linked = Object.keys(links).filter(function (k) { var l = links[k]; return l.inDir && l.kind === 'file' && l.name === f.name && draftText(k) != null; })[0];
			if (linked) {
				var st = SC.diskState(links[linked], linked === api.getDraftKey() ? api.getText() : draftText(linked));
				b.appendChild(el('span', 'fl-disk is-' + st, st === 'saved' ? ' draft ' + linked : ' ● draft ' + linked));
			}
			b.addEventListener('click', function () {
				permitted(f.handle, false).then(function (ok) {
					if (!ok) throw new Error('Permission to read ' + f.name + ' was not given.');
					return f.handle.getFile();
				}).then(function (file) { return file.text(); }).then(function (t) { opened(f.name, t, f.handle, true); drawFolder('ok', dir); })
					.catch(diskFail('open ' + f.name));
			});
			li.appendChild(b);
			ul.appendChild(li);
		});
		box.appendChild(ul);
	}
	function pickFolder() {
		return Promise.resolve().then(function () { return root.showDirectoryPicker({ id: 'vn-stories', mode: 'readwrite' }); }).then(function (dir) {
			return hPut('dir', dir).then(function () { return listFolder(false); });
		}).catch(diskFail('open the folder'));
	}
	// quiet: on load, do not ask for permission (that needs a click); show Reconnect instead
	function listFolder(quiet) {
		return hGet('dir').then(function (dir) {
			if (!dir) { drawFolder('none'); return; }
			var q = typeof dir.queryPermission === 'function' ? Promise.resolve(dir.queryPermission({ mode: 'readwrite' })) : Promise.resolve('granted');
			return q.then(function (p) {
				if (p !== 'granted') {
					if (quiet) { drawFolder('ask', dir); return; }
					return permitted(dir, true).then(function (ok) { if (!ok) { drawFolder('ask', dir); return; } return readFolder(dir); });
				}
				return readFolder(dir);
			});
		}).catch(function (e) { drawFolder('none'); if (!quiet) diskFail('list the folder')(e); });
	}
	function readFolder(dir) {
		var found = [];
		var it = dir.values();
		function next() {
			return Promise.resolve(it.next()).then(function (r) {
				if (r.done) return;
				if (r.value && r.value.kind === 'file') found.push(r.value);
				return next();
			});
		}
		return next().then(function () {
			var byName = {};
			found.forEach(function (h) { byName[h.name] = h; });
			folderFiles = SC.vnFiles(Object.keys(byName)).map(function (n) { return { name: n, handle: byName[n] }; });
			drawFolder('ok', dir);
		});
	}

	/* ---- new story from a paper or a post ---- */

	var pubs = [], posts = [];
	function loadPubs() {
		return fetch(api.root + 'assets/data/publications.json').then(function (r) {
			if (!r.ok) { if (r.body && r.body.cancel) r.body.cancel(); throw new Error('HTTP ' + r.status); }
			return r.json();
		}).then(function (j) {
			pubs = (Array.isArray(j) ? j : []).filter(function (p) { return p && typeof p.title === 'string' && p.title; });
			ui.paper.innerHTML = '';
			ui.paper.appendChild(opt('', 'Choose a paper…'));
			pubs.forEach(function (p, i) { ui.paper.appendChild(opt(String(i), p.title)); });
		}).catch(function (e) {
			ui.paper.innerHTML = ''; ui.paper.appendChild(opt('', 'The publication list did not load'));
			ui.paperInfo.textContent = 'assets/data/publications.json did not load (' + msg(e) + ').';
		});
	}
	function loadPosts() {
		if (!TK || typeof TK.posts !== 'function') { ui.post.innerHTML = ''; ui.post.appendChild(opt('', 'No posts')); return Promise.resolve(); }
		return TK.posts().then(function (list) {
			posts = (list || []).filter(function (p) { return p && p.slug; });
			ui.post.innerHTML = '';
			ui.post.appendChild(opt('', 'Choose a post…'));
			posts.forEach(function (p) { ui.post.appendChild(opt(p.slug, (p.date ? p.date + '  ' : '') + (p.title || p.slug))); });
		}).catch(function (e) { ui.post.innerHTML = ''; ui.post.appendChild(opt('', 'The posts did not load')); api.setStatus(msg(e)); });
	}
	function showPaperInfo() {
		var p = pubs[+ui.paper.value];
		ui.paperInfo.textContent = '';
		if (!p || ui.paper.value === '') return;
		// shown here, not written into the draft: the publication list's own words, for copying into @cite by hand
		var bits = [p.authorsText, p.year, p.section, p.venue].filter(function (x) { return x != null && x !== ''; });
		ui.paperInfo.appendChild(el('span', null, 'Publication list: ' + bits.join(' · ')));
		if (p.story) ui.paperInfo.appendChild(el('span', 'fl-warnline', ' This paper already has a story (' + p.story + '); "Open example" opens it.'));
	}
	function scaffoldPaper() {
		var p = pubs[+ui.paper.value];
		if (!p || ui.paper.value === '') { api.toast('Choose a paper first.'); ui.paper.focus(); return Promise.resolve(null); }
		return scaffoldReady.then(function (S) {
			var key = createDraft(S.paperDraftName(p), S.paperScaffold(p));
			if (key) api.setStatus('A scaffold for “' + p.title + '” as the draft ' + key + ': title and authors as listed, chapters to fill. The prose is yours.');
			drawList();
			return key;
		}).catch(function (e) { api.toast('Could not scaffold: ' + msg(e)); return null; });
	}
	function scaffoldPost() {
		var slug = ui.post.value;
		if (!slug) { api.toast('Choose a post first.'); ui.post.focus(); return Promise.resolve(null); }
		var entry = posts.filter(function (p) { return p.slug === slug; })[0] || { slug: slug };
		return Promise.all([scaffoldReady, TK.post(slug)]).then(function (r) {
			var S = r[0], post = r[1], m = post.meta || {};
			var meta = { slug: slug, title: entry.title || m.title || slug, date: entry.date || m.date || '', summary: entry.summary || m.summary || '', file: entry.file || m.file || '' };
			var out = S.postScaffold(meta, post.markdown || '');
			var key = createDraft('blog-' + slug, out.text);
			if (key) api.setStatus('A scaffold of the post “' + meta.title + '” as the draft ' + key + ' (' + out.paragraphs + ' paragraphs, each with its ¶ chip).');
			drawList();
			return key;
		}).catch(function (e) { api.toast('Could not scaffold the post: ' + msg(e)); return null; });
	}

	/* ---- wiring ---- */

	function wire() {
		ui.list.addEventListener('click', onListClick);
		ui.save.addEventListener('click', function () { save(); });
		ui.saveAs.addEventListener('click', function () { saveAs(); });
		ui.download.addEventListener('click', function () { download(); });
		ui.openFile.addEventListener('click', function () { openFile(); });
		ui.input.addEventListener('change', onInput);
		if (typeof root.showSaveFilePicker !== 'function') { ui.saveAs.hidden = true; }
		ui.paper.addEventListener('change', showPaperInfo);
		ui.paperGo.addEventListener('click', function () { scaffoldPaper(); });
		ui.postGo.addEventListener('click', function () { scaffoldPost(); });
		// keys inside the pane: Delete on a draft row deletes it, F2 renames it
		pane.addEventListener('keydown', function (e) {
			var t = e.target;
			if (!t || !t.getAttribute || !t.getAttribute('data-key') || t.tagName === 'INPUT') return;
			if (e.key === 'F2') { e.preventDefault(); startRename(t.getAttribute('data-key'), t.closest('li')); }
			else if (e.key === 'Delete') { e.preventDefault(); doDelete(t.getAttribute('data-key')); }
		});
	}

	var listTimer = 0, visible = false, tick = 0;
	function soon() { clearTimeout(listTimer); listTimer = setTimeout(function () { drawMark(); if (visible) drawList(); }, 250); }

	function beforeUnload(e) {
		var key = api.getDraftKey();
		// keep the last keystrokes: the shell saves 150 ms after typing stops
		// (not in a tab that shows the draft read-only: another tab is writing it)
		if (key && !(api.isReadOnly && api.isReadOnly())) { try { var t = api.getText(); if (t !== draftText(key)) root.localStorage.setItem('vn:studio:' + key, t); } catch (x) { /* storage refused */ } }
		var unsaved = Object.keys(links).filter(function (k) {
			var l = links[k], t = k === key ? api.getText() : draftText(k);
			return t != null && SC && SC.diskState(l, t) === 'changed';
		});
		if (!unsaved.length) return;
		e.preventDefault();
		e.returnValue = 'Some drafts have changes that are not on disk yet.';
		return e.returnValue;
	}

	Studio.registerPanel({
		id: 'files',
		title: 'Files',
		order: 70,
		mount: function (el0, a) {
			api = a;
			links = load('links', {}) || {};
			if (typeof links !== 'object' || Array.isArray(links)) links = {};
			build(el0);
			if (THUMB) { ui.paper.innerHTML = ''; ui.paper.appendChild(opt('', 'Choose a paper…')); ui.post.innerHTML = ''; ui.post.appendChild(opt('', 'Choose a post…')); return {}; }
			Studio.bus.on('doc:change', soon);
			Studio.bus.on('file:opened', soon);
			root.addEventListener('beforeunload', beforeUnload);
			root.addEventListener('storage', function (e) { if (e.key && e.key.indexOf('vn:studio:') === 0) soon(); });
			scaffoldReady.then(function () { drawMark(); drawList(); }, function (e) { api.setStatus('The Files panel could not load scaffold.js: ' + msg(e)); });
			loadPubs();
			loadPosts();
			if (typeof root.showDirectoryPicker === 'function') listFolder(true); else drawFolder('none');
			return {
				show: function () {
					visible = true; drawList(); drawMark();
					clearInterval(tick); tick = setInterval(function () { if (visible && !(doc.activeElement && doc.activeElement.classList && doc.activeElement.classList.contains('fl-rename'))) drawList(); }, 30000);
				},
				hide: function () { visible = false; clearInterval(tick); },
				unmount: function () {
					Studio.bus.off('doc:change', soon); Studio.bus.off('file:opened', soon);
					root.removeEventListener('beforeunload', beforeUnload);
					clearInterval(tick);
				}
			};
		}
	});

	// for tests and the curious: the panel's state and its disk helpers (not an interface other panels should use)
	root.StudioFiles = {
		links: function () { return JSON.parse(JSON.stringify(links)); },
		drafts: function () { return drafts().map(function (d) { return { key: d.key, name: d.name, bytes: d.bytes, updated: d.updated }; }); },
		save: function () { return save(); }, saveAs: function () { return saveAs(); }, download: function () { return download(); },
		openFile: function () { return openFile(); }, pickFolder: function () { return pickFolder(); }, listFolder: function (q) { return listFolder(!!q); },
		scaffoldPaper: function () { return scaffoldPaper(); }, scaffoldPost: function () { return scaffoldPost(); },
		idb: { get: hGet, put: hPut, del: hDel, forgetMemory: function () { mem = {}; } },
		hasFS: FS
	};
})();
