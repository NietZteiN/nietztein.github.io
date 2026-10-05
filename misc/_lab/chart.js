/*
 * LabChart: the small SVG charts of the lab kit (misc/_lab), drawn in the
 * kit's tokens so that every experiment's results look like one lab.
 *
 *     LabChart.bars(data, opts)        bars with interval whiskers
 *     LabChart.scatter(points, opts)   points, a least-squares line, a rho label
 *     LabChart.line(series, opts)      a learning or forgetting curve, with fitted curves
 *     LabChart.dots(groups, opts)      every trial as a dot, by condition, with the medians
 *     LabChart.histogram(values, opts) a distribution, with marked values
 *     LabChart.figure(chart, { caption, note, table })   the chart in a <figure> with its data table
 *     LabChart.mount(container, function (width) { return chart; })   redraw at the container's width
 *
 * Each chart function takes plain data and returns an <svg> element that is
 * drawn at its real size (340 by 220 unless opts.width and opts.height say
 * otherwise), shrinks to fit a narrower column and never grows, so its text is
 * readable at 360 px. The element carries role="img" and an aria-label that
 * says what the chart shows in words (also as chart.labSummary), the same
 * numbers as a table (chart.labTable, which figure() renders under the
 * chart), and a tooltip on every mark for pointer and touch.
 *
 * The colours come from lab.css (--lab-c1 to --lab-c3, the text and border
 * tokens), so a chart follows the theme without being redrawn. scatter's line
 * and rho need stats.js (LabStats) to be loaded first.
 *
 * UMD: window.LabChart in a page; under Node, module.exports.build has the
 * same five functions returning { markup, summary, table, width, height }, so
 * test.js can check the drawing without a browser.
 *
 * This file is plain ASCII: the few special characters are built from their codes.
 */
