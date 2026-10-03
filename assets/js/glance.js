/* CV at a glance — a quiet strip of four tiles and one thin year line, parsed at
 * runtime from the About, Publications, Teaching, Talks and Experience sections of
 * index.html (nothing is duplicated here). It is inserted right after the bio
 * paragraph so main.js's staggered reveal covers it like any other About item.
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

	function countries() {
		var pa = window.PassportAtlas, v = pa && (typeof pa.visited === 'function' ? pa.visited() : pa.visited);
		if (v && v.length) return v.length;
		if (pa && pa.countries && pa.countries.length) return pa.countries.length;
		var ns = txt($('#places-widget noscript'));
		return ns ? ns.replace(/\.$/, '').split(/,\s*|\s+and\s+/).filter(Boolean).length : null;
	}

	function japanese() {
		var li = $$('#aboutmeContent #languages ~ ul li').concat($$('#aboutmeContent li')).filter(function (l) {
			return /JLPT\s*N\d/.test(txt(l));
		})[0];
		if (!li) return null;
		var s = txt(li), lvl = s.match(/JLPT\s*(N\d)/), score = s.match(/(\d+\s*\/\s*\d+)/);
		return { value: lvl[1], note: score ? 'JLPT ' + score[1].replace(/\s/g, '') : 'JLPT' };
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
	function tile(label, value, note) {
		return value == null ? '' : '<div class="glance-tile"><span class="glance-k">' + label + '</span>' +
			'<span class="glance-v">' + esc(value) + '</span>' + (note ? '<span class="glance-n">' + esc(note) + '</span>' : '') + '</div>';
	}

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
		var ev = collect(), papers = ev.filter(function (e) { return e.kind === 'paper'; }),
			honors = ev.filter(function (e) { return e.kind === 'award'; }), n = countries(), jp = japanese();

		var el = document.createElement('div');
		el.className = 'glance';
		el.id = 'cv-glance';
		el.tabIndex = -1;
		el.setAttribute('role', 'group');
		el.setAttribute('aria-label', 'CV at a glance');
		el.innerHTML = '<div class="glance-tiles">' +
			tile('Papers', papers.length || null, range(papers)) +
			tile('Honors', honors.length || null, range(honors)) +
			tile('Countries', n, 'visited') +
			(jp ? tile('Japanese', jp.value, jp.note) : '') + '</div>' +
			'<div class="glance-line">' + svg(ev) + '</div>' +
			'<p class="glance-caption" aria-hidden="true"></p>';

		var cap = $('.glance-caption', el);
		var idle = ev.length + ' entries, ' + range(ev) + ' · hover or tab a mark for its label';
		cap.textContent = idle;
		$$('.glance-mark', el).forEach(function (m) {
			var show = function () { cap.textContent = m.getAttribute('aria-label'); cap.classList.add('is-live'); };
			var hide = function () { cap.textContent = idle; cap.classList.remove('is-live'); };
			m.addEventListener('mouseenter', show); m.addEventListener('focus', show);
			m.addEventListener('mouseleave', hide); m.addEventListener('blur', hide);
		});

		bio.insertAdjacentElement('afterend', el);
		// If About was already revealed by main.js before we arrived, join the stagger.
		if (bio.classList.contains('rise')) {
			el.style.setProperty('--i', String(Array.prototype.indexOf.call(row.children, el)));
			el.classList.add('rise');
		}

		if (window.Palette && window.Palette.addActions) {
			window.Palette.addActions([{
				label: 'CV at a glance', keywords: 'summary stats papers honors countries timeline years', hint: 'About',
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
