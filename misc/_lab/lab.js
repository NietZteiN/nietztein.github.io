/*
 * Lab: the shared runner for the small behavioural experiments under misc/
 * ("n = 1": the only participant is the reader). An experiment is a kit toy
 * that loads, after ToyKit:
 *     <link rel="stylesheet" href="../_lab/lab.css">
 *     <script src="../_lab/stats.js"></script>   LabStats: the statistics
 *     <script src="../_lab/chart.js"></script>   LabChart: the charts
 *     <script src="../_lab/facts.js"></script>   Facts: the cited figures of the owner's study
 *     <script src="../_lab/lab.js"></script>     Lab: this file
 * README.md in this folder is the manual and has a complete small experiment.
 *
 * What this file gives an experiment:
 *   - a session: instructions, timed choice trials, typed answers, pauses, a
 *     progress bar, a results sheet, and one record of the sitting saved in
 *     this browser;
 *   - timing done one way everywhere: the clock starts on the first animation
 *     frame after the stimulus was painted and stops at the time stamp of the
 *     key press, mouse press or touch that answers;
 *   - ?auto=<name>: a simulated participant plays the whole session with no
 *     waiting (how the experiments are tested and their thumbnails taken);
 *   - the loop's stage names, a balanced Latin square, seeded shuffles, and the
 *     standard caveat that goes under every result.
 *
 * Old-style browser code on purpose: one IIFE, no modules, no build step. The
 * first half has no DOM in it and is exported through module.exports, so
 * `node misc/_lab/test.js` can test it. Plain ASCII: special characters are
 * built from their codes.
 */
