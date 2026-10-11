// rescue: songs gone from YouTube, brought back. Which songs, the candidates and their
// order (match.js), the swap and its undo on a library built with library.js (every field
// that moves), a merge into a copy, idempotence and refusals, a chain of two moves, the
// import afterwards (upsert, reconcilePlaylist, yt.js importInto with a stub client), the
// hand-picked playlists and the history both ways, and the store writes.
module.exports = function (h) {
	var path = require('path');
	var L = require(path.join(h.HERE, 'library.js'));
	var R = require(path.join(h.HERE, 'rescue.js'));
	var M = require(path.join(h.HERE, 'match.js'));
	var Store = require(path.join(h.HERE, 'store.js'));
	var Y = require(path.join(h.HERE, 'yt.js'));

	var NOW = Date.UTC(2026, 9, 11, 12, 0, 0), DAY = 86400000;
	var OLD = 'deadVideo01', NEW = 'newUpload01', COPY = 'myCopyVid01', OTHER = 'otherSong01', SAME_ARTIST = 'emberField1';
	function iso(ms) { return new Date(ms).toISOString(); }
	function json(x) { return JSON.stringify(x); }
	// a library as JSON with its tracks in id order (a track put back comes last in lib.tracks)
	function canon(lib) { var o = JSON.parse(JSON.stringify(lib)), t = {}; Object.keys(o.tracks).sort().forEach(function (k) { t[k] = o.tracks[k]; }); o.tracks = t; return JSON.stringify(o); }
	function video(id, title, channel, more) {
		var v = { id: id, title: title, channel: channel, channelId: 'UC' + (channel.replace(/[^A-Za-z0-9]/g, '') + 'xxxxxxxxxxxxxxxxxxxxxx').slice(0, 22), durationSec: 222, publishedAt: '2019-03-01T00:00:00Z', embeddable: true, topics: [], year: null, live: false };
		for (var k in more) v[k] = more[k];
		return v;
	}
	function at(id, when) { var o = {}; o[id] = when; return o; }
	// A library: the dead upload (rated, played, labelled, corrected, tagged, in two
	// playlists), a copy of the same song, another song by the same artist, another artist.
	function build(opts) {
		opts = opts || {};
		var lib = L.create();
		['PL1', 'PL2', 'PL3'].forEach(function (p) { L.setPlaylist(lib, { id: p, title: 'List ' + p }); });
		L.upsert(lib, [video(OLD, 'Paper Lanterns - Blue Signal (Official Video)', 'PaperLanternsVEVO')], { playlistId: 'PL1', addedAt: at(OLD, '2021-05-01T00:00:00Z'), now: NOW - 400 * DAY });
		L.upsert(lib, [video(OLD, 'Paper Lanterns - Blue Signal (Official Video)', 'PaperLanternsVEVO')], { playlistId: 'PL2', addedAt: at(OLD, '2022-01-01T00:00:00Z'), now: NOW - 300 * DAY });
		L.upsert(lib, [video(OTHER, 'Glass Orchard - Winter Almanac (Official Video)', 'GlassOrchardVEVO', { durationSec: 250 })], { playlistId: 'PL1', now: NOW - 300 * DAY });
		L.upsert(lib, [video(SAME_ARTIST, 'Paper Lanterns - Ember Fields (Official Video)', 'PaperLanternsVEVO', { durationSec: 205 })], { playlistId: 'PL1', now: NOW - 300 * DAY });
		if (!opts.noCopy) {
			L.upsert(lib, [video(COPY, 'Paper Lanterns - Blue Signal', 'Paper Lanterns', { durationSec: 221 })], { playlistId: 'PL3', addedAt: at(COPY, '2023-02-02T00:00:00Z'), now: NOW - 200 * DAY });
			L.edit(lib, COPY, { rating: 2, blocked: true, tags: ['spare'], lang: 'en', at: NOW - 200 * DAY });
			L.recordPlay(lib, COPY, { at: NOW - 100 * DAY, completed: true });
			L.recordPlay(lib, COPY, { at: NOW - 90 * DAY, completed: true });
		}
		var t = lib.tracks[OLD];
		t.labels = { work: 'Starfall Odyssey', role: 'OP', scene: 'anime' };
		L.edit(lib, OLD, { rating: 5, tags: ['road'], year: 2019, mood: 'bright', at: NOW - 50 * DAY });
		[10, 9, 8].forEach(function (d) { L.recordPlay(lib, OLD, { at: NOW - d * DAY, completed: true }); });
		L.recordPlay(lib, OLD, { at: NOW - 7 * DAY, completed: false, listenedSec: 10 });
		L.markMissing(lib, [OLD], NOW - 2 * DAY);
		return lib;
	}
	var TOPIC = { videoId: NEW, title: 'Blue Signal', channel: 'Paper Lanterns - Topic', channelId: 'UCpaperlanternstopicxxxx', durationSec: 223 };
	var LYRICS = { videoId: 'lyricVideo1', title: 'Paper Lanterns - Blue Signal (Lyrics)', channel: 'lyric lantern', channelId: '', durationSec: 225 };
	var COVER = { videoId: 'coverVideo1', title: 'Blue Signal (Cover)', channel: 'Moth Choir', channelId: '', durationSec: 239 };
	var TVSIZE = { videoId: 'tvSizeVid01', title: 'Blue Signal (TV Size)', channel: 'Paper Lanterns - Topic', channelId: 'UCpaperlanternstopicxxxx', durationSec: 89 };
	var ELSE = { videoId: 'elseVideo01', title: 'Glass Orchard - Winter Almanac', channel: 'Glass Orchard', channelId: '', durationSec: 250 };
	function full(v, more) { var r = { id: v.videoId, title: v.title, channel: v.channel, channelId: v.channelId, durationSec: v.durationSec, publishedAt: '2024-01-01T00:00:00Z', embeddable: true, topics: [], year: 2019, live: false, categoryId: '10' }; for (var k in more) r[k] = more[k]; return r; }
	function ids(list) { return list.map(function (c) { return c.video.videoId; }); }

	h.describe('rescue', async function () {
		// ---- which songs ----
		var lib = build();
		h.eq([R.reason(lib.tracks[OTHER]), R.reason(lib.tracks[OLD])], ['', 'gone'], 'reason: a song that plays has none; one YouTube no longer returns is gone');
		var x = build();
		x.tracks[OLD].removed = false; x.tracks[OLD].removedReason = '';
		L.markUnplayable(x, OTHER, 100, NOW); L.markUnplayable(x, SAME_ARTIST, 150, NOW); L.markUnplayable(x, OLD, 5, NOW);
		h.eq([R.reason(x.tracks[OTHER]), R.reason(x.tracks[SAME_ARTIST]), R.reason(x.tracks[OLD])], ['private', 'blocked', 'error'], 'reason: the player\'s 100 is private, 150 blocked, another code an error');
		h.eq([R.reasonText(x.tracks[OLD]), R.reasonText(x.tracks[SAME_ARTIST]), R.reasonText(lib.tracks[COPY])], ['the player refused it (error 5)', 'not allowed on other sites', ''], 'reasonText: in words, the error\'s code with it');
		h.eq(R.unplayable(x.tracks).map(function (t) { return t.id; }), [OLD, SAME_ARTIST, OTHER], 'unplayable: the rated one first, then by plays, then by title; the ones that play left out');
		h.eq(R.unplayable([]), [], 'unplayable: an empty library has none');

		// ---- candidates ----
		var t = lib.tracks[OLD];
		h.eq(R.queryOf(t), 'Paper Lanterns Blue Signal', 'queryOf: the artist and the base title');
		h.eq(R.songOf(t).key + '|' + (R.songOf(t).videoId || ''), 'rescue:' + OLD + '|', 'songOf: the song without its video (its own upload is no evidence)');
		var list = [TOPIC, LYRICS, COVER, TVSIZE, ELSE, { videoId: OLD, title: 'Paper Lanterns - Blue Signal (Official Video)', channel: 'PaperLanternsVEVO', durationSec: 222 }].map(function (v) { return { video: v, source: 'pool' }; });
		var c = R.candidates(t, list);
		h.eq(ids(c), [NEW, 'lyricVideo1', 'tvSizeVid01'], 'candidates: the Topic upload first, then the lyrics video (the whole song) before the TV size (another cut); the cover, another song and the dead upload itself left out');
		h.eq(c.map(function (x2) { return [x2.sure, x2.same]; }), [[true, true], [false, true], [false, true]], 'candidates: only the same recording at STRONG is sure');
		h.ok(c[0].score >= M.STRONG && c[0].fit >= M.MIN_VIDEO && c[0].gap === 1, 'candidates: the sure one has its sameSong score, its upload score and the length gap (' + c[0].score + ', ' + c[0].fit + ', ' + c[0].gap + ')');
		var kept = R.candidates(t, list.map(function (y) { return { video: y.video, source: 'search', keep: true }; }));
		h.eq(ids(kept).slice(-2).sort(), ['coverVideo1', 'elseVideo01'], 'candidates: a search result is shown even when unlikely (keep), last');
		h.ok(ids(kept).indexOf(OLD) < 0, 'candidates: never the dead upload, even from a search');
		h.eq(kept.filter(function (y) { return y.video.videoId === 'coverVideo1'; })[0].same, false, 'candidates: the cover is not the same song');
		var ix = M.index(L.list(lib));
		var copies = R.copiesOf(ix, t);
		h.ok(ids(copies).indexOf(COPY) >= 0 && ids(copies).indexOf(OLD) < 0, 'copiesOf: the library\'s other copy, never the dead one');
		var both = R.candidates(t, copies.concat(list));
		h.eq(ids(both).slice(0, 2), [COPY, NEW], 'candidates: a sure copy in the library comes before a sure upload (merging keeps one copy)');
		h.ok(ids(both).indexOf(SAME_ARTIST) < 0 && both[0].track === lib.tracks[COPY], 'candidates: another song by the same artist is left out; a copy carries its track');
		x = build();
		L.markUnplayable(x, COPY, 150, NOW);
		h.ok(ids(R.copiesOf(M.index(L.list(x)), x.tracks[OLD])).indexOf(COPY) < 0, 'copiesOf: a copy that cannot play either is no candidate');
		var w = R.whyWords(c[0].why), wl = R.whyWords(c[1].why);
		h.ok(w.good.indexOf('same title') >= 0 && w.good.indexOf('same artist') >= 0 && w.good.some(function (s) { return /Topic channel/.test(s); }) && !w.bad.length, 'whyWords: the Topic upload: same title, same artist, the Topic channel, nothing against');
		h.ok(wl.bad.indexOf('a lyrics video') >= 0, 'whyWords: the lyrics video says so');
		h.eq([R.lengthWords(223, 222), R.lengthWords(222, 222), R.lengthWords(210, 222), R.lengthWords(300, 222), R.lengthWords(200, 0), R.lengthWords(0, 222)],
			['3:43, 1 s longer', '3:42, the same length', '3:30, 12 s shorter', '5:00, 1:18 longer', '3:20', 'length unknown'], 'lengthWords: against the old length');

		// the pool: what the sources cache holds
		var rows = [
			{ key: 'yt:q:video-any:paper lanterns blue signal', value: { max: 10, items: [{ videoId: NEW, title: 'Blue Signal', channel: 'Paper Lanterns - Topic', channelId: TOPIC.channelId }, { videoId: 'lyricVideo1', title: LYRICS.title, channel: LYRICS.channel }] } },
			{ key: 'yt:q:playlist:paper lanterns', value: { max: 5, items: [{ playlistId: 'PLxyz', title: 'Blue Signal' }] } },
			{ key: 'yt:list:UUabc', value: { items: [{ videoId: 'elseVideo01', title: ELSE.title, channel: ELSE.channel }, { videoId: 'not-an-id', title: 'Blue Signal' }], next: null } },
			{ key: 'yt:v:' + NEW, value: { id: NEW, title: 'Blue Signal', channel: 'Paper Lanterns - Topic', durationSec: 223, embeddable: true } },
			{ key: 'yt:v:blockedVid1', value: { id: 'blockedVid1', title: 'Blue Signal', channel: 'Paper Lanterns - Topic', durationSec: 222, embeddable: false } },
			{ key: 'yt:mix:' + OTHER, value: [{ videoId: 'mixVideo001', title: 'Paper Lanterns - Blue Signal (Live at Red Hollow)', channel: 'Red Hollow Sessions' }] },
			{ key: 'oe:goneVideo01', value: { id: 'goneVideo01', ok: false, reason: 'not-found' } },
			{ key: 'oe:oembedVid1', value: { id: 'oembedVid1x', ok: true, title: 'Blue Signal', channel: 'Paper Lanterns' } },
			{ key: 'yt:res:x', value: { videoId: 'resVideo001' } }
		];
		var pool = R.poolOf(rows);
		h.eq(pool.map(function (v) { return v.videoId; }).sort(), [NEW, 'elseVideo01', 'lyricVideo1', 'mixVideo001', 'oembedVid1x'].sort(), 'poolOf: searches, lists, Mixes, details and oEmbed; playlists, bad ids, a video that cannot be embedded and a gone one left out');
		h.eq(pool.filter(function (v) { return v.videoId === NEW; })[0].durationSec, 223, 'poolOf: the length from the video details joins the search\'s record');
		var found = R.fromPool(R.poolIndex(pool), t);
		h.ok(ids(found).indexOf(NEW) >= 0 && ids(found).indexOf('lyricVideo1') >= 0 && ids(found).indexOf('elseVideo01') < 0, 'fromPool: the uploads sharing a title key with the song, not the others');
		h.eq(R.fromPool(null, t), [], 'fromPool: no pool, nothing');

		// the demo's invented uploads
		var d = R.demoUploads(t), dc = R.candidates(t, d.map(function (v) { return { video: v, source: 'demo', keep: true }; }));
		h.eq([d.length, d[0].channel, dc[0].video.videoId === d[0].videoId, dc[0].sure, dc[dc.length - 1].same], [3, 'Paper Lanterns - Topic', true, true, false], 'demoUploads: a sure Topic upload first, the cover last and not the same song');
		h.eq(R.demoUploads(t)[1].videoId, d[1].videoId, 'demoUploads: the same every time');

		// ---- the swap: a new upload ----
		lib = build();
		var before = json(lib.tracks[OLD]), oldT = JSON.parse(before), count = Object.keys(lib.tracks).length;
		var r = R.swap(lib, OLD, full(TOPIC), { now: NOW });
		var n = lib.tracks[NEW];
		h.eq([r.ok, r.created, r.oldId, r.newId, r.ids, r.drop], [true, true, OLD, NEW, [NEW], [OLD]], 'swap: a new upload is created, the old one goes');
		h.eq([!!lib.tracks[OLD], lib.moved[OLD].to, lib.moved[OLD].at, Object.keys(lib.tracks).length], [false, NEW, iso(NOW), count], 'swap: the old id is in lib.moved, its track out of lib.tracks');
		h.eq(R.STATE.concat(R.PLACES).map(function (k) { return json(n[k]); }), R.STATE.concat(R.PLACES).map(function (k) { return json(oldT[k]); }), 'swap: the rating, plays, skips, last play, block, tags, corrections, labels, stamp, playlists and dates added all moved');
		h.eq([n.rating, n.plays, n.skips, n.playlists, n.addedAt.PL1, n.addedAt.PL2], [5, 3, 1, ['PL1', 'PL2'], '2021-05-01T00:00:00Z', '2022-01-01T00:00:00Z'], 'swap: 5 stars, 3 plays and a skip, both playlists with their own dates');
		h.eq([n.year, n.yearSource, n.mood, n.work, n.role, n.scene, n.artist, n.title], [2019, 'edit', 'bright', 'Starfall Odyssey', 'OP', 'anime', 'Paper Lanterns', 'Blue Signal'], 'swap: derived again: the corrections and labels read on the new upload');
		h.eq([L.playable(n), n.channel, n.durationSec, n.removed, !!n.fetchedAt], [true, 'Paper Lanterns - Topic', 223, false, true], 'swap: the new track is the new upload as YouTube describes it, and it plays');
		h.eq(json(r.record.old), before, 'swap: the record keeps the old track whole');
		h.eq([r.record.v, r.record.to, r.record.created, r.record.before, r.record.after.plays], [1, NEW, true, null, 3], 'swap: the record says where it went and what the new track had after');
		h.eq(L.movedTo(lib, OLD), NEW, 'movedTo: the upload it moved to');
		h.eq([L.movedTo(lib, NEW), L.movedTo(L.create(), OLD), L.movedTo({ tracks: {} }, OLD)], ['', '', ''], 'movedTo: \'\' for an upload that never moved, and for a library without moves');

		// idempotence and refusals
		var snap = json(lib);
		h.eq(R.swap(lib, OLD, full(TOPIC), { now: NOW + 1 }), { ok: false, reason: 'moved' }, 'swap again: refused, it moved already');
		h.eq(json(lib), snap, 'swap again: nothing changed');
		x = build();
		var xs = json(x);
		h.eq([R.swap(x, OLD, { id: OLD }).reason, R.swap(x, OLD, null).reason, R.swap(x, 'nopeNope123', full(TOPIC)).reason, R.swap(x, OLD, full(TOPIC, { embeddable: false })).reason], ['same', 'no-video', 'no-track', 'unplayable'], 'swap: refuses the same upload, no upload, an unknown song, an upload that cannot be embedded');
		L.markUnplayable(x, COPY, 150, NOW);
		xs = json(x);
		h.eq(R.swap(x, OLD, { id: COPY }).reason, 'unplayable', 'swap: refuses a copy that cannot play either');
		h.eq(json(x), xs, 'swap: a refusal changes nothing');

		// partial records (oEmbed only) are read again at the next refresh
		x = build();
		R.swap(x, OLD, { id: NEW, title: 'Blue Signal', channel: 'Paper Lanterns - Topic', embeddable: true, partial: true }, { now: NOW });
		h.eq([x.tracks[NEW].fetchedAt, L.stale(x, NOW, 30).indexOf(NEW) >= 0, x.tracks[NEW].durationSec], [null, true, 0], 'swap: an upload known only from oEmbed has no fetchedAt, so the next refresh reads it in full');

		// ---- undo of a new upload ----
		x = build();
		var xb = canon(x), rx = R.swap(x, OLD, full(TOPIC), { now: NOW });
		var u = R.unswap(x, rx.record);
		h.eq([u.ok, u.ids, u.drop, !!x.tracks[NEW], !!x.moved[OLD]], [true, [OLD], [NEW], false, false], 'unswap: the new upload leaves, the old one is back, lib.moved forgets it');
		h.eq(canon(x), xb, 'swap then unswap: the library exactly as it was');
		h.eq(R.unswap(x, rx.record), { ok: false, reason: 'back' }, 'unswap again: refused, the old upload is back');
		// after more listening the song goes back with everything it has now
		x = build();
		rx = R.swap(x, OLD, full(TOPIC), { now: NOW });
		L.recordPlay(x, NEW, { at: NOW + DAY, completed: true });
		L.edit(x, NEW, { rating: 4, at: NOW + DAY });
		R.unswap(x, rx.record);
		h.eq([x.tracks[OLD].plays, x.tracks[OLD].rating, x.tracks[OLD].lastPlayed, x.tracks[OLD].removed, x.tracks[OLD].playlists], [4, 4, iso(NOW + DAY), true, ['PL1', 'PL2']], 'unswap: the song goes back with its plays and rating since; the old upload is still gone from YouTube');

		// ---- a merge into a copy the library has ----
		x = build();
		var copyBefore = JSON.parse(json(x.tracks[COPY])), oldBefore = json(x.tracks[OLD]);
		count = Object.keys(x.tracks).length;
		var rm = R.swap(x, OLD, { id: COPY }, { now: NOW });
		var cp = x.tracks[COPY];
		h.eq([rm.ok, rm.created, rm.newId, Object.keys(x.tracks).length], [true, false, COPY, count - 1], 'merge: into the copy, no second copy is made');
		h.eq([cp.rating, cp.plays, cp.skips, cp.lastPlayed], [5, 5, 1, iso(NOW - 8 * DAY)], 'merge: the higher rating, plays and skips added, the later last play');
		h.eq([cp.blocked, cp.tags, cp.playlists, cp.addedAt.PL1, cp.addedAt.PL3], [false, ['spare', 'road'], ['PL3', 'PL1', 'PL2'], '2021-05-01T00:00:00Z', '2023-02-02T00:00:00Z'], 'merge: the old song\'s block (the copy was blocked as a duplicate), tags and playlists joined with their dates');
		h.eq([cp.userEdits.lang, cp.userEdits.year, cp.userEdits.mood, cp.labels.work, cp.lang, cp.year, cp.work], ['en', 2019, 'bright', 'Starfall Odyssey', 'en', 2019, 'Starfall Odyssey'], 'merge: the copy\'s own correction kept, the old song\'s fill the gaps, derived again');
		h.eq(cp.stateAt, iso(NOW), 'merge: a rating that changed is stamped for the sync');
		h.eq(json(rm.record.before), json(R.STATE.concat(R.PLACES).reduce(function (o, k) { o[k] = copyBefore[k]; return o; }, {})), 'merge: the record keeps what the copy had before');
		// labels on both: the copy's win, the old song's fill the rest; an earlier date wins
		x = build();
		x.tracks[COPY].labels = { work: 'Another Work' };
		x.tracks[COPY].addedAt.PL1 = '2020-01-01T00:00:00Z';
		x.tracks[COPY].playlists.push('PL1');
		R.swap(x, OLD, { id: COPY }, { now: NOW });
		h.eq([x.tracks[COPY].labels.work, x.tracks[COPY].labels.role, x.tracks[COPY].addedAt.PL1, x.tracks[COPY].playlists], ['Another Work', 'OP', '2020-01-01T00:00:00Z', ['PL3', 'PL1', 'PL2']], 'merge: the copy\'s own label kept, the old ones fill the gaps; a playlist keeps its earlier date');
		// undo of a merge, after the copy was played again
		x = build();
		copyBefore = json(x.tracks[COPY]);
		oldBefore = json(x.tracks[OLD]);
		rm = R.swap(x, OLD, { id: COPY }, { now: NOW });
		h.eq(R.unswap(x, rm.record).ids, [OLD, COPY], 'unswap of a merge: both tracks are written');
		h.eq([json(x.tracks[OLD]), json(x.tracks[COPY]), !!x.moved[OLD]], [oldBefore, copyBefore, false], 'unswap of a merge right away: both exactly as they were');
		x = build();
		rm = R.swap(x, OLD, { id: COPY }, { now: NOW });
		L.recordPlay(x, COPY, { at: NOW + DAY, completed: true });
		L.edit(x, COPY, { tags: ['spare', 'road', 'new'] });
		R.unswap(x, rm.record);
		h.eq([x.tracks[COPY].plays, x.tracks[COPY].rating, x.tracks[COPY].blocked, x.tracks[COPY].tags, x.tracks[COPY].lastPlayed, x.tracks[COPY].playlists], [3, 2, true, ['spare', 'road', 'new'], iso(NOW + DAY), ['PL3']], 'unswap of a merge later: the copy keeps the play and the tags of since, the rest as it was');
		h.eq(json(x.tracks[OLD]), oldBefore, 'unswap of a merge later: the old track exactly as it was');

		// ---- a chain: the new upload dies too ----
		x = build({ noCopy: true });
		var r1 = R.swap(x, OLD, full(TOPIC), { now: NOW });
		L.markMissing(x, [NEW], NOW + DAY);
		h.eq(R.swap(x, 'lyricVideo1', { id: NEW }).reason, 'no-track', 'chain: a song not in the library cannot be moved');
		var r2 = R.swap(x, NEW, full(LYRICS), { now: NOW + 2 * DAY });
		h.eq([r2.ok, L.movedTo(x, OLD), L.movedTo(x, NEW), x.tracks['lyricVideo1'].plays], [true, 'lyricVideo1', 'lyricVideo1', 3], 'chain: the song moves on; the first id follows both moves');
		h.eq(R.swap(x, OTHER, { id: NEW }).reason, 'replaced', 'chain: an upload that was itself replaced is no target');
		var hrows = [{ id: OLD, at: 1 }, { id: OTHER, at: 2 }, { id: NEW, at: 3 }];
		var m1 = R.mapRows(hrows, x);
		h.eq([m1.length, hrows.map(function (y) { return y.id; })], [2, ['lyricVideo1', OTHER, 'lyricVideo1']], 'mapRows: listens of both moved ids read as the upload that plays now');
		h.eq(R.unswap(x, r1.record), { ok: false, reason: 'gone' }, 'chain: the first move cannot be put back while the song has moved on');
		h.ok(R.unswap(x, r2.record).ok, 'chain: the later move is put back first');
		R.restoreRows(m1, x);
		h.eq(hrows.map(function (y) { return y.id; }), [NEW, OTHER, NEW], 'restoreRows: the listens read through the moves that are left');
		h.ok(R.unswap(x, r1.record).ok && !x.moved[OLD] && !x.moved[NEW], 'chain: then the first, and nothing is moved any more');
		R.restoreRows(m1, x);
		h.eq(hrows.map(function (y) { return y.id; }), [OLD, OTHER, NEW], 'restoreRows: every listen under the video that played');

		// ---- the history ----
		x = build();
		var hist = [{ id: OLD, at: 10, kind: 'play' }, { id: OTHER, at: 20, kind: 'play' }, { id: OLD, at: 30, kind: 'skip' }];
		h.eq(R.mapRows(hist, x), [], 'mapRows: nothing moved, nothing read differently');
		rx = R.swap(x, OLD, full(TOPIC), { now: NOW });
		var mm = R.mapRows(hist, x);
		h.eq([mm.length, mm[0].from, hist.map(function (y) { return y.id; })], [2, OLD, [NEW, OTHER, NEW]], 'mapRows: the old upload\'s listens read as the new one\'s');
		h.eq(R.mapRows(hist, x), [], 'mapRows: twice changes nothing more');
		h.eq(R.mapHistory(hist, x), 0, 'mapHistory: rows read already stay');
		hist.forEach(function (y) { if (y.id === NEW) y.id = OLD; });
		h.eq(R.mapHistory(hist, x), 2, 'mapHistory: the page\'s history read through lib.moved');
		var have = {};
		R.seenListens(have);
		h.eq(Object.keys(have).sort(), [OLD + '@10', OLD + '@30'], 'seenListens: the Desk\'s copies of those listens under the old id are known');
		R.unswap(x, rx.record);
		R.restoreRows(mm, x);
		h.eq(hist.map(function (y) { return y.id; }), [OLD, OTHER, OLD], 'restoreRows after an undo: the listens are the old upload\'s again');

		// ---- hand-picked playlists ----
		var lists = [{ id: 'a', kind: 'manual', ids: ['x1', OLD, 'y1'] }, { id: 'b', kind: 'manual', ids: [OLD, NEW] }, { id: 'c', kind: 'smart', patch: { works: ['Starfall Odyssey'] } }, { id: 'd', kind: 'manual', ids: ['x1'] }];
		var listsBefore = json(lists);
		var places = R.moveInLists(lists, OLD, NEW);
		h.eq([lists[0].ids, lists[1].ids, places], [['x1', NEW, 'y1'], [NEW], [{ id: 'a', at: 1, had: false }, { id: 'b', at: 0, had: true }]], 'moveInLists: the new id in the old one\'s place, or the old one leaves where the new one is; smart playlists and others untouched');
		h.eq(R.unmoveInLists(lists, OLD, NEW, places), 2, 'unmoveInLists: two playlists changed back');
		h.eq(json(lists), listsBefore, 'moveInLists then unmoveInLists: as they were');
		h.eq([R.moveInLists(null, OLD, NEW), R.unmoveInLists(lists, OLD, NEW, null)], [[], 0], 'no playlists, nothing to do');

		// ---- what moves, in words ----
		h.eq(R.summary(build().tracks[OLD], 1, 4), ['3 plays', '1 skip', 'a rating of 5 (liked)', 'its labels', 'your corrections', '1 tag', '3 playlists', '4 listens in the history'], 'summary: what moves, in words');
		h.eq(R.summary(L.load({ tracks: [{ id: 'q' }] }).tracks.q, 0, 0), [], 'summary: a song with nothing to move');

		// ---- the meta keeps lib.moved ----
		x = build();
		R.swap(x, OLD, full(TOPIC), { now: NOW });
		var back = L.fromParts(JSON.parse(json(L.toParts(x))));
		h.eq([back.moved, L.movedTo(back, OLD), json(L.meta(x).moved)], [{ deadVideo01: { to: NEW, at: iso(NOW) } }, NEW, json(x.moved)], 'toParts and fromParts keep lib.moved');
		h.eq([L.create().moved, L.load({}).moved, L.load({ moved: { a: { at: 1 }, b: null } }).moved], [{}, {}, {}], 'lib.moved: empty in a new library, and a broken entry is dropped');
		// ---- an import afterwards ----
		lib = build({ noCopy: true });
		R.swap(lib, OLD, full(TOPIC), { now: NOW });
		var res = L.upsert(lib, [video(OLD, 'Paper Lanterns - Blue Signal (Official Video)', 'PaperLanternsVEVO', { embeddable: false })], { playlistId: 'PL1', now: NOW + DAY });
		h.eq([res.added, res.updated, !!lib.tracks[OLD]], [[], [], false], 'upsert: the old id YouTube lists again is not brought back');
		var rec = L.reconcilePlaylist(lib, 'PL1', [OLD, OTHER, SAME_ARTIST]);
		h.eq([rec.changed, lib.tracks[NEW].playlists], [[], ['PL1', 'PL2']], 'reconcilePlaylist: a playlist that still lists the old id keeps the new upload');
		rec = L.reconcilePlaylist(lib, 'PL2', []);
		h.eq([rec.changed, lib.tracks[NEW].playlists], [[NEW], ['PL1']], 'reconcilePlaylist: one that no longer lists it lets the new upload go');

		// yt.js importInto with a stub client: the playlist lists the old id (still on YouTube, not embeddable) and a new song
		lib = build({ noCopy: true });
		R.swap(lib, OLD, full(TOPIC), { now: NOW });
		var store = Store.memory();
		await store.putTracks(L.list(lib));
		await store.saveLibraryMeta(L.meta(lib));
		var asked = [];
		var client = {
			quota: function () { return { units: 0 }; },
			playlistPage: function () { return Promise.resolve({ items: [{ videoId: OLD, addedAt: '2021-05-01T00:00:00Z' }, { videoId: 'freshSong01', addedAt: '2026-10-01T00:00:00Z' }, { videoId: OTHER, addedAt: '2021-01-01T00:00:00Z' }, { videoId: SAME_ARTIST, addedAt: '2021-01-01T00:00:00Z' }], nextPageToken: null, total: 4 }); },
			videoBatch: function (vids) {
				asked = asked.concat(vids);
				return Promise.resolve({ videos: vids.map(function (id) { return id === OLD ? video(OLD, 'Paper Lanterns - Blue Signal (Official Video)', 'PaperLanternsVEVO', { embeddable: false }) : id === 'freshSong01' ? video(id, 'Glass Orchard - Paper Moon', 'GlassOrchardVEVO') : video(id, lib.tracks[id].raw.title, lib.tracks[id].raw.channel, { durationSec: lib.tracks[id].durationSec }); }), missing: [] });
			}
		};
		var sum = await Y.importInto({ client: client, lib: lib, store: store, playlist: { id: 'PL1', title: 'List PL1' }, now: function () { return NOW + 2 * DAY; }, freshDays: 0 });
		var stored = L.fromParts(await store.loadLibrary());
		h.ok(asked.indexOf(OLD) >= 0, 'importInto: YouTube was asked about the old id (it is listed)');
		h.eq([!!lib.tracks[OLD], !!stored.tracks[OLD], sum.added, !!lib.tracks.freshSong01], [false, false, ['freshSong01'], true], 'importInto: the old id is neither added nor written; the playlist\'s new song is');
		h.eq([lib.tracks[NEW].playlists.indexOf('PL1') >= 0, stored.tracks[NEW].playlists.indexOf('PL1') >= 0, L.movedTo(stored, OLD)], [true, true, NEW], 'importInto: the new upload stays in the playlist, in the store too');

		// ---- the store writes ----
		lib = build();
		store = Store.memory();
		await store.putTracks(L.list(lib));
		await store.saveLibraryMeta(L.meta(lib));
		before = JSON.parse(JSON.stringify(lib.tracks[OLD]));
		r = R.swap(lib, OLD, full(TOPIC), { now: NOW });
		var calls = [], real = store, logged = {
			set: function (k, v) { calls.push('set ' + k + (v == null ? ' (removed)' : '')); return real.set(k, v); },
			putTracks: function (ts) { calls.push('putTracks ' + ts.map(function (y) { return y.id; }).join(',')); return real.putTracks(ts); },
			saveLibraryMeta: function (m) { calls.push('saveLibraryMeta'); return real.saveLibraryMeta(m); },
			deleteTracks: function (vids) { calls.push('deleteTracks ' + vids.join(',')); return real.deleteTracks(vids); },
			get: function (k, f) { return real.get(k, f); }
		};
		await R.saveSwap(logged, lib, r);
		h.eq(calls, ['set ' + R.KEY + OLD, 'putTracks ' + NEW, 'saveLibraryMeta', 'deleteTracks ' + OLD], 'saveSwap: the record first, then the new track and the meta, the old track last');
		var got = L.fromParts(await store.loadLibrary());
		h.eq([!!got.tracks[OLD], got.tracks[NEW].plays, got.tracks[NEW].rating, L.movedTo(got, OLD)], [false, 3, 5, NEW], 'saveSwap: a reload finds the new upload with the song, and the move');
		var stash = await store.get(R.KEY + OLD, null);
		h.eq([JSON.stringify(stash.old), stash.to], [JSON.stringify(before), NEW], 'saveSwap: the store keeps the old track whole');
		u = R.unswap(got, stash);
		calls = [];
		await R.saveUnswap(logged, got, OLD, u);
		h.eq(calls, ['putTracks ' + OLD, 'saveLibraryMeta', 'deleteTracks ' + NEW, 'set ' + R.KEY + OLD + ' (removed)'], 'saveUnswap: the tracks, the meta, the new upload\'s row, then the record');
		var again = L.fromParts(await store.loadLibrary());
		h.eq([!!again.tracks[NEW], again.tracks[OLD].plays, again.moved, await store.get(R.KEY + OLD, null)], [false, 3, {}, null], 'after a reload, put back: the old track as it was, no move, no record');
		h.eq(JSON.stringify(again.tracks[OLD]), JSON.stringify(before), 'put back after a reload: the old track exactly as before the swap');
		// a store that refuses the record: nothing is deleted
		lib = build();
		r = R.swap(lib, OLD, full(TOPIC), { now: NOW });
		var deleted = false, refusing = { set: function () { return Promise.reject(new Error('The browser refused to store this.')); }, putTracks: function () { return Promise.resolve(); }, saveLibraryMeta: function () { return Promise.resolve(); }, deleteTracks: function () { deleted = true; return Promise.resolve(); } };
		await h.rejects(R.saveSwap(refusing, lib, r), function (e) { return /refused/.test(e.message); }, 'saveSwap: a store that refuses the record rejects');
		h.ok(!deleted, 'saveSwap: and the old track is not deleted');

		// ---- the track menu ----
		lib = build();
		var ctx = { lib: function () { return lib; }, link: function () { return '#/' + Array.prototype.slice.call(arguments).map(encodeURIComponent).join('/'); }, nav: function (hash) { ctx.went = hash; } };
		var item = R.menuItem(ctx, lib.tracks[OLD]);
		h.eq([item && item.label, R.menuItem(ctx, lib.tracks[OTHER]), R.menuItem(ctx, null)], ['Find a working upload', null, null], 'menuItem: only for a song that cannot play');
		item.onSelect();
		h.eq(ctx.went, '#/rescue/' + OLD, 'menuItem: it opens the song\'s rescue page');
	});
};
