/*
 * Theatre Studio panel 'facts': the facts table of the current program, the figures that carry no chip, and the
 * publish checklist (panels/checklist.js). It reads the program and inserts only a {key} the author picks; it never
 * writes prose or figures, never changes @status and never removes @verify.
 */
(function (root) {
	'use strict';
	var doc = root.document;
	var TK = root.ToyKit;
	if (!root.Studio || !doc) return;

	function needCss() {
		if (doc.getElementById('st-facts-board-css')) return;
		var l = doc.createElement('link');
		l.id = 'st-facts-board-css'; l.rel = 'stylesheet'; l.href = 'panels/facts-board.css';
		doc.head.appendChild(l);
	}
	// panels/checklist.js is not in the shell's script list; facts and board share one load of it
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
	function lineBtn(api, line, label) {
		var b = el('button', 'stf-line', label || 'line ' + line);
		b.type = 'button';
		b.title = 'Go to line ' + line;
		b.addEventListener('click', function () { api.gotoLine(line); });
		return b;
	}
	function store(k, v) { if (TK && !TK.thumb) try { TK.store('panel.facts.' + k, v); } catch (e) { /* ignore */ } }
	function load(k, d) { if (!TK || TK.thumb) return d; try { var v = TK.load('panel.facts.' + k, d); return v == null ? d : v; } catch (e) { return d; } }

	root.Studio.registerPanel({
		id: 'facts',
		title: 'Facts',
		order: 50,
		mount: function (pane, api) {
			needCss();
			pane.classList.add('stf');
			pane.innerHTML = '<p class="st-empty">Loading the checklist…</p>';
			return needChecklist().then(function (C) { return build(C, pane, api); });
		}
	});

	function build(C, pane, api) {
		var visible = false, dirty = true, walk = null, pubs = null, pubsAsked = false;
		var unusedOnly = !!load('unused', false);
		pane.innerHTML = '';

		// ---- the checklist ----
		var secCheck = el('section', 'stf-sec');
		var hCheck = el('h3', 'stf-h', 'Publish checklist');
		var sum = el('span', 'stf-sum');
		hCheck.appendChild(sum);
		var note = el('p', 'stf-note', 'Computed from the script; nothing here changes it. @status and @verify are yours to edit.');
		var list = el('ul', 'stf-check');
		var hMan = el('h4', 'stf-h4', 'By hand');
		var manList = el('ul', 'stf-check stf-manual');
		secCheck.appendChild(hCheck); secCheck.appendChild(note); secCheck.appendChild(list); secCheck.appendChild(hMan); secCheck.appendChild(manList);

		// ---- figures without a chip ----
		var secFig = el('section', 'stf-sec');
		var hFig = el('h3', 'stf-h', 'Figures without a chip');
		var figList = el('ul', 'stf-figs');
		secFig.appendChild(hFig); secFig.appendChild(figList);

		// ---- the facts table ----
		var secFacts = el('section', 'stf-sec');
		var hFacts = el('h3', 'stf-h', 'Facts');
		var tools = el('label', 'stf-toggle');
		var cb = el('input'); cb.type = 'checkbox'; cb.checked = unusedOnly;
		tools.appendChild(cb); tools.appendChild(doc.createTextNode(' unused only'));
		hFacts.appendChild(tools);
		var tbl = el('table', 'stf-facts');
		tbl.innerHTML = '<thead><tr><th scope="col">Key</th><th scope="col">Value</th><th scope="col">Ref</th><th scope="col">Declared</th><th scope="col">Used at</th><th scope="col"><span class="stf-sr">Insert</span></th></tr></thead>';
		var tbody = el('tbody');
		tbl.appendChild(tbody);
		var factsEmpty = el('p', 'st-empty', 'No @fact lines in this script or its @include files.');
		secFacts.appendChild(hFacts); secFacts.appendChild(tbl); secFacts.appendChild(factsEmpty);
		cb.addEventListener('change', function () { unusedOnly = cb.checked; store('unused', unusedOnly); drawFacts(api.getProgram()); });

		pane.appendChild(secCheck);
		pane.appendChild(secFig);
		pane.appendChild(secFacts);

		function ticks() { return load('ticks', {}) || {}; }
		function drawManual(res) {
			manList.innerHTML = '';
			var key = api.getDraftKey() || '';
			var all = ticks(), mine = all[key] || {};
			res.manual.forEach(function (m) {
				var li = el('li', 'stf-item');
				var lab = el('label', 'stf-manual-row');
				var box = el('input'); box.type = 'checkbox'; box.checked = !!mine[m.id];
				box.addEventListener('change', function () {
					var t = ticks(); t[key] = t[key] || {};
					if (box.checked) t[key][m.id] = true; else delete t[key][m.id];
					store('ticks', t);
				});
				lab.appendChild(box);
				lab.appendChild(el('span', 'stf-label', m.label));
				lab.appendChild(el('small', 'stf-rule', m.rule));
				li.appendChild(lab);
				manList.appendChild(li);
			});
		}

		function drawCheck(program, issues) {
			var res = C.check(program, issues, { text: api.getText(), walk: walk, publications: pubs });
			sum.textContent = res.counts.fail ? res.counts.fail + ' to fix · ' + res.counts.pass + ' pass' : 'all ' + res.counts.pass + ' pass';
			sum.className = 'stf-sum ' + (res.counts.fail ? 'is-fail' : 'is-pass');
			list.innerHTML = '';
			res.items.forEach(function (it) {
				var li = el('li', 'stf-item is-' + it.state);
				var mark = el('span', 'stf-mark', it.state === 'pass' ? 'pass' : it.state === 'fail' ? 'fail' : 'n/a');
				var body = el('span', 'stf-body');
				body.appendChild(el('span', 'stf-label', it.label));
				body.appendChild(el('small', 'stf-rule', it.rule));
				if (it.detail) body.appendChild(el('span', 'stf-detail', it.detail));
				li.appendChild(mark); li.appendChild(body);
				var go = el('span', 'stf-go');
				if (it.state === 'fail') {
					(it.lines.length ? it.lines : it.line ? [it.line] : []).filter(function (n, i, a) { return n > 0 && a.indexOf(n) === i; }).slice(0, 6).forEach(function (n) { go.appendChild(lineBtn(api, n)); });
					if (it.lines.length > 6) go.appendChild(el('small', null, '+' + (it.lines.length - 6)));
				}
				li.appendChild(go);
				list.appendChild(li);
			});
			drawManual(res);
		}

		function drawFigs(issues) {
			var figs = C.unchipped(issues);
			figList.innerHTML = '';
			var count = hFig.querySelector('.stf-count') || hFig.appendChild(el('span', 'stf-count'));
			count.textContent = String(figs.length);
			if (!figs.length) { figList.appendChild(el('li', 'st-empty', (api.getProgram() || {}).meta && api.getProgram().meta.kind !== 'paper' ? 'None. (The rule is for @kind paper.)' : 'None.')); return; }
			figs.forEach(function (i) {
				var li = el('li');
				li.appendChild(lineBtn(api, i.line));
				li.appendChild(el('span', null, i.msg.replace(/^line \d+: /, '')));
				figList.appendChild(li);
			});
		}

		function drawFacts(program) {
			var rows = C.factUsage(program);
			var unused = rows.filter(function (r) { return !r.uses.length; }).length;
			var count = hFacts.querySelector('.stf-count') || hFacts.insertBefore(el('span', 'stf-count'), tools);
			count.textContent = rows.length + (unused ? ' · ' + unused + ' unused' : '');
			tbody.innerHTML = '';
			factsEmpty.hidden = rows.length > 0;
			tbl.hidden = !rows.length;
			rows.filter(function (r) { return !unusedOnly || !r.uses.length; }).forEach(function (r) {
				var tr = el('tr', r.uses.length ? '' : 'is-unused');
				var k = el('td'); k.appendChild(el('code', null, r.key)); tr.appendChild(k);
				tr.appendChild(el('td', 'stf-val', r.value));
				tr.appendChild(el('td', 'stf-ref' + (r.ref ? '' : ' is-missing'), r.ref || 'no ref'));
				var d = el('td', 'stf-decl');
				if (r.file) d.appendChild(el('small', null, r.file + ':' + r.line));
				else if (r.line) d.appendChild(lineBtn(api, r.line));
				tr.appendChild(d);
				var u = el('td', 'stf-uses');
				if (!r.uses.length) u.appendChild(el('span', 'stf-unused', 'unused'));
				var lines = [];
				r.uses.forEach(function (x) { if (x.line > 0 && lines.indexOf(x.line) < 0) lines.push(x.line); });
				lines.slice(0, 8).forEach(function (n) { u.appendChild(lineBtn(api, n, String(n))); });
				if (lines.length > 8) u.appendChild(el('small', null, '+' + (lines.length - 8)));
				tr.appendChild(u);
				var ins = el('td');
				var b = el('button', 'stf-ins', 'Insert');
				b.type = 'button';
				b.title = 'Insert {' + r.key + '} at the cursor';
				b.setAttribute('aria-label', 'Insert {' + r.key + '} at the cursor');
				b.addEventListener('click', function () { api.insertAtCursor('{' + r.key + '}'); api.setStatus('Inserted {' + r.key + '} at line ' + api.getCursorLine() + '.'); });
				ins.appendChild(b);
				tr.appendChild(ins);
				tbody.appendChild(tr);
			});
		}

		function draw() {
			var program = api.getProgram(), issues = api.getIssues();
			dirty = false;
			// the api has no getWalk(): a program that arrived before this panel mounted is walked here once
			if (!walk && program && root.VN && !issues.some(function (i) { return i.level === 'fatal'; })) {
				try { walk = root.VN.walk(program); } catch (e) { walk = null; }
			}
			drawCheck(program, issues);
			drawFigs(issues);
			drawFacts(program);
		}
		function askPubs() {
			if (pubsAsked) return;
			pubsAsked = true;
			fetch(api.root + 'assets/data/publications.json').then(function (r) {
				if (!r.ok) { if (r.body && r.body.cancel) r.body.cancel(); throw new Error('HTTP ' + r.status); }
				return r.json();
			}).then(function (j) { pubs = Array.isArray(j) ? j : null; if (visible) draw(); else dirty = true; }, function () {
				pubs = null;
				api.setStatus('Facts: the publication list could not be loaded; the checks that need it are skipped.');
			});
		}
		function onReady(e) {
			walk = e && e.walk || null;
			if (visible) draw(); else dirty = true;
		}
		root.Studio.bus.on('program:ready', onReady);

		return {
			show: function () { visible = true; askPubs(); if (dirty) draw(); },
			hide: function () { visible = false; },
			unmount: function () { root.Studio.bus.off('program:ready', onReady); }
		};
	}
})(window);