(function () {
	'use strict';

	var C = String.fromCharCode;
	var RHO = C(0x3C1), MINUS = C(0x2212), DASH = C(0x2014), ELLIPSIS = C(0x2026);
	var CHAR = 6.1;            // the mean width of a character of 11px text, for laying labels out
	var SERIES = 3;            // how many series colours there are (--lab-c1 .. --lab-c3)

	var warnedNoStats = false;
	function stats() {
		if (typeof window !== 'undefined' && window.LabStats) return window.LabStats;
		if (typeof module === 'object' && module && typeof require === 'function') {
			try { return require('./stats.js'); } catch (e) { return null; }
		}
		// A page that forgot stats.js gets its charts without the fitted line and
		// rho, and is told why once.
		if (!warnedNoStats && typeof console !== 'undefined' && console.warn) {
			warnedNoStats = true;
			console.warn('LabChart: stats.js (LabStats) is not loaded, so scatter() draws no fitted line and no rho.');
		}
		return null;
	}

	// ---- Small helpers ----------------------------------------------------------

	function isNum(x) { return typeof x === 'number' && isFinite(x); }
	function esc(s) {
		return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}
	function r1(v) { return Math.round(v * 10) / 10; }
	function clean(v) { return Math.round(v * 1e9) / 1e9; }
	function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

	// A number for a label: as many decimals as its size needs (or opts.digits),
	// a real minus sign, a dash for "no number".
	function fmt(v, digits) {
		if (!isNum(v)) return DASH;
		var a = Math.abs(v);
		var d = isNum(digits) ? digits : a >= 100 ? 0 : a >= 10 ? 1 : 2;
		var s = a.toFixed(d);
		if (!isNum(digits) && s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
		if (a >= 10000) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
		return (v < 0 && Number(s.replace(/,/g, '')) !== 0 ? MINUS : '') + s;
	}
	// The unit after a number: '%' touches it, anything else follows a space.
	function withUnit(text, unit) {
		if (!unit || text === DASH) return text;
		return unit === '%' ? text + '%' : text + ' ' + unit;
	}

	// A scale with round ticks (steps of 1, 2 or 5 times a power of ten).
	function niceScale(lo, hi, target) {
		if (!isNum(lo) || !isNum(hi)) { lo = 0; hi = 1; }
		if (hi < lo) { var t = lo; lo = hi; hi = t; }
		if (hi === lo) { var pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 0.5; lo -= pad; hi += pad; }
		var raw = (hi - lo) / Math.max(1, target || 4);
		var pow = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10 + 1e-12)), m = raw / pow;
		var step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow;
		var min = Math.floor(lo / step + 1e-9) * step, max = Math.ceil(hi / step - 1e-9) * step;
		var ticks = [], n = Math.round((max - min) / step);
		for (var i = 0; i <= n; i++) ticks.push(clean(min + i * step));
		return { min: clean(min), max: clean(max), step: step, ticks: ticks, digits: clamp(Math.ceil(-Math.log(step) / Math.LN10 - 1e-9), 0, 6) };
	}
	// Bins with round edges: the round width (1, 2 or 5 times a power of ten)
	// nearest to the width that would give `count` bins. niceScale always rounds
	// the step up, which can halve the number of bins; this rounds to the nearest.
	function binScale(lo, hi, count) {
		if (!isNum(lo) || !isNum(hi)) { lo = 0; hi = 1; }
		if (hi === lo) { var pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 0.5; lo -= pad; hi += pad; }
		var raw = (hi - lo) / Math.max(1, count);
		var pow = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10 + 1e-12));
		var step = pow, best = Infinity;
		[1, 2, 5, 10].forEach(function (m) {
			var d = Math.abs(Math.log(m * pow / raw));
			if (d < best) { best = d; step = m * pow; }
		});
		var min = Math.floor(lo / step + 1e-9) * step, max = Math.ceil(hi / step - 1e-9) * step;
		if (max <= min) max = min + step;
		var ticks = [], n = Math.round((max - min) / step);
		for (var i = 0; i <= n; i++) ticks.push(clean(min + i * step));
		return { min: clean(min), max: clean(max), step: step, ticks: ticks, digits: clamp(Math.ceil(-Math.log(step) / Math.LN10 - 1e-9), 0, 6) };
	}
	function tickText(v, scale) {
		var s = Math.abs(v).toFixed(scale.digits);
		if (Math.abs(v) >= 10000) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
		return (v < 0 && Number(s.replace(/,/g, '')) !== 0 ? MINUS : '') + s;
	}

	// The average width of a character of `label` at the 11 px of the axis
	// text, estimated from its letters (i and l are narrow, m and w wide); never
	// under 5 px, so an estimate errs toward cutting rather than overlapping.
	function textWidth(s) {
		s = String(s == null ? '' : s);
		var w = 0;
		for (var i = 0; i < s.length; i++) {
			var c = s.charAt(i);
			w += /[ilj.,'!|:;]/.test(c) ? 2.8 : /[ftrI ()\-]/.test(c) ? 3.8 : /[mwMW]/.test(c) ? 8.8 : /[A-Z]/.test(c) ? 7.2 : /[0-9]/.test(c) ? 6.2 : 6;
		}
		return w;
	}
	// wrapWidth(label, px, most): wrap() by estimated width instead of a count
	// of characters: lines of at most `px`, at most `most` of them (two unless
	// given); a word wider than a line is cut with an ellipsis.
	function wrapWidth(label, px, most) {
		label = String(label == null ? '' : label);
		most = most > 0 ? most : 2;
		var words = label.split(/\s+/), lines = [''];
		for (var i = 0; i < words.length; i++) {
			var cur = lines[lines.length - 1];
			if (!cur) lines[lines.length - 1] = words[i];
			else if (textWidth(cur + ' ' + words[i]) <= px) lines[lines.length - 1] = cur + ' ' + words[i];
			else lines.push(words[i]);
		}
		if (lines.length > most) lines = lines.slice(0, most - 1).concat([lines.slice(most - 1).join(' ')]);
		return lines.map(function (l) {
			if (textWidth(l) <= px) return l;
			while (l.length > 1 && textWidth(l + ELLIPSIS) > px) l = l.slice(0, -1);
			return l + ELLIPSIS;
		});
	}

	// Breaks a label into at most `most` lines (two unless given) of about `max`
	// characters; what still does not fit ends in an ellipsis.
	function wrap(label, max, most) {
		label = String(label == null ? '' : label);
		max = Math.max(3, Math.floor(max));
		most = most > 0 ? most : 2;
		if (label.length <= max) return [label];
		var words = label.split(/\s+/), lines = [''];
		for (var i = 0; i < words.length; i++) {
			var cur = lines[lines.length - 1];
			if (!cur) lines[lines.length - 1] = words[i];
			else if ((cur + ' ' + words[i]).length <= max) lines[lines.length - 1] = cur + ' ' + words[i];
			else lines.push(words[i]);
		}
		if (lines.length > most) lines = lines.slice(0, most - 1).concat([lines.slice(most - 1).join(' ')]);
		return lines.map(function (l) { return l.length > max ? l.slice(0, Math.max(1, max - 1)) + ELLIPSIS : l; });
	}

	// ---- The frame every chart shares ---------------------------------------------

	function frame(opts, kind, margins) {
		var W = isNum(opts.width) && opts.width >= 200 ? Math.round(opts.width) : 340;
		var H = isNum(opts.height) && opts.height >= 120 ? Math.round(opts.height) : 220;
		var f = { W: W, H: H, kind: kind, x0: margins.left, x1: W - margins.right, y0: margins.top, y1: H - margins.bottom };
		f.w = Math.max(10, f.x1 - f.x0);
		f.h = Math.max(10, f.y1 - f.y0);
		return f;
	}
	function scaleX(f, s) { return function (v) { return f.x0 + (v - s.min) / (s.max - s.min) * f.w; }; }
	function scaleY(f, s) { return function (v) { return f.y1 - (v - s.min) / (s.max - s.min) * f.h; }; }

	function leftMargin(scale) {
		var longest = 1;
		scale.ticks.forEach(function (t) { longest = Math.max(longest, tickText(t, scale).length); });
		return Math.max(24, Math.round(longest * CHAR + 12));
	}

	function open(f, summary) {
		return '<svg class="lab-chart lab-chart-' + f.kind + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + f.W + ' ' + f.H +
			'" width="' + f.W + '" height="' + f.H + '" role="img" focusable="false" aria-label="' + esc(summary) + '">';
	}
	function yGrid(f, scale, py, opts) {
		var out = '';
		scale.ticks.forEach(function (t) {
			var y = r1(py(t));
			out += '<line class="lc-grid" x1="' + f.x0 + '" x2="' + f.x1 + '" y1="' + y + '" y2="' + y + '"/>' +
				'<text class="lc-tick" x="' + (f.x0 - 6) + '" y="' + r1(y + 3.8) + '" text-anchor="end">' + esc(tickText(t, scale)) + '</text>';
		});
		if (opts.yLabel) out += '<text class="lc-label" x="0" y="11">' + esc(opts.yLabel) + '</text>';
		return out;
	}
	function xTicks(f, scale, px, opts) {
		var out = '<line class="lc-axis" x1="' + f.x0 + '" x2="' + f.x1 + '" y1="' + f.y1 + '" y2="' + f.y1 + '"/>';
		var list = opts.xTicks && opts.xTicks.length ? opts.xTicks : scale.ticks.map(function (t) { return { x: t, label: tickText(t, scale) }; });
		var last = -Infinity;
		list.forEach(function (t) {
			var x = px(t.x), label = String(t.label == null ? t.x : t.label);
			if (!isNum(x) || x < f.x0 - 0.5 || x > f.x1 + 0.5) return;
			var half = label.length * CHAR / 2;
			if (x - half < last + 6) return;                      // would touch the label before it
			last = x + half;
			out += '<line class="lc-axis" x1="' + r1(x) + '" x2="' + r1(x) + '" y1="' + f.y1 + '" y2="' + (f.y1 + 4) + '"/>' +
				'<text class="lc-tick" x="' + r1(x) + '" y="' + (f.y1 + 16) + '" text-anchor="middle">' + esc(label) + '</text>';
		});
		if (opts.xLabel) out += '<text class="lc-label" x="' + r1((f.x0 + f.x1) / 2) + '" y="' + (f.H - 4) + '" text-anchor="middle">' + esc(opts.xLabel) + '</text>';
		return out;
	}
	// A chart with nothing in it says so, at a third of the height (an empty
	// plot of full size would only be a hole in the sheet).
	function empty(f, opts) {
		var summary = (opts.title ? opts.title + '. ' : '') + 'Nothing to plot.';
		var H = Math.max(60, Math.round(f.H / 3));
		return {
			markup: '<svg class="lab-chart lab-chart-' + f.kind + ' is-empty" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + f.W + ' ' + H + '" width="' + f.W + '" height="' + H +
				'" role="img" focusable="false" aria-label="' + esc(summary) + '"><text class="lc-label" x="' + f.W / 2 + '" y="' + (H / 2 + 4) + '" text-anchor="middle">Nothing to plot</text></svg>',
			summary: summary, table: { head: [], rows: [] }, width: f.W, height: H
		};
	}
	function lead(opts, fallback) { return (opts.title || fallback) + '. '; }
	function seriesClass(i) { return 'lc-s' + (Math.min(i, SERIES - 1) + 1); }

	// A row of keys above the plot, wrapping at the chart's width W and starting
	// at x = left; y is the middle of the first row.
	// items: [{ name, cls, kind: 'dot' | 'line' | 'thin' | 'dash' }]
	function legend(W, left, items, y) {
		var out = '', x = left, row = 0;
		items.forEach(function (it) {
			var w = 22 + String(it.name).length * CHAR + 12;
			if (x + w > W && x > left) { x = left; row++; }
			var cy = y + row * 15;
			if (it.kind === 'dot') out += '<circle class="lc-key lc-fill ' + it.cls + '" cx="' + (x + 6) + '" cy="' + cy + '" r="4"/>';
			else out += '<line class="lc-key ' + (it.kind === 'dash' ? 'lc-curve lc-k2' : it.kind === 'thin' ? 'lc-curve lc-k1' : 'lc-line ' + it.cls) + '" x1="' + x + '" x2="' + (x + 14) + '" y1="' + cy + '" y2="' + cy + '"/>';
			out += '<text class="lc-legend" x="' + (x + 19) + '" y="' + (cy + 3.8) + '">' + esc(it.name) + '</text>';
			x += w;
		});
		return { markup: out, rows: items.length ? row + 1 : 0 };
	}

	// ---- bars ---------------------------------------------------------------------
	// data: [{ label, value, lo, hi, n }]. One bar per row, from zero, in one
	// colour (the rows are conditions of one measure, not separate series); a
	// whisker from lo to hi where both are given; the value on the cap.
	// opts: title, yLabel, unit, digits, yMin, yMax, groupLabel, valueLabel, width, height
	function bars(data, opts) {
		opts = opts || {};
		var rows = (data || []).filter(function (d) { return d && isNum(d.value); });
		var lo = 0, hi = 0;
		rows.forEach(function (d) {
			lo = Math.min(lo, d.value, isNum(d.lo) ? d.lo : d.value);
			hi = Math.max(hi, d.value, isNum(d.hi) ? d.hi : d.value);
		});
		if (isNum(opts.yMin)) lo = Math.min(opts.yMin, 0);
		if (isNum(opts.yMax)) hi = opts.yMax;
		var scale = niceScale(lo, hi, 4);
		if (isNum(opts.yMax)) scale.max = Math.max(scale.max, opts.yMax);
		var k = Math.max(1, rows.length);
		var W = isNum(opts.width) && opts.width >= 200 ? opts.width : 340;
		var left = leftMargin(scale);
		var band = (W - left - 8) / k;
		// category labels are mostly lower case, which runs narrower than digits:
		// they are wrapped by the estimated width of their letters
		var labels = rows.map(function (d) { return wrapWidth(d.label, band - 4, 3); });
		var labelLines = Math.max.apply(null, labels.map(function (l) { return l.length; }).concat([1]));
		var f = frame(opts, 'bars', { left: left, right: 8, top: (opts.yLabel ? 18 : 6) + 18, bottom: 10 + 12 * labelLines });
		if (!rows.length) return empty(f, opts);
		var py = scaleY(f, scale), zero = py(Math.max(scale.min, Math.min(scale.max, 0)));
		var bw = Math.min(24, band * 0.56), digits = opts.digits;
		var out = '', parts = [], table = [];
		var hasInterval = rows.some(function (d) { return isNum(d.lo) && isNum(d.hi); });
		var hasN = rows.some(function (d) { return isNum(d.n); });

		rows.forEach(function (d, i) {
			var cx = f.x0 + band * (i + 0.5), x = cx - bw / 2;
			var yv = py(clamp(d.value, scale.min, scale.max));
			var top = Math.min(yv, zero), bottom = Math.max(yv, zero), hgt = bottom - top;
			var rad = Math.min(4, bw / 2, hgt), path;
			if (d.value >= 0) {
				path = 'M' + r1(x) + ' ' + r1(bottom) + 'V' + r1(top + rad) + 'Q' + r1(x) + ' ' + r1(top) + ' ' + r1(x + rad) + ' ' + r1(top) +
					'H' + r1(x + bw - rad) + 'Q' + r1(x + bw) + ' ' + r1(top) + ' ' + r1(x + bw) + ' ' + r1(top + rad) + 'V' + r1(bottom) + 'Z';
			} else {
				path = 'M' + r1(x) + ' ' + r1(top) + 'V' + r1(bottom - rad) + 'Q' + r1(x) + ' ' + r1(bottom) + ' ' + r1(x + rad) + ' ' + r1(bottom) +
					'H' + r1(x + bw - rad) + 'Q' + r1(x + bw) + ' ' + r1(bottom) + ' ' + r1(x + bw) + ' ' + r1(bottom - rad) + 'V' + r1(top) + 'Z';
			}
			var interval = isNum(d.lo) && isNum(d.hi);
			var said = withUnit(fmt(d.value, digits), opts.unit) + (interval ? ' (' + fmt(d.lo, digits) + ' to ' + fmt(d.hi, digits) + ')' : '');
			var tip = d.label + ': ' + said + (isNum(d.n) ? ', n = ' + d.n : '');
			var mark = '<path class="lc-bar lc-fill lc-s1" d="' + path + '"/>';
			// The value is written above the bar and its whisker, whichever way the
			// bar points: under a bar it would land on the labels of the axis.
			var capY = top;
			if (interval) {
				var yHi = py(clamp(d.hi, scale.min, scale.max)), yLo = py(clamp(d.lo, scale.min, scale.max));
				mark += '<path class="lc-whisker" d="M' + r1(cx) + ' ' + r1(yHi) + 'V' + r1(yLo) + 'M' + r1(cx - 4) + ' ' + r1(yHi) + 'H' + r1(cx + 4) +
					'M' + r1(cx - 4) + ' ' + r1(yLo) + 'H' + r1(cx + 4) + '"/>';
				capY = Math.min(top, yHi);
			}
			if (k <= 6) {
				mark += '<text class="lc-value" x="' + r1(cx) + '" y="' + r1(capY - 5) + '" text-anchor="middle">' +
					esc(opts.unit === '%' ? fmt(d.value, digits) + '%' : fmt(d.value, digits)) + '</text>';
			}
			out += '<g class="lc-mark" data-tip="' + esc(tip) + '"><rect class="lc-hit" x="' + r1(cx - band / 2) + '" y="' + f.y0 + '" width="' + r1(band) + '" height="' + f.h + '"/>' + mark + '</g>';
			labels[i].forEach(function (text, j) {
				out += '<text class="lc-tick lc-cat" x="' + r1(cx) + '" y="' + (f.y1 + 15 + j * 12) + '" text-anchor="middle">' + esc(text) + '</text>';
			});
			parts.push(d.label + ' ' + said + (isNum(d.n) ? ', n = ' + d.n : ''));
			var row = [d.label, fmt(d.value, digits)];
			if (hasInterval) { row.push(interval ? fmt(d.lo, digits) : ''); row.push(interval ? fmt(d.hi, digits) : ''); }
			if (hasN) row.push(isNum(d.n) ? String(d.n) : '');
			table.push(row);
		});
		var head = [opts.groupLabel || 'Condition', opts.valueLabel || opts.yLabel || 'Value'];
		if (hasInterval) head.push('Low', 'High');
		if (hasN) head.push('n');
		var summary = opts.summary || lead(opts, 'Bar chart') + parts.join('; ') + '.';
		var markup = open(f, summary) + yGrid(f, scale, py, opts) + out +
			'<line class="lc-axis" x1="' + f.x0 + '" x2="' + f.x1 + '" y1="' + r1(zero) + '" y2="' + r1(zero) + '"/></svg>';
		return { markup: markup, summary: summary, table: { head: head, rows: table }, width: f.W, height: f.H };
	}

	// ---- scatter ------------------------------------------------------------------
	// points: [{ x, y, label, group, r }]. Up to three groups get the three series
	// colours and a legend. opts.fit (default true) draws the least-squares line
	// through all points; opts.rho (default true) writes Spearman's rho and n in
	// the emptier top corner; opts.identity draws the dashed line y = x.
	// opts: title, xLabel, yLabel, unit, digits, xMin, xMax, yMin, yMax, groups: [names], width, height
	function scatter(points, opts) {
		opts = opts || {};
		var S = stats();
		var pts = (points || []).filter(function (p) { return p && isNum(p.x) && isNum(p.y); });
		var names = opts.groups && opts.groups.length ? opts.groups.slice(0, SERIES) : [];
		if (!names.length) pts.forEach(function (p) { if (p.group != null && names.indexOf(String(p.group)) === -1 && names.length < SERIES) names.push(String(p.group)); });
		var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
		var xlo = Math.min.apply(null, xs), xhi = Math.max.apply(null, xs), ylo = Math.min.apply(null, ys), yhi = Math.max.apply(null, ys);
		if (opts.identity && pts.length) { xlo = ylo = Math.min(xlo, ylo); xhi = yhi = Math.max(xhi, yhi); }
		if (isNum(opts.xMin)) xlo = opts.xMin;
		if (isNum(opts.xMax)) xhi = opts.xMax;
		if (isNum(opts.yMin)) ylo = opts.yMin;
		if (isNum(opts.yMax)) yhi = opts.yMax;
		var sx = niceScale(pts.length ? xlo : 0, pts.length ? xhi : 1, 4), sy = niceScale(pts.length ? ylo : 0, pts.length ? yhi : 1, 4);
		var W = isNum(opts.width) && opts.width >= 200 ? opts.width : 340;
		var left = leftMargin(sy);
		var keyItems = names.length > 1 ? names.map(function (n, i) { return { name: n, cls: seriesClass(i), kind: 'dot' }; }) : [];
		var headRow = opts.yLabel || (S && opts.rho !== false && pts.length >= 3) ? 18 : 6;      // the line of the y label and of rho
		var key = legend(W, left, keyItems, headRow + 6);
		var f = frame(opts, 'scatter', { left: left, right: 12, top: headRow + 6 + key.rows * 15, bottom: opts.xLabel ? 36 : 22 });
		if (!pts.length) return empty(f, opts);
		var px = scaleX(f, sx), py = scaleY(f, sy), digits = opts.digits;
		var out = '';

		if (opts.identity) {
			var a = Math.max(sx.min, sy.min), b = Math.min(sx.max, sy.max);
			if (b > a) out += '<line class="lc-ref" x1="' + r1(px(a)) + '" y1="' + r1(py(a)) + '" x2="' + r1(px(b)) + '" y2="' + r1(py(b)) + '"/>';
		}
		var line = null, rho = NaN;
		if (S && pts.length >= 3) {
			if (opts.fit !== false) {
				line = S.linreg(xs, ys);
				if (isNum(line.slope) && isNum(line.intercept)) {
					// the part of the line that is inside the plot
					var t0 = sx.min, t1 = sx.max;
					if (line.slope !== 0) {
						var xa = (sy.min - line.intercept) / line.slope, xb = (sy.max - line.intercept) / line.slope;
						t0 = Math.max(t0, Math.min(xa, xb));
						t1 = Math.min(t1, Math.max(xa, xb));
					}
					var inside = line.slope !== 0 || (line.intercept >= sy.min && line.intercept <= sy.max);
					if (t1 > t0 && inside) out += '<line class="lc-fit" x1="' + r1(px(t0)) + '" y1="' + r1(py(line.predict(t0))) + '" x2="' + r1(px(t1)) + '" y2="' + r1(py(line.predict(t1))) + '"/>';
					else line = null;
				} else line = null;
			}
			if (opts.rho !== false) rho = S.spearman(xs, ys);
		}
		var table = [];
		pts.forEach(function (p) {
			var g = p.group != null ? Math.max(0, names.indexOf(String(p.group))) : 0;
			var rad = isNum(p.r) ? clamp(p.r, 2, 12) : 4;
			var tip = (p.label != null ? p.label + ': ' : '') + (opts.xLabel || 'x') + ' ' + fmt(p.x, digits) + ', ' + (opts.yLabel || 'y') + ' ' + fmt(p.y, digits) +
				(p.group != null && names.length > 1 ? ' (' + p.group + ')' : '');
			out += '<g class="lc-mark" data-tip="' + esc(tip) + '"><circle class="lc-hit" cx="' + r1(px(p.x)) + '" cy="' + r1(py(p.y)) + '" r="' + Math.max(12, rad + 6) + '"/>' +
				'<circle class="lc-dot lc-fill ' + seriesClass(g) + '" cx="' + r1(px(p.x)) + '" cy="' + r1(py(p.y)) + '" r="' + rad + '"/></g>';
			var row = [];
			if (pts.some(function (q) { return q.label != null; })) row.push(p.label == null ? '' : String(p.label));
			if (names.length > 1) row.push(p.group == null ? '' : String(p.group));
			row.push(fmt(p.x, digits), fmt(p.y, digits));
			table.push(row);
		});
		// rho and n go above the plot, at the right, on the line of the y label:
		// inside the plot they would sit on top of a point sooner or later
		var note = '';
		if (isNum(rho)) note = '<text class="lc-note" x="' + f.x1 + '" y="11" text-anchor="end">' + esc(RHO + ' = ' + fmt(rho, 2) + ', n = ' + pts.length) + '</text>';
		var head = [];
		if (pts.some(function (q) { return q.label != null; })) head.push('Item');
		if (names.length > 1) head.push('Group');
		head.push(opts.xLabel || 'x', opts.yLabel || 'y');
		var summary = opts.summary || lead(opts, 'Scatter plot') + (opts.yLabel || 'y') + ' against ' + (opts.xLabel || 'x') + ', ' + pts.length + ' point' + (pts.length === 1 ? '' : 's') + '.' +
			(isNum(rho) ? ' Spearman rho ' + fmt(rho, 2) + '.' : '') +
			(line ? ' The fitted line ' + (line.slope > 0 ? 'rises' : line.slope < 0 ? 'falls' : 'is flat') + ': slope ' + fmt(line.slope, isNum(digits) ? digits : undefined) + '.' : '') +
			(opts.identity ? ' The dashed line is where the two are equal.' : '');
		var markup = open(f, summary) + yGrid(f, sy, py, opts) +
			'<line class="lc-axis" x1="' + f.x0 + '" x2="' + f.x0 + '" y1="' + f.y0 + '" y2="' + f.y1 + '"/>' + xTicks(f, sx, px, opts) + key.markup + out + note + '</svg>';
		return { markup: markup, summary: summary, table: { head: head, rows: table }, width: f.W, height: f.H };
	}

	// ---- line ---------------------------------------------------------------------
	// series: [{ name, points: [{ x, y, lo, hi }] }], or just a list of points for
	// one series. Up to three series. opts.curves: [{ name, fn }] draws fitted
	// curves (the first as a thin solid line, the second dashed), for example the
	// two fits of LabStats.fitExpVsPower. A key is drawn as soon as there is more
	// than one thing to tell apart.
	// opts: title, xLabel, yLabel, unit, digits, xMin, xMax, yMin, yMax, xTicks: [{ x, label }], width, height
	function line(series, opts) {
		opts = opts || {};
		var list = Array.isArray(series) && series.length && series[0] && series[0].points ? series : [{ name: opts.name || '', points: series || [] }];
		list = list.slice(0, SERIES).map(function (s) {
			return {
				name: String(s.name == null ? '' : s.name),
				points: (s.points || []).filter(function (p) { return p && isNum(p.x) && isNum(p.y); }).slice().sort(function (p, q) { return p.x - q.x; })
			};
		});
		var curves = (opts.curves || []).filter(function (c) { return c && typeof c.fn === 'function'; }).slice(0, 2);
		var all = [];
		list.forEach(function (s) { all = all.concat(s.points); });
		var xs = all.map(function (p) { return p.x; });
		var ylo = Infinity, yhi = -Infinity;
		all.forEach(function (p) { ylo = Math.min(ylo, p.y, isNum(p.lo) ? p.lo : p.y); yhi = Math.max(yhi, p.y, isNum(p.hi) ? p.hi : p.y); });
		var xlo = Math.min.apply(null, xs), xhi = Math.max.apply(null, xs);
		if (isNum(opts.xMin)) xlo = opts.xMin;
		if (isNum(opts.xMax)) xhi = opts.xMax;
		if (isNum(opts.yMin)) ylo = opts.yMin;
		if (isNum(opts.yMax)) yhi = opts.yMax;
		var sx = niceScale(all.length ? xlo : 0, all.length ? xhi : 1, 5), sy = niceScale(all.length ? ylo : 0, all.length ? yhi : 1, 4);
		// keep the first and last points off the frame, and do not round the x axis outwards
		if (all.length && xhi > xlo) { sx.min = xlo; sx.max = xhi; sx.ticks = sx.ticks.filter(function (t) { return t >= xlo - 1e-9 && t <= xhi + 1e-9; }); }
		var W = isNum(opts.width) && opts.width >= 200 ? opts.width : 340;
		var left = leftMargin(sy);
		var keyItems = [];
		if (list.length + curves.length > 1) {
			list.forEach(function (s, i) { if (s.name) keyItems.push({ name: s.name, cls: seriesClass(i), kind: 'line' }); });
			curves.forEach(function (c, i) { keyItems.push({ name: String(c.name || 'fit ' + (i + 1)), cls: '', kind: i ? 'dash' : 'thin' }); });
		}
		var key = legend(W, left, keyItems, (opts.yLabel ? 18 : 6) + 6);
		var f = frame(opts, 'line', { left: left, right: 14, top: (opts.yLabel ? 18 : 6) + 6 + key.rows * 15, bottom: opts.xLabel ? 36 : 22 });
		if (!all.length) return empty(f, opts);
		// a little air on both sides, so the end markers are whole
		f.x0 += 6; f.x1 -= 2; f.w = f.x1 - f.x0;
		var px = scaleX(f, sx), py = scaleY(f, sy), digits = opts.digits;
		var out = '', parts = [];

		curves.forEach(function (c, ci) {
			var d = '', pen = false;
			for (var i = 0; i <= 60; i++) {
				var x = sx.min + (sx.max - sx.min) * i / 60, y = c.fn(x);
				if (!isNum(y) || y < sy.min - 1e-9 || y > sy.max + 1e-9) { pen = false; continue; }
				d += (pen ? 'L' : 'M') + r1(px(x)) + ' ' + r1(py(y));
				pen = true;
			}
			if (d) out += '<path class="lc-curve ' + (ci ? 'lc-k2' : 'lc-k1') + '" d="' + d + '"/>';
		});
		list.forEach(function (s, si) {
			if (!s.points.length) return;
			var cls = seriesClass(si);
			// A long series is a line alone: a marker on each of sixty points is noise.
			// Every point keeps its tooltip.
			var crowded = s.points.length > 24;
			out += '<polyline class="lc-line ' + cls + (crowded ? ' lc-thin' : '') + '" points="' + s.points.map(function (p) { return r1(px(p.x)) + ',' + r1(py(clamp(p.y, sy.min, sy.max))); }).join(' ') + '"/>';
			s.points.forEach(function (p) {
				var cx = r1(px(p.x)), cy = r1(py(clamp(p.y, sy.min, sy.max))), whisker = '';
				var interval = isNum(p.lo) && isNum(p.hi);
				if (interval) whisker = '<path class="lc-whisker" d="M' + cx + ' ' + r1(py(clamp(p.hi, sy.min, sy.max))) + 'V' + r1(py(clamp(p.lo, sy.min, sy.max))) + '"/>';
				var tip = (s.name ? s.name + ', ' : '') + (opts.xLabel || 'x') + ' ' + fmt(p.x) + ': ' + withUnit(fmt(p.y, digits), opts.unit) +
					(interval ? ' (' + fmt(p.lo, digits) + ' to ' + fmt(p.hi, digits) + ')' : '');
				out += '<g class="lc-mark" data-tip="' + esc(tip) + '">' + whisker + '<circle class="lc-hit" cx="' + cx + '" cy="' + cy + '" r="' + (crowded ? 6 : 12) + '"/>' +
					(crowded ? '' : '<circle class="lc-dot lc-fill ' + cls + '" cx="' + cx + '" cy="' + cy + '" r="4"/>') + '</g>';
			});
			var first = s.points[0], last = s.points[s.points.length - 1];
			parts.push((s.name ? s.name + ': ' : '') + s.points.length + ' point' + (s.points.length === 1 ? '' : 's') + ', from ' + withUnit(fmt(first.y, digits), opts.unit) + ' at ' + fmt(first.x) +
				' to ' + withUnit(fmt(last.y, digits), opts.unit) + ' at ' + fmt(last.x));
		});
		var allX = [];
		all.forEach(function (p) { if (allX.indexOf(p.x) === -1) allX.push(p.x); });
		allX.sort(function (a, b) { return a - b; });
		var table = allX.map(function (x) {
			return [fmt(x)].concat(list.map(function (s) {
				var hit = s.points.filter(function (p) { return p.x === x; })[0];
				return hit ? fmt(hit.y, digits) : '';
			})).concat(curves.map(function (c) { return fmt(c.fn(x), digits); }));
		});
		var head = [opts.xLabel || 'x'].concat(list.map(function (s, i) { return s.name || opts.yLabel || 'Series ' + (i + 1); })).concat(curves.map(function (c, i) { return String(c.name || 'fit ' + (i + 1)); }));
		var summary = opts.summary || lead(opts, 'Line chart') + (opts.yLabel || 'y') + ' by ' + (opts.xLabel || 'x') + '. ' + parts.join('; ') + '.' +
			(curves.length ? ' Fitted curve' + (curves.length > 1 ? 's' : '') + ': ' + curves.map(function (c, i) { return String(c.name || 'fit ' + (i + 1)); }).join(', ') + '.' : '');
		var grid = { W: f.W, H: f.H, x0: left, x1: f.x1 + 2, y0: f.y0, y1: f.y1 };
		var markup = open(f, summary) + yGrid(grid, sy, py, opts) + xTicks({ x0: left, x1: f.x1 + 2, y1: f.y1, H: f.H }, sx, px, opts) + key.markup + out + '</svg>';
		return { markup: markup, summary: summary, table: { head: head, rows: table }, width: f.W, height: f.H };
	}

	// ---- dots by condition ----------------------------------------------------------
	// groups: [{ label, values: [numbers] }]. Every value is one dot, spread
	// sideways only as far as it must to stay visible (the same data always
	// gives the same picture); a tick marks each group's median, which is also
	// written under the label. The dots shrink (to 1.6 px) before they would
	// touch; values that still find no place (dozens tied at one value) are not
	// piled on the others but counted at the end of their row, "+12".
	// opts: title, yLabel, unit, digits, yMin, yMax, groupLabel, width, height
	function dots(groups, opts) {
		opts = opts || {};
		var S = stats();
		var list = (groups || []).map(function (g) {
			return { label: String(g && g.label != null ? g.label : ''), values: ((g && g.values) || []).filter(isNum) };
		});
		var all = [];
		list.forEach(function (g) { all = all.concat(g.values); });
		var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
		if (isNum(opts.yMin)) lo = opts.yMin;
		if (isNum(opts.yMax)) hi = opts.yMax;
		var scale = niceScale(all.length ? lo : 0, all.length ? hi : 1, 4);
		var k = Math.max(1, list.length);
		var W = isNum(opts.width) && opts.width >= 200 ? opts.width : 340;
		var left = leftMargin(scale);
		var band = (W - left - 8) / k;
		var labels = list.map(function (g) { return wrap(g.label, Math.floor((band - 6) / CHAR))[0]; });
		var f = frame(opts, 'dots', { left: left, right: 8, top: (opts.yLabel ? 18 : 6) + 6, bottom: 36 });
		if (!all.length) return empty(f, opts);
		var py = scaleY(f, scale), digits = opts.digits;
		var most = Math.max.apply(null, list.map(function (g) { return g.values.length; }));
		var out = '', parts = [], table = [];
		var COUNT_ROOM = 20;            // room kept for a "+12" in a group that needs one
		function halfOf(r, reserve) { return Math.max(r, Math.min(band / 2 - r - 6, 46) - (reserve ? COUNT_ROOM : 0)); }
		// Each dot goes as near the middle of its group as it can without touching
		// a dot already placed. A dot with no free place left (many tied values)
		// is not drawn on top of the others: it is counted, and the count is
		// written at the end of its row ("+12").
		function place(sorted, rad, reserve) {
			var half = halfOf(rad, reserve), need = (2 * rad + 0.8) * (2 * rad + 0.8), placed = [], over = [];
			sorted.forEach(function (v) {
				var y = py(clamp(v, scale.min, scale.max)), dx = 0, found = false;
				for (var step = 0; step * rad * 0.9 <= half && !found; step++) {
					var offs = step === 0 ? [0] : [step * rad * 0.9, -step * rad * 0.9];
					for (var o = 0; o < offs.length && !found; o++) {
						var ok = true;
						for (var j = placed.length - 1; j >= 0; j--) {
							var ddx = placed[j].x - offs[o], ddy = placed[j].y - y;
							if (ddy * ddy > need) break;                 // sorted by value: nothing further back can touch
							if (ddx * ddx + ddy * ddy < need) { ok = false; break; }
						}
						if (ok) { dx = offs[o]; found = true; }
					}
				}
				if (found) placed.push({ x: dx, y: y, v: v });
				else if (over.length && Math.abs(over[over.length - 1].y - y) < 2 * rad + 0.8) over[over.length - 1].n++;
				else over.push({ y: y, n: 1 });
			});
			return { placed: placed, over: over };
		}
		// The largest dot (4 px down to 1.6 px) at which every value has a place;
		// the smallest when none is enough.
		var sortedOf = list.map(function (g) { return g.values.slice().sort(function (a, b) { return a - b; }); });
		var sizes = [4, 3.2, 2.6, 2, 1.6].filter(function (r) { return r <= (most <= 30 ? 4 : most <= 80 ? 3.2 : 2.6); });
		var rad = sizes[sizes.length - 1], layouts = null;
		for (var si = 0; si < sizes.length; si++) {
			var tried = sortedOf.map(function (s) { return place(s, sizes[si]); });
			if (si === sizes.length - 1 || tried.every(function (t) { return !t.over.length; })) { rad = sizes[si]; layouts = tried; break; }
		}
		// a group with values left over gives up some width to its count
		layouts = layouts.map(function (l, gi) { if (!l.over.length) return l; var r = place(sortedOf[gi], rad, true); r.reserve = true; return r; });
		function med(v) {
			if (S) return S.median(v);
			var s = v.slice().sort(function (a, b) { return a - b; }), m = (s.length - 1) / 2;
			return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2;
		}

		list.forEach(function (g, gi) {
			var cx = f.x0 + band * (gi + 0.5), half = halfOf(rad, layouts[gi].reserve);
			var placed = layouts[gi].placed, marks = '', hidden = 0;
			placed.forEach(function (p) {
				marks += '<g class="lc-mark" data-tip="' + esc(g.label + ': ' + withUnit(fmt(p.v, digits), opts.unit)) + '"><circle class="lc-dot lc-fill lc-s1" cx="' + r1(cx + p.x) + '" cy="' + r1(p.y) + '" r="' + rad + '"/></g>';
			});
			layouts[gi].over.forEach(function (o) {
				hidden += o.n;
				marks += '<g class="lc-mark" data-tip="' + esc(g.label + ': ' + o.n + ' more value' + (o.n === 1 ? '' : 's') + ' here than there is room to draw') + '"><text class="lc-tick lc-more" x="' + r1(cx + half + rad + 5) +
					'" y="' + r1(o.y + 3.8) + '" text-anchor="start">+' + o.n + '</text></g>';
			});
			out += marks;
			var m = g.values.length ? med(g.values) : NaN;
			if (isNum(m)) {
				// a little wider than the dots it summarises
				var reach = 0;
				placed.forEach(function (p) { reach = Math.max(reach, Math.abs(p.x)); });
				var tick = Math.min(Math.max(16, reach + rad + 5), band / 2 - 6);         // never touching the next group's tick
				if (layouts[gi].over.length) tick = Math.min(tick, half + rad + 2);       // nor the "+12" of a count
				out += '<line class="lc-median" x1="' + r1(cx - tick) + '" x2="' + r1(cx + tick) + '" y1="' + r1(py(clamp(m, scale.min, scale.max))) + '" y2="' + r1(py(clamp(m, scale.min, scale.max))) + '"/>';
			}
			out += '<text class="lc-tick lc-cat" x="' + r1(cx) + '" y="' + (f.y1 + 15) + '" text-anchor="middle">' + esc(labels[gi]) + '</text>' +
				'<text class="lc-value" x="' + r1(cx) + '" y="' + (f.y1 + 29) + '" text-anchor="middle">' + esc(isNum(m) ? withUnit(fmt(m, digits), opts.unit) : DASH) + '</text>';
			var gmin = g.values.length ? Math.min.apply(null, g.values) : NaN, gmax = g.values.length ? Math.max.apply(null, g.values) : NaN;
			parts.push(g.label + ': ' + g.values.length + ' value' + (g.values.length === 1 ? '' : 's') + (hidden ? ' (' + hidden + ' of them counted beside their row, not drawn)' : '') + (g.values.length ? ', median ' + withUnit(fmt(m, digits), opts.unit) + ', from ' + fmt(gmin, digits) + ' to ' + fmt(gmax, digits) : ''));
			table.push([g.label, String(g.values.length), fmt(m, digits), fmt(gmin, digits), fmt(gmax, digits)]);
		});
		var summary = opts.summary || lead(opts, 'Dot plot') + 'One dot per value; the tick and the number under each label are the median. ' + parts.join('; ') + '.';
		var markup = open(f, summary) + yGrid(f, scale, py, opts) + '<line class="lc-axis" x1="' + f.x0 + '" x2="' + f.x1 + '" y1="' + f.y1 + '" y2="' + f.y1 + '"/>' + out + '</svg>';
		return { markup: markup, summary: summary, table: { head: [opts.groupLabel || 'Condition', 'n', 'Median', 'Lowest', 'Highest'], rows: table }, width: f.W, height: f.H };
	}

	// ---- histogram ------------------------------------------------------------------
	// values: [numbers]. Bins have round edges; their number follows the
	// Freedman-Diaconis rule (bin width 2 * IQR * n^(-1/3)), kept between 5 and
	// 24, unless opts.bins says how many. Whole numbers over a short range (a
	// span, a count: at most 24 apart) get one bar per number, centred on it;
	// opts.discrete: false turns that off. opts.marks: [{ x, label }] draws a
	// labelled line at a value (the median, a deadline).
	// opts: title, xLabel, yLabel, unit, digits, bins, discrete, xMin, xMax, marks, width, height
	function histogram(values, opts) {
		opts = opts || {};
		var S = stats();
		var v = (values || []).filter(isNum).slice().sort(function (a, b) { return a - b; });
		var n = v.length;
		var lo = n ? v[0] : 0, hi = n ? v[n - 1] : 1;
		if (isNum(opts.xMin)) lo = Math.min(lo, opts.xMin);
		if (isNum(opts.xMax)) hi = Math.max(hi, opts.xMax);
		var whole = n > 0 && opts.discrete !== false && hi - lo <= 24 && v.every(function (x) { return x === Math.round(x); });
		var sx, edges, counts = [], i, ticks = null;
		if (whole) {
			var first = Math.floor(lo), last = Math.ceil(hi);
			edges = [];
			ticks = [];
			for (i = first; i <= last + 1; i++) edges.push(i - 0.5);
			for (i = first; i <= last; i++) { ticks.push({ x: i, label: String(i) }); counts.push(0); }
			sx = { min: first - 0.5, max: last + 0.5, step: 1, ticks: edges, digits: 0 };
			v.forEach(function (x) { counts[x - first]++; });
		} else {
			var want = isNum(opts.bins) && opts.bins >= 1 ? Math.round(opts.bins) : 0;
			if (!want && n > 1 && hi > lo) {
				var q = function (p) { var h = (n - 1) * p, a = Math.floor(h); return v[a] + (h - a) * (v[Math.min(n - 1, a + 1)] - v[a]); };
				var width = 2 * (q(0.75) - q(0.25)) * Math.pow(n, -1 / 3);
				want = width > 0 ? Math.ceil((hi - lo) / width) : Math.ceil(Math.sqrt(n));
			}
			sx = binScale(lo, hi, opts.bins >= 1 ? want : clamp(want || 6, 5, 24));
			edges = sx.ticks;
			for (i = 0; i < edges.length - 1; i++) counts.push(0);
			v.forEach(function (x) {
				var b = Math.min(counts.length - 1, Math.max(0, Math.floor((x - sx.min) / sx.step + 1e-9)));
				counts[b]++;
			});
		}
		function binName(b) { return whole ? String(ticks[b].x) : tickText(edges[b], sx) + ' to ' + tickText(edges[b + 1], sx); }
		var top = Math.max.apply(null, counts.concat([1]));
		var sy = niceScale(0, top, Math.min(4, top));
		if (sy.step < 1) sy = { min: 0, max: Math.max(1, Math.ceil(top)), step: 1, ticks: (function () { var t = []; for (var j = 0; j <= Math.max(1, Math.ceil(top)); j++) t.push(j); return t; })(), digits: 0 };
		var marks = (opts.marks || []).filter(function (m) { return m && isNum(m.x); });
		var left = leftMargin(sy);
		var f = frame(opts, 'histogram', { left: left, right: 12, top: (opts.yLabel ? 18 : 6) + (marks.length ? 18 : 6), bottom: opts.xLabel ? 36 : 22 });
		if (!n) return empty(f, opts);
		var px = scaleX(f, sx), py = scaleY(f, sy), digits = opts.digits;
		var out = '', table = [], best = 0;
		counts.forEach(function (c, b) {
			if (c > counts[best]) best = b;
			var x0 = px(edges[b]) + 1, x1 = px(edges[b + 1]) - 1, w = Math.max(1, x1 - x0), y = py(c), rad = Math.min(3, w / 2, f.y1 - y);
			if (whole && w > 26) { x0 += (w - 26) / 2; w = 26; }          // one bar per number: a bar, not a block
			table.push([binName(b), String(c)]);
			if (!c) return;
			var d = 'M' + r1(x0) + ' ' + f.y1 + 'V' + r1(y + rad) + 'Q' + r1(x0) + ' ' + r1(y) + ' ' + r1(x0 + rad) + ' ' + r1(y) + 'H' + r1(x0 + w - rad) +
				'Q' + r1(x0 + w) + ' ' + r1(y) + ' ' + r1(x0 + w) + ' ' + r1(y + rad) + 'V' + f.y1 + 'Z';
			out += '<g class="lc-mark" data-tip="' + esc(withUnit(binName(b), opts.unit) + ': ' + c) + '"><rect class="lc-hit" x="' + r1(px(edges[b])) + '" y="' + f.y0 + '" width="' + r1(px(edges[b + 1]) - px(edges[b])) + '" height="' + f.h + '"/>' +
				'<path class="lc-bar lc-fill lc-s1" d="' + d + '"/></g>';
		});
		var lastRight = -Infinity;
		marks.forEach(function (m) {
			var x = px(clamp(m.x, sx.min, sx.max)), label = String(m.label == null ? fmt(m.x, digits) : m.label), half = label.length * CHAR / 2;
			var tx = clamp(x, f.x0 + half, f.x1 - half);
			out += '<line class="lc-markline" x1="' + r1(x) + '" x2="' + r1(x) + '" y1="' + (f.y0 - 4) + '" y2="' + f.y1 + '"/>';
			if (tx - half > lastRight + 4) {
				out += '<text class="lc-value" x="' + r1(tx) + '" y="' + (f.y0 - 8) + '" text-anchor="middle">' + esc(label) + '</text>';
				lastRight = tx + half;
			}
		});
		var median = S ? S.median(v) : v[Math.floor((n - 1) / 2)];
		var summary = opts.summary || lead(opts, 'Histogram') + n + ' value' + (n === 1 ? '' : 's') + ' from ' + fmt(v[0], digits) + ' to ' + fmt(v[n - 1], digits) + ', median ' + withUnit(fmt(median, digits), opts.unit) +
			(whole ? '. The most common value is ' + binName(best) : '. The fullest bin is ' + binName(best)) + ' with ' + counts[best] + '.' +
			(marks.length ? ' Marked: ' + marks.map(function (m) { return String(m.label == null ? fmt(m.x, digits) : m.label); }).join(', ') + '.' : '');
		var markup = open(f, summary) + yGrid(f, sy, py, opts) + xTicks(f, sx, px, whole ? { xLabel: opts.xLabel, xTicks: ticks } : opts) + out + '</svg>';
		return { markup: markup, summary: summary, table: { head: [opts.xLabel || (whole ? 'Value' : 'Bin'), opts.yLabel || 'Count'], rows: table }, width: f.W, height: f.H };
	}

	var build = { bars: bars, scatter: scatter, line: line, dots: dots, histogram: histogram };
	var pure = { build: build, fmt: fmt, niceScale: niceScale, wrap: wrap };
	if (typeof module === 'object' && module && module.exports) module.exports = pure;
	if (typeof window === 'undefined' || typeof document === 'undefined') return;

	// =========================================================================
	// Browser part: elements, the tooltip, figures
	// =========================================================================

	// ---- The tooltip (one for the page) -----------------------------------------

	var tip = null;
	function hideTip() { if (tip) tip.hidden = true; }
	function showTip(text, x, y) {
		if (!document.body) return;
		if (!tip) {
			tip = document.createElement('div');
			tip.className = 'lab-tip';
			tip.setAttribute('aria-hidden', 'true');      // the same numbers are in the summary and the table
			tip.hidden = true;
			document.body.appendChild(tip);
			window.addEventListener('scroll', hideTip, { passive: true, capture: true });
			// a tap on a mark leaves its tooltip up; a press anywhere outside a chart takes it away
			document.addEventListener('pointerdown', function (e) {
				if (!(e.target && e.target.closest && e.target.closest('.lab-chart'))) hideTip();
			}, true);
		}
		tip.textContent = text;
		tip.hidden = false;
		var w = tip.offsetWidth, h = tip.offsetHeight, vw = document.documentElement.clientWidth;
		tip.style.left = Math.round(clamp(x - w / 2, 6, Math.max(6, vw - w - 6))) + 'px';
		tip.style.top = Math.round(y - h - 12 < 6 ? y + 16 : y - h - 12) + 'px';
	}
	function watch(svg) {
		if (document.documentElement.classList.contains('is-thumb')) return;
		function over(e) {
			var mark = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
			if (mark && svg.contains(mark)) showTip(mark.getAttribute('data-tip'), e.clientX, e.clientY);
			else hideTip();
		}
		svg.addEventListener('pointermove', over);
		svg.addEventListener('pointerdown', over);
		// A finger "leaves" the moment it is lifted: only a mouse or a pen hides the tooltip by leaving.
		svg.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') hideTip(); });
	}

	// ---- Elements -------------------------------------------------------------------

	function toElement(built) {
		var holder = document.createElement('div');
		holder.innerHTML = built.markup;
		var svg = holder.firstChild;
		svg.labSummary = built.summary;
		svg.labTable = built.table;
		watch(svg);
		return svg;
	}
	function put(node, content) {
		if (content == null) return;
		if (typeof content === 'object' && content.nodeType) node.appendChild(content);
		else node.textContent = String(content);
	}

	// The data of a chart as a table inside <details>: the same numbers for
	// keyboard and screen-reader users, and for anyone who wants them exactly.
	function tableView(table, label) {
		var details = document.createElement('details');
		details.className = 'lab-data';
		var sum = document.createElement('summary');
		sum.textContent = label || 'The numbers';
		details.appendChild(sum);
		var t = document.createElement('table');
		t.className = 'lab-table';
		var thead = document.createElement('thead'), hr = document.createElement('tr');
		table.head.forEach(function (h) { var th = document.createElement('th'); th.scope = 'col'; th.textContent = h; hr.appendChild(th); });
		thead.appendChild(hr);
		t.appendChild(thead);
		var tbody = document.createElement('tbody');
		table.rows.forEach(function (row) {
			var tr = document.createElement('tr');
			row.forEach(function (cell, i) {
				var td = document.createElement(i === 0 ? 'th' : 'td');
				if (i === 0) td.scope = 'row';
				td.textContent = cell;
				tr.appendChild(td);
			});
			tbody.appendChild(tr);
		});
		t.appendChild(tbody);
		details.appendChild(t);
		return details;
	}

	// mount(container, draw): calls draw(width) with the container's width (280
	// to 720) now and whenever that width changes, and puts what it returns in
	// the container. For a chart that should fill its column instead of
	// staying 340 px wide.
	function mount(container, draw) {
		var last = 0;
		function render() {
			var w = clamp(Math.floor(container.clientWidth || 340), 280, 720);
			if (container.firstChild && Math.abs(w - last) < 8) return;
			last = w;
			var node = draw(w);
			container.textContent = '';
			if (node) container.appendChild(node);
		}
		render();
		if (window.ResizeObserver) new ResizeObserver(render).observe(container);
		else window.addEventListener('resize', render);
		return render;
	}

	// figure(chart, { caption, note, table: true }) -> <figure class="lab-figure">
	// chart is an element from one of the chart functions, or a function of the
	// width that returns one (it is then mounted, and redrawn when the column
	// changes width). caption goes above the chart, note under it (text or a
	// node), and the chart's numbers go in a closed "The numbers" table unless
	// table is false.
	function figure(chart, opts) {
		opts = opts || {};
		var fig = document.createElement('figure');
		fig.className = 'lab-figure';
		if (opts.caption != null) {
			var cap = document.createElement('figcaption');
			cap.className = 'lab-figcaption';
			put(cap, opts.caption);
			fig.appendChild(cap);
		}
		var holder = document.createElement('div');
		holder.className = 'lab-chart-holder';
		fig.appendChild(holder);
		var first = null;
		if (typeof chart === 'function') {
			mount(holder, function (w) { var node = chart(w); if (!first) first = node; return node; });
		} else {
			first = chart;
			if (chart) holder.appendChild(chart);
		}
		if (opts.note != null) {
			var note = document.createElement('p');
			note.className = 'lab-fignote';
			put(note, opts.note);
			fig.appendChild(note);
		}
		if (opts.table !== false && first && first.labTable && first.labTable.rows.length) fig.appendChild(tableView(first.labTable, opts.tableLabel));
		return fig;
	}

	function element(kind) { return function (data, opts) { return toElement(build[kind](data, opts)); }; }

	window.LabChart = {
		bars: element('bars'), scatter: element('scatter'), line: element('line'), dots: element('dots'), histogram: element('histogram'),
		figure: figure, mount: mount, table: tableView, build: build, fmt: fmt, niceScale: niceScale
	};
})();
