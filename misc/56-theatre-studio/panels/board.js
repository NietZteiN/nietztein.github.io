/*
 * Theatre Studio panel 'board': one row per publication (assets/data/publications.json) and per published blog post
 * (ToyKit.posts()), joined with ../55-paper-theatre/stories/index.json: the story, its status, the @verify flag and
 * the number of publish blockers from linting the story file. Read-only, except "Open in Studio", which copies a story
 * file into a new draft (through the shell's file:opened event). Titles and venues are shown exactly as those files
 * give them; nothing else is said about any paper.
 */
(function (root) {
	'use strict';
	var doc = root.document;
	var TK = root.ToyKit;
	if (!root.Studio || !doc) return;
	var STORIES = '../55-paper-theatre/stories/';

	function needCss() {
		if (doc.getElementById('st-facts-board-css')) return;
		var l = doc.createElement('link');
		l.id = 'st-facts-board-css'; l.rel = 'stylesheet'; l.href = 'panels/facts-board.css';
		doc.head.appendChild(l);
	}
	function needChecklist() {
		if (root.VNChecklist) return Promise.resolve(root.VNChecklist);
		if (!root.__stChecklistP) {
			root.__stChecklistP = new Promise(function (res, rej) {
				var s = doc.createElement('script');
				s.src = 'panels/checklist.js';
				s.onload = function () { if (root.VNChecklist) res(root.VNChecklist); else rej(new Error('panels/checklist.js loaded but defined nothing')); };
				s.onerror = function () { root.__stChecklistP = null; rej(new Error('Could not load panels/checklist.js')); };
				doc.head.appendChild(s);
			});
		}
		return root.__stChecklistP;
	}
	function el(tag, cls, text) {
		var e = doc.createElement(tag);
		if (cls) e.className = cls;
		if (text != null) e.textContent = String(text);
		return e;
	}
	function getJSON(url) {
		return fetch(url).then(function (r) {
			if (!r.ok) { if (r.body && r.body.cancel) r.body.cancel(); throw new Error(url + ': HTTP ' + r.status); }
			return r.json();
		});
	}
	var textCache = {};
	function getText(url) {
		if (!textCache[url]) {
			textCache[url] = fetch(url).then(function (r) {
				if (!r.ok) { if (r.body && r.body.cancel) r.body.cancel(); throw new Error(url + ': HTTP ' + r.status); }
				return r.text();
			});
			textCache[url].then(null, function () { delete textCache[url]; });
		}
		return textCache[url];
	}
	// the lint the shell's worker runs, without the walk: includes from stories/ (one level nested), parse, lint
	function lintFile(file) {
		return getText(STORIES + file).then(function (text) {
			var names = [];
			String(text).replace(/^\s*@include\s+(\S+)/gm, function (m, p) { names.push(p); return m; });
			var inc = {};
			return Promise.all(names.map(function (n) {
				return getText(STORIES + n).then(function (t) { inc[n] = t; }, function () { /* missing include: lint reports it */ });
			})).then(function () {
				var program = root.VN.parse(text, { id: file.replace(/\.vn$/, ''), includes: inc });
				var issues = root.VN.lint(program);
				return { text: text, blockers: root.VN.publishBlockers(issues) };
			});
		});
	}

	root.Studio.registerPanel({
		id: 'board',
		title: 'Board',
		order: 60,
		mount: function (pane, api) {
			needCss();
			pane.classList.add('stb');
			pane.innerHTML = '<p class="st-empty">The board loads when this tab is opened.</p>';
			return needChecklist().then(function (C) { return build(C, pane, api); });
		}
	});

	function build(C, pane, api) {
		var started = false;

		function statusChip(row) {
			if (!row.story) return el('span', 'stb-st is-none', 'no story yet');
			return el('span', 'stb-st is-' + row.status, row.status);
		}
		function rowEl(row) {
			var tr = el('tr', 'stb-row' + (row.story ? '' : ' is-nostory'));
			tr.setAttribute('data-story', row.story || '');
			tr.setAttribute('data-key', row.key);
			var t = el('td', 'stb-title');
			t.appendChild(el('span', 'stb-name', row.title));
			if (row.venue) t.appendChild(el('small', 'stb-venue', (row.year ? row.year + ' · ' : '') + row.venue));
			tr.appendChild(t);
			var s = el('td', 'stb-story');
			s.appendChild(el('code', 'stb-id', row.story || '—'));
			var line = el('span', 'stb-flags');
			line.appendChild(statusChip(row));
			if (row.story) {
				line.appendChild(el('span', 'stb-verify' + (row.verify ? ' is-on' : ''), row.verify ? '@verify' : 'verified'));
				var bl = el('span', 'stb-bl is-wait', 'blockers …');
				bl.setAttribute('data-file', row.file || '');
				line.appendChild(bl);
			}
			s.appendChild(line);
			tr.appendChild(s);
			var a = el('td', 'stb-act');
			if (row.story && row.file) {
				var b = el('button', 'stb-open', 'Open in Studio');
				b.type = 'button';
				b.setAttribute('aria-label', 'Open a copy of ' + row.file + ' in the Studio');
				b.addEventListener('click', function () {
					b.disabled = true;
					getText(STORIES + row.file).then(function (text) {
						root.Studio.bus.emit('file:opened', { name: row.file, text: text });
						api.toast('Copied ' + row.file + ' into a new draft. The story file is untouched.');
					}, function (err) {
						api.toast('Could not read ' + row.file + ': ' + (err && err.message || err));
					}).then(function () { b.disabled = false; });
				});
				a.appendChild(b);
			}
			tr.appendChild(a);
			return tr;
		}
		function section(title, rows, summary) {
			var sec = el('section', 'stb-sec');
			var h = el('h3', 'stf-h', title);
			h.appendChild(el('span', 'stf-count', summary));
			sec.appendChild(h);
			if (!rows.length) { sec.appendChild(el('p', 'st-empty', 'None.')); return sec; }
			var tbl = el('table', 'stb-table');
			tbl.innerHTML = '<thead><tr><th scope="col">Title</th><th scope="col">Story</th><th scope="col"><span class="stf-sr">Action</span></th></tr></thead>';
			var tb = el('tbody');
			rows.forEach(function (r) { tb.appendChild(rowEl(r)); });
			tbl.appendChild(tb);
			sec.appendChild(tbl);
			return sec;
		}
		function tally(rows) {
			var n = { published: 0, embargo: 0, draft: 0, none: 0 };
			rows.forEach(function (r) { n[r.story ? r.status : 'none'] = (n[r.story ? r.status : 'none'] || 0) + 1; });
			var parts = [];
			if (n.published) parts.push(n.published + ' published');
			if (n.embargo) parts.push(n.embargo + ' embargo');
			if (n.draft) parts.push(n.draft + ' draft');
			if (n.none) parts.push(n.none + ' no story yet');
			return rows.length + (parts.length ? ': ' + parts.join(', ') : '');
		}

		function lintAll() {
			var cells = [].slice.call(pane.querySelectorAll('.stb-bl[data-file]'));
			var files = [];
			cells.forEach(function (c) { var f = c.getAttribute('data-file'); if (f && files.indexOf(f) < 0) files.push(f); });
			var i = 0;
			function next() {
				if (i >= files.length) { pane.setAttribute('data-linted', String(files.length)); return; }
				var f = files[i++];
				lintFile(f).then(function (r) {
					var n = r.blockers.length;
					cells.filter(function (c) { return c.getAttribute('data-file') === f; }).forEach(function (c) {
						c.className = 'stb-bl ' + (n ? 'is-bad' : 'is-ok');
						c.textContent = n + ' blocker' + (n === 1 ? '' : 's');
						c.setAttribute('data-n', String(n));
						c.title = n ? r.blockers.slice(0, 5).map(function (b) { return (b.line ? 'line ' + b.line + ': ' : '') + b.msg; }).join('\n') : 'VN.publishBlockers finds nothing';
					});
				}, function (err) {
					cells.filter(function (c) { return c.getAttribute('data-file') === f; }).forEach(function (c) {
						c.className = 'stb-bl is-err'; c.textContent = 'not readable'; c.title = String(err && err.message || err);
					});
				}).then(function () { setTimeout(next, 0); });
			}
			next();
		}

		function start() {
			if (started) return;
			started = true;
			pane.innerHTML = '<p class="st-empty">Loading the publication list, the blog index and the story manifest…</p>';
			var postsP = TK && TK.posts ? TK.posts() : getJSON(api.root + 'blog/index.json');
			Promise.all([
				getJSON(api.root + 'assets/data/publications.json'),
				postsP.then(null, function () { return null; }),
				getJSON(STORIES + 'index.json')
			]).then(function (got) {
				var b = C.boardRows(got[0], got[1] || [], got[2]);
				pane.innerHTML = '';
				var intro = el('p', 'stf-note', 'Read-only. Titles and venues as assets/data/publications.json and blog/index.json give them; status and @verify from stories/index.json; blockers from linting each story file. “Open in Studio” copies a story into a new draft.');
				pane.appendChild(intro);
				pane.appendChild(section('Publications', b.pubs, tally(b.pubs)));
				pane.appendChild(section('Blog posts', b.posts, got[1] ? tally(b.posts) : 'the blog index could not be loaded'));
				if (b.orphans.length) pane.appendChild(section('Stories with no row above', b.orphans, tally(b.orphans)));
				pane.setAttribute('data-rows', String(b.pubs.length + b.posts.length + b.orphans.length));
				lintAll();
			}).catch(function (err) {
				started = false;
				pane.innerHTML = '';
				pane.appendChild(el('p', 'st-empty', 'The board could not be loaded: ' + (err && err.message || err)));
				var retry = el('button', 'stb-open', 'Try again'); retry.type = 'button';
				retry.addEventListener('click', start);
				pane.appendChild(retry);
			});
		}

		return { show: start };
	}
})(window);
