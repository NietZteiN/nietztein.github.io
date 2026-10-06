// node misc/56-theatre-studio/test-map.js : the branch map's graph and layout (panels/map-layout.js) on every story.
'use strict';
var fs = require('fs');
var path = require('path');
var VN = require('../55-paper-theatre/vn.js');
var M = require('./panels/map-layout.js');

var pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }
function eq(a, b, name) { var A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, name + (A === B ? '' : '  got ' + A + ' want ' + B)); }

var STORIES = path.join(__dirname, '..', '55-paper-theatre', 'stories');

function includesFor(text) {
	var out = {};
	(function add(t) {
		String(t).replace(/^\s*@include\s+(\S+)/gm, function (m, p) {
			if (out[p] != null) return m;
			var f = path.join(STORIES, p);
			if (fs.existsSync(f)) { out[p] = fs.readFileSync(f, 'utf8'); add(out[p]); }
			return m;
		});
	}(text));
	return out;
}
function load(text, id) {
	var program = VN.parse(text, { id: id, includes: includesFor(text) });
	var issues = VN.lint(program);
	var walk = issues.some(function (i) { return i.level === 'fatal'; }) ? null : VN.walk(program);
	return { program: program, issues: issues, walk: walk };
}

// the properties every layout must have
function checkLayout(g, program, name) {
	var byId = {}, bad = [];
	g.nodes.forEach(function (nd) { byId[nd.id] = nd; });
	eq(Object.keys(byId).length, g.nodes.length, name + ': node ids are unique');

	var missingLabels = Object.keys(program.labels).filter(function (l) { return !byId['L:' + l]; });
	eq(missingLabels, [], name + ': every label is a node (' + Object.keys(program.labels).length + ')');
	var missingMenus = program.menus.filter(function (i) { return !byId['M:' + i]; });
	eq(missingMenus, [], name + ': every menu is a node (' + program.menus.length + ')');
	var missingCh = program.chapters.filter(function (c) { return !byId['C:' + c.index]; });
	eq(missingCh, [], name + ': every chapter card is a node (' + program.chapters.length + ')');

	var dangling = g.edges.filter(function (e) { return !byId[e.from] || !byId[e.to]; }).map(function (e) { return e.id; });
	eq(dangling, [], name + ': every edge has both ends (' + g.edges.length + ' edges)');

	// every menu option with a target is drawn
	var lost = [];
	program.menus.forEach(function (mi) {
		program.ops[mi].options.forEach(function (o) {
			if (!o.target) return;
			var has = g.edges.some(function (e) { return e.from === 'M:' + mi && e.kind === 'option' && e.labels.length && (byId[e.to].kind === 'missing' ? byId[e.to].name === o.target : true); });
			if (!has) lost.push(o.line);
		});
	});
	eq(lost, [], name + ': every menu option has an edge');

	g.nodes.forEach(function (nd) { ['x', 'y', 'w', 'h'].forEach(function (k) { if (typeof nd[k] !== 'number' || !isFinite(nd[k])) bad.push(nd.id + '.' + k); }); });
	eq(bad, [], name + ': every node has a finite box');

	var over = [];
	for (var i = 0; i < g.nodes.length; i++) for (var j = i + 1; j < g.nodes.length; j++) if (M.overlaps(g.nodes[i], g.nodes[j], 2)) over.push(g.nodes[i].id + '/' + g.nodes[j].id);
	eq(over, [], name + ': no node overlaps another');

	var outside = g.nodes.filter(function (nd) { return nd.x < 0 || nd.y < 0 || nd.x + nd.w > g.width || nd.y + nd.h > g.height; }).map(function (nd) { return nd.id; });
	eq(outside, [], name + ': every node lies inside the drawing (' + g.width + 'x' + g.height + ')');

	var noPts = g.edges.filter(function (e) { return !e.points || e.points.length < 2 || e.points.some(function (p) { return !isFinite(p.x) || !isFinite(p.y); }); }).map(function (e) { return e.id; });
	eq(noPts, [], name + ': every edge has a route');

	var upward = g.edges.filter(function (e) { return !e.back && byId[e.to].layer <= byId[e.from].layer; }).map(function (e) { return e.id; });
	eq(upward, [], name + ': forward edges point down a layer or more');

	var outBand = g.nodes.filter(function (nd) {
		var b = g.bands.filter(function (x) { return x.chapter === nd.chapter; })[0];
		return !b || nd.y < b.y0 || nd.y + nd.h > b.y1;
	}).map(function (nd) { return nd.id; });
	eq(outBand, [], name + ': every node sits inside its chapter band (' + g.bands.length + ' bands)');
	var bandOrder = g.bands.every(function (b, k) { return k === 0 || (b.chapter > g.bands[k - 1].chapter && b.y0 >= g.bands[k - 1].y1); });
	ok(bandOrder, name + ': bands follow the chapters in file order without overlapping');
}

