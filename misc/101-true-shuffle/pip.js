/*
 * True Shuffle: the mini player (pip.js). On a desktop, Chrome and Edge (116
 * and later) can open a small window that stays on top of every other window
 * (the Document Picture-in-Picture API). The mini player fills it with the
 * song's cover, title, artist and work, Previous, Play or Pause, Next, Like, a
 * seek bar and Back to the tab, and follows the song, the play state and the
 * time. YouTube's player never moves into the window: moving an iframe reloads
 * it, and YouTube's terms want the player visible in the page. The window
 * holds only the page's own controls.
 *
 *     P.supported() -> whether this browser can open it
 *     P.open(ctx) -> a promise of true once it is open     P.close()     P.toggle(ctx)     P.isOpen()
 *     P.model(s) -> what the window shows: words, icons, disabled states, times
 *     P.layoutFor(w, h) -> 'tiny' | 'compact' | 'tall' | 'wide'
 *     P.keyAction(key, { tag, ctrl, meta, alt }) -> 'toggle' | 'next' | 'prev' | 'like' | 'back' | 'forward' | 'close' | null
 *     P.pickCss(ruleLists) -> the page's CSS the window needs: both themes' tokens and the parts it draws with
 *
 * ctx is app.js's pageCtx. UMD: window.TrueShuffle.pip in the browser, module.exports in Node.
 */
