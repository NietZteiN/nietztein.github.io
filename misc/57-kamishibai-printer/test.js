/*
 * node misc/57-kamishibai-printer/test.js
 *
 * Checks boards.js: the kamishibai rule and the imposition for many board counts and both layouts, that a route's
 * lines are all printed exactly once and in order, and that the same route gives the same boards twice.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var KB = require('./boards.js');
var VN = require('../55-paper-theatre/vn.js');

var pass = 0, fail = 0;
function ok(cond, name) {
	if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); }
}
function eq(a, b, name) {
	var A = JSON.stringify(a), B = JSON.stringify(b);
	ok(A === B, name + (A === B ? '' : '\n     got      ' + A.slice(0, 300) + '\n     expected ' + B.slice(0, 300)));
}

/* ------------------------------------------------------------------ the kamishibai rule */

eq(KB.backOf(1, 5), 2, 'back of board 1 carries the text of board 2');
eq(KB.backOf(5, 5), 1, 'back of the last board carries the text of board 1');
eq(KB.textSheet(1, 5), 5, 'text of board 1 is on the last sheet');
eq(KB.textSheet(3, 5), 2, 'text of board 3 is on sheet 2');

[1, 2, 3, 4, 5, 7, 12, 47, 95, 200].forEach(function (n) {
	['duplex', 'fold'].forEach(function (layout) {
		['long', 'short'].forEach(function (flip) {
			var tag = layout + '/' + flip + ' n=' + n + ': ';
			var pages = KB.impose(n, { layout: layout, flip: flip });
			// page count and numbering
			eq(pages.length, layout === 'duplex' ? 2 * n : n, tag + 'page count');
			ok(pages.every(function (p, i) { return p.page === i + 1; }), tag + 'pages numbered in order');
			// every board's picture is printed exactly once, on its own sheet
			var fronts = pages.filter(function (p) { return p.front != null; });
			eq(fronts.map(function (p) { return p.front; }), range(n), tag + 'each front once, in board order');
			ok(fronts.every(function (p) { return p.sheet === p.front; }), tag + 'front k on sheet k');
			// every board's text is printed exactly once, on the back of the right sheet
			var texts = pages.filter(function (p) { return p.text != null; });
			eq(texts.map(function (p) { return p.text; }).slice().sort(function (a, b) { return a - b; }), range(n), tag + 'each text once');
			var right = true;
			for (var k = 1; k <= n; k++) {
				var holder = texts.filter(function (p) { return p.text === k; })[0];
				var want = k === 1 ? n : k - 1;
				if (!holder || holder.sheet !== want) right = false;
			}
			ok(right, tag + 'text 1 on the back of sheet n, text k on the back of sheet k-1');
			// the thumbnail on a back is the picture the audience sees while that text is read
			ok(texts.every(function (p) { return p.thumb === p.text; }), tag + 'back thumbnail = the picture of its text');
			if (layout === 'duplex') {
				// front then back of the same sheet, sheet after sheet
				var order = true;
				for (var s = 1; s <= n; s++) {
					var f = pages[2 * s - 2], b = pages[2 * s - 1];
					if (f.sheet !== s || f.side !== 'front' || b.sheet !== s || b.side !== 'back') order = false;
					if (f.rotate !== 0 || b.rotate !== (flip === 'long' ? 180 : 0)) order = false;
				}
				ok(order, tag + 'odd pages fronts, even pages backs, backs rotated only for a long-edge flip');
			} else {
				ok(pages.every(function (p) { return p.side === 'fold' && p.rotate === 180; }), tag + 'fold pages carry the text half turned 180 degrees');
			}
			// the performance: at every pull the performer reads the text of the picture the audience sees
			var log = KB.perform(n, pages);
			eq(log.length, n, tag + 'one reading per board');
			ok(log.every(function (e) { return e.reads === e.audience; }), tag + 'performer always reads the text of the picture on show');
			eq(log.map(function (e) { return e.audience; }), range(n), tag + 'audience sees boards 1..n in order');
		});
	});
});
function range(n) { var a = []; for (var i = 1; i <= n; i++) a.push(i); return a; }

/* ------------------------------------------------------------------ the stories */

var dir = path.join(__dirname, '..', '55-paper-theatre', 'stories');
var index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
var published = index.filter(function (e) { return e.status === 'published' && !e.auto; });
ok(published.length >= 1, 'at least one published story (' + published.length + ')');

function load(e) {
	var t = fs.readFileSync(path.join(dir, e.file), 'utf8');
	var inc = {};
	t.replace(/^\s*@include\s+(\S+)/gm, function (m, p) { inc[p] = fs.readFileSync(path.join(dir, p), 'utf8'); return m; });
	return VN.parse(t, { id: e.id, includes: inc });
}

