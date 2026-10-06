/* Theatre Studio panel 'scenery': every background and event illustration as a small picture, and the
 * weather, tone, transition and sound directives. A click puts the directive on its own line after the
 * line the cursor is on (or on that line when it is empty). Pictures are drawn with the theatre's own
 * VNArt.background / VNArt.cg, only when they scroll into view. Names come from the VN constants. */
(function () {
	'use strict';
	if (!window.Studio) return;
	var doc = document;

	// the two scenes with a blackboard (stories/README.md, Backgrounds); art-scenes.js does not export the list
	var BOARD_SCENES = ['classroom', 'lecture'];

	function el(tag, cls, text) {
		var n = doc.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text;
		return n;
	}
	function css() {
		if (doc.getElementById('cs-css')) return;
		var l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = 'panels/cast-scenery.css'; l.id = 'cs-css';
		doc.head.appendChild(l);
	}

	// Put a directive on a line of its own: on the cursor's line when it is blank, else after that statement
	// (after its indented continuation lines, so they stay joined to it). Returns the line it landed on.
	function placeLine(text, cursor) {
		var ls = String(text).split('\n'), n = Math.max(1, Math.min(cursor | 0 || 1, ls.length));
		if (!ls[n - 1].trim()) return { replace: n, before: '', at: n };
		while (n < ls.length && /^[ \t]+\S/.test(ls[n])) n++;
		return { replace: n, before: ls[n - 1] + '\n', at: n + 1 };
	}
	function insertDirective(api, directive) {
		var p = placeLine(api.getText(), api.getCursorLine());
		api.replaceLine(p.replace, p.before + directive);
		api.gotoLine(p.at);
		api.setStatus('Line ' + p.at + ': ' + directive);
		return p.at;
	}

	function segmented(label, values, initial, onPick) {
		var wrap = el('div', 'sc-seg');
		wrap.setAttribute('role', 'group');
		wrap.setAttribute('aria-label', label);
		wrap.appendChild(el('span', 'sc-seglab', label));
		var btns = [];
		values.forEach(function (v) {
			var b = el('button', 'sc-segbtn', v[1]); b.type = 'button';
			b.setAttribute('aria-pressed', v[0] === initial ? 'true' : 'false');
			b.addEventListener('click', function () {
				btns.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
				onPick(v[0]);
			});
			btns.push(b); wrap.appendChild(b);
		});
		return wrap;
	}
	function checkbox(label, onChange) {
		var l = el('label', 'cs-check'), c = el('input'); c.type = 'checkbox';
		c.addEventListener('change', function () { onChange(c.checked); });
		l.appendChild(c); l.appendChild(doc.createTextNode(' ' + label));
		l.input = c;
		return l;
	}

	function mount(pane, api) {
		css();
		var VN = window.VN, ART = window.VNArt;
		var root = el('div', 'sc-scenery');
		pane.appendChild(root);
		var hint = el('div', 'sc-hint', 'A click puts the directive on its own line after the cursor’s line.');
		hint.setAttribute('aria-live', 'polite');
		root.appendChild(hint);

		/* ---- pictures: drawn lazily, one or two per frame ---- */
		var cache = {}, cacheKeys = [], queue = [], visible = [], shown = false, raf = 0;
		function remember(key, svg) {
			cache[key] = svg; cacheKeys.push(key);
			while (cacheKeys.length > 80) delete cache[cacheKeys.shift()];
		}
		function pump() {
			raf = 0;
			var t0 = Date.now();
			while (queue.length && Date.now() - t0 < 24) {
				var card = queue.shift();
				if (!card.isConnected || card._drawn === card._key) continue;
				var key = card._key, svg = cache[key];
				if (svg == null) { try { svg = card._make(); } catch (e) { svg = ''; } remember(key, svg); }
				card._pic.innerHTML = svg || '<span class="sc-nopic">no picture</span>';
				card._drawn = key;
				if (card._after) card._after(card._pic);
			}
			if (queue.length) raf = requestAnimationFrame(pump);
		}
		function want(card) {
			if (!shown || card._drawn === card._key || queue.indexOf(card) >= 0) return;
			queue.push(card);
			if (!raf) raf = requestAnimationFrame(pump);
		}
		var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
			entries.forEach(function (en) {
				var c = en.target, i = visible.indexOf(c);
				if (en.isIntersecting) { if (i < 0) visible.push(c); want(c); }
				else if (i >= 0) visible.splice(i, 1);
			});
		}, { root: pane, rootMargin: '120px 0px' }) : null;
		function watch(card) { if (io) io.observe(card); else visible.push(card); }
		function restyle(cards) { cards.forEach(function (c) { c._key = c._keyFn(); if (visible.indexOf(c) >= 0) want(c); }); }

		function card(label, directiveFn, keyFn, make) {
			var b = el('button', 'sc-card'); b.type = 'button'; b.setAttribute('data-name', label);
			var pic = el('span', 'sc-pic'); pic.setAttribute('aria-hidden', 'true');
			var cap = el('span', 'sc-cap');
			var nm = el('b', null, label), sub = el('small');
			cap.appendChild(nm); cap.appendChild(sub);
			b.appendChild(pic); b.appendChild(cap);
			b._pic = pic; b._sub = sub; b._keyFn = keyFn; b._key = keyFn(); b._make = make; b._directive = directiveFn;
			function label2() { var d = directiveFn(); b.setAttribute('aria-label', 'Insert ' + d); b.title = d; return d; }
			b.addEventListener('click', function () { insertDirective(api, label2()); });
			b.addEventListener('mouseenter', function () { hint.textContent = label2(); });
			b.addEventListener('focus', function () { hint.textContent = label2(); });
			label2();
			watch(b);
			return b;
		}

		/* ---- backgrounds ---- */
		var bgOpt = { mod: '', overcast: false, board: '' };
		var sec = el('section', 'sc-sec'); sec.appendChild(el('h3', 'sc-h', 'Backgrounds (@bg)'));
		var ctl = el('div', 'sc-ctl');
		ctl.appendChild(segmented('Hour', [['', 'its own']].concat(VN.BG_MODS.map(function (m) { return [m, m]; })), '', function (v) { bgOpt.mod = v; refreshBg(); }));
		ctl.appendChild(checkbox('overcast', function (v) { bgOpt.overcast = v; refreshBg(); }));
		var boardSel = el('select', 'cs-in');
		[['', 'board: as drawn (plot)']].concat(VN.BG_OPTS.board.map(function (b) { return [b, 'board=' + b]; })).forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; boardSel.appendChild(op); });
		boardSel.setAttribute('aria-label', 'Blackboard (' + BOARD_SCENES.join(' and ') + ' only)');
		boardSel.title = 'Only ' + BOARD_SCENES.join(' and ') + ' have a blackboard';
		boardSel.addEventListener('change', function () { bgOpt.board = boardSel.value; refreshBg(); });
		ctl.appendChild(boardSel);
		sec.appendChild(ctl);
		var bgGrid = el('div', 'sc-grid');
		var bgCards = VN.BACKGROUNDS.map(function (name) {
			function board() { return BOARD_SCENES.indexOf(name) >= 0 ? bgOpt.board : ''; }
			var c = card(name, function () {
				return '@bg ' + name + (bgOpt.mod ? ' ' + bgOpt.mod : '') + (bgOpt.overcast ? ' overcast' : '') + (board() ? ' board=' + board() : '');
			}, function () {
				return 'bg|' + name + '|' + bgOpt.mod + '|' + bgOpt.overcast + '|' + board();
			}, function () {
				var o = { overcast: bgOpt.overcast }; if (board()) o.board = board();
				return ART.background(name, bgOpt.mod, o);
			});
			var own = ART.timeOf ? ART.timeOf(name, '') : '';
			c._sub.textContent = own ? 'own hour: ' + own : '';
			bgGrid.appendChild(c);
			return c;
		});
		sec.appendChild(bgGrid);
		root.appendChild(sec);
		function refreshBg() { bgCards.forEach(function (c) { c.title = c._directive();c.setAttribute('aria-label', 'Insert ' + c.title); }); restyle(bgCards); }

		/* ---- event illustrations ---- */
		var cgOpt = { mod: '', overcast: false, text: '', caption: '' };
		var sec2 = el('section', 'sc-sec'); sec2.appendChild(el('h3', 'sc-h', 'Event illustrations (@cg)'));
		var ctl2 = el('div', 'sc-ctl');
		ctl2.appendChild(segmented('Hour', [['', 'its own']].concat(VN.CG_MODS.map(function (m) { return [m, m]; })), '', function (v) { cgOpt.mod = v; refreshCg(); }));
		ctl2.appendChild(checkbox('overcast', function (v) { cgOpt.overcast = v; refreshCg(); }));
		var textIn = el('input', 'cs-in sc-text'); textIn.type = 'text'; textIn.spellcheck = false; textIn.placeholder = 'text= (screen-code)';
		textIn.setAttribute('aria-label', 'The one readable identifier on screen-code: letters, digits, _ $ .');
		textIn.addEventListener('input', function () {
			var ok = !textIn.value || /^[\w$.]+$/.test(textIn.value);
			textIn.setAttribute('aria-invalid', ok ? 'false' : 'true');
			cgOpt.text = ok ? textIn.value : '';
			refreshCg();
		});
		var capIn = el('input', 'cs-in sc-caption'); capIn.type = 'text'; capIn.placeholder = '| caption (yours, optional)';
		capIn.setAttribute('aria-label', 'Caption, shown small in a corner (optional)');
		capIn.addEventListener('input', function () { cgOpt.caption = capIn.value.replace(/\s+/g, ' ').trim(); refreshCg(); });
		ctl2.appendChild(textIn); ctl2.appendChild(capIn);
		var off = el('button', 'kit-btn small', '@cg off'); off.type = 'button';
		off.addEventListener('click', function () { insertDirective(api, '@cg off'); });
		ctl2.appendChild(off);
		sec2.appendChild(ctl2);
		var cgGrid = el('div', 'sc-grid');
		var cgCards = VN.CGS.map(function (name) {
			var repaints = {};   // hour -> false when that hour does not repaint this CG (learnt from the drawing's data-tod)
			function mod() { return repaints[cgOpt.mod] === false ? '' : cgOpt.mod; }
			var c = card(name, function () {
				var t = name === 'screen-code' && cgOpt.text ? ' text=' + cgOpt.text : '';
				return '@cg ' + name + (mod() ? ' ' + mod() : '') + (cgOpt.overcast ? ' overcast' : '') + t + (cgOpt.caption ? ' | ' + cgOpt.caption : '');
			}, function () {
				return 'cg|' + name + '|' + cgOpt.mod + '|' + cgOpt.overcast + '|' + (name === 'screen-code' ? cgOpt.text : '');
			}, function () {
				var o = { overcast: cgOpt.overcast }; if (name === 'screen-code' && cgOpt.text) o.text = cgOpt.text;
				return ART.cg(name, cgOpt.mod, o);
			});
			c._after = function (pic) {
				var svg = pic.querySelector('svg'), tod = svg && svg.getAttribute('data-tod');
				if (cgOpt.mod && tod) repaints[cgOpt.mod] = tod === cgOpt.mod;
				if (cgOpt.mod && tod && tod !== cgOpt.mod) c._sub.textContent = 'keeps its hour: ' + tod;
				else c._sub.textContent = tod ? (cgOpt.mod ? 'hour: ' : 'own hour: ') + tod : '';
				c.title = c._directive(); c.setAttribute('aria-label', 'Insert ' + c.title);
			};
			cgGrid.appendChild(c);
			return c;
		});
		sec2.appendChild(cgGrid);
		root.appendChild(sec2);
		function refreshCg() { cgCards.forEach(function (c) { c.title = c._directive(); c.setAttribute('aria-label', 'Insert ' + c.title); }); restyle(cgCards); }

		/* ---- weather, tone, transition, sound ---- */
		var sec3 = el('section', 'sc-sec'); sec3.appendChild(el('h3', 'sc-h', 'Weather, tone, transitions, sound'));
		var list = el('div', 'sc-dirs');
		function row(label, items, help) {
			var r = el('div', 'sc-drow');
			r.appendChild(el('span', 'sc-dlab', label));
			var box = el('div', 'sc-chips');
			items.forEach(function (it) {
				var b = el('button', 'sc-chip', it[0]); b.type = 'button';
				function d() { return typeof it[1] === 'function' ? it[1]() : it[1]; }
				b.title = d();
				b.setAttribute('aria-label', 'Insert ' + d());
				b.addEventListener('click', function () { insertDirective(api, d()); });
				b.addEventListener('mouseenter', function () { hint.textContent = d(); b.title = d(); });
				b.addEventListener('focus', function () { hint.textContent = d(); b.title = d(); });
				box.appendChild(b);
			});
			if (help) box.appendChild(help);
			r.appendChild(box);
			list.appendChild(r);
		}
		function each(arr, fmt) { return (arr || []).map(function (n) { return [n, fmt(n)]; }); }
		row('Weather on', each(VN.FX, function (n) { return '@fx ' + n + ' on'; }));
		row('Weather off', each(VN.FX, function (n) { return '@fx ' + n + ' off'; }).concat([['none', '@fx none']]));
		row('Once', each(VN.FX_ONESHOT, function (n) { return '@fx ' + n; }));
		row('Tone', each(VN.TONES, function (n) { return '@tone ' + n; }));
		var ms = el('input', 'cs-in sc-ms'); ms.type = 'number'; ms.min = 0; ms.max = 10000; ms.step = 100; ms.placeholder = 'ms';
		ms.setAttribute('aria-label', 'Transition length in milliseconds (optional)');
		function msTail() { var v = parseInt(ms.value, 10); return v >= 0 ? ' ' + v : ''; }
		row('Transition', each(VN.TRANSITIONS, function (n) { return function () { return '@transition ' + n + msTail(); }; }), ms);
		if (VN.MUSIC) row('Music', each(VN.MUSIC.concat(['auto', 'off']), function (n) { return '@music ' + n; }));
		if (VN.AMBIENCE) row('Ambience', each(VN.AMBIENCE.concat(['auto', 'off']), function (n) { return '@ambience ' + n; }));
		if (VN.SFX) row('Sound', each(VN.SFX, function (n) { return '@sfx ' + n; }));
		sec3.appendChild(list);
		root.appendChild(sec3);

		return {
			show: function () {
				shown = true;
				if (!io) visible.forEach(want);
				else visible.forEach(want);
			},
			hide: function () { shown = false; queue.length = 0; if (raf) { cancelAnimationFrame(raf); raf = 0; } },
			unmount: function () { if (io) io.disconnect(); }
		};
	}

	Studio.registerPanel({ id: 'scenery', title: 'Scenery', order: 40, mount: mount });
	// for tests: the line arithmetic without a DOM
	window.StudioScenery = { placeLine: placeLine };
})();