(function (root, factory) {
	var api = factory(root);
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.pip = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
	'use strict';

	var DOT = String.fromCharCode(0xB7);
	// What the window asks for; Chrome may keep the size the listener last gave it instead.
	var SIZE = { width: 360, height: 150 };
	var SEEK_SEC = 5;
	var TINY_W = 300, TINY_H = 130, WIDE_W = 520, TALL_H = 300;

	// ---- The pure parts ----------------------------------------------------------------

	function clock(sec) {
		sec = Math.max(0, Math.round(+sec || 0));
		var hh = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
		return (hh ? hh + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
	}
	// The seek bar and the two times, as app.js's renderTime draws them in the bar.
	function seekOf(time, durationSec, state, hasSong) {
		time = time || {};
		var dur = Math.max(0, +time.duration || +durationSec || 0), cur = Math.max(0, +time.current || 0);
		if (dur) cur = Math.min(cur, dur);
		return {
			max: Math.max(1, Math.round(dur)), value: Math.round(cur),
			pct: dur ? Math.round(1000 * cur / dur) / 10 : 0,
			disabled: !hasSong || !state || state === 'idle',
			cur: clock(cur), dur: clock(dur), text: clock(cur) + ' of ' + clock(dur)
		};
	}
	// s: { song: { title, artist, work, durationSec } or null, hasMusic, state (the player's),
	//      bar: { prev, next, play } (what the bar's buttons allow now), liked, time: { current, duration } }
	function model(s) {
		s = s || {};
		var song = s.song || null, bar = s.bar || {}, state = s.state || 'idle';
		var playing = state === 'playing' || state === 'loading';
		var title, sub;
		if (song) {
			title = song.title || 'Untitled';
			var artist = song.artist || '', work = song.work || '';
			sub = artist && work ? artist + ' ' + DOT + ' ' + work : artist || work;
		} else {
			title = s.hasMusic ? 'Nothing playing' : 'No music yet';
			sub = s.hasMusic ? 'Press play for a true shuffle' : 'Import your playlists in the tab first';
		}
		var liked = !!(song && s.liked);
		return {
			empty: !song,
			title: title,
			sub: sub,
			docTitle: song ? title + (song.artist ? ' ' + DOT + ' ' + song.artist : '') : 'True Shuffle',
			play: { icon: playing ? 'pause' : 'play', label: playing ? 'Pause' : 'Play', disabled: !bar.play },
			prev: { disabled: !bar.prev },
			next: { disabled: !bar.next },
			like: { pressed: liked, label: liked ? 'Liked' : 'Like', disabled: !song },
			seek: seekOf(s.time, song && song.durationSec, state, !!song)
		};
	}

	// tiny: a title, the bar and the buttons; compact: the cover beside the title (360 by 150);
	// tall: the cover on top; wide: the cover on the left, as tall as the window allows.
	function layoutFor(w, h) {
		w = +w || 0;
		h = +h || 0;
		if (!w || !h) return 'compact';
		if (w < TINY_W || h < TINY_H) return 'tiny';
		if (w >= WIDE_W) return 'wide';
		return h >= TALL_H ? 'tall' : 'compact';
	}

	var KEYS = { n: 'next', p: 'prev', l: 'like', w: 'close', ArrowLeft: 'back', ArrowRight: 'forward' };
	// A key pressed in the window. A button keeps Space and Enter, the seek bar its arrows.
	function keyAction(key, o) {
		o = o || {};
		key = String(key || '');
		if (o.ctrl || o.meta || o.alt) return null;
		var tag = String(o.tag || '').toUpperCase();
		if (tag === 'BUTTON' && (key === ' ' || key === 'Spacebar' || key === 'Enter')) return null;
		if (tag === 'INPUT' && /^(Arrow|Page|Home$|End$)/.test(key)) return null;
		if (key === ' ' || key === 'Spacebar') return 'toggle';
		return KEYS[key.length === 1 ? key.toLowerCase() : key] || null;
	}

	// The rules the window copies from the page: the tokens of both themes (:root and
	// :root[data-theme="dark"] in kit.css, app.css and ds.css) and the parts it draws
	// with (ts-btn, ts-i, ts-art, ts-range). ruleLists: one list of CSS rules per sheet.
	var TOKEN_SEL = /^:root(\[data-theme=(["']?)(dark|light)\2\])?$/;
	var PART_SEL = /^\.ts-(btn|i|art|range)(?![a-z0-9_])/;
	function wanted(sel) { sel = sel.trim(); return TOKEN_SEL.test(sel) || PART_SEL.test(sel); }
	function pickCss(ruleLists) {
		var out = [];
		(ruleLists || []).forEach(function (rules) {
			(rules || []).forEach(function (r) {
				if (r && typeof r.selectorText === 'string' && r.cssText && r.selectorText.split(',').some(wanted)) out.push(r.cssText);
			});
		});
		return out.join('\n');
	}

	// The window's own look, on the copied tokens.
	var CSS = [
		'html, body { margin: 0; height: 100%; }',
		'body { background: var(--ts-panel); color: var(--text); font-family: var(--font-body); font-size: 14px; overflow: hidden; }',
		'[hidden] { display: none !important; }',
		'.pip, .pip * { box-sizing: border-box; }',
		'.pip { height: 100%; display: grid; align-content: center; gap: 6px 12px; padding: 10px 12px;',
		'  grid-template-columns: auto minmax(0, 1fr); grid-template-areas: "art info" "seek seek" "btns btns"; }',
		'.pip-art { grid-area: art; width: 48px; }',
		'.pip-art .ts-art { width: 100%; border-radius: 6px; }',
		'.pip-info { grid-area: info; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 2px; }',
		'.pip-title, .pip-sub { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
		'.pip-title { color: var(--heading); font-weight: 650; font-size: 15px; line-height: 1.3; }',
		'.pip-sub { color: var(--text-2); font-size: 13px; line-height: 1.3; }',
		'.pip.is-empty .pip-title { color: var(--text-2); }',
		'.pip-seek { grid-area: seek; display: flex; align-items: center; gap: 8px; min-width: 0; }',
		'.pip-time { flex: none; min-width: 34px; font: 11.5px var(--font-mono); color: var(--text-2); text-align: center; }',
		'.pip-seek .ts-range { min-width: 0; }',
		'.pip-seek:hover .ts-range::-webkit-slider-thumb { opacity: 1; }',
		'.pip .ts-range:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }',
		'.pip-btns { grid-area: btns; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }',
		'.pip-btns .ts-btn { --btn-h: 36px; }',
		'.pip-btns .pip-play { --btn-h: 40px; }',
		'.pip-like { justify-self: start; }',
		'.pip-back { justify-self: end; }',
		'.pip-tp { display: flex; align-items: center; gap: 6px; }',
		'.pip.is-wide { grid-template-areas: "art info" "art seek" "art btns"; gap: 8px 16px; padding: 12px 16px; }',
		'.pip.is-wide .pip-art { width: min(40vw, calc(100vh - 24px), 280px); align-self: center; }',
		'.pip.is-wide .pip-title { font-size: 17px; }',
		'.pip.is-tall { grid-template-columns: minmax(0, 1fr); grid-template-areas: "art" "info" "seek" "btns"; text-align: center; }',
		'.pip.is-tall .pip-art { width: min(100%, calc(100vh - 190px), 240px); justify-self: center; }',
		'.pip.is-tall .pip-title { font-size: 16px; }',
		'.pip.is-tiny { grid-template-columns: minmax(0, 1fr); grid-template-areas: "info" "seek" "btns"; gap: 2px; padding: 6px 8px; }',
		'.pip.is-tiny .pip-art, .pip.is-tiny .pip-sub, .pip.is-tiny .pip-time { display: none; }',
		'.pip.is-tiny .pip-title { font-size: 13px; text-align: center; }',
		'.pip.is-tiny .pip-btns { gap: 4px; }',
		'.pip.is-tiny .pip-btns .ts-btn { --btn-h: 34px; }',
		'.pip.is-tiny .pip-btns .pip-play { --btn-h: 36px; }'
	].join('\n');

	// ---- The window ----------------------------------------------------------------------

	var S = null, opening = false;

	function dpip() { return root.documentPictureInPicture || null; }
	function supported() { var d = dpip(); return !!(d && typeof d.requestWindow === 'function'); }
	function isOpen() { return !!S; }

	// From a click or a key: the browser opens the window only then.
	function open(ctx) {
		if (S) return Promise.resolve(true);
		if (!ctx || !supported() || opening) return Promise.resolve(false);
		opening = true;
		var asked;
		try { asked = dpip().requestWindow({ width: SIZE.width, height: SIZE.height }); } catch (e) { asked = Promise.reject(e); }
		return Promise.resolve(asked).then(function (win) {
			opening = false;
			// a window half drawn is closed, its listeners let go, and the error shows
			try { build(ctx, win); } catch (e) { teardown(); try { win.close(); } catch (e2) { /* gone */ } throw e; }
			return true;
		}, function () {
			opening = false;
			if (ctx.say) ctx.say('The browser did not open the mini player.');
			return false;
		});
	}
	function close() {
		if (!S) return false;
		var win = S.win;
		teardown();
		try { win.close(); } catch (e) { /* closed already */ }
		return true;
	}
	function toggle(ctx) { if (S) { close(); return Promise.resolve(false); } return open(ctx); }

	function sheetRules(doc) {
		var out = [];
		Array.prototype.forEach.call(doc.styleSheets || [], function (sh) {
			try { out.push(Array.prototype.slice.call(sh.cssRules || [])); } catch (e) { /* a sheet from another origin is not ours */ }
		});
		return out;
	}
	function mirrorTheme() {
		if (!S) return;
		var t = root.document.documentElement.getAttribute('data-theme'), de = S.doc.documentElement;
		if (t) { if (de.getAttribute('data-theme') !== t) de.setAttribute('data-theme', t); }
		else de.removeAttribute('data-theme');
	}

	function build(ctx, win) {
		var doc = win.document, h = ctx.h, U = ctx.U;
		var st = S = { ctx: ctx, win: win, doc: doc, offs: [], els: {}, seeking: false, artKey: null, layout: null };
		doc.documentElement.setAttribute('lang', 'en');
		doc.title = 'True Shuffle';
		var style = doc.createElement('style');
		style.id = 'ts-pip-css';
		style.textContent = pickCss(sheetRules(root.document)) + '\n' + CSS;
		doc.head.appendChild(style);
		mirrorTheme();

		var E = st.els;
		E.art = h('div', { class: 'pip-art' });
		E.title = h('p', { class: 'pip-title' });
		E.sub = h('p', { class: 'pip-sub' });
		E.cur = h('span', { class: 'pip-time', text: '0:00' });
		E.dur = h('span', { class: 'pip-time', text: '0:00' });
		E.seek = h('input', { class: 'ts-range', type: 'range', min: '0', max: '1', step: '1', value: '0', disabled: true, aria: { label: 'Position in the song' } });
		E.like = U.btn({ icon: 'heart', label: 'Like', iconOnly: true, kbd: 'L', pressed: false, cls: 'ts-like pip-like', on: { click: function () { ctx.likeNow(); } } });
		E.prev = U.btn({ icon: 'prev', label: 'Previous song', iconOnly: true, kbd: 'P', on: { click: function () { ctx.prev(); } } });
		E.play = U.btn({ icon: 'play', label: 'Play', iconOnly: true, variant: 'primary', kbd: 'Space', cls: 'pip-play', on: { click: function () { ctx.toggle(); } } });
		E.next = U.btn({ icon: 'next', label: 'Next song', iconOnly: true, kbd: 'N', on: { click: function () { ctx.next(); } } });
		E.back = U.btn({ icon: 'external', label: 'Back to the tab', iconOnly: true, cls: 'pip-back', on: { click: backToTab } });
		E.box = h('main', { class: 'pip', aria: { label: 'Mini player' } }, [
			E.art,
			h('div', { class: 'pip-info' }, [E.title, E.sub]),
			h('div', { class: 'pip-seek' }, [E.cur, E.seek, E.dur]),
			h('div', { class: 'pip-btns' }, [E.like, h('div', { class: 'pip-tp', role: 'group', aria: { label: 'Playback' } }, [E.prev, E.play, E.next]), E.back])
		]);
		E.seek.addEventListener('input', function () { st.seeking = true; E.cur.textContent = clock(+E.seek.value); });
		E.seek.addEventListener('change', function () { st.seeking = false; var p = ctx.player(); if (p) p.seek(+E.seek.value); });
		doc.addEventListener('keydown', function (e) {
			var a = S === st ? keyAction(e.key, { tag: e.target && e.target.tagName, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey }) : null;
			if (!a) return;
			e.preventDefault();
			act(a);
		});
		doc.body.appendChild(E.box);

		function on(target, name, fn) { target.addEventListener(name, fn); st.offs.push(function () { target.removeEventListener(name, fn); }); }
		// app.js says 'bar' each time it draws the bar's buttons: a song, a like, the queue or the play state changed.
		st.offs.push(ctx.bus.on('bar', render));
		var p = ctx.player();
		if (p && p.on) st.offs.push(p.on('time', renderTime));
		if (root.MutationObserver) {
			var mo = new root.MutationObserver(mirrorTheme);
			mo.observe(root.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
			st.offs.push(function () { mo.disconnect(); });
		}
		on(win, 'resize', layout);
		// closed from outside: the window's own close button, or Chrome's back-to-tab button
		on(win, 'pagehide', function () { if (S === st) teardown(); });
		on(root, 'pagehide', close);
		layout();
		render();
	}
	function teardown() {
		if (!S) return;
		var s = S;
		S = null;
		s.offs.forEach(function (off) { try { off(); } catch (e) { /* gone with the window */ } });
		s.offs = [];
	}

	function act(a) {
		var ctx = S.ctx, p = ctx.player();
		if (a === 'toggle') ctx.toggle();
		else if (a === 'next') ctx.next();
		else if (a === 'prev') ctx.prev();
		else if (a === 'like') ctx.likeNow();
		else if (a === 'close') close();
		else if (p && p.state() !== 'idle') {
			var tm = p.time();
			p.seek(Math.max(0, Math.min(tm.duration || 0, tm.current + (a === 'forward' ? SEEK_SEC : -SEEK_SEC))));
		}
	}
	// The opener's focus() from a click in the window brings the tab forward (Chrome's documented way).
	function backToTab() { try { root.focus(); } catch (e) { /* the browser said no */ } }

	function layout() {
		if (!S) return;
		var name = layoutFor(S.win.innerWidth, S.win.innerHeight), box = S.els.box;
		if (name === S.layout) return;
		S.layout = name;
		['tiny', 'compact', 'tall', 'wide'].forEach(function (n) { box.classList.toggle('is-' + n, n === name); });
	}

	function nowTrack(ctx) { var c = ctx.ctl(), id = c ? c.current() : null; return id != null ? ctx.trackOf(id) : null; }
	function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
	function render() {
		if (!S) return;
		var ctx = S.ctx, E = S.els, U = ctx.U, p = ctx.player(), t = nowTrack(ctx), bar = ctx.bar();
		var m = model({
			song: t ? { title: ctx.words.title(t), artist: ctx.words.artist(t), work: t.work || '', durationSec: t.durationSec } : null,
			hasMusic: bar.play, state: p ? p.state() : 'idle', bar: bar, liked: !!(t && ctx.liked(t.id)), time: p ? p.time() : null
		});
		var artKey = (t ? t.id : '') + '|' + (ctx.prefs().art ? 1 : 0);
		if (artKey !== S.artKey) { S.artKey = artKey; ctx.clear(E.art); E.art.appendChild(ctx.art(t)); }
		setText(E.title, m.title);
		setText(E.sub, m.sub);
		E.title.title = m.title;
		E.sub.title = m.sub;
		E.box.classList.toggle('is-empty', m.empty);
		if (S.doc.title !== m.docTitle) S.doc.title = m.docTitle;
		if (E.play.dataset.icon !== m.play.icon) U.btnState(E.play, { icon: m.play.icon, label: m.play.label });
		E.play.disabled = m.play.disabled;
		E.prev.disabled = m.prev.disabled;
		E.next.disabled = m.next.disabled;
		if ((E.like.getAttribute('aria-pressed') === 'true') !== m.like.pressed) U.btnState(E.like, { pressed: m.like.pressed, label: m.like.label });
		E.like.disabled = m.like.disabled;
		drawTime(m.seek);
	}
	function renderTime() {
		if (!S) return;
		var p = S.ctx.player(), t = nowTrack(S.ctx);
		drawTime(seekOf(p ? p.time() : null, t && t.durationSec, p ? p.state() : 'idle', !!t));
	}
	function drawTime(sk) {
		var E = S.els, r = E.seek;
		r.max = String(sk.max);
		if (!S.seeking) { r.value = String(sk.value); setText(E.cur, sk.cur); r.style.setProperty('--p', sk.pct + '%'); }
		setText(E.dur, sk.dur);
		r.disabled = sk.disabled;
		r.setAttribute('aria-valuetext', sk.text);
	}

	return {
		supported: supported, open: open, close: close, toggle: toggle, isOpen: isOpen,
		model: model, layoutFor: layoutFor, keyAction: keyAction, pickCss: pickCss,
		CSS: CSS, SIZE: SIZE, SEEK_SEC: SEEK_SEC
	};
});
