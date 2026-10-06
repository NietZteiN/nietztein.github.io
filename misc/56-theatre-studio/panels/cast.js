/* Theatre Studio panel 'cast': a form that builds an @cast line, with the sprite drawn in all eight faces.
 * The line logic is panels/cast-line.js (pure, tested by test-cast-line.js); this file is the DOM.
 * It writes syntax only: the name, the display name and every trait are the author's picks. */
(function () {
	'use strict';
	if (!window.Studio) return;
	var doc = document;

	function addOnce(id, make) {
		if (doc.getElementById(id)) return doc.getElementById(id);
		var n = make(); n.id = id; doc.head.appendChild(n); return n;
	}
	function css() {
		addOnce('cs-css', function () { var l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = 'panels/cast-scenery.css'; return l; });
	}
	// panels/cast-line.js is not in index.html (the shell's file), so it is loaded here
	function lineLib() {
		if (window.CastLine) return Promise.resolve(window.CastLine);
		return new Promise(function (resolve, reject) {
			var s = addOnce('cs-castline', function () { var t = doc.createElement('script'); t.src = 'panels/cast-line.js'; return t; });
			if (window.CastLine) { resolve(window.CastLine); return; }
			s.addEventListener('load', function () { if (window.CastLine) resolve(window.CastLine); else reject(new Error('panels/cast-line.js did not define CastLine')); });
			s.addEventListener('error', function () { reject(new Error('panels/cast-line.js could not be loaded')); });
		});
	}

	function el(tag, cls, text) {
		var n = doc.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text;
		return n;
	}
	var uid = 0;
	function field(label, control, extra) {
		var id = 'cs-f' + (++uid);
		var wrap = el('div', 'cs-row');
		var l = el('label', 'cs-lab', label); l.htmlFor = id;
		control.id = control.id || id;
		if (control.id !== id) l.htmlFor = control.id;
		wrap.appendChild(l);
		var box = el('div', 'cs-ctl'); box.appendChild(control);
		if (extra) [].concat(extra).forEach(function (x) { box.appendChild(x); });
		wrap.appendChild(box);
		return wrap;
	}
	function select(options) {
		var s = el('select', 'cs-in');
		options.forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; s.appendChild(op); });
		return s;
	}
	function check(label) {
		var l = el('label', 'cs-check'), c = el('input'); c.type = 'checkbox';
		l.appendChild(c); l.appendChild(doc.createTextNode(' ' + label));
		l.input = c;
		return l;
	}
	function button(text, cls, title) {
		var b = el('button', 'kit-btn small' + (cls ? ' ' + cls : ''), text); b.type = 'button';
		if (title) b.title = title;
		return b;
	}

	function mount(pane, api) {
		css();
		return lineLib().then(function (CL) { return build(pane, api, CL); });
	}

	function build(pane, api, CL) {
		var VN = window.VN, ART = window.VNArt;
		var root = el('div', 'cs-cast');
		pane.appendChild(root);

		/* ---- top: presets, the cast already in the script ---- */
		var top = el('div', 'cs-top');
		var preset = select([['', 'Start from…']].concat(CL.presets().map(function (p, i) { return [String(i), p.label]; })).concat([['blank', 'A blank form']]));
		preset.className = 'cs-preset';
		preset.setAttribute('aria-label', 'Start from a preset');
		top.appendChild(preset);
		var inScript = el('div', 'cs-inscript');
		inScript.setAttribute('aria-label', 'Cast in this script');
		top.appendChild(inScript);
		root.appendChild(top);

		var body = el('div', 'cs-body');
		var form = el('form', 'cs-form');
		form.setAttribute('aria-label', 'Cast member');
		form.addEventListener('submit', function (e) { e.preventDefault(); });
		var preview = el('div', 'cs-preview');
		preview.setAttribute('aria-label', 'The sprite in all eight faces');
		preview.setAttribute('role', 'img');
		body.appendChild(form); body.appendChild(preview);
		root.appendChild(body);

		/* ---- the form ---- */
		var f = {};
		f.id = el('input', 'cs-in'); f.id.type = 'text'; f.id.spellcheck = false; f.id.autocomplete = 'off'; f.id.placeholder = 'Jack';
		var idMsg = el('div', 'cs-help'); idMsg.setAttribute('aria-live', 'polite');
		form.appendChild(field('Name', f.id, idMsg));
		f.name = el('input', 'cs-in'); f.name.type = 'text'; f.name.autocomplete = 'off'; f.name.placeholder = 'same as the name';
		form.appendChild(field('Name tag', f.name, el('div', 'cs-help', 'name="…": what the tag shows, if not the name.')));
		f.figure = select([['person', 'a person'], ['sparse', 'a model: lattice=sparse'], ['dense', 'a model: lattice=dense'], ['player', 'the reader: player'], ['page', 'a page: page']]);
		form.appendChild(field('Figure', f.figure));

		f.hueOn = check('set'); f.hue = el('input', 'cs-range'); f.hue.type = 'range'; f.hue.min = 0; f.hue.max = 359; f.hue.step = 1;
		f.hueN = el('output', 'cs-num');
		f.hue.setAttribute('aria-label', 'Hue');
		form.appendChild(field('Hue', f.hue, [f.hueN, f.hueOn]));
		f.hueOn.input.setAttribute('aria-label', 'Write hue=');

		f.skin = select([['', 'from the name']].concat([1, 2, 3, 4, 5].map(function (n) { return [String(n), 'skin=' + n]; })));
		form.appendChild(field('Skin', f.skin));
		f.build = select([['', 'neutral (not written)'], ['fem', 'fem'], ['masc', 'masc']]);
		form.appendChild(field('Build', f.build));
		f.hair = select([['', 'not written (short)']].concat(VN.HAIR.map(function (h) { return [h, h]; })));
		form.appendChild(field('Hair', f.hair));
		f.hhOn = check('set'); f.hairhue = el('input', 'cs-range'); f.hairhue.type = 'range'; f.hairhue.min = 0; f.hairhue.max = 359; f.hairhue.step = 1;
		f.hairhue.setAttribute('aria-label', 'Hair hue');
		f.hhN = el('output', 'cs-num');
		f.hhOn.input.setAttribute('aria-label', 'Write hairhue=');
		form.appendChild(field('Hair hue', f.hairhue, [f.hhN, f.hhOn]));
		f.hairtone = select([['', 'not written']].concat(VN.HAIRTONES.map(function (h) { return [h, 'hairtone=' + h]; })));
		form.appendChild(field('Hair tone', f.hairtone, el('div', 'cs-help', 'hairhue=25 hairtone=dark is dark brown; hairhue alone is the bright tone.')));
		f.clothes = select([['', 'from the name']].concat(VN.CLOTHES.map(function (h) { return [h, h]; })));
		form.appendChild(field('Clothes', f.clothes));
		var acc = el('div', 'cs-checks');
		f.glasses = check('glasses'); f.hat = check('hat (a beret)');
		acc.appendChild(f.glasses); acc.appendChild(f.hat);
		var accRow = el('div', 'cs-row'); accRow.appendChild(el('span', 'cs-lab', 'Wears')); accRow.appendChild(acc);
		form.appendChild(accRow);

		var coBox = el('div', 'cs-coauthor');
		f.coauthor = check('coauthor: this is a real coauthor and I am giving them lines');
		coBox.appendChild(f.coauthor);
		var rule = el('p', 'cs-rule');
		rule.innerHTML = '<b>The rule</b> (stories/README.md, Accuracy rules 4): Coauthors are credited in <code>@authors</code> and on the end card only. ' +
			'Voicing one requires <code>@cast Name coauthor</code>, and then every line by that speaker must end with <code>^§x</code> or <code>^para</code>. ' +
			'Default casts are Jack, You and abstract roles (the Model, the Judge, the Proctor).';
		coBox.appendChild(rule);
		form.appendChild(coBox);

		var extraRow = el('div', 'cs-extra'); extraRow.hidden = true;
		form.appendChild(extraRow);

		/* ---- the line and the buttons ---- */
		var out = el('div', 'cs-out');
		var lineBox = el('code', 'cs-line'); lineBox.setAttribute('aria-live', 'polite'); lineBox.setAttribute('aria-label', 'The @cast line');
		var issuesBox = el('ul', 'cs-issues');
		var btns = el('div', 'cs-btns');
		var bInsert = button('Insert @cast line', 'primary', 'Add this line to the header, after the last @cast');
		var bUpdate = button('Update the line under the cursor', '', 'Replace the @cast line the cursor is on');
		btns.appendChild(bInsert); btns.appendChild(bUpdate);
		var where = el('div', 'cs-help cs-where');
		out.appendChild(lineBox); out.appendChild(issuesBox); out.appendChild(btns); out.appendChild(where);
		root.insertBefore(out, body);

		/* ---- state ---- */
		var extra = [];       // unknown tokens of a loaded line, kept as written
		var flags = { player: false, page: false, lattice: null };   // the figure flags as loaded (a line may set more than one)
		var shown = false, drawn = '', drawTimer = 0;

		function readForm() {
			var o = CL.blank();
			o.id = f.id.value.trim();
			o.name = f.name.value.trim() ? f.name.value.trim() : null;
			o.player = flags.player; o.page = flags.page; o.lattice = flags.lattice;
			o.hue = f.hueOn.input.checked ? +f.hue.value : null;
			o.skin = f.skin.value ? +f.skin.value : null;
			o.build = f.build.value || null;
			o.hair = f.hair.value || null;
			o.hairhue = f.hhOn.input.checked ? +f.hairhue.value : null;
			o.hairtone = f.hairtone.value || null;
			o.clothes = f.clothes.value || null;
			o.glasses = f.glasses.input.checked;
			o.hat = f.hat.input.checked;
			o.coauthor = f.coauthor.input.checked;
			o.extra = extra.slice();
			return o;
		}
		function figureOf(o) { return o.lattice ? o.lattice : o.player ? 'player' : o.page ? 'page' : 'person'; }
		function setForm(o) {
			f.id.value = o.id || '';
			f.name.value = o.name != null ? o.name : '';
			flags = { player: !!o.player, page: !!o.page, lattice: o.lattice || null };
			f.figure.value = figureOf(o);
			f.hueOn.input.checked = o.hue != null;
			f.skin.value = o.skin != null ? String(o.skin) : '';
			f.build.value = o.build || '';
			f.hair.value = o.hair || '';
			f.hhOn.input.checked = o.hairhue != null;
			f.hairtone.value = o.hairtone || '';
			f.clothes.value = o.clothes || '';
			f.glasses.input.checked = !!o.glasses;
			f.hat.input.checked = !!o.hat;
			f.coauthor.input.checked = !!o.coauthor;
			extra = (o.extra || []).slice();
			// the sliders show the value in force, written or picked from the name
			var d = CL.toDecl(o.id ? o : withId(o));
			f.hue.value = o.hue != null ? o.hue : d ? d.hue : 0;
			f.hairhue.value = o.hairhue != null ? o.hairhue : 25;
			refresh(true);
		}
		function withId(o) { var c = {}; for (var k in o) c[k] = o[k]; c.id = 'Name'; return c; }

		function refresh(fromLoad) {
			var o = readForm();
			var idProblem = CL.checkId(o.id);
			idMsg.textContent = idProblem;
			f.id.setAttribute('aria-invalid', idProblem ? 'true' : 'false');
			var line = CL.format(o);
			lineBox.textContent = line;
			// sliders that are not written follow the name, so the picture never lies about what the engine will draw
			var d = CL.toDecl(line);
			if (!f.hueOn.input.checked && d) f.hue.value = d.hue;
			f.hueN.textContent = f.hue.value + (f.hueOn.input.checked ? '' : ' auto');
			f.hueN.title = f.hueOn.input.checked ? 'written as hue=' + f.hue.value : 'not written: the engine picks this hue from the name';
			f.hhN.textContent = f.hhOn.input.checked ? f.hairhue.value : 'not written';
			f.hue.classList.toggle('is-auto', !f.hueOn.input.checked);
			f.hairhue.classList.toggle('is-auto', !f.hhOn.input.checked);
			var person = !o.lattice && !o.player && !o.page;
			[f.skin, f.build, f.hair, f.hairhue, f.hairtone, f.clothes, f.glasses.input, f.hat.input, f.hhOn.input].forEach(function (c) { c.closest('.cs-row').classList.toggle('is-moot', !person); });
			// extra tokens
			extraRow.innerHTML = '';
			extraRow.hidden = !extra.length;
			if (extra.length) {
				extraRow.appendChild(el('span', null, 'Kept as written (the engine does not know them): '));
				extraRow.appendChild(el('code', null, extra.join(' ')));
				var drop = button('Drop them', ''); drop.addEventListener('click', function () { extra = []; refresh(); });
				extraRow.appendChild(doc.createTextNode(' '));
				extraRow.appendChild(drop);
			}
			// what VN.parse says about the line
			var iss = idProblem ? [] : CL.issuesFor(line);
			issuesBox.innerHTML = '';
			iss.forEach(function (i) {
				var li = el('li', 'cs-' + i.level); li.textContent = i.msg + (i.hint ? ' (' + i.hint + ')' : ''); issuesBox.appendChild(li);
			});
			bInsert.disabled = !!idProblem;
			bUpdate.disabled = !!idProblem || !castUnderCursor();
			describeCursor();
			schedule(d && !idProblem ? d : CL.toDecl(withId(o)));
		}

		/* ---- the eight faces ---- */
		function schedule(decl) {
			if (!shown) return;
			var key = JSON.stringify(CL.declFields(decl));
			if (key === drawn) return;
			clearTimeout(drawTimer);
			drawTimer = setTimeout(function () { draw(decl, key); }, 40);
		}
		function draw(decl, key) {
			drawn = key;
			preview.innerHTML = '';
			if (!decl || !ART || !ART.sprite) { preview.appendChild(el('p', 'st-empty', 'The art files are missing, so there is no picture.')); return; }
			var one = decl.player || decl.page;
			var faces = one ? [] : VN.FACES;
			preview.classList.toggle('is-one', !!one);
			// the whole figure once, then the eight faces cropped to head and shoulders
			var full = el('figure', 'cs-full');
			var fbox = el('div', 'cs-spr');
			try { fbox.innerHTML = ART.sprite(decl, 'neutral'); } catch (e) { fbox.textContent = '?'; }
			full.appendChild(fbox);
			full.appendChild(el('figcaption', null, one ? (decl.player ? 'player: seen from behind' : 'page: no face') : (decl.name || decl.id)));
			preview.appendChild(full);
			faces.forEach(function (face) {
				var fig = el('figure', 'cs-face');
				var box = el('div', 'cs-spr');
				try { box.innerHTML = ART.sprite(decl, face); } catch (e) { box.textContent = '?'; }
				fig.appendChild(box);
				fig.appendChild(el('figcaption', null, face));
				preview.appendChild(fig);
			});
			preview.setAttribute('aria-label', (decl.name || decl.id) + ', drawn ' + (one ? 'once' : 'in all eight faces'));
		}

		/* ---- the script ---- */
		function castUnderCursor() {
			try { return CL.castAt(api.getText(), api.getCursorLine()); } catch (e) { return null; }
		}
		function describeCursor() {
			var c = castUnderCursor();
			where.textContent = c ? 'The cursor is on line ' + c.line + ': ' + c.form.id + '.' : 'Put the cursor on an @cast line to load it here.';
		}
		function listCast() {
			inScript.innerHTML = '';
			var all = CL.allCast(api.getText());
			if (!all.length) { inScript.appendChild(el('span', 'cs-help', 'No @cast in this script yet.')); return; }
			inScript.appendChild(el('span', 'cs-help', 'In this script:'));
			all.forEach(function (c) {
				var b = el('button', 'cs-chip', c.form.id); b.type = 'button';
				b.title = 'Line ' + c.line + ': ' + c.text;
				b.addEventListener('click', function () { api.gotoLine(c.line); loadFromCursor(); });
				inScript.appendChild(b);
			});
		}
		function loadFromCursor() {
			var c = castUnderCursor();
			if (c) setForm(c.form);
			else { bUpdate.disabled = true; describeCursor(); }
		}

		function insert() {
			var o = readForm(), problem = CL.checkId(o.id);
			if (problem) { api.setStatus(problem); f.id.focus(); return; }
			var text = api.getText(), have = CL.findCast(text, o.id);
			if (have) { api.setStatus(o.id + ' is already declared on line ' + have.line + '. Put the cursor there and use Update.'); return; }
			var line = CL.format(o), after = CL.insertAfter(text), lines = text.split('\n');
			if (after === 0) api.replaceLine(1, lines.length === 1 && !lines[0] ? line : line + '\n' + lines[0]);
			else api.replaceLine(after, lines[after - 1] + '\n' + line);
			api.gotoLine(after + 1);
			api.setStatus('Inserted ' + o.id + ' at line ' + (after + 1) + '.');
			listCast(); refresh();
		}
		function update() {
			var o = readForm(), problem = CL.checkId(o.id);
			if (problem) { api.setStatus(problem); return; }
			var text = api.getText(), c = CL.castAt(text, api.getCursorLine());
			if (!c) { api.setStatus('The cursor is not on an @cast line.'); bUpdate.disabled = true; return; }
			var other = CL.findCast(text, o.id);
			if (other && other.line !== c.line) { api.setStatus(o.id + ' is already declared on line ' + other.line + '.'); return; }
			var line = CL.format(o);
			if (c.end === c.line) api.replaceLine(c.line, line);
			else {
				var ls = text.split('\n');
				ls.splice(c.line - 1, c.end - c.line + 1, line);
				api.setText(ls.join('\n'));
			}
			api.gotoLine(c.line);
			api.setStatus('Updated line ' + c.line + '.');
			listCast(); refresh();
		}

		/* ---- wiring ---- */
		preset.addEventListener('change', function () {
			var v = preset.value;
			if (v === 'blank') { var b = CL.blank(); setForm(b); }
			else if (v !== '') setForm(CL.parse(CL.presets()[+v].line));
			preset.value = '';
		});
		f.figure.addEventListener('change', function () {
			var v = f.figure.value;
			flags = { player: v === 'player', page: v === 'page', lattice: v === 'sparse' || v === 'dense' ? v : null };
			refresh();
		});
		f.hue.addEventListener('input', function () { f.hueOn.input.checked = true; refresh(); });
		f.hairhue.addEventListener('input', function () { f.hhOn.input.checked = true; refresh(); });
		form.addEventListener('input', function (e) { if (e.target !== f.hue && e.target !== f.hairhue) refresh(); });
		form.addEventListener('change', function (e) { if (e.target !== f.figure) refresh(); });
		bInsert.addEventListener('click', insert);
		bUpdate.addEventListener('click', update);

		function onCursor() { if (!shown) return; var c = castUnderCursor(); if (c) setForm(c.form); else { bUpdate.disabled = true; describeCursor(); } }
		var listTimer = 0;
		function onDoc() { if (!shown) return; clearTimeout(listTimer); listTimer = setTimeout(function () { listCast(); bUpdate.disabled = !!CL.checkId(f.id.value.trim()) || !castUnderCursor(); describeCursor(); }, 60); }
		Studio.bus.on('cursor:line', onCursor);
		Studio.bus.on('doc:change', onDoc);

		// first state: the line under the cursor, else Jack
		setForm(CL.parse(CL.presets()[0].line));

		return {
			show: function () {
				shown = true;
				listCast();
				var c = castUnderCursor();
				if (c) setForm(c.form); else refresh();
			},
			hide: function () { shown = false; },
			unmount: function () { Studio.bus.off('cursor:line', onCursor); Studio.bus.off('doc:change', onDoc); }
		};
	}

	Studio.registerPanel({ id: 'cast', title: 'Cast', order: 30, mount: mount });
})();
