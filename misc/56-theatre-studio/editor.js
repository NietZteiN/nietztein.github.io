/*
 * Theatre Studio: the script editor (panel id "editor", replacing the shell's plain textarea; README.md).
 *
 * A real <textarea> does all the typing, selection, undo, redo and IME work; its text is transparent. Behind it, one
 * row per line (a gutter cell and a coloured copy of the line from vn-highlight.js) is laid out with the same font,
 * width and wrapping, and the rows are what give the textarea its size, so the two can never drift apart and the
 * whole thing scrolls as one. Only the rows whose lines changed are coloured again on a keystroke.
 *
 * Edits made by the editor's own keys (indent, comment, move line, completion) go through execCommand('insertText'),
 * so Ctrl+Z undoes them like typing. The editor writes nothing of its own into a script: completion offers the
 * names the grammar and the script already have.
 */
(function () {
	'use strict';

	var root = window, doc = document;
	var Studio = root.Studio, HL = root.VNHighlight, H = root.StudioHelpers, TK = root.ToyKit;
	if (!Studio || !HL || !H) return;     // the shell keeps its plain editor

	var THUMB = !!(TK && TK.thumb);
	var ZWSP = String.fromCharCode(0x200B);
	var INDENT = '  ';
	var MAX_ITEMS = 60;

	function mk(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
	function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
	function load(k, d) { return !THUMB && TK ? TK.load(k, d) : d; }
	function store(k, v) { if (!THUMB && TK) TK.store(k, v); }

	// the stylesheet is the editor's own (index.html belongs to the shell); hold the editor hidden until it applies
	var cssReady = false, cssWaiters = [];
	(function () {
		var l = doc.createElement('link');
		l.rel = 'stylesheet'; l.href = 'editor.css'; l.id = 'se-css';
		function done() { if (cssReady) return; cssReady = true; cssWaiters.forEach(function (f) { f(); }); cssWaiters = []; }
		l.onload = done; l.onerror = done;
		doc.head.appendChild(l);
		setTimeout(done, 4000);
	})();

	function mount(el, api, host) {
		el.innerHTML = '';

		/* ---- DOM ---- */

		var wrap = mk('div', 'se');
		if (!cssReady) { wrap.style.visibility = 'hidden'; cssWaiters.push(function () { wrap.style.visibility = ''; renderStageAndMarks(); }); }
		var scroller = mk('div', 'se-scroll');
		var docEl = mk('div', 'se-doc');
		var rowsEl = mk('div', 'se-rows');
		var ta = mk('textarea', 'se-ta');
		ta.spellcheck = false;
		ta.setAttribute('autocapitalize', 'off'); ta.setAttribute('autocomplete', 'off'); ta.setAttribute('autocorrect', 'off');
		ta.setAttribute('aria-label', 'Script (.vn)');
		ta.setAttribute('aria-autocomplete', 'list');
		ta.setAttribute('aria-describedby', 'se-info');
		var mirror = mk('div', 'se-mirror'); mirror.setAttribute('aria-hidden', 'true');
		docEl.appendChild(rowsEl); docEl.appendChild(mirror); docEl.appendChild(ta);
		scroller.appendChild(docEl);

		var info = mk('div', 'se-info'); info.id = 'se-info'; info.setAttribute('aria-live', 'polite');
		var pop = mk('ul', 'se-pop'); pop.id = 'se-pop'; pop.setAttribute('role', 'listbox'); pop.setAttribute('aria-label', 'Completions'); pop.hidden = true;
		var tip = mk('div', 'se-tip'); tip.id = 'se-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
		var gotoForm = mk('form', 'se-goto'); gotoForm.hidden = true;
		var gotoLabel = mk('label', null, 'Go to line ');
		var gotoInput = mk('input'); gotoInput.type = 'text'; gotoInput.inputMode = 'numeric'; gotoInput.setAttribute('autocomplete', 'off');
		var gotoNote = mk('span', 'se-goto-note');
		gotoLabel.appendChild(gotoInput); gotoForm.appendChild(gotoLabel); gotoForm.appendChild(gotoNote);
		ta.setAttribute('aria-controls', 'se-pop');

		wrap.appendChild(scroller); wrap.appendChild(info); wrap.appendChild(pop); wrap.appendChild(tip); wrap.appendChild(gotoForm);
		el.appendChild(wrap);

		/* ---- state ---- */

		var lines = [''];            // the text, split on \n, as the rows show it
		var rows = [];               // one .se-row per line
		var castMap = {}, castSig = '';
		var lastValue = '';
		var curLine = 1, curRow = null;
		var stageLine = 0, stageRow = null;
		var issues = [], markedRows = [];
		var program = null;
		var wrapOn = load('panel.editor.wrap', true) !== false;
		var gutterDigits = 0;
		var tabLeaves = false;       // Escape, then Tab moves the focus out instead of indenting
		var tpl = doc.createElement('template');

		/* ---- rows ---- */

		function lineHTML(i) {
			return HL.toHTML(HL.tokenize(lines[i], { cast: castMap, cont: i > 0 && !!lines[i - 1].trim() }));
		}
		function rowHTML(i) { return '<div class="se-row"><span class="se-g"></span><span class="se-c">' + lineHTML(i) + '</span></div>'; }
		function makeRow(i) { tpl.innerHTML = rowHTML(i); return tpl.content.firstChild; }
		function setRow(i) { if (rows[i]) rows[i].lastChild.innerHTML = lineHTML(i); }
		function renderAll() {
			var h = [];
			for (var i = 0; i < lines.length; i++) h.push(rowHTML(i));
			rowsEl.innerHTML = h.join('');
			rows = [].slice.call(rowsEl.children);
			curRow = null; stageRow = null; markedRows = [];
			gutterWidth();
			renderStageAndMarks();
		}
		function gutterWidth() {
			var d = Math.max(3, String(lines.length).length);
			if (d !== gutterDigits) { gutterDigits = d; wrap.style.setProperty('--se-digits', String(d)); }
		}
		function readCast() {
			var c = HL.castOf(lines), sig = Object.keys(c).sort().join('|');
			if (sig === castSig) return false;
			castMap = c; castSig = sig;
			return true;
		}

		// bring the rows up to the textarea's text: only the lines that changed are coloured again
		function sync() {
			var v = ta.value;
			if (v === lastValue) return false;
			lastValue = v;
			var nl = v.split('\n'), ol = lines;
			var a = 0, max = Math.min(ol.length, nl.length);
			while (a < max && ol[a] === nl[a]) a++;
			var eo = ol.length - 1, en = nl.length - 1;
			while (eo >= a && en >= a && ol[eo] === nl[en]) { eo--; en--; }
			var castTouched = false, i;
			for (i = a; i <= eo && !castTouched; i++) if (ol[i].indexOf('@cast') >= 0) castTouched = true;
			for (i = a; i <= en && !castTouched; i++) if (nl[i].indexOf('@cast') >= 0) castTouched = true;
			lines = nl;
			if (castTouched && readCast()) { renderAll(); return true; }
			var common = Math.min(eo, en) - a + 1;
			for (i = 0; i < common; i++) setRow(a + i);
			if (en > eo) {
				var before = rows[eo + 1] || null, frag = doc.createDocumentFragment(), fresh = [];
				for (i = a + Math.max(0, common); i <= en; i++) { var r = makeRow(i); fresh.push(r); frag.appendChild(r); }
				rowsEl.insertBefore(frag, before);
				Array.prototype.splice.apply(rows, [a + Math.max(0, common), 0].concat(fresh));
			} else if (eo > en) {
				var gone = rows.splice(a + Math.max(0, common), eo - en);
				gone.forEach(function (r) {
					if (r === curRow) curRow = null;
					if (r === stageRow) stageRow = null;
					rowsEl.removeChild(r);
				});
				markedRows = markedRows.filter(function (r) { return gone.indexOf(r) < 0; });
			}
			// the line after the change may have become (or stopped being) a continuation
			if (en + 1 < lines.length) setRow(en + 1);
			gutterWidth();
			return true;
		}

		/* ---- caret and current line ---- */

		function caretLine() { return H.lineOfOffset(ta.value, ta.selectionStart); }
		function setCurrent(line) {
			var r = rows[line - 1] || null;
			if (r === curRow) return;
			if (curRow) curRow.classList.remove('is-cur');
			curRow = r;
			if (r) r.classList.add('is-cur');
		}
		function cursorNow() {
			var l = caretLine();
			setCurrent(l);
			if (l !== curLine) { curLine = l; host.cursor(l); drawInfo(); }
		}
		function rowTop(line) { var r = rows[line - 1]; return r ? r.offsetTop : 0; }
		// keep the caret's row in view (after an edit changed the height of the text)
		function reveal() {
			var r = rows[caretLine() - 1];
			if (!r) return;
			var top = r.offsetTop, h = r.offsetHeight, st = scroller.scrollTop, ch = scroller.clientHeight;
			if (h > ch) return;
			if (top < st) scroller.scrollTop = top - 8;
			else if (top + h > st + ch - 4) scroller.scrollTop = top + h - ch + 12;
		}
		function holdStill() { if (ta.scrollTop) ta.scrollTop = 0; if (ta.scrollLeft) ta.scrollLeft = 0; if (el.scrollTop) el.scrollTop = 0; }

		/* ---- marks: issues and the stage ---- */

		function renderStageAndMarks() {
			markIssues();
			markStage(stageLine);
			setCurrent(curLine);
		}
		function markStage(line) {
			stageLine = line | 0;
			var r = stageLine ? rows[stageLine - 1] || null : null;
			if (stageRow && stageRow !== r) stageRow.classList.remove('is-stage');
			stageRow = r;
			if (r) r.classList.add('is-stage');
		}
		function markIssues() {
			markedRows.forEach(function (r) {
				r.classList.remove('is-fatal', 'is-warn');
				var g = r.firstChild; g.removeAttribute('tabindex'); g.removeAttribute('aria-label'); g.removeAttribute('role'); r._issues = null;
			});
			markedRows = [];
			var by = {};
			issues.forEach(function (i) { if (i.line > 0) (by[i.line] = by[i.line] || []).push(i); });
			Object.keys(by).map(Number).sort(function (a, b) { return a - b; }).forEach(function (line) {
				var r = rows[line - 1];
				if (!r) return;
				var list = by[line], fatal = list.some(function (i) { return i.level === 'fatal'; });
				r.classList.add(fatal ? 'is-fatal' : 'is-warn');
				r._issues = list;
				var g = r.firstChild;
				g.setAttribute('role', 'button');
				g.tabIndex = markedRows.length ? -1 : 0;
				g.setAttribute('aria-label', list.map(function (i) { return (i.level === 'fatal' ? 'Fatal. ' : 'Warning. ') + i.msg + (i.hint ? '. ' + i.hint : ''); }).join(' '));
				markedRows.push(r);
			});
			drawInfo();
		}
		function lineOfRow(r) { return rows.indexOf(r) + 1; }

		/* ---- the info strip: the caret line's issues, else the keys ---- */

		var KEYS = 'Ctrl+Space complete · Ctrl+G go to line · Ctrl+/ comment · Alt+↑/↓ move line · Ctrl+Enter stage · F8 next issue · Alt+Z wrap · Esc, Tab leaves';
		var infoText = '';
		function drawInfo() {
			var r = rows[curLine - 1], list = r && r._issues, html;
			if (list && list.length) {
				var i = list[0];
				html = '<b class="' + (i.level === 'fatal' ? 'lv-fatal' : 'lv-warn') + '">' + (i.level === 'fatal' ? 'fatal' : 'warn') + '</b> ' + esc(i.msg) +
					(i.hint ? ' <span class="se-hint">' + esc(i.hint) + '</span>' : '') + (list.length > 1 ? ' <span class="se-hint">(+' + (list.length - 1) + ')</span>' : '');
			} else html = '<span class="se-keys">' + esc(KEYS) + '</span>';
			if (html !== infoText) { infoText = html; info.innerHTML = html; }
		}

		/* ---- the tooltip on a gutter mark ---- */

		function showTip(r) {
			var list = r && r._issues;
			if (!list) { hideTip(); return; }
			tip.innerHTML = list.map(function (i) {
				return '<p><b class="' + (i.level === 'fatal' ? 'lv-fatal' : 'lv-warn') + '">' + (i.level === 'fatal' ? 'fatal' : 'warn') + '</b> ' + esc(i.msg) +
					(i.hint ? '<small>' + esc(i.hint) + '</small>' : '') + '</p>';
			}).join('');
			tip.hidden = false;
			var top = r.offsetTop - scroller.scrollTop + r.firstChild.offsetHeight + 2;
			var max = wrap.clientHeight - tip.offsetHeight - 4;
			if (top > max) top = Math.max(0, r.offsetTop - scroller.scrollTop - tip.offsetHeight - 2);
			tip.style.top = top + 'px';
			tip.style.left = '4px';
			r.firstChild.setAttribute('aria-describedby', 'se-tip');
		}
		function hideTip() { tip.hidden = true; }
		function focusedMark() { var a = doc.activeElement; return a && a.classList && a.classList.contains('se-g') && a.parentNode._issues ? a.parentNode : null; }
		rowsEl.addEventListener('mouseover', function (e) {
			var g = e.target.closest && e.target.closest('.se-g');
			if (g && g.parentNode._issues) showTip(g.parentNode);
			else { var f = focusedMark(); if (f) showTip(f); else hideTip(); }
		});
		rowsEl.addEventListener('mouseleave', function () { var f = focusedMark(); if (f) showTip(f); else hideTip(); });
		rowsEl.addEventListener('click', function (e) {
			var g = e.target.closest && e.target.closest('.se-g');
			if (g) { var n = lineOfRow(g.parentNode); if (n > 0) api.gotoLine(n); }
		});
		rowsEl.addEventListener('focusin', function (e) { if (e.target.classList.contains('se-g')) showTip(e.target.parentNode); });
		rowsEl.addEventListener('focusout', function () { hideTip(); });
		rowsEl.addEventListener('keydown', function (e) {
			var g = e.target;
			if (!g.classList || !g.classList.contains('se-g')) return;
			var k = markedRows.indexOf(g.parentNode);
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				var n = markedRows[(k + (e.key === 'ArrowDown' ? 1 : markedRows.length - 1)) % markedRows.length];
				if (n) focusMark(n);
			} else if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				api.gotoLine(lineOfRow(g.parentNode));
			} else if (e.key === 'Escape') {
				e.preventDefault();
				hideTip(); ta.focus({ preventScroll: true });
			}
		});
		function focusMark(r) {
			markedRows.forEach(function (x) { x.firstChild.tabIndex = -1; });
			r.firstChild.tabIndex = 0;
			var top = r.offsetTop, st = scroller.scrollTop, ch = scroller.clientHeight;
			if (top < st || top + r.offsetHeight > st + ch) scroller.scrollTop = Math.max(0, top - ch / 3);
			r.firstChild.focus({ preventScroll: true });
		}
		// F8: the mark of the next issue after the caret (Shift+F8: before)
		function nextMark(back) {
			if (!markedRows.length) { api.setStatus('No issues to visit.'); return; }
			var lc = caretLine(), pick = null, i, ln;
			if (back) { for (i = markedRows.length - 1; i >= 0; i--) { ln = lineOfRow(markedRows[i]); if (ln < lc) { pick = markedRows[i]; break; } } if (!pick) pick = markedRows[markedRows.length - 1]; }
			else { for (i = 0; i < markedRows.length; i++) { ln = lineOfRow(markedRows[i]); if (ln > lc) { pick = markedRows[i]; break; } } if (!pick) pick = markedRows[0]; }
			focusMark(pick);
		}

		/* ---- undoable edits ---- */

		var inEdit = false;
		function edit(a, b, text, selA, selB) {
			// another Studio tab holds this draft: the editor's own keys (indent, comment, move, complete) change nothing
			if (ta.readOnly) { api.setStatus('This draft is read-only in this tab: another tab is editing it.'); return; }
			ta.focus({ preventScroll: true });
			ta.setSelectionRange(a, b);
			var ok = false;
			inEdit = true;
			try { ok = a === b && text === '' ? true : text === '' ? doc.execCommand('delete', false) : doc.execCommand('insertText', false, text); } catch (e) { ok = false; }
			inEdit = false;
			if (!ok || ta.value.slice(a, a + text.length) !== text) {
				ta.setRangeText(text, a, b, 'end');
				afterInput(null);
			}
			if (selA != null) ta.setSelectionRange(selA, selB == null ? selA : selB);
			cursorNow();
		}
		// the whole lines touched by the selection: {la, lb, start, end, text}
		function block() {
			var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
			var la = H.lineOfOffset(v, s), lb = H.lineOfOffset(v, e);
			if (e > s && lb > la && H.lineStart(v, lb) === e) lb--;     // a selection that ends at a line start leaves that line alone
			var start = H.lineStart(v, la), end = H.lineEnd(v, lb);
			return { la: la, lb: lb, start: start, end: end, text: v.slice(start, end), s: s, e: e };
		}
		function indent(out) {
			var b = block(), v = ta.value;
			if (!out && b.s === b.e) { edit(b.s, b.s, INDENT); return; }
			var ls = b.text.split('\n'), delta0 = 0, total = 0;
			var res = ls.map(function (l, i) {
				var d;
				if (out) { var m = /^( {1,2}|\t)/.exec(l); d = m ? -m[0].length : 0; l = l.slice(-d); }
				else { d = l.length ? INDENT.length : 0; l = (d ? INDENT : '') + l; }
				if (i === 0) delta0 = d;
				total += d;
				return l;
			}).join('\n');
			if (res === b.text) return;
			var s = Math.max(b.start, b.s + delta0), e = b.e + total;
			if (b.s === b.e) e = s;
			edit(b.start, b.end, res, s, Math.max(s, e));
		}
		function toggleComment() {
			var b = block(), ls = b.text.split('\n');
			var filled = ls.filter(function (l) { return l.trim(); });
			if (!filled.length) return;
			var all = filled.every(function (l) { return /^\s*#/.test(l); });
			var delta0 = 0, total = 0;
			var res = ls.map(function (l, i) {
				var d = 0;
				if (l.trim()) {
					if (all) { var m = /^(\s*)# ?/.exec(l); d = -(m[0].length - m[1].length); l = m[1] + l.slice(m[0].length); }
					else { d = 2; l = '# ' + l; }
				}
				if (i === 0) delta0 = d;
				total += d;
				return l;
			}).join('\n');
			if (b.s === b.e) { var c = Math.max(b.start, b.s + delta0); edit(b.start, b.end, res, c, c); }
			else edit(b.start, b.end, res, b.start, b.start + res.length);
		}
		function moveLines(down) {
			var b = block(), v = ta.value, n = H.lineCount(v);
			if (down ? b.lb >= n : b.la <= 1) return;
			if (down) {
				var next = H.getLine(v, b.lb + 1), end = H.lineEnd(v, b.lb + 1), sh = next.length + 1;
				edit(b.start, end, next + '\n' + b.text, b.s + sh, b.e + sh);
			} else {
				var prev = H.getLine(v, b.la - 1), start = H.lineStart(v, b.la - 1), sh2 = prev.length + 1;
				edit(start, b.end, b.text + '\n' + prev, b.s - sh2, b.e - sh2);
			}
			reveal();
		}

		/* ---- completion ---- */

		var comp = null;     // {from, to, items, index}
		function compData() {
			var labels = [], facts = [], seenF = {};
			for (var i = 0; i < lines.length; i++) {
				var l = lines[i], m;
				if ((m = /^\s*==\s*(\S+)\s*$/.exec(l))) labels.push(m[1]);
				else if ((m = /^\s*@fact\s+([A-Za-z_][\w\-]*)/.exec(l)) && !seenF[m[1]]) { seenF[m[1]] = 1; facts.push(m[1]); }
			}
			if (program && program.facts) Object.keys(program.facts).forEach(function (k) { if (!seenF[k]) { seenF[k] = 1; facts.push(k); } });
			var cast = Object.keys(castMap).map(function (k) { return castMap[k]; });
			return { cast: cast, facts: facts, labels: labels };
		}
		function openComp(force) {
			var s = ta.selectionStart;
			if (s !== ta.selectionEnd) { closeComp(); return; }
			var v = ta.value, ls = v.lastIndexOf('\n', s - 1) + 1, line = H.lineOfOffset(v, s);
			var before = v.slice(ls, s);
			// a continuation line is text: only {facts} make sense there
			var cont = line > 1 && /^[ \t]/.test(before) && !!(lines[line - 2] || '').trim();
			var r = HL.suggest(before, compData(), force);
			if (r && cont && r.items[0].kind !== 'fact' && r.items[0].kind !== 'name') r = null;
			if (r && cont && !/\{[\w\-]*$/.test(before)) r = null;
			if (!r) { closeComp(); if (force) api.setStatus('Nothing to complete here.'); return; }
			comp = { from: ls + r.from, to: s, items: r.items.slice(0, MAX_ITEMS), index: 0, line: line, col: s - ls };
			drawComp();
		}
		function drawComp() {
			pop.innerHTML = '';
			comp.items.forEach(function (it, i) {
				var li = mk('li');
				li.id = 'se-opt-' + i;
				li.setAttribute('role', 'option');
				li.setAttribute('aria-selected', i === comp.index ? 'true' : 'false');
				li.appendChild(mk('span', 'se-pop-l', it.label));
				li.appendChild(mk('span', 'se-pop-k', it.kind));
				li.addEventListener('mousedown', function (e) { e.preventDefault(); });
				li.addEventListener('click', function () { comp.index = i; acceptComp(); });
				pop.appendChild(li);
			});
			pop.hidden = false;
			ta.setAttribute('aria-expanded', 'true');
			ta.setAttribute('aria-activedescendant', 'se-opt-' + comp.index);
			placeComp();
		}
		// under the caret: a hidden copy of the line up to the caret, laid out like its row, finds the caret's position
		function placeComp() {
			var r = rows[comp.line - 1];
			if (!r) return;
			var line = lines[comp.line - 1] || '';
			mirror.style.top = r.offsetTop + 'px';
			mirror.innerHTML = esc(line.slice(0, comp.col)) + '<span>' + ZWSP + '</span>';
			var mk2 = mirror.lastChild, lh = mk2.offsetHeight || 20;
			var x = mirror.offsetLeft + mk2.offsetLeft - scroller.scrollLeft;
			var y = r.offsetTop + mk2.offsetTop + lh - scroller.scrollTop + 2;
			var w = pop.offsetWidth, hgt = pop.offsetHeight, W = wrap.clientWidth, Hh = scroller.clientHeight;
			if (x + w > W - 4) x = Math.max(4, W - w - 4);
			if (y + hgt > Hh && y - lh - hgt - 4 > 0) y = y - lh - hgt - 4;
			pop.style.left = Math.max(4, x) + 'px';
			pop.style.top = Math.max(0, y) + 'px';
			var sel = pop.children[comp.index];
			if (sel) { var t = sel.offsetTop, b = t + sel.offsetHeight; if (t < pop.scrollTop) pop.scrollTop = t; else if (b > pop.scrollTop + pop.clientHeight) pop.scrollTop = b - pop.clientHeight; }
		}
		function moveComp(d) {
			if (!comp) return;
			comp.index = (comp.index + d + comp.items.length) % comp.items.length;
			[].forEach.call(pop.children, function (li, i) { li.setAttribute('aria-selected', i === comp.index ? 'true' : 'false'); });
			ta.setAttribute('aria-activedescendant', 'se-opt-' + comp.index);
			placeComp();
		}
		function closeComp() {
			if (!comp && pop.hidden) return;
			comp = null; pop.hidden = true; pop.innerHTML = '';
			ta.removeAttribute('aria-activedescendant');
			ta.setAttribute('aria-expanded', 'false');
		}
		function acceptComp() {
			if (!comp) return;
			var it = comp.items[comp.index], ins = it.insert, v = ta.value, to = comp.to;
			// a {fact} or {Name} closes its brace, unless the brace is already there
			var after = 0;
			if ((it.kind === 'fact' || it.kind === 'name') && v.charAt(comp.from - 1) === '{') {
				to += /^[\w\-]*/.exec(v.slice(to))[0].length;      // the rest of the word being replaced
				if (v.charAt(to) === '}') after = 1; else ins += '}';
			}
			var from = comp.from, chain = /\s$/.test(ins);
			closeComp();
			edit(from, to, ins, from + ins.length + after);
			if (chain) openComp(false);
		}

		/* ---- go to line ---- */

		function openGoto() {
			closeComp();
			gotoForm.hidden = false;
			gotoNote.textContent = 'of ' + lines.length;
			gotoInput.value = String(caretLine());
			gotoInput.focus();
			gotoInput.select();
		}
		function closeGoto(back) { gotoForm.hidden = true; if (back) ta.focus({ preventScroll: true }); }
		gotoForm.addEventListener('submit', function (e) {
			e.preventDefault();
			var n = parseInt(gotoInput.value, 10);
			if (!(n > 0)) { gotoInput.select(); return; }
			closeGoto(false);
			api.gotoLine(Math.min(n, lines.length));
		});
		gotoInput.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeGoto(true); } });
		gotoInput.addEventListener('blur', function () { setTimeout(function () { if (doc.activeElement !== gotoInput) closeGoto(false); }, 0); });

		/* ---- wrap ---- */

		function setWrap(on, say) {
			wrapOn = !!on;
			wrap.classList.toggle('is-nowrap', !wrapOn);
			ta.wrap = wrapOn ? 'soft' : 'off';
			store('panel.editor.wrap', wrapOn);
			if (say) api.setStatus(wrapOn ? 'Long lines wrap.' : 'Long lines scroll sideways.');
			holdStill();
			if (comp) placeComp();
		}

		/* ---- events ---- */

		function afterInput(e) {
			if (sync()) host.changed();
			holdStill();
			cursorNow();
			reveal();
			// completion follows what the author types, not the editor's own edits, pastes or an IME at work
			if (!e || inEdit || e.isComposing) { if (!inEdit) closeComp(); return; }
			var t = e.inputType, s = ta.selectionStart;
			var before = ta.value.slice(ta.value.lastIndexOf('\n', s - 1) + 1, s);
			if (t === 'insertText' && e.data && /\S/.test(e.data)) openComp(false);
			else if (t === 'insertText' && e.data === ' ' && /^\s*(@[a-z]+ |@(show|move|cast|bg|cg|fx|read) .*\S |.*-> )$/.test(before)) openComp(false);
			else if (t === 'deleteContentBackward' && comp) openComp(false);
			else closeComp();
		}
		ta.addEventListener('input', afterInput);
		ta.addEventListener('compositionend', function () { if (sync()) host.changed(); cursorNow(); });
		ta.addEventListener('scroll', holdStill);
		el.addEventListener('scroll', holdStill);
		['keyup', 'click', 'select', 'focus', 'selectionchange'].forEach(function (t) { ta.addEventListener(t, cursorNow); });
		doc.addEventListener('selectionchange', function () { if (doc.activeElement === ta) cursorNow(); });
		ta.addEventListener('focus', function () { wrap.classList.add('is-focus'); });
		ta.addEventListener('blur', function () { wrap.classList.remove('is-focus'); setTimeout(function () { if (doc.activeElement !== ta) closeComp(); }, 0); });
		ta.addEventListener('mousedown', function () { closeComp(); tabLeaves = false; });
		scroller.addEventListener('scroll', function () {
			if (comp) placeComp();
			if (!tip.hidden) { var f = focusedMark(); if (f) showTip(f); else hideTip(); }
		});

		ta.addEventListener('keydown', function (e) {
			if (e.isComposing || e.keyCode === 229) return;
			var mod = e.ctrlKey || e.metaKey, k = e.key;
			if (comp) {
				if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); moveComp(k === 'ArrowDown' ? 1 : -1); return; }
				if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); moveComp(k === 'PageDown' ? 8 : -8); return; }
				if ((k === 'Enter' || k === 'Tab') && !mod && !e.shiftKey && !e.altKey) { e.preventDefault(); acceptComp(); return; }
				if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closeComp(); return; }
				if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End') closeComp();
			}
			if (k === 'Tab' && !mod && !e.altKey) {
				if (tabLeaves) { tabLeaves = false; return; }    // let the focus move on
				e.preventDefault();
				indent(e.shiftKey);
				return;
			}
			tabLeaves = k === 'Escape' && !mod;
			if (tabLeaves) { api.setStatus('Tab now moves the focus out of the script (Escape, then Tab).'); return; }
			if (mod && !e.altKey && (k === ' ' || e.code === 'Space')) { e.preventDefault(); openComp(true); return; }
			if (mod && !e.shiftKey && !e.altKey && (k === 'g' || k === 'G')) { e.preventDefault(); openGoto(); return; }
			if (mod && !e.altKey && (k === '/' || e.code === 'Slash')) { e.preventDefault(); toggleComment(); return; }
			if (mod && k === 'Enter') {
				e.preventDefault(); e.stopPropagation();
				Studio.bus.emit('preview:goto', { line: caretLine() });
				api.setStatus('Stage: line ' + caretLine());
				return;
			}
			if (e.altKey && !mod && (k === 'ArrowUp' || k === 'ArrowDown')) { e.preventDefault(); closeComp(); moveLines(k === 'ArrowDown'); return; }
			if (e.altKey && !mod && (e.code === 'KeyZ')) { e.preventDefault(); setWrap(!wrapOn, true); return; }
			if (k === 'F8') { e.preventDefault(); closeComp(); nextMark(e.shiftKey); return; }
		});

		Studio.bus.on('program:ready', function (d) { program = d && d.program || program; });
		Studio.bus.on('preview:stop', function (d) { markStage(d && d.line | 0); });
		Studio.bus.on('preview:ready', function (d) {
			if (d && (d.issues || []).some(function (i) { return i.level === 'fatal'; })) markStage(0);
		});

		/* ---- the implementation the shell asks for ---- */

		function setAll(text) {
			text = H.normalize(text);
			closeComp(); hideTip();
			ta.value = text;
			lastValue = text;
			lines = text.split('\n');
			readCast();
			stageLine = 0;
			renderAll();
			ta.setSelectionRange(0, 0);
			scroller.scrollTop = 0; scroller.scrollLeft = 0;
			holdStill();
			curLine = 1; setCurrent(1); drawInfo();
		}

		setWrap(wrapOn, false);
		setAll('');

		return {
			getText: function () { return ta.value; },
			setText: function (text) { setAll(text); },
			// the whole text replaced where the reader is: caret offset and scroll kept (a read-only tab following another)
			replaceAll: function (text) {
				var top = scroller.scrollTop, left = scroller.scrollLeft, at = ta.selectionStart;
				setAll(text);
				at = Math.min(at, ta.value.length); ta.setSelectionRange(at, at);
				scroller.scrollTop = top; scroller.scrollLeft = left;
				cursorNow();
			},
			insertAtCursor: function (text) { edit(ta.selectionStart, ta.selectionEnd, H.normalize(text)); reveal(); },
			replaceLine: function (line, text) {
				var v = ta.value, count = H.lineCount(v);
				line = Math.max(1, line | 0);
				text = H.normalize(text);
				if (line > count) { edit(v.length, v.length, H.replaceLine(v, line, text).text.slice(v.length)); return; }
				edit(H.lineStart(v, line), H.lineEnd(v, line), text);
			},
			getCursorLine: function () { return caretLine(); },
			gotoLine: function (n) {
				var v = ta.value;
				n = H.clamp(n | 0, 1, H.lineCount(v));
				var a = H.lineStart(v, n);
				closeComp();
				ta.focus({ preventScroll: true });
				ta.setSelectionRange(a, a);
				holdStill();
				scroller.scrollTop = Math.max(0, rowTop(n) - scroller.clientHeight / 3);
				scroller.scrollLeft = 0;
				cursorNow();
			},
			focus: function () { ta.focus({ preventScroll: true }); },
			setIssues: function (list) { issues = (list || []).slice(); markIssues(); },
			element: ta
		};
	}

	Studio.registerPanel({ id: 'editor', title: 'Editor', order: 0, mount: mount });
})();
