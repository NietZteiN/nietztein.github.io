/*
 * Kamishibai Printer: the part that needs no browser.
 *
 *   KB.route(VN, program, picks, opts)    -> { stops, menus, truncated }
 *   KB.group(program, routeResult, opts)  -> boards[]
 *   KB.build(VN, program, picks, opts)    -> { boards, menus, stops, truncated }
 *   KB.backOf(j, n)                       -> the board whose text is printed on the back of board j
 *   KB.textSheet(k, n)                    -> the sheet that carries board k's text on its back
 *   KB.impose(n, { layout, flip })        -> pages[] (which page carries which front and which back)
 *   KB.perform(n, pages)                  -> a simulated performance: what the audience sees, what the performer reads
 *
 * The kamishibai rule: the performer holds the stack facing the audience and reads the back of the board at the
 * back of the stack. So the text for board 1 is printed on the back of the last board, and the text for board k
 * (k > 1) on the back of board k - 1.
 *
 * Boards are numbered from 1. Board 1 is the title board, board n the end board.
 * UMD: window.KB in the browser, module.exports in Node. Old-style JavaScript like the rest of the site.
 */
(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.KB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	var TEXT_KINDS = { say: 1, narrate: 1, card: 1, chart: 1, code: 1, withheld: 1, menu: 1, read: 1 };
	var MAX_STOPS = 4000;

	function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

	function uniq(list) {
		var out = [];
		(list || []).forEach(function (r) { if (r && out.indexOf(r) < 0) out.push(r); });
		return out;
	}

	// A card's or chart's citations, each printed once. The script's trailing chip (^§2.3 after the last cell) is
	// parsed both as the last cell's chip and as the card's own (op.ref), and was printed twice; it belongs to the
	// whole card, so it goes on the title. Any other chip stays on the first row that carries it, and the title
	// also takes what no row shows. The set of chips per card is exactly the theatre's (VN.refs of the op).
	// `rows` are changed in place; returns the title's chips.
	function spreadRefs(op, rows) {
		var title = op.ref ? [op.ref] : [], seen = title.slice();
		rows.forEach(function (r) {
			r.refs = r.refs.filter(function (x) { if (seen.indexOf(x) >= 0) return false; seen.push(x); return true; });
		});
		return title.concat(uniq(op.refs || []).filter(function (x) { return seen.indexOf(x) < 0; }));
	}

	// The picture the audience sees at a stop, as plain data (no SVG here).
	function pictureOf(state) {
		var bg = state.bg ? { name: state.bg.name, mod: state.bg.mod || null, opts: clone(state.bg.opts || {}) } : { name: 'void', mod: null, opts: {} };
		var overcast = !!(state.fx && (state.fx.rain || state.fx.snow));
		if (overcast) bg.opts.overcast = true;
		var cg = null;
		if (state.cg && state.cg.name) {
			cg = { name: state.cg.name, mod: state.cg.mod || null, opts: clone(state.cg.opts || {}), caption: state.cg.caption || null };
			if (overcast) cg.opts.overcast = true;
		}
		var actors = [];
		['left', 'center', 'right'].forEach(function (slot) {
			var k = state.slots && state.slots[slot];
			if (!k) return;
			actors.push({ key: k, slot: slot, face: (state.faces && state.faces[k]) || 'neutral', dist: (state.dist && state.dist[k]) || null });
		});
		return {
			bg: bg,
			cg: cg,
			actors: cg ? [] : actors,
			flashback: state.flashback ? { caption: state.flashback.caption || null } : null,
			tone: state.tone || 'none',
			fx: Object.keys(state.fx || {}).sort()
		};
	}

	// What decides that a new board is needed: the place, the illustration, the grade, and (optionally) who stands where.
	// Faces are left out: a change of face is not a new picture.
	function pictureKey(pic, withCast) {
		var o = { bg: pic.bg, cg: pic.cg ? { name: pic.cg.name, mod: pic.cg.mod, opts: pic.cg.opts } : null, fb: !!pic.flashback, tone: pic.tone };
		if (withCast) o.cast = pic.actors.map(function (a) { return a.slot + ':' + a.key + ':' + (a.dist || ''); });
		return JSON.stringify(o);
	}

	function speakerName(program, key, who) {
		var c = program.cast && program.cast[key];
		return c ? c.name : (who || key);
	}

	// One stop of the route as a printable item. The text is the script's text verbatim ({var} filled in as the
	// stage fills it); nothing is added or summarised.
	function itemOf(VN, program, stop, seq, chosen) {
		var op = stop.op, st = stop.state, vars = st.vars || {}, cast = program.cast || {};
		function ip(t) { return VN.interpolate(t, vars, cast); }
		var it = { seq: seq, index: stop.index, kind: op.kind, line: op.line || 0 };
		switch (op.kind) {
			case 'say':
				it.who = speakerName(program, op.key, op.who);
				it.key = op.key;
				it.face = op.face || null;
				it.text = ip(op.text);
				it.refs = uniq(op.refs || VN.refs(op));
				it.thought = !!op.thought;
				break;
			case 'narrate':
				it.text = ip(op.text);
				it.refs = uniq(op.refs || VN.refs(op));
				it.thought = !!op.thought;
				break;
			case 'scene':
				it.title = ip(op.title || '');
				break;
			case 'chapter':
				it.n = op.n == null ? '' : String(op.n);
				it.title = ip(op.title || '');
				break;
			case 'pause':
				it.ms = op.ms;
				break;
			case 'card':
				it.title = ip(op.title || '');
				it.cells = (op.cells || []).map(function (c) {
					return { label: c.label == null ? null : ip(c.label), value: ip(c.value == null ? '' : c.value), refs: uniq([c.ref].concat((c.chips || []).map(function (h) { return h.ref; }))) };
				});
				it.refs = spreadRefs(op, it.cells);
				break;
			case 'chart':
				it.title = ip(op.title || '');
				it.chartType = op.type;
				it.unit = op.unit || null;
				it.series = (op.series || []).map(function (s) {
					return { label: ip(s.label || ''), value: op.type === 'range' ? ip(s.lo) + '..' + ip(s.hi) : ip(s.value == null ? '' : s.value), refs: uniq([s.ref].concat((s.chips || []).map(function (h) { return h.ref; }))) };
				});
				it.refs = spreadRefs(op, it.series);
				break;
			case 'code':
				it.lang = op.lang || '';
				it.lines = (op.lines || []).slice();
				break;
			case 'withheld':
				it.text = op.text;
				break;
			case 'menu':
				it.options = (stop.options || []).map(function (o) { return { text: ip(o.text) }; });
				it.chosen = chosen;
				break;
			case 'read':
				it.text = null;
				break;
			case 'end':
				break;
			default:
				it.text = op.text == null ? null : ip(op.text);
		}
		return it;
	}

	// Walk one route through the story. picks[m] is the visible option taken at the m-th menu the route meets
	// (missing or out of range: the first option).
	function route(VN, program, picks, opts) {
		opts = opts || {};
		picks = picks || [];
		var max = opts.maxStops || MAX_STOPS;
		var run = VN.createRun(program, {});
		var stops = [], menus = [], truncated = false;
		var stop = run.advance(), seq = 0;
		while (stop) {
			if (seq >= max) { truncated = true; break; }
			var op = stop.op, chosen = null, m = null;
			if (op.kind === 'menu') {
				var vis = stop.options || [];
				if (!vis.length) { truncated = true; break; }
				m = menus.length;
				var p = picks[m];
				chosen = (typeof p === 'number' && p >= 0 && p < vis.length) ? p : 0;
				menus.push({ m: m, seq: seq, index: stop.index, line: op.line, options: vis.map(function (o) { return o.text; }), chosen: chosen });
			}
			stops.push({ seq: seq, index: stop.index, kind: op.kind, op: op, state: clone(stop.state), options: stop.options ? stop.options.slice() : null, chosen: chosen, menu: m });
			seq++;
			if (op.kind === 'error') { truncated = true; break; }
			if (stop.done || op.kind === 'end') break;
			stop = op.kind === 'menu' ? run.choose(chosen) : run.advance();
		}
		return { stops: stops, menus: menus, truncated: truncated };
	}

	// Group the stops into boards. A new board starts whenever the picture changes (a bg or cg, a flashback or a
	// tone, and with castBreaks who stands where), at every chapter card (a board of its own) and every scene
	// title, and otherwise after `perBoard` lines.
	function group(VN, program, rt, opts) {
		opts = opts || {};
		var perBoard = Math.max(1, Math.min(12, opts.perBoard || 4));
		var castBreaks = opts.castBreaks !== false;
		var meta = program.meta || {};
		var boards = [];
		var first = rt.stops.length ? pictureOf(rt.stops[0].state) : pictureOf({});
		boards.push({ kind: 'title', picture: first, items: [{ kind: 'title', title: meta.title || '', authors: meta.authors || '' }] });
		var cur = null, curKey = null;
		function open(kind, pic) {
			cur = { kind: kind, picture: pic, items: [], lines: 0 };
			curKey = kind === 'chapter' ? null : pictureKey(pic, castBreaks);
			boards.push(cur);
		}
		var end = null;
		rt.stops.forEach(function (s) {
			var it = itemOf(VN, program, s, s.seq, s.chosen);
			if (s.kind === 'end') { end = it; return; }
			if (s.kind === 'chapter') {
				open('chapter', pictureOf(s.state));
				cur.chapter = { n: it.n, title: it.title };
				cur.items.push(it);
				cur.closed = true;          // the next stop starts a new board
				return;
			}
			var pic = pictureOf(s.state), key = pictureKey(pic, castBreaks);
			var counts = !!TEXT_KINDS[s.kind];
			var need = !cur || cur.closed || key !== curKey || s.kind === 'scene' && cur.items.length > 0 || (counts && cur.lines >= perBoard);
			// a pause or a scene title alone does not open a board for the same picture after a full one: it rides along
			if (need && cur && !cur.closed && key === curKey && s.kind === 'pause') need = false;
			if (need) open('story', pic);
			if (s.kind === 'scene') cur.scene = it.title;
			cur.items.push(it);
			if (counts) cur.lines++;
		});
		// A story board with nothing to read (only pauses: the picture passes in silence) is folded into its
		// neighbour: the previous story board, or the next one after a title or chapter card.
		for (var i = 1; i < boards.length; i++) {
			var b = boards[i];
			if (b.kind !== 'story' || b.items.some(function (it) { return it.kind !== 'pause'; })) continue;
			var prev = boards[i - 1], next = boards[i + 1];
			if (prev.kind === 'story') prev.items = prev.items.concat(b.items);
			else if (next && next.kind === 'story') next.items = b.items.concat(next.items);
			else continue;
			boards.splice(i, 1);
			i--;
		}
		boards.push({
			kind: 'end',
			picture: boards.length > 1 ? boards[boards.length - 1].picture : first,
			items: [{ kind: 'end', seq: end ? end.seq : null, index: end ? end.index : null, origin: originalWork(meta), dramatized: dramatized(program), note: meta.note || '' }]
		});
		boards.forEach(function (b, i) { b.n = i + 1; delete b.lines; delete b.closed; if (b.kind === 'story') dimListeners(b); });
		return boards;
	}

	// The stage dims everyone on stage but the speaker while a cast member on stage speaks (stage.js syncActors:
	// "speaking" or "dim"). A board holds several lines, so on a board where someone on stage speaks, whoever
	// stands there and says nothing on that board is dimmed; anyone who speaks on it stays lit. A board of
	// narration only, or one whose speakers are all off stage, dims no one, as the stage does.
	function dimListeners(board) {
		var actors = board.picture && board.picture.actors;
		if (!actors || !actors.length) return;
		var speaks = {};
		board.items.forEach(function (it) { if (it.kind === 'say' && it.key) speaks[it.key] = true; });
		if (!actors.some(function (a) { return speaks[a.key]; })) return;
		var pic = {};
		Object.keys(board.picture).forEach(function (k) { pic[k] = board.picture[k]; });
		pic.actors = actors.map(function (a) {
			var c = {};
			Object.keys(a).forEach(function (k) { c[k] = a[k]; });
			if (!speaks[a.key]) c.dim = true;
			return c;
		});
		board.picture = pic;     // a copy: the end board may share the last story board's picture
	}

	// The end card's lines. The story's note usually begins with "Dialogue is dramatized" (the theatre's default
	// note does), so the separate italic line is printed only when the note does not already say it.
	function endLines(item) {
		var note = String((item && item.note) || '');
		return { origin: (item && item.origin) || '', dramatized: !!(item && item.dramatized) && !/^\s*dialogue is dramati[sz]ed\b/i.test(note), note: note };
	}

	// The same wording the opening (op.js) and the end card use.
	function originalWork(meta) {
		meta = meta || {};
		if (meta.cite) return meta.cite;
		if (meta.kind === 'blog' || meta.sourceKind === 'blog') return 'A blog post on this site' + (meta.date ? ', ' + meta.date : '');
		if (meta.sourceKind === 'text' && meta.source) return meta.source;
		if (meta.sourceRef) return meta.sourceRef;
		return meta.source || '';
	}
	function dramatized(program) {
		var ops = (program && program.ops) || [], read = false;
		for (var i = 0; i < ops.length; i++) if (ops[i].kind === 'read') { read = true; break; }
		return !(read && !Object.keys(program.cast || {}).filter(function (k) { return k !== 'page'; }).length);
	}

	function build(VN, program, picks, opts) {
		var rt = route(VN, program, picks, opts);
		return { boards: group(VN, program, rt, opts), menus: rt.menus, stops: rt.stops.length, truncated: rt.truncated };
	}

	/* ------------------------------------------------------------------ the kamishibai rule and the imposition */

	// The text printed on the back of board j (1-based, n boards) is the text of board backOf(j, n).
	function backOf(j, n) { return j === n ? 1 : j + 1; }
	// The board whose back carries board k's text.
	function textSheet(k, n) { return k === 1 ? n : k - 1; }

	// Pages in print order.
	//   duplex: sheet s is page 2s-1 (front of board s) and page 2s (back of board s, carrying the text of board
	//           backOf(s)). flip 'long' (the default): the back is turned 180 degrees, so that a sheet printed with
	//           "flip on long edge" reads upright to a performer who sees it from behind (a turn about the vertical
	//           axis). flip 'short': the back is printed upright.
	//   fold:   one page per board: the picture on the upper half, the text for the back below a fold line,
	//           turned 180 degrees, so that folding the lower half behind puts the text upright on the back.
	function impose(n, o) {
		o = o || {};
		var layout = o.layout === 'fold' ? 'fold' : 'duplex', flip = o.flip === 'short' ? 'short' : 'long';
		var pages = [];
		for (var s = 1; s <= n; s++) {
			if (layout === 'duplex') {
				pages.push({ page: pages.length + 1, sheet: s, side: 'front', front: s, rotate: 0 });
				pages.push({ page: pages.length + 1, sheet: s, side: 'back', text: backOf(s, n), thumb: backOf(s, n), rotate: flip === 'long' ? 180 : 0 });
			} else {
				pages.push({ page: pages.length + 1, sheet: s, side: 'fold', front: s, text: backOf(s, n), thumb: backOf(s, n), rotate: 180 });
			}
		}
		return pages;
	}

	// Play the stack through: audience sees the front of the front-most board, the performer reads the back of the
	// back-most one; after each reading the front board is pulled and put at the back. Returns one entry per pull.
	function perform(n, pages) {
		var backText = {};
		pages.forEach(function (p) { if (p.text != null) backText[p.sheet] = p.text; });
		var stack = [];
		for (var i = 1; i <= n; i++) stack.push(i);
		var log = [];
		for (var t = 0; t < n; t++) {
			var front = stack[0], back = stack[stack.length - 1];
			log.push({ audience: front, reads: backText[back], from: back });
			stack.push(stack.shift());
		}
		return log;
	}

	return {
		route: route,
		group: group,
		build: build,
		pictureOf: pictureOf,
		pictureKey: pictureKey,
		originalWork: originalWork,
		dramatized: dramatized,
		endLines: endLines,
		dimListeners: dimListeners,
		backOf: backOf,
		textSheet: textSheet,
		impose: impose,
		perform: perform,
		TEXT_KINDS: TEXT_KINDS
	};
});
