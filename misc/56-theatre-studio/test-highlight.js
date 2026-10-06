/*
 * node misc/56-theatre-studio/test-highlight.js
 * The tokenizer behind the Studio's editor: every line of every story tokenises back to itself, the speaker lines,
 * labels and jumps it finds agree with what vn.js parses, a table of sample lines gives the expected token types,
 * and completion offers what the grammar allows.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var HL = require('./vn-highlight.js');
var VN = require('../55-paper-theatre/vn.js');

var pass = 0, fail = 0;
function ok(cond, name, detail) {
	if (cond) { pass++; return true; }
	fail++;
	console.log('FAIL ' + name + (detail ? '\n     ' + detail : ''));
	return false;
}
function eq(a, b, name) {
	var A = JSON.stringify(a), B = JSON.stringify(b);
	return ok(A === B, name, 'got      ' + A + '\n     expected ' + B);
}

var STORIES = path.join(__dirname, '..', '55-paper-theatre', 'stories');
function walkDir(dir) {
	var out = [];
	fs.readdirSync(dir).forEach(function (n) {
		var p = path.join(dir, n), st = fs.statSync(p);
		if (st.isDirectory()) out = out.concat(walkDir(p));
		else if (/\.vn$/.test(n)) out.push(p);
	});
	return out;
}
function ctxLines(text) {
	var lines = text.split(/\r\n|\r|\n/);
	return lines.map(function (l, i) { return { text: l, cont: i > 0 && !!lines[i - 1].trim() }; });
}

/* ---- 1. every line of every story round-trips ---- */

var files = walkDir(STORIES).sort();
var types = {}, nLines = 0, roundTrip = 0, badType = 0, emptyTok = 0;
HL.TYPES.forEach(function (t) { types[t] = 0; });
ok(files.length >= 10, 'found the stories', files.length + ' files');
ok(files.some(function (f) { return /_demo-effects\.vn$/.test(f); }), 'includes _demo-effects.vn');
ok(files.some(function (f) { return /_facts[\\\/]/.test(f); }), 'includes _facts/');

files.forEach(function (file) {
	var text = fs.readFileSync(file, 'utf8');
	var cast = HL.castOf(text);
	ctxLines(text).forEach(function (l, i) {
		[cast, null].forEach(function (c) {
			nLines++;
			var toks = HL.tokenize(l.text, { cast: c, cont: l.cont });
			var back = toks.map(function (t) { return t.text; }).join('');
			if (back === l.text) roundTrip++;
			else ok(false, 'round trip ' + path.basename(file) + ':' + (i + 1), JSON.stringify(l.text) + ' -> ' + JSON.stringify(back));
			toks.forEach(function (t) {
				if (!types.hasOwnProperty(t.type)) { badType++; ok(false, 'known type at ' + path.basename(file) + ':' + (i + 1), t.type); }
				else types[t.type]++;
				if (!t.text) emptyTok++;
			});
			// toHTML gives back the same characters once the tags are removed and entities decoded
			var html = HL.toHTML(toks).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
			if (html !== l.text) ok(false, 'toHTML ' + path.basename(file) + ':' + (i + 1));
		});
	});
});
ok(roundTrip === nLines, 'every line of ' + files.length + ' files tokenises back to itself', roundTrip + ' / ' + nLines);
ok(badType === 0, 'every token type is a known one');
ok(emptyTok === 0, 'no empty tokens');
['directive', 'speaker', 'face', 'chip', 'fact', 'em', 'code', 'comment', 'option', 'arrow', 'target', 'label', 'cond', 'arg', 'name', 'number', 'string', 'thought']
	.forEach(function (t) { ok(types[t] > 0, 'the stories exercise "' + t + '"', String(types[t])); });
console.log('     ' + files.length + ' files, ' + (nLines / 2) + ' lines (tokenised twice: with and without the cast)');

/* ---- 2. agreement with vn.js: speakers, narration, labels, jumps, directives ---- */

