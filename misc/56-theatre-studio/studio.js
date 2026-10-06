/*
 * Theatre Studio: the frame and the bus. A writing room for Paper Theatre .vn scripts: an editor on the left, the
 * live stage (../55-paper-theatre/ in preview mode, in an iframe) on the right, panels as tabs under the editor and a
 * status line. Panels register themselves with window.Studio.registerPanel; the interface is in README.md.
 *
 * The top of this file is a set of pure helpers (window.StudioHelpers in the browser, module.exports in Node, tested
 * by test.js). The rest only runs in a browser.
 */
(function (root) {
	'use strict';

	/* ---------------------------------------------------------------- pure helpers */

	var H = {};

	H.normalize = function (text) { return String(text == null ? '' : text).replace(/\r\n?/g, '\n'); };

	H.lineCount = function (text) {
		var n = 1, s = String(text);
		for (var i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
		return n;
	};

	// 1-based line of a character offset
	H.lineOfOffset = function (text, offset) {
		var s = String(text), n = 1, end = Math.max(0, Math.min(offset | 0, s.length));
		for (var i = 0; i < end; i++) if (s.charCodeAt(i) === 10) n++;
		return n;
	};

	// offset of the first character of a 1-based line (clamped to the text)
	H.lineStart = function (text, line) {
		var s = String(text), n = 1, i = 0;
		line = Math.max(1, line | 0);
		while (n < line) {
			var j = s.indexOf('\n', i);
			if (j < 0) return s.length;
			i = j + 1; n++;
		}
		return i;
	};

	// offset just past the last character of the line (before its newline)
	H.lineEnd = function (text, line) {
		var s = String(text), st = H.lineStart(s, line), j = s.indexOf('\n', st);
		return j < 0 ? s.length : j;
	};

	H.getLine = function (text, line) {
		var s = String(text);
		if ((line | 0) > H.lineCount(s) || (line | 0) < 1) return '';
		return s.slice(H.lineStart(s, line), H.lineEnd(s, line));
	};

	// replace the whole of a 1-based line (without its newline); a line past the end is appended
	H.replaceLine = function (text, line, repl) {
		var s = String(text), count = H.lineCount(s);
		line = Math.max(1, line | 0);
		repl = String(repl == null ? '' : repl);
		if (line > count) {
			var pad = '';
			for (var k = count; k < line; k++) pad += '\n';
			return { text: s + pad + repl, start: s.length + pad.length, end: s.length + pad.length + repl.length };
		}
		var a = H.lineStart(s, line), b = H.lineEnd(s, line);
		return { text: s.slice(0, a) + repl + s.slice(b), start: a, end: a + repl.length, from: a, to: b };
	};

	// insert at an offset (or replace a selection [start, end)); returns the new text and the caret after it
	H.insertAt = function (text, start, end, ins) {
		var s = String(text);
		start = Math.max(0, Math.min(start | 0, s.length));
		end = Math.max(start, Math.min(end == null ? start : end | 0, s.length));
		ins = String(ins == null ? '' : ins);
		return { text: s.slice(0, start) + ins + s.slice(end), caret: start + ins.length };
	};

	// first 1-based line matching a string (substring) or a RegExp; 0 when none
	H.findLine = function (text, what) {
		var lines = String(text).split('\n');
		for (var i = 0; i < lines.length; i++) {
			if (what instanceof RegExp ? what.test(lines[i]) : lines[i].indexOf(what) >= 0) return i + 1;
		}
		return 0;
	};

	// a draft key from a name: lowercase letters, digits and dashes, at most 40 characters
	H.slugKey = function (name) {
		var k = String(name == null ? '' : name).toLowerCase()
			.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
		return k || 'draft';
	};

	// base, base-2, base-3 ... the first one not in `taken` (array of keys)
	H.uniqueKey = function (base, taken) {
		base = H.slugKey(base);
		var set = {};
		(taken || []).forEach(function (k) { set[k] = 1; });
		if (!set[base]) return base;
		for (var n = 2; n < 10000; n++) { var k = base.slice(0, 36) + '-' + n; if (!set[k]) return k; }
		return base + '-' + Date.now();
	};

	H.countIssues = function (issues) {
		var c = { fatal: 0, warn: 0, total: 0 };
		(issues || []).forEach(function (i) { if (i.level === 'fatal') c.fatal++; else c.warn++; c.total++; });
		return c;
	};

	H.issueSummary = function (issues) {
		var c = H.countIssues(issues), parts = [];
		if (!c.total) return 'No issues';
		if (c.fatal) parts.push(c.fatal + ' fatal');
		if (c.warn) parts.push(c.warn + (c.warn === 1 ? ' warning' : ' warnings'));
		return parts.join(' · ');
	};

	// the first issue at or after a line, wrapping round; null when there are none
	H.nextIssue = function (issues, afterLine) {
		var list = (issues || []).filter(function (i) { return i.line > 0; }).slice().sort(function (a, b) { return a.line - b.line; });
		if (!list.length) return (issues && issues[0]) || null;
		for (var i = 0; i < list.length; i++) if (list[i].line > (afterLine | 0)) return list[i];
		return list[0];
	};

	// panels by `order` (default 100), then by registration
	H.sortPanels = function (list) {
		return list.map(function (p, i) { return { p: p, i: i }; }).sort(function (a, b) {
			var oa = typeof a.p.order === 'number' ? a.p.order : 100, ob = typeof b.p.order === 'number' ? b.p.order : 100;
			return (oa - ob) || (a.i - b.i);
		}).map(function (x) { return x.p; });
	};

	H.clamp = function (v, lo, hi) { v = +v; if (!isFinite(v)) v = lo; return Math.max(lo, Math.min(hi, v)); };

	// the preview URL, relative to this folder
	H.frameSrc = function (key, opts) {
		opts = opts || {};
		var q = '?src=draft:' + encodeURIComponent(key) + '&studio=1&drafts=1';
		if (opts.theme) q += '&theme=' + opts.theme;
		if (opts.still) q += '&audio=0&paint=0&live=0&camera=0&op=0';
		return '../55-paper-theatre/' + q;
	};

	// published stories from stories/index.json, in manifest order
	H.examples = function (manifest) {
		return (Array.isArray(manifest) ? manifest : []).filter(function (m) {
			return m && m.status === 'published' && typeof m.file === 'string' && /^[\w.-]+\.vn$/.test(m.file) && m.id;
		}).map(function (m) { return { id: m.id, file: m.file, title: m.title || m.id }; });
	};

	// merge the stored draft list with the vn:studio:* keys that exist (drop entries whose text is gone, adopt orphans)
	H.reconcileDrafts = function (list, keys) {
		var have = {}, out = [], seen = {};
		(keys || []).forEach(function (k) { have[k] = 1; });
		(Array.isArray(list) ? list : []).forEach(function (d) {
			if (d && typeof d.key === 'string' && have[d.key] && !seen[d.key]) { seen[d.key] = 1; out.push({ key: d.key, name: d.name || d.key, from: d.from || null, updated: d.updated || 0 }); }
		});
		(keys || []).forEach(function (k) { if (!seen[k] && k !== 'thumb') { seen[k] = 1; out.push({ key: k, name: k, from: null, updated: 0 }); } });
		return out;
	};

	// One writer per draft. A tab that holds a draft keeps a record { tab, at } fresh (studio.js renews it every
	// LOCK_BEAT ms); a record older than `stale` ms belongs to a tab that crashed, slept or closed without letting go.
	//   'mine': this tab holds it; 'free': nobody (no record, a broken one, or a stale one); 'held': another live tab
	H.lockState = function (rec, tab, now, stale) {
		if (!rec || typeof rec !== 'object' || typeof rec.tab !== 'string' || typeof rec.at !== 'number' || !isFinite(rec.at)) return 'free';
		if (rec.tab === tab) return 'mine';
		// a clock that moved backwards (a record from the future) does not keep a draft locked for ever either
		return Math.abs(now - rec.at) < stale ? 'held' : 'free';
	};
	H.tabId = function (rand) {
		var r = typeof rand === 'function' ? rand : Math.random, s = '';
		for (var i = 0; i < 12; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(r() * 36));
		return 't-' + s;
	};

	if (typeof module === 'object' && module.exports) { module.exports = H; return; }
	root.StudioHelpers = H;

	/* ---------------------------------------------------------------- browser */

	var doc = root.document, TK = root.ToyKit, VN = root.VN;
	var THUMB = !!(TK && TK.thumb);
	var params = TK ? TK.params : new URLSearchParams(root.location.search);
	var ID = '56-theatre-studio';
	var STORIES = '../55-paper-theatre/stories/';
	// save and lint 150 ms after a key (at least every 1.5 s while typing); the stage reloads only at a pause in typing
	var DEBOUNCE = 150, MAX_WAIT = 1500, STAGE_PAUSE = 700, FOLLOW_MS = 220;
	var LOCK_BEAT = 2000, LOCK_STALE = 9000;

	function $(sel) { return doc.querySelector(sel); }
	function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
	function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
	function warn() { try { console.warn.apply(console, ['[studio]'].concat([].slice.call(arguments))); } catch (e) { /* no console */ } }
	function lsGet(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
	function lsSet(k, v) { try { root.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
	function lsDel(k) { try { root.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
	function lsDraftKeys() {
		var out = [];
		try { for (var i = 0; i < root.localStorage.length; i++) { var k = root.localStorage.key(i); if (k && k.indexOf('vn:studio:') === 0) out.push(k.slice(10)); } } catch (e) { /* none */ }
		return out.sort();
	}
	function store(k, v) { if (!THUMB && TK) TK.store(k, v); }
	function load(k, d) { return (!THUMB && TK) ? TK.load(k, d) : d; }
	function fetchText(url) {
		return fetch(url).then(function (r) {
			if (!r.ok) { if (r.body && r.body.cancel) r.body.cancel(); throw new Error('HTTP ' + r.status + ' for ' + url); }
			return r.text();
		});
	}

	/* ---- state ---- */

	var S = {
		key: null,            // the draft on show
		text: '',             // the text last committed (saved, linted, sent to the stage)
		version: 0,           // bumped on every edit
		committed: -1,        // the version last committed
		program: null, issues: [], walk: null, programVersion: -1,
		cursorLine: 1,
		stageLine: null, stageReady: false, frameFresh: false,
		follow: true,
		drafts: [],
		lock: 'own',          // 'own': this tab writes the draft; 'held': another tab had it when it opened here; 'lost': another tab took it
		booted: false
	};

	/* ---- the bus ---- */

	var handlers = {};
	var bus = {
		on: function (evt, fn) { if (typeof fn === 'function') (handlers[evt] = handlers[evt] || []).push(fn); return bus; },
		off: function (evt, fn) { var l = handlers[evt]; if (l) { var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } return bus; },
		emit: function (evt, data) {
			var l = (handlers[evt] || []).slice();
			for (var i = 0; i < l.length; i++) {
				try { l[i](data); } catch (e) { warn('a "' + evt + '" handler threw:', e); }
			}
		}
	};

	/* ---- the editor (built-in plain textarea, or a panel with id "editor") ---- */

	var editor = null;           // the implementation in use: {getText, setText, insertAtCursor, replaceLine, getCursorLine, gotoLine, focus, setIssues?}
	var editorPanel = null;      // a registered panel with id 'editor'
	var editorHost = {
		changed: function () { onEdited(); },
		cursor: function (line) { onCursor(line); }
	};

	function plainEditor(pane, host) {
		pane.innerHTML = '';
		var wrap = el('div', 'st-plain');
		var gut = el('pre', 'st-gutter'); gut.setAttribute('aria-hidden', 'true');
		var ta = el('textarea', 'st-text');
		ta.spellcheck = false; ta.autocapitalize = 'off'; ta.setAttribute('autocomplete', 'off'); ta.setAttribute('autocorrect', 'off');
		ta.setAttribute('aria-label', 'Script (.vn)'); ta.wrap = 'off';
		wrap.appendChild(gut); wrap.appendChild(ta); pane.appendChild(wrap);
		var marks = {}, lines = 0, lastLine = 1;
		function drawGutter() {
			var n = H.lineCount(ta.value), out = [];
			lines = n;
			for (var i = 1; i <= n; i++) {
				var t = marks[i] === 'fatal' ? '<b title="fatal">' + i + '</b>' : marks[i] ? '<i title="warning">' + i + '</i>' : String(i);
				out.push(i === lastLine ? '<em>' + t + '</em>' : t);
			}
			gut.innerHTML = out.join('\n');
			gut.scrollTop = ta.scrollTop;
		}
		function cursorNow() {
			var l = H.lineOfOffset(ta.value, ta.selectionStart);
			if (l !== lastLine) { lastLine = l; drawGutter(); host.cursor(l); }
		}
		ta.addEventListener('input', function () { if (H.lineCount(ta.value) !== lines) drawGutter(); host.changed(); cursorNow(); });
		ta.addEventListener('scroll', function () { gut.scrollTop = ta.scrollTop; });
		['keyup', 'click', 'select', 'focus'].forEach(function (t) { ta.addEventListener(t, cursorNow); });
		function lineHeight() { return parseFloat(getComputedStyle(ta).lineHeight) || 20; }
		function replaceRange(a, b, text) {
			// execCommand keeps the browser's undo history; setRangeText is the fallback
			ta.focus();
			ta.setSelectionRange(a, b);
			var ok = false;
			try { ok = doc.execCommand('insertText', false, text); } catch (e) { ok = false; }
			if (!ok || ta.value.slice(a, a + text.length) !== text) {
				ta.setRangeText(text, a, b, 'end');
			}
			drawGutter();
			cursorNow();
		}
		var impl = {
			getText: function () { return ta.value; },
			setText: function (text) { ta.value = H.normalize(text); ta.setSelectionRange(0, 0); ta.scrollTop = 0; lastLine = 1; drawGutter(); },
			// the whole text replaced where the reader is: caret offset and scroll kept (a read-only tab following another)
			replaceAll: function (text) {
				var top = ta.scrollTop, at = ta.selectionStart;
				ta.value = H.normalize(text);
				at = Math.min(at, ta.value.length); ta.setSelectionRange(at, at);
				ta.scrollTop = top; drawGutter(); cursorNow();
			},
			insertAtCursor: function (text) { replaceRange(ta.selectionStart, ta.selectionEnd, H.normalize(text)); },
			replaceLine: function (line, text) {
				var v = ta.value, count = H.lineCount(v);
				if (line > count) { replaceRange(v.length, v.length, H.replaceLine(v, line, text).text.slice(v.length)); return; }
				replaceRange(H.lineStart(v, line), H.lineEnd(v, line), H.normalize(text));
			},
			getCursorLine: function () { return H.lineOfOffset(ta.value, ta.selectionStart); },
			gotoLine: function (n) {
				var v = ta.value; n = H.clamp(n | 0, 1, H.lineCount(v));
				var a = H.lineStart(v, n);
				ta.focus({ preventScroll: true });
				ta.setSelectionRange(a, a);
				ta.scrollTop = Math.max(0, (n - 1) * lineHeight() - ta.clientHeight / 3);
				gut.scrollTop = ta.scrollTop;
				cursorNow();
			},
			focus: function () { ta.focus({ preventScroll: true }); },
			setIssues: function (issues) {
				marks = {};
				(issues || []).forEach(function (i) { if (i.line > 0 && marks[i.line] !== 'fatal') marks[i.line] = i.level === 'fatal' ? 'fatal' : 'warn'; });
				drawGutter();
			},
			element: ta
		};
		drawGutter();
		return impl;
	}

	var REQUIRED = ['getText', 'setText', 'insertAtCursor', 'replaceLine', 'getCursorLine', 'gotoLine'];
	function mountEditor() {
		var pane = $('#st-editor'), text = editor ? editor.getText() : S.text, line = editor ? editor.getCursorLine() : S.cursorLine;
		if (editorPanel) {
			pane.innerHTML = '';
			try {
				var impl = editorPanel.mount(pane, api, editorHost);
				var missing = REQUIRED.filter(function (m) { return !impl || typeof impl[m] !== 'function'; });
				if (missing.length) throw new Error('the editor panel returned no ' + missing.join(', '));
				editor = impl;
				editorPanel.state = 'ok';
			} catch (e) {
				warn('the editor panel failed; using the plain editor:', e);
				editorPanel.state = 'failed';
				editorPanel.error = e;
				editor = plainEditor(pane, editorHost);
				setStatus('The editor panel failed to start (' + (e && e.message || e) + '); this is the plain editor.');
			}
		} else {
			editor = plainEditor(pane, editorHost);
		}
		if (text) { editor.setText(text); if (line > 1) safeEditor('gotoLine', line); }
		if (editor.setIssues) safeEditor('setIssues', S.issues);
		if (editor.element && 'readOnly' in editor.element) editor.element.readOnly = S.lock !== 'own';
	}
	function safeEditor(method) {
		var args = [].slice.call(arguments, 1);
		try { return editor && typeof editor[method] === 'function' ? editor[method].apply(editor, args) : undefined; }
		catch (e) { warn('editor.' + method + ' threw:', e); return undefined; }
	}

	/* ---- edits, commits, autosave ---- */

	var commitTimer = 0, pendingSince = 0, stageTimer = 0;
	function onEdited() {
		if (S.lock !== 'own') return;        // a read-only tab: nothing typed here is kept (the editor refuses it anyway)
		S.version++;
		clearTimeout(commitTimer);
		// DEBOUNCE after the last key, but never more than MAX_WAIT after the first uncommitted one (steady typing):
		// the text is saved and linted while the writer types
		var now = Date.now();
		if (!pendingSince) pendingSince = now;
		commitTimer = setTimeout(function () { commit({ stage: false }); }, Math.max(0, Math.min(DEBOUNCE, pendingSince + MAX_WAIT - now)));
		// the stage plays on the page's own thread, so it reloads once typing pauses, not in the middle of it
		clearTimeout(stageTimer);
		stageTimer = setTimeout(stageAtPause, STAGE_PAUSE);
		showSaved('Editing…');
	}
	function stageAtPause() {
		stageTimer = 0;
		if (S.committed !== S.version) commit();
		else stagePost({ type: 'reload' });
	}
	function commit(opts) {
		clearTimeout(commitTimer);
		pendingSince = 0;
		if (!editor || !S.key) return;
		var withStage = !(opts && opts.stage === false);
		if (withStage) { clearTimeout(stageTimer); stageTimer = 0; }
		var text = String(safeEditor('getText') || '');
		if (!canWrite()) return;              // another tab holds the draft: this tab stopped saving (the notice says so)
		S.text = text;
		S.committed = S.version;
		saveDraftText(S.key, text);
		bus.emit('doc:change', { text: text, version: S.version });
		lint(text, S.version);
		if (withStage) stagePost({ type: 'reload' });
	}
	function saveDraftText(key, text) {
		var ok = lsSet('vn:studio:' + key, text);
		if (!THUMB) {
			syncDrafts(true);
			var d = draftByKey(key);
			if (d) { d.updated = Date.now(); store('drafts', S.drafts); }
		}
		showSaved(ok ? 'Saved in this browser' : 'Not saved: this browser refused the storage');
	}
	function showSaved(t) { var s = $('#st-saved'); if (s) s.textContent = t; }
	// the draft list is shared by every tab: read it again before writing it, so a rename in another tab is kept
	function syncDrafts(quiet) {
		if (THUMB) return;
		S.drafts = H.reconcileDrafts(load('drafts', []), lsDraftKeys());
		if (!quiet) drawDrafts();
	}

	/* ---- one writer per draft (a heartbeat record per draft in localStorage) ----
	 * Two tabs on the same draft would each save their whole text over the other's. So the tab that opens a draft
	 * claims it with { tab, at } under toy.56-theatre-studio.lock.<draft> and renews that every LOCK_BEAT ms. A tab
	 * that opens a draft another live tab holds shows it read-only, follows that tab's saves, and offers "Take over".
	 * A tab whose draft was taken stops saving at once (it checks before every save and hears the storage event) and
	 * says so; text it had not saved yet can be kept as a copy. A record not renewed for LOCK_STALE ms (a crashed or
	 * long-asleep tab) counts as free. Closing or reloading a tab lets go of its draft. */

	var LOCKS = !THUMB && !!TK;
	var TAB = H.tabId();
	var lockTimer = 0;
	function lockName(key) { return 'lock.' + key; }
	function lockStorageKey(key) { return 'toy.' + ID + '.lock.' + key; }
	function lockOf(key) { return LOCKS ? H.lockState(load(lockName(key), null), TAB, Date.now(), LOCK_STALE) : 'mine'; }
	function writeLock(key) { if (LOCKS) store(lockName(key), { tab: TAB, at: Date.now() }); }
	function releaseLock(key) {
		if (!LOCKS || !key) return;
		var rec = load(lockName(key), null);
		if (rec && rec.tab === TAB) store(lockName(key), null);
	}
	function editorText() { return editor ? String(safeEditor('getText') || '') : S.text; }
	// edits this tab made that it never saved (only possible when the draft was taken in the middle of typing)
	function unsavedHere() { return S.lock === 'lost' && editorText() !== S.text; }
	// before every save: true when this tab may write S.key
	function canWrite() {
		if (!LOCKS || !S.key) return true;
		if (S.lock !== 'own') return false;
		if (lockOf(S.key) === 'held') { loseLock(); return false; }
		writeLock(S.key);
		return true;
	}
	// on opening a draft: hold it, or watch it read-only when another live tab holds it
	function lockOnOpen(key) {
		clearInterval(lockTimer);
		if (!LOCKS) { S.lock = 'own'; return; }
		if (lockOf(key) === 'held') S.lock = 'held';
		else { S.lock = 'own'; writeLock(key); }
		lockTimer = setInterval(beat, LOCK_BEAT);
		applyLock();
	}
	function beat() {
		if (!S.key) return;
		var st = lockOf(S.key);
		if (S.lock === 'own') { if (st === 'held') loseLock(); else writeLock(S.key); return; }
		// read-only here: the other tab closed, crashed or let go, so this tab can write again (unless it has text of its own)
		if (st !== 'held' && !unsavedHere()) takeOver(true);
	}
	function loseLock() {
		if (S.lock !== 'own') return;
		clearTimeout(commitTimer); clearTimeout(stageTimer); pendingSince = 0; stageTimer = 0;
		S.lock = 'lost';
		applyLock();
	}
	// take the draft: from the start, the text the other tab saved last
	function takeOver(auto) {
		if (!S.key) return;
		var stored = lsGet('vn:studio:' + S.key);
		S.lock = 'own';
		writeLock(S.key);
		if (stored != null && stored !== editorText()) showStored(stored);
		else if (stored != null) S.text = stored;
		applyLock();
		setStatus(auto ? 'The other tab let go of this draft: you can write here again.' : 'This tab has the draft now. The other tab shows it read-only.');
	}
	// put the saved text in the editor, keep the reader's place, and let the lint, the panels and the stage follow
	function showStored(text) {
		if (typeof editor.replaceAll === 'function') safeEditor('replaceAll', text);
		else safeEditor('setText', text);
		S.version++;
		S.text = text;
		S.committed = S.version;
		bus.emit('doc:change', { text: text, version: S.version });
		lint(text, S.version);
		stagePost({ type: 'reload' });
	}
	var followStoredTimer = 0;
	function onStorage(e) {
		if (!e.key) return;
		if (e.key === 'toy.' + ID + '.drafts' || (e.key.indexOf('vn:studio:') === 0 && e.key !== 'vn:studio:' + S.key)) { syncDrafts(); return; }
		if (!LOCKS || !S.key) return;
		if (e.key === lockStorageKey(S.key)) {
			// read the record again rather than e.newValue: this tab may have written after the event was sent
			var st = lockOf(S.key);
			if (S.lock === 'own' && st === 'held') loseLock();
			else if (S.lock !== 'own' && st !== 'held' && !unsavedHere()) takeOver(true);
			return;
		}
		if (e.key === 'vn:studio:' + S.key) {
			if (e.newValue == null) { syncDrafts(); return; }
			if (S.lock === 'own') {
				// someone wrote this draft without holding it (an old copy of the Studio): stop rather than overwrite it
				if (e.newValue !== S.text && e.newValue !== editorText()) loseLock();
				return;
			}
			if (unsavedHere()) return;           // keep this tab's own unsaved text on screen until it is kept as a copy
			clearTimeout(followStoredTimer);
			followStoredTimer = setTimeout(function () {
				var t = lsGet('vn:studio:' + S.key);
				if (S.lock !== 'own' && t != null && t !== S.text && !unsavedHere()) showStored(t);
			}, 300);
		}
	}
	function keepAsCopy() {
		if (!S.key) return;
		var d = draftByKey(S.key), text = editorText(), line = api.getCursorLine();
		var key = createDraft((d ? d.name : S.key) + ' (this tab)', text, d && d.from);
		if (!key) return;
		S.text = text;              // nothing unsaved here any more: it is in the copy
		openDraft(key, { line: line });
		setStatus('This tab’s text is safe as the draft ' + key + '.');
	}
	function applyLock() {
		var ro = S.lock !== 'own';
		var ta = editor && editor.element;
		if (ta && 'readOnly' in ta) ta.readOnly = ro;
		var studio = $('#studio'); if (studio) studio.classList.toggle('is-readonly', ro);
		var box = $('#st-lock'); if (!box) return;
		var had = box.hidden;
		box.hidden = !ro;
		if (ro) {
			var lost = S.lock === 'lost', mine = unsavedHere();
			$('#st-lock-text').textContent = lost
				? 'Another Studio tab took over this draft, so this tab stopped saving it and is read-only.' + (mine ? ' The text on screen has changes that are not saved anywhere: keep them as a copy.' : ' It shows that tab’s writing as it is saved.')
				: 'Another Studio tab is editing this draft, so here it is read-only. It shows that tab’s writing as it is saved.';
			var take = $('#st-lock-take');
			take.textContent = 'Take over';
			take.title = mine ? 'Write here instead; the other tab becomes read-only. This tab’s unsaved changes are dropped (keep them as a copy first).' : 'Write here instead; the other tab becomes read-only';
			$('#st-lock-copy').hidden = !mine;
			showSaved(lost ? 'Not saving: another tab has this draft' : 'Read-only: another tab has this draft');
		} else if (!had) {
			showSaved('Saved in this browser');
		}
		if (had !== box.hidden) arrange();
	}
	function wireLock() {
		root.addEventListener('storage', onStorage);
		var take = $('#st-lock-take'), copy = $('#st-lock-copy');
		if (take) take.addEventListener('click', function () { takeOver(false); safeEditor('focus'); });
		if (copy) copy.addEventListener('click', keepAsCopy);
		function letGo() { if (S.lock === 'own') releaseLock(S.key); }
		root.addEventListener('pagehide', letGo);
		// a tab coming back from the background checks at once instead of at its next (throttled) beat
		doc.addEventListener('visibilitychange', function () {
			if (doc.visibilityState === 'visible') beat();
		});
		// back from the back/forward cache: claim again (pagehide let go)
		root.addEventListener('pageshow', function (e) { if (e.persisted && S.key) lockOnOpen(S.key); });
	}

	/* ---- cursor ---- */

	var followTimer = 0;
	function onCursor(line) {
		line = line | 0;
		if (line < 1 || line === S.cursorLine) return;
		S.cursorLine = line;
		var pos = $('#st-pos'); if (pos) pos.textContent = 'Line ' + line;
		rememberCursor();
		bus.emit('cursor:line', { line: line });
		if (S.follow) {
			clearTimeout(followTimer);
			// a caret moved by typing (Enter, a new line) waits for the pause: the reload then lands on the cursor
			if (stageTimer) return;
			followTimer = setTimeout(function () { if (!stageTimer) stagePost({ type: 'goto', line: S.cursorLine }); }, FOLLOW_MS);
		}
	}
	var cursorSaveTimer = 0;
	function rememberCursor() {
		if (THUMB) return;
		clearTimeout(cursorSaveTimer);
		cursorSaveTimer = setTimeout(function () {
			var c = load('cursor', {}) || {};
			c[S.key] = S.cursorLine;
			store('cursor', c);
		}, 500);
	}

	/* ---- lint (worker, else main thread) ---- */

	var worker = null, workerDead = false;
	function startWorker() {
		if (typeof Worker !== 'function') { workerDead = true; return; }
		try {
			worker = new Worker('lint-worker.js');
			worker.onmessage = function (ev) { onLinted(ev.data); };
			worker.onerror = function (ev) {
				if (ev && ev.preventDefault) ev.preventDefault();
				warn('the lint worker failed; linting on the page instead');
				workerDead = true; worker = null;
				if (S.key) lint(S.text, S.version);
			};
		} catch (e) { workerDead = true; worker = null; }
	}
	function lint(text, version) {
		if (worker && !workerDead) { worker.postMessage({ type: 'lint', text: text, version: version, id: 'src:draft:' + S.key }); return; }
		lintHere(text, version);
	}
	// the same work as lint-worker.js, on the page (no Worker, or the worker failed)
	var includeCache = {};
	function lintHere(text, version) {
		if (!VN) { onLinted({ type: 'error', version: version, message: 'The Paper Theatre engine (vn.js) is not loaded.' }); return; }
		var names = [];
		text.replace(/^\s*@include\s+(\S+)/gm, function (m, p) { if (names.indexOf(p) < 0) names.push(p); return m; });
		var inc = {};
		function one(n) {
			var p = includeCache.hasOwnProperty(n) ? Promise.resolve(includeCache[n]) : fetchText(STORIES + n).catch(function () { return null; }).then(function (t) { includeCache[n] = t; return t; });
			return p.then(function (t) {
				if (t == null) return null;
				inc[n] = t;
				var nested = [];
				t.replace(/^\s*@include\s+(\S+)/gm, function (m, q) { if (!(q in inc) && names.indexOf(q) < 0) nested.push(q); return m; });
				return Promise.all(nested.map(function (q) { return (includeCache.hasOwnProperty(q) ? Promise.resolve(includeCache[q]) : fetchText(STORIES + q).catch(function () { return null; })).then(function (u) { includeCache[q] = u; if (u != null) inc[q] = u; }); }));
			});
		}
		Promise.all(names.map(one)).then(function () {
			var program = VN.parse(text, { id: 'src:draft:' + S.key, includes: inc });
			var issues = VN.lint(program), walk = null;
			if (!issues.some(function (i) { return i.level === 'fatal'; })) {
				walk = VN.walk(program);
				(walk.issues || []).forEach(function (i) { issues.push(i); });
				issues.sort(function (a, b) { return (a.line - b.line) || (a.level === b.level ? 0 : a.level === 'fatal' ? -1 : 1); });
			}
			onLinted({ type: 'program', program: program, issues: issues, walk: walk, version: version });
		}).catch(function (e) { onLinted({ type: 'error', version: version, message: String(e && e.message || e) }); });
	}
	function onLinted(m) {
		if (!m) return;
		if (m.version < S.programVersion) return;      // an older text answered late
		if (m.type === 'error') {
			if (/could not be loaded in the worker/.test(m.message || '') && !workerDead) { workerDead = true; worker = null; lintHere(S.text, S.version); return; }
			S.issues = [{ level: 'fatal', line: 0, msg: m.message, hint: '', code: 'engine-error' }];
			S.programVersion = m.version;
			drawCount();
			setStatus('The script could not be checked: ' + m.message);
			return;
		}
		S.program = m.program; S.issues = m.issues || []; S.walk = m.walk || null; S.programVersion = m.version;
		drawCount();
		if (editor && editor.setIssues) safeEditor('setIssues', S.issues);
		bus.emit('program:ready', { program: S.program, issues: S.issues, walk: S.walk, version: m.version });
		whenReady('program');
	}
	function drawCount() {
		var b = $('#st-count'); if (!b) return;
		var c = H.countIssues(S.issues);
		b.textContent = H.issueSummary(S.issues) + (S.walk ? ' · ' + S.walk.paths + (S.walk.paths === 1 ? ' path' : ' paths') : '');
		b.className = 'st-link st-count ' + (c.fatal ? 'has-fatal' : c.warn ? 'has-warn' : 'is-clean');
		b.title = c.total ? 'Go to the next issue' : 'The linter found nothing';
		var badge = doc.querySelector('.st-tabs button[data-panel="issues"] .st-badge');
		if (badge) badge.textContent = String(c.total);
	}

	/* ---- the stage (iframe + BroadcastChannel 'vn:studio') ----
	 * The theatre talks on BroadcastChannel('vn:studio'), which every page of this origin hears, so two Studio tabs
	 * would drive each other's stage. The frame is same-origin, so as soon as its new document exists the shell hooks
	 * that document's BroadcastChannel.prototype.postMessage (hookFrame). The stage's first post on 'vn:studio' shows
	 * the shell the stage's channel (adopt); from then on messages go straight between this page and its own frame,
	 * never broadcast, and broadcasts from other tabs no longer reach this stage. Until that first post, or where the
	 * hook cannot be set, the broadcast is used as before, with `id: 'src:draft:<key>'` on what the shell sends.
	 * The same hook sends the stage's "[vn] ..." error log line (a fatal issue in the draft, which is ordinary while
	 * writing) to console.warn inside the frame; every other error still logs as an error. */

	var channel = null;
	var frameGen = 0;          // bumped by every loadFrame: posts from an older frame document are dropped
	var direct = null;         // { gen, ch, handler }: the current frame's own 'vn:studio' channel, once seen
	function openChannel() {
		if (typeof BroadcastChannel !== 'function') { setStatus('This browser has no BroadcastChannel, so the stage cannot follow the script.'); return; }
		try { channel = new BroadcastChannel('vn:studio'); channel.onmessage = function (ev) { onStage(ev, false); }; } catch (e) { channel = null; }
	}
	function plain(msg) { try { return JSON.parse(JSON.stringify(msg)); } catch (e) { return null; } }
	function stagePost(msg) {
		if (!S.key) return;
		msg.id = 'src:draft:' + S.key;
		var d = direct;
		if (d && d.gen === frameGen) {
			var data = plain(msg);
			setTimeout(function () { if (direct === d && d.gen === frameGen) d.handler.call(d.ch, { data: data }); }, 0);
			return;
		}
		if (channel) { try { channel.postMessage(msg); } catch (e) { /* closed */ } }
	}
	// Hook the frame's document (once per document): returns true when hooked
	function hookFrame(gen) {
		var frame = $('#st-frame'), w = null;
		try {
			w = frame && frame.contentWindow;
			if (!w || w.__studioHook || String(w.location.href).indexOf('studio=1') < 0 || typeof w.BroadcastChannel !== 'function') return false;
		} catch (e) { return false; }      // not same-origin
		w.__studioHook = gen;
		var proto = w.BroadcastChannel.prototype, post = proto.postMessage;
		proto.postMessage = function (msg) {
			if (this.name !== 'vn:studio') return post.apply(this, arguments);
			if (gen !== frameGen) return;      // a frame document on its way out
			adopt(gen, this);
			if (!direct || direct.ch !== this) return post.apply(this, arguments);
			var data = plain(msg);
			setTimeout(function () { if (gen === frameGen) onStage({ data: data }, true); }, 0);
		};
		var con = w.console, err = con && con.error;
		if (err && con.warn) {
			con.error = function (a) {
				if (typeof a === 'string' && a.indexOf('[vn] ') === 0) return con.warn.apply(con, arguments);
				return err.apply(con, arguments);
			};
		}
		return true;
	}
	function adopt(gen, ch) {
		if (direct && direct.gen === gen && direct.ch === ch) return;
		var handler = ch.onmessage;
		if (typeof handler !== 'function') return;
		direct = { gen: gen, ch: ch, handler: handler };
		ch.onmessage = function () { /* a broadcast from another tab's Studio: not for this stage */ };
	}
	// hook the new document as early as possible: before the stage posts its first `ready`
	function watchFrame(gen) {
		var t0 = Date.now();
		(function poll() {
			if (gen !== frameGen || hookFrame(gen)) return;
			if (Date.now() - t0 < 20000) setTimeout(poll, 0);
		})();
	}
	function onStage(ev, isDirect) {
		var m = ev && ev.data;
		if (!m || typeof m !== 'object') return;
		if (!isDirect) {
			// a broadcast: once this frame talks directly, any broadcast is another tab's stage
			if (direct && direct.gen === frameGen) return;
			if (m.id != null && m.id !== 'src:draft:' + S.key) return;
		}
		if (m.type === 'ready') {
			S.stageReady = true;
			var t = $('#st-title'); if (t) t.textContent = m.title ? m.title : '';
			bus.emit('preview:ready', { title: m.title || null, issues: m.issues || [] });
			var fatal = (m.issues || []).some(function (i) { return i.level === 'fatal'; });
			if (fatal) { stopText('Stage: stopped by a fatal issue'); whenReady('stop'); }
			// a fresh frame lands on the cursor; after a reload the stage returns to its own line unless it follows the cursor
			else if (S.frameFresh || S.follow) stagePost({ type: 'goto', line: S.cursorLine });
			S.frameFresh = false;
		} else if (m.type === 'stop') {
			S.stageLine = m.line | 0;
			stopText('Stage: line ' + (m.line | 0) + ' · ' + m.kind);
			bus.emit('preview:stop', { line: m.line | 0, index: m.index | 0, kind: m.kind });
			whenReady('stop');
		}
	}
	function stopText(t) { var b = $('#st-stopline'); if (b) b.textContent = t; }

	var FRAME_CSS = [
		'html, body { height: 100%; }',
		'body { padding: 0 !important; overflow: hidden !important; background: #06070d !important; }',
		'.vn-header, body > footer, .vn-errors, .vn-status { display: none !important; }',
		'main { display: block !important; }',
		'.vn-frame { position: fixed !important; inset: 0 !important; width: auto !important; min-width: 0 !important; padding: 0 !important; border-radius: 0 !important; background: #06070d !important; box-shadow: none !important; display: grid !important; place-items: center !important; }',
		'.vn-frame::before { display: none !important; }',
		'#stage { width: min(100vw, calc(100vh * 16 / 9)) !important; border-radius: 0 !important; box-shadow: none !important; }'
	].join('\n');
	// the thumbnail: the stage's idle motion (particles, blinking marks, screen flicker) stopped at its resting state
	var FRAME_STILL = '\n*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }\n.vn-topbar, .vn-toast, .vn-badges { display: none !important; }';
	function loadFrame() {
		var box = $('#st-stagebox'), frame = $('#st-frame');
		if (!frame || !S.key) return;
		box.classList.remove('is-on');
		S.stageReady = false; S.frameFresh = true; S.stageLine = null;
		stopText('Stage: loading…');
		frameGen++; direct = null;
		frame.src = H.frameSrc(S.key, { theme: TK ? TK.theme() : null, still: THUMB });
		watchFrame(frameGen);
	}
	function onFrameLoad() {
		var frame = $('#st-frame'), box = $('#st-stagebox');
		hookFrame(frameGen);
		try {
			var d = frame.contentDocument;
			if (d && d.head && !d.getElementById('studio-frame-css')) {
				var st = d.createElement('style'); st.id = 'studio-frame-css'; st.textContent = FRAME_CSS + (THUMB ? FRAME_STILL : ''); d.head.appendChild(st);
			}
		} catch (e) { /* not same-origin: leave the theatre as it is */ }
		box.classList.add('is-on');
	}
	function frameTheme(theme) {
		try { $('#st-frame').contentDocument.documentElement.setAttribute('data-theme', theme); } catch (e) { /* not loaded */ }
	}

	/* ---- panels ---- */

	var panels = [];        // registered definitions (not the editor)
	var activeId = null;
	var builtinIssues = {
		id: 'issues', title: 'Issues', order: 10, builtin: true,
		mount: function (pane, a) {
			var list = el('ol', 'st-issues');
			var empty = el('p', 'st-empty', 'Checking the script…');
			pane.appendChild(empty); pane.appendChild(list);
			function draw(issues) {
				list.innerHTML = '';
				empty.textContent = issues.length ? '' : 'The linter found nothing.';
				empty.hidden = !!issues.length;
				issues.forEach(function (i) {
					var li = el('li');
					var b = el('button', null, i.line > 0 ? 'line ' + i.line : 'file');
					b.type = 'button';
					b.setAttribute('aria-label', 'Go to line ' + i.line + ': ' + i.msg);
					b.addEventListener('click', function () { if (i.line > 0) a.gotoLine(i.line); });
					var lv = el('span', 'lv lv-' + (i.level === 'fatal' ? 'fatal' : 'warn'), i.level === 'fatal' ? 'fatal' : 'warn');
					var tx = el('span'); tx.textContent = i.msg;
					if (i.hint) { var sm = el('small'); sm.textContent = i.hint; tx.appendChild(sm); }
					li.appendChild(b); li.appendChild(lv); li.appendChild(tx);
					list.appendChild(li);
				});
			}
			function onReady(e) { draw(e.issues || []); }
			Studio.bus.on('program:ready', onReady);
			draw(a.getIssues());
			return { unmount: function () { Studio.bus.off('program:ready', onReady); } };
		}
	};

	function registerPanel(def) {
		if (!def || typeof def !== 'object' || typeof def.id !== 'string' || !def.id || typeof def.mount !== 'function') {
			warn('registerPanel needs {id, title, order, mount(el, api)}; ignored:', def);
			return false;
		}
		if (def.id === 'editor') {
			if (editorPanel) { warn('a second editor panel was ignored'); return false; }
			editorPanel = def;
			if (S.booted) mountEditor();
			return true;
		}
		var old = panels.filter(function (p) { return p.id === def.id; })[0];
		if (old && !old.builtin) { warn('a second panel with id "' + def.id + '" was ignored'); return false; }
		var rec = { id: def.id, title: def.title || def.id, order: def.order, mount: def.mount, def: def, builtin: !!def.builtin, inst: null, state: 'new' };
		if (old) {
			if (old.inst && typeof old.inst.unmount === 'function') { try { old.inst.unmount(); } catch (e) { /* ignore */ } }
			panels.splice(panels.indexOf(old), 1, rec);
			if (S.booted) { drawTabs(); mountPanel(rec); if (activeId === rec.id) showTab(rec.id); }
			return true;
		}
		panels.push(rec);
		if (S.booted) { drawTabs(); mountPanel(rec); if (!activeId) showTab(rec.id); }
		return true;
	}

	function paneFor(rec) {
		var id = 'st-pane-' + rec.id.replace(/[^\w-]/g, '_');
		var pane = doc.getElementById(id);
		if (!pane) {
			pane = el('div', 'st-pane'); pane.id = id;
			pane.setAttribute('role', 'tabpanel');
			pane.setAttribute('aria-labelledby', 'st-tab-' + rec.id.replace(/[^\w-]/g, '_'));
			pane.tabIndex = 0;
			pane.hidden = true;
			$('#st-panes').appendChild(pane);
		}
		return pane;
	}
	function mountPanel(rec) {
		var pane = paneFor(rec);
		pane.innerHTML = '';
		pane.classList.remove('is-failed');
		function fail(e) {
			rec.state = 'failed'; rec.error = e;
			warn('panel "' + rec.id + '" failed:', e);
			pane.innerHTML = '';
			pane.classList.add('is-failed');
			var p = el('p'); p.innerHTML = '<b>This panel failed to start.</b> The rest of the Studio works without it.';
			var d = el('p', 'st-empty'); d.textContent = String(e && e.message || e);
			pane.appendChild(p); pane.appendChild(d);
			var tab = doc.getElementById('st-tab-' + rec.id.replace(/[^\w-]/g, '_'));
			if (tab) tab.classList.add('is-failed');
		}
		try {
			var r = rec.mount(pane, api);
			rec.state = 'ok';
			if (r && typeof r.then === 'function') r.then(function (inst) { rec.inst = inst || null; if (activeId === rec.id) callInst(rec, 'show'); }, fail);
			else rec.inst = r || null;
		} catch (e) { fail(e); }
	}
	function callInst(rec, m) {
		if (rec && rec.inst && typeof rec.inst[m] === 'function') { try { rec.inst[m](); } catch (e) { warn('panel "' + rec.id + '".' + m + ' threw:', e); } }
	}
	function drawTabs() {
		var bar = $('#st-tabs');
		bar.innerHTML = '';
		H.sortPanels(panels).forEach(function (rec, i) {
			var sid = rec.id.replace(/[^\w-]/g, '_');
			var b = el('button'); b.type = 'button'; b.id = 'st-tab-' + sid;
			b.setAttribute('role', 'tab'); b.setAttribute('data-panel', rec.id);
			b.setAttribute('aria-controls', 'st-pane-' + sid);
			b.setAttribute('aria-selected', rec.id === activeId ? 'true' : 'false');
			b.tabIndex = rec.id === activeId ? 0 : -1;
			b.title = rec.title + (i < 9 ? ' (Alt+' + (i + 1) + ')' : '');
			b.appendChild(doc.createTextNode(rec.title));
			if (rec.id === 'issues') { var bd = el('span', 'st-badge', String(H.countIssues(S.issues).total)); bd.setAttribute('aria-label', 'issues'); b.appendChild(bd); }
			if (rec.state === 'failed') b.classList.add('is-failed');
			b.addEventListener('click', function () { showTab(rec.id); });
			bar.appendChild(b);
		});
		if (!panels.length) bar.appendChild(el('span', 'st-empty', 'No panels yet.'));
	}
	function showTab(id) {
		var rec = panels.filter(function (p) { return p.id === id; })[0];
		if (!rec) return;
		var prev = panels.filter(function (p) { return p.id === activeId; })[0];
		if (prev && prev !== rec) callInst(prev, 'hide');
		activeId = id;
		store('tab', id);
		panels.forEach(function (p) {
			var pane = paneFor(p), sid = p.id.replace(/[^\w-]/g, '_'), tab = doc.getElementById('st-tab-' + sid);
			pane.hidden = p.id !== id;
			if (tab) { tab.setAttribute('aria-selected', p.id === id ? 'true' : 'false'); tab.tabIndex = p.id === id ? 0 : -1; }
		});
		callInst(rec, 'show');
	}
	function tabKeys(e) {
		var tabs = [].slice.call(doc.querySelectorAll('#st-tabs button[role="tab"]'));
		var i = tabs.indexOf(doc.activeElement);
		if (i < 0) return;
		var j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -2;
		if (j === -2) return;
		e.preventDefault();
		j = (j + tabs.length) % tabs.length;
		tabs[j].focus();
		showTab(tabs[j].getAttribute('data-panel'));
	}

	/* ---- the api handed to panels ---- */

	// a panel's insert, replace or rewrite in a read-only tab: refused, and said so
	function refuseReadOnly() {
		if (S.lock === 'own') return false;
		setStatus('This draft is read-only in this tab: another tab is editing it. Press “Take over” to write here.');
		return true;
	}
	var api = {
		getText: function () { return editor ? String(safeEditor('getText') || '') : S.text; },
		setText: function (text, opts) {
			text = H.normalize(text);
			if (!editor) { S.text = text; return; }
			if (refuseReadOnly()) return;
			safeEditor('setText', text);
			S.version++;
			if (opts && opts.silent) return;
			commit();
		},
		insertAtCursor: function (text) { if (!editor || refuseReadOnly()) return; safeEditor('insertAtCursor', String(text)); onEdited(); },
		replaceLine: function (line, text) { if (!editor || refuseReadOnly()) return; safeEditor('replaceLine', line | 0, String(text)); onEdited(); },
		// true while another Studio tab holds this draft (nothing this tab does is saved to it)
		isReadOnly: function () { return S.lock !== 'own'; },
		getCursorLine: function () { var l = editor ? safeEditor('getCursorLine') : S.cursorLine; return (l | 0) || 1; },
		getProgram: function () { return S.program; },
		getIssues: function () { return S.issues.slice(); },
		gotoLine: function (n) {
			n = Math.max(1, n | 0);
			safeEditor('gotoLine', n);
			onCursor(n);
			clearTimeout(followTimer);
			stagePost({ type: 'goto', line: n });
		},
		getDraftKey: function () { return S.key; },
		setStatus: function (text) { setStatus(text); },
		toast: function (text) { if (TK) TK.toast(String(text)); },
		root: TK ? TK.root : new URL('../../', root.location.href).href
	};
	var statusTimer = 0;
	function setStatus(text) {
		var m = $('#st-msg'); if (!m) return;
		m.textContent = text == null ? '' : String(text);
		clearTimeout(statusTimer);
		if (text) statusTimer = setTimeout(function () { m.textContent = ''; }, 8000);
	}

	var Studio = root.Studio = { registerPanel: registerPanel, bus: bus, api: api, version: '1.0' };
	registerPanel(builtinIssues);

	/* ---- drafts ---- */

	var lastRemoved = null;     // { key, name, from, text, cursor, at }: the draft deleted last (toolbar or Files panel)
	var undoTimer = 0;
	function draftByKey(k) { return S.drafts.filter(function (d) { return d.key === k; })[0] || null; }
	// delete a draft from this browser, kept for a minute so that Undo brings it back under its own key
	function removeDraft(key) {
		var d = draftByKey(key); if (!d) return false;
		var mine = key === S.key && S.lock === 'own';
		if (!mine && lockOf(key) === 'held') { setStatus('Not deleted: another Studio tab is editing ' + key + '.'); return false; }
		if (key === S.key && S.committed !== S.version) commit();
		var c = load('cursor', {}) || {};
		lastRemoved = { key: d.key, name: d.name, from: d.from || null, text: lsGet('vn:studio:' + d.key), cursor: c[d.key] || null, at: Date.now() };
		lsDel('vn:studio:' + d.key);
		S.drafts = S.drafts.filter(function (x) { return x !== d; });
		store('drafts', S.drafts);
		delete c[d.key]; store('cursor', c);
		if (key === S.key) {
			if (mine) releaseLock(key);
			S.key = null;
			if (S.drafts.length) openDraft(S.drafts[0].key);
			else openExample('obfuscation').then(function (k) { if (!k) { var nk = createDraft('untitled', '', null); if (nk) openDraft(nk); } });
		} else drawDrafts();
		return true;
	}
	// the Files panel deletes through this (files.js removeDraft) and offers its own Undo, which comes back as file:opened
	Studio.drafts = { remove: function (key) { return removeDraft(String(key)); } };
	function restoreRemoved() {
		var r = lastRemoved;
		if (!r || r.text == null || Date.now() - r.at > 60000 || draftByKey(r.key) || lsGet('vn:studio:' + r.key) != null) return false;
		if (!lsSet('vn:studio:' + r.key, r.text)) return false;
		lastRemoved = null;
		var u = $('#st-undo'); if (u) { u.hidden = true; clearTimeout(undoTimer); }
		S.drafts.push({ key: r.key, name: r.name, from: r.from, updated: Date.now() });
		store('drafts', S.drafts);
		if (r.cursor) { var cm = load('cursor', {}) || {}; cm[r.key] = r.cursor; store('cursor', cm); }
		openDraft(r.key, r.cursor ? { line: r.cursor } : {});
		setStatus('Brought back the draft ' + r.key + '.');
		return true;
	}
	function drawDrafts() {
		var sel = $('#st-draft'); if (!sel) return;
		sel.innerHTML = '';
		S.drafts.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (d) {
			var o = el('option', null, d.name + (d.name !== d.key ? '  (' + d.key + ')' : '')); o.value = d.key;
			if (d.key === S.key) o.selected = true;
			sel.appendChild(o);
		});
	}
	function openDraft(key, opts) {
		opts = opts || {};
		var text = lsGet('vn:studio:' + key);
		if (text == null) { if (TK) TK.toast('No draft called “' + key + '” in this browser.'); return false; }
		if (S.key && editor && S.committed !== S.version) commit();      // flush the old draft first
		if (S.key && S.key !== key && S.lock === 'own') releaseLock(S.key);
		clearTimeout(stageTimer); stageTimer = 0;
		S.key = key;
		store('active', key);
		drawDrafts();
		lockOnOpen(key);
		S.program = null; S.issues = []; S.walk = null; S.programVersion = -1;
		safeEditor('setText', text);
		var cl = opts.line || (load('cursor', {}) || {})[key] || 1;
		S.cursorLine = 0;
		if (cl > 1) safeEditor('gotoLine', cl);
		onCursorSilently(cl);
		S.version++;
		S.text = text;
		S.committed = S.version;
		bus.emit('doc:change', { text: text, version: S.version });
		lint(text, S.version);
		loadFrame();
		return true;
	}
	function onCursorSilently(line) {
		S.cursorLine = line | 0 || 1;
		var pos = $('#st-pos'); if (pos) pos.textContent = 'Line ' + S.cursorLine;
		bus.emit('cursor:line', { line: S.cursorLine });
	}
	function createDraft(name, text, from) {
		var taken = S.drafts.map(function (d) { return d.key; }).concat(lsDraftKeys());
		if (lastRemoved && Date.now() - lastRemoved.at < 60000) taken.push(lastRemoved.key);     // kept free for Undo
		var key = H.uniqueKey(name, taken);
		if (!lsSet('vn:studio:' + key, H.normalize(text))) { if (TK) TK.toast('This browser refused to store the draft.'); return null; }
		S.drafts.push({ key: key, name: key === H.slugKey(name) ? name : name + ' ' + key.slice(key.lastIndexOf('-') + 1), from: from || null, updated: Date.now() });
		store('drafts', S.drafts);
		return key;
	}
	function openExample(id, list) {
		var ex = (list || examples).filter(function (e) { return e.id === id; })[0];
		if (!ex) { if (TK) TK.toast('No published story called “' + id + '”.'); return Promise.resolve(null); }
		return fetchText(STORIES + ex.file).then(function (text) {
			var key = createDraft(ex.id, text, ex.id);
			if (key) { openDraft(key, { line: 1 }); if (TK) TK.toast('Opened a copy of “' + ex.title + '” as the draft “' + key + '”. The story file is untouched.'); }
			return key;
		});
	}
	var examples = [];
	function loadExamples() {
		return fetch(STORIES + 'index.json').then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }).then(function (j) {
			examples = H.examples(j);
			var sel = $('#st-example');
			if (sel) examples.forEach(function (e) { var o = el('option', null, e.title); o.value = e.id; sel.appendChild(o); });
			return examples;
		});
	}

	function wireToolbar() {
		$('#st-draft').addEventListener('change', function (e) { if (e.target.value && e.target.value !== S.key) openDraft(e.target.value); });
		$('#st-example').addEventListener('change', function (e) {
			var v = e.target.value; e.target.value = '';
			if (v) openExample(v).catch(function (err) { if (TK) TK.toast('Could not open the story: ' + (err && err.message || err)); });
		});
		$('#st-new').addEventListener('click', function () {
			var key = createDraft('untitled', '', null);
			if (key) { openDraft(key, { line: 1 }); if (TK) TK.toast('A new, empty draft: ' + key); }
		});
		$('#st-dup').addEventListener('click', function () {
			commit();
			var d = draftByKey(S.key);
			var key = createDraft((d ? d.name : S.key) + ' copy', api.getText(), d && d.from);
			if (key) { openDraft(key, { line: S.cursorLine }); if (TK) TK.toast('Duplicated as ' + key); }
		});
		$('#st-rename').addEventListener('click', function () {
			var d = draftByKey(S.key); if (!d) return;
			var n = root.prompt('A new name for this draft (the key stays ' + d.key + '):', d.name);
			if (n == null) return;
			n = String(n).trim().slice(0, 80);
			if (!n) return;
			d.name = n; store('drafts', S.drafts); drawDrafts();
			if (TK) TK.toast('Renamed.');
		});
		$('#st-del').addEventListener('click', function () {
			var d = draftByKey(S.key); if (!d) return;
			if (!root.confirm('Delete the draft “' + d.name + '” from this browser? “Undo delete” in the status line brings it back for 30 seconds.')) return;
			if (!removeDraft(d.key)) return;
			var u = $('#st-undo');
			if (u) {
				u.hidden = false;
				u.textContent = 'Undo delete';
				u.title = 'Bring back the draft “' + d.name + '”';
				clearTimeout(undoTimer);
				undoTimer = setTimeout(function () { u.hidden = true; }, 30000);
				u.focus();
			}
			setStatus('Deleted the draft ' + d.key + '.');
		});
		$('#st-undo').addEventListener('click', function () {
			var u = $('#st-undo'); u.hidden = true; clearTimeout(undoTimer);
			if (!restoreRemoved()) { if (TK) TK.toast('The deleted draft can no longer be brought back.'); }
		});
		$('#st-follow').addEventListener('click', function () { setFollow(!S.follow); });
		$('#st-play').addEventListener('click', function () { stagePost({ type: 'goto', line: api.getCursorLine() }); });
		$('#st-reload').addEventListener('click', function () { commit(); loadFrame(); });
		$('#st-stopline').addEventListener('click', function () { if (S.stageLine) { safeEditor('gotoLine', S.stageLine); onCursorSilently(S.stageLine); } });
		$('#st-count').addEventListener('click', function () {
			var i = H.nextIssue(S.issues, api.getCursorLine());
			if (!i) return;
			if (i.line > 0) api.gotoLine(i.line);
			setStatus((i.line > 0 ? 'Line ' + i.line + ': ' : '') + i.msg);
		});
		$('#st-frame').addEventListener('load', onFrameLoad);
		bus.on('preview:goto', function (d) {
			if (!d) return;
			if (d.line != null) stagePost({ type: 'goto', line: d.line | 0 });
			else if (d.label != null) stagePost({ type: 'goto', label: String(d.label) });
		});
		bus.on('file:opened', function (d) {
			if (!d || typeof d.text !== 'string') return;
			var name = String(d.name || 'imported').replace(/\.vn$/i, '');
			var r = lastRemoved;
			// the Files panel's Undo: the draft just deleted, brought back under its own key
			if (r && H.normalize(d.text) === r.text && (d.name === r.name || name === r.name) && restoreRemoved()) return;
			var key = createDraft(name, d.text, null);
			if (key) { openDraft(key, { line: 1 }); setStatus('Opened ' + (d.name || 'a file') + ' as the draft ' + key + '.'); }
		});
		bus.on('file:saved', function (d) { setStatus('Saved ' + (d && d.name ? d.name : 'the file') + ' to disk.'); });
	}
	function setFollow(on) {
		S.follow = !!on;
		store('follow', S.follow);
		var b = $('#st-follow'); if (b) { b.setAttribute('aria-pressed', S.follow ? 'true' : 'false'); b.classList.toggle('on', S.follow); }
		if (S.follow) stagePost({ type: 'goto', line: api.getCursorLine() });
	}

	/* ---- layout: dividers, the narrow switcher, keys ---- */

	function measure() {
		var h = doc.querySelector('.kit-header');
		var hh = THUMB || !h ? 0 : h.getBoundingClientRect().height;
		doc.documentElement.style.setProperty('--st-h', Math.max(360, root.innerHeight - hh) + 'px');
		arrange();
	}
	// A wide, tall window leaves the 16:9 stage a band with empty space above and below it. Then the panels move
	// under the stage and the script gets the whole left column ('is-tall'); otherwise they sit under the script.
	var TALL_IN = 260, TALL_OUT = 200;
	function arrange() {
		if (THUMB) return;
		var work = $('#st-work'), left = doc.querySelector('.st-left'), right = doc.querySelector('.st-right'), panelsEl = $('#st-panels');
		if (!work || !left || !right || !panelsEl) return;
		var tall = work.classList.contains('is-tall'), want = false;
		if (root.innerWidth >= 900) {
			var info = doc.querySelector('.st-stageinfo');
			var free = work.clientHeight - right.clientWidth * 9 / 16 - (info ? info.offsetHeight : 34);
			want = free >= (tall ? TALL_OUT : TALL_IN);
		}
		if (want === tall) return;
		var had = doc.activeElement && panelsEl.contains(doc.activeElement) ? doc.activeElement : null;
		if (want) right.appendChild(panelsEl);
		else left.appendChild(panelsEl);
		work.classList.toggle('is-tall', want);
		if (had) { try { had.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
		var rec = panels.filter(function (p) { return p.id === activeId; })[0];
		callInst(rec, 'resize');
	}
	function splitter(handle, opts) {
		var box = opts.box, dragging = false;
		function set(v, save) {
			v = H.clamp(v, opts.min, opts.max);
			doc.documentElement.style.setProperty(opts.prop, v + '%');
			handle.setAttribute('aria-valuenow', String(Math.round(v)));
			if (save) store(opts.store, v);
			return v;
		}
		var cur = set(load(opts.store, opts.def), false);
		handle.addEventListener('pointerdown', function (e) {
			if (e.button !== 0) return;
			dragging = true; handle.classList.add('is-drag');
			try { handle.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
			e.preventDefault();
		});
		handle.addEventListener('pointermove', function (e) {
			if (!dragging) return;
			var r = box.getBoundingClientRect();
			cur = set(opts.vertical ? (e.clientX - r.left) / r.width * 100 : (e.clientY - r.top) / r.height * 100, false);
		});
		function end() { if (!dragging) return; dragging = false; handle.classList.remove('is-drag'); store(opts.store, cur); if (opts.vertical) arrange(); callInst(panels.filter(function (p) { return p.id === activeId; })[0], 'resize'); }
		handle.addEventListener('pointerup', end);
		handle.addEventListener('pointercancel', end);
		handle.addEventListener('keydown', function (e) {
			var dec = opts.vertical ? 'ArrowLeft' : 'ArrowUp', inc = opts.vertical ? 'ArrowRight' : 'ArrowDown';
			var step = e.shiftKey ? 10 : 2;
			if (e.key === dec) cur = set(cur - step, true);
			else if (e.key === inc) cur = set(cur + step, true);
			else if (e.key === 'Home') cur = set(opts.min, true);
			else if (e.key === 'End') cur = set(opts.max, true);
			else if (e.key === 'Enter') cur = set(opts.def, true);
			else return;
			e.preventDefault();
			if (opts.vertical) arrange();
		});
	}
	function wireLayout() {
		splitter($('#st-vsplit'), { box: $('#st-work'), prop: '--st-split', store: 'split', def: THUMB ? 36 : 48, min: 25, max: 75, vertical: true });
		splitter($('#st-hsplit'), { box: doc.querySelector('.st-left'), prop: '--st-edit', store: 'edit', def: THUMB ? 80 : 62, min: 20, max: 85, vertical: false });
		var work = $('#st-work');
		[].forEach.call(doc.querySelectorAll('.st-switch [data-show]'), function (b) {
			b.addEventListener('click', function () {
				var v = b.getAttribute('data-show');
				work.setAttribute('data-show', v);
				[].forEach.call(doc.querySelectorAll('.st-switch [data-show]'), function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
				if (v === 'panels') callInst(panels.filter(function (p) { return p.id === activeId; })[0], 'show');
			});
		});
		$('#st-tabs').addEventListener('keydown', tabKeys);
		measure();
		var rsT = 0;
		root.addEventListener('resize', function () {
			measure();
			clearTimeout(rsT);
			rsT = setTimeout(function () { callInst(panels.filter(function (p) { return p.id === activeId; })[0], 'resize'); }, 150);
		});
		doc.addEventListener('keydown', onKey);
	}
	function focusables() {
		var ed = editor && editor.element ? editor.element : $('#st-editor');
		var tab = doc.querySelector('#st-tabs button[aria-selected="true"]') || $('#st-tabs');
		return [ed, tab, $('#st-stopline')];
	}
	function onKey(e) {
		var mod = e.ctrlKey || e.metaKey;
		if (mod && e.key === 'Enter') { e.preventDefault(); stagePost({ type: 'goto', line: api.getCursorLine() }); return; }
		if (mod && !e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); commit(); if (TK) TK.toast('Saved in this browser.'); return; }
		if (mod && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); setFollow(!S.follow); if (TK) TK.toast(S.follow ? 'The stage follows the cursor.' : 'The stage stays where it is.'); return; }
		if (e.altKey && !mod && /^Digit[1-9]$/.test(e.code || '')) {
			var list = H.sortPanels(panels), n = parseInt(e.code.slice(5), 10) - 1;
			if (list[n]) { e.preventDefault(); showTab(list[n].id); var t = doc.querySelector('#st-tabs button[aria-selected="true"]'); if (t) t.focus(); }
			return;
		}
		if (e.key === 'F6') {
			e.preventDefault();
			var f = focusables(), i = -1;
			for (var k = 0; k < f.length; k++) if (f[k] && f[k].contains(doc.activeElement)) i = k;
			var next = f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length];
			if (next) { if (next === f[0] && editor && editor.focus) safeEditor('focus'); else next.focus(); }
		}
	}

	/* ---- ready: the first meaningful frame ---- */

	var readyParts = {}, readyDone = false;
	function whenReady(part) {
		readyParts[part] = true;
		if (readyDone) return;
		// a thumbnail waits for the stage to show its first stop; the page itself is usable as soon as the script is checked
		if (THUMB ? (readyParts.program && readyParts.stop) : readyParts.program) {
			readyDone = true;
			if (!THUMB) { if (TK) TK.ready(); return; }
			// the thumbnail: wait for the stage's fonts, let the last goto settle, then put the editor's line in the same place
			var fonts = null;
			try { fonts = $('#st-frame').contentDocument.fonts.ready; } catch (e) { fonts = null; }
			Promise.resolve(fonts).catch(function () { return null; }).then(function () {
				setTimeout(function () {
					var ta = editor && editor.element;
					safeEditor('gotoLine', S.cursorLine);
					if (ta && ta.tagName === 'TEXTAREA') { ta.scrollTop = Math.max(0, (S.cursorLine - 10) * (parseFloat(getComputedStyle(ta).lineHeight) || 20)); ta.blur(); ta.dispatchEvent(new Event('scroll')); }
					requestAnimationFrame(function () { requestAnimationFrame(function () { if (TK) TK.ready(); }); });
				}, 900);
			});
		}
	}
	function failReady(err) {
		if (readyDone) return;
		readyDone = true;
		if (TK) { TK.fail(err); TK.ready(); }
	}

	/* ---- boot ---- */

	function boot() {
		if (TK) TK.init({ id: ID, title: 'Theatre Studio', sub: 'Write a Paper Theatre script; the stage plays the line you are on.', back: 'misc', help: '#help-template', footer: '#how' });
		if (root.VNArt && root.VNArt.sharedDefs && !doc.getElementById('vnf-rim')) {
			try { doc.body.insertAdjacentHTML('afterbegin', root.VNArt.sharedDefs()); } catch (e) { warn('sharedDefs failed', e); }
		}
		S.follow = load('follow', true) !== false;
		var fb = $('#st-follow'); if (fb) { fb.setAttribute('aria-pressed', S.follow ? 'true' : 'false'); fb.classList.toggle('on', S.follow); }
		wireLayout();
		mountEditor();
		S.booted = true;
		drawTabs();
		panels.forEach(mountPanel);
		var want = load('tab', null);
		showTab(panels.some(function (p) { return p.id === want; }) ? want : (H.sortPanels(panels)[0] || {}).id);
		if (TK) TK.onTheme(frameTheme);
		openChannel();
		startWorker();
		wireToolbar();
		wireLock();
		if (!VN) { failReady(new Error('The Paper Theatre engine (../55-paper-theatre/vn.js) did not load, so the script cannot be checked or played.')); return; }

		if (THUMB) {
			// one fixed state: the example, the cursor on a scene with a chart and a moving cast
			fetchText(STORIES + 'obfuscation.vn').then(function (text) {
				lsSet('vn:studio:thumb', text);
				S.drafts = [{ key: 'thumb', name: 'obfuscation (example)', from: 'obfuscation', updated: 0 }];
				var line = H.findLine(text, 'And then there is Python.') || 1;
				openDraft('thumb', { line: line });
				setTimeout(function () { if (!readyDone) whenReady('stop'); }, 12000);
			}).catch(failReady);
			loadExamples();
			return;
		}

		S.drafts = H.reconcileDrafts(load('drafts', []), lsDraftKeys());
		store('drafts', S.drafts);
		loadExamples().then(function (list) {
			var ex = params.get('example'), d = params.get('draft'), active = load('active', null);
			if (ex) return openExample(ex, list).then(function (k) { if (!k) return fallbackOpen(list, d, active); });
			return fallbackOpen(list, d, active);
		}).catch(failReady);
	}
	function fallbackOpen(list, d, active) {
		if (d && draftByKey(d)) { openDraft(d); return; }
		if (d) TK.toast('No draft called “' + d + '” in this browser.');
		if (active && draftByKey(active)) { openDraft(active); return; }
		if (S.drafts.length) { openDraft(S.drafts[0].key); return; }
		return openExample('obfuscation', list).then(function (k) {
			if (!k) { var key = createDraft('untitled', '', null); if (key) openDraft(key); else failReady(new Error('This browser refused to store a draft, so the Studio cannot run here.')); }
		});
	}

	if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
	else setTimeout(boot, 0);
})(typeof self !== 'undefined' ? self : this);
