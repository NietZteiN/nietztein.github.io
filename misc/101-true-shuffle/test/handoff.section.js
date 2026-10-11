// handoff: the QR code (checked against published values and read back by a small reader
// written here from the standard) and the link for the phone.
module.exports = function (h) {
	var path = require('path');
	var H = require(path.join(h.HERE, 'handoff.js'));
	var Sh = require(path.join(h.HERE, 'share.js'));

	// ---- Published values ---------------------------------------------------------------------
	// Format information, ISO/IEC 18004 table C.1 (as thonky.com lists it), masks 0 to 7.
	var FORMAT = {
		L: '111011111000100 111001011110011 111110110101010 111100010011101 110011000101111 110001100011000 110110001000001 110100101110110',
		M: '101010000010010 101000100100101 101111001111100 101101101001011 100010111111001 100000011001110 100111110010111 100101010100000',
		Q: '011010101011111 011000001101000 011111100110001 011101000000110 010010010110100 010000110000011 010111011011010 010101111101101',
		H: '001011010001001 001001110111110 001110011100111 001100111010000 000011101100010 000001001010101 000110100001100 000100000111011'
	};
	// Version information, table D.1, versions 7 to 40.
	var VERSION = ('000111110010010100 001000010110111100 001001101010011001 001010010011010011 001011101111110110 001100011101100010 001101100001000111 ' +
		'001110011000001101 001111100100101000 010000101101111000 010001010001011101 010010101000010111 010011010100110010 010100100110100110 ' +
		'010101011010000011 010110100011001001 010111011111101100 011000111011000100 011001000111100001 011010111110101011 011011000010001110 ' +
		'011100110000011010 011101001100111111 011110110101110101 011111001001010000 100000100111010101 100001011011110000 100010100010111010 ' +
		'100011011110011111 100100101100001011 100101010000101110 100110101001100100 100111010101000001 101000110001101001').split(' ');
	// Bytes in byte mode, table 7, versions 1 to 40.
	var CAP = {
		L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520, 586, 644, 718, 792, 858, 929, 1003, 1091, 1171, 1273, 1367, 1465, 1528, 1628, 1732, 1840, 1952, 2068, 2188, 2303, 2431, 2563, 2699, 2809, 2953],
		M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666, 711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331]
	};
	// Alignment pattern centres, table E.1.
	var ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
		11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62], 14: [6, 26, 46, 66], 15: [6, 26, 48, 70], 16: [6, 26, 50, 74], 17: [6, 30, 54, 78], 18: [6, 30, 56, 82],
		19: [6, 30, 58, 86], 20: [6, 34, 62, 90], 21: [6, 28, 50, 72, 94], 22: [6, 26, 50, 74, 98], 23: [6, 30, 54, 78, 102], 24: [6, 28, 54, 80, 106],
		25: [6, 32, 58, 84, 110], 32: [6, 34, 60, 86, 112, 138], 40: [6, 30, 58, 86, 114, 142, 170] };
	// Error correction blocks, table 9: [codewords of error correction a block, [blocks, data codewords], ...].
	var BLOCKS = {
		L: { 1: [7, [1, 19]], 2: [10, [1, 34]], 3: [15, [1, 55]], 4: [20, [1, 80]], 5: [26, [1, 108]], 6: [18, [2, 68]], 7: [20, [2, 78]], 8: [24, [2, 97]],
			9: [30, [2, 116]], 10: [18, [2, 68], [2, 69]], 11: [20, [4, 81]], 12: [24, [2, 92], [2, 93]], 13: [26, [4, 107]], 14: [30, [3, 115], [1, 116]],
			15: [22, [5, 87], [1, 88]], 16: [24, [5, 98], [1, 99]], 17: [28, [1, 107], [5, 108]], 18: [30, [5, 120], [1, 121]], 19: [28, [3, 113], [4, 114]],
			20: [28, [3, 107], [5, 108]], 23: [30, [4, 121], [5, 122]], 25: [26, [8, 106], [4, 107]] },
		M: { 1: [10, [1, 16]], 2: [16, [1, 28]], 3: [26, [1, 44]], 4: [18, [2, 32]], 5: [24, [2, 43]], 6: [16, [4, 27]], 7: [18, [4, 31]], 8: [22, [2, 38], [2, 39]],
			9: [22, [3, 36], [2, 37]], 10: [26, [4, 43], [1, 44]], 11: [30, [1, 50], [4, 51]], 12: [22, [6, 36], [2, 37]], 13: [22, [8, 37], [1, 38]],
			14: [24, [4, 40], [5, 41]], 15: [24, [5, 41], [5, 42]], 16: [28, [7, 45], [3, 46]], 17: [28, [10, 46], [1, 47]], 18: [26, [9, 43], [4, 44]],
			19: [26, [3, 44], [11, 45]], 20: [26, [3, 41], [13, 42]], 23: [28, [4, 47], [14, 48]], 25: [28, [8, 47], [13, 48]] }
	};

	// ---- A small reader, from the standard ------------------------------------------------------
	var EXP = [], LOG = [];
	(function () { var x = 1; for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x = x << 1 ^ (x & 0x80 ? 0x11D : 0); } })();
	function gmul(a, b) { return a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0; }
	// c(alpha^s) for s below n: all zero for a Reed-Solomon codeword with n check symbols.
	function syndromesZero(cw, n) {
		for (var s = 0; s < n; s++) { var acc = 0; for (var i = 0; i < cw.length; i++) acc = gmul(acc, EXP[s]) ^ cw[i]; if (acc) return false; }
		return true;
	}
	var MASK = [ // i is the row, j the column, as the standard writes them
		function (i, j) { return (i + j) % 2 === 0; }, function (i) { return i % 2 === 0; }, function (i, j) { return j % 3 === 0; },
		function (i, j) { return (i + j) % 3 === 0; }, function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; },
		function (i, j) { return i * j % 2 + i * j % 3 === 0; }, function (i, j) { return (i * j % 2 + i * j % 3) % 2 === 0; },
		function (i, j) { return ((i + j) % 2 + i * j % 3) % 2 === 0; }
	];
	// Where the format information's bits 14 down to 0 go: [x, y] for the copy by the top-left
	// finder, or the one split between the other two.
	function formatPlaces(size, second) {
		var pos = [], i;
		if (!second) {
			for (i = 0; i <= 5; i++) pos.push([8, i]);
			pos.push([8, 7], [8, 8], [7, 8]);
			for (i = 9; i < 15; i++) pos.push([14 - i, 8]);
		} else {
			for (i = 0; i < 8; i++) pos.push([size - 1 - i, 8]);
			for (i = 8; i < 15; i++) pos.push([8, size - 15 + i]);
		}
		return pos.reverse();
	}
	function readFormat(rows, second) {
		return formatPlaces(rows.length, second).map(function (p) { return rows[p[1]][p[0]] ? '1' : '0'; }).join('');
	}
	function writeFormat(rows, s) {
		[false, true].forEach(function (second) { formatPlaces(rows.length, second).forEach(function (p, k) { rows[p[1]][p[0]] = s.charAt(k) === '1'; }); });
	}
	// The modules that are not data: finders with their separators and the format areas, timing,
	// alignment (the published centres), the version areas.
	function functionMap(size) {
		var v = (size - 17) / 4, fixed = [], x, y, i, j;
		for (y = 0; y < size; y++) { fixed.push([]); for (x = 0; x < size; x++) fixed[y].push(false); }
		function mark(x0, y0, w, hh) { for (var yy = y0; yy < y0 + hh; yy++) for (var xx = x0; xx < x0 + w; xx++) fixed[yy][xx] = true; }
		mark(0, 0, 9, 9); mark(size - 8, 0, 8, 9); mark(0, size - 8, 9, 8);
		mark(6, 0, 1, size); mark(0, 6, size, 1);
		var al = ALIGN[v], n = al.length;
		for (i = 0; i < n; i++) for (j = 0; j < n; j++) if (!((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0))) mark(al[i] - 2, al[j] - 2, 5, 5);
		if (v >= 7) { mark(size - 11, 0, 3, 6); mark(0, size - 11, 6, 3); }
		return fixed;
	}
	function readVersion(rows, second) {
		var size = rows.length, s = '';
		for (var i = 17; i >= 0; i--) { var a = size - 11 + i % 3, b = Math.floor(i / 3); s += (second ? rows[a][b] : rows[b][a]) ? '1' : '0'; }
		return s;
	}
	function read(rows) {
		var size = rows.length, v = (size - 17) / 4, fixed = functionMap(size), x, y, i, j;
		var f = readFormat(rows, false), level = null, mask = -1;
		Object.keys(FORMAT).forEach(function (lv) { FORMAT[lv].split(' ').forEach(function (s, m) { if (s === f) { level = lv; mask = m; } }); });
		if (!level) return { error: 'format' };
		var bits = [], up = true;
		for (var col = size - 1; col > 0; col -= 2) {
			if (col === 6) col--;
			for (var k = 0; k < size; k++) {
				y = up ? size - 1 - k : k;
				for (var c = 0; c < 2; c++) { x = col - c; if (!fixed[y][x]) bits.push(rows[y][x] !== MASK[mask](y, x) ? 1 : 0); }
			}
			up = !up;
		}
		var words = [];
		for (i = 0; i + 8 <= bits.length; i += 8) { var b = 0; for (j = 0; j < 8; j++) b = b << 1 | bits[i + j]; words.push(b); }
		var t = BLOCKS[level][v], ec = t[0], sizes = [];
		t.slice(1).forEach(function (g) { for (var q = 0; q < g[0]; q++) sizes.push(g[1]); });
		var total = sizes.reduce(function (a, s2) { return a + s2 + ec; }, 0);
		if (total !== words.length) return { error: 'codewords ' + words.length + ', the table says ' + total };
		var blocks = sizes.map(function () { return []; }), at = 0, most = Math.max.apply(null, sizes);
		for (i = 0; i < most; i++) for (j = 0; j < sizes.length; j++) if (i < sizes[j]) blocks[j].push(words[at++]);
		for (i = 0; i < ec; i++) for (j = 0; j < sizes.length; j++) blocks[j].push(words[at++]);
		if (!blocks.every(function (bl) { return syndromesZero(bl, ec); })) return { error: 'a block is not a codeword' };
		var data = [];
		blocks.forEach(function (bl, q) { data = data.concat(bl.slice(0, sizes[q])); });
		var stream = '';
		data.forEach(function (d) { stream += ('0000000' + d.toString(2)).slice(-8); });
		if (stream.slice(0, 4) !== '0100') return { error: 'not byte mode' };
		var cb = v < 10 ? 8 : 16, len = parseInt(stream.slice(4, 4 + cb), 2), out = [];
		for (i = 0; i < len; i++) out.push(parseInt(stream.substr(4 + cb + 8 * i, 8), 2));
		// then up to four 0s, 0s to the byte, and the pad codewords 11101100 and 00010001 in turn
		var end = 4 + cb + 8 * len, tail = '0000'.slice(0, Math.min(4, stream.length - end));
		while ((end + tail.length) % 8) tail += '0';
		for (var pad = 0; end + tail.length < stream.length; pad++) tail += pad % 2 ? '00010001' : '11101100';
		if (stream.slice(end) !== tail) return { error: 'the terminator or the padding' };
		return { text: Buffer.from(out).toString('utf8'), version: v, level: level, mask: mask };
	}

	// The four penalties written the plain way, for comparing.
	function refPenalty(rows) {
		var n = rows.length, lines = [], score = 0, dark = 0, y, x;
		for (y = 0; y < n; y++) { var r = '', c = ''; for (x = 0; x < n; x++) { r += rows[y][x] ? 1 : 0; c += rows[x][y] ? 1 : 0; } lines.push(r, c); }
		lines.forEach(function (l) {
			(l.match(/0{5,}|1{5,}/g) || []).forEach(function (run) { score += 3 + run.length - 5; });
			for (var i = 0; i + 11 <= l.length; i++) { var w = l.substr(i, 11); if (w === '10111010000' || w === '00001011101') score += 40; }
		});
		for (y = 0; y + 1 < n; y++) for (x = 0; x + 1 < n; x++) { var s = rows[y][x] + rows[y][x + 1] + rows[y + 1][x] + rows[y + 1][x + 1]; if (s === 0 || s === 4) score += 3; }
		rows.forEach(function (row) { row.forEach(function (m) { if (m) dark++; }); });
		var p = dark * 100 / (n * n), k = 0;
		while (!(Math.abs(p - 50) < 5 * (k + 1))) k++;   // 50 +/- 5k% up to 50 +/- 5(k+1)%
		return score + 10 * k;
	}
	function ascii(len, seed) {
		var CH = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~:/?#&=%', s = '';
		for (var i = 0; i < len; i++) s += CH.charAt((i * 7 + seed * 13 + i * i % 11) % CH.length);
		return s;
	}
	function bits(nb, len) { return ('000000000000000000' + nb.toString(2)).slice(-len); }

	h.describe('handoff', function () {
		// Reed-Solomon: thonky.com's HELLO WORLD at 1-M and 1-Q, and ISO/IEC 18004 annex I's 01234567 at 1-M.
		h.eq(H.ecc([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23], 'ecc: HELLO WORLD 1-M, as thonky.com works it out');
		h.eq(H.ecc([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236], 13), [168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16], 'ecc: HELLO WORLD 1-Q, as thonky.com works it out');
		h.eq(H.ecc([0x10, 0x20, 0x0C, 0x56, 0x61, 0x80, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11], 10), [0xA5, 0x24, 0xD4, 0xC1, 0xED, 0x36, 0xC7, 0x87, 0x2C, 0x55], 'ecc: 01234567 1-M, ISO/IEC 18004 annex I');
		var fmtBad = [];
		Object.keys(FORMAT).forEach(function (lv) { FORMAT[lv].split(' ').forEach(function (s, m) { if (bits(H.formatBits(lv, m), 15) !== s) fmtBad.push(lv + m); }); });
		h.eq(fmtBad, [], 'formatBits: all 32 published strings (levels L, M, Q, H; masks 0 to 7)');
		h.eq(VERSION.filter(function (s, i) { return bits(H.versionBits(i + 7), 18) !== s; }), [], 'versionBits: all 34 published strings (versions 7 to 40)');
		var capBad = [];
		['L', 'M'].forEach(function (lv) { CAP[lv].forEach(function (c, i) { if (H.capacity(i + 1, lv) !== c) capBad.push(lv + (i + 1) + ': ' + H.capacity(i + 1, lv)); }); });
		h.eq(capBad, [], 'capacity: the published byte-mode capacities, versions 1 to 40 at L and M');

		// The patterns where the standard puts them.
		var shape = [];
		[1, 2, 7, 14, 20, 21, 23, 25, 32, 40].forEach(function (v) {
			var code = H.qr(ascii(H.capacity(v, 'M'), v), { level: 'M' }), r = code.rows, n = code.size;
			if (code.version !== v || n !== 4 * v + 17) { shape.push(v + ': version or size'); return; }
			[[0, 0], [n - 7, 0], [0, n - 7]].forEach(function (c) {
				for (var dy = -1; dy <= 7; dy++) for (var dx = -1; dx <= 7; dx++) {
					var x = c[0] + dx, y = c[1] + dy;
					if (x < 0 || y < 0 || x >= n || y >= n) continue;
					var d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3)), want = d !== 2 && d !== 4;
					if (r[y][x] !== want) shape.push(v + ': finder at ' + c);
				}
			});
			for (var i = 8; i < n - 8; i++) if (r[6][i] !== (i % 2 === 0) || r[i][6] !== (i % 2 === 0)) shape.push(v + ': timing at ' + i);
			if (!r[n - 8][8]) shape.push(v + ': the dark module');
			var al = ALIGN[v], k = al.length;
			for (var a = 0; a < k; a++) for (var b = 0; b < k; b++) {
				if ((a === 0 && b === 0) || (a === 0 && b === k - 1) || (a === k - 1 && b === 0)) continue;
				for (var ey = -2; ey <= 2; ey++) for (var ex = -2; ex <= 2; ex++) if (r[al[b] + ey][al[a] + ex] !== (Math.max(Math.abs(ex), Math.abs(ey)) !== 1)) shape.push(v + ': alignment at ' + al[a] + ',' + al[b]);
			}
			var f = bits(H.formatBits('M', code.mask), 15);
			if (readFormat(r, false) !== f || readFormat(r, true) !== f) shape.push(v + ': format information');
			if (v >= 7 && (readVersion(r, false) !== VERSION[v - 7] || readVersion(r, true) !== VERSION[v - 7])) shape.push(v + ': version information');
		});
		h.eq(shape, [], 'qr: finders, separators, timing, the dark module, alignment at the published centres (version 23: 78, not 74), both copies of the format and version information');

		// Round trips through the reader above, at the first and last length of each version.
		['M', 'L'].forEach(function (lv) {
			var bad = [], n = 0;
			Object.keys(BLOCKS[lv]).map(Number).forEach(function (v) {
				[v === 1 ? 0 : H.capacity(v - 1, lv) + 1, H.capacity(v, lv)].forEach(function (len) {
					var t = ascii(len, v), code = H.qr(t, { level: lv }), back = read(code.rows);
					n++;
					if (code.version !== v || back.text !== t || back.level !== lv || back.mask !== code.mask) bad.push(lv + v + ' (' + len + ' bytes): ' + (back.error || 'made version ' + code.version));
				});
			});
			h.eq(bad, [], 'qr: ' + n + ' codes at level ' + lv + ', from one byte past a version to its last byte, read back by the reader (each block a Reed-Solomon codeword)');
		});
		var words = 'Caf' + String.fromCharCode(0xE9) + ' ' + String.fromCharCode(0x6771, 0x4EAC, 0x30FB) + String.fromCharCode(0xD83C, 0xDFB5);
		h.eq(read(H.qr(words).rows).text, words, 'qr: text that is not ASCII goes as UTF-8');

		// The level, and what does not fit.
		var c14 = H.qr(ascii(14, 1)), c15 = H.qr(ascii(15, 1)), l1 = H.qr(ascii(16, 1), { maxVersion: 1 });
		h.eq([c14.version, c14.level, c15.version, c15.level, l1.version, l1.level], [1, 'M', 2, 'M', 1, 'L'], 'qr: level M in the smallest version; L only when M does not fit within maxVersion');
		h.eq([H.qr(ascii(18, 1), { maxVersion: 1 }), H.qr(ascii(2954, 1)), H.qr('').version], [null, null, 1], 'qr: too long for maxVersion at L, or for version 40: null; an empty text is a version 1 code');
		h.eq([c14.dark(-1, 0), c14.dark(0, 0), c14.dark(c14.size, 0), c14.dark(3, 3)], [false, true, false, true], 'qr: dark(x, y), light outside the code');

		// The penalty, and the mask it picks.
		var allLight = [], checker = [];
		for (var y = 0; y < 5; y++) { allLight.push([false, false, false, false, false]); }
		for (y = 0; y < 6; y++) { checker.push([]); for (var x = 0; x < 6; x++) checker[y].push((x + y) % 2 === 0); }
		h.eq([H.penalty(allLight), H.penalty(checker)], [30 + 48 + 100, 0], 'penalty: five light rows and columns (30), sixteen 2x2 blocks (48), no dark at all (100); a checkerboard, none');
		var seed = 7, rnd = function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }, diff = [];
		for (var t = 0; t < 40; t++) {
			var n = 15 + t % 20, m = [], bias = 0.3 + 0.4 * rnd();
			for (y = 0; y < n; y++) { m.push([]); for (x = 0; x < n; x++) m[y].push(rnd() < bias); }
			if (t % 5 === 0) { var row = '00001011101000010111010000'.slice(0, n); for (x = 0; x < n; x++) m[t % n][x] = row.charAt(x) === '1'; }
			if (H.penalty(m) !== refPenalty(m)) diff.push(n + ': ' + H.penalty(m) + ' vs ' + refPenalty(m));
		}
		h.eq(diff, [], 'penalty: the same as the rules written the plain way, on 40 random matrices (some with finder-like rows)');
		// Undo the chosen mask, put each of the eight on with its own format information, score them
		// the plain way: the one chosen scores lowest (the first of equals).
		var notBest = [];
		[1, 3, 9, 14, 20, 25].forEach(function (v) {
			[0, 1, 2].forEach(function (k) {
				var code = H.qr(ascii(H.capacity(v, 'M') - k * 3, v + k), { level: 'M' }), fixed = functionMap(code.size), um = MASK[code.mask];
				var raw = code.rows.map(function (r, y) { return r.map(function (on, x) { return fixed[y][x] ? on : on !== um(y, x); }); });
				var scores = MASK.map(function (fn, mk) {
					var rows = raw.map(function (r, y) { return r.map(function (on, x) { return fixed[y][x] ? on : on !== fn(y, x); }); });
					writeFormat(rows, FORMAT.M.split(' ')[mk]);
					return refPenalty(rows);
				});
				if (scores.indexOf(Math.min.apply(null, scores)) !== code.mask) notBest.push('version ' + v + ': chose ' + code.mask + ' of ' + scores.join(' '));
			});
		});
		h.eq(notBest, [], 'qr: the mask with the lowest penalty, in 18 codes from version 1 to 25');

		// Drawing.
		var code = H.qr('https://x.test/'), s = H.svg(code), side = code.size + 8;
		var drawn = 0, darkCount = 0;
		(s.match(/h\d+/g) || []).forEach(function (run) { drawn += +run.slice(1); });
		code.rows.forEach(function (r) { r.forEach(function (on) { if (on) darkCount++; }); });
		h.ok(s.indexOf('viewBox="0 0 ' + side + ' ' + side + '"') > 0 && s.indexOf('width="' + side * 4 + '"') > 0 && s.indexOf('<rect width="' + side + '" height="' + side + '" fill="#fff"/>') > 0 && s.indexOf('<path fill="#000"') > 0, 'svg: black on a white square with a four-module quiet zone, 4 px a module unless asked');
		h.eq(drawn, darkCount, 'svg: every dark module drawn once (' + darkCount + ')');
		h.ok(H.svg(code, { scale: 2, margin: 0 }).indexOf('viewBox="0 0 ' + code.size + ' ' + code.size + '" width="' + code.size * 2 + '"') > 0, 'svg: scale and margin');
		h.eq([H.pixels(105, 1), H.pixels(105, 2), H.pixels(105, 1.25), H.pixels(37, 1), H.pixels(185, 1)], [315, 262.5, 252, 259, 370], 'pixels: at least 240, a whole number of screen pixels a module, at least two');

		// The link for the phone.
		var ids = [];
		for (var i = 0; i < 60; i++) ids.push(('song' + i + '_abcdefgh').slice(0, 11));
		var base = 'https://nietztein.github.io/misc/101-true-shuffle/';
		var pl = H.plan({ items: ids, index: 5, sec: 151.8, title: 'Late night & rain', base: base });
		var back = Sh.decode(new URLSearchParams(pl.url.split('?')[1]));
		h.eq([pl.url.indexOf(base + '#/share?ids=' + ids[5] + '.'), pl.at, pl.sec, pl.songs, pl.cut], [0, ids[5], 151, H.MAX_SONGS + 1, 55 - H.MAX_SONGS - 1], 'plan: the song that is on, at the whole second, and the next ' + H.MAX_SONGS + '; the rest left out');
		h.eq([back.ids, back.title, back.start], [ids.slice(5, 6 + H.MAX_SONGS), 'Late night & rain', { id: ids[5], index: 0, sec: 151 }], 'plan: the phone reads back the same songs, title, song and second');
		var big = H.qr(pl.url);
		h.ok(big.version <= H.MAX_VERSION && big.level === 'M', 'plan: a full link is a version ' + big.version + ' code at level M (at most ' + H.MAX_VERSION + ')');
		var cjk = '';
		for (i = 0; i < 120; i++) cjk += String.fromCharCode(0x6771 + i % 7);
		var pc = H.plan({ items: ids, index: 0, sec: 10, title: cjk, base: base });
		h.ok(Buffer.byteLength(pc.url) <= H.capacity(H.MAX_VERSION, 'M') && pc.songs === H.MAX_SONGS + 1 && pc.url.indexOf('&t=') < 0, 'plan: a title too long for the code is dropped before any song');
		var tight = H.plan({ items: ids, index: 0, sec: 10, title: 'A', base: base, budget: 200 });
		h.ok(Buffer.byteLength(tight.url) <= 200 && tight.url.indexOf('&t=') < 0 && tight.songs + tight.cut === 60 && tight.songs < H.MAX_SONGS + 1, 'plan: under a smaller budget the title goes, then songs from the end (' + tight.songs + ' kept)');
		var dup = H.plan({ items: ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'demo-001', 'bbbbbbbbbbb', 'ccccccccccc', 'aaaaaaaaaaa'], index: 0, sec: 0, base: '' });
		h.eq([dup.url, dup.songs, dup.cut], ['#/share?ids=aaaaaaaaaaa.bbbbbbbbbbb.ccccccccccc&at=aaaaaaaaaaa', 3, 0], 'plan: each song once, what is not a YouTube video left out, no seconds at the beginning, no title');
		h.eq([H.plan({ items: ['demo-001', 'aaaaaaaaaaa'], index: 0 }), H.plan({ items: ['aaaaaaaaaaa'], index: -1 }), H.plan({ items: ['aaaaaaaaaaa'], index: 1 }), H.plan({ items: [], index: 0 })], [null, null, null, null], 'plan: nothing that is on, or a demo song: null');
		var last = H.plan({ items: ['aaaaaaaaaaa'], index: 0, sec: 3, base: '' });
		h.eq([last.songs, last.cut, Sh.decode(new URLSearchParams(last.url.split('?')[1])).start], [1, 0, { id: 'aaaaaaaaaaa', index: 0, sec: 3 }], 'plan: the last song of the queue alone');
	});
};
