/*
 * True Shuffle: continue on your phone (handoff.js). The computer shows a QR
 * code; the phone's camera opens this page at the same queue, the same song
 * and the same second (share.js's link, #/share?ids=...&at=<id>&s=<seconds>),
 * where a big "Play from 2:31" starts it. Nothing is sent anywhere: the code is
 * drawn here, from the link.
 *
 *     H.plan({ items, index, sec, title, base }) -> { url, at, sec, songs, cut } | null
 *     H.qr(text, { level, maxVersion }) -> { version, level, mask, size, rows, dark(x, y) } | null
 *     H.svg(code, { scale, margin }) -> '<svg ...>' (black on white, the quiet zone included)
 *     H.pixels(modules, dpr) -> the code's width in CSS pixels
 *     H.open(ctx)                              (the dialog)
 *     H.ecc(data, n)  H.formatBits(level, mask)  H.versionBits(version)  H.capacity(version, level)  H.penalty(rows)
 *
 * The QR code follows ISO/IEC 18004: byte mode, level M (L when M does not
 * fit), versions 1 to 40, the mask with the lowest penalty.
 *
 * UMD: window.TrueShuffle.handoff in the browser, module.exports in Node.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(root, function () { return node ? require('./share.js') : (root.TrueShuffle || {}).share; });
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.handoff = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root, getShare) {
	'use strict';

	var YT_ID = /^[A-Za-z0-9_-]{11}$/;
	var MAX_SONGS = 24;      // the songs after the one that is on
	var MAX_VERSION = 15;    // 77 modules a side: denser codes are hard for a phone to read off a screen
	var QUIET = 4;           // the light border every reader needs, in modules

	// ---- Reed-Solomon over GF(256), the field QR codes use (x^8 + x^4 + x^3 + x^2 + 1) ----------

	var EXP = [], LOG = [];
	(function () {
		var x = 1;
		for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
		for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
	})();
	function mul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
	var generators = {};
	// (x - 1)(x - a)...(x - a^(n-1)), highest power first.
	function generator(n) {
		if (generators[n]) return generators[n];
		var g = [1];
		for (var i = 0; i < n; i++) {
			var r = [];
			for (var j = 0; j <= g.length; j++) r.push(0);
			for (j = 0; j < g.length; j++) { r[j] ^= g[j]; r[j + 1] ^= mul(g[j], EXP[i]); }
			g = r;
		}
		generators[n] = g;
		return g;
	}
	// The n error correction codewords of a block of data codewords.
	function ecc(data, n) {
		var g = generator(n), rem = [], i;
		for (i = 0; i < n; i++) rem.push(0);
		for (var k = 0; k < data.length; k++) {
			var f = data[k] ^ rem.shift();
			rem.push(0);
			for (i = 0; i < n; i++) rem[i] ^= mul(g[i + 1], f);
		}
		return rem;
	}

	// ---- Sizes ---------------------------------------------------------------------------------

	// ISO/IEC 18004 table 9 for levels L and M, by version (0 unused): error correction
	// codewords in each block, and the number of blocks.
	var ECC_PER_BLOCK = {
		L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
		M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
	};
	var BLOCKS = {
		L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
		M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]
	};
	var LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

	// The modules left for data once the patterns are drawn (whole codewords, then 0 to 7 spare bits).
	function rawModules(v) {
		var n = (16 * v + 128) * v + 64;
		if (v >= 2) {
			var a = Math.floor(v / 7) + 2;
			n -= (25 * a - 10) * a - 55;
			if (v >= 7) n -= 36;
		}
		return n;
	}
	function dataCodewords(v, level) { return Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[level][v] * BLOCKS[level][v]; }
	function countBits(v) { return v < 10 ? 8 : 16; }
	// How many bytes a code of this version and level holds in byte mode.
	function capacity(v, level) { return Math.floor((dataCodewords(v, level) * 8 - 4 - countBits(v)) / 8); }

	function utf8(s) {
		var out = [];
		for (var i = 0; i < s.length; i++) {
			var c = s.charCodeAt(i);
			if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.length) {
				var d = s.charCodeAt(i + 1);
				if (d >= 0xDC00 && d < 0xE000) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; }
			}
			if (c < 0x80) out.push(c);
			else if (c < 0x800) out.push(0xC0 | c >> 6, 0x80 | c & 63);
			else if (c < 0x10000) out.push(0xE0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
			else out.push(0xF0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
		}
		return out;
	}

	// ---- The bits ------------------------------------------------------------------------------

	// Mode, length, the bytes, the terminator, then the pad codewords 0xEC and 0x11 in turn.
	function dataStream(bytes, v, level) {
		var bits = [], cap = dataCodewords(v, level) * 8, i;
		function put(val, len) { for (var b = len - 1; b >= 0; b--) bits.push(val >>> b & 1); }
		put(4, 4);
		put(bytes.length, countBits(v));
		for (i = 0; i < bytes.length; i++) put(bytes[i], 8);
		put(0, Math.min(4, cap - bits.length));
		put(0, (8 - bits.length % 8) % 8);
		for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
		var out = [];
		for (i = 0; i < bits.length; i += 8) {
			var byte = 0;
			for (var j = 0; j < 8; j++) byte = byte << 1 | bits[i + j];
			out.push(byte);
		}
		return out;
	}
	// The data cut into blocks (the short ones first), each with its error correction,
	// then interleaved: the first codeword of every block, the second, and so on.
	function interleave(data, v, level) {
		var nb = BLOCKS[level][v], ec = ECC_PER_BLOCK[level][v], raw = Math.floor(rawModules(v) / 8);
		var shorts = nb - raw % nb, shortLen = Math.floor(raw / nb) - ec;
		var blocks = [], eccs = [], k = 0, i;
		for (i = 0; i < nb; i++) {
			var len = shortLen + (i < shorts ? 0 : 1);
			blocks.push(data.slice(k, k + len));
			eccs.push(ecc(blocks[i], ec));
			k += len;
		}
		var out = [];
		for (i = 0; i <= shortLen; i++) for (k = 0; k < nb; k++) if (i < blocks[k].length) out.push(blocks[k][i]);
		for (i = 0; i < ec; i++) for (k = 0; k < nb; k++) out.push(eccs[k][i]);
		return out;
	}
	// The format information: the level and the mask, BCH(15, 5), masked with 101010000010010.
	function formatBits(level, mask) {
		var data = LEVEL_BITS[level] << 3 | mask, rem = data;
		for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
		return (data << 10 | rem) ^ 0x5412;
	}
	// The version information (versions 7 and up): BCH(18, 6).
	function versionBits(v) {
		var rem = v;
		for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
		return v << 12 | rem;
	}
	function alignment(v) {
		if (v === 1) return [];
		var n = Math.floor(v / 7) + 2, size = v * 4 + 17;
		var step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
		var out = [6];
		for (var pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
		return out;
	}

	// ---- The matrix ----------------------------------------------------------------------------

	function grid(size, value) {
		var g = [];
		for (var y = 0; y < size; y++) { var row = []; for (var x = 0; x < size; x++) row.push(value); g.push(row); }
		return g;
	}
	function drawFormat(set, size, level, mask) {
		var bits = formatBits(level, mask), i;
		function bit(k) { return (bits >>> k & 1) === 1; }
		for (i = 0; i <= 5; i++) set(8, i, bit(i));
		set(8, 7, bit(6));
		set(8, 8, bit(7));
		set(7, 8, bit(8));
		for (i = 9; i < 15; i++) set(14 - i, 8, bit(i));
		for (i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
		for (i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
		set(8, size - 8, true);
	}
	// The finder, timing and alignment patterns, the format and version areas; data in the rest.
	function patterns(v) {
		var size = v * 4 + 17, rows = grid(size, false), fixed = grid(size, false), i, j, dx, dy;
		function set(x, y, dark) { rows[y][x] = !!dark; fixed[y][x] = true; }
		for (i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
		[[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
			for (dy = -4; dy <= 4; dy++) for (dx = -4; dx <= 4; dx++) {
				var x = c[0] + dx, y = c[1] + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
				if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
			}
		});
		var al = alignment(v), n = al.length;
		for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
			if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
			for (dy = -2; dy <= 2; dy++) for (dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
		}
		drawFormat(set, size, 'M', 0);
		if (v >= 7) {
			var bits = versionBits(v);
			for (i = 0; i < 18; i++) {
				var a = size - 11 + i % 3, b = Math.floor(i / 3), on = (bits >>> i & 1) === 1;
				set(a, b, on);
				set(b, a, on);
			}
		}
		return { size: size, rows: rows, fixed: fixed, set: set };
	}
	// Codewords into the free modules, two columns at a time, up and down from the right.
	function place(p, words) {
		var size = p.size, i = 0, total = words.length * 8;
		for (var right = size - 1; right >= 1; right -= 2) {
			if (right === 6) right = 5;
			for (var vert = 0; vert < size; vert++) {
				for (var j = 0; j < 2; j++) {
					var x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
					if (!p.fixed[y][x] && i < total) { p.rows[y][x] = (words[i >>> 3] >>> (7 - (i & 7)) & 1) === 1; i++; }
				}
			}
		}
	}
	var MASKS = [
		function (x, y) { return (x + y) % 2 === 0; },
		function (x, y) { return y % 2 === 0; },
		function (x, y) { return x % 3 === 0; },
		function (x, y) { return (x + y) % 3 === 0; },
		function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
		function (x, y) { return x * y % 2 + x * y % 3 === 0; },
		function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
		function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
	];
	function masked(p, level, mask) {
		var size = p.size, rows = [], fixed = p.fixed;
		for (var y = 0; y < size; y++) {
			var row = p.rows[y].slice();
			for (var x = 0; x < size; x++) if (!fixed[y][x] && MASKS[mask](x, y)) row[x] = !row[x];
			rows.push(row);
		}
		drawFormat(function (x2, y2, dark) { rows[y2][x2] = !!dark; }, size, level, mask);
		return rows;
	}
	// The standard's four penalties: runs of five or more (3, plus 1 a module more), 2x2
	// blocks of one colour (3 each), 1:1:3:1:1 with four light modules on a side (40 each),
	// and 10 for every 5% the dark share is away from half.
	function penalty(rows) {
		var n = rows.length, score = 0, dark = 0, x, y;
		for (var pass = 0; pass < 2; pass++) {
			for (y = 0; y < n; y++) {
				var line = '', run = 0, prev = null;
				for (x = 0; x < n; x++) {
					var c = pass ? rows[x][y] : rows[y][x];
					line += c ? '1' : '0';
					if (c === prev) run++;
					else { if (run >= 5) score += run - 2; run = 1; prev = c; }
				}
				if (run >= 5) score += run - 2;
				score += 40 * (count(line, '10111010000') + count(line, '00001011101'));
			}
		}
		for (y = 0; y < n; y++) for (x = 0; x < n; x++) {
			if (rows[y][x]) dark++;
			if (y < n - 1 && x < n - 1 && rows[y][x] === rows[y][x + 1] && rows[y][x] === rows[y + 1][x] && rows[y][x] === rows[y + 1][x + 1]) score += 3;
		}
		return score + 10 * Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5);
	}
	function count(s, part) {
		var k = 0;
		for (var i = s.indexOf(part); i >= 0; i = s.indexOf(part, i + 1)) k++;
		return k;
	}

	// A QR code of the text, or null when it is too long for maxVersion (40) at level L.
	// level 'M' or 'L' asks for that level only.
	function qr(text, o) {
		o = o || {};
		var bytes = utf8(String(text == null ? '' : text));
		var top = Math.max(1, Math.min(40, o.maxVersion || 40)), levels = o.level === 'M' || o.level === 'L' ? [o.level] : ['M', 'L'];
		for (var li = 0; li < levels.length; li++) {
			for (var v = 1; v <= top; v++) if (capacity(v, levels[li]) >= bytes.length) return build(bytes, v, levels[li]);
		}
		return null;
	}
	function build(bytes, v, level) {
		var p = patterns(v);
		place(p, interleave(dataStream(bytes, v, level), v, level));
		var best = null;
		for (var m = 0; m < 8; m++) {
			var rows = masked(p, level, m), score = penalty(rows);
			if (!best || score < best.score) best = { rows: rows, mask: m, score: score };
		}
		var out = best.rows, size = p.size;
		return {
			version: v, level: level, mask: best.mask, size: size, rows: out,
			dark: function (x, y) { return x >= 0 && y >= 0 && x < size && y < size && out[y][x]; }
		};
	}

	// ---- Drawing -------------------------------------------------------------------------------

	// Black on white whatever the theme, with the quiet zone: readers need both.
	function svg(code, o) {
		o = o || {};
		var m = o.margin == null ? QUIET : o.margin, scale = o.scale || 4, n = code.size + 2 * m, d = '';
		for (var y = 0; y < code.size; y++) {
			for (var x = 0; x < code.size; x++) {
				if (!code.rows[y][x]) continue;
				var run = 1;
				while (x + run < code.size && code.rows[y][x + run]) run++;
				d += 'M' + (x + m) + ' ' + (y + m) + 'h' + run + 'v1h-' + run + 'z';
				x += run - 1;
			}
		}
		return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" width="' + n * scale + '" height="' + n * scale + '" shape-rendering="crispEdges">' +
			'<rect width="' + n + '" height="' + n + '" fill="#fff"/><path fill="#000" d="' + d + '"/></svg>';
	}
	// At least 240 CSS pixels, with a whole number of screen pixels to a module (at least two):
	// even modules read best, and a camera reads a bigger code more easily off a screen.
	function pixels(modules, dpr) {
		dpr = dpr > 0 ? dpr : 1;
		return Math.max(2, Math.ceil(240 * dpr / modules)) * modules / dpr;
	}

	// ---- The link ------------------------------------------------------------------------------

	var BUDGET = capacity(MAX_VERSION, 'M');
	// The link for the phone: the song that is on (items[index]) at this second, then up to
	// MAX_SONGS of what comes after it, each once. A link longer than BUDGET bytes drops the
	// title, then songs from the end. null when the song that is on is not a YouTube video.
	function plan(o) {
		var Sh = getShare(), items = o.items || [], i = o.index | 0, cur = items[i];
		if (!Sh || i < 0 || !YT_ID.test(cur || '')) return null;
		var seen = {}, next = [];
		seen[cur] = true;
		items.slice(i + 1).forEach(function (id) { if (YT_ID.test(id || '') && !seen[id]) { seen[id] = true; next.push(id); } });
		var sec = Math.max(0, Math.floor(+o.sec || 0)), budget = o.budget || BUDGET, title = o.title || '';
		var keep = Math.min(next.length, o.songs == null ? MAX_SONGS : o.songs);
		function make() { return Sh.link([cur].concat(next.slice(0, keep)), title, o.base || '', { id: cur, sec: sec }); }
		var url = make();
		if (utf8(url).length > budget && title) { title = ''; url = make(); }
		while (utf8(url).length > budget && keep > 0) { keep--; url = make(); }
		return { url: url, at: cur, sec: sec, songs: keep + 1, cut: next.length - keep };
	}

	// ---- The dialog ----------------------------------------------------------------------------

	var CSS_ID = 'ts-handoff-css';
	function addCss() {
		var doc = root.document;
		if (!doc || doc.getElementById(CSS_ID)) return;
		var st = doc.createElement('style');
		st.id = CSS_ID;
		st.textContent = '.ts-handoff .ts-modal-body{display:flex;flex-direction:column;gap:14px}' +
			'.ts-handoff-qr{align-self:center;line-height:0;background:#fff;border-radius:10px;box-shadow:0 0 0 1px var(--border)}' +
			'.ts-handoff-qr svg{display:block;max-width:100%;height:auto;border-radius:10px}' +
			'.ts-handoff-line{margin:0;color:var(--text);line-height:1.5}' +
			'.ts-handoff-link{display:flex;gap:8px;align-items:center}' +
			'.ts-handoff-link .kit-input{flex:1;min-width:0;font-size:13px}' +
			'.ts-handoff-note{margin:0}';
		doc.head.appendChild(st);
	}
	function svgNode(code, px) {
		var doc = root.document, el = doc.importNode(new root.DOMParser().parseFromString(svg(code), 'image/svg+xml').documentElement, true);
		el.setAttribute('width', String(px));
		el.setAttribute('height', String(px));
		el.setAttribute('aria-hidden', 'true');
		el.setAttribute('focusable', 'false');
		return el;
	}
	// "Continue on your phone": the code for the song that is on, at the second it is at now.
	function open(ctx) {
		var U = ctx.U, h = ctx.h, w = ctx.words, ctl = ctx.ctl(), p = ctx.player();
		var id = ctl && ctl.current();
		if (!id) { ctx.say('Nothing is playing.'); return null; }
		if (!YT_ID.test(id)) { ctx.say(ctx.demo ? 'The demo songs are invented, so they cannot move to a phone.' : 'This song cannot be opened on another device.'); return null; }
		var st = ctl.state(), t = ctx.trackOf(id);
		var sec = p && p.id && p.id() === id ? p.time().current : 0;
		var loc = root.location, pl = plan({ items: st.items, index: st.index, sec: sec, title: ctx.queueLabel ? ctx.queueLabel() : '', base: loc.origin + loc.pathname });
		var code = pl && qr(pl.url);
		if (!code) { ctx.say('This queue cannot be made into a code.'); return null; }
		addCss();
		var d = U.openDialog({ title: 'Continue on your phone' });
		d.node.classList.add('ts-handoff');
		var box = h('div', { class: 'ts-handoff-qr', role: 'img', aria: { label: 'QR code of the link below' } });
		box.appendChild(svgNode(code, pixels(code.size + 2 * QUIET, root.devicePixelRatio)));
		d.body.appendChild(box);
		d.body.appendChild(h('p', { class: 'ts-handoff-line', text: 'Point the phone\u2019s camera at the code. It opens this queue at ' + w.q(t ? w.title(t) : 'this song') + (pl.sec ? ', ' + w.clock(pl.sec) : '') + '.' }));
		var inp = h('input', { class: 'kit-input', type: 'text', readonly: 'readonly', spellcheck: 'false', value: pl.url, aria: { label: 'The link' } });
		inp.addEventListener('focus', function () { inp.select(); });
		var copy = U.btn({ label: 'Copy link' });
		copy.addEventListener('click', function () {
			function fallback() { inp.focus(); inp.select(); ctx.say('The link is selected: copy it from there.'); }
			var cb = root.navigator && root.navigator.clipboard;
			if (cb && cb.writeText) cb.writeText(pl.url).then(function () { ctx.say('Link copied.'); }, fallback);
			else fallback();
		});
		d.body.appendChild(h('div', { class: 'ts-handoff-link' }, [inp, copy]));
		if (pl.cut) d.body.appendChild(h('p', { class: 'ts-muted ts-handoff-note', text: 'The code holds this song and the next ' + w.n(pl.songs - 1) + ' in the queue; the other ' + w.n(pl.cut) + ' are left out.' }));
		copy.focus();
		return d;
	}

	return {
		plan: plan, qr: qr, svg: svg, pixels: pixels, open: open,
		ecc: ecc, formatBits: formatBits, versionBits: versionBits, capacity: capacity, penalty: penalty,
		MAX_SONGS: MAX_SONGS, MAX_VERSION: MAX_VERSION
	};
});