// An independent walk: every stop the stage would show along a route, as (op index, text) in order.
function walk(program, picks) {
	var run = VN.createRun(program, {}), out = [], m = 0, s = run.advance();
	while (s && out.length < 5000) {
		var text = s.op.text != null ? VN.interpolate(s.op.text, s.state.vars, program.cast) : (s.op.title != null ? s.op.title : null);
		out.push({ index: s.index, kind: s.op.kind, text: text });
		if (s.done || s.op.kind === 'end') break;
		if (s.op.kind === 'menu') {
			var p = picks[m++], vis = s.options.length;
			s = run.choose(typeof p === 'number' && p < vis ? p : 0);
		} else s = run.advance();
	}
	return out;
}

function flat(boards) {
	var out = [];
	boards.forEach(function (b) {
		b.items.forEach(function (it) {
			if (it.kind === 'title') return;
			if (it.kind === 'end') { if (it.seq != null) out.push({ seq: it.seq, index: it.index, kind: 'end', text: null, board: b.n }); return; }
			out.push({ seq: it.seq, index: it.index, kind: it.kind, text: it.text != null ? it.text : (it.title != null ? it.title : null), board: b.n });
		});
	});
	return out;
}

published.forEach(function (e) {
	var program = load(e);
	var fatal = VN.lint(program).filter(function (i) { return i.level === 'fatal'; });
	ok(!fatal.length, e.id + ': parses without a fatal issue');
	// three routes: the first option everywhere, the second where there is one, and a mixed one
	var routes = [[], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [0, 1, 0, 1, 2, 0, 1, 2, 1, 0, 1, 1]];
	routes.forEach(function (picks, ri) {
		var tag = e.id + ' route ' + ri + ': ';
		var a = KB.build(VN, program, picks, { perBoard: 4 });
		var b = KB.build(VN, program, picks, { perBoard: 4 });
		eq(JSON.stringify(a), JSON.stringify(b), tag + 'same route, same boards');
		ok(!a.truncated, tag + 'reaches the end');
		var want = walk(program, picks);
		var got = flat(a.boards);
		eq(got.map(function (x) { return x.seq; }), want.map(function (x, i) { return i; }), tag + 'every stop printed once, in order (' + want.length + ' stops)');
		eq(got.map(function (x) { return x.index; }), want.map(function (x) { return x.index; }), tag + 'stops are the route\'s ops');
		eq(got.map(function (x) { return x.text; }), want.map(function (x) { return x.text; }), tag + 'text verbatim');
		// boards are in order and never empty; title first, end last
		ok(a.boards[0].kind === 'title' && a.boards[a.boards.length - 1].kind === 'end', tag + 'title board first, end board last');
		ok(a.boards.every(function (bd, i) { return bd.n === i + 1 && bd.items.length > 0; }), tag + 'boards numbered 1..n, none empty');
		var seqs = got.map(function (x) { return x.board; });
		ok(seqs.every(function (v, i) { return i === 0 || v >= seqs[i - 1]; }), tag + 'boards follow the story order');
		// a chapter card is a board of its own
		ok(a.boards.filter(function (bd) { return bd.kind === 'chapter'; }).every(function (bd) { return bd.items.length === 1 && bd.items[0].kind === 'chapter'; }), tag + 'chapter cards are boards of their own');
		// no board carries more than perBoard lines (pauses and scene titles excepted)
		ok(a.boards.every(function (bd) { return bd.items.filter(function (it) { return KB.TEXT_KINDS[it.kind]; }).length <= 4; }), tag + 'at most four lines per board');
		// the menus met along the route record the choice taken
		ok(a.menus.every(function (m) { return m.chosen >= 0 && m.chosen < m.options.length; }), tag + 'each menu records a valid choice');
		// the imposition of this story puts each board's text where the rule wants it
		var pages = KB.impose(a.boards.length, { layout: 'duplex' });
		ok(KB.perform(a.boards.length, pages).every(function (x) { return x.reads === x.audience; }), tag + 'performance reads the right text at every pull');
	});
	// the picture key really is constant within a board: rebuild with the stop states
	var rt = KB.route(VN, program, [], {});
	var boards = KB.group(VN, program, rt, { perBoard: 4 });
	var bySeq = {};
	rt.stops.forEach(function (s) { bySeq[s.seq] = s; });
	var constant = true;
	boards.forEach(function (bd) {
		if (bd.kind !== 'story') return;
		var key = KB.pictureKey(bd.picture, true);
		bd.items.forEach(function (it) {
			// silent beats (pauses) of a board with nothing to read are folded into a neighbour
			if (it.kind === 'pause') return;
			if (KB.pictureKey(KB.pictureOf(bySeq[it.seq].state), true) !== key) constant = false;
		});
	});
	ok(constant, e.id + ': the picture is the same for every spoken stop on a board');
	ok(boards.every(function (bd) { return bd.kind !== 'story' || bd.items.some(function (it) { return it.kind !== 'pause'; }); }), e.id + ': no board is only silence');
	// perBoard changes the grouping but never the text
	[1, 2, 6, 12].forEach(function (pb) {
		var x = KB.build(VN, program, [], { perBoard: pb });
		eq(flat(x.boards).map(function (i) { return i.seq; }), flat(KB.build(VN, program, [], { perBoard: 4 }).boards).map(function (i) { return i.seq; }), e.id + ': perBoard ' + pb + ' keeps every stop');
		ok(x.boards.every(function (bd) { return bd.items.filter(function (it) { return KB.TEXT_KINDS[it.kind]; }).length <= pb; }), e.id + ': perBoard ' + pb + ' respected');
	});
	// without cast breaks there are no more boards than with them
	ok(KB.build(VN, program, [], { castBreaks: false }).boards.length <= KB.build(VN, program, [], {}).boards.length, e.id + ': cast breaks only add boards');
	// the end board carries the citation the end card shows
	// cards and charts print each of their citations exactly once, and the set is the theatre's (VN.refs)
	var chipsOk = true, chipMsg = '', cards = 0;
	KB.build(VN, program, [], {}).boards.forEach(function (bd) {
		bd.items.forEach(function (it) {
			if (it.kind !== 'card' && it.kind !== 'chart') return;
			cards++;
			var printed = it.refs.slice();
			(it.cells || it.series).forEach(function (r) { printed = printed.concat(r.refs); });
			var op = program.ops[it.index], want = VN.refs(op);
			if (JSON.stringify(printed.slice().sort()) !== JSON.stringify(want.slice().sort())) { chipsOk = false; chipMsg = chipMsg || (' line ' + it.line + ': ' + printed.join(',') + ' vs ' + want.join(',')); }
			if (op.ref && it.refs[0] !== op.ref) { chipsOk = false; chipMsg = chipMsg || (' line ' + it.line + ': trailing chip not on the title'); }
		});
	});
	ok(chipsOk, e.id + ': card and chart chips printed once each, trailing chip on the title (' + cards + ' cards)' + chipMsg);
	var endItem = KB.build(VN, program, [], {}).boards.slice(-1)[0].items[0];
	eq(endItem.origin, KB.originalWork(program.meta), e.id + ': end board carries the citation');
	ok(endItem.dramatized === true, e.id + ': end board says the dialogue is dramatized');
	// ...exactly once on the end board's back (the separate line and the note never both say it)
	var el = KB.endLines(endItem), endText = (el.dramatized ? 'Dialogue is dramatized ' : '') + el.note;
	eq((endText.match(/dialogue is dramati[sz]ed/gi) || []).length, 1, e.id + ': "Dialogue is dramatized" printed once on the end board');
	// listeners are dimmed the way the stage dims them
	var dimOk = true, dimMsg = '', dimmed = 0;
	KB.build(VN, program, [], {}).boards.forEach(function (bd) {
		if (bd.kind !== 'story') return;
		var speaks = {};
		bd.items.forEach(function (it) { if (it.kind === 'say') speaks[it.key] = true; });
		var anyOn = bd.picture.actors.some(function (a) { return speaks[a.key]; });
		bd.picture.actors.forEach(function (a) {
			var want = anyOn && !speaks[a.key];
			if (!!a.dim !== want) { dimOk = false; dimMsg = dimMsg || (' board ' + bd.n + ' ' + a.key); }
			if (a.dim) dimmed++;
		});
	});
	ok(dimOk, e.id + ': on-stage listeners dimmed, speakers lit (' + dimmed + ' dimmed)' + dimMsg);
});