// ---- every story file in the theatre
var files = [];
(function scan(dir, rel) {
	fs.readdirSync(dir).sort().forEach(function (f) {
		var p = path.join(dir, f);
		if (fs.statSync(p).isDirectory()) scan(p, rel + f + '/');
		else if (/\.vn$/.test(f)) files.push(rel + f);
	});
}(STORIES, ''));
ok(files.length >= 10, 'found ' + files.length + ' story files');

var biggest = null;
files.forEach(function (f) {
	var text = fs.readFileSync(path.join(STORIES, f), 'utf8');
	var r = load(text, f);
	var g1 = M.build(r.program, r.walk);
	checkLayout(g1, r.program, f);
	var g2 = M.build(load(text, f).program, load(text, f).walk);
	ok(JSON.stringify(g1) === JSON.stringify(g2), f + ': the same script gives the same map twice');
	if (r.walk) {
		eq(g1.stats.paths, r.walk.paths, f + ': paths come from the walk');
		eq(g1.stats.unreachable, r.walk.unreachable, f + ': unreachable labels match the walk');
	}
	if (!biggest || text.split('\n').length > biggest.lines) biggest = { f: f, lines: text.split('\n').length, g: g1 };
});

// ---- the biggest story stays readable: bounded width, every chapter its own band
if (biggest) {
	console.log('# biggest: ' + biggest.f + ' (' + biggest.lines + ' lines) ' + biggest.g.nodes.length + ' nodes, ' + biggest.g.edges.length + ' edges, ' + biggest.g.layers + ' layers, ' + biggest.g.width + 'x' + biggest.g.height);
	ok(biggest.g.width <= 1600, biggest.f + ': the map is at most 1600 units wide (' + biggest.g.width + ')');
}

// ---- fixtures
var BASE = '@title T\n@kind blog\n@cast A\n';

// no menus at all: one straight line
var lin = load(BASE + 'A: one\n@chapter 1 First\nA: two\n@chapter 2 Second\nA: three\n', 'lin');
var gl = M.build(lin.program, lin.walk);
checkLayout(gl, lin.program, 'no menus');
eq(gl.stats.menus, 0, 'no menus: no menu nodes');
eq(gl.stats.paths, 1, 'no menus: one path');
eq(gl.nodes.map(function (n) { return n.kind; }), ['start', 'chapter', 'chapter', 'end'], 'no menus: start, two chapters, the end');
ok(gl.edges.every(function (e) { return !e.back && e.kind === 'flow'; }), 'no menus: only forward flow edges');
ok(gl.nodes.every(function (n, i) { return i === 0 || n.layer > gl.nodes[i - 1].layer; }), 'no menus: one node per layer, top to bottom');
eq(gl.nodes[0].stops, 1, 'start counts the stop before the first chapter');

// empty script
var em = load('', 'empty');
var ge = M.build(em.program, em.walk);
ok(ge.nodes.length >= 1 && ge.width > 0 && ge.height > 0, 'empty script: a drawable map');

// unknown jump and unreachable label
var bad = load(BASE + 'A: hi\n* go -> left\n* stay -> nowhere\n== left\nA: l\n-> end\n== orphan\nA: o\n', 'bad');
ok(bad.issues.some(function (i) { return i.code === 'unknown-jump'; }), 'fixture: lint reports the unknown jump');
var gb = M.build(bad.program, bad.walk);
checkLayout(gb, bad.program, 'unknown jump');
var miss = gb.nodes.filter(function (n) { return n.kind === 'missing'; });
eq(miss.map(function (n) { return n.name; }), ['nowhere'], 'unknown jump: a missing node named after the target');
ok(gb.edges.some(function (e) { return e.broken && e.to === miss[0].id && e.kind === 'option'; }), 'unknown jump: the option edge is marked broken');
eq(gb.stats.paths, null, 'unknown jump: no walk, no path count');
ok(gb.nodes.filter(function (n) { return n.id === 'L:orphan'; })[0].unreachable, 'unknown jump: the orphan label is still flagged (from the script itself)');

