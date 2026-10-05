// Tests of the Japanese data kit (misc/_lang). No network, no dependencies:
//   node misc/_lang/test.js
// Prints one PASS or FAIL line per check; exit code 1 if anything failed.
//
// What is checked: every data file loads as a plain script and sets its one
// global; its shape and counts; that every string is in the script it should
// be in (no mojibake); the properties each dataset promises (the kimariji,
// the kanji components, the ruby offsets, the accents); and that README.md
// and LICENSES.md state the sizes, hashes and credit lines the files carry.

'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var dir = __dirname;
var failures = 0;
var passes = 0;

function check(name, fn) {
	var problem = null;
	try {
		problem = fn();
	} catch (err) {
		problem = 'threw ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err);
	}
	if (problem) {
		failures++;
		console.log('FAIL ' + name + ': ' + problem);
	} else {
		passes++;
		console.log('PASS ' + name);
	}
}
// Returns a description of the first few items for which `test` gives a
// problem, or null when there is none.
function firstProblems(list, test) {
	var found = [];
	for (var i = 0; i < list.length; i++) {
		var p = test(list[i], i);
		if (p) {
			found.push(p);
			if (found.length >= 4) break;
		}
	}
	return found.length ? found.join('; ') : null;
}

// ---- character classes ----------------------------------------------------------

function isKanjiCp(cp) {
	return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x20000 && cp <= 0x323af) || (cp >= 0xf900 && cp <= 0xfaff);
}
function isHiraganaCp(cp) {
	return (cp >= 0x3041 && cp <= 0x3096) || cp === 0x309d || cp === 0x309e;
}
function isKatakanaCp(cp) {
	return (cp >= 0x30a1 && cp <= 0x30fa) || cp === 0x30fc || cp === 0x30fd || cp === 0x30fe;
}
function isKanaCp(cp) {
	return isHiraganaCp(cp) || isKatakanaCp(cp);
}
// English as the dictionaries write it: ASCII, accented Latin letters, curly quotes, dashes.
function isLatinCp(cp) {
	return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0x24f) || (cp >= 0x2010 && cp <= 0x2027) || cp === 0x2032 || cp === 0x2033;
}
function every(str, test) {
	if (typeof str !== 'string' || !str.length) return false;
	var chars = Array.from(str);
	for (var i = 0; i < chars.length; i++) if (!test(chars[i].codePointAt(0), chars[i])) return false;
	return true;
}
function oneChar(str) {
	return typeof str === 'string' && Array.from(str).length === 1;
}
var IDEOGRAPHIC_SPACE = 0x3000;
var KANJI_ITER = 0x3005; // the kanji repetition mark

// ---- loading ------------------------------------------------------------------------

var FILES = [
	['hyakunin.js', 'LANG_HYAKUNIN'],
	['kanji.js', 'LANG_KANJI'],
	['kanji-grades.js', 'LANG_KANJI_GRADES'],
	['jmdict-core.js', 'LANG_JMDICT'],
	['jmdict-tech.js', 'LANG_JMDICT_TECH'],
	['accents.js', 'LANG_ACCENT'],
	['freq-ja.js', 'LANG_FREQ_JA'],
	['texts/yume-juya-1.js', 'LANG_TEXT_YUMEJUYA1'],
];

var readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
var licenses = fs.readFileSync(path.join(dir, 'LICENSES.md'), 'utf8').replace(/\r\n/g, '\n');
var statedSizes = {};
readme.replace(/^\| `([^`]+)` \| `([^`]+)` \| ([\d,]+) \|/gm, function (m, file, global, bytes) {
	statedSizes[file] = { global: global, bytes: +bytes.replace(/,/g, '') };
	return m;
});

var data = {};
FILES.forEach(function (entry) {
	var file = entry[0];
	var globalName = entry[1];
	var full = path.join(dir, file);
	var raw = null;
	check(file + ': is UTF-8 without a byte-order mark or replacement characters', function () {
		var buf = fs.readFileSync(full);
		raw = new TextDecoder('utf-8', { fatal: true }).decode(buf);
		if (raw.charCodeAt(0) === 0xfeff) return 'starts with a byte-order mark';
		if (raw.indexOf(String.fromCharCode(0xfffd)) >= 0) return 'holds U+FFFD';
		return null;
	});
	if (raw === null) return;
	// Git on Windows may check the file out with CRLF line ends. What the site
	// serves, and what the README states, is the file with LF.
	var served = raw.replace(/\r\n/g, '\n');
	check(file + ': loads in a vm sandbox and sets window.' + globalName + ' and nothing else', function () {
		var sandbox = { window: {} };
		vm.runInNewContext(raw, sandbox, { filename: full });
		var set = Object.keys(sandbox.window);
		if (set.length !== 1 || set[0] !== globalName) return 'window got ' + JSON.stringify(set);
		if (Object.keys(sandbox).length !== 1) return 'the script leaked ' + Object.keys(sandbox).join(', ');
		data[file] = JSON.parse(JSON.stringify(sandbox.window[globalName]));
		return null;
	});
	check(file + ': require() gives the same object', function () {
		var viaRequire = require(full);
		return JSON.stringify(viaRequire) === JSON.stringify(data[file]) ? null : 'module.exports differs from the global';
	});
	check(file + ': its size is what README.md says', function () {
		var stated = statedSizes[file];
		if (!stated) return 'README.md has no table row for it';
		if (stated.global !== globalName) return 'README.md names the global ' + stated.global;
		var bytes = Buffer.byteLength(served, 'utf8');
		return bytes === stated.bytes ? null : 'the file is ' + bytes + ' bytes (with LF line ends), README.md says ' + stated.bytes;
	});
	check(file + ': meta has sources with hashes, a licence, a credit, kept and dropped', function () {
		var meta = data[file] && data[file].meta;
		if (!meta) return 'no meta';
		if (!Array.isArray(meta.sources) || !meta.sources.length) return 'no sources';
		var bad = firstProblems(meta.sources, function (s) {
			if (!/^https?:\/\//.test(s.url)) return 'source without a url';
			if (!/^[0-9a-f]{64}$/.test(s.sha256)) return 'source without a sha256: ' + s.url;
			if (!/^\d{4}-\d{2}-\d{2}$/.test(s.fetched)) return 'source without a fetch date: ' + s.url;
			return null;
		});
		if (bad) return bad;
		if (typeof meta.licence !== 'string' || meta.licence.length < 10) return 'no licence';
		if (typeof meta.credit !== 'string' || meta.credit.length < 20) return 'no credit';
		if (!meta.kept || typeof meta.kept !== 'object') return 'no kept';
		if (!Array.isArray(meta.dropped) || !meta.dropped.length) return 'no dropped';
		return null;
	});
	check(file + ': README.md and LICENSES.md carry its credit line and LICENSES.md its source hashes', function () {
		var meta = data[file].meta;
		if (readme.indexOf(meta.credit) < 0) return 'README.md does not hold the credit line word for word';
		if (licenses.indexOf(meta.credit) < 0) return 'LICENSES.md does not hold the credit line word for word';
		return firstProblems(meta.sources, function (s) {
			if (licenses.indexOf(s.sha256) < 0) return 'LICENSES.md lacks the sha256 of ' + s.url;
			if (licenses.indexOf(s.url) < 0) return 'LICENSES.md lacks the url ' + s.url;
			return null;
		});
	});
});
check('README.md and LICENSES.md quote Japanese only from the data files (nothing in them was typed from memory)', function () {
	var corpus = FILES.map(function (f) {
		return fs.readFileSync(path.join(dir, f[0]), 'utf8');
	}).join('\n');
	var japanese = function (cp) {
		return isKanjiCp(cp) || isKanaCp(cp) || cp === KANJI_ITER || (cp >= 0x2e80 && cp <= 0x2fdf) || (cp >= 0xff10 && cp <= 0xff5a);
	};
	var missing = [];
	[['README.md', readme], ['LICENSES.md', licenses]].forEach(function (doc) {
		var run = '';
		Array.from(doc[1] + '\n').forEach(function (ch) {
			if (japanese(ch.codePointAt(0))) run += ch;
			else {
				if (run && corpus.indexOf(run) < 0 && missing.length < 5) missing.push(doc[0] + ': ' + run);
				run = '';
			}
		});
	});
	return missing.length ? missing.join('; ') : null;
});
check('README.md lists exactly the data files', function () {
	var listed = Object.keys(statedSizes).sort().join(' ');
	var expected = FILES.map(function (f) {
		return f[0];
	})
		.sort()
		.join(' ');
	return listed === expected ? null : 'README.md lists ' + listed;
});

var H = data['hyakunin.js'];
var K = data['kanji.js'];
var G = data['kanji-grades.js'];
var J = data['jmdict-core.js'];
var T = data['jmdict-tech.js'];
var A = data['accents.js'];
var F = data['freq-ja.js'];
var Y = data['texts/yume-juya-1.js'];

// ---- hyakunin.js -------------------------------------------------------------------

if (H) {
	var poems = H.poems;
	check('hyakunin: 100 poems numbered 1 to 100, every field a string, none missing', function () {
		if (!Array.isArray(poems) || poems.length !== 100) return 'poems: ' + (poems && poems.length);
		if (H.meta.kept.poems !== 100) return 'meta.kept.poems is ' + H.meta.kept.poems;
		var fields = ['poet', 'poetKana', 'text', 'kana', 'kami', 'shimo', 'kimariji', 'romaji', 'en', 'poetRomaji', 'poetEn', 'anthology'];
		return firstProblems(poems, function (p, i) {
			if (p.n !== i + 1) return 'poem at index ' + i + ' has n ' + p.n;
			for (var f = 0; f < fields.length; f++) if (typeof p[fields[f]] !== 'string' || !p[fields[f]]) return 'poem ' + p.n + ' has no ' + fields[f];
			return null;
		});
	});
	check('hyakunin: text and reading have five phrases (three and two), halves agree with the whole', function () {
		return firstProblems(poems, function (p) {
			if (p.text.split(' ').length !== 5) return 'poem ' + p.n + ' text has ' + p.text.split(' ').length + ' phrases';
			if (p.kana.split(' ').length !== 5) return 'poem ' + p.n + ' kana has ' + p.kana.split(' ').length + ' phrases';
			if (p.kami.split(' ').length !== 3 || p.shimo.split(' ').length !== 2) return 'poem ' + p.n + ' halves';
			if (p.kami + ' ' + p.shimo !== p.kana) return 'poem ' + p.n + ': kami + shimo is not kana';
			return null;
		});
	});
	check('hyakunin: scripts (text in kanji and hiragana, readings in hiragana, poets in kanji, Porter in Latin letters)', function () {
		var textOk = function (cp) {
			return isKanjiCp(cp) || isHiraganaCp(cp) || cp === KANJI_ITER || cp === 0x20;
		};
		var kanaOk = function (cp) {
			return isHiraganaCp(cp) || cp === 0x20;
		};
		var latinLines = function (cp) {
			return isLatinCp(cp) || cp === 0x0a;
		};
		return firstProblems(poems, function (p) {
			if (!every(p.text, textOk)) return 'poem ' + p.n + ' text';
			if (!every(p.kana, kanaOk)) return 'poem ' + p.n + ' kana';
			if (!every(p.poet, isKanjiCp)) return 'poem ' + p.n + ' poet';
			if (!every(p.poetKana, isHiraganaCp)) return 'poem ' + p.n + ' poetKana';
			if (!every(p.romaji, latinLines) || !every(p.en, latinLines)) return 'poem ' + p.n + ' romaji or en';
			if (!every(p.poetRomaji, isLatinCp) || !every(p.poetEn, isLatinCp)) return 'poem ' + p.n + ' poet in Latin letters';
			if (p.romaji.split('\n').length !== 5 || p.en.split('\n').length !== 5) return 'poem ' + p.n + ' romaji or en is not five lines';
			if (!every(p.anthology, function (cp) { return isKanjiCp(cp) || (cp >= 0x30 && cp <= 0x39); })) return 'poem ' + p.n + ' anthology';
			return null;
		});
	});

	// The kimariji, computed again here from the readings alone.
	var ITER = String.fromCharCode(0x309d);
	var ITER_VOICED = String.fromCharCode(0x309e);
	var writtenOut = function (kana) {
		var out = '';
		for (var i = 0; i < kana.length; i++) {
			var ch = kana[i];
			if (ch === ITER) out += out[out.length - 1];
			else if (ch === ITER_VOICED) out += String.fromCharCode(out.charCodeAt(out.length - 1) + 1);
			else out += ch;
		}
		return out;
	};
	// Read aloud: wo, wi, we sound like o, i, e; an opening a-fu or o-ho is a long o.
	var heard = function (kana) {
		var s = writtenOut(kana).replace(/を/g, 'お').replace(/ゐ/g, 'い').replace(/ゑ/g, 'え');
		if (s.indexOf('あふ') === 0 || s.indexOf('おほ') === 0) s = 'おお' + s.slice(2);
		return s;
	};
	var uniquePrefixLengths = function (keys) {
		return keys.map(function (key, i) {
			for (var len = 1; len <= key.length; len++) {
				var prefix = key.slice(0, len);
				var shared = false;
				for (var j = 0; j < keys.length; j++) {
					if (j !== i && keys[j].indexOf(prefix) === 0) {
						shared = true;
						break;
					}
				}
				if (!shared) return len;
			}
			return -1;
		});
	};
	var histogramOf = function (lengths) {
		var h = {};
		lengths.forEach(function (len) {
			h[len] = (h[len] || 0) + 1;
		});
		return h;
	};
	var flat = poems.map(function (p) {
		return p.kana.replace(/ /g, '');
	});
	var heardLengths = uniquePrefixLengths(flat.map(heard));
	var spelledLengths = uniquePrefixLengths(flat.map(writtenOut));
	var PUBLISHED = { 1: 7, 2: 42, 3: 37, 4: 6, 5: 2, 6: 6 };

	check('hyakunin: each kimariji is the shortest prefix of the reading that no other poem shares when read aloud', function () {
		return firstProblems(poems, function (p, i) {
			if (flat[i].indexOf(p.kimariji) !== 0) return 'poem ' + p.n + ': ' + p.kimariji + ' is not a prefix of its reading';
			if (p.kimariji.length !== heardLengths[i]) return 'poem ' + p.n + ': kimariji ' + p.kimariji + ', computed length ' + heardLengths[i];
			return null;
		});
	});
	check('hyakunin: the seven one-kana cards are mu, su, me, fu, sa, ho, se', function () {
		var one = poems
			.filter(function (p) {
				return p.kimariji.length === 1;
			})
			.map(function (p) {
				return p.kimariji;
			})
			.sort()
			.join('');
		var expected = ['む', 'す', 'め', 'ふ', 'さ', 'ほ', 'せ'].sort().join('');
		return one === expected ? null : 'one-kana cards: ' + one;
	});
	check('hyakunin: kimariji lengths are 7, 42, 37, 6, 2, 6 for one to six kana, the count published for competitive karuta', function () {
		var h = histogramOf(
			poems.map(function (p) {
				return p.kimariji.length;
			})
		);
		if (JSON.stringify(h) !== JSON.stringify(PUBLISHED)) return 'histogram ' + JSON.stringify(h);
		if (JSON.stringify(H.meta.kimariji.histogram) !== JSON.stringify(PUBLISHED)) return 'meta histogram';
		return null;
	});
	check('hyakunin: the list published in Japanese Wikipedia has the same histogram and, poem by poem, the same lengths', function () {
		var list = H.published.bySound;
		if (!Array.isArray(list) || list.length !== 100) return 'published.bySound has ' + (list && list.length) + ' entries';
		if (JSON.stringify(histogramOf(list.map(function (s) { return s.length; }))) !== JSON.stringify(PUBLISHED)) return 'the published list has another histogram';
		return firstProblems(poems, function (p, i) {
			if (!every(list[i], isHiraganaCp)) return 'published kimariji of poem ' + p.n + ' is not hiragana';
			if (list[i].length !== p.kimariji.length) return 'poem ' + p.n + ': ' + p.kimariji + ' against published ' + list[i];
			if (heard(list[i]).charAt(0) !== heard(p.kimariji).charAt(0)) return 'poem ' + p.n + ' starts with another sound than the published ' + list[i];
			return null;
		});
	});
	check('hyakunin: the bold prefixes on the Wikisource page agree, except poem 44 (printed by spelling, a-fu)', function () {
		var bold = H.published.wikisource;
		if (!Array.isArray(bold) || bold.length !== 100) return 'published.wikisource has ' + (bold && bold.length) + ' entries';
		var differ = poems
			.filter(function (p, i) {
				return bold[i] !== p.kimariji;
			})
			.map(function (p) {
				return p.n;
			});
		return JSON.stringify(differ) === '[44]' ? null : 'differs for poems ' + JSON.stringify(differ);
	});
	check('hyakunin: compared by spelling alone, exactly poems 26 and 44 would be decided one kana earlier', function () {
		var differ = poems
			.filter(function (p, i) {
				return spelledLengths[i] !== heardLengths[i];
			})
			.map(function (p, i) {
				return p.n + ':' + (heardLengths[p.n - 1] - spelledLengths[p.n - 1]);
			});
		return JSON.stringify(differ) === '["26:1","44:1"]' ? null : JSON.stringify(differ);
	});

	// What was taken from the second source, what was left as a variant, and
	// the kanji forms. The strings in the first check were found wrong by a
	// review of the first build; they are here so that they cannot come back.
	check('hyakunin: known answers (the poets of 28 and 46, the readings of 70, 74 and 89)', function () {
		var got = [poems[27].poet, poems[45].poet, poems[69].shimo.split(' ')[0], poems[73].kami.split(' ')[2], poems[88].shimo.split(' ')[1]];
		var want = ['源宗于朝臣', '曽禰好忠', 'いづこもおなじ', 'やまおろしよ', 'よわりもぞする'];
		return JSON.stringify(got) === JSON.stringify(want) ? null : JSON.stringify(got);
	});
	check('hyakunin: every correction in meta is in the data, names what the page printed, and differs from it by one character', function () {
		var list = H.meta.corrections;
		if (!Array.isArray(list) || list.length !== H.meta.kept.corrections || !list.length) return 'corrections: ' + (list && list.length);
		var corrected = {};
		var bad = firstProblems(list, function (c) {
			var p = poems[c.n - 1];
			if (!p || typeof c.from !== 'string' || typeof c.to !== 'string' || c.from === c.to || typeof c.why !== 'string' || c.why.length < 30) return 'entry for poem ' + c.n;
			corrected[c.n] = true;
			var now;
			if (c.field === 'poet') now = p.poet;
			else if ((c.field === 'text' || c.field === 'kana') && c.phrase >= 1 && c.phrase <= 5) now = p[c.field].split(' ')[c.phrase - 1];
			else return 'poem ' + c.n + ': field ' + c.field;
			if (now !== c.to) return 'poem ' + c.n + ' ' + c.field + ' is ' + now + ', the correction says ' + c.to;
			var a = Array.from(c.from);
			var b = Array.from(c.to);
			if (Math.abs(a.length - b.length) > 1) return 'poem ' + c.n + ': ' + c.from + ' and ' + c.to + ' are more than one character apart';
			var i = 0;
			while (i < a.length && i < b.length && a[i] === b[i]) i++;
			var restA = a.slice(a.length === b.length || a.length > b.length ? i + 1 : i).join('');
			var restB = b.slice(a.length === b.length || b.length > a.length ? i + 1 : i).join('');
			return restA === restB ? null : 'poem ' + c.n + ': ' + c.from + ' and ' + c.to + ' are more than one character apart';
		});
		if (bad) return bad;
		var numbers = Object.keys(corrected).map(Number);
		if (numbers.length !== H.meta.kept.correctedPoems) return 'corrected poems: ' + numbers.join(', ');
		return JSON.stringify(numbers) === '[28,46,70,74,89]' ? null : 'corrected poems: ' + numbers.join(', ');
	});
	check('hyakunin: every variant in meta quotes the data on one side and something else on the other', function () {
		var list = H.meta.variants;
		if (!Array.isArray(list) || list.length !== H.meta.kept.variants) return 'variants: ' + (list && list.length);
		var bad = firstProblems(list, function (v) {
			var p = poems[v.n - 1];
			var now = v.field === 'poet' ? p.poet : v.field === 'kana' ? p.kana.split(' ')[v.phrase - 1] : null;
			if (now === null || now !== v.here) return 'poem ' + v.n + ' ' + v.field + ' is ' + now + ', the variant says ' + v.here;
			if (typeof v.there !== 'string' || !v.there || writtenOut(v.there) === writtenOut(v.here)) return 'poem ' + v.n + ': nothing differs';
			if (!every(v.there, v.field === 'poet' ? isKanjiCp : isHiraganaCp)) return 'poem ' + v.n + ': ' + v.there;
			return null;
		});
		if (bad) return bad;
		var c = H.meta.compared;
		var kanaPoems = list.filter(function (v) { return v.field === 'kana'; }).length;
		var poetPoems = list.filter(function (v) { return v.field === 'poet'; }).length;
		return c && c.readingsAlike === 100 - kanaPoems && c.namesAlike === 100 - poetPoems ? null : 'meta.compared does not add up: ' + JSON.stringify(c);
	});
	check('hyakunin: the poets read with a modern spelling are listed, and Porter\'s "kw" agrees with the list', function () {
		var list = H.meta.poetKana && H.meta.poetKana.modernSpelling;
		if (!Array.isArray(list) || !list.length || typeof H.meta.poetKana.note !== 'string') return 'meta.poetKana';
		var count = function (s, piece) {
			return s.split(piece).length - 1;
		};
		return firstProblems(poems, function (p) {
			var listed = list.indexOf(p.n) >= 0;
			var byPorter = count(p.poetRomaji.toUpperCase(), 'KW') > count(p.poetKana, 'くわ');
			return byPorter && !listed ? 'poem ' + p.n + ': Porter writes ' + p.poetRomaji + ', the reading is ' + p.poetKana + ', and the list does not name it' : null;
		});
	});
	check('hyakunin: README.md names every corrected string, every variant, every replaced kanji and the poets with a modern spelling', function () {
		var missing = [];
		H.meta.corrections.forEach(function (c) {
			if (readme.indexOf(c.from) < 0) missing.push(c.from);
			if (readme.indexOf(c.to) < 0) missing.push(c.to);
		});
		H.meta.variants.forEach(function (v) {
			if (readme.indexOf(v.here) < 0) missing.push(v.here);
			if (readme.indexOf(v.there) < 0) missing.push(v.there);
		});
		H.meta.forms.replaced.forEach(function (f) {
			if (readme.indexOf(f.from) < 0) missing.push(f.from);
			if (readme.indexOf(f.to) < 0) missing.push(f.to);
		});
		if (readme.indexOf(H.meta.poetKana.modernSpelling.join(', ')) < 0) missing.push('the poems ' + H.meta.poetKana.modernSpelling.join(', '));
		return missing.length ? 'README.md does not mention ' + missing.slice(0, 6).join(' ') : null;
	});
}
if (H && K) {
	check('hyakunin: text, poet and anthology hold no kanji that is another form of a joyo kanji; meta.forms lists what was replaced', function () {
		var fields = ['text', 'poet', 'anthology'];
		var bad = firstProblems(H.poems, function (p) {
			for (var f = 0; f < fields.length; f++) {
				var chars = Array.from(p[fields[f]]);
				for (var i = 0; i < chars.length; i++) if (K.alias[chars[i]]) return 'poem ' + p.n + ' ' + fields[f] + ' has ' + chars[i] + ', a form of ' + K.alias[chars[i]];
			}
			return null;
		});
		if (bad) return bad;
		var replaced = H.meta.forms && H.meta.forms.replaced;
		if (!Array.isArray(replaced) || replaced.length !== H.meta.kept.kanjiInJoyoForm || !replaced.length) return 'meta.forms.replaced';
		var places = 0;
		bad = firstProblems(replaced, function (r) {
			if (K.alias[r.from] !== r.to || !K.k[r.to]) return r.from + ' -> ' + r.to + ' is not in the alias table of kanji.js';
			for (var f = 0; f < fields.length; f++) {
				var where = r[fields[f]];
				if (!Array.isArray(where)) return r.from + ': no list for ' + fields[f];
				places += where.length;
				for (var i = 0; i < where.length; i++) if (H.poems[where[i] - 1][fields[f]].indexOf(r.to) < 0) return 'poem ' + where[i] + ' ' + fields[f] + ' does not hold ' + r.to;
			}
			return null;
		});
		if (bad) return bad;
		return places === H.meta.kept.placesInJoyoForm ? null : places + ' places, meta says ' + H.meta.kept.placesInJoyoForm;
	});
}

// ---- kanji.js and kanji-grades.js ---------------------------------------------------------

// The table of kanji by school year in force since 2020 (course of study for
// primary schools, notified 2017): 80, 160, 200, 202, 193 and 191 kanji, 1,026
// in all; the joyo list of 2010 has 2,136, so 1,110 are left for later years.
var GRADE_COUNTS = { 1: 80, 2: 160, 3: 200, 4: 202, 5: 193, 6: 191, 8: 1110 };

if (K) {
	var kanjiKeys = Object.keys(K.k);
	check('kanji: 2,136 kanji, each key one kanji, grades 80/160/200/202/193/191 and 1,110', function () {
		if (kanjiKeys.length !== 2136) return kanjiKeys.length + ' kanji';
		var bad = firstProblems(kanjiKeys, function (k) {
			return oneChar(k) && isKanjiCp(k.codePointAt(0)) ? null : 'key ' + k;
		});
		if (bad) return bad;
		var counts = {};
		kanjiKeys.forEach(function (k) {
			counts[K.k[k].grade] = (counts[K.k[k].grade] || 0) + 1;
		});
		return JSON.stringify(counts) === JSON.stringify(GRADE_COUNTS) ? null : 'grades ' + JSON.stringify(counts);
	});
	check('kanji: meanings in English, on readings in katakana, kun readings in kana, strokes and frequency in range', function () {
		var seenFreq = {};
		return firstProblems(kanjiKeys, function (k) {
			var e = K.k[k];
			if (!Array.isArray(e.m) || !e.m.length) return k + ' has no meaning';
			for (var i = 0; i < e.m.length; i++) if (!every(e.m[i], isLatinCp) || e.m[i] === '(kokuji)') return k + ' meaning ' + e.m[i];
			if (!Array.isArray(e.on) || !Array.isArray(e.kun) || e.on.length + e.kun.length === 0) return k + ' has no reading';
			for (i = 0; i < e.on.length; i++) if (!every(e.on[i], function (cp) { return isKatakanaCp(cp) || cp === 0x2d; })) return k + ' on ' + e.on[i];
			for (i = 0; i < e.kun.length; i++) if (!every(e.kun[i], function (cp) { return isKanaCp(cp) || cp === 0x2e || cp === 0x2d; })) return k + ' kun ' + e.kun[i];
			if (!(Number.isInteger(e.strokes) && e.strokes >= 1 && e.strokes <= 29)) return k + ' strokes ' + e.strokes;
			if (e.freq !== null) {
				if (!(Number.isInteger(e.freq) && e.freq >= 1 && e.freq <= 2501)) return k + ' freq ' + e.freq;
				if (seenFreq[e.freq]) return k + ' shares the frequency rank ' + e.freq + ' with ' + seenFreq[e.freq];
				seenFreq[e.freq] = k;
			}
			return null;
		});
	});
	check('kanji: every kanji has parts, or is one of the kanji meta.noParts explains', function () {
		var without = kanjiKeys.filter(function (k) {
			return !Array.isArray(K.k[k].parts) || K.k[k].parts.length === 0;
		});
		var explained = K.meta.noParts && K.meta.noParts.kanji;
		if (!Array.isArray(explained) || typeof K.meta.noParts.why !== 'string' || K.meta.noParts.why.length < 40) return 'meta.noParts is missing';
		if (without.slice().sort().join('') !== explained.slice().sort().join('')) return 'without parts: ' + without.join(' ') + '; explained: ' + explained.join(' ');
		if (without.length > 4) return without.length + ' kanji without parts';
		return null;
	});
	check('kanji: every part is one character and has a stroke count in el; stand-ins name a shape', function () {
		var bad = firstProblems(kanjiKeys, function (k) {
			var parts = K.k[k].parts;
			for (var i = 0; i < parts.length; i++) {
				if (!oneChar(parts[i])) return k + ' part ' + parts[i];
				var cp = parts[i].codePointAt(0);
				if (!isKanjiCp(cp) && !isKatakanaCp(cp) && cp !== 0xff5c) return k + ' part ' + parts[i] + ' is in no expected script';
				if (!K.el[parts[i]]) return k + ' part ' + parts[i] + ' is not in el';
			}
			if (new Set(parts).size !== parts.length) return k + ' lists a part twice';
			return null;
		});
		if (bad) return bad;
		var els = Object.keys(K.el);
		var shapes = 0;
		bad = firstProblems(els, function (e) {
			var v = K.el[e];
			if (!(Number.isInteger(v.s) && v.s >= 1 && v.s <= 17)) return 'element ' + e + ' strokes ' + v.s;
			if (v.shape !== undefined) {
				shapes++;
				if (!oneChar(v.shape) || v.shape === e) return 'element ' + e + ' shape';
			}
			return null;
		});
		if (bad) return bad;
		if (els.length !== K.meta.kept.elements) return els.length + ' elements, meta says ' + K.meta.kept.elements;
		return shapes === 22 ? null : shapes + ' stand-in shapes, KRADFILE lists 22';
	});
	check('kanji: known answers (the components of two kanji, a stand-in, a kokuji)', function () {
		var mei = K.k['明'];
		var kyuu = K.k['休'];
		if (mei.parts.slice().sort().join('') !== ['日', '月'].sort().join('')) return 'parts of the kanji for bright: ' + mei.parts.join(' ');
		if (mei.grade !== 2 || mei.strokes !== 8) return 'grade or strokes of the kanji for bright';
		if (kyuu.parts.join(' ') !== '化 木') return 'parts of the kanji for rest: ' + kyuu.parts.join(' ');
		if (K.el['化'].shape.codePointAt(0) !== 0x2e85) return 'the person radical stand-in';
		if (K.k['働'].kokuji !== true || K.k['日'].kokuji !== undefined) return 'kokuji flags';
		if (K.k['日'].freq !== 1 || K.k['日'].grade !== 1 || K.k['日'].strokes !== 4) return 'the kanji for day';
		return null;
	});
	check('kanji: alias leads from kanji outside the list to kanji on it, one other form for each kanji without parts', function () {
		var others = Object.keys(K.alias || {});
		if (others.length !== K.meta.kept.aliases || others.length < 500) return others.length + ' aliases, meta says ' + K.meta.kept.aliases;
		var bad = firstProblems(others, function (c) {
			if (!oneChar(c) || !isKanjiCp(c.codePointAt(0))) return 'key ' + c;
			if (K.k[c]) return c + ' is itself a joyo kanji';
			return K.k[K.alias[c]] ? null : c + ' leads to ' + K.alias[c] + ', which is not in k';
		});
		if (bad) return bad;
		return firstProblems(K.meta.noParts.kanji, function (c) {
			var forms = others.filter(function (o) {
				return K.alias[o] === c;
			});
			return forms.length === 1 ? null : c + ' has ' + forms.length + ' other forms in alias';
		});
	});
}
if (G && K) {
	check('kanji-grades: the same 2,136 kanji with the same grade and strokes, in school order', function () {
		if (!Array.isArray(G.k) || G.k.length !== 2136) return 'rows: ' + (G.k && G.k.length);
		if (JSON.stringify(G.counts) !== JSON.stringify(GRADE_COUNTS)) return 'counts ' + JSON.stringify(G.counts);
		var seen = new Set();
		var bad = firstProblems(G.k, function (row, i) {
			var e = K.k[row[0]];
			if (!e) return row[0] + ' is not in kanji.js';
			if (seen.has(row[0])) return row[0] + ' twice';
			seen.add(row[0]);
			if (row.length !== 3 || row[1] !== e.grade || row[2] !== e.strokes) return 'row ' + JSON.stringify(row);
			if (i > 0) {
				var prev = G.k[i - 1];
				if (prev[1] > row[1] || (prev[1] === row[1] && prev[2] > row[2])) return 'order breaks at ' + row[0];
			}
			return null;
		});
		if (bad) return bad;
		return G.k[0][0] === '一' && G.k[2135][2] === 29 ? null : 'first or last row';
	});
}

// ---- jmdict-core.js and jmdict-tech.js -------------------------------------------------

function wordRowProblems(D, label, allKanjiOnly) {
	var known = {};
	['pos', 'field', 'misc'].forEach(function (kind) {
		Object.keys(D.meta.tags[kind]).forEach(function (code) {
			known[code] = kind;
			if (typeof D.meta.tags[kind][code] !== 'string' || !D.meta.tags[kind][code]) known[code] = null;
		});
	});
	return firstProblems(D.e, function (row, i) {
		if (!Array.isArray(row) || row.length !== 5) return 'row ' + i + ' is not five fields';
		var kanji = row[0];
		var kana = row[1];
		if (typeof kanji !== 'string' || typeof kana !== 'string' || typeof row[2] !== 'string' || typeof row[3] !== 'string') return 'row ' + i + ' types';
		if (!every(kana, function (cp) { return isKanaCp(cp) || cp === 0x30fb; })) return 'row ' + i + ' reading ' + kana;
		if (allKanjiOnly) {
			if (!every(kanji, function (cp) { return isKanjiCp(cp) || cp === KANJI_ITER; })) return 'row ' + i + ' written form ' + kanji;
		} else if (kanji !== '') {
			// kanji, kana, the repetition mark, full-width digits and letters
			if (!every(kanji, function (cp) { return isKanjiCp(cp) || isKanaCp(cp) || cp === KANJI_ITER || (cp >= 0xff10 && cp <= 0xff19) || (cp >= 0xff21 && cp <= 0xff5a); })) return 'row ' + i + ' written form ' + kanji;
		}
		if (!every(row[2], isLatinCp) || row[2] !== row[2].trim()) return 'row ' + i + ' gloss ' + row[2];
		var tags = row[3].split(',');
		for (var t = 0; t < tags.length; t++) if (!known[tags[t]]) return 'row ' + i + ' has the unexplained tag ' + tags[t];
		if (known[tags[0]] !== 'pos') return 'row ' + i + ' does not start with a part of speech';
		if (!(Number.isInteger(row[4]) && row[4] >= 0 && row[4] <= 48)) return 'row ' + i + ' band ' + row[4];
		return null;
	});
}
if (J) {
	check('jmdict-core: rows are [kanji, kana, gloss, tags, band] in the right scripts, every tag explained in meta.tags', function () {
		if (J.e.length !== J.meta.kept.entries || J.e.length < 20000) return J.e.length + ' rows, meta says ' + J.meta.kept.entries;
		return wordRowProblems(J, 'core', false);
	});
	check('jmdict-core: sorted by band (1 to 48, then 0), under about 1.2 MB, keeps the comp and math field tags', function () {
		var rank = function (b) {
			return b || 99;
		};
		for (var i = 1; i < J.e.length; i++) if (rank(J.e[i - 1][4]) > rank(J.e[i][4])) return 'order breaks at row ' + i;
		var bytes = fs.statSync(path.join(dir, 'jmdict-core.js')).size;
		if (bytes > 1250000) return bytes + ' bytes';
		var comp = 0;
		var math = 0;
		J.e.forEach(function (r) {
			var tags = r[3].split(',');
			if (tags.indexOf('comp') >= 0) comp++;
			if (tags.indexOf('math') >= 0) math++;
		});
		if (comp !== J.meta.kept.fieldComp || math !== J.meta.kept.fieldMath || comp < 20 || math < 10) return 'comp ' + comp + ', math ' + math;
		return null;
	});
	check('jmdict-core: known answers (school, cat, the three hashi)', function () {
		var find = function (kanji, kana) {
			return J.e.filter(function (r) {
				return r[0] === kanji && r[1] === kana;
			});
		};
		var school = find('学校', 'がっこう');
		if (school.length !== 1 || school[0][2] !== 'school' || school[0][3] !== 'n') return 'school: ' + JSON.stringify(school);
		if (find('猫', 'ねこ').length !== 1) return 'cat';
		if (find('橋', 'はし').length !== 1 || find('箸', 'はし').length !== 1 || find('端', 'はし').length !== 1) return 'hashi';
		return null;
	});
	check('jmdict-core: no gloss matches the pattern of words not to serve at random, and the pattern spares ordinary words', function () {
		if (typeof J.meta.unwantedGloss !== 'string' || !J.meta.unwantedGloss) return 'meta.unwantedGloss is missing';
		var pattern = new RegExp(J.meta.unwantedGloss, 'i');
		var hit = firstProblems(J.e, function (r) {
			return pattern.test(r[2]) ? r[1] + ': ' + r[2] : null;
		});
		if (hit) return hit;
		var must = ['prostitution', 'penis', 'sex', 'sexual intercourse', 'rape', 'pornography', 'erection (of the penis)'];
		var mustNot = ['sex education', 'the opposite sex', '(distinction of) sex', 'sexual harassment', 'rapeseed', 'grape', 'stripe', 'manuscript', 'Sussex'];
		for (var i = 0; i < must.length; i++) if (!pattern.test(must[i])) return 'the pattern lets through: ' + must[i];
		for (i = 0; i < mustNot.length; i++) if (pattern.test(mustNot[i])) return 'the pattern catches: ' + mustNot[i];
		return null;
	});
}
if (T) {
	check('jmdict-tech: rows in the right scripts, written in kanji only, each tagged comp or math', function () {
		if (T.e.length !== T.meta.kept.entries || T.e.length < 1000) return T.e.length + ' rows';
		var bad = wordRowProblems(T, 'tech', true);
		if (bad) return bad;
		return firstProblems(T.e, function (r, i) {
			var tags = r[3].split(',');
			return tags.indexOf('comp') >= 0 || tags.indexOf('math') >= 0 ? null : 'row ' + i + ' has neither field: ' + r[3];
		});
	});
	check('jmdict-tech: known answers (matrix, function, machine learning)', function () {
		var gloss = function (kanji) {
			var rows = T.e.filter(function (r) {
				return r[0] === kanji;
			});
			return rows.length === 1 ? rows[0][2] : JSON.stringify(rows);
		};
		if (gloss('行列') !== 'matrix') return 'matrix: ' + gloss('行列');
		if (gloss('関数') !== 'function') return 'function: ' + gloss('関数');
		if (gloss('機械学習') !== 'machine learning') return 'machine learning: ' + gloss('機械学習');
		return null;
	});
}

// ---- accents.js -------------------------------------------------------------------------

// Morae: every kana is one, except the small ya, yu, yo and small vowels.
var SMALL_KANA = new Set([0x3083, 0x3085, 0x3087, 0x3041, 0x3043, 0x3045, 0x3047, 0x3049, 0x308e, 0x30e3, 0x30e5, 0x30e7, 0x30a1, 0x30a3, 0x30a5, 0x30a7, 0x30a9, 0x30ee]);
function moraCount(kana) {
	var n = 0;
	Array.from(kana).forEach(function (ch) {
		var cp = ch.codePointAt(0);
		if (isKanaCp(cp) && !SMALL_KANA.has(cp)) n++;
	});
	return n;
}

if (A && J) {
	var coreRows = {};
	J.e.forEach(function (r) {
		var key = r[0] + '|' + r[1];
		(coreRows[key] = coreRows[key] || []).push(r);
	});
	var accentKeys = Object.keys(A.a);
	check('accents: every key is a row of jmdict-core, every value a list of accent numbers that fit the word', function () {
		if (accentKeys.length !== A.meta.kept.words || accentKeys.length < 15000) return accentKeys.length + ' words';
		return firstProblems(accentKeys, function (key) {
			if (!coreRows[key]) return key + ' is not in jmdict-core';
			var kana = key.slice(key.indexOf('|') + 1);
			var list = A.a[key];
			if (!Array.isArray(list) || !list.length) return key + ' has no accent';
			var morae = moraCount(kana);
			for (var i = 0; i < list.length; i++) {
				if (!Number.isInteger(list[i]) || list[i] < 0 || list[i] > morae) return key + ' accent ' + list[i] + ' with ' + morae + ' morae';
				if (list.indexOf(list[i]) !== i) return key + ' repeats an accent';
			}
			return null;
		});
	});
	check('accents: the three words read hashi are there with three different accents (bridge 2, edge 0, chopsticks 1)', function () {
		var bridge = A.a['橋|はし'];
		var edge = A.a['端|はし'];
		var chopsticks = A.a['箸|はし'];
		if (!bridge || !edge || !chopsticks) return 'missing: ' + JSON.stringify([bridge, edge, chopsticks]);
		if (bridge.length !== 1 || edge.length !== 1 || chopsticks.length !== 1) return 'not one accent each';
		if (new Set([bridge[0], edge[0], chopsticks[0]]).size !== 3) return 'not distinct';
		return bridge[0] === 2 && edge[0] === 0 && chopsticks[0] === 1 ? null : JSON.stringify([bridge, edge, chopsticks]);
	});
	check('accents: q holds the part-of-speech notes word for word and only for words in a', function () {
		return firstProblems(Object.keys(A.q), function (key) {
			if (!A.a[key]) return key + ' is in q but not in a';
			var numbers = A.q[key].match(/\d+/g).map(Number);
			var unique = numbers.filter(function (n, i) {
				return numbers.indexOf(n) === i;
			});
			if (JSON.stringify(unique) !== JSON.stringify(A.a[key])) return key + ': ' + A.q[key] + ' against ' + JSON.stringify(A.a[key]);
			return A.q[key].indexOf('(') >= 0 ? null : key + ' has no note';
		});
	});
	check('accents: meta.sharedKeys names exactly the keys that stand for more than one row of jmdict-core', function () {
		var shared = accentKeys.filter(function (key) {
			return coreRows[key].length > 1;
		});
		if (!Array.isArray(A.meta.sharedKeys) || A.meta.sharedKeys.join(' ') !== shared.join(' ')) return shared.length + ' such keys, meta.sharedKeys has ' + (A.meta.sharedKeys && A.meta.sharedKeys.length);
		if (A.meta.kept.keysOfSeveralRows !== shared.length) return 'meta.kept.keysOfSeveralRows is ' + A.meta.kept.keysOfSeveralRows;
		var inKana = shared.filter(function (key) {
			return key.charAt(0) === '|';
		}).length;
		return A.meta.kept.keysOfSeveralRowsInKana === inKana ? null : 'meta.kept.keysOfSeveralRowsInKana is ' + A.meta.kept.keysOfSeveralRowsInKana;
	});
	check('accents: pairs are words with the same kana, one accent each, at least two different, glossed as in jmdict-core', function () {
		if (!Array.isArray(A.pairs) || A.pairs.length !== A.meta.kept.pairGroups || A.pairs.length < 100) return 'groups: ' + (A.pairs && A.pairs.length);
		var hashi = null;
		var bad = firstProblems(A.pairs, function (group) {
			var kana = group[0];
			var words = group[1];
			if (!every(kana, isKanaCp)) return 'group kana ' + kana;
			if (kana === 'はし') hashi = words;
			if (!Array.isArray(words) || words.length < 2) return kana + ' has fewer than two words';
			var numbers = new Set();
			for (var i = 0; i < words.length; i++) {
				var w = words[i];
				var key = w[0] + '|' + kana;
				if (!w[0] || !A.a[key] || A.a[key].length !== 1 || A.a[key][0] !== w[1] || A.q[key]) return kana + ': ' + w[0] + ' accent';
				if (!coreRows[key] || coreRows[key].length !== 1 || coreRows[key][0][2] !== w[2]) return kana + ': ' + w[0] + ' gloss';
				numbers.add(w[1]);
			}
			return numbers.size >= 2 ? null : kana + ' has one accent only';
		});
		if (bad) return bad;
		if (!hashi) return 'no group for hashi';
		var names = hashi
			.map(function (w) {
				return w[0] + w[1];
			})
			.sort()
			.join(' ');
		return names === ['橋2', '端0', '箸1'].sort().join(' ') ? null : 'the hashi group is ' + names;
	});
}

// ---- freq-ja.js ---------------------------------------------------------------------------

if (F && J) {
	var coreByForm = {};
	J.e.forEach(function (r) {
		(coreByForm[r[0]] = coreByForm[r[0]] || []).push(r);
	});
	check('freq-ja: w holds two-kanji words of jmdict-core with their reading, gloss and two counts, largest first', function () {
		if (!Array.isArray(F.w) || F.w.length !== F.meta.kept.words || F.w.length < 5000) return 'words: ' + (F.w && F.w.length);
		var seen = new Set();
		return firstProblems(F.w, function (row, i) {
			if (row.length !== 5) return 'row ' + i;
			var chars = Array.from(row[0]);
			if (chars.length !== 2 || !isKanjiCp(chars[0].codePointAt(0)) || !isKanjiCp(chars[1].codePointAt(0))) return row[0] + ' is not two kanji';
			if (seen.has(row[0])) return row[0] + ' twice';
			seen.add(row[0]);
			var core = coreByForm[row[0]];
			if (!core || core[0][1] !== row[1] || core[0][2] !== row[2]) return row[0] + ' does not match jmdict-core';
			if (!Number.isInteger(row[3]) || !Number.isInteger(row[4]) || row[3] < 0 || row[4] < 0) return row[0] + ' counts';
			if (i > 0) {
				var prev = F.w[i - 1];
				if (prev[3] < row[3] || (prev[3] === row[3] && prev[4] < row[4])) return 'order breaks at ' + row[0];
			}
			return null;
		});
	});
	check('freq-ja: alt lists the other readings of a form, as jmdict-core has them', function () {
		var forms = Object.keys(F.alt);
		if (forms.length !== F.meta.kept.withOtherReadings) return forms.length + ' forms';
		return firstProblems(forms, function (form) {
			var core = coreByForm[form];
			if (!core || core.length !== F.alt[form].length + 1) return form;
			for (var i = 0; i < F.alt[form].length; i++) if (core[i + 1][1] !== F.alt[form][i][0] || core[i + 1][2] !== F.alt[form][i][1]) return form + ' reading ' + i;
			return null;
		});
	});
	check('freq-ja: known maps a kanji to a string of kanji without repeats and holds every word of w', function () {
		var firsts = Object.keys(F.known);
		var total = 0;
		var bad = firstProblems(firsts, function (first) {
			if (!oneChar(first) || !isKanjiCp(first.codePointAt(0))) return 'key ' + first;
			var seconds = Array.from(F.known[first]);
			total += seconds.length;
			if (new Set(seconds).size !== seconds.length) return first + ' repeats a second kanji';
			for (var i = 0; i < seconds.length; i++) if (!isKanjiCp(seconds[i].codePointAt(0))) return first + ' is followed by ' + seconds[i];
			return null;
		});
		if (bad) return bad;
		if (total !== F.meta.kept.known || total < 50000) return total + ' strings, meta says ' + F.meta.kept.known;
		return firstProblems(F.w, function (row) {
			var chars = Array.from(row[0]);
			return F.known[chars[0]] && F.known[chars[0]].indexOf(chars[1]) >= 0 ? null : row[0] + ' is not in known';
		});
	});
}

// ---- texts/yume-juya-1.js -----------------------------------------------------------------

if (Y) {
	check('yume-juya-1: title, author and part are in Japanese; the text opens and closes as the First Night does', function () {
		var jp = function (cp) {
			return isKanjiCp(cp) || isKanaCp(cp);
		};
		if (!every(Y.title, jp) || !every(Y.author, jp) || !every(Y.part, jp)) return 'title, author or part';
		if (Y.title !== '夢十夜' || Y.author !== '夏目漱石' || Y.part !== '第一夜') return [Y.title, Y.author, Y.part].join(' / ');
		if (!Array.isArray(Y.lines) || Y.lines.length !== Y.meta.kept.lines || Y.lines.length < 10) return 'lines: ' + (Y.lines && Y.lines.length);
		if (Y.lines[0].t !== String.fromCharCode(IDEOGRAPHIC_SPACE) + 'こんな夢を見た。') return 'first line: ' + Y.lines[0].t;
		var last = Y.lines[Y.lines.length - 1].t;
		return last.indexOf('百年') >= 0 && last.charAt(0) === '「' ? null : 'last line: ' + last;
	});
	check('yume-juya-1: every character of the text is Japanese script or its punctuation; no markup is left', function () {
		var allowed = function (cp) {
			return isKanjiCp(cp) || isKanaCp(cp) || cp === KANJI_ITER || cp === IDEOGRAPHIC_SPACE || cp === 0x3001 || cp === 0x3002 || cp === 0x300c || cp === 0x300d || cp === 0x2015;
		};
		return firstProblems(Y.lines, function (line, i) {
			if (!every(line.t, allowed)) return 'line ' + i + ' holds a character outside the expected set';
			for (var u = 0; u < line.t.length; u++) if (line.t.charCodeAt(u) >= 0xd800 && line.t.charCodeAt(u) <= 0xdfff) return 'line ' + i + ' holds a surrogate: offsets would not be character counts';
			return null;
		});
	});
	check('yume-juya-1: every ruby offset points at kanji, readings are kana, ruby do not overlap', function () {
		var count = 0;
		var bad = firstProblems(Y.lines, function (line, i) {
			var end = 0;
			for (var r = 0; r < line.ruby.length; r++) {
				var ruby = line.ruby[r];
				count++;
				if (!Array.isArray(ruby) || ruby.length !== 3) return 'line ' + i + ' ruby ' + r;
				if (!(Number.isInteger(ruby[0]) && Number.isInteger(ruby[1]) && ruby[0] >= end && ruby[1] > ruby[0] && ruby[1] <= line.t.length)) return 'line ' + i + ' offsets ' + ruby[0] + '-' + ruby[1];
				end = ruby[1];
				if (!every(line.t.slice(ruby[0], ruby[1]), function (cp) { return isKanjiCp(cp) || cp === KANJI_ITER; })) return 'line ' + i + ': base ' + line.t.slice(ruby[0], ruby[1]) + ' is not kanji';
				if (!every(ruby[2], isKanaCp)) return 'line ' + i + ': reading ' + ruby[2];
				// The base is the whole run of kanji: the character before it is not a kanji, unless another ruby ends there.
				if (ruby[0] > 0 && isKanjiCp(line.t.codePointAt(ruby[0] - 1)) && !(r > 0 && line.ruby[r - 1][1] === ruby[0])) return 'line ' + i + ': base ' + line.t.slice(ruby[0], ruby[1]) + ' starts inside a run of kanji';
			}
			return null;
		});
		if (bad) return bad;
		if (count !== Y.meta.kept.ruby || count < 50) return count + ' ruby, meta says ' + Y.meta.kept.ruby;
		var second = Y.lines[1];
		return second.t.slice(second.ruby[0][0], second.ruby[0][1]) === '坐' && second.ruby[0][2] === 'すわ' ? null : 'the first ruby is ' + JSON.stringify(second.ruby[0]);
	});
	check('yume-juya-1: the colophon of the Aozora file is kept, and the character replaced for a description is where meta says', function () {
		var c = Y.meta.colophon;
		if (!Array.isArray(c) || c.length < 5) return 'colophon';
		if (c[0].indexOf('底本：') !== 0) return 'colophon does not start with the base text';
		if (!c.some(function (l) { return l.indexOf('入力：') === 0; })) return 'colophon does not name who typed the text in';
		if (!c.some(function (l) { return l.indexOf('青空文庫') >= 0; })) return 'colophon does not name Aozora Bunko';
		var typist = c.filter(function (l) { return l.indexOf('入力：') === 0; })[0].slice(3);
		if (Y.meta.credit.indexOf(typist) < 0) return 'the credit line does not name ' + typist;
		return firstProblems(Y.meta.gaiji, function (g) {
			return Y.lines[g.line].t.charAt(g.at) === g.ch && isKanjiCp(g.ch.codePointAt(0)) ? null : 'gaiji ' + g.ch;
		});
	});
}

console.log('');
console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