var agree = 0, disagree = 0;
files.forEach(function (file) {
	var text = fs.readFileSync(file, 'utf8');
	var includes = {};
	text.replace(/^\s*@include\s+(\S+)/gm, function (m, p) { try { includes[p] = fs.readFileSync(path.join(STORIES, p), 'utf8'); } catch (e) { /* missing */ } return m; });
	var prog = VN.parse(text, { id: path.basename(file), includes: includes });
	var lines = ctxLines(text), cast = {};
	Object.keys(prog.cast).forEach(function (k) { cast[k] = prog.cast[k].id; });
	prog.ops.forEach(function (op) {
		if (!op.line) return;
		var l = lines[op.line - 1];
		if (!l) return;
		var toks = HL.tokenize(l.text, { cast: cast, cont: l.cont });
		var of = function (type) { return toks.filter(function (t) { return t.type === type; }).map(function (t) { return t.text; }); };
		var good = true;
		if (op.kind === 'say') good = of('speaker').length === 1 && of('speaker')[0].toLowerCase() === op.key;
		else if (op.kind === 'narrate') good = of('speaker').length === 0;
		else if (op.kind === 'label') good = of('label')[0] === op.name;
		else if (op.kind === 'goto') good = of('target')[0] === op.target;
		else if (op.kind === 'menu') good = of('option').length === 1;
		else if (op.kind !== 'end' || !op.implicit) good = of('directive').length === 1 || op.kind === 'menu';
		if (good) agree++;
		else { disagree++; if (disagree < 8) ok(false, 'agrees with vn.js at ' + path.basename(file) + ':' + op.line + ' (' + op.kind + ')', JSON.stringify(toks)); }
	});
});
ok(disagree === 0, 'speaker, narration, label, jump, option and directive lines agree with vn.js', agree + ' ops agree, ' + disagree + ' differ');

/* ---- 3. sample lines ---- */

