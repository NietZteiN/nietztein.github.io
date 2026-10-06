/*
 * Theatre Studio panel 'issues': the linter's findings for the script on show, fatal first, then warnings.
 * Each row is the line, the message and the hint; publish blockers (VN.publishBlockers) are marked.
 * Click, Enter or Space goes to the line (the caret moves and the stage follows: api.gotoLine always moves the stage);
 * Shift+Enter or Shift+click sends only the stage (preview:goto) and leaves the caret where it is.
 * Up / Down / Home / End move between rows. The tab's badge carries the fatal and warning counts.
 */
(function () {
	'use strict';
	var doc = document;
	var BASE = (function () {
		var s = doc.currentScript && doc.currentScript.src;
		return s ? s.replace(/[^\/]*$/, '') : 'panels/';
	}());

	function addStyles() {
		if (doc.getElementById('st-issues-map-css')) return;
		var l = doc.createElement('link');
		l.id = 'st-issues-map-css'; l.rel = 'stylesheet'; l.href = BASE + 'issues-map.css';
		doc.head.appendChild(l);
	}
	function el(tag, cls, text) {
		var e = doc.createElement(tag);
		if (cls) e.className = cls;
		if (text != null) e.textContent = text;
		return e;
	}
	function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

	if (!window.Studio || typeof window.Studio.registerPanel !== 'function') return;
	addStyles();

	window.Studio.registerPanel({
		id: 'issues', title: 'Issues', order: 10,
		mount: function (pane, api) {
			var bus = window.Studio.bus;
			var VN = window.VN;
			var state = { issues: [], walk: null, have: false, cursor: 0, active: 0, rows: [] };

			pane.classList.add('stim-issues');
			var head = el('div', 'stim-head');
			var sum = el('p', 'stim-sum', 'Checking the script…');
			sum.setAttribute('aria-live', 'polite');
			head.appendChild(sum);
			var keysNote = el('p', 'stim-keys', 'Enter: go to the line · Shift+Enter: stage only');
			head.appendChild(keysNote);
			pane.appendChild(head);
			var body = el('div', 'stim-body');
			pane.appendChild(body);

			function blockersOf(issues) {
				var set = [];
				try { if (VN && typeof VN.publishBlockers === 'function') set = VN.publishBlockers(issues); } catch (e) { set = []; }
				return set;
			}

			function paintBadge(c) {
				var tab = doc.querySelector('#st-tabs button[data-panel="issues"]');
				if (!tab) return;
				var bd = tab.querySelector('.st-badge');
				if (!bd) { bd = el('span', 'st-badge'); tab.appendChild(bd); }
				// the shell writes the plain total into the badge on every lint; repaint unless our spans are still there
				if (bd.getAttribute('data-stim') === c.fatal + '/' + c.warn && bd.querySelector('span')) return;
				bd.innerHTML = '';
				bd.setAttribute('data-stim', c.fatal + '/' + c.warn);
				bd.classList.add('stim-badge');
				if (!c.fatal && !c.warn) {
					bd.appendChild(el('span', 'stim-b-ok', '0'));
					bd.setAttribute('aria-label', 'no issues');
				} else {
					if (c.fatal) bd.appendChild(el('span', 'stim-b-fatal', String(c.fatal)));
					if (c.warn) bd.appendChild(el('span', 'stim-b-warn', String(c.warn)));
					bd.setAttribute('aria-label', plural(c.fatal, 'fatal issue', 'fatal issues') + ', ' + plural(c.warn, 'warning', 'warnings'));
				}
				tab.title = 'Issues: ' + plural(c.fatal, 'fatal', 'fatal') + ', ' + plural(c.warn, 'warning', 'warnings') + ' (Alt+1)';
			}
			function counts() {
				var c = { fatal: 0, warn: 0 };
				state.issues.forEach(function (i) { if (i.level === 'fatal') c.fatal++; else c.warn++; });
				return c;
			}

			// the shell redraws the tabs when a panel registers later; put the counts back
			var tabsEl = doc.getElementById('st-tabs');
			var mo = null;
			if (tabsEl && typeof MutationObserver === 'function') {
				mo = new MutationObserver(function () { if (state.have) paintBadge(counts()); });
				mo.observe(tabsEl, { childList: true, subtree: true, characterData: true });
			}

			function go(i, stageOnly) {
				if (!i) return;
				if (i.file) { api.toast('This issue is in ' + i.file + ', not in the draft.'); return; }
				if (stageOnly) {
					if (i.line > 0) bus.emit('preview:goto', { line: i.line });
					return;
				}
				// a file-level issue (line 0) is about the header: the caret goes to line 1
				api.gotoLine(i.line > 0 ? i.line : 1);
			}

			function rowFor(i, blocker, idx) {
				var li = el('li', 'stim-row stim-' + (i.level === 'fatal' ? 'fatal' : 'warn'));
				li.id = 'stim-row-' + idx;
				li.setAttribute('role', 'option');
				li.tabIndex = -1;
				li.setAttribute('data-line', String(i.line | 0));
				var ln = el('span', 'stim-line', i.file ? i.file + ':' + i.line : i.line > 0 ? 'L' + i.line : 'file');
				var main = el('span', 'stim-main');
				// the engine's messages start with "line N:"; the line is already in the first column
				var msg = el('span', 'stim-msg', String(i.msg || '').replace(/^line \d+:\s*/, ''));
				main.appendChild(msg);
				if (blocker) main.appendChild(el('span', 'stim-blocker', 'blocks publishing'));
				if (i.hint) main.appendChild(el('span', 'stim-hint', i.hint));
				var code = el('span', 'stim-code', i.code || '');
				li.appendChild(ln); li.appendChild(main); li.appendChild(code);
				li.setAttribute('aria-label', (i.level === 'fatal' ? 'Fatal' : 'Warning') + ', ' + (i.line > 0 ? 'line ' + i.line : 'file') + ': ' + i.msg + (blocker ? '. Blocks publishing.' : '') + (i.hint ? ' Hint: ' + i.hint : ''));
				li.addEventListener('click', function (e) { setActive(idx, false); go(i, e.shiftKey); });
				return li;
			}

			function setActive(idx, focus) {
				if (!state.rows.length) return;
				idx = Math.max(0, Math.min(state.rows.length - 1, idx));
				state.active = idx;
				state.rows.forEach(function (r, k) {
					r.el.tabIndex = k === idx ? 0 : -1;
					r.el.setAttribute('aria-selected', k === idx ? 'true' : 'false');
				});
				var target = state.rows[idx].el;
				if (focus) { target.focus(); }
				if (target.scrollIntoView && focus) target.scrollIntoView({ block: 'nearest' });
			}

			function markCursor() {
				state.rows.forEach(function (r) { r.el.classList.toggle('is-here', r.issue.line > 0 && r.issue.line === state.cursor); });
			}

			function draw() {
				body.innerHTML = '';
				state.rows = [];
				var issues = state.issues, c = counts();
				paintBadge(c);
				if (!state.have) { sum.textContent = 'Checking the script…'; return; }
				var blockers = blockersOf(issues);
				var nb = blockers.length;
				var w = state.walk;
				if (!issues.length) {
					sum.textContent = 'Clean.';
					var p = el('div', 'stim-clean');
					p.appendChild(el('p', 'stim-clean-head', 'The script is clean: no fatal issues, no warnings.'));
					if (w) {
						var ends = w.endings || { end: 0, withheld: 0 };
						p.appendChild(el('p', null, 'The walk followed ' + plural(w.paths, 'path', 'paths') + '; every one reaches an ending (' + plural(ends.end, 'end card', 'end cards') + (ends.withheld ? ', ' + ends.withheld + ' withheld' : '') + '). No unreachable labels, no loops.'));
					}
					body.appendChild(p);
					keysNote.hidden = true;
					return;
				}
				keysNote.hidden = false;
				var parts = [];
				if (c.fatal) parts.push(plural(c.fatal, 'fatal', 'fatal'));
				if (c.warn) parts.push(plural(c.warn, 'warning', 'warnings'));
				if (nb) parts.push(nb + ' block' + (nb === 1 ? 's' : '') + ' publishing');
				if (!w && c.fatal) parts.push('branches not walked until the fatal is fixed');
				sum.textContent = parts.join(' · ');

				var list = el('ul', 'stim-list');
				list.setAttribute('role', 'listbox');
				list.setAttribute('aria-label', 'Issues, fatal first');
				var idx = 0;
				[['fatal', 'Fatal', 'The stage will not play the script until these are fixed.'], ['warn', 'Warnings', '']].forEach(function (grp) {
					var these = issues.filter(function (i) { return (i.level === 'fatal') === (grp[0] === 'fatal'); });
					if (!these.length) return;
					var h = el('li', 'stim-group stim-group-' + grp[0]);
					h.setAttribute('role', 'presentation');
					h.appendChild(el('span', 'stim-group-name', grp[1] + ' (' + these.length + ')'));
					if (grp[2]) h.appendChild(el('span', 'stim-group-note', grp[2]));
					list.appendChild(h);
					these.forEach(function (i) {
						var r = rowFor(i, blockers.indexOf(i) >= 0, idx++);
						list.appendChild(r);
						state.rows.push({ el: r, issue: i });
					});
				});
				body.appendChild(list);
				var hadFocus = pane.contains(doc.activeElement) && doc.activeElement !== pane;
				setActive(Math.min(state.active, state.rows.length - 1), hadFocus);
				markCursor();
			}

			body.addEventListener('keydown', function (e) {
				if (!state.rows.length) return;
				var k = e.key, i = state.active;
				if (k === 'ArrowDown') { e.preventDefault(); setActive(i + 1, true); }
				else if (k === 'ArrowUp') { e.preventDefault(); setActive(i - 1, true); }
				else if (k === 'Home') { e.preventDefault(); setActive(0, true); }
				else if (k === 'End') { e.preventDefault(); setActive(state.rows.length - 1, true); }
				else if (k === 'Enter' || k === ' ') {
					if (e.ctrlKey || e.altKey || e.metaKey) return;
					e.preventDefault();
					go(state.rows[i].issue, e.shiftKey);
				}
			});
			// the pane itself is focusable (F6); arrows there enter the list
			pane.addEventListener('keydown', function (e) {
				if (e.target !== pane || !state.rows.length) return;
				if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') { e.preventDefault(); setActive(e.key === 'End' ? state.rows.length - 1 : e.key === 'Home' ? 0 : state.active, true); }
			});

			function onReady(d) {
				state.issues = (d && d.issues) ? d.issues.slice() : [];
				state.walk = d ? d.walk : null;
				state.have = true;
				draw();
			}
			function onCursor(d) { state.cursor = d && d.line | 0; markCursor(); }
			bus.on('program:ready', onReady);
			bus.on('cursor:line', onCursor);
			if (api.getProgram()) { state.issues = api.getIssues(); state.have = true; }
			state.cursor = api.getCursorLine();
			draw();

			return {
				show: function () { if (state.have) paintBadge(counts()); },
				unmount: function () {
					bus.off('program:ready', onReady);
					bus.off('cursor:line', onCursor);
					if (mo) mo.disconnect();
				}
			};
		}
	});
}());