// endLines on its own
eq(KB.endLines({ origin: 'X', dramatized: true, note: VN.DEFAULT_NOTE }).dramatized, false, 'endLines: the default note already says it, no second line');
eq(KB.endLines({ origin: 'X', dramatized: true, note: 'Figures are quoted.' }).dramatized, true, 'endLines: another note keeps the line');
eq(KB.endLines({ origin: 'X', dramatized: true, note: '' }).dramatized, true, 'endLines: no note keeps the line');
eq(KB.endLines({ origin: 'X', dramatized: false, note: VN.DEFAULT_NOTE }).dramatized, false, 'endLines: an undramatized story has no line');
// dimListeners on its own: a copy, never the shared picture
(function () {
	var pic = { actors: [{ key: 'a', slot: 'left' }, { key: 'b', slot: 'right' }] };
	var bd = { kind: 'story', picture: pic, items: [{ kind: 'say', key: 'a' }, { kind: 'narrate' }] };
	KB.dimListeners(bd);
	eq(bd.picture.actors.map(function (a) { return !!a.dim; }), [false, true], 'dimListeners: the listener is dimmed, the speaker lit');
	ok(!pic.actors[1].dim && bd.picture !== pic, 'dimListeners: the original picture is left alone');
	var off = { kind: 'story', picture: { actors: [{ key: 'a' }] }, items: [{ kind: 'say', key: 'z' }] };
	KB.dimListeners(off);
	ok(!off.picture.actors[0].dim, 'dimListeners: a speaker off stage dims no one');
})();

// thumb: the obfuscation story exists and is published (the ?thumb=1 fan is built from it)
ok(published.some(function (e) { return e.id === 'obfuscation'; }), 'obfuscation is published (thumbnail story)');

console.log((fail ? 'FAIL' : 'PASS') + ' kamishibai-printer: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