var CAST = { jack: 'Jack', model: 'Model', you: 'You' };
function kinds(line, opts) {
	return HL.tokenize(line, opts || { cast: CAST }).filter(function (t) { return t.type !== 'ws'; }).map(function (t) { return t.type + ':' + t.text; });
}
var SAMPLES = [
	['@title Do Machines Struggle Where Humans Do?', ['directive:@title', 'text: Do Machines Struggle Where Humans Do?']],
	['@bg classroom dusk board=text', ['directive:@bg', 'arg:classroom', 'arg:dusk', 'arg:board', 'punct:=', 'value:text']],
	['@bg attic', ['directive:@bg', 'unknown:attic']],
	['@show Jack left (smile) near', ['directive:@show', 'name:Jack', 'arg:left', 'punct:(', 'face:smile', 'punct:)', 'arg:near']],
	['@show Ghost', ['directive:@show', 'unknown:Ghost']],
	['@cast Model name="a reasoning-tuned model" lattice=sparse hue=192', ['directive:@cast', 'name:Model', 'arg:name', 'punct:=', 'string:"a reasoning-tuned model"', 'arg:lattice', 'punct:=', 'value:sparse', 'arg:hue', 'punct:=', 'number:192']],
	['@fact human_l0 = 40.5% ^§4', ['directive:@fact', 'fact:human_l0', 'punct:=', 'text:40.5%', 'chip:^§4']],
	['@cg screen-code night text=total | The *inside* {human_l0}', ['directive:@cg', 'arg:screen-code', 'arg:night', 'arg:text', 'punct:=', 'value:total', 'punct:|', 'text: The ', 'em:*inside*', 'text: ', 'fact:{human_l0}']],
	['@transition fade 1200', ['directive:@transition', 'arg:fade', 'number:1200']],
	['@fx petals on', ['directive:@fx', 'arg:petals', 'arg:on']],
	['@tone sepia', ['directive:@tone', 'unknown:sepia']],
	['@if seen == 1 -> later', ['directive:@if', 'var:seen', 'punct:==', 'value:1', 'arrow:->', 'target:later']],
	['@set mood = calm', ['directive:@set', 'var:mood', 'punct: = ', 'value:calm']],
	['@chapter 2 Seventy-Five Minutes', ['directive:@chapter', 'number:2', 'text:Seventy-Five Minutes']],
	['@card Result | humans: {human_l0} | models: 51% ^§5', ['directive:@card', 'text: Result ', 'punct:|', 'text: humans: ', 'fact:{human_l0}', 'text: ', 'punct:|', 'text: models: 51%', 'chip:^§5']],
	['@code js | var x = 1; | x++', ['directive:@code', 'arg:js', 'punct:|', 'code: var x = 1; ', 'punct:|', 'code: x++']],
	['@flashback on Spring, the study room', ['directive:@flashback', 'arg:on', 'text:Spring, the study room']],
	['@wibble x', ['unknown:@wibble', 'text: x']],
	['Jack: Obfuscation is almost always measured without people. ^§1', ['speaker:Jack', 'punct::', 'text:Obfuscation is almost always measured without people.', 'chip:^§1']],
	['Jack (smile): Before the numbers, place a *bet*.', ['speaker:Jack', 'punct:(', 'face:smile', 'punct:):', 'text:Before the numbers, place a ', 'em:*bet*', 'text:.']],
	['Jack (grin): Hm.', ['speaker:Jack', 'punct:(', 'unknown:grin', 'punct:):', 'text:Hm.']],
	['Model: (I should not say this.)', ['speaker:Model', 'punct::', 'thought:(I should not say this.)']],
	['Result: the rain kept on.', ['unknown:Result', 'text:: the rain kept on.']],
	['Nearly three: the rain kept on.', ['text:Nearly three: the rain kept on.']],
	['Overall, accuracy fell from {human_l0} to {human_l3}. ^§4', ['text:Overall, accuracy fell from ', 'fact:{human_l0}', 'text: to ', 'fact:{human_l3}', 'text:.', 'chip:^§4']],
	['The name `_lastNSecs` again. ^p.2', ['text:The name ', 'code:`_lastNSecs`', 'text: again.', 'chip:^p.2']],
	['A paragraph of the post. ^¶3', ['text:A paragraph of the post.', 'chip:^¶3']],
	['Said in other words. ^para', ['text:Said in other words.', 'chip:^para']],
	['* Harder tier, lower accuracy. Always. -> bet_monotonic', ['option:*', 'text:Harder tier, lower accuracy. Always.', 'arrow:->', 'target:bet_monotonic']],
	['* (once) (if seen != 1) Ask again -> hub', ['option:*', 'punct:(', 'cond:once', 'punct:)', 'punct:(', 'cond:if', 'var:seen', 'punct:!=', 'value:1', 'punct:)', 'text:Ask again', 'arrow:->', 'target:hub']],
	['* An option with no target', ['option:*', 'text:An option with no target']],
	['== bet_language', ['label-mark:==', 'label:bet_language']],
	['-> humans', ['arrow:->', 'target:humans']],
	['# a comment: Jack: not a line', ['comment:# a comment: Jack: not a line']],
	['# note: Ask the room to bet before the numbers.', ['note:# note: Ask the room to bet before the numbers.']],
	['@music nocturne', ['directive:@music', 'arg:nocturne']],
	['@sfx boom', ['directive:@sfx', 'unknown:boom']],
	['あいうえお かきくけこ ^§2', ['text:あいうえお かきくけこ', 'chip:^§2']],
	['Jack: 「紙芝居」*あいう*。', ['speaker:Jack', 'punct::', 'text:「紙芝居」', 'em:*あいう*', 'text:。']]
];
SAMPLES.forEach(function (s) { eq(kinds(s[0]), s[1], 'sample ' + JSON.stringify(s[0])); });

// continuation lines are text whatever they start with; an indented line after a blank one is a statement
eq(kinds('  @bg lab and more words', { cast: CAST, cont: true }), ['text:@bg lab and more words'], 'continuation is text');
eq(kinds('  -> nowhere', { cast: CAST, cont: true }), ['text:-> nowhere'], 'continuation arrow is text');
eq(kinds('  @bg lab', { cast: CAST, cont: false }), ['directive:@bg', 'arg:lab'], 'indented after a blank line is a statement');
// without a cast list, a single capitalised word before the colon is taken for a speaker
eq(kinds('Proctor: Time.', {}), ['speaker:Proctor', 'punct::', 'text:Time.'], 'speaker without a cast list');
eq(kinds('http://example.org: x', { cast: CAST }), ['text:http://example.org: x'], 'a URL is not a speaker');
eq(HL.tokenize('', {}), [], 'empty line');
eq(HL.tokenize('   ', {}), [{ type: 'ws', text: '   ' }], 'blank line');
eq(HL.tokenize('Jack: hi  ', { cast: CAST }).map(function (t) { return t.type; }), ['speaker', 'punct', 'ws', 'text', 'ws'], 'trailing blanks are ws');
eq(HL.toHTML(HL.tokenize('Jack: a < b & c', { cast: CAST })), '<span class="t-speaker">Jack</span><span class="t-punct">:</span> a &lt; b &amp; c', 'toHTML escapes');

