// node misc/56-theatre-studio/test-cast-line.js
// Round-trips every @cast line in ../55-paper-theatre/stories/*.vn through panels/cast-line.js and compares
// the declaration VN.parse makes of the original line with the one it makes of the line given back.
'use strict';
var fs = require('fs');
var path = require('path');
var VN = require('../55-paper-theatre/vn.js');
var CL = require('./panels/cast-line.js');

var passed = 0, failed = 0;
function ok(cond, name, detail) {
	if (cond) { passed++; return true; }
	failed++;
	console.log('FAIL ' + name + (detail ? '\n     ' + detail : ''));
	return false;
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// the declaration VN.parse makes of a line inside a minimal story
function vnDecl(line) {
	var p = VN.parse('@title t\n@kind blog\n' + line + '\n');
	var keys = Object.keys(p.cast);
	return keys.length ? CL.declFields(p.cast[keys[keys.length - 1]]) : null;
}

/* ---- every @cast line in the published and draft stories ---- */
var dir = path.join(__dirname, '..', '55-paper-theatre', 'stories');
var files = fs.readdirSync(dir).filter(function (f) { return /\.vn$/.test(f); }).sort();
var lines = 0, exact = 0;
files.forEach(function (f) {
	var text = fs.readFileSync(path.join(dir, f), 'utf8');
	// the declarations VN.parse makes of the whole story, keyed by their line
	var whole = VN.parse(text, { resolveInclude: function (p) { try { return fs.readFileSync(path.join(dir, p), 'utf8'); } catch (e) { return null; } } });
	var byLine = {};
	Object.keys(whole.cast).forEach(function (k) { byLine[whole.cast[k].line] = whole.cast[k]; });
	CL.allCast(text).forEach(function (c) {
		lines++;
		var name = f + ':' + c.line + ' ' + c.text;
		var form = CL.parse(c.text);
		ok(!!form, name + ' parses');
		if (!form) return;
		var back = CL.format(form);
		var orig = CL.declFields(byLine[c.line]);
		ok(!!orig, name + ' is a declaration in VN.parse of the whole story');
		var fromBack = vnDecl(back);
		ok(same(orig, fromBack), name + ' round-trips to the same declaration', 'gave: ' + back + '\n     want ' + JSON.stringify(orig) + '\n     got  ' + JSON.stringify(fromBack));
		ok(same(CL.declFields(CL.toDecl(form)), orig), name + ' toDecl(form) matches');
		ok(same(CL.parse(back), form), name + ' format is a fixed point of parse');
		ok(CL.issuesFor(back).length === 0, name + ' gives no issue', JSON.stringify(CL.issuesFor(back)));
		if (back === c.text) exact++;
	});
});
ok(lines >= 50, 'found the @cast lines of the stories (' + lines + ')');
console.log('     ' + lines + ' @cast lines in ' + files.length + ' files; ' + exact + ' came back character for character');

/* ---- Jack's line comes back exactly ---- */
var JACK = '@cast Jack hue=210 skin=2 masc hairhue=25 hairtone=dark glasses short hoodie';
ok(CL.format(CL.parse(JACK)) === JACK, 'Jack round-trips character for character');
ok(CL.presets()[0].label === 'Jack' && CL.presets()[0].line === JACK, 'the first preset is Jack');
CL.presets().forEach(function (p) { ok(CL.format(CL.parse(p.line)) === p.line && CL.issuesFor(p.line).length === 0, 'preset ' + p.label + ' is clean and stable'); });

/* ---- engine semantics mirrored ---- */
var cases = [
	'@cast A hue=400 skin=9 hair=long',
	'@cast B lattice lattice=dense',
	'@cast C lattice=whatever',
	'@cast D hairtone=purple short long',
	'@cast E name="two words" coauthor fem masc',
	'@cast F hue=x glasses glasses hat bun uniform coat',
	'@cast G foo="a b" bar wibble=3',
	'@cast H name=""',
	'@cast I player page hue=-30',
	'@cast J skin=0 hairhue=725'
];
cases.forEach(function (c) {
	var f = CL.parse(c), back = CL.format(f);
	ok(same(vnDecl(c), vnDecl(back)), 'semantics kept: ' + c, back);
});
ok(same(CL.parse('@cast G foo="a b" bar').extra, ['foo=a b', 'bar']), 'unknown tokens are kept');
ok(CL.issuesFor('@cast G bar').length === 1 && CL.issuesFor('@cast G bar')[0].code === 'cast-trait-unknown', 'issuesFor reports an unknown trait');
ok(CL.parse('@title x') === null && CL.parse('') === null && CL.parse('@cast') === null, 'non-cast lines give null');
ok(CL.parse('  @cast K short').id === 'K', 'leading space tolerated');
ok(CL.format(CL.parse('@cast K name="say \\"hi\\""')).indexOf('"') > 0, 'quotes in a name do not break the line');

/* ---- a blank form gives a line VN.parse accepts ---- */
var b = CL.blank(); b.id = 'Ada';
ok(CL.format(b) === '@cast Ada', 'a blank form is a bare name');
ok(CL.issuesFor(CL.format(b)).length === 0, 'and has no issue');
VN.HAIR.forEach(function (h) { var f = CL.blank(); f.id = 'X'; f.hair = h; ok(CL.toDecl(f).hair === h, 'hair ' + h); });
VN.CLOTHES.forEach(function (h) { var f = CL.blank(); f.id = 'X'; f.clothes = h; ok(CL.toDecl(f).clothes === h, 'clothes ' + h); });
VN.HAIRTONES.forEach(function (h) { var f = CL.blank(); f.id = 'X'; f.hairtone = h; f.hairhue = 25; ok(CL.toDecl(f).hairtone === h, 'hairtone ' + h); });

/* ---- ids ---- */
ok(CL.checkId('Jack') === '' && CL.checkId('P23') === '' && CL.checkId('the-one') === '', 'good ids pass');
ok(CL.checkId('') !== '' && CL.checkId('two words') !== '' && CL.checkId('9lives') !== '' && CL.checkId('A:b') !== '', 'bad ids are refused');

/* ---- where a new line goes, and which line the cursor is on ---- */
var story = [
	'# a comment',          // 1
	'@title T',             // 2
	'@kind paper',          // 3
	'@cast Jack hue=210',   // 4
	'@cast Model lattice',  // 5
	'  hue=192',            // 6 (continuation)
	'@fact a = 1 ^§1',      // 7
	'',                     // 8
	'@bg lab',              // 9
	'Jack: hi',             // 10
	'@cast Late short'      // 11 (in the body: not a header line)
].join('\n');
ok(CL.insertAfter(story) === 6, 'a new @cast goes after the last header @cast and its continuation (6)', String(CL.insertAfter(story)));
ok(CL.insertAfter('@title T\n@kind blog\n\nNarration.') === 2, 'no @cast: after the last header directive');
ok(CL.insertAfter('Narration first.') === 0, 'no header: at the top');
ok(CL.insertAfter('') === 0, 'empty text: at the top');
var at = CL.castAt(story, 6);
ok(at && at.line === 5 && at.end === 6 && at.form.lattice === 'sparse' && at.form.hue === 192, 'castAt on a continuation finds its statement');
ok(CL.castAt(story, 7) === null && CL.castAt(story, 8) === null, 'castAt elsewhere is null');
ok(CL.findCast(story, 'model').line === 5, 'findCast is case-insensitive');
ok(CL.allCast(story).length === 3, 'allCast finds three');

console.log((failed ? 'FAIL' : 'PASS') + ': ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
