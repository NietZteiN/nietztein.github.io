/*
 * Tests of the texts kit. Node built-ins only, no network, no cache; run from anywhere:
 *     node misc/_texts/test.js
 * Prints one PASS or FAIL line per check and exits 1 if any check failed.
 *
 * What is covered: every data file loads in a vm sandbox, sets exactly one global, carries the
 * meta it must carry, and has the size the README states; the German text has ten sections and
 * no Project Gutenberg boilerplate; the frequency lists are complete and their blocked words
 * are flagged, not removed; the Kieu lines are NFC and alternate six and eight syllables
 * except where meta lists an exception; every sentence has an id, an owner and the script it
 * claims; the CMU entries parse into the dictionary's 39 phonemes and keep the order of the
 * frequency list; README.md and LICENSES.md agree with the data.
 *
 * What is not covered: whether the data still equals its sources. That needs the network:
 * node scripts/texts/spot-check.mjs
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var HERE = __dirname;
var ROOT = path.resolve(HERE, '..', '..');

var passed = 0, failed = 0, skipped = 0, section = '';
function ok(cond, msg) {
	if (cond) { passed++; console.log('PASS  ' + section + ': ' + msg); return true; }
	failed++;
	console.log('FAIL  ' + section + ': ' + msg);
	return false;
}
function eq(got, expected, msg) {
	var same = JSON.stringify(got) === JSON.stringify(expected);
	return ok(same, same ? msg : msg + '\n        got      ' + JSON.stringify(got) + '\n        expected ' + JSON.stringify(expected));
}
function skip(msg) { skipped++; console.log('SKIP  ' + section + ': ' + msg); }
function none(list, msg) {
	return ok(list.length === 0, list.length === 0 ? msg : msg + '\n        ' + list.length + ' offending, first: ' + JSON.stringify(list.slice(0, 5)));
}
function lf(text) { return text.replace(/\r\n/g, '\n'); }
function nfc(s) { return s.normalize('NFC'); }
function isString(x) { return typeof x === 'string' && x.length > 0; }
function hasCombiningMark(s) {
	for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c >= 0x300 && c <= 0x36F) return true; }
	return false;
}

var FILES = [
	{ file: 'zarathustra-vorrede.js', global: 'TEXTS_ZARATHUSTRA' },
	{ file: 'freq-de.js', global: 'TEXTS_FREQ_DE' },
	{ file: 'freq-vi.js', global: 'TEXTS_FREQ_VI' },
	{ file: 'kieu-opening.js', global: 'TEXTS_KIEU' },
	{ file: 'sentences.js', global: 'TEXTS_SENTENCES' },
	{ file: 'cmu-phones.js', global: 'TEXTS_CMU' },
	{ file: 'glosses-de.js', global: 'TEXTS_GLOSSES_DE', optional: true }
];

var readme = fs.existsSync(path.join(HERE, 'README.md')) ? lf(fs.readFileSync(path.join(HERE, 'README.md'), 'utf8')) : '';
var licenses = fs.existsSync(path.join(HERE, 'LICENSES.md')) ? lf(fs.readFileSync(path.join(HERE, 'LICENSES.md'), 'utf8')) : '';
var DATA = {};

/* ------------------------------------------------------------ loading */
FILES.forEach(function (f) {
	section = f.file;
	var full = path.join(HERE, f.file);
	if (!fs.existsSync(full)) {
		if (f.optional) { skip('not built (optional)'); return; }
		ok(false, 'the file exists');
		return;
	}
	var src = fs.readFileSync(full, 'utf8');
	var sandbox = { window: {} };
	var threw = null;
	try { vm.runInNewContext(src, sandbox, { filename: f.file }); } catch (err) { threw = err; }
	if (!ok(!threw, 'loads in a vm sandbox' + (threw ? ': ' + threw.message : ''))) return;
	eq(Object.keys(sandbox.window), [f.global], 'sets window.' + f.global + ' and nothing else on window');
	eq(Object.keys(sandbox), ['window'], 'leaves no other global behind');
	var data = sandbox.window[f.global];
	DATA[f.global] = data;
	var viaRequire = require(full);
	ok(JSON.stringify(viaRequire) === JSON.stringify(data), 'require() gives the same data');
	// A Web Worker has self and no window (importScripts('../_texts/x.js')).
	var worker = { self: {} };
	var workerThrew = null;
	try { vm.runInNewContext(src, worker, { filename: f.file }); } catch (err) { workerThrew = err; }
	ok(!workerThrew && Object.keys(worker.self).join() === f.global && Object.keys(worker).join() === 'self' && JSON.stringify(worker.self[f.global]) === JSON.stringify(data),
		'where there is no window but a self (a Web Worker), it sets self.' + f.global + ' to the same data');
	ok(src.charCodeAt(0) !== 0xFEFF, 'has no byte-order mark');
	none(src.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi) || [], 'contains no email address');

	// meta
	var meta = data.meta || {};
	ok(Array.isArray(meta.sources) && meta.sources.length > 0, 'meta.sources lists ' + (meta.sources || []).length + ' source(s)');
	none((meta.sources || []).filter(function (s) {
		return !(isString(s.url) && /^https:\/\//.test(s.url) && /^[0-9a-f]{64}$/.test(s.sha256 || '') && /^\d{4}-\d{2}-\d{2}$/.test(s.fetched || ''));
	}), 'every source has an https url, a SHA-256 and the day it was fetched');
	ok(isString(meta.licence) && isString(meta.credit) && isString(meta.kept) && isString(meta.dropped), 'meta has licence, credit, kept and dropped');

	// README and LICENSES agree with the file
	var bytes = Buffer.byteLength(lf(src));
	var row = new RegExp('^\\| `' + f.file.replace(/\./g, '\\.') + '` \\|.*\\| ([0-9,]+) \\|$', 'm').exec(readme);
	if (ok(!!row, 'README.md has a table row for it')) {
		eq(Number(row[1].replace(/,/g, '')), bytes, 'its size (' + bytes + ' bytes with LF line ends) is the size in README.md');
	}
	ok(readme.indexOf('window.' + f.global) !== -1, 'README.md documents window.' + f.global);
	// The file is the one the build wrote: build-docs.mjs records its SHA-256 in LICENSES.md.
	var hash = require('crypto').createHash('sha256').update(lf(src)).digest('hex');
	var recorded = new RegExp('^\\| `' + f.file.replace(/\./g, '\\.') + '` \\|.*\\| `([0-9a-f]{64})` \\|$', 'm').exec(licenses);
	if (ok(!!recorded, 'LICENSES.md records the SHA-256 of the built file')) {
		ok(recorded[1] === hash, 'the file has the recorded SHA-256, so it was not edited after the build' + (recorded[1] === hash ? '' : '\n        file     ' + hash + '\n        recorded ' + recorded[1] + '\n        (rebuild with scripts/texts/build-all.mjs --offline; do not edit data files by hand)'));
	}
	// A Creative Commons licence comes with the address of its text.
	if (/^CC /.test(meta.licence || '')) {
		ok(/^https:\/\/creativecommons\.org\/licenses\/[a-z-]+\/\d\.\d\/([a-z]{2}\/)?$/.test(meta.licenceUrl || '') && (meta.credit || '').indexOf(meta.licenceUrl) !== -1,
			'meta.licenceUrl is the address of the ' + meta.licence + ' licence, and the credit line carries it');
	}
	ok(licenses.indexOf('## `' + f.file + '`') !== -1, 'LICENSES.md has a section for it');
	ok(licenses.indexOf(meta.credit) !== -1, 'LICENSES.md gives its credit line word for word');
	none((meta.sources || []).filter(function (s) { return licenses.indexOf(s.sha256) === -1 || licenses.indexOf(s.url) === -1; }), 'LICENSES.md lists every source URL with its SHA-256');
});

