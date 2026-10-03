/* CV at a glance — a small gallery inserted after the About bio: one main stage
 * and a strip of previews underneath. Views:
 *   loop      the human–machine loop as a live diagram (two columns of three
 *             stages, the crossing arrows, the empirical and philosophical
 *             bands), with project cards wired to the stage they study;
 *   3d        the same loop as a rotatable model (assets/js/glance/loop3d.js,
 *             loaded on first use);
 *   timeline  one thin year line, 2022–2026.
 * Everything shown is parsed at runtime from the About, Publications, Teaching,
 * Talks and Experience sections of index.html (nothing is duplicated here).
 *
 * A new paper, talk or research role lands on a card by itself when its title
 * (or, for roles, its description) matches a CARDS regex below; anything that
 * matches nothing goes in the "Other" card instead of being dropped.
 *
 * Screenshot hook: ?glanceDebug=loop|3d|timeline&frame=N[&pick=<card id>]
 * freezes the animation at frame N (60 frames = 1 s) and forces the view.
 *
 * Tags needed in index.html: <link rel="stylesheet" href="assets/css/glance.css">
 * after main.css, and <script src="assets/js/glance.js" defer> after palette.js. */
(function () {
	'use strict';

	var SELF = (document.currentScript && document.currentScript.src) || '';
	var BASE = SELF ? SELF.replace(/[^\/]*$/, '') : 'assets/js/';

	var Y0 = 2022, Y1 = 2027, PAD = 2;     // year window [2022, 2027) and side gutter (%)
	var GAP = 0.1;                          // minimum spacing between marks, in years
	var LANES = [
		{ kind: 'paper', label: 'Papers' },
		{ kind: 'award', label: 'Honors' },
		{ kind: 'talk', label: 'Talks' },
		{ kind: 'role', label: 'Roles' },
		{ kind: 'teach', label: 'Teaching' }
	];
	var SEASON = { win: 0.02, jan: 0.02, feb: 0.1, spr: 0.17, mar: 0.18, apr: 0.27, may: 0.35, jun: 0.43,
		sum: 0.5, jul: 0.52, aug: 0.6, sep: 0.68, fal: 0.75, oct: 0.77, nov: 0.85, dec: 0.93 };

	function $(s, r) { return (r || document).querySelector(s); }
	function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
	function txt(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
	function clip(s, n) { return s.length > n ? s.slice(0, n - 1).replace(/[\s,;:—–-]+$/, '') + '…' : s; }
	function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
	function now() { var d = new Date(); return d.getFullYear() + (d.getMonth() + 0.5) / 12; }

	// "Fall 2023", "May 2024", "2025" -> fractional year (first or last date in the string)
	function when(s, last) {
		var re = /([A-Za-z]+)?\.?\s*(20\d\d)/g, m, hit = null;
		while ((m = re.exec(s))) { hit = m; if (!last) break; }
		if (!hit) return null;
		var k = hit[1] ? hit[1].slice(0, 3).toLowerCase() : '';
		return +hit[2] + (SEASON.hasOwnProperty(k) ? SEASON[k] : 0.5);
	}

	// ---- parse the page: timeline events ---------------------------------------
	function collect() {
		var ev = [];
		function add(kind, t, label, extra) {
			if (t == null || isNaN(t)) return;
			var e = { kind: kind, t: t, y: Math.floor(t), label: label, dated: true };
			if (extra) for (var k in extra) e[k] = extra[k];
			ev.push(e);
		}
		$$('#publicationsContent .pub-block').forEach(function (b) {
			var row = b.closest('.row'), y = +txt(row && $('.pub-year-h2', row));
			add('paper', y + 0.5, y + ' · ' + clip(txt($('.lucida-console', b)), 80), { dated: false });
		});
		$$('#aboutmeContent .abme-honors-bullet').forEach(function (li) {
			var m = (txt($('strong', li)) || txt(li)).match(/^(\d{4})\s*(.*)$/);
			if (m) add('award', +m[1] + 0.5, m[1] + ' · ' + clip(m[2], 80), { dated: false });
		});
		$$('#presentationsContent .row').forEach(function (row) {
			var y = +txt($('.pub-year-h2', row));
			$$('.lucida-console', row).forEach(function (el) {
				add('talk', y + 0.5, y + ' · ' + clip(txt(el), 80), { dated: false });
			});
		});
		$$('#experienceContent li').forEach(function (li) {
			var s = txt(li), t = when(s, true), head = s.split(/\s[—–]\s|;/)[0];
			if (t != null) add('role', t, Math.floor(t) + ' · ' + clip(head, 70));
		});
		$$('#academicContent .academic-block').forEach(function (b) {
			var span = txt($('.academic-year', b)), parts = span.split(/\s[—–-]\s/);
			var t = when(parts[0]), t2 = parts[1] ? (/present/i.test(parts[1]) ? now() : when(parts[1]) + 0.35) : t + 0.35;
			add('teach', t, span + ' · ' + clip(txt($('.academic-name', b)) + ', ' + txt($('.academic-rol', b)), 70), { t2: t2 });
		});
		return ev;
	}

	// ---- the loop: stages, cards, works ----------------------------------------
	var STAGES = [
		{ id: 'h1', side: 'Human', name: 'Interpret and set goals', sub: 'knowledge, intention, context' },
		{ id: 'h2', side: 'Human', name: 'Read and reason', sub: 'attention, tracing, understanding' },
		{ id: 'h3', side: 'Human', name: 'Judge and revise', sub: 'check, select, explain, challenge' },
		{ id: 'm1', side: 'Model', name: 'Represent the task', sub: 'tokens and internal features' },
		{ id: 'm2', side: 'Model', name: 'Generate and reason', sub: 'candidate outputs and evidence' },
		{ id: 'm3', side: 'Model', name: 'Change capabilities', sub: 'training, composition, removal' },
		{ id: 'xin', side: 'Human to model', name: 'Instruction and context' },
		{ id: 'xout', side: 'Model to human', name: 'Output and explanation' }
	];
	// Order matters: a work joins the first two cards whose regex it matches. Papers
	// and talks are matched on their title, roles on their whole line.
	// stages: what lights up with the card; wire: where its connector ends.
	var CARDS = [
		{ id: 'comp', label: 'Human code comprehension', stages: ['h2'], wire: ['h2'], to: 'Human · Read and reason',
			re: /obfuscat|program comprehension|code comprehension/i },
		{ id: 'align', label: 'Human–model alignment', stages: ['xin', 'xout', 'm2'], wire: ['xin', 'xout'], to: 'the crossing arrows · Generate and reason',
			re: /\bhumans?\b[^.]*\b(machines?|models?|llms?)\b|\b(machines?|models?|llms?)\b[^.]*\bhumans?\b|dual-process|cognit|psycholinguist|human language processing/i },
		{ id: 'se', label: 'LLMs for software engineering', stages: ['h3'], wire: ['h3'], to: 'Human · Judge and revise',
			re: /software (engineering|development)|verifiab|program repair|code generation/i },
		{ id: 'unl', label: 'Adaptation and unlearning', stages: ['m3'], wire: ['m3'], to: 'Model · Change capabilities',
			re: /unlearn|forgetting/i },
		{ id: 'attr', label: 'Attribution', stages: ['m3'], wire: ['m3'], to: 'Model · Change capabilities',
			re: /attribut|provenance|influence function/i },
		{ id: 'phil', label: 'Meaning and representation', stages: ['m1'], wire: ['m1'], to: 'Model · Represent the task (philosophical inquiry)',
			re: /semiotic|embedding|philosoph|\bmeaning\b/i },
		{ id: 'sci', label: 'Science mapping and ML for science', stages: ['m2'], wire: ['m2'], to: 'Model · Generate and reason',
			re: /summariz|scientometric|patent|map of science|\bCSET\b|landscape|materials|scientific (research|text|discovery)/i },
		{ id: 'eval', label: 'Model behavior and evaluation', stages: ['xout'], wire: ['xout'], to: 'Output and explanation',
			re: /evaluat|recurrence|frontier|\bbias\b|fairness|benchmark/i }
	];
	var OTHER = { id: 'other', label: 'Other', stages: [], wire: [], to: '' };
	var KIND = {
		paper: { word: 'Paper', many: 'papers', href: '#/publications' },
		talk: { word: 'Talk', many: 'talks', href: '#/presentations' },
		role: { word: 'Role', many: 'roles', href: '#/experience' }
	};

	function works() {
		var out = [];
		function add(kind, title, where, hay, year) {
			if (!title) return;
			var cs = CARDS.filter(function (c) { return c.re.test(hay); }).map(function (c) { return c.id; }).slice(0, 2);
			out.push({ kind: kind, cards: cs.length ? cs : [OTHER.id], title: title, where: where || '', year: year || '' });
		}
		function year(el) { var row = el.closest('.row'); return txt(row && $('.pub-year-h2', row)); }
		$$('#publicationsContent .pub-block').forEach(function (b) {
			var title = txt($('.lucida-console', b));
			add('paper', title, txt($('.pub-congress', b)).split(/\.(?:\s|$)/)[0], title, year(b));
		});
		$$('#presentationsContent .row .lucida-console').forEach(function (el) {
			var title = txt(el);
			add('talk', title, txt(el.nextElementSibling).replace(/^\[[^\]]*\]\s*/, '').replace(/\.$/, ''), title, year(el));
		});
		// Research roles always; industry roles only when they match a card.
		$$('#experienceContent h3').forEach(function (h) {
			var research = /research/i.test(txt(h)), ul = h.nextElementSibling;
			if (!ul || !(research || /industry/i.test(txt(h)))) return;
			$$('li', ul).forEach(function (li) {
				var s = txt(li), cut = s.search(/\s[—–]\s/), known = CARDS.some(function (c) { return c.re.test(s); });
				if (research || known) add('role', cut > 0 ? s.slice(0, cut) : s, cut > 0 ? s.slice(cut + 3).replace(/\.$/, '') : '', s);
			});
		});
		return out;
	}

	function counts(list) {
		return ['paper', 'talk', 'role'].map(function (k) {
			var n = list.filter(function (w) { return w.kind === k; }).length;
			return n ? n + ' ' + (n === 1 ? k : KIND[k].many) : '';
		}).filter(Boolean).join(', ');
	}

	// Cards that actually hold something, each with its works.
	function model(items) {
		var cards = CARDS.concat([OTHER]).map(function (c) {
			var mine = items.filter(function (w) { return w.cards.indexOf(c.id) >= 0; });
			return { id: c.id, label: c.label, stages: c.stages, wire: c.wire, to: c.to, works: mine, meta: counts(mine) };
		}).filter(function (c) { return c.works.length; });
		return { stages: STAGES, cards: cards, total: items.length };
	}

	// ---- loop view: the diagram ------------------------------------------------
	// Two hand-tuned layouts in their own design space; the SVG scales to its box.
	var WIDE = { W: 760, H: 512, bx: 160, bw: 440, by: 96, bh: 324, hx: 184, mx: 436, cw: 140, sy: [150, 234, 318], sh: 62,
		bandY: 6, bandH: 34, philY: 482, philH: 22, titleY: 113, headY: 142, underY: 396, retX: 172, nameN: 99, subN: 25, wide: true };
	var NARROW = { W: 340, H: 424, bx: 4, bw: 332, by: 50, bh: 332, hx: 22, mx: 210, cw: 122, sy: [106, 192, 278], sh: 66,
		bandY: 6, bandH: 34, philY: 394, philH: 22, titleY: 67, headY: 98, underY: 358, retX: 12, nameN: 20, subN: 25, wide: false };
	// card boxes in the wide layout: [x, y, w, h]
	var SLOT = {
		comp: [8, 243, 140, 44], se: [8, 319, 140, 44], other: [8, 430, 140, 44],
		align: [310, 46, 140, 42], eval: [310, 430, 140, 44],
		phil: [612, 159, 140, 44], sci: [612, 243, 140, 44], unl: [612, 315, 140, 44], attr: [612, 365, 140, 44]
	};
	var PERIOD = 9;   // seconds for one pulse to go round the loop

	function wrap(s, n) {
		var out = [], line = '';
		s.split(' ').forEach(function (w) {
			if (line && (line + ' ' + w).length > n) { out.push(line); line = w; }
			else line = line ? line + ' ' + w : w;
		});
		if (line) out.push(line);
		return out;
	}
	function text(cls, x, y, lines, anchor, lh) {
		return '<text class="' + cls + '" x="' + x + '" y="' + y + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' +
			lines.map(function (l, i) { return '<tspan x="' + x + '"' + (i ? ' dy="' + lh + '"' : '') + '>' + esc(l) + '</tspan>'; }).join('') + '</text>';
	}
	function head(x, y, d) {   // arrowhead with its tip at (x, y), pointing r, l, d or u
		var s = 5, w = 3.2, p = d === 'r' ? [x - s, y - w, x - s, y + w] : d === 'l' ? [x + s, y - w, x + s, y + w] :
			d === 'd' ? [x - w, y - s, x + w, y - s] : [x - w, y + s, x + w, y + s];
		return '<path class="glance-ahead" d="M' + x + ' ' + y + 'L' + p[0] + ' ' + p[1] + 'L' + p[2] + ' ' + p[3] + 'Z"/>';
	}
	function vline(x, y1, y2) {   // vertical arrow, either direction
		var down = y2 > y1;
		return '<path class="glance-arrow" d="M' + x + ' ' + y1 + 'V' + (down ? y2 - 4 : y2 + 4) + '"/>' + head(x, y2, down ? 'd' : 'u');
	}

	function loopSvg(md, wide) {
		var L = wide ? WIDE : NARROW, hc = L.hx + L.cw / 2, mc = L.mx + L.cw / 2, cx = L.bx + L.bw / 2;
		var r = L.sy.map(function (y) { return y + L.sh / 2; }), ry = L.sy[2] + L.sh - 18, hr = L.hx + L.cw, mr = L.mx + L.cw;
		var o = [], zones = [], pos = {};
		function n(card) { return md.cards.filter(function (c) { return c.stages.indexOf(card) >= 0; }).length; }

		// inquiry bands, with their arrows into the loop
		o.push('<rect class="glance-band" x="' + L.bx + '" y="' + L.bandY + '" width="' + L.bw + '" height="' + L.bandH + '" rx="6"/>' +
			text('glance-bandname', cx, L.bandY + 14, ['Empirical inquiry · top down'], 'middle') +
			text('glance-bandsub', cx, L.bandY + 26, ['Observe behavior. Test mechanisms. Evaluate interventions.'], 'middle') +
			vline(hc, L.bandY + L.bandH, L.by) + vline(mc, L.bandY + L.bandH, L.by));
		o.push('<rect class="glance-band" x="' + L.bx + '" y="' + L.philY + '" width="' + L.bw + '" height="' + L.philH + '" rx="6"/>' +
			text('glance-bandname', cx, L.philY + 14.5, ['Philosophical inquiry · bottom up'], 'middle') +
			vline(hc, L.philY, L.by + L.bh) + vline(mc, L.philY, L.by + L.bh));

		// the loop box
		o.push('<rect class="glance-box" x="' + L.bx + '" y="' + L.by + '" width="' + L.bw + '" height="' + L.bh + '" rx="10"/>' +
			text('glance-boxname', L.bx + 12, L.titleY, ['The human–machine loop']) +
			text('glance-boxsub', L.bx + 12, L.titleY + 11, ['the interaction as a unit of study']) +
			text('glance-colname', hc, L.headY, ['Human'], 'middle') + text('glance-colname', mc, L.headY, ['Model'], 'middle'));

		// connectors (wide only): card edge -> stage edge, drawn under everything else
		if (L.wide) {
			var route = {
				comp: 'M148 ' + r[1] + 'H' + L.hx, se: 'M148 ' + (r[2] - 8) + 'H' + L.hx,
				phil: 'M612 ' + r[0] + 'H' + mr, sci: 'M612 ' + r[1] + 'H' + mr, unl: 'M612 ' + (r[2] - 12) + 'H' + mr,
				attr: 'M612 ' + (r[2] + 38) + 'H594V' + (r[2] + 18) + 'H' + mr,
				align: 'M' + cx + ' 88V' + r[0], eval: 'M' + cx + ' 430V' + r[1]
			};
			var end = { comp: [L.hx, r[1]], se: [L.hx, r[2] - 8], phil: [mr, r[0]], sci: [mr, r[1]], unl: [mr, r[2] - 12],
				attr: [mr, r[2] + 18], align: [cx, r[0]], eval: [cx, r[1]] };
			md.cards.forEach(function (c) {
				if (!route[c.id]) return;
				o.push('<path class="glance-wire" data-card="' + c.id + '" d="' + route[c.id] + '"/>' +
					'<circle class="glance-wire-end" data-card="' + c.id + '" cx="' + end[c.id][0] + '" cy="' + end[c.id][1] + '" r="2.4"/>');
			});
		}

		// arrows of the loop itself
		o.push(vline(hc, L.sy[0] + L.sh, L.sy[1]) + vline(hc, L.sy[1] + L.sh, L.sy[2]) +
			vline(mc, L.sy[0] + L.sh, L.sy[1]) + vline(mc, L.sy[1] + L.sh, L.sy[2]));
		o.push('<path class="glance-arrow" d="M' + L.hx + ' ' + ry + 'H' + L.retX + 'V' + r[0] + 'H' + (L.hx - 4) + '"/>' + head(L.hx, r[0], 'r'));
		o.push(text('glance-note', hc, L.underY, ['Review reshapes', 'the next instruction'], 'middle', 10) +
			text('glance-note', mc, L.underY, L.wide ? ['Outputs shape interpretation', 'and action'] : ['Outputs shape', 'interpretation and action'], 'middle', 10));

		// pulses: under the stage boxes, so they are seen only on the arrows
		o.push('<g class="glance-pulses" aria-hidden="true"><circle class="glance-pulse" r="3.2"/><circle class="glance-pulse" r="3.2"/>' +
			'<circle class="glance-pulse" r="3.2"/><circle class="glance-pulse glance-pulse-side" r="2.6"/></g>');

		// crossing arrows
		[['xin', hr, L.mx, r[0], 'r', ['Instruction', 'and context'], 14], ['xout', L.mx, hr, r[1], 'l', ['Output and', 'explanation'], -19]].forEach(function (a) {
			var x0 = Math.min(a[1], a[2]), w = Math.abs(a[2] - a[1]);
			pos[a[0]] = { x: x0, y: a[3] - 3, w: w, h: 6 };
			zones.push({ id: a[0], x: x0, y: a[3] - 3, w: w, h: 6 });
			o.push('<g class="glance-x" data-stage="' + a[0] + '" tabindex="0" role="button" aria-label="' + esc(a[5].join(' ') + ': ' + n(a[0]) + ' cards') + '">' +
				'<rect class="glance-hit" x="' + x0 + '" y="' + (a[3] - 24) + '" width="' + w + '" height="48"/>' +
				'<path class="glance-arrow" d="M' + a[1] + ' ' + a[3] + 'H' + (a[4] === 'r' ? a[2] - 4 : a[2] + 4) + '"/>' + head(a[2], a[3], a[4]) +
				text('glance-xlabel', x0 + w / 2, a[3] + a[6], a[5], 'middle', 10) + '</g>');
		});

		// stages
		STAGES.slice(0, 6).forEach(function (s, i) {
			var x = i < 3 ? L.hx : L.mx, y = L.sy[i % 3], name = wrap(s.name, L.nameN), sub = wrap(s.sub, L.subN);
			var ny = name.length > 1 ? 15 : 17, sy0 = y + ny + (name.length - 1) * 11 + 14;
			zones.push({ id: s.id, x: x, y: y, w: L.cw, h: L.sh });
			o.push('<g class="glance-stage" data-stage="' + s.id + '" tabindex="0" role="button" aria-label="' +
				esc(s.side + ' stage: ' + s.name + ' (' + s.sub + '). ' + n(s.id) + ' cards') + '">' +
				'<rect class="glance-stage-base" x="' + x + '" y="' + y + '" width="' + L.cw + '" height="' + L.sh + '" rx="6"/>' +
				'<rect class="glance-stage-glow" x="' + x + '" y="' + y + '" width="' + L.cw + '" height="' + L.sh + '" rx="6"/>' +
				text('glance-sname', x + L.cw / 2, y + ny, name, 'middle', 11) +
				text('glance-ssub', x + L.cw / 2, sy0, sub, 'middle', 10) + '</g>');
		});

		// project cards (wide only; narrower widths list them as buttons under the gallery)
		if (L.wide) md.cards.forEach(function (c) {
			var b = SLOT[c.id];
			if (!b) return;
			var lab = wrap(c.label, 22), two = lab.length > 1;
			o.push('<g class="glance-card' + (c.id === 'other' ? ' is-other' : '') + '" data-card="' + c.id + '" tabindex="0" role="button" aria-label="' +
				esc(c.label + ': ' + c.meta + (c.to ? ', wired to ' + c.to : '')) + '">' +
				'<rect x="' + b[0] + '" y="' + b[1] + '" width="' + b[2] + '" height="' + b[3] + '" rx="6"/>' +
				text('glance-cname', b[0] + 9, b[1] + (two ? 14 : 18), lab, '', 11) +
				text('glance-cmeta', b[0] + 9, b[1] + (two ? 37 : 33), [c.meta]) + '</g>');
		});

		return {
			html: '<svg class="glance-loop' + (L.wide ? '' : ' is-narrow') + '" viewBox="0 0 ' + L.W + ' ' + L.H + '" width="100%" role="group" aria-label="' +
				'The human–machine loop: human and model columns of three stages each, joined by instruction and output arrows, with ' +
				md.cards.length + ' project cards wired to the stage they study">' + o.join('') + '</svg>',
			ratio: L.H / L.W, zones: zones,
			path: [[hc, r[0]], [mc, r[0]], [mc, r[1]], [hc, r[1]], [hc, ry], [L.retX, ry], [L.retX, r[0]], [hc, r[0]]],
			side: [[mc, r[1]], [mc, r[2]]]
		};
	}

	function along(pts, d) {   // point at distance d on an axis-aligned polyline, or null past its end
		for (var i = 1; i < pts.length; i++) {
			var a = pts[i - 1], b = pts[i], seg = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
			if (d <= seg) return [a[0] + (b[0] - a[0]) * d / seg, a[1] + (b[1] - a[1]) * d / seg];
			d -= seg;
		}
		return null;
	}
	function length(pts) {
		var n = 0;
		for (var i = 1; i < pts.length; i++) n += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
		return n;
	}

	// ---- thumbnails --------------------------------------------------------------
	var VIEWS = ['loop', '3d', 'timeline'];
	var NAMES = { loop: 'Loop', '3d': '3D', timeline: 'Timeline' };
	var THUMB = {
		loop: '<rect class="t-l" x="20" y="9" width="56" height="36" rx="3"/><path class="t-l" d="M30 4H66M30 50H66"/>' +
			'<rect class="t-f" x="25" y="13" width="17" height="7" rx="1.5"/><rect class="t-f" x="25" y="23.5" width="17" height="7" rx="1.5"/><rect class="t-f" x="25" y="34" width="17" height="7" rx="1.5"/>' +
			'<rect class="t-f" x="54" y="13" width="17" height="7" rx="1.5"/><rect class="t-f" x="54" y="23.5" width="17" height="7" rx="1.5"/><rect class="t-f" x="54" y="34" width="17" height="7" rx="1.5"/>' +
			'<path class="t-a" d="M42 16.5H54M54 27H42"/><circle class="t-d" cx="48" cy="16.5" r="1.8"/>' +
			'<rect class="t-l" x="3" y="23" width="11" height="8" rx="1.5"/><rect class="t-l" x="82" y="13" width="11" height="8" rx="1.5"/><rect class="t-l" x="82" y="33" width="11" height="8" rx="1.5"/>' +
			'<path class="t-l" d="M14 27H25M82 17H71M82 37H71"/>',
		'3d': '<path class="t-a" d="M48 27C56 12 86 12 86 27S56 42 48 27S10 12 10 27S40 42 48 27Z"/>' +
			'<path class="t-l" d="M22 16L12 7M74 38L86 47M74 16L84 7"/>' +
			'<circle class="t-d" cx="22" cy="16" r="2.4"/><circle class="t-d" cx="10" cy="27" r="2.4"/><circle class="t-d" cx="22" cy="38" r="2.4"/>' +
			'<circle class="t-d" cx="74" cy="16" r="2.4"/><circle class="t-d" cx="74" cy="38" r="2.4"/>' +
			'<circle class="t-f" cx="12" cy="7" r="2"/><circle class="t-f" cx="86" cy="47" r="2"/><circle class="t-f" cx="84" cy="7" r="2"/>',
		timeline: '<path class="t-l" d="M8 42H88M8 8V45M28 8V45M48 8V45M68 8V45M88 8V45"/>' +
			'<circle class="t-d" cx="36" cy="14" r="2.2"/><circle class="t-d" cx="72" cy="14" r="2.2"/><circle class="t-d" cx="78" cy="14" r="2.2"/><circle class="t-d" cx="84" cy="14" r="2.2"/>' +
			'<circle class="t-f" cx="14" cy="22" r="2"/><circle class="t-f" cx="56" cy="22" r="2"/><circle class="t-f" cx="62" cy="22" r="2"/>' +
			'<path class="t-a" d="M30 31H52M44 35H80"/>'
	};

	// ---- year line -------------------------------------------------------------------
	function pct(t) { return PAD + (Math.min(Math.max(t, Y0), Y1) - Y0) / (Y1 - Y0) * (100 - 2 * PAD); }

	function spread(list) {
		var byYear = {};
		list.filter(function (e) { return !e.dated; }).forEach(function (e) {
			var y = Math.floor(e.t); (byYear[y] = byYear[y] || []).push(e);
		});
		Object.keys(byYear).forEach(function (y) {
			var g = byYear[y];
			var step = Math.min(GAP, 0.8 / Math.max(g.length - 1, 1));
			g.forEach(function (e, i) { e.t = +y + 0.5 + (i - (g.length - 1) / 2) * step; });
		});
		list.sort(function (a, b) { return a.t - b.t; });
		for (var i = 1; i < list.length; i++) if (list[i].t - list[i - 1].t < GAP) list[i].t = list[i - 1].t + GAP;
		return list;
	}

	function rows(bars) {   // greedy sub-rows so overlapping teaching bars never stack on one line
		var ends = [];
		bars.forEach(function (b) {
			var r = 0;
			while (r < ends.length && ends[r] > b.t - 0.05) r++;
			ends[r] = b.t2; b.row = r;
		});
		return ends.length || 1;
	}

	function svg(events) {
		var H = 0, parts = [], marks = [], lanes = [];
		LANES.forEach(function (l) {
			var list = events.filter(function (e) { return e.kind === l.kind; });
			if (!list.length) return;
			var top = H + 6, h = 16;
			if (l.kind === 'teach') { h = rows(list) * 6 + 8; } else { spread(list); }
			lanes.push({ label: l.label, top: top, h: h });
			list.forEach(function (e) {
				var x = pct(e.t), y = top + (l.kind === 'teach' ? 4 + e.row * 6 : h / 2);
				var a = ' class="glance-mark glance-' + e.kind + '" tabindex="0" role="img" aria-label="' + esc(e.label) +
					'" style="--d:' + Math.round(120 + x * 5) + '"><title>' + esc(e.label) + '</title>';
				if (e.kind === 'award') marks.push('<circle cx="' + x + '%" cy="' + y + '" r="4"' + a + '</circle>');
				else if (e.kind === 'talk') marks.push('<rect x="' + x + '%" y="' + y + '" width="7" height="7" transform="translate(-3.5 -3.5)"' + a + '</rect>');
				else if (e.kind === 'teach') marks.push('<rect x="' + x + '%" y="' + (y - 1.5) + '" width="' + Math.max(0.8, pct(e.t2) - x) + '%" height="3" rx="1.5"' + a + '</rect>');
				else marks.push('<circle cx="' + x + '%" cy="' + y + '" r="' + (e.kind === 'paper' ? 4 : 3) + '"' + a + '</circle>');
			});
			H = top + h;
		});
		var axis = H + 6, total = axis + 20;
		for (var y = Y0; y <= Y1; y++) {
			var x = pct(y);
			parts.push('<line class="glance-tick" x1="' + x + '%" x2="' + x + '%" y1="2" y2="' + (axis + 3) + '"></line>');
			if (y < Y1) parts.push('<text class="glance-year" x="' + (x + 50 / (Y1 - Y0) * (100 - 2 * PAD) / 100) + '%" y="' + (axis + 15) + '" text-anchor="middle">' + y + '</text>');
		}
		parts.push('<line class="glance-axis" x1="' + PAD + '%" x2="' + (100 - PAD) + '%" y1="' + axis + '" y2="' + axis + '"></line>');
		var labels = lanes.map(function (l) {
			return '<span class="glance-lane" style="top:' + l.top + 'px;height:' + l.h + 'px">' + l.label + '</span>';
		}).join('');
		return '<div class="glance-lanes" aria-hidden="true" style="height:' + total + 'px">' + labels + '</div>' +
			'<svg class="glance-svg" height="' + total + '" width="100%" role="group" aria-label="Year line, ' + Y0 + ' to ' + (Y1 - 1) + '">' +
			parts.join('') + marks.join('') + '</svg>';
	}

	function range(list) {
		if (!list.length) return '';
		var ys = list.map(function (e) { return e.y; });
		var a = Math.min.apply(null, ys), b = Math.max.apply(null, ys);
		return a === b ? String(a) : a + '–' + b;
	}

	// ---- build -------------------------------------------------------------------------
	function debugOpts() {
		var m = /[?&]glanceDebug=([\w]+)/.exec(window.location.search + window.location.hash);
		if (!m) return null;
		var f = /[?&]frame=(\d+)/.exec(window.location.search + window.location.hash);
		var p = /[?&]pick=(\w+)/.exec(window.location.search + window.location.hash);
		return { view: m[1], frame: f ? +f[1] : 0, pick: p ? p[1] : '' };
	}

	function build() {
		if ($('#cv-glance')) return;
		var row = $('#aboutmeContent .container > .row'), bio = row && $('p.justify', row);
		if (!bio) return;
		var ev = collect(), md = model(works()), debug = debugOpts();
		var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
		var reduced = !!(mq && mq.matches);

		var el = document.createElement('div');
		el.className = 'glance';
		el.id = 'cv-glance';
		el.tabIndex = -1;
		el.setAttribute('role', 'group');
		el.setAttribute('aria-label', 'CV at a glance');
		el.innerHTML =
			'<div class="glance-head"><span class="glance-title">Research map</span><span class="glance-viewname"></span></div>' +
			'<div class="glance-frame">' +
			'<div class="glance-view glance-view-loop" data-view="loop"></div>' +
			'<div class="glance-view glance-view-3d" data-view="3d" hidden><div class="glance-3d-host"></div>' +
			'<p class="glance-3d-msg" hidden></p><div class="glance-sr">' +
			md.cards.map(function (c) { return '<button type="button" data-card="' + c.id + '">' + esc(c.label + ': ' + c.meta) + '</button>'; }).join('') +
			STAGES.map(function (s) { return '<button type="button" data-stage="' + s.id + '">' + esc(s.side + ': ' + s.name) + '</button>'; }).join('') +
			'</div></div>' +
			'<div class="glance-view glance-view-timeline" data-view="timeline" hidden><div class="glance-line">' + svg(ev) + '</div></div>' +
			'<p class="glance-caption" aria-live="polite"></p>' +
			'</div>' +
			'<div class="glance-thumbs" role="group" aria-label="Research map views">' +
			VIEWS.map(function (v) {
				return '<button type="button" class="glance-thumb" data-view="' + v + '" aria-pressed="false" aria-label="' + NAMES[v] + ' view">' +
					'<svg viewBox="0 0 96 54" aria-hidden="true">' + THUMB[v] + '</svg><span>' + NAMES[v] + '</span></button>';
			}).join('') + '</div>' +
			'<div class="glance-cards">' + md.cards.map(function (c) {
				return '<button type="button" class="glance-hcard' + (c.id === 'other' ? ' is-other' : '') + '" data-card="' + c.id + '">' +
					'<span class="glance-hcard-name">' + esc(c.label) + '</span><span class="glance-hcard-meta">' + esc(c.meta) +
					(c.to ? ' → ' + esc(c.to) : '') + '</span></button>';
			}).join('') + '</div>' +
			'<div class="glance-detail"></div>';

		var frame = $('.glance-frame', el), cap = $('.glance-caption', el), detail = $('.glance-detail', el);
		var loopView = $('.glance-view-loop', el), host3d = $('.glance-3d-host', el), msg3d = $('.glance-3d-msg', el);
		var cur = '', pinned = null, described = null, onscreen = !window.IntersectionObserver, drawn = 0;
		var geo = null, raf = 0, t0 = 0, v3 = null, loading3d = false, hoverTimer = 0;
		var idle = {
			loop: md.total + ' works on ' + md.cards.length + ' cards · hover, tab or tap a card or a stage',
			'3d': 'drag to turn · hover, tab or tap a node for its works',
			timeline: ev.length + ' entries, ' + range(ev) + ' · hover or tab a mark for its label'
		};

		// -- selection: {card: id} or {stage: id} ------------------------------------------
		function card(id) { return md.cards.filter(function (c) { return c.id === id; })[0]; }
		function stage(id) { return STAGES.filter(function (s) { return s.id === id; })[0]; }
		function resolve(sel) {
			if (!sel) return null;
			if (sel.card) { var c = card(sel.card); return c ? { cards: [c.id], stages: c.stages } : null; }
			if (!stage(sel.stage)) return null;
			return { stages: [sel.stage], cards: md.cards.filter(function (c) { return c.stages.indexOf(sel.stage) >= 0; }).map(function (c) { return c.id; }) };
		}
		function paint(sel) {   // highlight only
			var r = resolve(sel);
			$$('.is-on', el).forEach(function (n) { n.classList.remove('is-on'); });
			el.classList.toggle('is-dim', !!r);
			if (r) $$('[data-card],[data-stage]', el).forEach(function (n) {
				if (n.classList.contains('glance-thumb')) return;
				var c = n.getAttribute('data-card'), s = n.getAttribute('data-stage');
				if ((c && r.cards.indexOf(c) >= 0) || (s && r.stages.indexOf(s) >= 0)) n.classList.add('is-on');
			});
			if (v3) v3.setHighlight(r);
		}
		function li(w) {
			return '<li><span class="glance-kind">' + KIND[w.kind].word + '</span><a href="' + KIND[w.kind].href + '">' + esc(w.title) + '</a>' +
				(w.where || w.year ? '<span class="glance-venue">' + esc([clip(w.where, 90), w.where.indexOf(w.year) < 0 ? w.year : ''].filter(Boolean).join(' · ')) + '</span>' : '') + '</li>';
		}
		function describe(sel) {   // caption and the list of works; stays until something else is chosen
			var r = resolve(sel), list = [], headline, to;
			if (!r) return;
			described = sel;
			if (sel.card) {
				var c = card(sel.card);
				headline = c.label; to = c.to; list = c.works;
				cap.textContent = c.label + ' · ' + c.meta + (c.to ? ' → ' + c.to : '');
			} else {
				var s = stage(sel.stage);
				headline = s.side + ' · ' + s.name;
				to = r.cards.length ? r.cards.map(function (id) { return card(id).label; }).join(', ') : 'no card is wired here';
				r.cards.forEach(function (id) { card(id).works.forEach(function (w) { if (list.indexOf(w) < 0) list.push(w); }); });
				cap.textContent = headline + ' · ' + (r.cards.length ? r.cards.length + (r.cards.length === 1 ? ' card: ' : ' cards: ') + to : to);
			}
			cap.classList.add('is-live');
			detail.innerHTML = '<p class="glance-detail-head"><span>' + esc(headline) + '</span>' + (to ? '<span class="glance-detail-to">' + (sel.card ? '→ ' : '') + esc(to) + '</span>' : '') + '</p>' +
				(list.length ? '<ul>' + list.map(li).join('') + '</ul>' : '');
		}
		function hit(e) {
			var n = e.target && e.target.closest ? e.target.closest('[data-card],[data-stage]') : null;
			if (!n || !el.contains(n)) return null;
			return n.hasAttribute('data-card') ? { card: n.getAttribute('data-card') } : { stage: n.getAttribute('data-stage') };
		}
		function same(a, b) { return !!a && !!b && a.card === b.card && a.stage === b.stage; }
		function hover(sel) { if (sel) { paint(sel); describe(sel); } else paint(pinned); }
		function pin(sel) { pinned = same(sel, pinned) ? null : sel; paint(pinned || sel); if (sel) describe(sel); }

		el.addEventListener('mouseover', function (e) { if (cur !== 'timeline' && !e.target.closest('canvas')) hover(hit(e)); });
		el.addEventListener('mouseleave', function () { paint(pinned); });
		el.addEventListener('focusin', function (e) { var s = hit(e); if (s) hover(s); });
		el.addEventListener('focusout', function (e) { if (hit(e)) paint(pinned); });
		el.addEventListener('click', function (e) { var s = hit(e); if (s) pin(s); });
		el.addEventListener('keydown', function (e) {
			if ((e.key === 'Enter' || e.key === ' ') && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A') {
				var s = hit(e);
				if (s) { e.preventDefault(); pin(s); }
			}
		});

		// -- loop view ---------------------------------------------------------------------------
		function tick(t) {   // place the pulses and light the stages they are passing through, t in seconds
			if (!geo) return;
			var len = length(geo.path), speed = len / PERIOD, lit = {}, ps = geo.pulses, i, p;
			function mark(p) { geo.zones.forEach(function (z) { if (p[0] >= z.x && p[0] <= z.x + z.w && p[1] >= z.y && p[1] <= z.y + z.h) lit[z.id] = 1; }); }
			for (i = 0; i < 3; i++) {
				p = along(geo.path, ((t / PERIOD + i / 3) % 1) * len) || geo.path[0];
				ps[i].setAttribute('cx', p[0].toFixed(1)); ps[i].setAttribute('cy', p[1].toFixed(1));
				mark(p);
			}
			// a side pulse leaves "Generate and reason" for "Change capabilities" each time a pulse passes
			var d0 = length(geo.path.slice(0, 3)), gap = PERIOD / 3, since = (((t - d0 / speed) % gap) + gap) % gap;
			p = along(geo.side, since * speed * 0.8);
			ps[3].style.display = p ? '' : 'none';
			if (p) { ps[3].setAttribute('cx', p[0].toFixed(1)); ps[3].setAttribute('cy', p[1].toFixed(1)); mark(p); }
			geo.stages.forEach(function (n) { n.classList.toggle('is-lit', !!lit[n.getAttribute('data-stage')]); });
		}
		function drawLoop() {
			var w = Math.round(frame.clientWidth) || (drawn ? 0 : 760);
			if (!w || Math.abs(w - drawn) < 6) return;
			drawn = w;
			var wide = w >= 600, g = loopSvg(md, wide);
			loopView.innerHTML = g.html;
			el.classList.toggle('is-narrow', !wide);
			frame.style.setProperty('--gh', Math.round(w * g.ratio) + 'px');
			geo = { path: g.path, side: g.side, zones: g.zones, pulses: $$('.glance-pulse', loopView), stages: $$('.glance-stage,.glance-x', loopView) };
			tick(debug ? debug.frame / 60 : reduced ? 1.25 : (performance.now() - t0) / 1000);
			paint(pinned);
		}
		function step(ms) {
			raf = requestAnimationFrame(step);
			tick((ms - t0) / 1000);
		}

		// -- 3D view (lazy) --------------------------------------------------------------------
		function fail3d() {
			host3d.hidden = true; msg3d.hidden = false;
			msg3d.textContent = 'The 3D view could not load here. The Loop view shows the same diagram.';
		}
		function ensure3d() {
			if (v3 || loading3d) return;
			loading3d = true;
			msg3d.hidden = false; msg3d.textContent = 'Loading the 3D model…';
			function ready() {
				try {
					v3 = window.GlanceLoop3D.mount(host3d, {
						stages: STAGES.map(function (s) { return { id: s.id, name: s.name }; }),
						cards: md.cards.map(function (c) { return { id: c.id, label: c.label, wire: c.wire }; })
					}, {
						reduced: reduced,
						onHover: function (sel) { hover(sel); },
						onPick: function (sel) { if (sel) pin(sel); }
					});
				} catch (err) { v3 = null; }
				if (!v3) return fail3d();
				msg3d.hidden = true;
				if (debug) v3.frame(debug.frame);
				paint(pinned);
				sync();
			}
			if (window.GlanceLoop3D) return ready();
			var s = document.createElement('script');
			s.src = BASE + 'glance/loop3d.js';
			s.onload = function () { if (window.GlanceLoop3D) ready(); else fail3d(); };
			s.onerror = fail3d;
			document.head.appendChild(s);
		}

		// -- gallery ---------------------------------------------------------------------------------
		function sync() {   // animate only what is selected, on screen, and allowed to move
			var run = onscreen && !document.hidden && !reduced && !debug;
			if (cur === 'loop' && run) { if (!raf) raf = requestAnimationFrame(step); }
			else if (raf) { cancelAnimationFrame(raf); raf = 0; }
			if (v3) { if (cur === '3d' && run) v3.start(); else v3.stop(); }
		}
		function setView(v, save) {
			if (VIEWS.indexOf(v) < 0) v = 'loop';
			if (v === cur) return;
			cur = v;
			$$('.glance-view', el).forEach(function (n) { n.hidden = n.getAttribute('data-view') !== v; });
			$$('.glance-thumb', el).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === v)); });
			el.setAttribute('data-view', v);
			$('.glance-viewname', el).textContent = NAMES[v];
			cap.classList.remove('is-live');
			cap.textContent = idle[v];
			if (v !== 'timeline' && described) describe(described);
			if (v === '3d') { ensure3d(); if (v3) { v3.resize(); if (debug) v3.frame(debug.frame); } }
			if (save) { try { window.localStorage.setItem('glance-view', v); } catch (e) { } }
			sync();
		}
		$$('.glance-thumb', el).forEach(function (b, i, all) {
			var v = b.getAttribute('data-view');
			b.addEventListener('click', function () { clearTimeout(hoverTimer); setView(v, true); });
			b.addEventListener('focus', function () { setView(v, true); });
			b.addEventListener('mouseenter', function () {   // hover intent: a short pause, not a fly-over
				clearTimeout(hoverTimer);
				hoverTimer = setTimeout(function () { setView(v, true); }, 160);
			});
			b.addEventListener('mouseleave', function () { clearTimeout(hoverTimer); });
			b.addEventListener('keydown', function (e) {
				var j = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 :
					e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : -1;
				if (j < 0 && e.key !== 'ArrowLeft' && e.key !== 'ArrowUp') return;
				e.preventDefault();
				all[(j + all.length) % all.length].focus();
			});
		});

		// -- timeline marks ------------------------------------------------------------------------
		$$('.glance-mark', el).forEach(function (m) {
			var show = function () { cap.textContent = m.getAttribute('aria-label'); cap.classList.add('is-live'); };
			var hide = function () { cap.textContent = idle.timeline; cap.classList.remove('is-live'); };
			m.addEventListener('mouseenter', show); m.addEventListener('focus', show);
			m.addEventListener('mouseleave', hide); m.addEventListener('blur', hide);
		});

		bio.insertAdjacentElement('afterend', el);
		t0 = performance.now();
		drawLoop();
		var start = 'loop';
		try { start = window.localStorage.getItem('glance-view') || 'loop'; } catch (e) { }
		setView(debug ? debug.view : start, false);
		if (debug && debug.pick) pin(card(debug.pick) ? { card: debug.pick } : { stage: debug.pick });

		if (window.ResizeObserver) new ResizeObserver(function () { drawLoop(); if (v3) v3.resize(); }).observe(frame);
		else window.addEventListener('resize', function () { drawLoop(); if (v3) v3.resize(); });
		if (window.IntersectionObserver) {
			new IntersectionObserver(function (es) { onscreen = es[es.length - 1].isIntersecting; sync(); }).observe(frame);
		}
		document.addEventListener('visibilitychange', sync);
		if (mq) {
			var onMq = function () {
				reduced = mq.matches;
				if (v3) v3.setReduced(reduced);
				if (reduced) tick(1.25);
				sync();
			};
			if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
		}

		// If About was already revealed by main.js before we arrived, join the stagger.
		if (bio.classList.contains('rise')) {
			el.style.setProperty('--i', String(Array.prototype.indexOf.call(row.children, el)));
			el.classList.add('rise');
		}

		if (window.Palette && window.Palette.addActions) {
			window.Palette.addActions([{
				label: 'CV at a glance', keywords: 'summary research map loop human machine 3d gallery cards papers timeline years', hint: 'About',
				run: function () {
					if (window.location.hash !== '#/about') window.location.hash = '#/about';
					setTimeout(function () {
						el.scrollIntoView({ block: 'center' });
						el.focus({ preventScroll: true });
					}, 80);
				}
			}]);
		}
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
	else build();
})();
