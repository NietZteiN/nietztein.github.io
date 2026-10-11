// pip: the mini player window's pure parts (model, layoutFor, keyAction, pickCss) and
// what it does in Node, where there is no window to open.
module.exports = function (h) {
	var fs = require('fs');
	var path = require('path');
	var P = require(path.join(h.HERE, 'pip.js'));
	var DOT = String.fromCharCode(0xB7);
	var ALL = { prev: true, next: true, play: true };

	// The top-level rules of a style sheet, shaped like CSSStyleRule: { selectorText, cssText }.
	// At-rules (@media, @keyframes) come back without selectorText, as the browser gives them.
	function rulesOf(text) {
		text = text.replace(/\/\*[\s\S]*?\*\//g, '');
		var out = [], i = 0;
		while (i < text.length) {
			var open = text.indexOf('{', i);
			if (open < 0) break;
			var head = text.slice(i, open).trim(), depth = 1, j = open + 1;
			while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
			out.push(head.charAt(0) === '@' ? { cssText: text.slice(i, j).trim() } : { selectorText: head, cssText: head + ' {' + text.slice(open + 1, j - 1) + '}' });
			i = j;
		}
		return out;
	}
	function sheet(file) { return rulesOf(fs.readFileSync(file, 'utf8')); }
	function varsUsed(css) { var seen = {}; css.replace(/var\((--[A-Za-z0-9-]+)/g, function (m, v) { seen[v] = true; return m; }); return Object.keys(seen).sort(); }
	function varsSet(css) { var seen = {}; css.replace(/(--[A-Za-z0-9-]+)\s*:/g, function (m, v) { seen[v] = true; return m; }); return seen; }

	h.describe('pip', function () {
		// ---- model: the words --------------------------------------------------------------
		var song = { title: 'Blue Signal', artist: 'Paper Lanterns', work: 'Starfall Odyssey', durationSec: 225 };
		var m = P.model({ song: song, hasMusic: true, state: 'paused', bar: ALL, liked: false, time: { current: 42, duration: 225 } });
		h.eq([m.empty, m.title, m.sub], [false, 'Blue Signal', 'Paper Lanterns ' + DOT + ' Starfall Odyssey'], 'model: the title, and the artist with the work');
		h.eq(m.docTitle, 'Blue Signal ' + DOT + ' Paper Lanterns', 'model: the window title names the song and the artist');
		h.eq(P.model({ song: { title: 'A', artist: 'B', work: '' } }).sub, 'B', 'model: no work, only the artist');
		h.eq(P.model({ song: { title: 'A', artist: '', work: 'Lumen Tide' } }).sub, 'Lumen Tide', 'model: no artist, only the work');
		h.eq(P.model({ song: { title: '', artist: 'B' } }).title, 'Untitled', 'model: a song without a title says Untitled');
		var none = P.model({ song: null, hasMusic: true, state: 'idle', bar: { play: true } });
		h.eq([none.empty, none.title, none.sub, none.docTitle], [true, 'Nothing playing', 'Press play for a true shuffle', 'True Shuffle'], 'model: nothing playing');
		var empty = P.model({ song: null, hasMusic: false, state: 'idle', bar: {} });
		h.eq([empty.title, empty.sub, empty.play.disabled], ['No music yet', 'Import your playlists in the tab first', true], 'model: an empty library, Play disabled');
		h.eq(P.model().title, 'No music yet', 'model: no state at all is an empty library');

		// ---- model: the buttons ------------------------------------------------------------
		h.eq([m.play.icon, m.play.label, m.play.disabled], ['play', 'Play', false], 'model: paused shows Play');
		var playing = P.model({ song: song, state: 'playing', bar: ALL });
		h.eq([playing.play.icon, playing.play.label], ['pause', 'Pause'], 'model: playing shows Pause');
		h.eq(P.model({ song: song, state: 'loading', bar: ALL }).play.label, 'Pause', 'model: loading counts as playing (the bar does the same)');
		h.eq(['ended', 'error', 'idle'].map(function (s) { return P.model({ song: song, state: s, bar: ALL }).play.label; }), ['Play', 'Play', 'Play'], 'model: ended, error and idle show Play');
		var first = P.model({ song: song, state: 'paused', bar: { prev: false, next: true, play: true } });
		h.eq([first.prev.disabled, first.next.disabled], [true, false], 'model: Previous and Next follow the bar\'s buttons');
		var last = P.model({ song: song, state: 'paused', bar: { prev: true, next: false, play: true } });
		h.eq([last.prev.disabled, last.next.disabled], [false, true], 'model: the last song: Next disabled, as in the bar');
		h.eq([m.like.pressed, m.like.label, m.like.disabled], [false, 'Like', false], 'model: a song not liked');
		var liked = P.model({ song: song, state: 'paused', bar: ALL, liked: true });
		h.eq([liked.like.pressed, liked.like.label], [true, 'Liked'], 'model: a liked song');
		h.eq([none.like.disabled, P.model({ song: null, liked: true }).like.pressed], [true, false], 'model: no song, nothing to like');

		// ---- model: the time ---------------------------------------------------------------
		h.eq([m.seek.cur, m.seek.dur, m.seek.text, m.seek.value, m.seek.max], ['0:42', '3:45', '0:42 of 3:45', 42, 225], 'model: the times and the seek bar');
		h.eq(m.seek.pct, 18.7, 'model: how far, in percent, to a tenth');
		h.eq(m.seek.disabled, false, 'model: the seek bar works once a song is loaded');
		h.eq(P.model({ song: song, state: 'loading', time: { current: 0, duration: 0 } }).seek.dur, '3:45', 'model: the song\'s own length while the player does not know it yet');
		h.eq(P.model({ song: song, state: 'playing', time: { current: 3723, duration: 4000 } }).seek.cur, '1:02:03', 'model: an hour and more');
		h.eq(P.model({ song: song, state: 'playing', time: { current: 300, duration: 225 } }).seek.cur, '3:45', 'model: never past the end');
		h.eq(P.model({ song: song, state: 'playing', time: { current: -4, duration: 225 } }).seek.value, 0, 'model: never before the start');
		h.eq(P.model({ song: song, state: 'playing', time: { current: 59.6, duration: 225 } }).seek.cur, '1:00', 'model: seconds round like the bar');
		var blank = P.model({ song: { title: 'A' }, state: 'idle' }).seek;
		h.eq([blank.cur, blank.dur, blank.max, blank.pct, blank.disabled], ['0:00', '0:00', 1, 0, true], 'model: nothing loaded: 0:00, the bar disabled, never a zero max');
		h.eq(none.seek.disabled, true, 'model: no song, no seeking');

		// ---- layoutFor ---------------------------------------------------------------------
		h.eq(P.layoutFor(P.SIZE.width, P.SIZE.height), 'compact', 'layoutFor: the size it asks for is compact');
		h.eq([P.layoutFor(334, 103), P.layoutFor(299, 200), P.layoutFor(360, 129), P.layoutFor(800, 100)], ['tiny', 'tiny', 'tiny', 'tiny'], 'layoutFor: under 300 wide or 130 tall is tiny');
		h.eq([P.layoutFor(300, 130), P.layoutFor(519, 299)], ['compact', 'compact'], 'layoutFor: the edges of compact');
		h.eq([P.layoutFor(520, 150), P.layoutFor(800, 600), P.layoutFor(640, 200)], ['wide', 'wide', 'wide'], 'layoutFor: from 520 wide');
		h.eq([P.layoutFor(360, 300), P.layoutFor(400, 640)], ['tall', 'tall'], 'layoutFor: narrow and from 300 tall');
		h.eq([P.layoutFor(0, 0), P.layoutFor(NaN, 150), P.layoutFor()], ['compact', 'compact', 'compact'], 'layoutFor: no size yet is compact');

		// ---- keyAction ---------------------------------------------------------------------
		var keys = [' ', 'n', 'N', 'p', 'P', 'l', 'L', 'w', 'W', 'ArrowLeft', 'ArrowRight'].map(function (k) { return P.keyAction(k, { tag: 'BODY' }); });
		h.eq(keys, ['toggle', 'next', 'next', 'prev', 'prev', 'like', 'like', 'close', 'close', 'back', 'forward'], 'keyAction: Space, N, P, L, W and the arrows');
		h.eq(P.keyAction('Spacebar', {}), 'toggle', 'keyAction: the old name of Space');
		h.eq([P.keyAction(' ', { tag: 'BUTTON' }), P.keyAction('Enter', { tag: 'button' })], [null, null], 'keyAction: a focused button keeps Space and Enter');
		h.eq([P.keyAction('n', { tag: 'BUTTON' }), P.keyAction('ArrowRight', { tag: 'BUTTON' })], ['next', 'forward'], 'keyAction: letters and arrows still work on a button');
		h.eq(['ArrowLeft', 'ArrowUp', 'Home', 'End', 'PageDown'].map(function (k) { return P.keyAction(k, { tag: 'INPUT' }); }), [null, null, null, null, null], 'keyAction: the seek bar keeps its own keys');
		h.eq([P.keyAction(' ', { tag: 'INPUT' }), P.keyAction('l', { tag: 'INPUT' })], ['toggle', 'like'], 'keyAction: Space and letters on the seek bar');
		h.eq([P.keyAction('n', { ctrl: true }), P.keyAction('w', { meta: true }), P.keyAction('p', { alt: true })], [null, null, null], 'keyAction: nothing with Ctrl, Cmd or Alt (Ctrl+W closes the window itself)');
		h.eq([P.keyAction('x', {}), P.keyAction('Enter', {}), P.keyAction('Escape', {}), P.keyAction('', {}), P.keyAction()], [null, null, null, null, null], 'keyAction: other keys do nothing');
		h.eq(P.SEEK_SEC, 5, 'the arrows seek five seconds');

		// ---- pickCss -----------------------------------------------------------------------
		var fake = [[
			{ selectorText: ':root', cssText: ':root { --text: #111; }' },
			{ selectorText: ':root[data-theme="dark"]', cssText: ':root[data-theme="dark"] { --text: #eee; }' },
			{ selectorText: 'body.ts', cssText: 'body.ts { display: grid; }' },
			{ selectorText: '.ts-icon-btn', cssText: '.ts-icon-btn { height: 36px; }' },
			{ selectorText: '.ts-bar-art', cssText: '.ts-bar-art { width: 64px; }' },
			{ cssText: '@media (max-width: 760px) { .ts-btn { --btn-h: 44px; } }' }
		], [
			{ selectorText: '.ts-btn', cssText: '.ts-btn { height: var(--btn-h); }' },
			{ selectorText: '.ts-btn-label', cssText: '.ts-btn-label { overflow: hidden; }' },
			{ selectorText: '.ts-btn.ts-like[aria-pressed="true"], .ts-btn.ts-like.is-on, #btn-like.is-on', cssText: '.ts-btn.ts-like.is-on { color: pink; }' },
			{ selectorText: '.ts-i', cssText: '.ts-i { width: 20px; }' },
			{ selectorText: '.ts-i-sp', cssText: '.ts-i-sp { width: 18px; }' },
			{ selectorText: '.ts-art img', cssText: '.ts-art img { width: 100%; }' },
			{ selectorText: '.ts-range::-webkit-slider-thumb', cssText: '.ts-range::-webkit-slider-thumb { opacity: 0; }' },
			{ selectorText: ':root:not(.x)', cssText: ':root:not(.x) { --y: 1; }' },
			{ selectorText: '.ts-seek:hover .ts-range', cssText: '.ts-seek:hover .ts-range { opacity: 1; }' },
			null
		]];
		var picked = P.pickCss(fake).split('\n');
		h.eq(picked, [':root { --text: #111; }', ':root[data-theme="dark"] { --text: #eee; }', '.ts-btn { height: var(--btn-h); }', '.ts-btn-label { overflow: hidden; }', '.ts-btn.ts-like.is-on { color: pink; }', '.ts-i { width: 20px; }', '.ts-i-sp { width: 18px; }', '.ts-art img { width: 100%; }', '.ts-range::-webkit-slider-thumb { opacity: 0; }'], 'pickCss: both themes\' tokens and the parts, in the page\'s order; the shell, other parts and at-rules left out');
		h.eq(P.pickCss([]), '', 'pickCss: no sheets, no rules');
		h.eq(P.pickCss(null), '', 'pickCss: nothing given');

		// On the page's real style sheets: every token the window's rules use is set in both themes.
		var kitDir = path.join(h.HERE, '..', '_kit');
		var sheets = [path.join(kitDir, 'kit.css'), path.join(h.HERE, 'app.css'), path.join(h.HERE, 'ds.css')];
		if (sheets.every(function (f) { return fs.existsSync(f); })) {
			var real = P.pickCss(sheets.map(sheet));
			var rules = rulesOf(real).map(function (r) { return r.cssText; });
			var lightCss = rulesOf(real).filter(function (r) { return r.selectorText === ':root'; }).map(function (r) { return r.cssText; }).join('\n');
			var darkCss = rulesOf(real).filter(function (r) { return /^:root\[data-theme="dark"\]$/.test(r.selectorText || ''); }).map(function (r) { return r.cssText; }).join('\n');
			h.ok(rules.length > 40 && rules.length < 200, 'pickCss: ' + rules.length + ' of the page\'s rules go into the window');
			var light = varsSet(lightCss), dark = varsSet(darkCss);
			// set on an element, not on :root: by the button itself, a badge, the page (the seek bar, the art); or with a fallback
			var local = { '--btn-h': 1, '--role': 1, '--p': 1, '--h': 1, '--s': 1, '--kit-warn-bg': 1 };
			var used = varsUsed(P.CSS + '\n' + real).filter(function (v) { return !local[v]; });
			h.eq(used.filter(function (v) { return !light[v]; }), [], 'pickCss on kit.css, app.css and ds.css: every token the window uses is set for the light theme (' + used.length + ' tokens)');
			var themed = ['--text', '--text-2', '--heading', '--ts-panel', '--accent', '--border-strong', '--ts-play', '--ts-play-ink', '--ts-play-hover', '--ts-like', '--ts-hover', '--ts-tileL'];
			h.eq(themed.filter(function (v) { return !dark[v]; }), [], 'pickCss: the colours have their dark values too');
			h.ok(rules.some(function (r) { return /^\.ts-btn--primary \{/.test(r); }) && rules.some(function (r) { return /^\.ts-art-gen \{/.test(r); }) && rules.some(function (r) { return /^\.ts-range::-webkit-slider-runnable-track/.test(r); }), 'pickCss: the button, the art and the seek bar come along');
			h.ok(!rules.some(function (r) { return /^(body|html|\.ts-bar|\.ts-now|\.ts-modal|\.ts-icon-btn)/.test(r); }), 'pickCss: none of the page\'s layout');
		} else h.ok(true, 'pickCss on the real sheets: skipped (misc/_kit is not next to this copy)');

		// ---- the window's own CSS --------------------------------------------------------
		['tiny', 'compact', 'tall', 'wide'].forEach(function (name) {
			h.ok(name === 'compact' ? /^\.pip \{/m.test(P.CSS) : P.CSS.indexOf('.pip.is-' + name + ' {') >= 0, 'CSS: a rule for the ' + name + ' layout');
		});
		h.ok(/^[\x00-\x7F]*$/.test(fs.readFileSync(path.join(h.HERE, 'pip.js'), 'utf8')), 'pip.js is plain ASCII');

		// ---- in Node: no window ----------------------------------------------------------
		h.eq([P.supported(), P.isOpen(), P.close()], [false, false, false], 'Node: not supported, not open, nothing to close');
		return Promise.all([P.open({ say: function () { throw new Error('should not speak'); } }), P.toggle({}), P.open(null)]).then(function (r) {
			h.eq(r, [false, false, false], 'Node: open and toggle resolve false without a window, and say nothing');
			h.eq([P.SIZE.width, P.SIZE.height], [360, 150], 'SIZE: it asks for 360 by 150');
		});
	});
};