/* ------------------------------------------------------------ Zarathustra */
section = 'zarathustra';
(function () {
	var Z = DATA.TEXTS_ZARATHUSTRA;
	if (!Z) return;
	eq(Z.sections.length, 10, 'ten sections');
	eq(Z.sections.map(function (s) { return s.n; }), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'numbered 1 to 10 in order');
	none(Z.sections.filter(function (s) { return !Array.isArray(s.paras) || s.paras.length === 0 || !isString(s.label); }), 'every section has a label and paragraphs');
	var paras = [];
	Z.sections.forEach(function (s) { s.paras.forEach(function (p) { paras.push(p); }); });
	eq(paras.length, 161, '161 paragraphs');
	eq(Z.sections.map(function (s) { return s.paras.length; }), [12, 20, 27, 23, 30, 6, 6, 9, 18, 10], 'paragraphs per section');
	var text = Z.title + '\n' + paras.join('\n');
	eq((paras.join('\n').match(/\p{L}+/gu) || []).length, 4530, '4,530 words');
	[/gutenberg/i, /licen[sc]e/i, /www\./i, /https?:/i, /e-?book/i, /copyright/i, /trademark/i, /\*\*\*/, /project/i, /donat/i].forEach(function (re) {
		ok(!re.test(text), 'no Project Gutenberg boilerplate in the text: ' + re);
	});
	none(paras.filter(function (p) { return !isString(p) || p !== p.trim() || /[\n\r\t]/.test(p) || / {2}/.test(p); }), 'paragraphs are single lines without stray spaces');
	none(paras.filter(function (p) { return p !== nfc(p); }), 'paragraphs are NFC');
	none(paras.filter(function (p) { return (p.split('_').length - 1) % 2 !== 0; }), 'emphasis underscores come in pairs');
	ok(/^Als Zarathustra dreissig Jahr alt war, verliess er seine Heimat/.test(paras[0]), 'begins "Als Zarathustra dreissig Jahr alt war, ..."');
	ok(/Also begann Zarathustra.s Untergang\.$/.test(paras[paras.length - 1]), 'ends "... Also begann Zarathustra\'s Untergang."');
	ok(/gieng/.test(text) && /Thier/.test(text) && /Morgenr.the/.test(text) && /verliess/.test(text), 'the old spelling is kept (gieng, Thier, Morgenr-o-umlaut-the, verliess)');
	ok(/^Zarathustra.s Vorrede\.$/.test(Z.title), 'the title is the chapter heading of the source');
	eq(Z.sections.map(function (s) { return s.label; }), ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.', '8.', '10.'], 'labels keep the numbering of the source, misprint included');
	ok(Z.meta.notes.length === 2 && /section 9 is headed "8\."/.test(Z.meta.notes[0]), 'meta.notes says that the source heads section 9 "8."');
	var eszett = String.fromCharCode(0xDF);
	var sharp = [];
	Z.sections.forEach(function (s) { s.paras.forEach(function (p, i) { (p.match(/\p{L}+/gu) || []).forEach(function (w) { if (w.indexOf(eszett) !== -1) sharp.push({ section: s.n, paragraph: i + 1, word: w }); }); }); });
	eq(Z.meta.sharpS, sharp, 'meta.sharpS lists every word of the text that has a sharp s (the source writes ss elsewhere)');
	eq(sharp.map(function (x) { return x.section + '.' + x.paragraph; }), ['3.3'], 'there is exactly one, in section 3, paragraph 3, as README.md says');
	ok(Z.meta.notes[1].indexOf(sharp[0].word) !== -1 && readme.indexOf('`' + sharp[0].word + '`') !== -1, 'meta.notes and README.md name it');
	ok(/Project Gutenberg/.test(Z.meta.credit) && /7205/.test(Z.meta.credit), 'meta.credit names Project Gutenberg and the ebook number');
})();

/* ------------------------------------------------------------ frequency lists */
function testFreq(name, F, size, first) {
	section = name;
	if (!F) return;
	eq(F.words.length, size, size + ' words');
	eq(F.counts.length, size, size + ' counts');
	eq(F.words.slice(0, first.length), first, 'starts ' + first.join(', '));
	ok(new Set(F.words).size === F.words.length, 'no word twice');
	none(F.words.filter(function (w) { return !isString(w) || /\s/.test(w) || w !== nfc(w); }), 'words are non-empty, NFC and free of white space');
	none(F.counts.filter(function (c) { return !(Number.isInteger(c) && c > 0); }), 'counts are positive integers');
	var falls = true;
	for (var i = 1; i < F.counts.length; i++) if (F.counts[i] > F.counts[i - 1]) falls = false;
	ok(falls, 'counts never rise down the list');
	var sum = F.counts.reduce(function (a, b) { return a + b; }, 0);
	eq(F.meta.keptTokens, sum, 'meta.keptTokens is the sum of the counts');
	ok(F.meta.sourceTokens >= sum && F.meta.sourceEntries === 50000, 'meta.sourceTokens and meta.sourceEntries describe the 50,000-entry source');
	eq(F.meta.entries, size, 'meta.entries');
	// blocked: flagged, not removed
	ok(Array.isArray(F.blocked) && F.blocked.length > 20, F.blocked.length + ' blocked words');
	var rank = {};
	F.words.forEach(function (w, j) { rank[w] = j; });
	none(F.blocked.filter(function (w) { return !Object.prototype.hasOwnProperty.call(rank, w); }), 'every blocked word is still in words (flagged, not removed)');
	ok(new Set(F.blocked).size === F.blocked.length, 'no blocked word twice');
	var ordered = true;
	for (var k = 1; k < F.blocked.length; k++) if (rank[F.blocked[k]] < rank[F.blocked[k - 1]]) ordered = false;
	ok(ordered, 'blocked is in rank order');
	eq(F.meta.blockedCount, F.blocked.length, 'meta.blockedCount');
	ok(F.blocked.indexOf('fuck') !== -1 && Object.prototype.hasOwnProperty.call(rank, 'fuck'), 'an English obscenity of the subtitles is both ranked and blocked');
	// Addresses of subtitle and download sites are entries of the source; they are flagged too.
	var site = /^(?:[a-z0-9-]{2,}\.)+[a-z]{2,}$/;
	var sites = F.words.filter(function (w) { return site.test(w); });
	ok(sites.length > 0, sites.length + ' entries are addresses of web sites (' + sites.join(', ') + ')');
	none(sites.filter(function (w) { return F.blocked.indexOf(w) === -1; }), 'every such address is blocked');
	eq(F.meta.sites, sites, 'meta.sites lists them');
	none(F.words.filter(function (w) { return /\.(vn|org|net|de|com|tv|info)$/.test(w) && F.blocked.indexOf(w) === -1; }), 'no unflagged entry ends in a domain suffix');
	ok(Array.isArray(F.meta.unblocked) && F.meta.unblocked.every(function (w) { return F.words.indexOf(w) !== -1 && F.blocked.indexOf(w) === -1; }), 'meta.unblocked names the words left unflagged on purpose (' + F.meta.unblocked.length + ')');
	// One English list for the whole kit: what cmu-phones.js flags is flagged here too.
	if (DATA.TEXTS_CMU) {
		var pass = {};
		F.meta.unblocked.forEach(function (w) { pass[w] = true; });
		none(DATA.TEXTS_CMU.blocked.filter(function (w) { return Object.prototype.hasOwnProperty.call(rank, w) && !pass[w] && F.blocked.indexOf(w) === -1; }),
			'every word that cmu-phones.js blocks and that occurs here is blocked here too');
	}
}
testFreq('freq-de', DATA.TEXTS_FREQ_DE, 20000, ['ich', 'sie', 'das', 'ist', 'du']);
(function () {
	var F = DATA.TEXTS_FREQ_DE;
	if (!F) return;
	ok(F.blocked.indexOf(nfc('scheiße')) !== -1 && F.blocked.indexOf('nigger') !== -1, 'a German obscenity and a slur are blocked');
	// The forms a review found unflagged on 2026-10-05: inflected forms of flagged words, and a slur.
	none(['ärsche', 'beschissene', 'beschissenen', 'beschissener', 'beschissenes', 'jap'].map(nfc).filter(function (w) { return F.words.indexOf(w) === -1 || F.blocked.indexOf(w) === -1; }),
		'the inflected forms of arsch and beschissen, and "jap", are in the list and blocked');
	// No flagged stem may hide inside an unflagged entry (plurals, inflections, compounds). The
	// exceptions are ordinary words that merely contain the letters.
	var stems = ['scheiß', 'scheiss', 'schiss', 'arschl', 'ärsch', 'fick', 'fotz', 'hure', 'nutte', 'schlampe', 'wichs', 'pimmel', 'muschi', 'vergewalt', 'fuck', 'nigg', 'nazi', 'hitler', 'porno'].map(nfc);
	var innocent = { schlamperei: 1 };
	none(F.words.filter(function (w) { return F.blocked.indexOf(w) === -1 && !innocent[w] && stems.some(function (s) { return w.indexOf(s) !== -1; }); }),
		'no unflagged entry contains one of ' + stems.length + ' flagged stems (scheiß, arschl, fick, hure, fuck, nazi, ...)');
	ok(F.blocked.indexOf('und') === -1 && F.blocked.indexOf('haus') === -1, 'ordinary words are not');
	none(F.words.filter(function (w) { return w !== w.toLowerCase(); }), 'all lower case, as in the source');
	eq(F.meta.mergedEntries, 0, 'nothing had to be merged');
	ok(!('syllable' in F), 'no syllable flags (Vietnamese only)');
})();
testFreq('freq-vi', DATA.TEXTS_FREQ_VI, 10000, [nfc('tôi'), nfc('không'), nfc('là')]);
(function () {
	var F = DATA.TEXTS_FREQ_VI;
	if (!F) return;
	ok(typeof F.syllable === 'string' && F.syllable.length === F.words.length && /^[01]+$/.test(F.syllable), 'syllable is a string of one 0 or 1 per word');
	eq(F.syllable.split('1').length - 1, F.meta.syllableCount, 'meta.syllableCount counts the 1s');
	ok(F.meta.syllableCount > 4000 && F.meta.syllableCount < 5000, 'between 4,000 and 5,000 entries have the shape of a Vietnamese syllable');
	function flag(w) { var i = F.words.indexOf(nfc(w)); return i === -1 ? '?' : F.syllable.charAt(i); }
	eq(['tôi', 'không', 'người', 'được', 'nghiêng'].map(flag).join(''), '11111', 'common syllables are flagged 1');
	eq(['john', 'mr.', 'yeah', 'york', 'ko'].map(flag).join(''), '00000', 'names, English words and abbreviations are flagged 0');
	ok(F.meta.mergedEntries > 2000, F.meta.mergedEntries + ' source entries were merged after NFC normalisation');
	ok(F.words.indexOf('mong') !== -1 && F.blocked.indexOf('mong') === -1, '"mong" (to hope), though on the English list, is not blocked');
	ok(F.blocked.indexOf(nfc('địt')) !== -1, 'a Vietnamese obscenity is blocked');
})();

/* ------------------------------------------------------------ Kieu */
section = 'kieu';
(function () {
	var K = DATA.TEXTS_KIEU;
	if (!K) return;
	function syllables(line) {
		return line.split(/[\s-]+/).map(function (t) { return t.replace(/[^\p{L}]/gu, ''); }).filter(Boolean);
	}
	eq(K.lines.length, 38, '38 lines');
	none(K.lines.filter(function (l) { return !isString(l) || l !== nfc(l); }), 'every line is NFC');
	none(K.lines.filter(function (l) { return l !== l.trim() || /[\n\r\t<>{}\[\]|=']/.test(l) || / {2}/.test(l); }), 'no markup or stray spaces in a line');
	none(K.lines.filter(function (l) { return !/[^\x00-\x7F]/.test(l); }), 'every line carries Vietnamese diacritics (tone marks intact)');
	none(K.lines.filter(hasCombiningMark), 'no combining marks are left over (precomposed letters throughout)');
	var listed = {};
	(K.meta.exceptions || []).forEach(function (e) { listed[e.line] = e; });
	var wrong = [];
	K.lines.forEach(function (l, i) {
		var want = i % 2 === 0 ? 6 : 8;
		var got = syllables(l).length;
		if (got !== want && !listed[i + 1]) wrong.push((i + 1) + ': ' + got + ' syllables, ' + l);
	});
	none(wrong, 'lines alternate six and eight syllables (luc bat), apart from the exceptions in meta');
	eq((K.meta.exceptions || []).map(function (e) { return e.line; }), [37], 'the one listed exception is line 37');
	none((K.meta.exceptions || []).filter(function (e) {
		var l = K.lines[e.line - 1];
		return syllables(l).length !== e.syllables || syllables(l).length === e.expected || (e.without && syllables(e.without).length !== e.expected);
	}), 'each listed exception is real, and its "without" reading has the regular length');
	ok(K.lines[0].indexOf(nfc('Trăm năm')) === 0, 'line 1 begins "Trăm năm"');
	ok(K.lines[37].indexOf(nfc('tường đông ong bướm')) === 0, 'line 38 begins "tường đông ong bướm"');
	ok(K.meta.pages.length === 3 && K.meta.pages.every(function (p) { return /oldid=\d+$/.test(p.permalink) && /^https:\/\/vi\.wikisource\.org\//.test(p.url); }), 'meta.pages gives the three Wikisource pages with fixed revisions');
	ok(/1911/.test(K.meta.edition) && /1898/.test(K.meta.edition), 'meta.edition names the 1911 printing and the year the transcriber died');
	// Four lines follow the printed page, not the Wikisource transcription (review of 2026-10-05).
	var C = K.meta.corrections || [];
	eq(C.map(function (c) { return c.line; }), [4, 8, 23, 24], 'meta.corrections lists lines 4, 8, 23 and 24');
	none(C.filter(function (c) { return K.lines[c.line - 1] !== c.print || c.wikisource === c.print || !isString(c.wikisource) || [14, 15, 17].indexOf(c.scan) === -1; }),
		'each correction gives the Wikisource reading, the printed reading that the line now has, and the scan page');
	ok(/^những đều trông/.test(nfc(K.lines[3])) && K.lines[3].indexOf(nfc('điều')) === -1, 'line 4 has "đều", as printed (Wikisource: "điều")');
	ok(K.lines[7].indexOf(nfc('phong-tình')) === 0, 'line 8 begins "phong-tình", with the hyphen of the print');
	ok(K.lines[22] === nfc('Kiều càng sắc-sảo mặn-mà,') && K.lines[23] === nfc('so bề tài sắc lại là phần hơn.'), 'lines 23 and 24 have no comma inside, as printed');
	ok(K.meta.pages.every(function (p) { return /^https:\/\/upload\.wikimedia\.org\/.+\/page\d+-\d+px-.+\.jpg$/.test(p.image) && K.meta.sources.some(function (s) { return s.url === p.image; }); }),
		'each page names the image of the printed page it was compared with, and the image is among the sources');
	ok(/corrected/.test(K.meta.kept) && /tone mark/.test(K.meta.kept) && !/exactly as transcribed/.test(K.meta.kept), 'meta.kept says what was corrected and what could not be checked against the print');
	ok(!('translation' in K) && !('en' in K), 'no translation is included');
})();

/* ------------------------------------------------------------ sentences */
section = 'sentences';
(function () {
	var S = DATA.TEXTS_SENTENCES;
	if (!S) return;
	var SCRIPTS = {
		Latn: /\p{Script=Latin}/u, Cyrl: /\p{Script=Cyrillic}/u, Grek: /\p{Script=Greek}/u, Armn: /\p{Script=Armenian}/u,
		Arab: /\p{Script=Arabic}/u, Hebr: /\p{Script=Hebrew}/u, Deva: /\p{Script=Devanagari}/u, Beng: /\p{Script=Bengali}/u,
		Taml: /\p{Script=Tamil}/u, Thai: /\p{Script=Thai}/u, Khmr: /\p{Script=Khmer}/u, Geor: /\p{Script=Georgian}/u,
		Hang: /\p{Script=Hangul}/u, Jpan: /[\p{Script=Hiragana}\p{Script=Katakana}]/u, Hans: /\p{Script=Han}/u, Hant: /\p{Script=Han}/u
	};
	var langs = S.langs;
	ok(langs.length >= 38 && langs.length <= 55, langs.length + ' languages (about 40)');
	var codes = langs.map(function (l) { return l.code; });
	ok(new Set(codes).size === codes.length, 'codes are unique');
	none(langs.filter(function (l) { return !(isString(l.code) && isString(l.iso) && isString(l.name) && isString(l.family) && isString(l.branch) && SCRIPTS[l.script]); }), 'every language has code, iso, name, script, family and branch');
	none(langs.filter(function (l) { return l.sentences.length < 20 || l.sentences.length > 30; }).map(function (l) { return l.code + ': ' + l.sentences.length; }), 'every language has 20 to 30 sentences');
	var all = [];
	langs.forEach(function (l) { l.sentences.forEach(function (s) { all.push({ l: l, s: s }); }); });
	ok(all.length >= 800, all.length + ' sentences');
	none(all.filter(function (x) { return !(Number.isInteger(x.s.id) && x.s.id > 0); }).map(function (x) { return x.l.code; }), 'every sentence has a Tatoeba id');
	ok(new Set(all.map(function (x) { return x.s.id; })).size === all.length, 'no id twice');
	none(all.filter(function (x) { return !isString(x.s.by); }).map(function (x) { return x.s.id; }), 'every sentence names its owner');
	none(all.filter(function (x) { var t = x.s.text; return !isString(t) || t !== t.trim() || /[\n\r\t]/.test(t) || t !== nfc(t); }).map(function (x) { return x.s.id; }), 'every text is a single NFC line');
	none(all.filter(function (x) { return /\p{Nd}/u.test(x.s.text); }).map(function (x) { return x.s.id; }), 'no text contains a digit');
	none(all.filter(function (x) { return !SCRIPTS[x.l.script].test(x.s.text); }).map(function (x) { return x.l.code + ' ' + x.s.id; }), 'every text has letters of the script its language claims');
	none(all.filter(function (x) { return x.l.script !== 'Latn' && /\p{Script=Latin}/u.test(x.s.text); }).map(function (x) { return x.l.code + ' ' + x.s.id; }), 'no Latin letters in a sentence of another script');
	var seen = {}, twice = [];
	all.forEach(function (x) { if (seen[x.s.text] && seen[x.s.text] !== x.l.code) twice.push(x.s.text); seen[x.s.text] = x.l.code; });
	none(twice, 'no text appears under two languages');
	none(all.filter(function (x) { return !(x.s.en && Number.isInteger(x.s.en.id) && isString(x.s.en.text) && typeof x.s.en.by === 'string'); }).map(function (x) { return x.s.id; }), 'every sentence has an English translation with its own id');
	var need = ['dan', 'nob', 'ces', 'slk', 'bul', 'srp', 'zsm', 'ind', 'hin', 'mar', 'pes', 'ara', 'jpn', 'kor', 'cmn-Hans', 'cmn-Hant', 'vie'];
	none(need.filter(function (c) { return codes.indexOf(c) === -1; }), 'the pairs that are easy to confuse are all there');
	function lang(c) { return langs[codes.indexOf(c)]; }
	eq([lang('srp').script, lang('bul').script, lang('cmn-Hans').script, lang('cmn-Hant').script, lang('jpn').script, lang('kor').script], ['Cyrl', 'Cyrl', 'Hans', 'Hant', 'Jpan', 'Hang'], 'Serbian is Cyrillic; Chinese comes in both scripts');
	ok(new Set(langs.map(function (l) { return l.family; })).size >= 10, new Set(langs.map(function (l) { return l.family; })).size + ' families');
	ok(new Set(langs.map(function (l) { return l.script; })).size >= 12, new Set(langs.map(function (l) { return l.script; })).size + ' scripts');
	none([].concat.apply([], S.meta.lookalikes).filter(function (c) { return codes.indexOf(c) === -1; }), 'meta.lookalikes names only codes that exist');
	ok(/CC BY 2\.0 FR/.test(S.meta.licence) && /Tatoeba/.test(S.meta.credit), 'licence and credit name Tatoeba and CC BY 2.0 FR');
	ok(S.meta.sentenceUrl.indexOf('{id}') !== -1, 'meta.sentenceUrl is a pattern with {id}');
	// Every entry comes from self-declared native speakers: each API request carried the filter.
	var api = S.meta.sources.filter(function (s) { return /api\.tatoeba\.org/.test(s.url); });
	ok(api.length >= langs.length - 1, api.length + ' Tatoeba API responses are among the sources');
	none(api.filter(function (s) { return !/[?&]is_native=yes(&|$)/.test(s.url); }).map(function (s) { return s.url; }), 'every one of them was asked for with is_native=yes');
	none(langs.filter(function (l) { return !api.some(function (s) { return s.url.indexOf('lang=' + l.iso + '&') !== -1; }); }).map(function (l) { return l.code; }), 'every language has such a response');
	ok(codes.indexOf('swh') === -1 && !('anyOwner' in S.meta) && /Swahili/.test(S.meta.notIncluded || ''), 'Swahili, which had no native-speaker sentences to offer, is not an entry, and meta.notIncluded says why');
	eq(S.meta.oneOwner, langs.filter(function (l) { return new Set(l.sentences.map(function (s) { return s.by; })).size === 1; }).map(function (l) { return l.code; }), 'meta.oneOwner lists the entries that come from a single contributor');
	// The credit line is for the visitor; instructions for builders live elsewhere.
	ok(!/\b(show|put|use|link)\b/i.test(S.meta.credit) && !/for example/i.test(S.meta.credit), 'meta.credit holds no instruction to the builder');
	ok(S.meta.attribution === 'Tatoeba #{id} by {by}' && /en\.id/.test(S.meta.attributionNote) && /en\.by/.test(S.meta.attributionNote), 'meta.attribution is the pattern for crediting a sentence, and its note covers the translation');
	ok(/not always exact/.test(S.meta.translationNote || ''), 'meta.translationNote warns that the English translations are not always exact');
	var orphans = all.filter(function (x) { return x.s.en.by === ''; }).length;
	ok(orphans < all.length / 20, orphans + ' translations have no owner; the rest name theirs');
})();

/* ------------------------------------------------------------ CMU */
section = 'cmu';
(function () {
	var C = DATA.TEXTS_CMU;
	if (!C) return;
	var words = Object.keys(C.w);
	eq(words.length, 30000, '30,000 words');
	eq(Object.keys(C.phones).length, 39, '39 phonemes');
	none(Object.keys(C.phones).filter(function (p) { return ['vowel', 'stop', 'affricate', 'fricative', 'aspirate', 'liquid', 'nasal', 'semivowel'].indexOf(C.phones[p]) === -1; }), 'every phoneme has one of the eight classes');
	eq(Object.keys(C.phones).filter(function (p) { return C.phones[p] === 'vowel'; }).length, 15, '15 of them vowels');
	var bad = [];
	words.forEach(function (w) {
		var parts = String(C.w[w]).split(' ');
		for (var i = 0; i < parts.length; i++) {
			var m = /^([A-Z]+)([012])?$/.exec(parts[i]);
			if (!m || !C.phones[m[1]] || ((C.phones[m[1]] === 'vowel') !== (m[2] !== undefined))) { bad.push(w + ' = ' + C.w[w]); return; }
		}
	});
	none(bad, 'every entry parses into known phonemes, vowels with a stress digit and consonants without');
	none(words.filter(function (w) { return !/^[a-z]+$/.test(w); }), 'keys are lower-case words');
	eq([C.w.the, C.w.cat, C.w.zarathustra === undefined ? 'absent' : 'present'], ['DH AH0', 'K AE1 T', 'absent'], 'the = DH AH0, cat = K AE1 T');
	eq(words.slice(0, 5), ['the', 'of', 'and', 'to', 'a'], 'keys start the, of, and, to, a');
	var freqFile = path.join(ROOT, 'misc', '18-zipf-karaoke', 'freq.js');
	if (fs.existsSync(freqFile)) {
		var sb = { window: {} };
		vm.runInNewContext(fs.readFileSync(freqFile, 'utf8'), sb);
		var order = {};
		sb.window.ZIPF_FREQ.words.split(' ').forEach(function (w, i) { order[w] = i; });
		none(words.filter(function (w) { return !Object.prototype.hasOwnProperty.call(order, w); }), 'every key is a word of misc/18-zipf-karaoke/freq.js');
		var inOrder = true;
		for (var i = 1; i < words.length; i++) if (order[words[i]] < order[words[i - 1]]) inOrder = false;
		ok(inOrder, 'keys are in the order of that frequency list');
		eq(order[words[words.length - 1]] + 1, 36275, 'the last key has rank 36,275 there, as meta says');
	} else {
		skip('misc/18-zipf-karaoke/freq.js is not there, order not checked');
	}
	none(C.blocked.filter(function (w) { return !Object.prototype.hasOwnProperty.call(C.w, w); }), 'every blocked word is still in w (flagged, not removed)');
	ok(C.blocked.length > 50 && C.blocked.indexOf('fuck') !== -1 && C.blocked.indexOf('the') === -1, C.blocked.length + ' blocked words');
	eq(C.meta.blockedCount, C.blocked.length, 'meta.blockedCount');
	ok(new Set(C.blocked).size === C.blocked.length, 'no blocked word twice');
	var at = {};
	words.forEach(function (w, i) { at[w] = i; });
	var rising = true;
	for (var b = 1; b < C.blocked.length; b++) if (at[C.blocked[b]] < at[C.blocked[b - 1]]) rising = false;
	ok(rising, 'blocked is in frequency order');
	// The words a review found unflagged on 2026-10-05, when blocked held only exact matches of the published list.
	var found = ['blowjobs', 'fucked', 'dildos', 'piss', 'dicks', 'sluts', 'homo', 'nazi', 'hitler', 'fucks', 'pussies', 'queer', 'raped', 'whores', 'fuckers', 'nazis', 'dyke', 'retarded', 'fucker', 'jap', 'retard'];
	none(found.filter(function (w) { return !Object.prototype.hasOwnProperty.call(C.w, w) || C.blocked.indexOf(w) === -1; }), 'the ' + found.length + ' inflected forms, slurs and names the review named are in w and blocked');
	// No flagged stem may hide inside an unflagged word. The exceptions are read, not guessed:
	// ordinary words and names that merely contain the letters.
	var stems = ['fuck', 'shit', 'cunt', 'whore', 'slut', 'nigg', 'nazi', 'hitler', 'blowjob', 'dildo', 'asshole', 'bitch', 'porn', 'orgasm', 'masturb', 'masterb'];
	var innocent = { matsushita: 1 };
	none(words.filter(function (w) { return C.blocked.indexOf(w) === -1 && !innocent[w] && stems.some(function (s) { return w.indexOf(s) !== -1; }); }),
		'no unflagged word contains one of ' + stems.length + ' flagged stems (fuck, shit, whore, slut, nazi, ...)');
	ok(C.blocked.indexOf('damn') === -1 && C.blocked.indexOf('idiot') === -1 && C.blocked.indexOf('gay') === -1 && C.blocked.indexOf('dickens') === -1 && C.blocked.indexOf('essex') === -1,
		'mild words, mild insults, neutral words for people and names that only contain a stem are not blocked');
	ok(/LDNOOBW/.test(C.meta.credit) && /Norvig/.test(C.meta.credit) && /CMU Pronouncing Dictionary/.test(C.meta.credit), 'meta.credit names all three sources: the dictionary, the frequency order and the blocked list');
	var head = lf(fs.readFileSync(path.join(HERE, 'cmu-phones.js'), 'utf8')).slice(0, 3000);
	ok(/Copyright \(C\) 1993-2015 Carnegie Mellon University/.test(head) && /Redistributions of source code must retain/.test(head) && /THIS SOFTWARE IS PROVIDED BY CARNEGIE MELLON UNIVERSITY/.test(head), 'the file carries the CMUdict copyright notice, conditions and disclaimer');
})();

/* ------------------------------------------------------------ glosses (optional) */
section = 'glosses-de';
(function () {
	var G = DATA.TEXTS_GLOSSES_DE;
	if (!G) return;
	var F = DATA.TEXTS_FREQ_DE;
	var forms = Object.keys(G.g);
	ok(forms.length > 1000, forms.length + ' forms have a gloss');
	if (F) {
		var top = {};
		F.words.slice(0, 5000).forEach(function (w) { top[w] = true; });
		none(forms.filter(function (w) { return !top[w]; }), 'every glossed form is among the 5,000 most frequent of freq-de.js');
		none(F.blocked.filter(function (w) { return Object.prototype.hasOwnProperty.call(G.g, w); }), 'no blocked form has a gloss');
		eq(G.meta.forms, 5000, 'meta.forms is 5,000');
		eq(G.meta.glossed, forms.length, 'meta.glossed counts the forms');
		var tokens = 0, glossed = 0;
		F.words.slice(0, 5000).forEach(function (w, i) { tokens += F.counts[i]; if (G.g[w]) glossed += F.counts[i]; });
		eq(G.meta.tokenShare, Math.round(1000 * glossed / tokens) / 1000, 'meta.tokenShare is the share of the tokens of those 5,000 forms that have a gloss');
	}
	none(forms.filter(function (w) {
		var e = G.g[w];
		return !Array.isArray(e) || e.length < 1 || e.length > 3 || e.some(function (x) { return !(Array.isArray(x) && x.length === 2 && isString(x[0]) && isString(x[1])); });
	}), 'every entry is a list of one to three [headword, gloss] pairs');
	none(forms.filter(function (w) { return G.g[w].some(function (x) { return x[1].split('; ').length > 3 || /[#\[\]{}|<>]/.test(x[1]); }); }), 'a gloss is at most three translations and holds no markup');
	none(forms.filter(function (w) { return w.length < 2; }), 'no one-letter form has a gloss');
	var maenner = 'm' + String.fromCharCode(0xE4) + 'nner';
	eq([G.g.ist && G.g.ist[0][0], G.g.hat && G.g.hat[0][0], G.g.haus && G.g.haus[0][0], G.g[maenner] && G.g[maenner][0][0]], ['sein', 'haben', 'Haus', 'Mann'], 'ist is glossed under sein, hat under haben, haus under Haus, ' + maenner + ' under Mann');
	ok(!!G.g.weg && G.g.weg.length === 2, 'weg has two headwords (Weg and weg)');
	ok(G.g.des === undefined && G.g.john === undefined, 'des and john have no gloss');
	if (DATA.TEXTS_CMU) {
		var rude = {};
		DATA.TEXTS_CMU.blocked.forEach(function (w) { rude[w] = true; });
		none(forms.filter(function (w) {
			return G.g[w].some(function (x) { return (x[1].toLowerCase().match(/[a-z]+/g) || []).some(function (t) { return rude[t]; }); });
		}), 'no gloss contains a word that cmu-phones.js blocks');
	}
	ok(/CC BY-SA/.test(G.meta.licence) && /WikDict/.test(G.meta.credit), 'licence and credit name WikDict and CC BY-SA');
	var hashes = (G.meta.batches || {}).sha256 || [];
	var combined = require('crypto').createHash('sha256').update(hashes.join('')).digest('hex');
	ok(hashes.length === 100 && G.meta.sources.some(function (s) { return s.sha256 === combined && /\{titles\}$/.test(s.url); }), 'the 100 Wiktionary answers are recorded: one hash each, and the source entry holds the hash of those hashes');
	none(hashes.filter(function (h) { return licenses.indexOf(h) === -1; }), 'LICENSES.md lists each of those 100 hashes');
})();

/* ------------------------------------------------------------ docs */
section = 'docs';
ok(readme.length > 0, 'README.md exists');
ok(licenses.length > 0, 'LICENSES.md exists');
(function () {
	var rows = readme.match(/^\| `[\w.-]+\.js` \|.*$/gm) || [];
	var present = FILES.filter(function (f) { return fs.existsSync(path.join(HERE, f.file)); });
	eq(rows.length, present.length, 'the README table has one row per data file');
	var onDisk = fs.readdirSync(HERE).filter(function (n) { return /\.js$/.test(n) && n !== 'test.js'; }).sort();
	eq(onDisk, present.map(function (f) { return f.file; }).sort(), 'the folder holds exactly the data files this test knows');
	ok(!fs.existsSync(path.join(HERE, '.cache')), 'no download cache inside misc/_texts');
})();
(function () {
	// The lookup examples of README.md, run as they are printed, on words that are no entry
	// but are properties of every plain object. A toy that looks up typed text meets them.
	var blocks = (readme.match(/```js\n[\s\S]*?```/g) || []).map(function (b) { return b.replace(/^```js\n/, '').replace(/```$/, ''); });
	function block(marker) { return blocks.filter(function (b) { return b.indexOf(marker) !== -1; })[0] || null; }
	var hitsSrc = block('function hits('), glossSrc = block('function glossOf(');
	if (!ok(!!hitsSrc && !!glossSrc, 'README.md has the two lookup examples, hits() and glossOf()')) return;
	if (!DATA.TEXTS_CMU || !DATA.TEXTS_GLOSSES_DE) { skip('a data file is missing, README examples not run'); return; }
	var sb = { window: { TEXTS_CMU: DATA.TEXTS_CMU, TEXTS_GLOSSES_DE: DATA.TEXTS_GLOSSES_DE }, out: null };
	var threw = null;
	try {
		vm.runInNewContext(hitsSrc + '\n' + glossSrc + '\nout = JSON.stringify({' +
			'proto: hits("__proto__"), ctor: hits("constructor"), cat: hits("cat"), nope: hits("qqqq"),' +
			'gProto: glossOf("__proto__"), gCtor: glossOf("constructor"), gToString: glossOf("toString"), gMacht: glossOf("Macht") });', sb);
	} catch (err) { threw = err; }
	if (!ok(!threw, 'the README examples run without throwing on "__proto__" and "constructor"' + (threw ? ': ' + threw.message : ''))) return;
	var out = JSON.parse(sb.out);
	eq([out.proto, out.nope], [null, null], 'hits("__proto__") is null, like any word that is not in the dictionary');
	eq(out.ctor && out.ctor.map(function (h) { return h.phone; }).join(' '), DATA.TEXTS_CMU.w.constructor.replace(/[012]/g, ''), 'hits("constructor") gives the phonemes of the real entry "constructor"');
	eq(out.cat, [{ phone: 'K', kind: 'stop', stress: -1 }, { phone: 'AE', kind: 'vowel', stress: 1 }, { phone: 'T', kind: 'stop', stress: -1 }], 'hits("cat") is K stop, AE vowel with stress 1, T stop');
	eq([out.gProto, out.gCtor, out.gToString], ['', '', ''], 'glossOf("__proto__"), glossOf("constructor") and glossOf("toString") are empty');
	var m = /glossOf\('Macht'\);\s*\/\/ '([^']+)'/.exec(glossSrc);
	ok(!!m && out.gMacht === m[1], 'glossOf("Macht") gives what README.md prints: ' + out.gMacht);
})();
(function () {
	// The sentence example credits the translation to its own author.
	var blocks = (readme.match(/```js\n[\s\S]*?```/g) || []);
	var ex = blocks.filter(function (b) { return b.indexOf('TEXTS_SENTENCES') !== -1 && b.indexOf('credit(') !== -1; })[0] || '';
	ok(/s\.en\.id/.test(ex) && /s\.en\.by/.test(ex), 'the README sentence example shows the translation with its own number and owner (s.en.id, s.en.by)');
	ok(!/s\.by \+ ': ' \+ s\.en\.text/.test(ex), 'and no longer prints the translation under the owner of the sentence');
	none(['https://creativecommons.org/licenses/by/2.0/fr/', 'https://creativecommons.org/licenses/by/4.0/', 'https://creativecommons.org/licenses/by-sa/3.0/', 'https://creativecommons.org/licenses/by-sa/4.0/'].filter(function (u) { return licenses.indexOf(u) === -1; }),
		'LICENSES.md gives the address of each Creative Commons licence it names');
	ok(readme.indexOf('creativecommons.org/licenses/') !== -1, 'README.md links the Creative Commons licences too');
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed' + (skipped ? ', ' + skipped + ' skipped' : ''));
process.exit(failed ? 1 : 0);
