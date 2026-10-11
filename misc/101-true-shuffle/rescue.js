/*
 * True Shuffle: songs gone from YouTube, brought back (rescue.js). An upload
 * that was deleted, made private or kept off other sites still carries the
 * listener's ratings, plays, labels and history on its dead video id. This
 * finds another upload of the same song and moves all of it there.
 *
 *     R.unplayable(tracks) -> the songs that cannot play, the most loved first
 *     R.candidates(track, list) -> the uploads that may be the same song, best first
 *     R.swap(lib, oldId, video, { now }) -> what changed, and the record that undoes it
 *     R.unswap(lib, record) -> what changed back
 *     R.view(view, ctx, parts)          #/rescue and #/rescue/<id>
 *
 * Nothing changes on YouTube. The old id stays in lib.moved (library.js), so an
 * import that lists it again does not bring it back; the old track itself is
 * kept in the store (kv rescue:moved:<old id>) until it is put back. Listens
 * stay in the history as they were and are read through lib.moved.
 *
 * UMD: window.TrueShuffle.rescue in the browser, module.exports in Node. The
 * pure part needs library.js, match.js and parse.js; the page part only ctx.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(root, function (name) { return node ? require('./' + name + '.js') : (root.TrueShuffle || {})[name]; });
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.rescue = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root, need) {
	'use strict';

	var KEY = 'rescue:moved:';
	// What moves from the old upload to the new one: the listener's own state, and where the song lives.
	var STATE = ['rating', 'plays', 'skips', 'lastPlayed', 'blocked', 'tags', 'userEdits', 'labels', 'stateAt'];
	var PLACES = ['playlists', 'addedAt'];
	var YT_ID = /^[A-Za-z0-9_-]{11}$/;
	var DOT = String.fromCharCode(0xB7), ELL = String.fromCharCode(0x2026), RSQ = String.fromCharCode(0x2019);
	var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

	function str(v) { return v == null ? '' : String(v); }
	function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
	function iso(ms) { return new Date(ms == null ? Date.now() : ms).toISOString(); }
	function later(a, b) { return !a ? (b || null) : !b ? a : (a > b ? a : b); }
	function union(a, b) { var out = (a || []).slice(); (b || []).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); }); return out; }
	function titleOf(t) { return str(t && (t.title || (t.raw && t.raw.title))) || 'Untitled'; }
	function clock(sec) { sec = Math.max(0, Math.round(+sec || 0)); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
	function plural(k, one) { return k + ' ' + (k === 1 ? one : one + 's'); }
	function same(a, b) { return JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b); }

	// ---- Which songs ------------------------------------------------------------------------

	// Why a track cannot play: '' when it can, else 'gone' (YouTube no longer returns it),
	// 'private' (the player said removed or private), 'blocked' (its owner keeps it off
	// other sites, or a region does) or 'error' (the player refused it otherwise).
	function reason(t) {
		if (!t || need('library').playable(t)) return '';
		if (t.removed) return t.removedReason === 'gone' ? 'gone' : 'private';
		if (t.embeddable === false) return 'blocked';
		return 'error';
	}
	var REASON_TEXT = { gone: 'gone from YouTube', 'private': 'removed or made private', blocked: 'not allowed on other sites', error: 'the player refused it' };
	function reasonText(t) {
		var r = reason(t);
		return r === 'error' && t.playerError && t.playerError.code ? REASON_TEXT.error + ' (error ' + t.playerError.code + ')' : REASON_TEXT[r] || '';
	}
	// The songs that cannot play, the most loved first (rating, then plays).
	function unplayable(tracks) {
		var list = Array.isArray(tracks) ? tracks : Object.keys(tracks || {}).map(function (k) { return tracks[k]; });
		return list.filter(function (t) { return !!reason(t); }).sort(function (a, b) {
			return (b.rating || 0) - (a.rating || 0) || (b.plays || 0) - (a.plays || 0) || (titleOf(a).toLowerCase() < titleOf(b).toLowerCase() ? -1 : titleOf(a).toLowerCase() > titleOf(b).toLowerCase() ? 1 : a.id < b.id ? -1 : 1);
		});
	}

	// ---- Candidates -------------------------------------------------------------------------

	// The song as match.js reads it, without its video (so its own upload is no evidence).
	function songOf(t) {
		return { key: 'rescue:' + t.id, title: titleOf(t), titleAlt: str(t.titleAlt), artist: str(t.artist), artistNative: str(t.artistNative), version: str(t.version), durationSec: +t.durationSec || 0, work: str(t.work), role: str(t.role), raw: t.raw };
	}
	// What to type into a YouTube search: the artist (or the parser's guess) and the base title.
	function queryOf(t) {
		return need('match').query({ title: titleOf(t), titleAlt: str(t.titleAlt), artist: str(t.artist) || str(t.guess && t.guess.artist) });
	}
	// An upload read as a song: parse.js's title and version, its artist only when something vouches for it.
	function uploadSong(v) {
		var p = need('parse').parse(str(v.title), str(v.channel));
		return { title: p.title || str(v.title), artist: p.confidence >= 0.6 ? p.artist : '', version: p.version || '', durationSec: +v.durationSec || 0, raw: { title: str(v.title), channel: str(v.channel) } };
	}
	function trackVideo(t) { return { videoId: t.id, title: str(t.raw && t.raw.title) || titleOf(t), channel: str(t.channel), channelId: str(t.channelId), durationSec: +t.durationSec || 0 }; }

	// Other copies in the library that play: the tracks sharing a title or an artist key
	// with the song (ix: match.js index). -> [{ video, source: 'library', track }]
	function copiesOf(ix, t) {
		var M = need('match'), L = need('library'), sig = M.signature(songOf(t)), seen = {}, out = [];
		function take(map, keys) {
			keys.forEach(function (k) {
				if (!map || !Object.prototype.hasOwnProperty.call(map, k)) return;
				map[k].forEach(function (id) {
					var x = ix.tracks[id];
					if (seen[id] || !x || id === t.id || !L.playable(x)) return;
					seen[id] = true;
					out.push({ video: trackVideo(x), source: 'library', track: x });
				});
			});
		}
		if (ix) { take(ix.title, sig.t); take(ix.artist, sig.a); }
		return out;
	}

	// The videos YouTube showed before, from the sources cache (searches, lists, Mixes, video
	// details, oEmbed answers): rows are cache.range() rows. Videos known to be unplayable
	// are left out. -> [{ videoId, title, channel, channelId, durationSec }]
	function poolOf(rows) {
		var by = {}, bad = {}, order = [];
		function add(v) {
			var id = v && str(v.videoId || v.id);
			if (!YT_ID.test(id) || !v.title) return;
			if (v.embeddable === false) bad[id] = true;
			var x = by[id];
			if (!x) { x = by[id] = { videoId: id, title: str(v.title), channel: '', channelId: '', durationSec: 0 }; order.push(id); }
			if (!x.channel && v.channel) x.channel = str(v.channel);
			if (!x.channelId && v.channelId) x.channelId = str(v.channelId);
			if (!x.durationSec && +v.durationSec > 0) x.durationSec = +v.durationSec;
		}
		(rows || []).forEach(function (r) {
			var k = str(r && r.key), val = r && r.value;
			if (!val) return;
			if (k.indexOf('oe:') === 0) { if (val.ok === false) bad[val.id] = true; else add({ videoId: val.id, title: val.title, channel: val.channel, channelId: val.channelId }); }
			else if (k.indexOf('yt:v:') === 0) add(val);
			else if (Array.isArray(val)) val.forEach(add);
			else if (Array.isArray(val.items)) val.items.forEach(add);
		});
		return order.filter(function (id) { return !bad[id]; }).map(function (id) { return by[id]; });
	}
	// The pool by title key, once: { keys: { key: [videos] }, list }.
	function poolIndex(videos) {
		var M = need('match'), keys = {};
		(videos || []).forEach(function (v) {
			M.titleKeys(v.title, '', { title: v.title, channel: v.channel }).forEach(function (k) { (keys[k] = keys[k] || []).push(v); });
		});
		return { keys: keys, list: (videos || []).slice() };
	}
	// The pool's uploads whose title shares a key with the song's (or holds a long one).
	function fromPool(pix, t) {
		if (!pix) return [];
		var sig = need('match').signature(songOf(t)), seen = {}, out = [], all = Object.keys(pix.keys);
		sig.t.forEach(function (k) {
			all.forEach(function (pk) {
				if (pk !== k && !(k.length >= 6 && pk.indexOf(k) >= 0)) return;
				pix.keys[pk].forEach(function (v) { if (!seen[v.videoId] && v.videoId !== t.id) { seen[v.videoId] = true; out.push({ video: v, source: 'pool' }); } });
			});
		});
		return out;
	}
	// Invented uploads for the demo: the artist's Topic upload (a sure match), a lyrics
	// video, a cover, with ids of eleven characters as YouTube's (channel.js does the same).
	// Nothing is asked of any service.
	function hash36(s) {
		var x = 0x811c9dc5;
		for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
		return ('00000000' + x.toString(36)).slice(-8);
	}
	function demoUploads(t) {
		var title = titleOf(t) + (t.version && t.versionText ? ' (' + t.versionText + ')' : ''), artist = str(t.artist), d = +t.durationSec || 0;
		var base = hash36('rescue:' + t.id), slug = artist.toLowerCase().replace(/[^a-z0-9]+/g, '-');
		var out = [];
		if (artist) out.push({ videoId: 'dra' + base, title: title, channel: artist + ' - Topic', channelId: 'demo-ch-' + slug + '-topic', durationSec: d ? d + 1 : 0 });
		out.push({ videoId: 'drb' + base, title: (artist ? artist + ' - ' : '') + titleOf(t) + ' (Lyrics)', channel: 'lyric lantern', channelId: 'demo-ch-lyric-lantern', durationSec: d ? d + 3 : 0 });
		out.push({ videoId: 'drc' + base, title: titleOf(t) + ' (Cover)', channel: 'Moth Choir', channelId: 'demo-ch-moth-choir', durationSec: d ? d + 17 : 0 });
		return out;
	}

	var SOURCE_RANK = { library: 0, topic: 1, demo: 1, search: 2, paste: 3, pool: 4 };
	// The uploads that may be the same song, best first. list: [{ video, source, track
	// (a library copy), keep (show it even when unlikely: a search or a pasted link) }].
	// Each is judged twice by match.js: sameSong (is it the song: title, artist, version,
	// length) and, for an upload, scoreVideo (is it a good upload of it: the artist's
	// Topic channel, no cover or lyrics words). sure: the same recording at STRONG or
	// more (and a fair upload), the only kind the page chooses by itself.
	// -> [{ video, source, track, same, sure, score, fit, why: [codes], gap (s, or null) }]
	function candidates(t, list) {
		var M = need('match'), song = songOf(t), seen = {}, out = [];
		(list || []).slice().sort(function (a, b) { return (SOURCE_RANK[a.source] || 9) - (SOURCE_RANK[b.source] || 9); }).forEach(function (c) {
			var v = c && c.video, id = v && str(v.videoId);
			if (!id || id === t.id || seen[id]) return;
			var s = M.sameSong(song, c.track || uploadSong(v)), fit = c.track ? null : M.scoreVideo(v, song);
			if (!s.same && !(fit && fit.score >= M.MIN_VIDEO) && !c.keep) return;
			seen[id] = true;
			var why = s.why.slice();
			(fit ? fit.why : []).forEach(function (w) { if (why.indexOf(w) < 0) why.push(w); });
			var gap = +v.durationSec > 0 && +t.durationSec > 0 ? +v.durationSec - +t.durationSec : null;
			out.push({ video: v, source: c.source, track: c.track || null, record: c.record || null, same: s.same, sure: s.sameRecording && s.score >= M.STRONG && (!fit || fit.score >= M.MIN_VIDEO), score: s.score, fit: fit ? fit.score : null, why: why, gap: gap });
		});
		return out.sort(function (a, b) {
			return (b.sure ? 1 : 0) - (a.sure ? 1 : 0) || (b.same ? 1 : 0) - (a.same ? 1 : 0) || (a.track ? 0 : 1) - (b.track ? 0 : 1) ||
				(b.fit == null ? 10 : b.fit) - (a.fit == null ? 10 : a.fit) || (a.gap == null ? 999 : Math.abs(a.gap)) - (b.gap == null ? 999 : Math.abs(b.gap)) ||
				b.score - a.score || (a.video.videoId < b.video.videoId ? -1 : 1);
		});
	}

	// match.js's reasons in words: { good, bad }.
	var WHY = {
		video: 'the same video', title: 'same title', 'title-loose': 'same title, spelt another way', 'title-part': 'a similar title',
		artist: 'same artist', person: 'a singer in common', work: 'same anime or work', role: 'same role', length: 'same length',
		topic: 'the artist' + RSQ + 's Topic channel', channel: 'the artist' + RSQ + 's channel', official: 'an official channel', version: 'the version asked for',
		'no-title': 'another title', 'other-artist': 'another artist', 'other-version': 'another version', 'length-off': 'another length', 'not-version': 'not the version asked for',
		cover: 'a cover', karaoke: 'karaoke', nightcore: 'nightcore', 'sped-up': 'sped up', slowed: 'slowed', '8d': '8D audio', hour: 'hours long', loop: 'a loop',
		reaction: 'a reaction', instrumental: 'instrumental', live: 'live', 'tv-size': 'TV size', lyrics: 'a lyrics video'
	};
	var BAD = ['no-title', 'other-artist', 'other-version', 'length-off', 'not-version', 'cover', 'karaoke', 'nightcore', 'sped-up', 'slowed', '8d', 'hour', 'loop', 'reaction', 'instrumental', 'live', 'tv-size', 'lyrics'];
	function whyWords(codes) {
		var good = [], bad = [];
		(codes || []).forEach(function (c) {
			var w = WHY[c];
			if (!w) return;
			var to = BAD.indexOf(c) >= 0 ? bad : good;
			if (to.indexOf(w) < 0) to.push(w);
		});
		return { good: good, bad: bad };
	}
	// '3:42, 2 s longer' against the old length; 'length unknown' without one.
	function lengthWords(sec, oldSec) {
		sec = +sec || 0; oldSec = +oldSec || 0;
		if (!sec) return 'length unknown';
		if (!oldSec) return clock(sec);
		var gap = sec - oldSec, a = Math.abs(gap);
		if (a < 1) return clock(sec) + ', the same length';
		return clock(sec) + ', ' + (a < 60 ? a + ' s' : clock(a)) + (gap > 0 ? ' longer' : ' shorter');
	}
	// What would move, in words: ['12 plays', 'a rating of 5 (liked)', 'its labels', ...].
	// lists: hand-picked playlists holding it; listens: its rows in the history.
	function summary(t, lists, listens) {
		var out = [], e = Object.keys(t.userEdits || {}).length, pls = (t.playlists || []).length + (+lists || 0);
		if (t.plays) out.push(plural(t.plays, 'play'));
		if (t.skips) out.push(plural(t.skips, 'skip'));
		if (t.rating) out.push('a rating of ' + t.rating + (t.rating >= 4 ? ' (liked)' : ''));
		if (t.labels) out.push('its labels');
		if (e) out.push(e === 1 ? 'your correction' : 'your corrections');
		if (t.tags && t.tags.length) out.push(plural(t.tags.length, 'tag'));
		if (pls) out.push(plural(pls, 'playlist'));
		if (listens) out.push(plural(+listens, 'listen') + ' in the history');
		if (t.blocked) out.push('its block');
		return out;
	}
	function joinWords(list) { return list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1]; }

	// ---- The swap ---------------------------------------------------------------------------

	function carried(t) { var o = {}; STATE.concat(PLACES).forEach(function (k) { o[k] = copy(t[k]); }); return o; }
	// Gaps filled from another map: the keys `into` has stay.
	function fillIn(into, from) {
		var out = copy(into || {});
		Object.keys(from || {}).forEach(function (k) { if (out[k] == null) out[k] = copy(from[k]); });
		return out;
	}
	// The old song's state added to a copy the library had already: the higher rating,
	// plays and skips added, the later last play, playlists joined (each with its earlier
	// date), tags joined, the copy's own corrections and labels kept and the old one's
	// filling the gaps, and the old song's block (that copy was often blocked as a duplicate).
	function merge(target, old, now) {
		var before = { rating: target.rating, blocked: target.blocked };
		target.rating = Math.max(+target.rating || 0, +old.rating || 0);
		target.plays = (+target.plays || 0) + (+old.plays || 0);
		target.skips = (+target.skips || 0) + (+old.skips || 0);
		target.lastPlayed = later(target.lastPlayed, old.lastPlayed);
		target.blocked = !!old.blocked;
		target.tags = union(target.tags, old.tags);
		target.userEdits = fillIn(target.userEdits, old.userEdits);
		target.labels = target.labels || old.labels ? fillIn(target.labels, old.labels) : null;
		target.stateAt = target.rating !== before.rating || target.blocked !== before.blocked ? iso(now) : later(target.stateAt, old.stateAt);
		target.playlists = union(target.playlists, old.playlists);
		var at = copy(target.addedAt || {});
		Object.keys(old.addedAt || {}).forEach(function (p) { if (!at[p] || (old.addedAt[p] && old.addedAt[p] < at[p])) at[p] = old.addedAt[p]; });
		target.addedAt = at;
	}
	// The record yt.js would make of a video; partial ones (oEmbed's, the demo's) get no
	// fetchedAt, so the next refresh with a sign-in reads them in full.
	function asVideo(v) {
		return { id: str(v.videoId || v.id), title: str(v.title), channel: str(v.channel), channelId: str(v.channelId), durationSec: +v.durationSec || 0, publishedAt: v.publishedAt || null, embeddable: v.embeddable !== false, topics: v.topics || [], year: v.year || null, live: !!v.live, categoryId: str(v.categoryId) };
	}

	// Move a song from a dead upload to another: `video` is yt.js's record of the new
	// upload ({ id or videoId, title, channel, ... }, `partial` when only oEmbed knew it),
	// or just the id of a copy the library has. The new upload carries the old one's
	// rating, plays, skips, last play, block, tags, corrections, labels, playlists and
	// dates added; a copy already here is merged into instead (merge above). The old id
	// goes to lib.moved, its track out of lib.tracks (the record keeps it whole).
	// -> { ok: true, oldId, newId, created, ids: [to write], drop: [to delete], record }
	//    or { ok: false, reason: 'no-track' | 'moved' | 'no-video' | 'same' | 'replaced' | 'unplayable' }
	function swap(lib, oldId, video, opts) {
		opts = opts || {};
		var L = need('library'), now = opts.now == null ? Date.now() : +opts.now;
		var old = lib.tracks[oldId];
		if (!old) return { ok: false, reason: lib.moved && lib.moved[oldId] ? 'moved' : 'no-track' };
		var newId = video ? str(video.videoId || video.id) : '';
		if (!newId) return { ok: false, reason: 'no-video' };
		if (newId === oldId) return { ok: false, reason: 'same' };
		if (lib.moved && lib.moved[newId]) return { ok: false, reason: 'replaced' };
		var target = lib.tracks[newId];
		if (target ? !L.playable(target) : video.embeddable === false) return { ok: false, reason: 'unplayable' };
		var record = { v: 1, old: copy(old), to: newId, at: iso(now), created: !target, before: target ? carried(target) : null, after: null, lists: [] };
		if (!target) {
			L.upsert(lib, [asVideo(video)], { now: now });
			target = lib.tracks[newId];
			if (video.partial) target.fetchedAt = null;
			STATE.concat(PLACES).forEach(function (k) { target[k] = copy(old[k]); });
		} else merge(target, old, now);
		if (!lib.moved) lib.moved = {};
		lib.moved[oldId] = { to: newId, at: record.at };
		delete lib.tracks[oldId];
		L.deriveIds(lib, [newId]);
		record.after = carried(target);
		return { ok: true, oldId: oldId, newId: newId, created: record.created, ids: [newId], drop: [oldId], record: record };
	}

	// Put the old upload back (a record from swap). Created: the new upload leaves the
	// library and the song goes back with everything it has now. Merged: the old track
	// comes back as it was, and the copy gets back what it had, keeping what happened
	// to it since (plays added, a rating or label changed after the swap).
	// -> { ok: true, ids: [to write], drop: [to delete] } or { ok: false, reason: 'back' | 'not-moved' | 'gone' }
	function unswap(lib, record) {
		var L = need('library'), old = record && record.old, oldId = old && old.id, toId = record && record.to;
		if (!oldId || !toId) return { ok: false, reason: 'not-moved' };
		if (lib.tracks[oldId]) return { ok: false, reason: 'back' };
		if (!lib.moved || !lib.moved[oldId] || lib.moved[oldId].to !== toId) return { ok: false, reason: 'not-moved' };
		var target = lib.tracks[toId];
		if (!target) return { ok: false, reason: 'gone' };
		var back = copy(old), now = carried(target), after = record.after || now, ids = [oldId], drop = [];
		if (record.created) {
			STATE.forEach(function (k) { back[k] = copy(now[k]); });
			delete lib.tracks[toId];
			drop.push(toId);
		} else {
			var before = record.before || now;
			target.plays = (+before.plays || 0) + Math.max(0, (+now.plays || 0) - (+after.plays || 0));
			target.skips = (+before.skips || 0) + Math.max(0, (+now.skips || 0) - (+after.skips || 0));
			['rating', 'lastPlayed', 'blocked', 'tags', 'userEdits', 'labels', 'stateAt'].forEach(function (k) { target[k] = same(now[k], after[k]) ? copy(before[k]) : copy(now[k]); });
			var joined = (now.playlists || []).filter(function (p) { return (after.playlists || []).indexOf(p) < 0; });
			target.playlists = union(before.playlists, joined);
			target.addedAt = copy(before.addedAt || {});
			joined.forEach(function (p) { if (now.addedAt && now.addedAt[p]) target.addedAt[p] = now.addedAt[p]; });
			ids.push(toId);
		}
		lib.tracks[oldId] = back;
		delete lib.moved[oldId];
		L.deriveIds(lib, ids);
		return { ok: true, ids: ids, drop: drop };
	}

	// Hand-picked playlists ({ kind: 'manual', ids }): the old id becomes the new one in
	// its place, or leaves when the new one is there already. -> [{ id, at, had }] (changed in place)
	function moveInLists(lists, oldId, newId) {
		var places = [];
		(lists || []).forEach(function (li) {
			if (!li || li.kind !== 'manual' || !Array.isArray(li.ids)) return;
			var at = li.ids.indexOf(oldId);
			if (at < 0) return;
			var had = li.ids.indexOf(newId) >= 0;
			if (had) li.ids.splice(at, 1); else li.ids[at] = newId;
			places.push({ id: li.id, at: at, had: had });
		});
		return places;
	}
	// The other way, from those places. -> how many playlists changed
	function unmoveInLists(lists, oldId, newId, places) {
		var n = 0;
		(places || []).forEach(function (p) {
			var li = (lists || []).filter(function (x) { return x && x.id === p.id && x.kind === 'manual' && Array.isArray(x.ids); })[0];
			if (!li || li.ids.indexOf(oldId) >= 0) return;
			var at = li.ids.indexOf(newId);
			if (!p.had && at >= 0) li.ids[at] = oldId; else li.ids.splice(Math.min(p.at, li.ids.length), 0, oldId);
			n++;
		});
		return n;
	}

	// Listens are never rewritten in the store: each keeps the video that played. The page
	// reads them through lib.moved. rows: the history (changed in place).
	// -> [{ row, from }] (from: the id the row had)
	function mapRows(rows, lib) {
		var L = need('library'), out = [];
		if (!lib || !lib.moved) return out;
		(rows || []).forEach(function (r) {
			if (!r || !lib.moved[r.id]) return;
			var to = L.movedTo(lib, r.id);
			if (!to) return;
			out.push({ row: r, from: r.id });
			r.id = to;
		});
		return out;
	}
	// The rows mapRows changed, read again through lib.moved as it is now (after an undo).
	function restoreRows(list, lib) {
		var L = need('library');
		(list || []).forEach(function (m) { m.row.id = L.movedTo(lib, m.from) || m.from; });
	}

	// =========================================================================================
	// The page. Drawn only with ctx (app.js pageCtx). Titles are untrusted text: everything
	// goes on the page through ctx.h, which uses textContent.
	// =========================================================================================

	var CSS_ID = 'ts-rescue-css';
	var CSS = [
		'.ts-rs-list { list-style: none; margin: 0 0 8px; padding: 0; max-width: 900px; }',
		'.ts-rs-row { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 8px 4px; border-bottom: 1px solid var(--border); }',
		'.ts-rs-row > .ts-art, .ts-rs-pick > .ts-art { width: 48px; height: 48px; border-radius: 6px; flex: none; }',
		'.ts-rs-t { display: flex; flex-direction: column; gap: 2px; min-width: 0; }',
		'.ts-rs-title { font-weight: 650; color: var(--heading); overflow-wrap: anywhere; text-decoration: none; }',
		'a.ts-rs-title:hover { text-decoration: underline; }',
		'.ts-rs-sub { font-size: 12.5px; line-height: 1.4; color: var(--text-2); overflow-wrap: anywhere; }',
		'.ts-rs-sub .ts-badge { margin-right: 6px; }',
		'.ts-rs-acts { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; }',
		'.ts-rs-moves { margin: 0 0 14px; max-width: 72ch; line-height: 1.5; }',
		'.ts-rs-moves b { color: var(--heading); }',
		'.ts-rs-group { margin: 0; padding: 0; border: 0; min-width: 0; }',
		'.ts-rs-status { min-height: 1.4em; margin: 0 0 8px; font-size: 13px; color: var(--text-2); }',
		'.ts-rs-cand { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; margin: 0 0 6px; padding: 4px 6px 4px 4px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }',
		'.ts-rs-cand.is-sel { border-color: var(--ts-play); background: color-mix(in srgb, var(--ts-play) 9%, var(--surface)); }',
		'.ts-rs-pick { display: grid; grid-template-columns: 22px 48px minmax(0, 1fr); align-items: center; gap: 10px; min-width: 0; padding: 6px; border-radius: 9px; cursor: pointer; }',
		'.ts-rs-pick input { width: 18px; height: 18px; margin: 0; accent-color: var(--ts-play); }',
		'.ts-rs-pick:has(input:focus-visible) { outline: 2px solid var(--ts-play); outline-offset: 1px; }',
		'.ts-rs-bad { color: var(--text); }',
		'.ts-rs-use { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin: 12px 0 4px; }',
		'.ts-rs-use .ts-muted { font-size: 13px; }',
		'.ts-rs-more { max-width: 900px; margin: 22px 0 0; }',
		'.ts-rs-more h2 { margin: 0 0 6px; font-size: 17px; color: var(--heading); }',
		'.ts-rs-paste { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 10px 0 0; max-width: 620px; }',
		'.ts-rs-paste .kit-input { flex: 1 1 240px; min-width: 0; }',
		'.ts-rs-note { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; max-width: 860px; margin: 12px 0 14px; padding: 10px 12px; border: 1px dashed var(--border-strong); border-radius: 10px; font-size: 13.5px; }',
		'.ts-rs-note p { flex: 1 1 260px; margin: 0; line-height: 1.45; }',
		'.ts-rs-h2 { margin: 26px 0 8px; font-size: 18px; color: var(--heading); }',
		'@media (max-width: 560px) {',
		'  .ts-rs-row { grid-template-columns: 40px minmax(0, 1fr); }',
		'  .ts-rs-row > .ts-art { width: 40px; height: 40px; }',
		'  .ts-rs-row .ts-rs-acts { grid-column: 2; justify-content: flex-start; }',
		'  .ts-rs-cand { gap: 2px; padding-right: 2px; }',
		'  .ts-rs-cand .ts-rs-acts { flex-direction: column; gap: 2px; }',
		'  .ts-rs-pick { grid-template-columns: 22px 40px minmax(0, 1fr); }',
		'  .ts-rs-pick > .ts-art { width: 40px; height: 40px; }',
		'}'
	].join('\n');
	function injectCss() {
		if (typeof document === 'undefined' || document.getElementById(CSS_ID)) return;
		var s = document.createElement('style');
		s.id = CSS_ID;
		s.textContent = CSS;
		(document.head || document.documentElement).appendChild(s);
	}

	var mapped = [];      // the history rows read through lib.moved: [{ row, from }]
	var memo = {};        // per song, for this visit: what was found, what is chosen
	var poolMemo = null;  // the cache's videos by title key, for a few minutes
	var POOL_MS = 600000;

	// app.js loadHistory: the listens read through lib.moved. -> how many were moved
	function mapHistory(rows, lib) { mapped = mapRows(rows, lib); return mapped.length; }
	// app.js checkInbox: a listen the Desk sends back under the old id is one the page has.
	function seenListens(have) { mapped.forEach(function (m) { have[m.from + '@' + m.row.at] = true; }); }

	function dateText(s) { var d = new Date(s); return isNaN(d) ? '' : d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
	function lib0(ctx) { return ctx.lib(); }
	function listsOf(ctx) { return ctx.lists && ctx.lists.all ? ctx.lists.all() || [] : []; }
	function inLists(ctx, id) { return listsOf(ctx).filter(function (li) { return li && li.kind === 'manual' && Array.isArray(li.ids) && li.ids.indexOf(id) >= 0; }).length; }
	function listensOf(ctx, id) { return (ctx.history ? ctx.history() || [] : []).filter(function (r) { return r && r.id === id; }).length; }
	function songHref(ctx, id) { return ctx.link('rescue', id); }
	function youtubeSearch(t) { return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(queryOf(t)); }
	function Src() { return (root.TrueShuffle || {}).sources; }
	function lists(ctx) { var S = Src(), c = ctx.client ? ctx.client() : null; return S && c ? S.ytLists(c, ctx.cache()) : null; }
	function quotaOk(ctx, units) { var e = ctx.engine ? ctx.engine() : null, q = e ? e.quota() : null; return !q || q.left >= units; }
	// Moves onto this track that can be put back: [{ id (the old id), at }].
	function movedHere(lib, id) {
		return Object.keys(lib.moved || {}).filter(function (k) { return lib.moved[k].to === id && !lib.tracks[k]; }).map(function (k) { return { id: k, at: lib.moved[k].at }; });
	}

	// The cache's videos, read once every ten minutes at most (and again after a search).
	function loadPool(ctx) {
		var cache = ctx.cache ? ctx.cache() : null;
		if (!cache || ctx.demo) return Promise.resolve(null);
		if (poolMemo && Date.now() - poolMemo.at < POOL_MS) return Promise.resolve(poolMemo.pix);
		return Promise.all(['yt:q:', 'yt:list:', 'yt:mix:', 'yt:v:', 'oe:'].map(function (p) { return cache.range(p).catch(function () { return []; }); })).then(function (parts) {
			var pix = poolIndex(poolOf([].concat.apply([], parts)));
			poolMemo = { at: Date.now(), pix: pix };
			return pix;
		});
	}
	// The free candidates the page has at once: other copies, and the demo's invented uploads.
	function quickList(ctx, t) {
		var raw = copiesOf(ctx.libIndex ? ctx.libIndex() : null, t);
		if (ctx.demo) raw = raw.concat(demoUploads(t).map(function (v) { return { video: v, source: 'demo', keep: true }; }));
		return raw;
	}
	// The artist's Topic channel, from the library's tracks or the videos seen.
	function topicFor(lib, t, pix) {
		var M = need('match'), keys = M.artistKeys(str(t.artist), str(t.artistNative)), found = '';
		function look(channel, id) { var m = /^(.*) - Topic$/.exec(channel || ''); if (!found && m && id && keys.indexOf(M.fold(m[1])) >= 0) found = id; }
		if (!keys.length) return '';
		Object.keys(lib.tracks).forEach(function (k) { look(lib.tracks[k].channel, lib.tracks[k].channelId); });
		if (pix) pix.list.forEach(function (v) { look(v.channel, v.channelId); });
		return /^UC[A-Za-z0-9_-]{22}$/.test(found) ? found : '';
	}

	// ---- #/rescue: every song that cannot play ------------------------------------------------

	function view(el, ctx, parts) {
		injectCss();
		if (parts && parts[0]) songPage(el, ctx, parts[0]); else listPage(el, ctx);
	}

	function listPage(el, ctx) {
		var h = ctx.h, lib = lib0(ctx), dead = unplayable(ctx.idx().all);
		el.appendChild(h('h1', { class: 'ts-h1', text: 'Songs gone from YouTube' }));
		el.appendChild(h('p', { class: 'ts-muted ts-lede', text: 'These uploads were deleted, made private or kept off other sites. Another upload of the same song can take each one' + RSQ + 's place, with its ratings, plays, labels, playlists and history. Nothing changes on YouTube.' }));
		if (!Object.keys(lib.tracks).length) { el.appendChild(h('p', { class: 'ts-empty', text: 'Nothing in the library yet.' })); return; }
		if (!dead.length) el.appendChild(h('p', { class: 'ts-empty', text: 'Every song plays. When an upload goes from YouTube, it shows up here.' }));
		else {
			var ul = h('ul', { class: 'ts-rs-list', aria: { label: 'Songs that cannot play' } }), subs = {};
			dead.forEach(function (t) {
				var sub = h('span', { class: 'ts-rs-sub', text: [ctx.words.artist(t), reasonText(t), t.plays ? plural(t.plays, 'play') : '', t.rating ? 'rated ' + t.rating : ''].filter(Boolean).join(' ' + DOT + ' ') });
				subs[t.id] = sub;
				ul.appendChild(h('li', { class: 'ts-rs-row' }, [
					ctx.art(t),
					h('span', { class: 'ts-rs-t' }, [h('a', { class: 'ts-rs-title', href: ctx.link('track', t.id), text: titleOf(t) }), sub]),
					h('span', { class: 'ts-rs-acts' }, ctx.U.btn({ label: 'Find an upload', icon: 'fix', size: 'sm', href: songHref(ctx, t.id), data: { id: 'rs-find-' + t.id } }))
				]));
			});
			el.appendChild(ul);
			markSure(ctx, dead, subs);
		}
		movedSection(el, ctx);
	}
	// "Sure match" beside the songs that have one for free (a copy, an upload seen before).
	function markSure(ctx, dead, subs) {
		function mark(t, list) {
			var best = candidates(t, list)[0];
			if (!best || !best.sure || !subs[t.id] || subs[t.id].querySelector('.ts-badge')) return;
			subs[t.id].insertBefore(ctx.U.badge('ok', best.track ? 'Copy in your library' : 'Sure match found'), subs[t.id].firstChild);
		}
		dead.forEach(function (t) { mark(t, quickList(ctx, t)); });
		loadPool(ctx).then(function (pix) {
			if (pix) dead.forEach(function (t) { if (subs[t.id].isConnected) mark(t, fromPool(pix, t)); });
		}, function () { /* the hints are only hints */ });
	}
	function movedSection(el, ctx) {
		var h = ctx.h, lib = lib0(ctx), moves = [];
		Object.keys(lib.moved || {}).forEach(function (k) { var m = lib.moved[k]; if (!lib.tracks[k] && lib.tracks[m.to]) moves.push({ id: k, to: m.to, at: m.at }); });
		if (!moves.length) return;
		moves.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
		el.appendChild(h('h2', { class: 'ts-rs-h2', text: 'Moved to another upload' }));
		var ul = h('ul', { class: 'ts-rs-list', aria: { label: 'Songs moved to another upload' } });
		moves.forEach(function (m) {
			var t = lib.tracks[m.to];
			var back = ctx.U.btn({ label: 'Put the old one back', icon: 'back', variant: 'ghost', size: 'sm', data: { id: 'rs-back-' + m.id } });
			back.addEventListener('click', function () { putBack(ctx, m.id, back); });
			ul.appendChild(h('li', { class: 'ts-rs-row' }, [
				ctx.art(t),
				h('span', { class: 'ts-rs-t' }, [h('a', { class: 'ts-rs-title', href: ctx.link('track', t.id), text: titleOf(t) }), h('span', { class: 'ts-rs-sub', text: ctx.words.artist(t) + ' ' + DOT + ' moved on ' + dateText(m.at) + ' from an upload that stopped playing' })]),
				h('span', { class: 'ts-rs-acts' }, back)
			]));
		});
		el.appendChild(ul);
	}

	// ---- #/rescue/<id>: one song, its candidates ----------------------------------------------

	function songPage(el, ctx, id) {
		var h = ctx.h, lib = lib0(ctx), t = lib.tracks[id];
		if (!t) {
			var to = need('library').movedTo(lib, id);
			el.appendChild(h('h1', { class: 'ts-h1', text: 'Find a working upload' }));
			if (to && lib.tracks[to]) {
				var p = h('p', { class: 'ts-lede' }, ['This song moved to another upload: ', h('a', { href: ctx.link('track', to), text: titleOf(lib.tracks[to]) }), '.']);
				el.appendChild(p);
				if (lib.moved[id].to === to) { var b = ctx.U.btn({ label: 'Put the old one back', icon: 'back', size: 'sm' }); b.addEventListener('click', function () { putBack(ctx, id, b); }); el.appendChild(h('div', { class: 'ts-row-btns' }, b)); }
			} else el.appendChild(h('p', { class: 'ts-empty', text: 'This song is not in the library.' }));
			return;
		}
		if (!reason(t)) {
			el.appendChild(h('h1', { class: 'ts-h1', text: 'Find a working upload' }));
			el.appendChild(h('p', { class: 'ts-empty' }, [h('a', { href: ctx.link('track', t.id), text: titleOf(t) }), ' plays, so it needs no other upload. ', h('a', { href: '#/rescue', text: 'Songs gone from YouTube' })]));
			return;
		}
		ctx.ui.headerBlock(el, {
			kicker: 'Find a working upload', title: titleOf(t), alt: t.titleAlt, hue: ctx.hue(t), artNode: ctx.art(t, 'ts-hero-art'),
			meta: [ctx.words.artist(t), t.durationSec ? clock(t.durationSec) : '', reasonText(t)].filter(Boolean).join(' ' + DOT + ' ')
		});
		var what = summary(t, inLists(ctx, t.id), listensOf(ctx, t.id));
		el.appendChild(h('p', { class: 'ts-rs-moves' }, what.length ? ['What moves to the upload you choose: ', h('b', { text: joinWords(what) }), '. Nothing changes on YouTube, and you can undo it.'] : ['Choose the upload that plays this song from now on. Nothing changes on YouTube, and you can undo it.']));
		var st = memo[t.id];
		if (!st) { st = memo[t.id] = { id: t.id, raw: quickList(ctx, t), sel: null, touched: false, status: '', done: false, searched: false, box: null }; gather(ctx, st); }
		st.box = h('div', { class: 'ts-rs-cands' });
		el.appendChild(st.box);
		drawCands(ctx, st);
		el.appendChild(moreBox(ctx, t, st));
		el.appendChild(h('p', { class: 'ts-muted' }, h('a', { href: '#/rescue', text: 'All songs gone from YouTube' })));
	}

	function redraw(ctx, st) {
		if (!st.box || !st.box.isConnected) return;
		var ae = document.activeElement, key = ae && st.box.contains(ae) && ae.dataset ? ae.dataset.id : null;
		drawCands(ctx, st);
		if (key) { var back = st.box.querySelector('[data-id="' + key + '"]'); if (back) back.focus({ preventScroll: true }); }
	}
	function setStatus(ctx, st, text) { st.status = text || ''; redraw(ctx, st); }
	function errText(err) { return (err && err.message) || 'YouTube could not be reached.'; }

	// Free first: the copies and the cache at once, then (with a key or a sign-in) the
	// artist's Topic channel (1 unit for 50 uploads, kept 6 hours) and the lengths of the
	// best uploads (1 unit, kept 30 days).
	function gather(ctx, st) {
		setStatus(ctx, st, 'Looking in your library and in what YouTube showed before' + ELL);
		loadPool(ctx).then(function (pix) {
			var t = lib0(ctx).tracks[st.id];
			if (!t) return null;
			st.raw = st.raw.concat(fromPool(pix, t));
			var cid = !ctx.demo && ctx.canRead() && quotaOk(ctx, 10) ? topicFor(lib0(ctx), t, pix) : '', yl = lists(ctx);
			if (!cid || !yl) return null;
			setStatus(ctx, st, 'Reading ' + t.artist + RSQ + 's Topic channel' + ELL);
			return yl.uploads(cid, { max: 200 }).then(function (items) {
				st.raw = st.raw.concat((items || []).map(function (f) { return { video: { videoId: f.videoId, title: f.title, channel: f.channel || t.artist + ' - Topic', channelId: cid, durationSec: f.durationSec || 0 }, source: 'topic' }; }));
			});
		}).then(function () { return lengths(ctx, st); }).then(function () {
			st.done = true;
			setStatus(ctx, st, '');
		}, function (err) {
			st.done = true;
			setStatus(ctx, st, errText(err));
		});
	}
	// The length and playability of the best uploads, from the video details (one call).
	function lengths(ctx, st) {
		var t = lib0(ctx).tracks[st.id], yl = lists(ctx);
		if (!t || ctx.demo || !yl || !ctx.canRead() || !quotaOk(ctx, 2)) return Promise.resolve();
		var want = candidates(t, st.raw).filter(function (c) { return !c.track && !c.record; }).slice(0, 12).map(function (c) { return c.video.videoId; });
		if (!want.length) return Promise.resolve();
		return yl.videos(want).then(function (r) {
			var rec = {}, gone = {};
			r.videos.forEach(function (v) { rec[v.id] = v; });
			r.missing.forEach(function (id) { gone[id] = true; });
			st.raw = st.raw.filter(function (c) { var id = c.video.videoId; return !gone[id] && !(rec[id] && rec[id].embeddable === false); }).map(function (c) {
				var v = rec[c.video.videoId];
				if (!v || c.track) return c;
				return { video: { videoId: v.id, title: v.title, channel: v.channel, channelId: v.channelId, durationSec: v.durationSec }, source: c.source, keep: c.keep, record: v };
			});
		});
	}

	function drawCands(ctx, st) {
		var h = ctx.h, U = ctx.U, box = st.box, lib = lib0(ctx), t = lib.tracks[st.id];
		ctx.clear(box);
		if (!t) return;
		var list = candidates(t, st.raw).filter(function (c) { return !(lib.moved && lib.moved[c.video.videoId]); });
		if (!st.touched) st.sel = list[0] && list[0].sure ? list[0].video.videoId : null;
		if (st.sel && !list.some(function (c) { return c.video.videoId === st.sel; })) st.sel = null;
		box.appendChild(h('h2', { class: 'ts-rs-h2', text: 'Uploads of this song' }));
		box.appendChild(h('p', { class: 'ts-rs-status', role: 'status', aria: { live: 'polite' }, text: st.status || (list.length ? (list[0].sure ? 'The first is surely this song, so it is chosen. Play it to check, then use it.' : 'None of these is surely this song. Play one to check it before you choose.') : st.done ? 'Nothing found yet is this song. Search YouTube, or paste the link of an upload below.' : '') }));
		if (list.length) {
			var group = h('fieldset', { class: 'ts-rs-group' }, h('legend', { class: 'kit-sr', text: 'Choose the upload for ' + titleOf(t) }));
			var ul = h('ul', { class: 'ts-rs-list' });
			list.forEach(function (c) { ul.appendChild(candRow(ctx, st, t, c)); });
			group.appendChild(ul);
			box.appendChild(group);
		}
		var chosen = list.filter(function (c) { return c.video.videoId === st.sel; })[0] || null;
		var use = U.btn({ label: chosen && chosen.track ? 'Use this copy' : 'Use this upload', icon: 'check', variant: 'primary', busyLabel: 'Moving' + ELL, disabled: !chosen, data: { id: 'rs-use' } });
		use.addEventListener('click', function () { if (chosen) useUpload(ctx, st, chosen, use); });
		box.appendChild(h('div', { class: 'ts-rs-use' }, [use, h('span', { class: 'ts-muted', text: !chosen ? 'Choose an upload first.' : chosen.track ? 'It is in your library already: the song' + RSQ + 's plays are added to it, the higher rating kept.' : 'It joins your library in the old one' + RSQ + 's place.' })]));
	}
	var SOURCE_BADGE = { library: ['library', 'In your library'], topic: ['channel', 'Topic channel'], search: ['search', 'YouTube search'], pool: ['ext', 'Seen before'], paste: ['ext', 'Your link'], demo: ['new', 'Invented'] };
	function candRow(ctx, st, t, c) {
		var h = ctx.h, U = ctx.U, v = c.video, id = v.videoId, w = whyWords(c.why), on = st.sel === id;
		var radio = h('input', { type: 'radio', name: 'rs-pick-' + st.id, value: id, checked: on, data: { id: 'rs-pick-' + id } });
		radio.addEventListener('change', function () { if (radio.checked) { st.sel = id; st.touched = true; redraw(ctx, st); } });
		var hue = ctx.hue(t), art = c.track ? ctx.art(c.track) : U.art(id, hue.h, v.title, '', !!(ctx.prefs().art && !ctx.demo), hue.s);
		var badge = SOURCE_BADGE[c.source] || SOURCE_BADGE.pool;
		var sub1 = h('span', { class: 'ts-rs-sub' }, [U.badge(badge[0], badge[1]), c.sure ? U.badge('ok', 'Sure match') : null, [v.channel, lengthWords(v.durationSec, t.durationSec)].filter(Boolean).join(' ' + DOT + ' ')]);
		var sub2 = h('span', { class: 'ts-rs-sub' }, [w.good.join(', '), w.bad.length ? h('span', { class: 'ts-rs-bad', text: (w.good.length ? '; but ' : 'But ') + w.bad.join(', ') }) : null, c.track && c.track.blocked ? h('span', { text: '; blocked now, it plays again' }) : null]);
		// a blocked copy cannot play until it takes the song's place (its line says so)
		var acts = [U.btn({ icon: 'play', label: 'Play ' + v.title, iconOnly: true, disabled: !!(c.track && c.track.blocked), data: { id: 'rs-play-' + id }, on: { click: function () { tryIt(ctx, t, c); } } })];
		if (!ctx.demo && YT_ID.test(id)) acts.push(U.btn({ icon: 'external', label: 'Open ' + v.title + ' on YouTube', iconOnly: true, href: 'https://www.youtube.com/watch?v=' + id, target: '_blank', rel: 'noopener noreferrer' }));
		return h('li', { class: 'ts-rs-cand' + (on ? ' is-sel' : '') }, [
			h('label', { class: 'ts-rs-pick' }, [radio, art, h('span', { class: 'ts-rs-t' }, [h('span', { class: 'ts-rs-title', text: v.title }), sub1, sub2])]),
			h('span', { class: 'ts-rs-acts' }, acts)
		]);
	}
	// Play a candidate to check it: a copy as itself, an upload as a found song (not kept).
	function tryIt(ctx, t, c) {
		if (c.track) { ctx.play.now([c.track.id]); return; }
		var S = Src(), v = c.video;
		if (!S || !ctx.play.find) return;
		ctx.play.find(S.find({ key: 'v:' + v.videoId, videoId: v.videoId, title: v.title, artist: t.artist || '', channel: v.channel, channelId: v.channelId, durationSec: v.durationSec, source: 'rescue' }), 'now');
	}

	// Not here: a search (100 units, a press), else a search in a new tab; a pasted link.
	function moreBox(ctx, t, st) {
		var h = ctx.h, U = ctx.U, box = h('section', { class: 'ts-rs-more', aria: { label: 'Other uploads' } });
		box.appendChild(h('h2', { text: 'Not here?' }));
		if (ctx.demo) { box.appendChild(h('p', { class: 'ts-muted', text: 'The demo cannot search YouTube: its uploads above are invented.' })); return box; }
		var row = h('div', { class: 'ts-row-btns' });
		if (ctx.canRead()) {
			var sb = U.btn({ label: st.searched ? 'Searched YouTube' : 'Search YouTube', icon: 'search', cost: st.searched ? null : 100, busyLabel: 'Searching' + ELL, disabled: st.searched, data: { id: 'rs-search' } });
			sb.addEventListener('click', function () { search(ctx, st, sb); });
			row.appendChild(sb);
			box.appendChild(row);
			box.appendChild(h('p', { class: 'ts-muted', text: 'One search for ' + queryOf(t) + ': 100 of today' + RSQ + 's YouTube units. Or paste the link of an upload you found.' }));
		} else {
			row.appendChild(U.btn({ label: 'Search on YouTube', icon: 'external', href: youtubeSearch(t), target: '_blank', rel: 'noopener noreferrer' }));
			box.appendChild(row);
			box.appendChild(h('p', { class: 'ts-muted', text: 'Searching from here needs a sign-in or an API key (Settings). Found an upload in the new tab? Paste its link here.' }));
		}
		var inp = h('input', { class: 'kit-input', type: 'url', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: 'https://www.youtube.com/watch?v=' + ELL, aria: { label: 'The link of another upload' }, data: { id: 'rs-paste-in' } });
		var go = U.btn({ label: 'Check it', size: 'md', busyLabel: 'Checking' + ELL });
		go.type = 'submit';
		var form = h('form', { class: 'ts-rs-paste', novalidate: true }, [inp, go]);
		form.addEventListener('submit', function (e) { e.preventDefault(); paste(ctx, st, inp.value, go); });
		box.appendChild(form);
		return box;
	}
	function search(ctx, st, btn) {
		var t = lib0(ctx).tracks[st.id], yl = lists(ctx);
		if (!t || !yl) return;
		if (!quotaOk(ctx, 101)) { ctx.say('Today' + RSQ + 's YouTube allowance for finding songs is used up; it starts again at midnight Pacific time.'); return; }
		ctx.U.btnState(btn, { busy: true });
		var job = ctx.job('Searching YouTube for ' + queryOf(t) + ELL);
		yl.searchVideos(queryOf(t), { max: 10, category: null }).then(function (items) {
			st.raw = st.raw.concat((items || []).map(function (v) { return { video: { videoId: v.videoId, title: v.title, channel: v.channel, channelId: v.channelId, durationSec: 0 }, source: 'search', keep: true }; }));
			st.searched = true;
			poolMemo = null;
			return lengths(ctx, st);
		}).then(function () {
			job.done();
			ctx.U.btnState(btn, { busy: false, disabled: true, label: 'Searched YouTube', cost: null });
			redraw(ctx, st);
		}, function (err) { job.done(); ctx.U.btnState(btn, { busy: false }); ctx.fail(err); });
	}
	// A link the listener found: checked with the video details (1 unit), else oEmbed (free).
	function paste(ctx, st, text, btn) {
		var lib = lib0(ctx), t = lib.tracks[st.id], share = (root.TrueShuffle || {}).share, id = share ? share.videoIdOf(text) : '';
		if (!t) return;
		if (!id) { ctx.say('That is not a link to a YouTube video.'); return; }
		if (id === t.id) { ctx.say('That is the upload that stopped playing.'); return; }
		if (lib.moved && lib.moved[id]) { ctx.say('That upload was replaced by another earlier.'); return; }
		function add(c) { st.raw = st.raw.filter(function (x) { return x.video.videoId !== id; }).concat([c]); st.sel = id; st.touched = true; redraw(ctx, st); }
		if (lib.tracks[id]) { add({ video: trackVideo(lib.tracks[id]), source: 'library', track: lib.tracks[id], keep: true }); return; }
		ctx.U.btnState(btn, { busy: true });
		checkVideo(ctx, id, null).then(function (v) {
			ctx.U.btnState(btn, { busy: false });
			add({ video: { videoId: v.id, title: v.title, channel: v.channel, channelId: v.channelId, durationSec: v.durationSec }, source: 'paste', keep: true, record: v });
		}, function (err) { ctx.U.btnState(btn, { busy: false }); ctx.fail(err); });
	}
	// What YouTube says of one upload now: its full record with a key or a sign-in (1 unit),
	// else oEmbed's title and channel (free, `partial`). Rejects with a sentence when it is
	// gone or kept off other sites. known: what the page has of it already.
	function checkVideo(ctx, id, known) {
		var S = Src(), yl = lists(ctx);
		if (yl && ctx.canRead()) {
			return yl.videos([id]).then(function (r) {
				var v = r.videos[0];
				if (!v) throw new Error('That upload is gone from YouTube too.');
				if (v.embeddable === false) throw new Error('That upload is kept off other sites too, so it cannot play here.');
				return v;
			});
		}
		if (!S || !ctx.http) return Promise.reject(new Error('YouTube could not be asked about that upload.'));
		return S.oEmbed(ctx.http(), ctx.cache()).video(id).then(function (r) {
			if (!r.ok) throw new Error(r.reason === 'not-embeddable' ? 'That upload is private or kept off other sites, so it cannot play here.' : 'That upload is gone from YouTube, or the link is wrong.');
			return { id: id, title: r.title || (known && known.title) || '', channel: r.channel || (known && known.channel) || '', channelId: r.channelId || (known && known.channelId) || '', durationSec: (known && known.durationSec) || 0, embeddable: true, partial: true };
		});
	}

	// ---- Moving, and putting back ---------------------------------------------------------------

	var REFUSED = {
		'no-track': 'That song is not in the library.', moved: 'That song moved to another upload already.', 'no-video': 'Choose an upload first.',
		same: 'That is the upload that stopped playing.', replaced: 'That upload was replaced by another earlier.', unplayable: 'That upload cannot play here either.'
	};
	var BACK_REFUSED = {
		back: 'The old upload is in the library already.', 'not-moved': 'That move was put back already.',
		gone: 'The song moved on again since. Put that later move back first.'
	};
	function useUpload(ctx, st, c, btn) {
		ctx.U.btnState(btn, { busy: true });
		var ready = c.track ? Promise.resolve({ id: c.track.id }) : ctx.demo ? Promise.resolve({ id: c.video.videoId, title: c.video.title, channel: c.video.channel, channelId: c.video.channelId, durationSec: c.video.durationSec, embeddable: true, partial: true }) : c.record ? Promise.resolve(c.record) : checkVideo(ctx, c.video.videoId, c.video);
		ready.then(function (video) { return commit(ctx, st.id, video); }).then(function (r) {
			ctx.U.btnState(btn, { busy: false });
			if (r) ctx.nav('#/rescue');
		}, function (err) { ctx.U.btnState(btn, { busy: false }); ctx.fail(err); });
	}
	// A swap written to the store (store.js), in an order that never loses the old track:
	// its record first (rescue:moved:<old id>), then the new track and the library's meta
	// (lib.moved), and only then the old track's row goes. change: what swap returned.
	function saveSwap(store, lib, change) {
		return store.set(KEY + change.oldId, change.record).then(function () {
			return store.putTracks(change.ids.map(function (id) { return lib.tracks[id]; }));
		}).then(function () { return store.saveLibraryMeta(need('library').meta(lib)); }).then(function () { return store.deleteTracks(change.drop); });
	}
	// An unswap written: the tracks, the meta, a new upload's row gone, then the record.
	function saveUnswap(store, lib, oldId, change) {
		return store.putTracks(change.ids.map(function (id) { return lib.tracks[id]; })).then(function () {
			return store.saveLibraryMeta(need('library').meta(lib));
		}).then(function () { return store.deleteTracks(change.drop); }).then(function () { return store.set(KEY + oldId, null); });
	}
	function commit(ctx, oldId, video) {
		var lib = lib0(ctx), listens = listensOf(ctx, oldId), r = swap(lib, oldId, video, { now: ctx.now() });
		if (!r.ok) { ctx.say(REFUSED[r.reason] || 'That did not work.'); return Promise.resolve(null); }
		r.record.lists = moveInLists(listsOf(ctx), oldId, r.newId);
		var rows = mapRows(ctx.history ? ctx.history() || [] : [], lib);
		mapped = mapped.concat(rows);
		delete memo[oldId];
		if (r.record.lists.length && ctx.lists.save) ctx.lists.save();
		return saveSwap(ctx.store(), lib, r).then(function () {
			ctx.changed([], false);
			var moved = summary(r.record.old, r.record.lists.length, listens);
			ctx.U.toast((r.created ? 'Moved to the new upload' : 'Moved onto your other copy') + (moved.length ? ': ' + joinWords(moved) + '.' : '.'), { action: 'Undo', onAction: function () { putBack(ctx, oldId, null); } });
			return r;
		}, function (err) {
			// nothing that matters was stored: the swap is taken back in memory too
			if (unswap(lib, r.record).ok) { unmoveInLists(listsOf(ctx), oldId, r.newId, r.record.lists); if (r.record.lists.length && ctx.lists.save) ctx.lists.save(); restoreRows(rows, lib); ctx.changed([], false); }
			throw err;
		});
	}
	function putBack(ctx, oldId, btn) {
		var lib = lib0(ctx);
		if (btn) ctx.U.btnState(btn, { busy: true });
		return ctx.store().get(KEY + oldId, null).then(function (rec) {
			if (!rec || !rec.old) { ctx.say('The old upload' + RSQ + 's record is not here any more, so it cannot be put back.'); return null; }
			var r = unswap(lib, rec);
			if (!r.ok) { ctx.say(BACK_REFUSED[r.reason]); return null; }
			if (unmoveInLists(listsOf(ctx), oldId, rec.to, rec.lists) && ctx.lists.save) ctx.lists.save();
			restoreRows(mapped, lib);
			mapped = mapped.filter(function (m) { return m.row.id !== m.from; });
			delete memo[oldId];
			return saveUnswap(ctx.store(), lib, oldId, r).then(function () {
				ctx.changed([], false);
				var t = lib.tracks[oldId];
				ctx.say('The old upload of ' + titleOf(t) + ' is back' + (reason(t) ? '; it still cannot play here.' : '.'));
				return r;
			});
		}).then(function (r) { if (btn) ctx.U.btnState(btn, { busy: false }); return r; }, function (err) { if (btn) ctx.U.btnState(btn, { busy: false }); ctx.fail(err); });
	}

	// ---- Hooks: #/fix, the track page, the track menu -------------------------------------------

	function fixNote(el, ctx) {
		var dead = unplayable(ctx.idx().all);
		if (!dead.length) return;
		injectCss();
		el.appendChild(ctx.h('div', { class: 'ts-rs-note' }, [
			ctx.h('p', { text: (dead.length === 1 ? 'One song cannot play any more: its upload was' : plural(dead.length, 'song') + ' cannot play any more: their uploads were') + ' deleted, made private or kept off other sites. Another upload of the same song can take over the ratings, plays and labels.' }),
			ctx.U.btn({ label: 'Find working uploads', icon: 'fix', size: 'sm', href: '#/rescue' })
		]));
	}
	function trackNote(el, ctx, t) {
		var lib = lib0(ctx), h = ctx.h;
		if (!t || !lib.tracks[t.id]) return;
		if (reason(t)) {
			injectCss();
			el.appendChild(h('div', { class: 'ts-rs-note' }, [h('p', { text: 'This upload cannot play here: ' + reasonText(t) + '. Another upload of the same song can take its place, with everything it has.' }), ctx.U.btn({ label: 'Find a working upload', icon: 'fix', size: 'sm', href: songHref(ctx, t.id) })]));
		}
		movedHere(lib, t.id).forEach(function (m) {
			injectCss();
			var b = ctx.U.btn({ label: 'Put the old one back', icon: 'back', variant: 'ghost', size: 'sm' });
			b.addEventListener('click', function () { putBack(ctx, m.id, b); });
			el.appendChild(h('div', { class: 'ts-rs-note' }, [h('p', { text: 'Moved here on ' + dateText(m.at) + ' from an upload that stopped playing. Everything the song had came with it.' }), b]));
		});
	}
	function menuItem(ctx, t) {
		if (!t || !lib0(ctx).tracks[t.id] || !reason(t)) return null;
		return { label: 'Find a working upload', icon: 'fix', desc: 'Another upload of this song takes its place', onSelect: function () { ctx.nav(songHref(ctx, t.id)); } };
	}

	return {
		KEY: KEY, STATE: STATE, PLACES: PLACES,
		reason: reason, reasonText: reasonText, unplayable: unplayable,
		songOf: songOf, queryOf: queryOf, copiesOf: copiesOf, poolOf: poolOf, poolIndex: poolIndex, fromPool: fromPool, demoUploads: demoUploads,
		candidates: candidates, whyWords: whyWords, lengthWords: lengthWords, summary: summary,
		swap: swap, unswap: unswap, saveSwap: saveSwap, saveUnswap: saveUnswap, moveInLists: moveInLists, unmoveInLists: unmoveInLists, mapRows: mapRows, restoreRows: restoreRows,
		mapHistory: mapHistory, seenListens: seenListens,
		view: view, fixNote: fixNote, trackNote: trackNote, menuItem: menuItem
	};
});