(function () {
	'use strict';

	var C = String.fromCharCode;
	var MIDDOT = C(0xB7), DASH = C(0x2014), ENDASH = C(0x2013), MINUS = C(0x2212), NBSP = C(0xA0);

	var Stats = null;
	if (typeof window !== 'undefined' && window.LabStats) Stats = window.LabStats;
	else if (typeof module === 'object' && module && typeof require === 'function') {
		try { Stats = require('./stats.js'); } catch (e) { Stats = null; }
	}

	// =========================================================================
	// Pure part (no DOM; exported to Node)
	// =========================================================================

	var PREFIX = 'lab:v1:';              // records live in localStorage under lab:v1:<exp>
	var MAX_RECORDS = 20;                // the last 20 sittings of each experiment are kept
	var CONFIDENCE = [50, 60, 70, 80, 90, 100];      // the scale of misc/05-obfuscation-game
	var CAVEAT = 'One participant, one sitting: an anecdote, not a finding. Timing in a browser is approximate.';

	// The stages of the owner's human-machine loop, copied verbatim from the
	// STAGES table of assets/js/glance.js. test.js reads that file and fails
	// when the two differ.
	var STAGES = [
		{ id: 'h1', side: 'Human', name: 'Interpret and set goals', sub: 'knowledge, intention, context' },
		{ id: 'h2', side: 'Human', name: 'Read and reason', sub: 'attention, tracing, understanding' },
		{ id: 'h3', side: 'Human', name: 'Judge and revise', sub: 'check, select, explain, challenge' },
		{ id: 'm1', side: 'Model', name: 'Represent the task', sub: 'tokens and internal features' },
		{ id: 'm2', side: 'Model', name: 'Generate and reason', sub: 'candidate outputs and evidence' },
		{ id: 'm3', side: 'Model', name: 'Change capabilities', sub: 'training, composition, removal' },
		{ id: 'xin', side: 'Human to model', name: 'Instruction and context' },
		{ id: 'xout', side: 'Model to human', name: 'Output and explanation' }
	];

	function isNum(x) { return typeof x === 'number' && isFinite(x); }
	function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

	// stage('h2') -> { id, side, name, sub }, or null
	function stage(id) {
		for (var i = 0; i < STAGES.length; i++) if (STAGES[i].id === id) return STAGES[i];
		return null;
	}
	// stageLabel('h2') -> 'Human (middle dot) Read and reason', the way the diagram captions a stage
	function stageLabel(id) {
		var s = stage(id);
		return s ? s.side + ' ' + MIDDOT + ' ' + s.name : '';
	}

	// rng(seed): the site's seeded generator (FNV-1a and mulberry32, the same
	// numbers as ToyKit.rng), with int(n), pick(list), shuffle(list), normal(mean, sd).
	function rng(seed) {
		if (Stats) return Stats.rng(seed);
		if (typeof window !== 'undefined' && window.ToyKit) return window.ToyKit.rng(seed);
		throw new Error('Lab.rng needs stats.js (LabStats) or ToyKit');
	}
	// shuffle(list, seed): a shuffled copy; the same seed gives the same order.
	function shuffle(list, seed) { return rng(seed).shuffle(list); }

	// latin(n, seed): a balanced Latin square (a Williams design) for n conditions,
	// numbered 0 to n - 1. Each row is one order of the conditions.
	//   - Every condition comes once in every position, across the rows.
	//   - Every condition follows every other condition equally often.
	// For an even n that takes n rows (each ordered pair of neighbours once). For
	// an odd n no single square can do it, so the n rows are followed by their
	// mirror images: 2n rows, every condition twice in every position, every
	// ordered pair of neighbours twice.
	// The first row is 0, 1, n-1, 2, n-2, ...; row i adds i to it (mod n). A
	// seed relabels the conditions and shuffles the rows, which keeps the balance.
	function latin(n, seed) {
		n = Math.floor(n);
		if (!(n >= 1)) return [];
		var first = [], rows = [], i, j;
		for (j = 0; j < n; j++) first.push(j % 2 ? (j + 1) / 2 : (n - j / 2) % n);
		for (i = 0; i < n; i++) rows.push(first.map(function (v) { return (v + i) % n; }));
		if (n % 2 && n > 1) for (i = 0; i < n; i++) rows.push(rows[i].slice().reverse());
		if (seed != null) {
			var r = rng(seed), ids = [];
			for (i = 0; i < n; i++) ids.push(i);
			var relabel = r.shuffle(ids);
			rows = r.shuffle(rows.map(function (row) { return row.map(function (v) { return relabel[v]; }); }));
		}
		return rows;
	}

	// ---- Typed answers: the same matching as misc/05-obfuscation-game -----------

	var SINGLE_QUOTES = new RegExp('[' + C(0x2018) + C(0x2019) + C(0x201A) + ']', 'g');
	var DOUBLE_QUOTES = new RegExp('[' + C(0x201C) + C(0x201D) + C(0x201E) + ']', 'g');

	// normalize(text): line endings, curly quotes, the blank space at both ends of
	// every line and the newlines at the end are evened out.
	function normalize(text) {
		return String(text == null ? '' : text)
			.replace(/\r\n?/g, '\n')
			.replace(SINGLE_QUOTES, '\'')
			.replace(DOUBLE_QUOTES, '"')
			.split('\n').map(function (l) { return l.trim(); }).join('\n')
			.replace(/\n+$/, '').trim();
	}
	// judge(answer, expected) -> { correct, nearMiss }: correct when the two are
	// equal after normalize(); a near miss differs only in blank space.
	function judge(answer, expected) {
		var a = normalize(answer), e = normalize(expected);
		var correct = a === e;
		return { correct: correct, nearMiss: !correct && a.replace(/\s+/g, '') === e.replace(/\s+/g, '') };
	}

	// ---- Numbers as text ---------------------------------------------------------------

	// format(612.4, { unit: 'ms' }) -> '612 ms'; format(0.4217) -> '0.42';
	// format(62.5, { unit: '%' }) -> '63%'; format(null) -> a dash.
	// digits fixes the decimals; bare leaves the unit off; signed writes a plus
	// on a positive number. The minus is a real minus sign.
	function format(value, o) {
		o = o || {};
		if (!isNum(value)) return DASH;
		var unit = o.unit == null ? '' : String(o.unit);
		var a = Math.abs(value);
		var d = isNum(o.digits) ? Math.max(0, Math.min(8, Math.round(o.digits))) : unit === 'ms' ? 0 : unit === '%' ? (a < 10 ? 1 : 0) : a >= 100 ? 0 : a >= 10 ? 1 : 2;
		var s = a.toFixed(d);
		if (a >= 10000) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
		var zero = Number(s.replace(/,/g, '')) === 0;
		var text = (value < 0 && !zero ? MINUS : o.signed && value > 0 && !zero ? '+' : '') + s;
		if (!unit || o.bare) return text;
		return unit === '%' ? text + '%' : text + NBSP + unit;
	}

	// ---- Records -----------------------------------------------------------------------

	function cleanHeadline(h) {
		if (!h || typeof h !== 'object') throw new TypeError('Lab: a record needs a headline: { label, value, unit, ci }');
		var label = String(h.label == null ? '' : h.label).trim();
		if (!label) throw new TypeError('Lab: the headline needs a label (what the number is, in a few words)');
		var ci = null, src = h.ci;
		if (src && typeof src === 'object') {
			var lo = Array.isArray(src) ? src[0] : src.lo, hi = Array.isArray(src) ? src[1] : src.hi;
			if (isNum(lo) && isNum(hi)) ci = [Math.min(lo, hi), Math.max(lo, hi)];
		}
		var out = { label: label, value: isNum(h.value) ? h.value : null, unit: String(h.unit == null ? '' : h.unit), ci: ci };
		if (h.ciLabel) out.ciLabel = String(h.ciLabel);
		if (isNum(h.digits)) out.digits = h.digits;
		if (h.signed) out.signed = true;
		return out;
	}

	// makeRecord(input, now) -> the record as it is stored:
	//     { exp, version, t, stage, headline: { label, value, unit, ci }, n, trials }
	// exp is the experiment's id (its slug), t an ISO time, stage one of the
	// loop's stage ids, headline.value a finite number or null, headline.ci
	// [lo, hi] or null (an object with lo and hi, such as LabStats.wilson
	// returns, is accepted), n a whole number, trials a list of plain objects.
	// Optional and kept when given: seed, auto (the name of a simulated
	// participant), extra (anything small the experiment wants back later).
	// Throws a TypeError that says what is wrong.
	function makeRecord(input, now) {
		input = input || {};
		var exp = String(input.exp == null ? '' : input.exp);
		if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(exp)) throw new TypeError('Lab: exp must be the experiment\'s slug (letters, digits, hyphens), got ' + JSON.stringify(input.exp));
		if (!stage(input.stage)) throw new TypeError('Lab: stage must be one of ' + STAGES.map(function (s) { return s.id; }).join(', ') + ', got ' + JSON.stringify(input.stage));
		var t = String(input.t || now || '');
		if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(t)) throw new TypeError('Lab: t must be an ISO time like 2026-10-03T12:00:00.000Z, got ' + JSON.stringify(t));
		var trials = input.trials == null ? [] : input.trials;
		if (!Array.isArray(trials)) throw new TypeError('Lab: trials must be a list');
		trials = JSON.parse(JSON.stringify(trials));          // plain data only, and a copy
		var n = input.n == null ? trials.length : input.n;
		if (!isNum(n) || n < 0 || n !== Math.floor(n)) throw new TypeError('Lab: n must be a whole number of trials, got ' + JSON.stringify(input.n));
		var version = input.version == null ? 1 : input.version;
		if (typeof version !== 'number' && typeof version !== 'string') throw new TypeError('Lab: version must be a number or a short string');
		var rec = { exp: exp, version: version, t: t, stage: input.stage, headline: cleanHeadline(input.headline), n: n, trials: trials };
		if (input.seed != null) rec.seed = String(input.seed);
		if (input.auto) rec.auto = String(input.auto);
		if (input.extra !== undefined) rec.extra = JSON.parse(JSON.stringify(input.extra));
		return rec;
	}

	// pushRecord(list, record, max) -> a new list: the old records, then this one,
	// cut to the last `max`.
	function pushRecord(list, record, max) {
		var out = (Array.isArray(list) ? list : []).concat([record]);
		max = max > 0 ? max : MAX_RECORDS;
		return out.length > max ? out.slice(out.length - max) : out;
	}

	// ---- A simulated participant ---------------------------------------------------------

	function lookup(table, cond, fallback) {
		if (table == null) return fallback;
		if (typeof table === 'number') return table;
		if (typeof table === 'function') return table(cond);
		if (has(table, String(cond))) return table[String(cond)];
		return has(table, '*') ? table['*'] : fallback;
	}

	// sim({ acc, rt, sd, miss, text }) -> a policy for Lab.auto.
	//   acc   the chance of a right answer: a number, or { condition: number } ('*' for the rest); 0.85
	//   rt    the typical response time in ms, the same way; 600
	//   sd    the spread of the times as a share of them (they are log-normal); 0.25
	//   miss  the chance of no answer at all (a timeout); 0
	//   text  function (trial, right) -> the typed answer, for session.text
	// A wrong answer is one of the other choices, picked at random. All draws
	// come from the trial's seeded generator, so a seed replays the same sitting.
	// Every answer also carries a confidence (70 to 100 when right, 50 to 80 when
	// wrong) and the time of the confidence answer, confidenceRt (400 to 1400 ms,
	// related to nothing); a trial that does not ask for confidence ignores both.
	function sim(opts) {
		opts = opts || {};
		return function (trial) {
			var r = trial.rng, cond = trial.cond;
			var p = lookup(opts.acc, cond, 0.85), base = lookup(opts.rt, cond, 600), miss = lookup(opts.miss, cond, 0);
			var spread = isNum(opts.sd) ? opts.sd : 0.25;
			var rt = Math.round(base * Math.exp(spread * r.normal()) * 10) / 10;
			var gone = r() < miss, right = r() < p, pick = r();
			// One draw gives both: its whole part picks the confidence, its fraction
			// the time. (No further draw, so a seed replays what it always replayed.)
			var draw = r() * 4, step = Math.floor(draw);
			var confidence = (right ? [70, 80, 90, 100] : [50, 60, 70, 80])[step];
			var confidenceRt = Math.round((400 + 1000 * (draw - step)) * 10) / 10;
			if (gone) return { resp: null, rt: null };
			if (trial.kind === 'text') {
				var typed = typeof opts.text === 'function' ? opts.text(trial, right)
					: right && (typeof trial.correct === 'string' || typeof trial.correct === 'number') ? String(trial.correct) : 'no idea';
				return { resp: typed, rt: rt, confidence: confidence, confidenceRt: confidenceRt };
			}
			var values = trial.values || [], good = trial.right || [], resp;
			if (good.length) {
				var bad = values.filter(function (v) { return good.indexOf(v) === -1; });
				resp = right || !bad.length ? good[Math.floor(pick * good.length)] : bad[Math.floor(pick * bad.length)];
			} else resp = values[Math.floor(pick * values.length)];
			return { resp: resp, rt: rt, confidence: confidence, confidenceRt: confidenceRt };
		};
	}

	// What a simulated answer says about confidence, in the shape a real one has:
	// the policy's confidence when it is on the scale (else 70) and its
	// confidenceRt when it is a time (else 800 ms).
	function simConfidence(answer) {
		return {
			confidence: CONFIDENCE.indexOf(answer.confidence) !== -1 ? answer.confidence : 70,
			confidenceRt: isNum(answer.confidenceRt) && answer.confidenceRt >= 0 ? Math.round(answer.confidenceRt * 10) / 10 : 800
		};
	}

	var pure = {
		PREFIX: PREFIX, MAX_RECORDS: MAX_RECORDS, CONFIDENCE: CONFIDENCE.slice(), CAVEAT: CAVEAT,
		STAGES: STAGES, stage: stage, stageLabel: stageLabel,
		rng: rng, shuffle: shuffle, latin: latin,
		normalize: normalize, judge: judge, format: format,
		makeRecord: makeRecord, pushRecord: pushRecord, sim: sim, simConfidence: simConfidence
	};
	if (typeof module === 'object' && module && module.exports) module.exports = pure;
	if (typeof window === 'undefined' || typeof document === 'undefined') return;

	// =========================================================================
	// Browser part
	// =========================================================================

	var Kit = window.ToyKit;
	if (!Kit) throw new Error('lab.js needs ToyKit: load ../_kit/kit.js before it');

	var autoParam = Kit.params.get('auto');
	var AUTO = Kit.thumb || (autoParam != null && autoParam !== '' && autoParam !== '0' && autoParam !== 'false');
	var THUMB_TIME = Kit.daily() + 'T00:00:00.000Z';       // a fixed day under ?thumb=1

	// ---- Small DOM helpers -----------------------------------------------------------

	function el(tag, cls, text) {
		var node = document.createElement(tag);
		if (cls) node.className = cls;
		if (text != null) node.textContent = text;
		return node;
	}
	// A string is the builder's own HTML; a <template> gives its content; any
	// other node is put in as it is.
	function fill(node, content) {
		if (content == null) return;
		if (typeof content === 'string') node.innerHTML = content;
		else if (content.content && content.content.cloneNode) node.appendChild(content.content.cloneNode(true));
		else if (content.nodeType) node.appendChild(content);
		else node.textContent = String(content);
	}
	// A label is text, or a node.
	function put(node, content) {
		if (content == null) return;
		if (typeof content === 'object' && content.nodeType) node.appendChild(content);
		else node.textContent = String(content);
	}
	function assign(target) {
		for (var i = 1; i < arguments.length; i++) {
			var src = arguments[i];
			if (src) for (var k in src) if (has(src, k)) target[k] = src[k];
		}
		return target;
	}
	function round1(ms) { return Math.round(ms * 10) / 10; }

	// The time of an input event on the performance.now() clock. A browser whose
	// events carry another clock (or none) gets the time of the handler instead.
	function stamp(e) {
		var now = performance.now(), t = e ? e.timeStamp : 0;
		return isNum(t) && t > 0 && t <= now + 5 && now - t < 60000 ? t : now;
	}
	// Calls fn at the next animation frame. A visible page whose frames do not
	// come (an embedded view) is not left waiting: a timer steps in.
	function nextFrame(fn) {
		var called = false;
		function go() { if (called) return; called = true; fn(); }
		window.requestAnimationFrame(go);
		window.setTimeout(function () { if (!called && document.visibilityState !== 'hidden') go(); }, 300);
	}

	// How long one frame of this display lasts: the median of the gaps between
	// the animation frames seen while a stimulus was awaited (the last 30). One
	// gap alone is not a frame: the first callback after a timer can be a
	// catch-up frame that comes a millisecond after the one before it.
	var frameGaps = [];
	function sampleFrames() {
		var last = 0, on = true;
		function tick(ts) {
			if (!on) return;
			var gap = ts - last;
			if (last && gap > 2 && gap < 100) { frameGaps.push(gap); if (frameGaps.length > 30) frameGaps.shift(); }
			last = ts;
			window.requestAnimationFrame(tick);
		}
		window.requestAnimationFrame(tick);
		return function () { on = false; };
	}
	function frameLength(fallback) {
		var ms = fallback;
		if (frameGaps.length >= 3) {
			var s = frameGaps.slice().sort(function (a, b) { return a - b; });
			ms = s[Math.floor(s.length / 2)];
		}
		return Math.max(4, Math.min(34, ms));
	}

	// ---- Keys ---------------------------------------------------------------------------

	function normKey(k) {
		k = String(k == null ? '' : k);
		if (k === 'Space' || k === 'Spacebar') return ' ';
		if (k === 'Esc') return 'Escape';
		return k.length === 1 ? k.toLowerCase() : k;
	}
	var KEY_NAMES = { ' ': 'Space', ArrowLeft: C(0x2190), ArrowUp: C(0x2191), ArrowRight: C(0x2192), ArrowDown: C(0x2193), Enter: 'Enter' };
	function keyName(k) { return has(KEY_NAMES, k) ? KEY_NAMES[k] : k.length === 1 ? k.toUpperCase() : k; }

	// One listener for the page; `answering` is whatever is waiting for a key.
	var answering = null;
	document.addEventListener('keydown', function (e) {
		if (!answering || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
		var t = e.target;
		if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
		answering(e);
	});

	// ---- Simulated participants (?auto=) -----------------------------------------------

	var policies = {}, policyNames = [];
	var lastRecord = null;               // the record of the sitting that finished on this page (Lab.last)

	// auto({ name: function (trial) -> { resp, rt } }): registers the simulated
	// participants of this experiment. ?auto=<name> plays that one, ?auto=1 (and
	// ?thumb=1) the first. Call it before the session's first screen.
	// A policy gets { kind: 'trial' | 'text', i, cond, choices, values, correct,
	// right, deadlineMs, showMs, data, rng } and answers with one of `values`
	// (or null for no answer) and a response time in ms.
	function auto(map) {
		if (map && typeof map === 'object') {
			Object.keys(map).forEach(function (name) {
				if (typeof map[name] !== 'function') return;
				if (!has(policies, name)) policyNames.push(name);
				policies[name] = map[name];
			});
		}
		return Lab;
	}
	function autoName() {
		if (!AUTO) return '';
		if (autoParam && has(policies, autoParam)) return autoParam;
		return policyNames.length ? policyNames[0] : 'default';
	}
	var fallbackPolicy = sim();
	var warned = false;
	function policy() {
		var name = autoName();
		if (autoParam && autoParam !== '1' && autoParam !== 'true' && !has(policies, autoParam) && !warned && window.console && console.warn) {
			warned = true;
			console.warn('Lab.auto: no simulated participant is called "' + autoParam + '"; playing "' + name + '" instead.');
		}
		return has(policies, name) ? policies[name] : fallbackPolicy;
	}

	// ---- Storage ("lab:v1:<exp>": the last 20 records of each experiment) -----------------
	// The kit's one exception to "storage only through ToyKit.store": a hub page
	// reads every experiment's latest record, so the keys are shared.

	function readList(exp) {
		try {
			var raw = window.localStorage.getItem(PREFIX + exp);
			if (!raw) return [];
			var list = JSON.parse(raw);
			if (!Array.isArray(list)) return [];
			return list.filter(function (r) { return r && typeof r === 'object' && r.headline && typeof r.headline === 'object'; });
		} catch (e) { return []; }
	}

	// save(record) -> true when it is stored. The record is checked first (a
	// malformed one throws, see makeRecord). When the browser refuses for lack of
	// room, older sittings are dropped, then this record's trials; false means
	// nothing could be stored (private mode, storage switched off).
	function save(record) {
		var rec = makeRecord(record, new Date().toISOString());
		var list = pushRecord(readList(rec.exp), rec, MAX_RECORDS);
		var light = assign({}, rec, { trials: [], trialsDropped: true });
		var tries = [list, list.slice(-10), list.slice(-3), [rec], [light]];
		for (var i = 0; i < tries.length; i++) {
			try {
				window.localStorage.setItem(PREFIX + rec.exp, JSON.stringify(tries[i]));
				return true;
			} catch (e) { /* no room, or no storage: try a smaller list */ }
		}
		return false;
	}
	// history(exp) -> this browser's records of one experiment, oldest first.
	// Empty under ?thumb=1, which reads nothing from storage.
	function history(exp) { return Kit.thumb ? [] : readList(String(exp == null ? '' : exp)); }
	// latest(exp) -> the newest record, or null.
	function latest(exp) {
		var list = history(exp);
		return list.length ? list[list.length - 1] : null;
	}
	function labKeys() {
		var keys = [];
		try {
			for (var i = 0; i < window.localStorage.length; i++) {
				var k = window.localStorage.key(i);
				if (k && k.indexOf(PREFIX) === 0) keys.push(k);
			}
		} catch (e) { /* no storage */ }
		return keys.sort();
	}
	// all() -> { exp: [records, oldest first] } for every experiment that has any.
	function all() {
		var out = {};
		if (Kit.thumb) return out;
		labKeys().forEach(function (k) {
			var exp = k.slice(PREFIX.length), list = readList(exp);
			if (list.length) out[exp] = list;
		});
		return out;
	}
	// clear(exp) removes one experiment's records; clear() removes them all.
	// Returns how many records went.
	function clear(exp) {
		var keys = exp == null ? labKeys() : [PREFIX + exp], gone = 0;
		keys.forEach(function (k) {
			gone += readList(k.slice(PREFIX.length)).length;
			try { window.localStorage.removeItem(k); } catch (e) { /* nothing to remove */ }
		});
		return gone;
	}

	// ---- Standard pieces ------------------------------------------------------------------

	// caveat() -> <p class="lab-caveat">: the line that goes under every result.
	// session.results() adds it by itself.
	function caveat() { return el('p', 'lab-caveat', CAVEAT); }

	// stageChip('h2') -> a small link that names the stage of the loop and leads
	// to the diagram on the About page.
	function stageChip(id) {
		var a = el('a', 'lab-chip lab-stage', stageLabel(id));
		a.href = Kit.root + '#/about';
		a.title = 'A stage of the human' + ENDASH + 'machine loop, the diagram on the About page';
		return a;
	}

	// headline({ label, value, unit, ci }) -> <div class="lab-headline">: the one
	// number of a sitting, large, with its interval under it.
	function headline(h) {
		h = cleanHeadline(h);
		var box = el('div', 'lab-headline' + (h.value == null ? ' is-empty' : ''));
		box.appendChild(el('div', 'lab-headline-label', h.label));
		// the value and both ends of the interval are written the same way (the unit decides the decimals)
		var value = el('div', 'lab-headline-value', format(h.value, { unit: h.unit, bare: true, digits: h.digits, signed: h.signed }));
		if (h.unit && h.value != null) value.appendChild(el('span', 'lab-headline-unit', h.unit === '%' ? '%' : NBSP + h.unit));
		box.appendChild(value);
		if (h.value == null) box.appendChild(el('div', 'lab-headline-ci', 'There was not enough data for a number.'));
		else if (h.ci) {
			box.appendChild(el('div', 'lab-headline-ci', (h.ciLabel || '95% interval') + ' ' +
				format(h.ci[0], { unit: h.unit, bare: true, digits: h.digits, signed: h.signed }) + ' to ' + format(h.ci[1], { unit: h.unit, digits: h.digits, signed: h.signed })));
		}
		return box;
	}

	// code('x = 1\nprint(x)') -> <pre class="lab-code"> with numbered lines, the
	// way misc/05-obfuscation-game prints a snippet. { numbers: false } leaves
	// the numbers out.
	function code(source, o) {
		var pre = el('pre', 'lab-code');
		var lines = String(source == null ? '' : source).replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
		lines.forEach(function (text, i) {
			var row = el('span', 'lab-code-line');
			if (!o || o.numbers !== false) {
				var num = el('span', 'lab-code-n', String(i + 1));
				num.setAttribute('aria-hidden', 'true');
				row.appendChild(num);
			}
			row.appendChild(el('span', 'lab-code-src', text));
			pre.appendChild(row);             // each line is a block (lab.css), so no newline goes between them
		});
		return pre;
	}

	// fail(err): the end of every session's promise chain. Shows the kit's
	// failure panel and lets the page count as ready:
	//     session.instructions(...).then(...).catch(Lab.fail);
	function fail(err) {
		Kit.fail(err);
		Kit.ready();
	}

	// each(list, fn) -> Promise of the results: fn(item, i) for one item after the
	// other, each waiting for the promise of the one before.
	function each(list, fn) {
		var items = Array.prototype.slice.call(list || []), out = [];
		var chain = Promise.resolve();
		items.forEach(function (item, i) {
			chain = chain.then(function () { return fn(item, i); }).then(function (r) { out.push(r); });
		});
		return chain.then(function () { return out; });
	}

	// ---- The session ---------------------------------------------------------------------

	// session({ exp, version, stage, seed, mount }) -> the session.
	//   exp      the experiment's id: the toy's slug
	//   version  bump it when the trials or the scoring change, so old records are not mixed with new ones
	//   stage    the stage of the loop the experiment is about: h1 h2 h3 m1 m2 m3 xin xout
	//   seed     optional; without one each sitting gets a new seed (?seed= fixes it; ?thumb=1 and ?auto= use a fixed one)
	//   mount    optional selector or element to build in; otherwise #lab, else main.kit-main
	function session(opts) {
		opts = opts || {};
		var exp = String(opts.exp == null ? Kit.id : opts.exp);
		if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(exp)) throw new TypeError('Lab.session: exp must be the toy\'s slug, got ' + JSON.stringify(opts.exp));
		var stageId = opts.stage;
		if (!stage(stageId)) throw new TypeError('Lab.session: stage must be one of ' + STAGES.map(function (s) { return s.id; }).join(', ') + ', got ' + JSON.stringify(opts.stage));
		var version = opts.version == null ? 1 : opts.version;
		var seed = Kit.thumb ? 'thumb' : String(Kit.params.get('seed') || (opts.seed != null ? opts.seed : AUTO ? 'lab' : Date.now().toString(36)));
		var random = rng(seed), autoRandom = rng(seed + ':auto');
		var born = performance.now();

		// -- the frame of the page ---------------------------------------------------
		var host = null;
		try { host = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount; } catch (e) { host = null; }
		host = host || document.querySelector('#lab') || document.querySelector('main.kit-main') || document.body;
		var old = host.querySelector(':scope > .lab');
		if (old) host.removeChild(old);
		var root = el('div', 'lab' + (AUTO ? ' is-auto' : ''));
		root.setAttribute('data-exp', exp);
		if (AUTO && !Kit.thumb) {
			root.appendChild(el('p', 'lab-auto-note', 'Simulated participant "' + autoName() + '": a script answered every trial at once. These are not your results, and nothing was saved. ' +
				'Seed "' + seed + '": one draw of many; "Run it with another seed" shows how much a sitting this short can vary.'));
		}
		var progressEl = el('div', 'lab-progress');
		progressEl.setAttribute('role', 'progressbar');
		progressEl.setAttribute('aria-label', 'Progress through the session');
		progressEl.setAttribute('aria-valuemin', '0');
		progressEl.hidden = true;
		var bar = el('div', 'lab-progress-bar');
		progressEl.appendChild(bar);
		var screen = el('div', 'lab-screen');
		var status = el('div', 'lab-status kit-sr');
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');
		root.appendChild(progressEl);
		root.appendChild(screen);
		root.appendChild(status);
		host.appendChild(root);

		var state = { trials: [], practice: [], count: 0, busy: false, record: null, saved: false, sheet: null, shown: false, readied: false, away: false };
		var view = null;                    // the trial screen, built once and kept

		function phase(name) { root.setAttribute('data-phase', name); }
		function say(text) { status.textContent = ''; status.textContent = text; }
		function show(node, name) {
			screen.textContent = '';
			screen.appendChild(node);
			phase(name);
			// A person sees the first screen: the page is ready. A simulated run is
			// ready when its results are up (see settle()).
			if (!AUTO && !state.readied) { state.readied = true; Kit.ready(); }
		}
		function settle() {
			if (AUTO && state.shown && state.record && !state.readied) { state.readied = true; Kit.ready(); }
		}
		document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') state.away = true; });

		// -- instructions and pauses ----------------------------------------------------
		function panel(kind, content, label, name) {
			return new Promise(function (resolve) {
				var box = el('section', 'lab-panel lab-' + kind);
				var body = el('div', 'lab-panel-body');
				fill(body, content);
				box.appendChild(body);
				var actions = el('div', 'lab-actions');
				var go = el('button', 'lab-go', label);
				go.type = 'button';
				actions.appendChild(go);
				box.appendChild(actions);
				show(box, name);
				if (AUTO) { resolve(); return; }
				go.addEventListener('click', function () {
					if (go.disabled) return;
					go.disabled = true;
					resolve();
				});
				try { go.focus({ preventScroll: true }); } catch (e) { /* focus is a convenience */ }
			});
		}
		// instructions(htmlOrNode, { button: 'Start' }) -> Promise, resolved by the button.
		function instructions(content, o) { return panel('instructions', content, (o && o.button) || 'Start', 'instructions'); }
		// pause(message, { button: 'Continue' }) -> Promise, resolved by the button.
		function pause(message, o) { return panel('pause', message, (o && o.button) || 'Continue', 'pause'); }

		// progress(i, n): i of n done, on the thin bar at the top.
		function progress(i, n) {
			n = Math.max(1, Math.floor(n) || 1);
			i = Math.max(0, Math.min(n, Math.floor(i) || 0));
			progressEl.hidden = false;
			progressEl.setAttribute('aria-valuemax', String(n));
			progressEl.setAttribute('aria-valuenow', String(i));
			progressEl.setAttribute('aria-valuetext', i + ' of ' + n + ' done');
			bar.style.width = (100 * i / n) + '%';
		}

		// -- the trial screen --------------------------------------------------------------
		function trialView() {
			if (!view) {
				view = { root: el('section', 'lab-trial'), card: el('div', 'lab-card'), stim: el('div', 'lab-stim'), feedback: el('p', 'lab-feedback'),
					prompt: el('p', 'lab-prompt'), choices: el('div', 'lab-choices'), form: null, buttons: [] };
				view.card.setAttribute('aria-live', 'polite');
				view.card.setAttribute('aria-atomic', 'true');
				view.card.appendChild(view.stim);
				view.feedback.setAttribute('aria-hidden', 'true');
				view.choices.setAttribute('role', 'group');
				view.choices.setAttribute('aria-label', 'Answers');
				view.root.appendChild(view.card);
				view.root.appendChild(view.feedback);
				view.root.appendChild(view.prompt);
				view.root.appendChild(view.choices);
			}
			if (view.form && view.form.parentNode) view.form.parentNode.removeChild(view.form);
			view.form = null;
			view.choices.hidden = false;
			if (screen.firstChild !== view.root) show(view.root, 'wait');
			return view;
		}
		function setStim(v, waiting) {
			v.stim.textContent = '';
			v.stim.className = 'lab-stim';
			v.card.classList.toggle('is-waiting', !!waiting);
		}
		function setPrompt(v, text) {
			v.prompt.textContent = text == null ? '' : String(text);
			v.prompt.hidden = text == null || text === '';
		}
		function setFeedback(v, kind, content) {
			v.feedback.textContent = '';
			v.feedback.className = 'lab-feedback' + (kind ? ' is-' + kind : '');
			if (!kind) return;
			var mark = el('span', 'lab-feedback-mark');
			mark.setAttribute('aria-hidden', 'true');
			v.feedback.appendChild(mark);
			var words = el('span', 'lab-feedback-text');
			put(words, content);
			v.feedback.appendChild(words);
			say(words.textContent);
		}
		function cleanChoices(list) {
			return (Array.isArray(list) ? list : []).map(function (c, i) {
				c = c && typeof c === 'object' ? c : { label: c, value: c };
				var keys = c.key == null ? [] : (Array.isArray(c.key) ? c.key : [c.key]).map(normKey).filter(Boolean);
				return { label: c.label == null ? String(c.value) : c.label, value: c.value === undefined ? i : c.value, keys: keys };
			});
		}
		// Draws the answer buttons, asleep. pick(index, time) is called by a click,
		// a tap or a press of Enter or Space on a button; `press` remembers when the
		// press began, which is the moment of the answer (the click comes at release).
		function drawChoices(v, choices, pick) {
			var focused = v.buttons.indexOf(document.activeElement);
			var press = { index: -1, at: 0 };
			v.choices.textContent = '';
			v.choices.setAttribute('data-n', String(choices.length));
			v.buttons = choices.map(function (c, i) {
				var b = el('button', 'lab-choice');
				b.type = 'button';
				b.setAttribute('aria-disabled', 'true');
				var label = el('span', 'lab-choice-label');
				put(label, c.label);
				b.appendChild(label);
				if (c.keys.length) {
					var k = el('kbd', null, keyName(c.keys[0]));
					k.setAttribute('aria-hidden', 'true');
					b.appendChild(k);
					b.setAttribute('aria-keyshortcuts', c.keys.map(function (key) { return key === ' ' ? 'Space' : key; }).join(' '));
				}
				b.addEventListener('pointerdown', function (e) {
					if (e.button === 0 || e.button === undefined) { press.index = i; press.at = stamp(e); }
				});
				b.addEventListener('keydown', function (e) {
					if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
					// A held key repeats, and each repeat of Enter would click the
					// button: that is the press of the trial before, not an answer.
					if (e.repeat) { e.preventDefault(); return; }
					press.index = i; press.at = stamp(e);
				});
				b.addEventListener('click', function (e) {
					var at = press.index === i && press.at ? press.at : stamp(e);
					press.index = -1;
					pick(i, at);
				});
				v.choices.appendChild(b);
				return b;
			});
			if (focused >= 0 && v.buttons[focused]) { try { v.buttons[focused].focus({ preventScroll: true }); } catch (e) { /* a convenience */ } }
		}
		function wake(v, on) {
			v.buttons.forEach(function (b) {
				if (on) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
			});
		}
		function isRight(correct, value) {
			if (correct === undefined) return null;
			return typeof correct === 'function' ? !!correct(value) : value === correct;
		}
		function keep(result, spec) {
			if (spec.data !== undefined) result.data = spec.data;
			if (spec.practice) { result.practice = true; state.practice.push(result); }
			else state.trials.push(result);
			state.busy = false;
			return result;
		}

		// The wait before a stimulus, the stimulus, and the start of the clock.
		// present(v, spec, armed): after the gap (and the fixation cross, if asked
		// for) the stimulus is drawn hidden; the next frame shows it; the frame
		// after that is the first one after it was painted, and
		// armed(t0, frameMs, onAt) is called there with t0 = performance.now(),
		// frameMs the display's frame (measured during the wait) and onAt the
		// best guess of when the stimulus reached the screen: t0, or one frame
		// after the frame that showed it when the two callbacks came closer
		// together than a frame (a catch-up frame; the paint is still to come).
		function present(v, spec, armed, failed) {
			var gap = isNum(spec.itiMs) && spec.itiMs >= 0 ? spec.itiMs : 300;
			var fix = isNum(spec.fixationMs) && spec.fixationMs > 0 ? spec.fixationMs : 0;
			var stopSampling = sampleFrames();
			setStim(v, true);
			setFeedback(v, null);
			phase('wait');
			function draw() {
				setStim(v, true);
				try { spec.render(v.stim); } catch (err) { stopSampling(); failed(err); return; }
				nextFrame(function () {
					var shownAt = performance.now();
					v.card.classList.remove('is-waiting');
					nextFrame(function () {
						var t0 = performance.now();
						stopSampling();
						var frame = frameLength(t0 - shownAt);
						armed(t0, frame, Math.max(t0, shownAt + frame));
					});
				});
			}
			window.setTimeout(function () {
				if (!fix) { draw(); return; }
				setStim(v, false);
				v.stim.className = 'lab-stim lab-fix';
				v.stim.textContent = '+';
				window.setTimeout(draw, fix);
			}, gap);
		}

		// The confidence question of misc/05-obfuscation-game (50 to 100 in tens),
		// asked on the same screen after an answer. done(value, rt)
		function askConfidence(v, done) {
			var choices = CONFIDENCE.map(function (c, i) { return { label: c + '%', value: c, keys: [String(i + 1)] }; });
			var t0 = 0, open = false;
			function pick(i, at) {
				if (!open || at < t0) return;
				open = false;
				answering = null;
				wake(v, false);
				v.buttons[i].classList.add('is-chosen');
				done(choices[i].value, round1(at - t0));
			}
			setPrompt(v, 'How sure are you of that answer?');
			v.choices.hidden = false;
			drawChoices(v, choices, pick);
			nextFrame(function () {
				t0 = performance.now();
				open = true;
				wake(v, true);
				phase('confidence');
				answering = function (e) {
					var k = normKey(e.key);
					for (var i = 0; i < choices.length; i++) if (choices[i].keys.indexOf(k) !== -1) { e.preventDefault(); pick(i, stamp(e)); return; }
				};
			});
		}
		function feedbackOf(spec, result) {
			if (!spec.feedback) return null;
			var custom = typeof spec.feedback === 'function' ? spec.feedback(result) : null;
			var kind = result.timedOut ? 'late' : result.correct === true ? 'good' : result.correct === false ? 'bad' : 'plain';
			var words = custom != null ? custom : result.timedOut ? 'Too slow' : result.correct === true ? 'Correct' : result.correct === false ? 'Not quite' : null;
			return words == null ? null : { kind: kind, content: words };
		}
		// After an answer: the confidence question if asked for, the feedback if
		// asked for, then the result goes back.
		function wrapUp(v, spec, result, resolve) {
			function close() {
				var fb = feedbackOf(spec, result);
				if (!fb) { resolve(keep(result, spec)); return; }
				setFeedback(v, fb.kind, fb.content);
				phase('feedback');
				window.setTimeout(function () { resolve(keep(result, spec)); }, isNum(spec.feedbackMs) && spec.feedbackMs >= 0 ? spec.feedbackMs : 700);
			}
			if (spec.confidence && !result.timedOut) {
				askConfidence(v, function (value, rt) {
					result.confidence = value;
					result.confidenceRt = rt;
					setPrompt(v, spec.prompt);
					close();
				});
			} else close();
		}
		function describe(kind, spec, choices, index) {
			var values = choices.map(function (c) { return c.value; });
			return {
				kind: kind, i: index, cond: spec.cond == null ? null : spec.cond, choices: choices.map(function (c) { return { key: c.keys[0] || null, label: c.label, value: c.value }; }),
				values: values, correct: spec.correct, right: values.filter(function (val) { return isRight(spec.correct, val) === true; }),
				deadlineMs: isNum(spec.deadlineMs) ? spec.deadlineMs : null, showMs: isNum(spec.showMs) ? spec.showMs : null, data: spec.data, rng: autoRandom
			};
		}

		// trial({ cond, render(el), choices: [{ key, label, value }], deadlineMs, correct, feedback })
		//     -> Promise of { i, cond, resp, rt, correct, timedOut }
		// See README.md for every option (prompt, confidence, showMs, mask, itiMs,
		// fixationMs, feedbackMs, practice, data).
		function trial(spec) {
			spec = spec || {};
			var choices = cleanChoices(spec.choices);
			if (typeof spec.render !== 'function') return Promise.reject(new TypeError('session.trial needs render(el), which draws the stimulus'));
			if (!choices.length) return Promise.reject(new TypeError('session.trial needs choices: [{ key, label, value }]'));
			if (state.busy) return Promise.reject(new Error('session.trial was called before the trial before it had finished'));
			state.busy = true;
			var index = state.count++;
			var cond = spec.cond == null ? null : spec.cond;
			var deadline = isNum(spec.deadlineMs) && spec.deadlineMs > 0 ? spec.deadlineMs : 0;
			var showMs = isNum(spec.showMs) && spec.showMs > 0 ? spec.showMs : 0;

			return new Promise(function (resolve, reject) {
				var v = trialView();
				function failed(err) { state.busy = false; answering = null; reject(err); }
				setPrompt(v, spec.prompt);

				if (AUTO) {
					try {
						setStim(v, false);
						setFeedback(v, null);
						spec.render(v.stim);
						drawChoices(v, choices, function () {});
						var answer = policy()(describe('trial', spec, choices, index)) || {};
						var chosen = -1;
						for (var c = 0; c < choices.length; c++) if (choices[c].value === answer.resp) { chosen = c; break; }
						if (chosen < 0 && answer.resp != null) throw new Error('Lab.auto: the simulated participant answered ' + JSON.stringify(answer.resp) + ', which is not one of the choices of trial ' + index);
						var late = chosen < 0 || !isNum(answer.rt) || (deadline > 0 && answer.rt > deadline);
						var simulated = { i: index, cond: cond, resp: late ? null : choices[chosen].value, rt: late ? null : round1(answer.rt),
							correct: late ? (spec.correct === undefined ? null : false) : isRight(spec.correct, choices[chosen].value), timedOut: late };
						if (showMs) simulated.shownMs = showMs;
						if (spec.confidence && !late) assign(simulated, simConfidence(answer));     // confidence and confidenceRt, as a real answer has
						resolve(keep(simulated, spec));
					} catch (err) { failed(err); }
					return;
				}

				var t0 = 0, armed = false, timer = 0, shownMs = null;
				state.away = false;
				function respond(i, at, late) {
					if (!armed) return;
					if (!late && at < t0) return;                // a press that began before the stimulus
					armed = false;
					answering = null;
					window.clearTimeout(timer);
					wake(v, false);
					if (!late) v.buttons[i].classList.add('is-chosen');
					var result = { i: index, cond: cond, resp: late ? null : choices[i].value, rt: late ? null : round1(at - t0),
						correct: late ? (spec.correct === undefined ? null : false) : isRight(spec.correct, choices[i].value), timedOut: !!late };
					if (shownMs != null) result.shownMs = shownMs;
					else if (showMs) result.shownMs = round1((late ? performance.now() : at) - t0);     // answered while it was still up
					if (state.away) result.away = true;          // the tab was hidden during the trial
					wrapUp(v, spec, result, resolve);
				}
				drawChoices(v, choices, function (i, at) { respond(i, at, false); });
				present(v, spec, function (start, frameMs, onAt) {
					t0 = start;
					armed = true;
					wake(v, true);
					phase('armed');
					answering = function (e) {
						var k = normKey(e.key);
						for (var i = 0; i < choices.length; i++) {
							if (choices[i].keys.indexOf(k) !== -1) { e.preventDefault(); respond(i, stamp(e), false); return; }
						}
					};
					if (deadline) timer = window.setTimeout(function () { respond(-1, 0, true); }, deadline);
					if (showMs) {
						// Take the stimulus away on the frame that makes its time on
						// screen closest to showMs. It reached the screen at onAt, and
						// what a frame draws is seen one frame later. Good to about a
						// frame, no better: the browser does not say when it painted.
						var hide = function () {
							if (!armed) return;                  // answered already: nothing to hide
							var now = performance.now();
							if (now + frameMs - onAt < showMs - frameMs / 2) { window.requestAnimationFrame(hide); return; }
							shownMs = round1(now + frameMs - onAt);
							v.stim.textContent = '';
							v.stim.className = 'lab-stim is-masked';
							if (typeof spec.mask === 'function') { try { spec.mask(v.stim); } catch (err) { /* a mask that fails leaves a blank */ } }
						};
						window.requestAnimationFrame(hide);
					}
				}, failed);
			});
		}

		// text({ cond, render(el), placeholder, label, button, multiline, correct, ... })
		//     -> Promise of { i, cond, resp, rt, rtFirstKey, correct, timedOut: false }
		// A typed answer. rt runs to the press of Enter or of the button;
		// rtFirstKey to the first character.
		var inputCount = 0;
		function text(spec) {
			spec = spec || {};
			if (typeof spec.render !== 'function') return Promise.reject(new TypeError('session.text needs render(el), which draws the stimulus'));
			if (state.busy) return Promise.reject(new Error('session.text was called before the trial before it had finished'));
			state.busy = true;
			var index = state.count++;
			var cond = spec.cond == null ? null : spec.cond;

			function verdict(result) {
				var want = spec.correct;
				if (want === undefined) result.correct = null;
				else if (typeof want === 'function') result.correct = !!want(result.resp);
				else if (want instanceof RegExp) result.correct = want.test(normalize(result.resp));
				else {
					var j = judge(result.resp, String(want));
					result.correct = j.correct;
					if (j.nearMiss) result.nearMiss = true;
				}
				return result;
			}

			return new Promise(function (resolve, reject) {
				var v = trialView();
				function failed(err) { state.busy = false; answering = null; reject(err); }
				setPrompt(v, spec.prompt);
				v.choices.textContent = '';
				v.choices.hidden = true;
				v.buttons = [];

				var form = el('form', 'lab-answer');
				form.noValidate = true;
				var id = 'lab-input-' + (++inputCount);
				var label = el('label', 'lab-answer-label', spec.label || 'Your answer');
				label.htmlFor = id;
				var input = el(spec.multiline ? 'textarea' : 'input', 'lab-input');
				input.id = id;
				if (!spec.multiline) input.type = 'text';
				else input.rows = 3;
				input.autocomplete = 'off';
				input.spellcheck = false;
				input.setAttribute('autocapitalize', 'off');
				input.setAttribute('autocorrect', 'off');
				if (spec.inputmode) input.setAttribute('inputmode', spec.inputmode);
				if (spec.placeholder) input.placeholder = spec.placeholder;
				if (isNum(spec.maxLength) && spec.maxLength > 0) input.maxLength = spec.maxLength;
				input.disabled = true;
				var go = el('button', 'lab-go', spec.button || 'Submit');
				go.type = 'submit';
				go.disabled = true;
				var row = el('div', 'lab-answer-row');
				row.appendChild(input);
				row.appendChild(go);
				form.appendChild(label);
				form.appendChild(row);
				v.root.appendChild(form);
				v.form = form;

				if (AUTO) {
					try {
						setStim(v, false);
						setFeedback(v, null);
						spec.render(v.stim);
						var d = describe('text', spec, [], index);
						var answer = policy()(d) || {};
						var typed = answer.resp == null ? '' : String(answer.resp);
						input.value = typed;
						var simulated = verdict({ i: index, cond: cond, resp: typed, rt: isNum(answer.rt) ? round1(answer.rt) : null, rtFirstKey: isNum(answer.rt) ? round1(answer.rt * 0.6) : null, correct: null, timedOut: false });
						if (spec.confidence) assign(simulated, simConfidence(answer));
						resolve(keep(simulated, spec));
					} catch (err) { failed(err); }
					return;
				}

				var t0 = 0, armed = false, firstKey = null, enterAt = 0;
				state.away = false;
				input.addEventListener('input', function (e) { if (armed && firstKey == null) firstKey = round1(Math.max(0, stamp(e) - t0)); });
				input.addEventListener('keydown', function (e) {
					if (e.key !== 'Enter' || e.repeat || e.isComposing) return;
					if (spec.multiline && e.shiftKey) return;                  // Shift+Enter: a new line
					enterAt = stamp(e);
					if (spec.multiline) { e.preventDefault(); submit(e); }
				});
				go.addEventListener('pointerdown', function (e) { enterAt = stamp(e); });
				function submit(e) {
					if (e && e.preventDefault) e.preventDefault();
					if (!armed) return;
					// the press that led here (Enter, or the button going down), if it was just now
					var at = enterAt && performance.now() - enterAt < 1500 ? enterAt : stamp(e);
					enterAt = 0;
					if (!spec.allowEmpty && !input.value.trim()) { Kit.toast('Type an answer first.'); return; }
					armed = false;
					input.disabled = true;
					go.disabled = true;
					var result = verdict({ i: index, cond: cond, resp: input.value, rt: round1(Math.max(0, at - t0)), rtFirstKey: firstKey, correct: null, timedOut: false });
					if (state.away) result.away = true;
					v.choices.hidden = !spec.confidence;
					wrapUp(v, spec, result, resolve);
				}
				form.addEventListener('submit', submit);
				present(v, spec, function (start) {
					t0 = start;
					armed = true;
					input.disabled = false;
					go.disabled = false;
					phase('armed');
					try { input.focus({ preventScroll: true }); } catch (e) { /* a convenience */ }
				}, failed);
			});
		}

		// eachTrial(list, fn) -> Promise of the results, one item after the other,
		// moving the progress bar as it goes ({ progress: false } leaves it alone).
		function eachTrial(list, fn, o) {
			var items = Array.prototype.slice.call(list || []);
			var move = !o || o.progress !== false;
			return each(items, function (item, i) {
				if (move) progress(i, items.length);
				return fn(item, i);
			}).then(function (out) {
				if (move) progress(items.length, items.length);
				return out;
			});
		}
		// loop(fn, { max: 1000 }) -> Promise of the results: fn(i, soFar) is called
		// again and again, each call waiting for the one before, until it returns
		// false (or nothing). For a staircase, where the next trial depends on the
		// last answer.
		function loop(fn, o) {
			var max = o && o.max > 0 ? o.max : 1000, out = [];
			return new Promise(function (resolve, reject) {
				(function step(i) {
					if (i >= max) { resolve(out); return; }
					var p;
					try { p = fn(i, out); } catch (err) { reject(err); return; }
					if (p === false || p == null) { resolve(out); return; }
					Promise.resolve(p).then(function (r) { out.push(r); step(i + 1); }, reject);
				})(0);
			});
		}

		// -- results ------------------------------------------------------------------------
		function drawHeadline() {
			if (!state.sheet || !state.record) return;
			state.sheet.slot.textContent = '';
			if (state.sheet.wantHeadline) state.sheet.slot.appendChild(headline(state.record.headline));
		}
		// results(render, { title, headline: true }): the results sheet. render(el,
		// session) draws the experiment's own part (charts, a sentence or two); the
		// kit adds the title, the stage, the headline number of the record (when
		// finish() has it), the caveat and the buttons.
		function results(render, o) {
			o = o || {};
			answering = null;
			var sheet = el('section', 'lab-sheet');
			var head = el('header', 'lab-sheet-head');
			var title = el('h2', 'lab-sheet-title', o.title || (AUTO ? 'A simulated sitting' : 'Your results'));
			title.tabIndex = -1;
			head.appendChild(title);
			head.appendChild(stageChip(stageId));
			if (AUTO) head.appendChild(el('span', 'lab-chip lab-sim', 'simulated participant'));
			sheet.appendChild(head);
			var slot = el('div', 'lab-headline-slot');
			sheet.appendChild(slot);
			var body = el('div', 'lab-sheet-body');
			sheet.appendChild(body);
			show(sheet, 'results');
			progressEl.hidden = true;
			state.sheet = { root: sheet, slot: slot, body: body, wantHeadline: o.headline !== false };
			drawHeadline();
			try {
				if (typeof render === 'function') render(body, api);
			} finally {
				sheet.appendChild(caveat());
				var actions = el('div', 'lab-actions lab-sheet-actions');
				// A simulated sitting replays its seed, so running it again would only
				// repeat it: under ?auto= the button draws a new seed (kept in the address).
				var reseed = AUTO && !Kit.thumb;
				var again = el('button', 'kit-btn primary', reseed ? 'Run it with another seed' : 'Run it again');
				again.type = 'button';
				again.addEventListener('click', function () {
					if (!reseed) { window.location.reload(); return; }
					var u = new URL(window.location.href);
					u.searchParams.set('seed', Date.now().toString(36));
					window.location.assign(u.toString());
				});
				actions.appendChild(again);
				if (!AUTO) {
					var keepBtn = el('button', 'kit-btn', 'Download my data');
					keepBtn.type = 'button';
					keepBtn.addEventListener('click', function () {
						var mine = history(exp);
						if (!mine.length) { Kit.toast('Nothing is saved for this experiment in this browser.'); return; }
						Kit.download(exp + '-results.json', JSON.stringify(mine, null, '\t'), 'application/json');
						Kit.toast('Saved ' + mine.length + ' sitting' + (mine.length === 1 ? '' : 's') + ' as a JSON file.');
					});
					actions.appendChild(keepBtn);
					var forget = el('button', 'kit-btn', 'Forget my results');
					forget.type = 'button';
					forget.addEventListener('click', function () {
						var gone = clear(exp);
						Kit.toast(gone ? 'Removed ' + gone + ' saved sitting' + (gone === 1 ? '' : 's') + ' of this experiment from this browser.' : 'Nothing was saved for this experiment.');
					});
					actions.appendChild(forget);
				}
				sheet.appendChild(actions);
			}
			if (!AUTO) { try { title.focus({ preventScroll: true }); } catch (e) { /* a convenience */ } }
			say('The results are ready.');
			state.shown = true;
			settle();
			return sheet;
		}

		// finish({ headline: { label, value, unit, ci }, n, trials, extra }) -> the record.
		// Completes the record of this sitting (exp, version, stage, seed and the
		// time come from the session; n and trials default to the trials the session
		// ran), saves it with Lab.save and shows its headline on the results sheet.
		// A simulated sitting is returned with `auto` set and is NOT saved.
		function finish(fields) {
			fields = fields || {};
			var rec = makeRecord({
				exp: exp, version: version, stage: stageId, seed: seed,
				headline: fields.headline,
				trials: fields.trials == null ? state.trials : fields.trials,
				n: fields.n == null ? (fields.trials == null ? state.trials.length : fields.trials.length) : fields.n,
				extra: fields.extra,
				auto: AUTO ? autoName() : null
			}, Kit.thumb ? THUMB_TIME : new Date().toISOString());
			state.record = rec;
			lastRecord = rec;
			state.saved = AUTO ? false : save(rec);
			if (!AUTO && !state.saved) Kit.toast('This browser would not store the result, so it is shown but not saved.');
			drawHeadline();
			settle();
			return rec;
		}

		var api = {
			exp: exp, version: version, stage: stageId, seed: seed, auto: AUTO ? autoName() : null,
			rng: random,
			shuffle: function (list) { return random.shuffle(list); },
			pick: function (list) { return random.pick(list); },
			root: root,
			trials: state.trials,
			practice: state.practice,
			instructions: instructions, pause: pause, progress: progress,
			trial: trial, text: text, each: eachTrial, loop: loop,
			results: results, finish: finish,
			history: function () { return history(exp); }
		};
		Object.defineProperty(api, 'record', { enumerable: true, get: function () { return state.record; } });
		Object.defineProperty(api, 'saved', { enumerable: true, get: function () { return state.saved; } });
		Object.defineProperty(api, 'elapsedMs', { enumerable: true, get: function () { return performance.now() - born; } });
		return api;
	}

	var Lab = assign({}, pure, {
		isAuto: AUTO,
		session: session, auto: auto, each: each,
		save: save, history: history, latest: latest, all: all, clear: clear,
		caveat: caveat, headline: headline, stageChip: stageChip, code: code, fail: fail
	});
	Object.defineProperty(Lab, 'autoName', { enumerable: true, get: autoName });
	// Lab.last: the record session.finish() built on this page, simulated or not
	// (null before). A test reads a simulated record here, since none is stored.
	Object.defineProperty(Lab, 'last', { enumerable: true, get: function () { return lastRecord; } });
	window.Lab = Lab;
})();