var un = load(BASE + 'A: hi\n* a -> one\n* b -> two\n== one\nA: 1\n-> end\n== two\nA: 2\n-> end\n== orphan\nA: o\n-> end\n', 'un');
var gu = M.build(un.program, un.walk);
checkLayout(gu, un.program, 'unreachable');
eq(gu.stats.unreachable, ['orphan'], 'unreachable: the walk and the map agree');
eq(gu.stats.paths, 2, 'unreachable: two paths');
eq(gu.stats.endings, { end: 2, withheld: 0 }, 'unreachable: two endings');
ok(!gu.nodes.filter(function (n) { return n.id === 'L:one'; })[0].unreachable, 'unreachable: a chosen label is not flagged');
var mnode = gu.nodes.filter(function (n) { return n.kind === 'menu'; })[0];
eq(gu.edges.filter(function (e) { return e.from === mnode.id; }).length, 2, 'unreachable: the menu has two option edges');

// a hub with (once) options returning to its menu: back edges, no loop
var hub = load(BASE + '== hub\n* (once) a -> a\n* (once) b -> b\n* done -> out\n== a\nA: a\n-> hub\n== b\nA: b\n-> hub\n== out\nA: bye\n', 'hub');
var gh = M.build(hub.program, hub.walk);
checkLayout(gh, hub.program, 'hub');
ok(gh.edges.filter(function (e) { return e.back; }).length === 2, 'hub: the two returns are back edges');
ok(gh.edges.filter(function (e) { return e.back; }).every(function (e) { return e.points[1].x > Math.max.apply(null, gh.nodes.map(function (n) { return n.x + n.w; })) - 1; }), 'hub: back edges run right of every node');
ok(!gh.nodes.some(function (n) { return n.loop; }), 'hub: no loop flagged');

// an endless loop
var lp = load(BASE + '== top\nA: again\n* round -> top\n', 'loop');
var glp = M.build(lp.program, lp.walk);
checkLayout(glp, lp.program, 'loop');
ok(lp.walk.loops.length > 0, 'loop: the walk finds the loop');
ok(glp.nodes.some(function (n) { return n.loop; }), 'loop: a node is flagged as a loop');

// withheld
var wh = load('@title T\n@kind paper\n@status embargo\n@cast A\nA: x\n@withheld\n', 'wh');
var gw = M.build(wh.program, wh.walk);
ok(gw.nodes.some(function (n) { return n.kind === 'withheld' && n.ending; }), 'withheld: marked as an ending');
ok(gw.edges.some(function (e) { return gw.nodes.filter(function (n) { return n.id === e.from; })[0].kind === 'withheld'; }), 'withheld: it flows on to the end card');

// @if gives a conditional edge and the fall-through
var cf = load(BASE + '@set x = 1\n@if x == 1 -> yes\nA: no\n-> end\n== yes\nA: yes\n', 'if');
var gc = M.build(cf.program, cf.walk);
ok(gc.edges.some(function (e) { return e.kind === 'if' && e.to === 'L:yes' && e.labels[0] === 'x == 1'; }), '@if: a conditional edge with its condition');

// nodeAtLine
var t = BASE + 'A: a\n== two\nA: b\nA: c\n';
var pt = load(t, 'nal');
var gn = M.build(pt.program, pt.walk);
eq(M.nodeAtLine(gn, 5).id, 'L:two', 'nodeAtLine: the label line');
eq(M.nodeAtLine(gn, 7).id, 'L:two', 'nodeAtLine: inside the section');
eq(M.nodeAtLine(gn, 8).id, 'E:4', 'nodeAtLine: the implicit end after the last line');
eq(M.nodeAtLine(gn, 4).id, 'start', 'nodeAtLine: before any label');
eq(M.nodeAtLine(gn, 1).id, 'start', 'nodeAtLine: a header line');
var oc = load(BASE + '@chapter 1 One\n@bg lab\nA: a.\nA: b.\n', 'oc');
eq(M.nodeAtLine(M.build(oc.program, oc.walk), 7).id, 'C:0','nodeAtLine: a script that opens with a chapter card belongs to the chapter, not the start');

console.log((fail ? 'FAIL' : 'PASS') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
