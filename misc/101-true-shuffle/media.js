/*
 * True Shuffle: one song row, one song card and one song menu for library
 * tracks and found songs alike. A row says where the song came from (a source
 * badge), why it is here (the why line), whether the library has it (a check)
 * and what playing it costs (a badge on Play: 1 or 100 YouTube units while the
 * song still has to be found on YouTube). Its menu plays, queues, keeps and
 * hides the song, and goes to its artist, work, channel or Explore page.
 * Everything is drawn with the page context (app.js pageCtx) and every title
 * goes in as text, never as markup.
 *
 *     Me.item(trackOrFind, ctx) -> { key, videoId, title, artist, work, role, album, cover, preview,
 *                                    durationSec, source, why, mine, track, find, kind, ... }
 *     Me.row(ctx, item, opts) -> <li>            Me.list(ctx, items, opts) -> <ol>
 *     Me.card(ctx, item, opts) -> node           Me.menu(ctx, item, at, opts)
 *     Me.play(ctx, item, mode, opts) -> Promise  Me.playFrom(ctx, items, index, context) -> Promise
 *     Me.whyText(item, max, ctx) -> 'OP2 of ...' Me.sourceBadge(item) -> [kind, text] | null
 *     Me.cost(ctx, item, estimate) -> 0 | 1 | 100 | 'tab'
 *
 * opts: { context: { label, href } (what the queue says is playing), list: [items] (the
 * menu's Play from here plays the rest after it), compact (the now-playing panel: three
 * icons at most), index (a number column showing index + 1), onPlay(item, mode) (replaces
 * Play), badge, why, sub, preview, menuItems(item), onHide(item, kind, undo), go, href }
 *
 * UMD: window.TrueShuffle.media in the browser, module.exports in Node.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(root, !!node);
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.media = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root, inNode) {
	'use strict';

	var DOT = String.fromCharCode(0xB7), ELL = String.fromCharCode(0x2026);
	var LQ = String.fromCharCode(0x201C), RQ = String.fromCharCode(0x201D), RSQ = String.fromCharCode(0x2019);
	var YT_ID = /^[A-Za-z0-9_-]{11}$/;
	var LONG_MS = 500;      // a press this long on a touch screen opens the menu
	var MOVE_PX = 10;       // ... unless the finger moved this far (it was a scroll)
	var AGAIN_MS = 800;     // one menu per press: a long press and the browser's contextmenu event are one

	function str(v) { return v == null ? '' : String(v); }
	function arr(v) { return Array.isArray(v) ? v : []; }
	function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
	function assign(a) {
		for (var i = 1; i < arguments.length; i++) {
			var b = arguments[i];
			if (b) for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k)) a[k] = b[k];
		}
		return a;
	}
	function fold(s) { return str(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
	function q(s) { return LQ + s + RQ; }
	function hueOf(s) { var x = 0; s = str(s); for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 360; return x; }
	// Another module: the page's copy, or in Node the file beside this one.
	function mod(name) {
		var TS = root && root.TrueShuffle;
		if (TS && TS[name]) return TS[name];
		if (inNode && typeof require === 'function') { try { return require('./' + name + '.js'); } catch (e) { return null; } }
		return null;
	}

	// ---- What the page context offers (each one may be missing) ------------------------

	function libOf(ctx) { try { return ctx && typeof ctx.lib === 'function' ? ctx.lib() : null; } catch (e) { return null; } }
	function engineOf(ctx) { try { return ctx && typeof ctx.engine === 'function' ? ctx.engine() : null; } catch (e) { return null; } }
	function canRead(ctx) { try { return !!(ctx && typeof ctx.canRead === 'function' && ctx.canRead()); } catch (e) { return false; } }
	// Pictures from other sites: not in the demo or a thumbnail, and not when cover art is off.
	function artOn(ctx) {
		if (!ctx || ctx.demo || ctx.thumb) return false;
		var p = null;
		try { p = typeof ctx.prefs === 'function' ? ctx.prefs() : null; } catch (e) { p = null; }
		return !(p && p.art === false);
	}
	function clock(ctx, sec) {
		if (ctx && ctx.words && typeof ctx.words.clock === 'function') return ctx.words.clock(sec);
		sec = Math.max(0, Math.round(+sec || 0));
		var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
		return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
	}
	function nav(ctx, hash) { if (ctx && typeof ctx.nav === 'function') ctx.nav(hash); else if (root.location) root.location.hash = hash; }

	// ---- One shape for a library track and a found song ---------------------------------

	function isItem(x) { return !!x && typeof x === 'object' && typeof x.key === 'string' && 'mine' in x && 'track' in x && 'find' in x; }
	function isTrack(x) { return !!x && typeof x === 'object' && typeof x.id === 'string' && Array.isArray(x.playlists); }
	// Reasons: [[kind, value]], or one already in words (shuffle.js similar through the page).
	function whyOf(w) { return typeof w === 'string' ? (w ? [w] : []) : arr(w).slice(); }

	// item(x, ctx): a library track, a light track (a find the queue holds), a find
	// (sources.js shape), a library id, or S.similar's { t, why }, as one item.
	function item(x, ctx) {
		if (x == null) return null;
		if (isItem(x)) return x;
		var why = null;
		if (typeof x === 'string') {
			var l = libOf(ctx), en = engineOf(ctx);
			x = (l && l.tracks && own(l.tracks, x) ? l.tracks[x] : null) || (en && typeof en.track === 'function' ? en.track(x) : null) || null;
			if (!x) return null;
		}
		if (typeof x !== 'object') return null;
		if (x.t && typeof x.t === 'object' && !x.key) { why = x.why; x = x.t; }
		else if (!x.key && !isTrack(x) && (x.track || x.find) && (Array.isArray(x.why) || typeof x.why === 'string')) { why = x.why; x = x.track || x.find; }
		if (!x || typeof x !== 'object') return null;
		return isTrack(x) ? fromTrack(x, ctx, why) : fromFind(x, ctx, why);
	}
	function fromTrack(t, ctx, why) {
		var light = !!t.transient, en = light ? engineOf(ctx) : null;
		var f = en && typeof en.find === 'function' ? en.find(t.id) : null;
		var via = t.foundVia || {};
		return {
			key: str((f && f.key) || via.key || ('v:' + t.id)),
			videoId: t.id,
			title: str(t.title || (t.raw && t.raw.title)),
			artist: str(t.artist || t.artistGuess),
			work: str(t.work), role: str(t.role), album: str(t.album || (f && f.album)),
			cover: str((f && f.cover) || t.cover), preview: str(f && f.preview),
			durationSec: +t.durationSec || +(f && f.durationSec) || 0,
			source: light ? str(via.source || (f && f.source) || 'found') : 'library',
			why: whyOf(why || (light ? (via.why || (f && f.why)) : null)),
			mine: light ? null : t.id,
			track: t, find: f,
			kind: light ? 'light' : 'track',
			guess: !t.artist && !!t.artistGuess,
			sameRecording: !light,
			seq: +(f && f.seq) || 0, version: str(t.version), channel: str(t.channel), channelId: str(t.channelId), artistKey: str(t.artistKey)
		};
	}
	function fromFind(x, ctx, why) {
		var Src = mod('sources');
		var f = Src && typeof Src.find === 'function' ? Src.find(x) : x;
		var l = libOf(ctx), have = l && l.tracks && f.videoId && own(l.tracks, f.videoId) ? l.tracks[f.videoId] : null;
		var copy = have && !have.transient ? have : null;
		var hit = copy ? { id: copy.id, sameRecording: true } : libraryCopy(ctx, f);
		return {
			key: str(f.key), videoId: f.videoId ? str(f.videoId) : null,
			title: str(f.title), artist: str(f.artist),
			work: str(f.work), role: str(f.role), album: str(f.album), cover: str(f.cover), preview: str(f.preview),
			durationSec: +f.durationSec || 0, source: str(f.source), why: whyOf(why || f.why),
			mine: hit ? hit.id : null, track: copy, find: f,
			kind: 'find',
			guess: f.sure === false && !!f.artist,
			sameRecording: !!(hit && hit.sameRecording !== false),
			seq: +f.seq || 0, version: str(f.version), channel: str(f.channel), channelId: str(f.channelId), artistKey: ''
		};
	}
	// The library's copy of a find (match.js inLibrary): on the page's own index (ctx.libIndex),
	// else on one kept here while the library stays the same.
	var libIx = { lib: null, n: -1, ix: null };
	function libraryCopy(ctx, f) {
		var M = mod('match'), l = libOf(ctx), L = ctx && ctx.L;
		if (!M || !l || !l.tracks || !(f.title || f.videoId)) return null;
		try {
			var ix = typeof ctx.libIndex === 'function' ? ctx.libIndex() : null;
			if (!ix) {
				if (!L || typeof L.list !== 'function') return null;
				var n = Object.keys(l.tracks).length;
				if (!n) return null;
				if (libIx.lib !== l || libIx.n !== n) libIx = { lib: l, n: n, ix: M.index(L.list(l)) };
				ix = libIx.ix;
			}
			var hit = M.inLibrary(ix, f);
			return hit && hit.id && own(l.tracks, hit.id) ? hit : null;
		} catch (e) { return null; }
	}
	// A find for the engine: the find itself, or one made from a library song.
	function toFind(it) {
		if (it.find) return it.find;
		var Src = mod('sources'), f = { key: 'v:' + it.videoId, videoId: it.videoId, title: it.title, artist: it.artist, source: 'library', why: it.why };
		return Src && typeof Src.find === 'function' ? Src.find(f) : f;
	}

	// ---- Words: the role, the version, why it is here, where it came from -------------------

	function roleWord(it) {
		var r = str(it && it.role), s = +(it && it.seq) || 0;
		if (r === 'OP' || r === 'ED') return r + (s > 0 ? s : '');
		if (r === 'insert') return 'Insert';
		if (r === 'theme') return 'Theme';
		if (r === 'OST') return 'Score';
		if (r === 'image') return 'Image song';
		return r;
	}
	var VERSION_NAME = { cover: 'Cover', remix: 'Remix', live: 'Live', acoustic: 'Acoustic', instrumental: 'Instrumental', karaoke: 'Karaoke', piano: 'Piano', orchestral: 'Orchestral', remaster: 'Remaster', demo: 'Demo', extended: 'Extended', edit: 'Edit', 'sped-up': 'Sped up', slowed: 'Slowed', 'tv-size': 'TV size', short: 'Short', acapella: 'A cappella', session: 'Session', language: 'Translated', alt: 'Alternate' };
	function versionWords(v) { return v ? str(v).split('+').map(function (x) { return own(VERSION_NAME, x) ? VERSION_NAME[x] : x; }).join(', ') : ''; }
	function seasonWords(v) {
		if (v && typeof v === 'object') return [str(v.season).toLowerCase(), v.year ? String(v.year) : ''].filter(Boolean).join(' ');
		return str(v).toLowerCase();
	}
	function nameIn(table, v) { return str(own(table, v) ? table[v] : v); }
	// Each reason in words, starting in lower case; the line gets its capital at the end.
	var WHY = {
		work: function (v) { return 'from ' + v; },
		series: function (v) { return 'from the ' + v + ' series'; },
		season: function (v) { var s = seasonWords(v); return s ? 'airing in ' + s : 'airing this season'; },
		artist: function (v) { return v ? 'more by ' + v : 'same artist'; },
		singer: function (v) { return 'also sung by ' + v; },
		similar: function (v) { return v ? 'like ' + q(v) : 'a song like it'; },
		related: function (v) { return v ? 'for fans of ' + v : 'a related artist'; },
		mix: function (v) { return v ? 'in the YouTube Mix of ' + q(v) : 'in a YouTube Mix'; },
		channel: function (v) { return v ? 'uploaded by ' + v : 'from a channel'; },
		playlist: function (v) { return v ? 'from the playlist ' + v : 'from a playlist'; },
		album: function (v) { return v ? 'on ' + v : 'from an album'; },
		top: function (v) { return v ? 'a top song of ' + v : 'a top song'; },
		release: function (v) { return v ? 'new from ' + v : 'a new release'; },
		search: function (v) { return v ? 'found by searching ' + q(v) : 'from a search'; },
		words: function (v) { return v ? 'its words: ' + q(v) : 'found by its words'; },
		familiar: function () { return 'from your library'; },
		together: function (v) { return +v === 1 ? 'played right after it' : +v > 1 ? 'played together ' + v + ' times' : 'played together'; },
		mood: function (v, T) { return 'also ' + nameIn(T && T.MOOD_NAME, v).toLowerCase(); },
		era: function (v) { return 'same era (' + v + 's)'; },
		scene: function (v, T) { return nameIn(T && T.SCENE_NAME, v); },
		lang: function (v, T) { return 'also in ' + nameIn(T && T.LANG_NAME, v); },
		genre: function (v) { return 'also ' + v; },
		radio: function (v) { return v ? 'on the radio from ' + q(v) : 'on the radio'; },
		saved: function () { return 'saved for later'; },
		shared: function () { return 'shared with you'; },
		pasted: function () { return 'from your pasted list'; }
	};
	WHY.franchise = WHY.series;
	WHY.airing = WHY.season;
	WHY.person = WHY.voice = WHY.singer;
	WHY.library = WHY.familiar;
	WHY.lyrics = WHY.words;
	WHY['new'] = WHY.release;
	WHY.tag = WHY.genre;

	// The item's reasons ([[kind, value]]) as one line: at most `max` (2), the first capitalised.
	function whyText(it, max, ctx) {
		if (!it) return '';
		var T = (ctx && ctx.T) || mod('taxonomy'), out = [], seen = {};
		arr(it.why).forEach(function (w) {
			var k = '', v = '';
			if (Array.isArray(w)) { k = str(w[0]); v = w[1]; }
			else if (w && typeof w === 'object') { k = str(w.kind); v = w.value; }
			else v = w;
			// a season comes as { year, season }; other values are words or numbers
			if (v != null && typeof v === 'object') v = v.season || v.year ? seasonWords(v) : '';
			v = str(v);
			var t = str(own(WHY, k) ? WHY[k](v, T) : v).trim();
			if (!t || seen[t.toLowerCase()]) return;
			seen[t.toLowerCase()] = true;
			out.push(t);
		});
		var s = out.slice(0, max > 0 ? max : 2).join(' ' + DOT + ' ');
		return s.charAt(0).toUpperCase() + s.slice(1);
	}

	// Where a found song came from, as a badge: [kind (ds.css), words]. A library song has none.
	var SOURCE = {
		animethemes: ['anime', 'Anime'], anilist: ['season', 'Airing'], ytmix: ['mix', 'Mix'], ytuploads: ['channel', 'Channel'],
		ytplaylist: ['ext', 'Playlist'], ytsearch: ['search', 'Search'], itunes: ['ext', 'iTunes'], deezer: ['ext', 'Deezer'],
		lastfm: ['ext', 'Last.fm'], musicbrainz: ['ext', 'MusicBrainz'], lrclib: ['ext', 'LRCLIB'], vndb: ['ext', 'VNDB'], shared: ['ext', 'Shared'], pasted: ['ext', 'Pasted'], saved: ['ext', 'Saved']
	};
	function sourceBadge(it) {
		if (!it || it.kind === 'track') return null;
		var k = str(it.source).toLowerCase();
		return own(SOURCE, k) ? SOURCE[k].slice() : null;
	}

	// ---- What pressing Play takes -------------------------------------------------------------

	// 0 (the song is known), 1 (a cheap lookup), 100 (a YouTube search), or 'tab' (no key and no
	// sign-in: YouTube's own search opens in a new tab). `est` is the engine's estimate for it.
	function cost(ctx, x, est) {
		var it = item(x, ctx);
		if (!it || it.track || it.videoId || (it.mine && it.sameRecording)) return 0;
		if (est && est.status) {
			if (est.status === 'ready') return 0;
			if (est.status === 'cheap') return 1;
			if (est.status === 'needs-key') return 'tab';
			return 100;
		}
		return canRead(ctx) ? 100 : 'tab';
	}
	function costTitle(c, status) {
		if (status === 'over-budget') return 'Today' + RSQ + 's YouTube allowance for finding songs is used up; it starts again at midnight Pacific time';
		if (c === 'tab') return 'Search YouTube in a new tab (finding songs here needs a sign-in or an API key)';
		if (c === 1 || c === 100) return 'Find it on YouTube and play it here (uses ' + c + ' of today' + RSQ + 's YouTube units)';
		return 'Play it now; what was coming stays after it';
	}
	// The engine's estimates, asked for once for all the rows drawn together.
	var pend = [], flushing = false;
	function estimate(ctx, it, done) {
		var en = engineOf(ctx);
		if (!en || typeof en.estimate !== 'function' || !it.find || it.videoId || it.track) return;
		pend.push({ en: en, f: it.find, done: done });
		if (flushing) return;
		flushing = true;
		Promise.resolve().then(function () {
			var jobs = pend;
			pend = [];
			flushing = false;
			var engines = [];
			jobs.forEach(function (j) { if (engines.indexOf(j.en) < 0) engines.push(j.en); });
			engines.forEach(function (en2) {
				var mine = jobs.filter(function (j) { return j.en === en2; }), seen = {}, finds = [];
				mine.forEach(function (j) { if (!seen[j.f.key]) { seen[j.f.key] = true; finds.push(j.f); } });
				Promise.resolve().then(function () { return en2.estimate(finds); }).then(function (r) {
					mine.forEach(function (j) { j.done(r && r.perFind ? r.perFind[j.f.key] : null); });
				}, function () { /* the guess stays */ });
			});
		});
	}

	// ---- Playing ---------------------------------------------------------------------------------

	// Where an item is in a list: the same object, else the same key.
	function indexIn(list, it) {
		var l = arr(list), i;
		for (i = 0; i < l.length; i++) if (l[i] === it || (isItem(l[i]) && l[i].track && l[i].track === it.track && l[i].find === it.find)) return i;
		for (i = 0; i < l.length; i++) if ((isItem(l[i]) ? l[i].key : (l[i] && (l[i].key || (l[i].id ? 'v:' + l[i].id : '')))) === it.key) return i;
		return -1;
	}
	// mode: 'now' (what was coming stays after it), 'next', 'later', or 'from' (opts.list from here).
	function play(ctx, x, mode, opts) {
		opts = opts || {};
		var it = item(x, ctx);
		if (!it) return Promise.resolve(null);
		mode = mode || 'now';
		if ((mode === 'now' || mode === 'from') && typeof opts.onPlay === 'function') return Promise.resolve(opts.onPlay(it, mode));
		if (mode === 'from' && opts.list) return playFrom(ctx, opts.list, Math.max(0, indexIn(opts.list, it)), opts.context);
		var P = ctx && ctx.play;
		if (!P) return Promise.resolve(null);
		if (it.track) {
			var ids = [it.track.id];
			if (mode === 'next') P.next(ids);
			else if (mode === 'later') P.later(ids);
			else P.now(ids, opts.context || undefined);
			return Promise.resolve({ videoId: it.track.id, rung: 'known', units: 0 });
		}
		if (!it.find || typeof P.find !== 'function') return Promise.resolve(null);
		return Promise.resolve(P.find(it.find, mode === 'from' ? 'now' : mode));
	}
	// A list from one song on: the library's songs through the page's queue; with found songs
	// among them, through the engine's list feeder, which finds each one a few ahead.
	function playFrom(ctx, items, index, context) {
		var its = arr(items).map(function (x) { return item(x, ctx); }).filter(Boolean);
		if (!its.length) return Promise.resolve(null);
		index = Math.max(0, Math.min(its.length - 1, +index || 0));
		context = context || {};
		var P = ctx && ctx.play;
		if (P && its.every(function (x) { return x.kind === 'track'; })) {
			P.from(its.map(function (x) { return x.track.id; }), index, { label: context.label || 'These songs', href: context.href || '#/' });
			return Promise.resolve({ videoId: its[index].track.id });
		}
		var en = engineOf(ctx);
		if (en && typeof en.list === 'function') return Promise.resolve(en.list(its.slice(index).map(toFind), { label: context.label || 'Found songs', href: context.href || '' }));
		return play(ctx, its[index], 'now', { context: context });
	}

	// ---- Drawing: CSS, art, the in-library check ------------------------------------------------

	var CSS = [
		'.ts-m-list { list-style: none; margin: 0; padding: 0; }',
		'.ts-m-row { position: relative; display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 4px 8px; border-radius: 10px; container: ts-m-row / inline-size; }',
		'.ts-m-row:hover, .ts-m-row:focus-within { background: var(--ts-hover); }',
		'.ts-m-row.is-hidden, .ts-m-card.is-hidden { display: none; }',
		'.ts-m-idx { flex: none; width: 24px; text-align: right; font-size: 13px; color: var(--text-2); font-variant-numeric: tabular-nums; }',
		'.ts-m-row .ts-m-art { flex: none; width: 44px; height: 44px; border-radius: 6px; }',
		'.ts-m-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }',
		'.ts-m-title { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 14px; font-weight: 600; line-height: 1.3; color: var(--heading); }',
		'.ts-m-tt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
		'.ts-m-title .ts-tag { margin: 0; flex: none; }',
		'.ts-m-mine { flex: none; display: inline-flex; color: var(--ts-ok); }',
		'.ts-m-mine .ts-i { width: 15px; height: 15px; }',
		'.ts-m-sub, .ts-m-why { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; line-height: 1.35; color: var(--text-2); }',
		'.ts-m-why { font-size: 12px; }',
		'.ts-m-meta { flex: none; display: flex; align-items: center; gap: 10px; }',
		'.ts-m-dur { min-width: 36px; text-align: right; font-size: 12.5px; color: var(--text-2); font-variant-numeric: tabular-nums; }',
		'.ts-m-acts { flex: none; display: flex; align-items: center; gap: 2px; }',
		'.ts-m-acts .ts-m-play { margin-right: 4px; }',
		'.ts-m-play .ts-i { color: var(--ts-play); }',
		'.ts-m-play.is-free { width: var(--btn-h); padding: 0; border-radius: 50%; border-color: transparent; background: transparent; }',
		'.ts-m-play.is-free:hover { background: var(--ts-hover); }',
		'.ts-m-play.is-free .ts-btn-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }',
		'.ts-m-row .ts-m-hover { opacity: 0; transition: opacity var(--dur-fast); }',
		'.ts-m-row:hover .ts-m-hover, .ts-m-row:focus-within .ts-m-hover, .ts-m-row:has([aria-expanded="true"]) .ts-m-hover { opacity: 1; }',
		'.ts-m-row.is-now .ts-m-tt { color: var(--accent); }',
		'.ts-m-row.is-compact { gap: 10px; min-height: 48px; padding: 3px 6px; }',
		'.ts-m-row.is-compact .ts-m-art { width: 40px; height: 40px; }',
		'.ts-m-row.is-compact .ts-m-meta, .ts-m-row.is-compact .ts-m-why { display: none; }',
		'.ts-m-row.is-compact .ts-m-play { padding: 0 9px; margin-right: 2px; }',
		'.ts-m-row.is-compact .ts-m-play .ts-btn-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }',
		'.ts-m-card .ts-m-over { position: absolute; left: 10px; right: 10px; top: 10px; aspect-ratio: 1; pointer-events: none; }',
		'.ts-m-over > * { pointer-events: auto; }',
		'.ts-m-card .ts-m-over .ts-bigplay { top: auto; right: 8px; bottom: 8px; width: 42px; height: 42px; }',
		'.ts-m-card .ts-m-over .ts-bigplay.is-busy { opacity: 1; transform: none; cursor: progress; }',
		'.ts-m-ctags { position: absolute; left: 6px; top: 6px; display: flex; gap: 4px; pointer-events: none; }',
		'.ts-m-ctags .ts-badge { background-color: var(--surface); background-image: linear-gradient(color-mix(in srgb, var(--role) 14%, transparent), color-mix(in srgb, var(--role) 14%, transparent)); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3); }',
		'.ts-m-ctags .ts-badge--cost { background-image: linear-gradient(var(--ts-cost-bg), var(--ts-cost-bg)); }',
		'.ts-m-card .ts-m-cmore { position: absolute; top: 4px; right: 4px; opacity: 0; background: rgba(0, 0, 0, 0.45); color: #fff; }',
		'.ts-m-card .ts-m-cmore:hover:not(:disabled) { background: rgba(0, 0, 0, 0.65); color: #fff; }',
		'.ts-m-card:hover .ts-m-cmore, .ts-m-card:focus-within .ts-m-cmore { opacity: 1; }',
		'.ts-m-card .ts-card-sub { -webkit-line-clamp: 2; }',
		// a narrow row (the now-playing panel, a phone): no badge, length or Preview; Play keeps its icon and cost
		'@container ts-m-row (max-width: 560px) {',
		'  .ts-m-meta, .ts-m-pv, .ts-m-idx { display: none; }',
		'  .ts-m-acts .ts-m-play { padding: 0 9px; margin-right: 2px; }',
		'  .ts-m-play .ts-btn-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }',
		'}',
		'@media (hover: none), (pointer: coarse) {',
		'  .ts-m-row .ts-m-hover, .ts-m-card .ts-m-cmore { opacity: 1; }',
		'  .ts-m-card .ts-m-over .ts-bigplay { opacity: 1; transform: none; }',
		'  .ts-m-row, .ts-m-card { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }',
		'}',
		'@media (max-width: 760px) {',
		'  .ts-m-row { gap: 10px; padding: 4px; }',
		'  .ts-m-meta, .ts-m-pv, .ts-m-idx { display: none; }',
		'  .ts-m-row .ts-m-hover { opacity: 1; }',
		'  .ts-m-row .ts-m-play { padding: 0 9px; margin-right: 2px; }',
		'  .ts-m-row .ts-m-play .ts-btn-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }',
		'  .ts-m-card .ts-m-over .ts-bigplay { display: flex; width: 38px; height: 38px; opacity: 1; transform: none; }',
		'  .ts-m-card .ts-m-cmore { opacity: 1; }',
		'}'
	].join('\n');
	function css() {
		var doc = root.document;
		if (!doc || !doc.getElementById || doc.getElementById('ts-media-css')) return;
		var st = doc.createElement('style');
		st.id = 'ts-media-css';
		st.textContent = CSS;
		(doc.head || doc.documentElement).appendChild(st);
	}

	// The art: a library song's (the page's own rule), a found song's cover, its video's
	// thumbnail, else a square of colour with an initial.
	function artOf(ctx, it, cls) {
		var U = ctx.U, h = ctx.h;
		if (it.track && !it.track.transient && typeof ctx.art === 'function') return ctx.art(it.track, cls);
		var hue = it.track && typeof ctx.hue === 'function' ? ctx.hue(it.track) : { h: hueOf(it.artist || it.title), s: 45 };
		var on = artOn(ctx);
		if (on && it.cover) {
			var wrap = h('span', { class: 'ts-art ' + cls, aria: { hidden: 'true' }, style: { '--h': String(Math.round(hue.h)), '--s': hue.s + '%' } });
			var img = h('img', { alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', src: it.cover });
			img.addEventListener('error', function () {
				if (img.parentNode) img.parentNode.removeChild(img);
				wrap.classList.add('ts-art-gen');
				wrap.appendChild(h('span', { class: 'ts-art-letter', text: U.initialOf ? U.initialOf(it.title || it.artist) : str(it.title || '?').charAt(0) }));
			});
			wrap.appendChild(img);
			return wrap;
		}
		if (U.art) return U.art(it.videoId, hue.h, it.title || it.artist, cls, on && YT_ID.test(str(it.videoId)), hue.s);
		return U.swatch(hue.h, it.title || it.artist, cls, hue.s);
	}
	function mineMark(ctx) {
		var s = ctx.h('span', { class: 'ts-m-mine', title: 'In your library', role: 'img', aria: { label: 'In your library' } });
		s.appendChild(ctx.icon ? ctx.icon('check-circle') : ctx.U.icon('check-circle'));
		return s;
	}
	function badgeOf(ctx, it, opts) {
		if (opts.badge === false) return null;
		var b = typeof opts.badge === 'function' ? opts.badge(it) : Array.isArray(opts.badge) ? opts.badge : sourceBadge(it);
		return b && b[0] ? ctx.U.badge(b[0], str(b[1] || b[0]), 'ts-m-src') : null;
	}
	function textOpt(v, it, fallback) { return typeof v === 'function' ? str(v(it)) : v != null && v !== true ? str(v) : fallback; }
	var uid = 0;

	// ---- A long press (touch) or a right click opens the menu where it happened ---------------------

	function pressMenu(el, open) {
		var timer = 0, x0 = 0, y0 = 0, fired = 0;
		function cancel() { if (timer) { clearTimeout(timer); timer = 0; } }
		function fire(at) { var t = Date.now(); if (t - fired < AGAIN_MS) return; fired = t; open(at); }
		el.addEventListener('pointerdown', function (e) {
			if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
			cancel();
			x0 = e.clientX;
			y0 = e.clientY;
			timer = setTimeout(function () { timer = 0; fire({ x: x0, y: y0 }); }, LONG_MS);
		});
		el.addEventListener('pointermove', function (e) { if (timer && (Math.abs(e.clientX - x0) > MOVE_PX || Math.abs(e.clientY - y0) > MOVE_PX)) cancel(); });
		['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { el.addEventListener(n, cancel); });
		// the finger that ends a long press does not also press the button under it
		el.addEventListener('click', function (e) { if (Date.now() - fired < AGAIN_MS) { e.preventDefault(); e.stopPropagation(); } }, true);
		el.addEventListener('contextmenu', function (e) {
			e.preventDefault();
			cancel();
			fire(e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : null);
		});
		return { open: fire };
	}

	// ---- The row -------------------------------------------------------------------------------------

	function row(ctx, x, opts) {
		opts = opts || {};
		css();
		var it = item(x, ctx);
		var h = ctx.h, U = ctx.U, compact = !!opts.compact;
		if (!it) return h('li', { class: 'ts-m-row is-hidden' });
		var cur = null;
		try { cur = typeof ctx.current === 'function' ? ctx.current() : null; } catch (e) { cur = null; }
		var li = h('li', { class: 'ts-m-row' + (compact ? ' is-compact' : '') + (it.mine ? ' is-mine' : '') + (it.kind !== 'track' ? ' is-found' : '') + (cur && it.videoId && cur.id === it.videoId ? ' is-now' : ''), data: { key: it.key, id: it.videoId || null } });
		if (opts.index != null && opts.index !== '' && !compact) li.appendChild(h('span', { class: 'ts-m-idx', aria: { hidden: 'true' }, text: String(opts.index) }));
		li.appendChild(artOf(ctx, it, 'ts-m-art'));

		// title, tags and the check; the artist (and album or work); why it is here
		var tid = 'ts-m-t' + (++uid);
		var title = it.title || (it.videoId && it.kind === 'find' ? 'Loading the title' + ELL : 'Untitled');
		var tl = h('span', { class: 'ts-m-title' }, [h('span', { class: 'ts-m-tt', id: tid, text: title })]);
		var rw = roleWord(it), vw = versionWords(it.version);
		if (rw) tl.appendChild(h('span', { class: 'ts-tag', text: rw }));
		if (vw) tl.appendChild(h('span', { class: 'ts-tag', text: vw }));
		if (it.mine) tl.appendChild(mineMark(ctx));
		var text = h('span', { class: 'ts-m-text' }, [tl]);
		var why = opts.why === false ? '' : textOpt(opts.why, it, whyText(it, 2, ctx));
		var sub = h('span', { class: 'ts-m-sub' });
		if (opts.sub != null) { var st0 = textOpt(opts.sub, it, ''); if (st0) sub.appendChild(h('span', { text: st0 })); }
		else {
			if (it.artist) sub.appendChild(h('span', { class: it.guess ? 'ts-guess' : null, title: it.guess ? 'A guess from the title' : null, text: it.artist }));
			// the album or the work; in the panel the reason says more
			var more = compact && why ? '' : it.album || it.work;
			if (more) sub.appendChild(h('span', { text: (it.artist ? ' ' + DOT + ' ' : '') + more }));
		}
		if (compact && why) sub.appendChild(h('span', { text: (sub.firstChild ? ' ' + DOT + ' ' : '') + why }));
		if (sub.firstChild) text.appendChild(sub);
		if (!compact && why) text.appendChild(h('span', { class: 'ts-m-why', text: why }));
		li.appendChild(text);

		// the source badge and the length
		if (!compact) {
			var meta = h('span', { class: 'ts-m-meta' }), bd = badgeOf(ctx, it, opts);
			if (bd) meta.appendChild(bd);
			if (it.durationSec > 0) meta.appendChild(h('span', { class: 'ts-m-dur', text: clock(ctx, it.durationSec) }));
			if (meta.firstChild) li.appendChild(meta);
		}

		// Preview (wide rows), Play with its cost, Play next, More
		var acts = h('span', { class: 'ts-m-acts' });
		var name = it.title || 'this song';
		if (!compact && opts.preview !== false && it.preview && typeof ctx.preview === 'function') {
			var pv = U.btn({ icon: 'headphones', label: 'Preview ' + name, iconOnly: true, size: 'sm', cls: 'ts-m-pv ts-m-hover' });
			pv.addEventListener('click', function () { ctx.preview(it, pv); });
			acts.appendChild(pv);
		}
		var c = cost(ctx, it), status = '';
		// A song that plays at once has a quiet round Play; one that needs finding says so (its cost),
		// and one that can only open YouTube says that. A list of rows then reads as songs, not buttons.
		var pb = U.btn({ icon: c === 'tab' ? 'external' : 'play', label: c === 'tab' ? 'YouTube' : 'Play', variant: 'secondary', size: 'sm', cls: 'ts-m-play' + (c === 0 ? ' is-free' : ''), cost: c === 1 || c === 100 ? c : null, title: costTitle(c), aria: { describedby: tid, label: (c === 'tab' ? 'Find ' : 'Play ') + name + (c === 'tab' ? ' on YouTube' : '') } });
		function setCost(n, st) {
			c = n;
			status = st || '';
			U.btnState(pb, { icon: c === 'tab' ? 'external' : 'play', label: c === 'tab' ? 'YouTube' : 'Play', cost: c === 1 || c === 100 ? c : null });
			pb.classList.toggle('is-free', c === 0);
			pb.setAttribute('aria-label', (c === 'tab' ? 'Find ' : 'Play ') + name + (c === 'tab' ? ' on YouTube' : ''));
			pb.title = costTitle(c, status);
		}
		pb.addEventListener('click', function () {
			U.btnState(pb, { busy: true });
			play(ctx, it, 'now', opts).then(function (r) {
				U.btnState(pb, { busy: false });
				if (r && r.videoId && c !== 0) setCost(0);
			}, function () { U.btnState(pb, { busy: false }); });
		});
		acts.appendChild(pb);
		if (c !== 0) estimate(ctx, it, function (e) { if (e && e.status) setCost(cost(ctx, it, e), e.status); });
		var nx = U.btn({ icon: 'queue-next', label: 'Play ' + name + ' next', iconOnly: true, size: 'sm', cls: 'ts-m-next ts-m-hover' });
		nx.addEventListener('click', function () { play(ctx, it, 'next', opts); });
		acts.appendChild(nx);
		var menuOpts = assign({}, opts, { row: li, cost: function () { return c; } });
		var mo = U.btn({ icon: 'more', label: 'More for ' + name, iconOnly: true, size: 'sm', menu: true, cls: 'ts-m-more ts-m-hover' });
		mo.addEventListener('click', function () { openRowMenu(mo); });
		acts.appendChild(mo);
		li.appendChild(acts);

		function openRowMenu(at) { menu(ctx, it, at || mo, menuOpts); }
		var press = pressMenu(li, function (at) { openRowMenu(at); });
		// the menu key or Shift+F10 on any of the row's buttons: the menu, under More
		li.addEventListener('keydown', function (e) {
			if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); press.open(null); }
		});
		// a double click plays it, as in the library's own lists (the cost is on the Play beside it)
		li.addEventListener('dblclick', function (e) {
			var t = e.target;
			if (t && t.closest && t.closest('button, a')) return;
			pb.click();
		});
		return li;
	}

	// Rows in an <ol>: the arrow keys move between rows, to the same button.
	function list(ctx, items, opts) {
		opts = opts || {};
		css();
		var its = arr(items).map(function (x) { return item(x, ctx); }).filter(Boolean);
		var ol = ctx.h('ol', { class: 'ts-m-list' + (opts.compact ? ' is-compact' : ''), aria: { label: opts.label || null } });
		var all = opts.list ? arr(opts.list).map(function (x) { return item(x, ctx); }).filter(Boolean) : its;
		var from = +opts.from || 0;
		its.forEach(function (it, i) {
			ol.appendChild(row(ctx, it, assign({}, opts, { list: all, index: opts.numbered ? from + i + 1 : opts.index })));
		});
		ol.addEventListener('keydown', function (e) {
			if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
			var b = e.target && e.target.closest ? e.target.closest('button') : null, r = b && b.closest('.ts-m-row');
			if (!r || r.parentNode !== ol) return;
			var sib = r;
			do { sib = e.key === 'ArrowDown' ? sib.nextElementSibling : sib.previousElementSibling; } while (sib && sib.classList.contains('is-hidden'));
			if (!sib) return;
			e.preventDefault();
			var kind = ['ts-m-pv', 'ts-m-play', 'ts-m-next', 'ts-m-more'].filter(function (k) { return b.classList.contains(k); })[0] || 'ts-m-play';
			var to = sib.querySelector('.' + kind) || sib.querySelector('.ts-m-play');
			if (to) to.focus();
		});
		return ol;
	}

	// ---- The card ------------------------------------------------------------------------------------

	function exploreHref(it) {
		if (it.mine) return '#/explore/' + encodeURIComponent(it.mine);
		return '#/explore/find/' + encodeURIComponent(it.key);
	}
	// A found song has no page of its own: Explore knows it once it is remembered (explore.js), on the way there.
	function rememberFor(it) { var X = root.TrueShuffle && root.TrueShuffle.explore; if (X && X.remember && !it.mine && (it.find || it.key)) X.remember(it.find || it); }
	// A card: the art with Play over it (and its cost), the title, a line; the card opens Explore.
	function card(ctx, x, opts) {
		opts = opts || {};
		css();
		var it = item(x, ctx), h = ctx.h, U = ctx.U;
		if (!it) return h('div', { class: 'ts-card ts-m-card is-hidden' });
		var href = typeof opts.href === 'function' ? opts.href(it) : opts.href || exploreHref(it);
		var c0 = h('div', { class: 'ts-card ts-m-card' + (it.mine ? ' is-mine' : ''), data: { key: it.key, id: it.videoId || null } });
		var a = h('a', { class: 'ts-card-a', href: href, on: { click: function () { if (!opts.href) rememberFor(it); } } });
		a.appendChild(artOf(ctx, it, 'ts-m-cart'));
		a.appendChild(h('span', { class: 'ts-card-title', text: it.title || 'Untitled' }));
		var why = opts.why === false ? '' : textOpt(opts.why, it, whyText(it, 1, ctx));
		var sub = opts.sub != null ? textOpt(opts.sub, it, '') : [it.artist, why].filter(Boolean).join(' ' + DOT + ' ');
		if (sub) a.appendChild(h('span', { class: 'ts-card-sub', text: sub }));
		c0.appendChild(a);
		var over = h('div', { class: 'ts-m-over' }), tags = h('span', { class: 'ts-m-ctags' });
		var name = it.title || 'this song', c = cost(ctx, it);
		var big = h('button', { class: 'ts-bigplay ts-m-bigplay', type: 'button' }, [ctx.icon ? ctx.icon('play') : U.icon('play')]);
		var costTag = null;
		function setCost(n, st) {
			c = n;
			var label = (c === 'tab' ? 'Search YouTube for ' : 'Play ') + name + (c === 1 || c === 100 ? ', uses ' + c + ' YouTube units' : '');
			big.setAttribute('aria-label', label);
			big.title = costTitle(c, st);
			if (U.setIcon) U.setIcon(big, c === 'tab' ? 'external' : 'play');
			if (costTag && costTag.parentNode) costTag.parentNode.removeChild(costTag);
			costTag = c === 1 || c === 100 ? U.badge('cost', String(c)) : null;
			if (costTag) tags.insertBefore(costTag, tags.firstChild);
		}
		setCost(c);
		if (it.mine) tags.appendChild(U.badge('ok', 'Yours'));
		big.addEventListener('click', function (e) {
			e.preventDefault();
			big.classList.add('is-busy');
			big.setAttribute('aria-busy', 'true');
			play(ctx, it, 'now', opts).then(function (r) {
				big.classList.remove('is-busy');
				big.setAttribute('aria-busy', 'false');
				if (r && r.videoId && c !== 0) setCost(0);
			}, function () { big.classList.remove('is-busy'); big.setAttribute('aria-busy', 'false'); });
		});
		if (c !== 0) estimate(ctx, it, function (e) { if (e && e.status) setCost(cost(ctx, it, e), e.status); });
		var more = U.btn({ icon: 'more', label: 'More for ' + name, iconOnly: true, size: 'sm', variant: 'icon', menu: true, cls: 'ts-m-cmore' });
		var menuOpts = assign({}, opts, { row: c0, cost: function () { return c; } });
		more.addEventListener('click', function (e) { e.preventDefault(); menu(ctx, it, more, menuOpts); });
		over.appendChild(tags);
		over.appendChild(more);
		over.appendChild(big);
		c0.appendChild(over);
		var press = pressMenu(c0, function (at) { menu(ctx, it, at || more, menuOpts); });
		c0.addEventListener('keydown', function (e) {
			if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); press.open(null); }
		});
		return c0;
	}

	// ---- The menu --------------------------------------------------------------------------------------

	// The library artist a name belongs to, for Go to artist.
	function artistKeyOf(ctx, it) {
		if (it.track && it.track.artistKey) return it.track.artistKey;
		if (!it.artist || it.guess || !ctx || !ctx.L || typeof ctx.L.normArtist !== 'function' || typeof ctx.idx !== 'function') return '';
		try { var k = ctx.L.normArtist(it.artist), ix = ctx.idx(); return k && ix && ix.artists && ix.artists[k] ? k : ''; } catch (e) { return ''; }
	}
	// A "Go to" item: an address, or the page's own function (opts.go). Actions the
	// vocabulary does not have yet (an album, Explore) keep its style with an icon of their own.
	function goItem(A, name, icon, how, label, ctx, it) {
		if (!how) return null;
		var run = typeof how === 'function' ? function () { how(it); } : function () { nav(ctx, str(how)); };
		return own(A.VOCAB, name) ? A.item(name, run, { label: label }) : { label: label, icon: icon, onSelect: run };
	}
	function menu(ctx, x, at, opts) {
		opts = opts || {};
		var it = item(x, ctx), A = ctx && ctx.A, U = ctx && ctx.U;
		if (!it || !A || !U) return null;
		// a song the library does not have can be saved for later or hidden
		var en = engineOf(ctx), f = it.kind === 'light' || (it.kind === 'find' && !it.mine) ? toFind(it) : null, name = it.title || 'This song';
		var c = typeof opts.cost === 'function' ? opts.cost() : cost(ctx, it);
		var hint = c === 100 ? '100 units' : c === 1 ? '1 unit' : undefined;
		var rowEl = opts.row || (at && at.closest ? at.closest('.ts-m-row, .ts-m-card') : null);
		var items = [{ heading: name }];
		items.push(A.item('play', function () { play(ctx, it, 'now', opts); }, { hint: hint }));
		var pos = opts.list ? indexIn(opts.list, it) : -1;
		if (pos >= 0 && pos < arr(opts.list).length - 1) items.push(A.item('play-from-here', function () { playFrom(ctx, opts.list, pos, opts.context); }));
		items.push(A.item('play-next', function () { play(ctx, it, 'next', opts); }, { hint: hint }));
		items.push(A.item('add-to-queue', function () { play(ctx, it, 'later', opts); }, { hint: hint }));

		// keep or let go
		var keep = [];
		if (it.preview && typeof ctx.preview === 'function') keep.push(A.item('preview', function () { ctx.preview(it, at && at.nodeType ? at : null); }));
		if (f && en && typeof en.isSaved === 'function' && typeof en.save === 'function') {
			var saved = en.isSaved(f.key);
			keep.push(A.item(saved ? 'unsave' : 'save', function () {
				if (saved) en.unsave(f.key); else en.save(f);
				U.toast(saved ? 'Removed from Saved for later.' : 'Saved for later: ' + name + '.', { action: 'Undo', onAction: function () { if (saved) en.save(f); else en.unsave(f.key); } });
			}));
		}
		if (f && en && typeof en.hide === 'function') {
			keep.push(A.item('not-interested', function () { hide('song', f.key); }));
			if (it.artist && !it.guess) keep.push(A.item('not-interested', function () { hide('artist', it.artist); }, { label: 'Not interested in ' + it.artist }));
		}
		if (keep.length) items = items.concat([{ heading: 'Keep' }], keep);
		function hide(kind, value) {
			var undo = en.hide(kind, value);
			var next = null, s;
			if (rowEl) {
				// the focus moves to the row after it (or before it) as the row goes
				for (s = rowEl.nextElementSibling; s && !next; s = s.nextElementSibling) if (!s.classList.contains('is-hidden')) next = s;
				for (s = rowEl.previousElementSibling; s && !next; s = s.previousElementSibling) if (!s.classList.contains('is-hidden')) next = s;
				rowEl.classList.add('is-hidden');
			}
			var focus = next && next.querySelector ? next.querySelector('.ts-m-play, .ts-card-a') : null;
			if (focus) focus.focus();
			if (typeof opts.onHide === 'function') opts.onHide(it, kind, undo);
			U.toast(kind === 'artist' ? value + ' will not be suggested again.' : 'Not interested: ' + name + '.', { action: 'Undo', onAction: function () { undo(); if (rowEl) rowEl.classList.remove('is-hidden'); } });
		}

		// go to
		var go = opts.go || {}, gos = [];
		var ak = artistKeyOf(ctx, it);
		gos.push(goItem(A, 'go-artist', 'artist', go.artist || (ak ? '#/artist/' + encodeURIComponent(ak) : null), 'Go to ' + (it.artist || 'the artist'), ctx, it));
		gos.push(goItem(A, 'go-work', 'tv', go.work || (it.work ? '#/work/' + encodeURIComponent(it.work) : null), 'Go to ' + (it.work || 'the work'), ctx, it));
		gos.push(goItem(A, 'go-album', 'album', go.album || null, 'Go to ' + (it.album || 'the album'), ctx, it));
		gos.push(goItem(A, 'go-channel', 'channel', go.channel || (it.channelId && !ctx.demo ? '#/channel/' + encodeURIComponent(it.channelId) : null), 'Go to ' + (it.channel || 'the channel'), ctx, it));
		gos.push(goItem(A, 'explore', 'compass', go.explore || function () { rememberFor(it); nav(ctx, exploreHref(it)); }, 'Explore', ctx, it));
		if (it.mine && it.kind === 'track') gos.push(A.item('details', function () { nav(ctx, '#/track/' + encodeURIComponent(it.mine)); }));
		if (it.videoId && YT_ID.test(it.videoId) && !ctx.demo) gos.push(A.item('open-youtube', function () { if (root.open) root.open('https://www.youtube.com/watch?v=' + encodeURIComponent(it.videoId), '_blank', 'noopener'); }));
		gos = gos.filter(Boolean);
		items = items.concat([{ heading: 'Go to' }], gos);
		if (typeof opts.menuItems === 'function') { var extra = arr(opts.menuItems(it)).filter(Boolean); if (extra.length) items = items.concat([{ sep: true }], extra); }
		return U.openMenu(at || { x: 40, y: 40 }, items, { label: 'Actions for ' + name, returnTo: at && at.nodeType ? at : null });
	}

	return {
		item: item, row: row, list: list, card: card, menu: menu,
		play: play, playFrom: playFrom, whyText: whyText, sourceBadge: sourceBadge, cost: cost
	};
});
