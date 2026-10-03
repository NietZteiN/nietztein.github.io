/* CV at a glance — a research map (topics as regions, works as points, in the
 * manner of a map of science) above one thin year line, both parsed at runtime
 * from the About, Publications, Teaching, Talks and Experience sections of
 * index.html (nothing is duplicated here). It is inserted right after the bio
 * paragraph so main.js's staggered reveal covers it like any other About item.
 *
 * A new paper, talk or research role lands on the map by itself when its title
 * (or, for roles, its description) matches a TOPICS regex below; anything that
 * matches nothing is drawn in the "Other" region instead of being dropped.
 *
 * Tags needed in index.html: <link rel="stylesheet" href="assets/css/glance.css">
 * after main.css, and <script src="assets/js/glance.js" defer> after palette.js. */
(function () {
	'use strict';

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

	// ---- parse the page ----------------------------------------------------
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

	// ---- research map: topics, works, layout -----------------------------------------
	// Order matters: a work's first match is its home region, its second (if any) is
	// where its linked twin dot goes. Papers and talks are matched on their title,
	// roles on their whole line.
	var TOPICS = [
		{ id: 'comp', label: ['Code obfuscation &', 'comprehension'], name: 'Code obfuscation and program comprehension',
			re: /obfuscat|program comprehension|code comprehension/i },
		{ id: 'cog', label: ['Human vs. model', 'cognition'], name: 'Human vs. model cognition',
			re: /\bhumans?\b[^.]*\b(machines?|models?|llms?)\b|\b(machines?|models?|llms?)\b[^.]*\bhumans?\b|dual-process|cognit|psycholinguist|human language processing/i },
		{ id: 'se', label: ['LLMs for software', 'engineering'], name: 'LLMs for software engineering',
			re: /software (engineering|development)|verifiab|program repair|code generation/i },
		{ id: 'unl', label: ['Machine', 'unlearning'], name: 'Machine unlearning',
			re: /unlearn|forgetting/i },
		{ id: 'attr', label: ['Training', 'attribution'], name: 'Training-data and objective attribution',
			re: /attribut|provenance|influence function/i },
		{ id: 'sci', label: ['Science mapping &', 'ML for science'], name: 'Science mapping and ML for science',
			re: /summariz|scientometric|patent|map of science|\bCSET\b|landscape|materials|scientific (research|text|discovery)/i },
		{ id: 'phil', label: ['Meaning &', 'representation'], name: 'Meaning and representation (semiotics of embeddings)',
			re: /semiotic|embedding|philosoph|\bmeaning\b/i },
		{ id: 'vision', label: ['Computer', 'vision'], name: 'Computer vision',
			re: /\bvision\b|\bimages?\b|shape analysis|cranial|feature (extraction|selection)/i },
		{ id: 'eval', label: ['Model behavior', '& evaluation'], name: 'Model behavior and evaluation',
			re: /evaluat|recurrence|frontier|\bbias\b|fairness|benchmark/i }
	];
	var OTHER = { id: 'other', label: ['Other'], name: 'Other' };
	// Desktop (>= 640px): one continuous map. Hand-tuned anchors in a 720x320 design
	// space, [x, y, label side, label x-shift]. Related topics touch or overlap:
	// obfuscation overlaps cognition (papers in both sit in the overlap), software
	// engineering and meaning sit beside them, behavior is central, unlearning is
	// next to attribution, science mapping and vision share the right-hand side.
	var ATLAS = {
		se: [72, 152, 'above'], comp: [170, 190, 'below'], cog: [200, 135, 'above', -22], phil: [292, 95, 'above'],
		eval: [400, 182, 'above'], unl: [540, 84, 'above'], attr: [618, 104, 'below'],
		sci: [530, 228, 'below'], vision: [640, 238, 'below'], other: [310, 280, 'right']
	};
	// Narrower: small multiples on a grid, neighbours kept side by side.
	var GRIDS = {
		mid: [['se', 'comp', 'cog'], ['sci', 'eval', 'phil'], ['unl', 'attr', 'vision'], [null, 'other', null]],
		narrow: [['comp', 'cog'], ['se', 'phil'], ['sci', 'eval'], ['unl', 'attr'], ['vision', 'other']]
	};
	var KIND = {
		paper: { word: 'Paper', many: 'papers', href: '#/publications' },
		talk: { word: 'Talk', many: 'talks', href: '#/presentations' },
		role: { word: 'Role', many: 'roles', href: '#/experience' }
	};
	var MAP_HEAD = '<div class="glance-maphead"><span class="glance-maptitle">Research map</span>' +
		'<span class="glance-key">' +
		'<span><svg width="12" height="12" aria-hidden="true"><circle class="glance-pt-paper" cx="6" cy="6" r="4.5"/></svg>paper</span>' +
		'<span><svg width="12" height="12" aria-hidden="true"><path class="glance-pt-talk" d="M6 0.5 11.5 6 6 11.5 0.5 6Z"/></svg>talk</span>' +
		'<span><svg width="12" height="12" aria-hidden="true"><circle class="glance-pt-role" cx="6" cy="6" r="3.6"/></svg>research role</span>' +
		'<span><svg width="24" height="12" aria-hidden="true"><path class="glance-link" d="M5 6H20"/><circle class="glance-pt-paper" cx="5" cy="6" r="3.5"/><circle class="glance-twin-dot" cx="20" cy="6" r="2.2"/></svg>spans two topics</span>' +
		'</span></div>';

	function works() {
		var out = [];
		function add(kind, title, where, hay, year) {
			if (!title) return;
			var ts = TOPICS.filter(function (t) { return t.re.test(hay); }).map(function (t) { return t.id; }).slice(0, 2);
			out.push({ kind: kind, topics: ts.length ? ts : [OTHER.id],
				label: KIND[kind].word + ' · ' + clip(title, 110) + (where ? ' — ' + clip(where, 70) : '') + (year ? ' (' + year + ')' : '') });
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
		// Research roles always; industry roles only when they match a topic.
		$$('#experienceContent h3').forEach(function (h) {
			var research = /research/i.test(txt(h)), ul = h.nextElementSibling;
			if (!ul || !(research || /industry/i.test(txt(h)))) return;
			$$('li', ul).forEach(function (li) {
				var s = txt(li), cut = s.search(/\s[—–]\s/), known = TOPICS.some(function (t) { return t.re.test(s); });
				if (research || known) add('role', cut > 0 ? s.slice(0, cut) : s, cut > 0 ? s.slice(cut + 3).replace(/\.$/, '') : '', s);
			});
		});
		return out;
	}

	function seed(str) {   // string -> seeded mulberry32, so a region keeps its shape whatever else changes
		var h = 2166136261;
		for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
		return function () {
			h = (h + 0x6D2B79F5) | 0;
			var t = Math.imul(h ^ (h >>> 15), 1 | h);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}
	function f1(n) { return Math.round(n * 10) / 10; }

	function summary(t, items) {
		var mine = items.filter(function (w) { return w.topics.indexOf(t.id) >= 0; });
		var bits = ['paper', 'talk', 'role'].map(function (k) {
			var n = mine.filter(function (w) { return w.kind === k; }).length;
			return n ? n + ' ' + (n === 1 ? k : KIND[k].many) : '';
		}).filter(Boolean);
		return { n: mine.length, text: t.name + ' · ' + (bits.join(', ') || 'nothing yet') };
	}

	function mapSvg(items, W) {
		var mode = W >= 640 ? 'wide' : W >= 420 ? 'mid' : 'narrow', wide = mode === 'wide', grid = GRIDS[mode];
		var R = mode === 'mid' ? 34 : 30, RY = R * 0.92, LAB = 30, rowH = LAB + 2 * RY + 12;
		var S = Math.min(1.1, W / 720), OX = (W - 720 * S) / 2, H = wide ? Math.round(320 * S) : Math.round(grid.length * rowH);
		var all = TOPICS.concat([OTHER]), pos = {}, out = { blobs: [], dots: [], labels: [], links: [], pts: [] };
		var hasOther = items.some(function (w) { return w.topics[0] === OTHER.id; });
		function count(id) { return items.filter(function (w) { return w.topics.indexOf(id) >= 0; }).length; }
		function sunflower(p, n, step, kx, ky) {
			for (var i = 0; i < n; i++) {
				var rad = n === 1 ? 0 : step * Math.sqrt(i + 0.35), a = p.rot + i * 2.39996;
				p.slots.push({ x: p.hx + Math.cos(a) * rad * kx, y: p.hy + Math.sin(a) * rad * ky });
			}
		}
		items.forEach(function (w) { w.at = w.twin = null; });

		// 1. anchors and one slot per work
		if (wide) {
			// One continuous map: hand-placed anchors, each region's area in proportion
			// to the number of works in it.
			all.forEach(function (t) {
				var a = ATLAS[t.id], n = count(t.id);
				if (!a || (t.id === OTHER.id && !hasOther)) return;
				var rnd = seed(t.id), r = (t.id === OTHER.id ? 20 : Math.min(56, 24 * Math.sqrt(Math.max(n, 1)))) * S;
				pos[t.id] = { id: t.id, x: OX + a[0] * S, y: a[1] * S, r: r, side: a[2], shift: (a[3] || 0) * S, rnd: rnd, slots: [], rot: rnd() * 6.283, away: [0, 0], shared: 0 };
			});
			// Works spanning two overlapping regions sit in the overlap itself: no link needed.
			var lens = {};
			items.forEach(function (w) {
				var p = pos[w.topics[0]], o = w.topics[1] && pos[w.topics[1]];
				if (!p || !o) return;
				var d = Math.sqrt((o.x - p.x) * (o.x - p.x) + (o.y - p.y) * (o.y - p.y));
				if (d > p.r + o.r - 12 * S) return;
				var key = p.id + ' ' + o.id;
				(lens[key] = lens[key] || { p: p, o: o, d: d, list: [] }).list.push(w);
			});
			Object.keys(lens).forEach(function (key) {
				var l = lens[key], ux = (l.o.x - l.p.x) / l.d, uy = (l.o.y - l.p.y) / l.d, m = (l.p.r + l.d - l.o.r) / 2;
				l.list.forEach(function (w, j) {
					var off = (j - (l.list.length - 1) / 2) * 15 * S;
					w.at = { x: l.p.x + ux * m - uy * off, y: l.p.y + uy * m + ux * off, used: true };
					l.p.slots.push(w.at);
				});
				l.p.shared += l.list.length; l.o.shared += l.list.length;
				l.p.away = [-ux, -uy]; l.o.away = [ux, uy];
			});
			all.forEach(function (t) {   // the rest cluster on the side away from any overlap
				var p = pos[t.id];
				if (!p) return;
				p.hx = p.x + p.away[0] * p.r * 0.42; p.hy = p.y + p.away[1] * p.r * 0.42;
				sunflower(p, count(t.id) - p.shared, 11.5 * S, 1, 1);
			});
		} else {
			grid.forEach(function (row, r) {
				row.forEach(function (id, c) {
					if (!id || (id === OTHER.id && !hasOther)) return;
					var rnd = seed(id), cw = W / row.length, cy = r * rowH + LAB + RY + 4;
					var p = { id: id, x: (c + 0.5) * cw + (rnd() - 0.5) * cw * 0.14, y: cy + (rnd() - 0.5) * 12,
						rnd: rnd, slots: [], rot: rnd() * 6.283, tilt: (rnd() - 0.5) * 36 };
					p.hx = p.x; p.hy = p.y;
					sunflower(p, count(id), R / 3.3, 1.12, 0.92);
					pos[id] = p;
				});
			});
		}
		function take(p, to) {   // nearest free slot to a point, or simply the innermost free one
			var best = null, bd = Infinity;
			p.slots.forEach(function (q, i) {
				var d = to ? (q.x - to.x) * (q.x - to.x) + (q.y - to.y) * (q.y - to.y) : i;
				if (!q.used && d < bd) { bd = d; best = q; }
			});
			if (best) best.used = true;
			return best;
		}
		// Works that span two separate regions sit on the side facing the other one,
		// so a link never appears to start from a neighbour.
		items.forEach(function (w) {
			var p = pos[w.topics[0]], o = w.topics[1] && pos[w.topics[1]];
			w.linked = !w.at && !!(p && o);
			if (w.linked) w.at = take(p, o);
		});
		items.forEach(function (w) {
			var p = pos[w.topics[0]], o = w.topics[1] && pos[w.topics[1]];
			if (p && !w.at) w.at = take(p);
			if (w.linked && w.at) w.twin = take(o, w.at);
		});

		// 2. the quiet field: sparse dots everywhere, denser clouds around each anchor
		var rf = seed('field'), nf = Math.round(W * H / (wide ? 1500 : 3000)), i;
		for (i = 0; i < nf; i++) out.dots.push('<circle class="glance-field" cx="' + f1(4 + rf() * (W - 8)) + '" cy="' + f1(4 + rf() * (H - 8)) + '" r="0.9"/>');
		if (wide) out.blobs.push('<defs><filter id="glance-soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="' + f1(4 * S) + '"/></filter></defs>');
		all.forEach(function (t) {
			var p = pos[t.id];
			if (!p) return;
			var s = summary(t, items), rnd = p.rnd, plain = t.id === OTHER.id || !s.n, k, made;
			var rx = wide ? p.r : R * 1.22, ry = wide ? p.r : RY, want = wide ? Math.round(12 + 13 * s.n) : 46;
			if (wide && !plain) {   // an irregular landmass: a seeded union of soft circles
				var land = '<circle cx="' + f1(p.x) + '" cy="' + f1(p.y) + '" r="' + f1(p.r) + '"/>';
				for (k = 0; k < 3; k++) {
					var la = p.rot + k * 2.094 + (rnd() - 0.5) * 0.9, lr = p.r * (0.48 + rnd() * 0.16);
					land += '<circle cx="' + f1(p.x + Math.cos(la) * p.r * 0.6) + '" cy="' + f1(p.y + Math.sin(la) * p.r * 0.6) + '" r="' + f1(lr) + '"/>';
				}
				out.blobs.push('<g class="glance-land" filter="url(#glance-soft)">' + land + '</g>');
			} else if (wide) {
				out.blobs.push('<circle class="glance-blob is-plain" cx="' + f1(p.x) + '" cy="' + f1(p.y) + '" r="' + f1(p.r) + '"/>');
			} else {
				out.blobs.push('<ellipse class="glance-blob' + (plain ? ' is-plain' : '') + '" cx="' + f1(p.x) + '" cy="' + f1(p.y) +
					'" rx="' + f1(rx) + '" ry="' + f1(ry) + '" transform="rotate(' + f1(p.tilt) + ' ' + f1(p.x) + ' ' + f1(p.y) + ')"/>');
			}
			for (k = 0, made = 0; k < 400 && made < want; k++) {
				var u = Math.sqrt(-2 * Math.log(1 - rnd() * 0.999)), v = rnd() * 6.283;
				var dx = u * Math.cos(v) * rx * (wide ? 0.52 : 0.46), dy = u * Math.sin(v) * ry * (wide ? 0.52 : 0.48);
				if (dx * dx / (rx * rx * 1.44) + dy * dy / (ry * ry * 1.5) > 1) continue;
				var x = p.x + dx, y = p.y + dy;
				if (x < 3 || x > W - 3 || y < 3 || y > H - 3 || items.some(function (w) {
					return (w.at && Math.abs(w.at.x - x) < 8 && Math.abs(w.at.y - y) < 8) || (w.twin && Math.abs(w.twin.x - x) < 6 && Math.abs(w.twin.y - y) < 6);
				})) continue;
				out.dots.push('<circle class="glance-dot" cx="' + f1(x) + '" cy="' + f1(y) + '" r="' + f1(1 + rnd() * 0.7) + '"/>');
				made++;
			}
			var n = t.label.length, lx = p.x, y0 = p.y - RY - 8 - (n - 1) * 11.5, anchor = 'middle';
			if (wide) {
				lx = p.x + p.shift;
				if (p.side === 'below') y0 = p.y + p.r + 18;
				else if (p.side === 'above') y0 = p.y - p.r - 12 - (n - 1) * 11.5;
				else { y0 = p.y + 3.5 - (n - 1) * 5.75; anchor = p.side === 'right' ? 'start' : 'end'; lx = p.x + (p.side === 'right' ? 1 : -1) * (p.r + 9) + p.shift; }
			}
			out.labels.push('<text class="glance-region" data-r="' + t.id + '" tabindex="0" role="img" aria-label="' + esc(s.text) + '" x="' + f1(lx) + '" y="' + f1(y0) + '" text-anchor="' + anchor + '">' +
				'<title>' + esc(s.text) + '</title>' +
				t.label.map(function (line, j) {
					return '<tspan x="' + f1(lx) + '"' + (j ? ' dy="11.5"' : '') + '>' + esc(line) +
						(j === n - 1 ? '<tspan class="glance-count"> · ' + s.n + '</tspan>' : '') + '</tspan>';
				}).join('') + '</text>');
		});

		// 3. works: one focusable point each, plus a linked twin dot in a second topic
		items.forEach(function (w, idx) {
			if (!w.at) return;
			var x = f1(w.at.x), y = f1(w.at.y), ds = ' data-w="' + idx + '" data-ts="' + w.topics.join(' ') + '"';
			if (w.twin) {
				var tx = w.twin.x, ty = w.twin.y, mx = (w.at.x + tx) / 2, my = (w.at.y + ty) / 2;
				out.links.push('<path class="glance-link"' + ds + ' d="M' + x + ' ' + y + 'Q' + f1(mx - (ty - w.at.y) * 0.12) + ' ' + f1(my + (tx - w.at.x) * 0.12) + ' ' + f1(tx) + ' ' + f1(ty) + '"/>');
				out.pts.push('<g class="glance-twin"' + ds + ' aria-hidden="true"><circle class="glance-hit" cx="' + f1(tx) + '" cy="' + f1(ty) + '" r="7"/>' +
					'<circle class="glance-twin-dot" cx="' + f1(tx) + '" cy="' + f1(ty) + '" r="2.8"/></g>');
			}
			var shape = w.kind === 'talk' ? '<path class="glance-shape" d="M' + x + ' ' + f1(w.at.y - 5.5) + 'L' + f1(w.at.x + 5.5) + ' ' + y + 'L' + x + ' ' + f1(w.at.y + 5.5) + 'L' + f1(w.at.x - 5.5) + ' ' + y + 'Z"/>'
				: '<circle class="glance-shape" cx="' + x + '" cy="' + y + '" r="' + (w.kind === 'paper' ? 4.8 : 3.6) + '"/>';
			out.pts.push('<g class="glance-pt glance-pt-' + w.kind + '"' + ds + ' tabindex="0" role="link" aria-label="' + esc(w.label) +
				'" style="--d:' + (160 + idx * 28) + '"><title>' + esc(w.label) + '</title>' +
				'<circle class="glance-hit" cx="' + x + '" cy="' + y + '" r="9"/>' + shape + '</g>');
		});

		var nt = all.filter(function (t) { return pos[t.id] && t.id !== OTHER.id && summary(t, items).n; }).length;
		return { topics: nt, html: '<svg class="glance-mapsvg" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="group" aria-label="Research map: ' +
			items.length + ' works across ' + nt + ' topics">' + out.blobs.join('') + out.dots.join('') + out.links.join('') +
			out.labels.join('') + out.pts.join('') + '</svg>' };
	}

	// Draw into the wrap, keep it in step with its width, and wire hover/focus/click once.
	function mount(wrap, cap, items) {
		var drawn = 0, idle = '', all = TOPICS.concat([OTHER]);
		function draw() {
			var w = Math.round(wrap.clientWidth) || (drawn ? 0 : 700);
			if (!w || Math.abs(w - drawn) < 6) return;
			if (drawn) wrap.classList.add('is-settled');   // no second entrance on resize
			drawn = w;
			var m = mapSvg(items, w);
			wrap.innerHTML = m.html;
			idle = items.length + ' works across ' + m.topics + ' topics · hover or tab a point or a region label';
			cap.textContent = idle;
		}
		function clear() {
			$$('.is-on', wrap).forEach(function (n) { n.classList.remove('is-on'); });
			wrap.classList.remove('is-dim');
			cap.textContent = idle; cap.classList.remove('is-live');
		}
		function hit(e) { return e.target && e.target.closest ? e.target.closest('[data-w],[data-r]') : null; }
		function show(n) {
			clear();
			if (!n) return;
			var on, w = n.getAttribute('data-w'), r = n.getAttribute('data-r');
			if (w != null) {
				on = $$('[data-w="' + w + '"]', wrap);
				items[w].topics.forEach(function (t) { on = on.concat($$('[data-r="' + t + '"]', wrap)); });
				cap.textContent = items[w].label;
			} else {
				on = $$('[data-ts~="' + r + '"]', wrap).concat([n]);
				cap.textContent = summary(all.filter(function (t) { return t.id === r; })[0], items).text;
			}
			on.forEach(function (x) { x.classList.add('is-on'); });
			wrap.classList.add('is-dim');
			cap.classList.add('is-live');
		}
		function go(n) {
			var w = n && n.getAttribute('data-w');
			if (w != null) window.location.hash = KIND[items[w].kind].href;
		}
		wrap.addEventListener('mouseover', function (e) { show(hit(e)); });
		wrap.addEventListener('mouseleave', clear);
		wrap.addEventListener('focusin', function (e) { show(hit(e)); });
		wrap.addEventListener('focusout', clear);
		wrap.addEventListener('click', function (e) { go(hit(e)); });
		wrap.addEventListener('keydown', function (e) {
			if (e.key === 'Enter' || e.key === ' ') { var n = hit(e); if (n && n.hasAttribute('data-w')) { e.preventDefault(); go(n); } }
		});
		draw();
		if (window.ResizeObserver) new ResizeObserver(draw).observe(wrap);
		else window.addEventListener('resize', draw);
	}

	// ---- layout -----------------------------------------------------------------
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

	// ---- build ------------------------------------------------------------------
	function range(list) {
		if (!list.length) return '';
		var ys = list.map(function (e) { return e.y; });
		var a = Math.min.apply(null, ys), b = Math.max.apply(null, ys);
		return a === b ? String(a) : a + '–' + b;
	}

	function build() {
		if ($('#cv-glance')) return;
		var row = $('#aboutmeContent .container > .row'), bio = row && $('p.justify', row);
		if (!bio) return;
		var ev = collect(), items = works();

		var el = document.createElement('div');
		el.className = 'glance';
		el.id = 'cv-glance';
		el.tabIndex = -1;
		el.setAttribute('role', 'group');
		el.setAttribute('aria-label', 'CV at a glance');
		el.innerHTML = (items.length ? MAP_HEAD + '<div class="glance-map"></div>' +
			'<p class="glance-caption glance-mapcap" aria-hidden="true"></p>' : '') +
			'<div class="glance-line">' + svg(ev) + '</div>' +
			'<p class="glance-caption glance-linecap" aria-hidden="true"></p>';

		var cap = $('.glance-linecap', el);
		var idle = ev.length + ' entries, ' + range(ev) + ' · hover or tab a mark for its label';
		cap.textContent = idle;
		$$('.glance-mark', el).forEach(function (m) {
			var show = function () { cap.textContent = m.getAttribute('aria-label'); cap.classList.add('is-live'); };
			var hide = function () { cap.textContent = idle; cap.classList.remove('is-live'); };
			m.addEventListener('mouseenter', show); m.addEventListener('focus', show);
			m.addEventListener('mouseleave', hide); m.addEventListener('blur', hide);
		});

		bio.insertAdjacentElement('afterend', el);
		if (items.length) mount($('.glance-map', el), $('.glance-mapcap', el), items);
		// If About was already revealed by main.js before we arrived, join the stagger.
		if (bio.classList.contains('rise')) {
			el.style.setProperty('--i', String(Array.prototype.indexOf.call(row.children, el)));
			el.classList.add('rise');
		}

		if (window.Palette && window.Palette.addActions) {
			window.Palette.addActions([{
				label: 'CV at a glance', keywords: 'summary research map topics science papers timeline years', hint: 'About',
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