/* ---- 4. castOf ---- */

eq(HL.castOf('@cast Jack hue=210\n@cast Model name="x"\n  @cast NotACast\n\n  @cast Indented\n@cast "Participant 23" hue=4'),
	{ jack: 'Jack', model: 'Model', indented: 'Indented', 'participant 23': 'Participant 23' }, 'castOf');

/* ---- 5. completion ---- */

var DATA = { cast: ['Jack', 'Model', 'You'], facts: ['human_l0', 'human_l3', 'n_humans'], labels: ['humans', 'bet_language', 'bet_monotonic'] };
function labels(before, force) { var r = HL.suggest(before, DATA, force); return r ? r.items.map(function (i) { return i.label; }) : null; }
function from(before) { var r = HL.suggest(before, DATA); return r ? r.from : null; }
eq(labels('@b'), ['bg'], 'directive after @');
eq(HL.suggest('@b', DATA).items[0].insert, 'bg ', 'a directive that takes words gets a space');
eq(labels('@en'), ['end'], '@end');
eq(HL.suggest('@en', DATA).items[0].insert, 'end', 'a directive without words gets none');
eq(labels('@bg cl'), ['classroom'], 'background name');
eq(labels('@bg classroom d').sort(), ['dawn', 'dim', 'dusk'], 'background modifiers');
eq(labels('@bg classroom b'), ['board=plot', 'board=text', 'board=blank'], 'board options');
eq(labels('@cg w'), ['window-rain'], 'cg name');
eq(labels('@tone c'), ['cold'], 'tone');
eq(labels('@fx s'), ['snow', 'shake'], 'fx');
eq(labels('@fx snow o'), ['on', 'off'], 'fx on/off');
eq(labels('@transition w'), ['white', 'wipe-left', 'wipe-right'], 'transition');
eq(labels('@music t'), ['theme', 'tender', 'tension'], 'music');
eq(labels('@show J'), ['Jack'], 'show a name');
eq(labels('@show Jack (s'), ['(smile)', '(surprised)'], 'show a face');
eq(labels('@move Jack l'), ['left'], 'move slot');
eq(labels('@hide '), ['Jack', 'Model', 'You', 'all'], 'hide');
eq(labels('Ja'), ['Jack'], 'name at the start of a line');
eq(labels('Jack'), null, 'a complete name offers nothing');
eq(labels('', true), ['Jack', 'Model', 'You'], 'Ctrl+Space on an empty line lists the cast');
eq(labels(''), null, 'nothing unasked on an empty line');
eq(labels('Jack ('), ['neutral', 'smile', 'puzzled', 'worried', 'surprised', 'thinking', 'deadpan', 'laugh'], 'faces after Name (');
eq(HL.suggest('Jack (sm', DATA).items[0].insert, 'smile): ', 'a face closes the parenthesis');
eq(labels('Nobody ('), null, 'no faces for an undeclared name');
eq(labels('-> b'), ['bet_language', 'bet_monotonic'], 'labels after ->');
eq(labels('-> e'), ['end'], '-> end');
eq(labels('* Go on -> h'), ['humans'], 'labels in an option');
eq(labels('@if x == 1 -> bet_l'), ['bet_language'], 'labels in @if');
eq(from('* Go on -> h'), 11, 'the replacement starts at the partial word');
eq(labels('Accuracy was {hu'), ['human_l0', 'human_l3'], 'fact keys after {');
eq(labels('Accuracy was {'), ['human_l0', 'human_l3', 'n_humans', 'Jack', 'Model', 'You'], 'facts then names after {');
eq(labels('Jack: we said {h'), ['human_l0', 'human_l3'], 'facts inside a speaker line');
eq(labels('# @b'), null, 'nothing in a comment');
eq(labels('The rain'), null, 'nothing inside narration');

console.log((fail ? 'FAIL' : 'PASS') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
