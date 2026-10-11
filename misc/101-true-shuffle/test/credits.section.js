/*
 * credits.js (who wrote a song, from MusicBrainz; a person's other songs; the
 * Explore lane) and scrobble.js (ListenBrainz, opt-in), against fakes that
 * answer in the shapes MusicBrainz and ListenBrainz were seen to answer on
 * 2026-10-11 (recording and work searches, lookups with relations,
 * submit-listens, validate-token). Every name and id here is invented; no
 * request leaves the process. Loaded by test.js as the section "credits".
 */
'use strict';
var path = require('path');

module.exports = function (h) {
	function cp() { return String.fromCharCode.apply(null, arguments); }
	function json(x) { return JSON.parse(JSON.stringify(x)); }
	function id(n) { return '00000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }

	// ---- Invented MusicBrainz data, shaped as its JSON ----
	var BAND_JA = cp(0x30DF, 0x30E9, 0x30A4, 0x30B3, 0x30A6, 0x30B5, 0x30C6, 0x30F3);   // the band's name in katakana
	var AOKI_JA = cp(0x9752, 0x6728, 0x7A7A), HOSHINO_JA = cp(0x661F, 0x91CE, 0x73B2);   // a composer and an arranger in kanji
	var A = {
		band: { id: id('a001'), name: BAND_JA, 'sort-name': 'Mirai Kousaten', type: 'Group', aliases: [{ name: 'Mirai Kousaten', 'sort-name': 'Mirai Kousaten', locale: 'en', type: 'Artist name', primary: true }] },
		trap: { id: id('a002'), name: 'Copper Wren', 'sort-name': 'Wren, Copper', type: 'Person' },
		aoki: { id: id('a003'), name: AOKI_JA, 'sort-name': 'Aoki, Sora', type: 'Person', country: 'JP', disambiguation: '' },
		june: { id: id('a004'), name: 'June Halloway', 'sort-name': 'Halloway, June', type: 'Person' },
		hoshino: { id: id('a005'), name: HOSHINO_JA, 'sort-name': 'Hoshino, Rei', type: 'Person' },
		teo: { id: id('a006'), name: 'Teo Marsh', 'sort-name': 'Marsh, Teo', type: 'Person' },
		lumen: { id: id('a007'), name: 'Lumen Parade', 'sort-name': 'Lumen Parade', type: 'Group' },
		kid: { id: id('a008'), name: 'Cover Kid', 'sort-name': 'Cover Kid', type: 'Person' }
	};
	function ac(a, joinphrase) { var x = { name: a.name, artist: { id: a.id, name: a.name, 'sort-name': a['sort-name'] } }; if (a.aliases) x.artist.aliases = a.aliases; if (joinphrase) x.joinphrase = joinphrase; return x; }
	function releases(n, first, title) {
		var out = [];
		for (var i = 0; i < n; i++) out.push({ id: id('e' + n + i), title: (title || 'Release') + ' ' + (i + 1), status: 'Official', date: String(+first.slice(0, 4) + i) + first.slice(4), 'release-group': { 'primary-type': 'Album' }, 'track-count': 10 });
		return out;
	}
	function rec(n, title, artist, ms, nRel, first, more) {
		var r = { id: id('b' + n), score: 100, title: title, length: ms, video: null, 'artist-credit': [ac(artist)], 'first-release-date': first, releases: releases(nRel, first, title) };
		Object.keys(more || {}).forEach(function (k) { r[k] = more[k]; });
		return r;
	}
	var R = {
		trap: rec(1, 'Glass Lullaby', A.trap, 254000, 9, '2009-01-01'),
		live: rec(2, 'Glass Lullaby', A.band, 281000, 1, '2019-05-04', { disambiguation: 'live, 2019-05-04' }),
		studio: rec(3, 'Glass Lullaby', A.band, 253000, 4, '2016-03-02'),
		tv: rec(4, 'Glass Lullaby (TV size)', A.band, 90000, 2, '2016-01-10'),
		video: rec(5, 'Glass Lullaby', A.band, 260000, 1, '2016-03-02', { video: true }),
		moonOrig: rec(22, 'Paper Moon Waltz', A.lumen, 201000, 3, '2012-06-01'),
		moonCover: rec(24, 'Paper Moon Waltz', A.kid, 199000, 1, '2021-02-02'),
		moonLive: rec(25, 'Paper Moon Waltz', A.lumen, 230000, 2, '2014-08-08', { disambiguation: 'live' }),
		harbor: rec(31, 'Harbor Lights at Dawn', A.band, 230000, 2, '2018-04-04'),
		emberA: rec(41, 'Quiet Ember', A.band, 200000, 5, '2015-01-01'),
		emberB: rec(42, 'Quiet Ember', A.band, 201000, 1, '2015-01-01')
	};
	function rel(type, artist, attrs, extra) { var r = { type: type, 'target-type': 'artist', direction: 'backward', attributes: attrs || [], 'target-credit': '', artist: artist }; Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; }); return r; }
	function perf(work, attrs) { return { type: 'performance', 'target-type': 'work', direction: 'forward', attributes: attrs || [], work: { id: work.id, title: work.title, type: 'Song', language: 'jpn' } }; }
	function perfRec(r) { return { type: 'performance', direction: 'backward', recording: { id: r.id, title: r.title, video: r.video } }; }
	var W = {
		glass: { id: id('c001'), title: 'Glass Lullaby' },
		medley: { id: id('c009'), title: 'Night Ferry Medley' },
		moon: { id: id('c002'), title: 'Paper Moon Waltz' },
		harbor: { id: id('c003'), title: 'Harbor Lights at Dawn' },
		steps: { id: id('c004'), title: 'Cinder Steps' },
		ember: { id: id('c041'), title: 'Quiet Ember' }
	};
	// Lookups: /recording/<id>?inc=work-rels+artist-rels and /work/<id>?inc=artist-rels.
	var LOOKUP = {};
	LOOKUP['/recording/' + R.studio.id] = { id: R.studio.id, title: 'Glass Lullaby', length: 253000, video: false, disambiguation: '', 'first-release-date': '2016-03-02', relations: [
		perf(W.medley, ['partial']),
		rel('arranger', A.hoshino),
		rel('instrument', A.teo, ['guitar']),
		rel('instrument', A.teo, ['electric guitar']),
		rel('vocal', A.band, ['lead vocals']),
		perf(W.glass)
	] };
	LOOKUP['/work/' + W.glass.id] = { id: W.glass.id, title: 'Glass Lullaby', type: 'Song', language: 'jpn', relations: [rel('composer', A.aoki), rel('lyricist', A.june), rel('arranger', A.hoshino)] };
	LOOKUP['/recording/' + R.emberA.id] = { id: R.emberA.id, title: 'Quiet Ember', relations: [rel('vocal', A.band, ['lead vocals'])] };
	LOOKUP['/recording/' + R.emberB.id] = { id: R.emberB.id, title: 'Quiet Ember', relations: [rel('vocal', A.band, ['lead vocals']), perf(W.ember)] };
	LOOKUP['/work/' + W.ember.id] = { id: W.ember.id, title: 'Quiet Ember', relations: [rel('writer', A.june)] };
	// Work searches: /work?query=arid:<id>, as MusicBrainz gives them (relations with every performance).
	var WORK_SEARCH = {};
	WORK_SEARCH[A.aoki.id] = { created: '2026-10-11T00:00:00.000Z', count: 4, offset: 0, works: [
		{ id: W.glass.id, score: 100, title: W.glass.title, type: 'Song', relations: [rel('composer', A.aoki), rel('lyricist', A.june), perfRec(R.studio), perfRec(R.live), perfRec(R.video)] },
		{ id: W.moon.id, score: 95, title: W.moon.title, type: 'Song', relations: [rel('composer', A.aoki), perfRec(rec(21, 'Paper Moon Waltz', A.lumen, 1, 1, '2012-06-01', { video: true })), perfRec(R.moonCover), perfRec(rec(23, 'Paper Moon Waltz (Instrumental)', A.lumen, 1, 1, '2012-06-01')), perfRec(R.moonOrig), perfRec(R.moonLive)] },
		{ id: W.harbor.id, score: 90, title: W.harbor.title, type: 'Song', relations: [rel('lyricist', A.aoki), perfRec(R.harbor)] },
		{ id: W.steps.id, score: 90, title: W.steps.title, type: null, relations: [rel('arranger', A.aoki), perfRec(R.emberA)] }
	] };
	var BY_ID = {};
	Object.keys(R).forEach(function (k) { BY_ID[R[k].id] = R[k]; });

	// A fake MusicBrainz: the routes credits.js asks, every call recorded with the clock.
	function mbFake(clock) {
		var f = { calls: [], busy: 0 };
		f.fetch = function (u, init) {
			var url = new URL(u), p = url.pathname.replace(/^\/ws\/2/, ''), q = url.searchParams.get('query') || '';
			f.calls.push({ url: u, path: p, query: q, inc: url.searchParams.get('inc'), init: json(init), at: clock.t });
			var status = 200, body;
			if (f.busy > 0) { f.busy--; status = 503; body = { error: 'The MusicBrainz web server is currently busy. Please try again later.' }; }
			else if (p === '/recording' && /^rid:\(/.test(q)) {
				var ids = q.slice(5, -1).split(' OR ');
				var recs = ids.map(function (i) { return BY_ID[i]; }).filter(Boolean);
				body = { created: '2026-10-11T00:00:00.000Z', count: recs.length, offset: 0, recordings: recs };
			} else if (p === '/recording') {
				var list = /Glass Lullaby/.test(q) ? [R.trap, R.live, R.studio, R.tv, R.video] : /Quiet Ember/.test(q) ? [R.emberA, R.emberB] : [];
				body = { created: '2026-10-11T00:00:00.000Z', count: list.length, offset: 0, recordings: list };
			} else if (p === '/work' && /^arid:/.test(q)) body = WORK_SEARCH[q.slice(5)] || { count: 0, offset: 0, works: [] };
			else if (LOOKUP[p]) body = LOOKUP[p];
			else { status = 404; body = { error: 'Not Found', help: 'For usage, please see: https://musicbrainz.org/development/mmd' }; }
			var text = JSON.stringify(body);
			return Promise.resolve({ status: status, ok: status < 300, headers: { get: function () { return null; } }, text: function () { return Promise.resolve(text); } });
		};
		return f;
	}
	// A clock whose sleep moves it on, so the line's gaps cost no time.
	function fakeClock(t) { var c = { t: t }; c.now = function () { return c.t; }; c.sleep = function (ms) { c.t += Math.max(0, ms); return Promise.resolve(); }; return c; }
	function tr(idv, title, artist, more) {
		var t = { id: idv, title: title, artist: artist, artistKey: artist.toLowerCase(), titleAlt: '', artistNative: '', version: '', durationSec: 0, kind: 'song', guess: { artist: '', title: '', rule: 'none', confidence: 0 } };
		Object.keys(more || {}).forEach(function (k) { t[k] = more[k]; });
		return t;
	}

	h.describe('credits', async function () {
		var C = require(path.join(h.HERE, 'credits.js'));
		var M = require(path.join(h.HERE, 'match.js'));
		var Src = require(path.join(h.HERE, 'sources.js'));
		var D = require(path.join(h.HERE, 'demo.js'));
		var SC = require(path.join(h.HERE, 'scrobble.js'));

		var T1 = tr('aaaaaaaaaa1', 'Glass Lullaby', 'Mirai Kousaten', { durationSec: 254 });
		var T2 = tr('aaaaaaaaaa2', 'Harbor Lights at Dawn', 'Mirai Kousaten', { durationSec: 231 });
		var T3 = tr('aaaaaaaaaa3', 'Paper Moon Waltz', 'Cover Kid', { durationSec: 199, version: 'cover' });
		var TRACKS = [T1, T2, T3];
		function rig(o) {
			o = o || {};
			var clock = fakeClock(Date.UTC(2026, 9, 11, 12)), mb = mbFake(clock);
			var cache = Src.createCache({ now: clock.now });
			var c = C.create({ fetch: mb.fetch, now: clock.now, sleep: clock.sleep, agent: o.agent !== false, cache: cache, index: function () { return M.index(TRACKS); } });
			return { c: c, mb: mb, clock: clock, cache: cache };
		}

		// ---- Reading the answers: pure parts ----
		h.eq([C.latinName(A.aoki), C.latinName(A.band), C.latinName(A.june), C.latinName({ name: 'Kiln Strings', 'sort-name': 'Strings, Kiln', type: 'Group' }), C.latinName({ name: AOKI_JA, 'sort-name': AOKI_JA })],
			['Sora Aoki', 'Mirai Kousaten', 'June Halloway', 'Kiln Strings', AOKI_JA], 'latinName: a kanji name read from its sort name ("Aoki, Sora" is Sora Aoki), a group\'s sort name as it is, a Latin name kept, no Latin form kept as it is');
		h.eq(C.creditText([ac(A.june, ' feat. '), ac(A.teo)]), 'June Halloway feat. Teo Marsh', 'creditText: an artist credit with its join phrase');
		h.eq(C.creditNames([ac(A.band)]), [BAND_JA, 'Mirai Kousaten'], 'creditNames: the name, its Latin form and the aliases, each once');
		var q = C.searchQuery(tr('x', 'Glass Lullaby (TV Size)', 'Mirai Kousaten & June Halloway', { titleAlt: 'Garasu no Komoriuta', artistNative: BAND_JA }), M);
		h.eq(q, '(recording:"Glass Lullaby" OR recording:"Garasu no Komoriuta") AND (artist:"Mirai Kousaten & June Halloway" OR artist:"' + BAND_JA + '" OR artist:"Mirai Kousaten" OR artist:"June Halloway")', 'searchQuery: the base titles (no TV size) and every name: the credit, the native name, each person of it');
		h.eq(C.searchQuery(tr('x', 'Say "Hi" \\ Bye', 'Copper Wren'), M), '(recording:"Say \\"Hi\\" \\\\ Bye") AND (artist:"Copper Wren")', 'searchQuery: quotes and backslashes are escaped inside the phrase');
		h.eq([C.searchQuery(tr('x', '', 'Copper Wren'), M), C.searchQuery(tr('x', 'Glass Lullaby', ''), M)], ['', ''], 'searchQuery: nothing to ask without a title or an artist');
		h.ok(C.keyOf(T1, M) !== C.keyOf(tr('y', 'Glass Lullaby', 'Mirai Kousaten', { version: 'live' }), M) && C.keyOf(T1, M) === C.keyOf(tr('z', 'Glass Lullaby (Official Video)', 'Mirai Kousaten'), M), 'keyOf: the same song from another upload shares the key; another version has its own');

		var cand = C.candidateOf(R.live, M);
		h.eq([cand.title, cand.artist, cand.durationSec, cand.version, cand.releases, cand.first], ['Glass Lullaby', BAND_JA, 281, 'live', 1, '2019-05-04'], 'candidateOf: a recording\'s title, credit, length, versions (from its disambiguation) and releases');
		h.eq(C.candidateOf(R.tv, M).version, 'tv-size', 'candidateOf: a version named in the title');

		// ---- The recording choice, and its trap ----
		var ranked = C.rankRecordings(T1, [R.trap, R.live, R.studio, R.tv, R.video], M);
		h.eq(ranked.map(function (x) { return x.rec.id; }), [R.studio.id, R.video.id, R.tv.id, R.live.id], 'rankRecordings: the same recording first (lengths within 4 s), a video after, then the other versions; read through the katakana name');
		h.ok(ranked.every(function (x) { return x.rec.id !== R.trap.id; }), 'rankRecordings: the trap: an equal title by another artist, of the same length and on the most releases, never passes');
		h.eq(C.rankRecordings(tr('t', 'Glass Lullaby', 'Copper Wren', { durationSec: 254 }), [R.trap, R.studio], M).map(function (x) { return x.rec.id; }), [R.trap.id], 'rankRecordings: Copper Wren\'s own song is theirs, and the band\'s is not');
		h.eq(C.rankRecordings(tr('t', 'Glass Lullaby', ''), [R.studio], M), [], 'rankRecordings: without an artist nothing is the song (the artist must be part of the evidence)');

		// ---- The relations ----
		h.eq(C.workOf(LOOKUP['/recording/' + R.studio.id]), { id: W.glass.id, title: 'Glass Lullaby', attributes: [] }, 'workOf: the whole performance, not the medley it is part of');
		h.eq(C.workOf({ relations: [perf(W.medley, ['partial'])] }).id, W.medley.id, 'workOf: a partial performance when it is the only one');
		h.eq(C.workOf({ relations: [] }), null, 'workOf: none');
		var rels = C.relationsOf(LOOKUP['/recording/' + R.studio.id], LOOKUP['/work/' + W.glass.id]);
		h.eq(rels, {
			composers: [{ id: A.aoki.id, name: 'Sora Aoki', native: AOKI_JA }],
			lyricists: [{ id: A.june.id, name: 'June Halloway', native: '' }],
			writers: [],
			arrangers: [{ id: A.hoshino.id, name: 'Rei Hoshino', native: HOSHINO_JA }],
			performers: [{ id: A.teo.id, name: 'Teo Marsh', native: '', roles: ['guitar', 'electric guitar'] }, { id: A.band.id, name: 'Mirai Kousaten', native: BAND_JA, roles: ['lead vocals'] }]
		}, 'relationsOf: composer and lyricist from the work, the arranger once (named on both), each performer once with every role');

		// ---- The line on the song's page ----
		var DOT = cp(0xB7);
		h.eq(C.line({ composers: rels.composers, lyricists: rels.lyricists, arrangers: rels.arrangers }), 'Music: Sora Aoki ' + DOT + ' Lyrics: June Halloway ' + DOT + ' Arranged by Rei Hoshino', 'line: music, lyrics, arranged by');
		h.eq(C.line({ composers: rels.composers, lyricists: rels.composers }), 'Music and lyrics: Sora Aoki', 'line: one person wrote both');
		h.eq(C.line({ writers: [{ id: 'w', name: 'June Halloway' }], arrangers: [] }), 'Written by June Halloway', 'line: MusicBrainz says only "writer"');
		h.eq(C.line({ composers: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] }), 'Music: A & B', 'line: two names');
		h.eq(C.line({ composers: [1, 2, 3, 4, 5].map(function (n) { return { id: n, name: 'P' + n }; }) }), 'Music: P1, P2, P3 and 2 more', 'line: five names, three shown');
		h.eq([C.line(null), C.line({ performers: rels.performers })], ['', ''], 'line: nothing to say');
		h.eq(C.personFor({ composers: [{ id: 'b', name: 'Mirai Kousaten' }], lyricists: [{ id: 'j', name: 'June Halloway' }] }, 'Mirai Kousaten', M).name, 'June Halloway', 'personFor: "More by" is not the song\'s own artist when someone else wrote it too');
		h.eq(C.personFor({ composers: [{ id: 'b', name: 'Mirai Kousaten' }] }, 'Mirai Kousaten', M).name, 'Mirai Kousaten', 'personFor: the artist when they wrote it alone');
		h.eq(C.personFor({ composers: [] }, 'X', M), null, 'personFor: nobody');

		// ---- of(): the requests, their manners, the cache ----
		var r1 = rig();
		var got = await r1.c.of(T1);
		h.eq(r1.mb.calls.map(function (c) { return c.path + (c.inc ? '?inc=' + c.inc : ''); }), ['/recording', '/recording/' + R.studio.id + '?inc=work-rels+artist-rels', '/work/' + W.glass.id + '?inc=artist-rels'], 'of: a search, the best recording with its relations, its work with its artists: three requests');
		h.eq(got.recording, { id: R.studio.id, title: 'Glass Lullaby', artist: BAND_JA, durationSec: 253 }, 'of: the studio recording');
		h.eq([got.work, got.composers, got.lyricists, got.arrangers.length, got.performers.length, got.sure], [{ id: W.glass.id, title: 'Glass Lullaby' }, rels.composers, rels.lyricists, 1, 2, true], 'of: the work, its composer and lyricist, the arranger and the performers; sure (title, artist and length)');
		h.eq(Object.keys(got), ['recording', 'work', 'composers', 'lyricists', 'writers', 'arrangers', 'performers', 'sure', 'score', 'why'], 'of: the result\'s shape');
		var gaps = r1.mb.calls.slice(1).map(function (c, i) { return c.at - r1.mb.calls[i].at; });
		h.ok(gaps.every(function (g) { return g >= 1100; }), 'of: one request at a time, at least 1.1 s apart (' + gaps.join(', ') + ' ms)');
		h.ok(r1.mb.calls.every(function (c) { return c.init.credentials === 'omit' && c.init.referrerPolicy === 'no-referrer' && c.init.headers.Accept === 'application/json' && c.init.headers['User-Agent'] === C.AGENT && Object.keys(c.init.headers).length === 2; }), 'of: no cookies, no referrer, JSON, our User-Agent, and no other header');
		h.ok(r1.mb.calls.every(function (c) { return c.url.indexOf('https://musicbrainz.org/ws/2/') === 0 && c.url.indexOf('aaaaaaaaaa1') < 0 && /fmt=json/.test(c.url); }), 'of: only MusicBrainz is asked, with names only (the video id is never sent)');
		h.ok(/^\(recording:"Glass Lullaby"\) AND \(artist:"Mirai Kousaten"\)$/.test(r1.mb.calls[0].query), 'of: the search is the artist and the title');
		var again = await r1.c.of(tr('other', 'Glass Lullaby [Official Audio]', 'Mirai Kousaten'));
		h.eq([r1.mb.calls.length, again.recording.id], [3, R.studio.id], 'of: kept: another upload of the song asks nothing');
		again.composers.push({ id: 'x', name: 'Mutant' });
		h.eq((await r1.c.of(T1)).composers.length, 1, 'of: callers get copies; changing one changes nothing kept');
		h.ok((await r1.cache.range('mb:credits:')).some(function (row) { return row.exp - r1.clock.t >= 29 * 86400000; }), 'of: kept 30 days in the cache it was given');
		h.eq(await r1.c.of(tr('n', 'Nothing Song', 'Nobody Here')), null, 'of: an unknown song is null');
		var n0 = r1.mb.calls.length;
		h.eq([await r1.c.of(tr('n', 'Nothing Song', 'Nobody Here')), r1.mb.calls.length - n0], [null, 0], 'of: "nothing" is kept too');
		h.eq(await r1.c.of(tr('n', 'Glass Lullaby', 'Somebody Else')), null, 'of: the same title by another artist is null, never their credits');
		h.eq([await r1.c.of(null), await r1.c.of(tr('n', 'Glass Lullaby', ''))], [null, null], 'of: no track, no artist: null, nothing asked');
		var r2 = rig({ agent: false });
		var ember = await r2.c.of(tr('e', 'Quiet Ember', 'Mirai Kousaten', { durationSec: 200 }));
		h.eq([r2.mb.calls.map(function (c) { return c.path; }), ember.recording.id, ember.writers.map(function (p) { return p.name; }), C.line(ember)], [['/recording', '/recording/' + R.emberA.id, '/recording/' + R.emberB.id, '/work/' + W.ember.id], R.emberB.id, ['June Halloway'], 'Written by June Halloway'], 'of: the best recording is linked to no work, so the next one is read');
		h.ok(r2.mb.calls.every(function (c) { return !('User-Agent' in c.init.headers); }), 'of: no User-Agent where the browser would not send one');
		var r3 = rig();
		r3.mb.busy = 1;
		var busy = await r3.c.of(T1);
		h.ok(busy && r3.mb.calls.length === 4 && r3.mb.calls[1].at - r3.mb.calls[0].at >= 4000, 'of: MusicBrainz is busy (503): the line waits 4 s and asks again');
		var ab = new AbortController();
		ab.abort();
		await h.rejects(rig().c.of(T1, { signal: ab.signal }), function (e) { return e.code === 'aborted'; }, 'of: a stopped signal stops it');
		var r4 = rig();
		r4.mb.busy = 9;
		await h.rejects(r4.c.of(T1), function (e) { return e.code === 'rate' && e.host === 'musicbrainz' && /MusicBrainz/.test(e.message); }, 'of: still busy after three tries: a SourceError that names MusicBrainz (lanes.js explains it)');

		// ---- byPerson: a person's other songs ----
		var works = C.worksOf(WORK_SEARCH[A.aoki.id], A.aoki.id, M);
		h.eq(works.map(function (w) { return [w.title, w.did, w.rids.length]; }), [['Glass Lullaby', ['composer'], 2], ['Paper Moon Waltz', ['composer'], 3], ['Harbor Lights at Dawn', ['lyricist'], 1]], 'worksOf: the works they wrote (not the one they only arranged), without videos or an instrumental');
		var many = [0, 1, 2].map(function (w) { var rids = []; for (var i = 0; i < 80; i++) rids.push('w' + w + 'r' + i); return { rids: rids }; });
		var qs = C.ridQueries(many);
		h.eq([qs.length, qs.map(function (x) { return x.split(' OR ').length; }), (qs[0] + qs[1]).match(/w2r/g).length], [2, [100, 100], 66], 'ridQueries: 100 recordings a search, two searches at most, the works taking turns');
		var r5 = rig();
		var finds = await r5.c.byPerson({ id: A.aoki.id, name: 'Sora Aoki' });
		h.eq(r5.mb.calls.map(function (c) { return c.path; }), ['/work', '/recording'], 'byPerson: a work search and one recording search: two requests');
		h.eq(finds.map(function (f) { return [f.title, f.artist, f.mine, f.why[0][1]]; }), [
			['Glass Lullaby', BAND_JA, T1.id, 'music by Sora Aoki'],
			['Paper Moon Waltz', 'Lumen Parade', null, 'music by Sora Aoki'],
			['Harbor Lights at Dawn', BAND_JA, T2.id, 'words by Sora Aoki']
		], 'byPerson: each work by its original performer (not the cover on one release), the library\'s own marked mine (not the library\'s cover of another\'s song)');
		var f0 = finds[1];
		h.eq([f0.key, f0.videoId, f0.source, f0.ids, f0.year, f0.durationSec, f0.album], ['mb:rec:' + R.moonOrig.id, null, 'musicbrainz', { mb: R.moonOrig.id, mbWork: W.moon.id }, 2012, 201, 'Paper Moon Waltz 1'], 'byPerson: finds in sources.js\'s shape: source musicbrainz, no video, the first release as album');
		h.ok(finds.every(function (f) { return Object.keys(Src.find({})).every(function (k) { return k in f; }); }), 'byPerson: every field of a find');
		var n5 = r5.mb.calls.length;
		await r5.c.byPerson({ id: A.aoki.id, name: 'Sora Aoki' });
		h.eq(r5.mb.calls.length - n5, 0, 'byPerson: kept 30 days');
		h.eq(await r5.c.byPerson({ id: 'not-an-mbid', name: 'X' }), [], 'byPerson: no MusicBrainz id, nothing asked');
		var orig = json(finds);
		C.markMine(finds, M.index([]), M);
		h.eq(finds, orig, 'markMine: the finds given are left as they were');

		// ---- The lane ----
		var r6 = rig();
		var seed = { kind: 'track', id: T1.id, track: T1, find: null, videoId: T1.id, title: T1.title, artist: T1.artist, native: '', titleAlt: '', durationSec: 254 };
		var spec = C.lane({ demo: false, lib: function () { return { tracks: {} }; } }, seed, { credits: r6.c });
		h.eq([spec.id, spec.badge, spec.layout, spec.unavailable(), spec.title(null)], ['credits', ['ext', 'MusicBrainz'], 'cards', null, 'More by its composer'], 'lane: a lanes.js spec, MusicBrainz\'s badge, cards');
		var data = await spec.load(null);
		h.eq([spec.title(data), data.sub, data.items.map(function (f) { return f.title; }), data.person.id], ['More by Sora Aoki', 'Music: Sora Aoki ' + DOT + ' Lyrics: June Halloway ' + DOT + ' Arranged by Rei Hoshino', ['Paper Moon Waltz', 'Harbor Lights at Dawn'], A.aoki.id], 'lane: "More by Sora Aoki", the credits as its line, the song itself left out');
		var compact = C.lane({ demo: false }, seed, { compact: true, credits: r6.c });
		h.eq([compact.layout, compact.limit], ['rows', 3], 'lane: three rows in the now-playing panel');
		h.eq(C.lane({ demo: false }, { kind: 'artist', title: 'X', artist: 'X' }, {}).unavailable().text, 'This song has no sure artist and title to look up.', 'lane: unavailable for an artist page or a song without an artist');
		h.eq([spec.empty(null), spec.empty({ credits: {}, person: null }), spec.empty({ person: { name: 'June Halloway' } })], ['MusicBrainz does not know this song yet.', 'MusicBrainz knows this song but not who wrote it.', 'MusicBrainz has no other songs by June Halloway.'], 'lane: why it is empty, in words');

		// ---- The demo: invented, asks nothing ----
		var demo = D.build(Date.UTC(2026, 9, 11));
		var dt = Object.keys(demo.lib.tracks).map(function (k) { return demo.lib.tracks[k]; }).filter(function (t) { return t.artist && t.title; })[0];
		var dc = C.demoCredits(dt, M);
		h.eq(Object.keys(dc).filter(function (k) { return k !== 'demo'; }), Object.keys(got), 'demo: credits shaped as the real ones');
		h.eq(C.demoCredits(dt, M), dc, 'demo: the same every time');
		var dctx = { demo: true, lib: function () { return demo.lib; } };
		var dspec = C.lane(dctx, { kind: 'track', id: dt.id, track: dt, title: dt.title, artist: dt.artist, durationSec: dt.durationSec }, {});
		var calls = 0, realFetch = global.fetch;
		global.fetch = function () { calls++; return Promise.reject(new Error('no network in the demo')); };
		var dd;
		try { dd = await dspec.load(null); } finally { global.fetch = realFetch; }
		h.ok(calls === 0 && dd.person && /^More by /.test(dspec.title(dd)) && dd.items.length >= 3, 'demo: the lane shows "' + dspec.title(dd) + '" with ' + dd.items.length + ' songs, and asks nothing');
		h.ok(dd.items.every(function (f) { return f.source === 'musicbrainz' && f.videoId === null && f.mine !== dt.id; }), 'demo: found songs without a video, the song itself left out');
		h.ok(dd.items.filter(function (f) { return f.mine; }).length >= 0 && dd.items.filter(function (f) { return !f.mine; }).every(function (f) { return !M.inLibrary(M.index(demo.lib.tracks), f); }), 'demo: the invented songs meet no library song');
		h.eq(C.demoPerson({ id: 'not-demo' }, demo.lib, M), [], 'demo: only invented people');

		// =====================================================================
		// scrobble.js
		// =====================================================================

		// ---- The rule: half the song, or 4 minutes ----
		h.eq([SC.needed(300), SC.needed(600), SC.needed(0), SC.needed(61)], [150, 240, 240, 30.5], 'needed: half the song, 4 minutes at most, 4 minutes when the length is not known');
		h.eq([
			SC.counts({ listenedSec: 149, durationSec: 300 }), SC.counts({ listenedSec: 150, durationSec: 300 }),
			SC.counts({ listenedSec: 239, durationSec: 1000 }), SC.counts({ listenedSec: 240, durationSec: 1000 }),
			SC.counts({ listenedSec: 127 }, { durationSec: 254 }), SC.counts({ listenedSec: 0, durationSec: 0, completed: true }),
			SC.counts({ listenedSec: 45, completed: true }), SC.counts({ listenedSec: 29, completed: true }), SC.counts({ listenedSec: 240 })
		], [false, true, false, true, true, false, true, false, true], 'counts: ListenBrainz\'s rule: half or 4 minutes, whichever is first (the track\'s length when the player had none; an unknown length that ended counts after 30 s)');

		// ---- The payload ----
		var SONG = { id: 'Ab3_dE5-fG7', title: 'Glass Lullaby', artist: 'Mirai Kousaten', album: 'Night Ferry', durationSec: 254 };
		var META = { artist_name: 'Mirai Kousaten', track_name: 'Glass Lullaby', release_name: 'Night Ferry', additional_info: {
			media_player: 'True Shuffle', submission_client: 'True Shuffle', submission_client_version: SC.VERSION, music_service: 'youtube.com',
			origin_url: 'https://www.youtube.com/watch?v=Ab3_dE5-fG7', youtube_id: 'Ab3_dE5-fG7', duration_ms: 254000 } };
		h.eq(SC.metadata(SONG), META, 'metadata: artist, title, release, and additional_info with the player, the watch address, the video id and the length');
		h.eq(SC.metadata({ id: 'demo-001', title: 'X', artist: 'Y' }).additional_info.origin_url, undefined, 'metadata: no watch address for an id that is not YouTube\'s');
		h.eq([SC.metadata({ id: SONG.id, title: 'X', artist: '', artistGuess: 'some channel' }), SC.skipReason({ id: SONG.id, title: 'X', artist: '', artistGuess: 'c' }, { listenedSec: 300 })], [null, 'no-artist'], 'metadata: a guessed artist (the channel) is never sent');
		var T0 = Date.UTC(2026, 9, 11, 9, 0, 0);
		h.eq(SC.listenOf(SONG, { listenedSec: 200, at: T0 + 300000 }, T0).listened_at, T0 / 1000, 'listenOf: listened_at is when the song started ("playing now" saw it)');
		h.eq(SC.listenOf(SONG, { listenedSec: 200, at: T0 + 300000 }, 0).listened_at, (T0 + 100000) / 1000, 'listenOf: else the end less what was heard');
		h.eq(SC.body('import', [1, 2]), { listen_type: 'import', payload: [1, 2] }, 'body: listen_type and payload');
		h.eq([SC.looksLikeToken('6f1c3a8e-2b4d-4e5f-9a0b-1c2d3e4f5a6b'), SC.looksLikeToken(' 6F1C3A8E-2B4D-4E5F-9A0B-1C2D3E4F5A6B '), SC.looksLikeToken('abc')], [true, true, false], 'looksLikeToken: a UUID');

		// ---- The scrobbler against a fake ListenBrainz ----
		var TOKEN = '6f1c3a8e-2b4d-4e5f-9a0b-1c2d3e4f5a6b', OTHER = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
		function lbFake() {
			var f = { calls: [], mode: 'ok' };
			f.fetch = function (u, init) {
				var b = init.body ? JSON.parse(init.body) : null;
				f.calls.push({ url: u, init: json(init), body: b });
				if (f.mode === 'throw') return Promise.reject(new TypeError('Failed to fetch'));
				var status = 200, body = { status: 'ok' }, hd = {};
				if (/validate-token$/.test(u)) {
					var tk = (init.headers.Authorization || '').replace(/^Token /, '');
					body = tk === TOKEN ? { code: 200, message: 'Token valid.', valid: true, user_name: 'listener_one' } : { code: 200, message: 'Token invalid.', valid: false };
					if (f.mode === 'missing') { status = 404; body = { code: 404, error: 'The requested URL was not found on the server.' }; }
				} else if (f.mode === 'auth') { status = 401; body = { code: 401, error: 'Invalid authorization token.' }; }
				else if (f.mode === 'down') { status = 503; body = { code: 503, error: 'Service unavailable' }; }
				else if (f.mode === 'rate') { status = 429; body = { code: 429, error: 'Too many requests.' }; hd['x-ratelimit-reset-in'] = '7'; }
				else if (b && b.payload.some(function (l) { return l.track_metadata.track_name === 'Malformed'; })) { status = 400; body = { code: 400, error: 'Value for key listened_at is too low.' }; }
				else { hd['x-ratelimit-remaining'] = '29'; hd['x-ratelimit-reset-in'] = '9'; }
				var text = JSON.stringify(body);
				return Promise.resolve({ status: status, ok: status < 300, headers: { get: function (n) { return hd[String(n).toLowerCase()] || null; } }, text: function () { return Promise.resolve(text); } });
			};
			return f;
		}
		function memStore(sync) {
			var s = { data: {} };
			s.get = function (k, fb) { var v = k in s.data ? json(s.data[k]) : fb; return sync ? v : Promise.resolve(v); };
			s.set = function (k, v) { s.data[k] = json(v); return sync ? undefined : Promise.resolve(); };
			return s;
		}
		function lbRig(o) {
			o = o || {};
			var r = { clock: { t: o.t || T0 }, online: true, token: o.token == null ? TOKEN : o.token, timers: [], lb: o.lb || lbFake(), store: o.store || memStore() };
			r.sc = SC.create({
				token: function () { return r.token; }, fetch: r.lb.fetch, now: function () { return r.clock.t; }, store: r.store,
				onLine: function () { return r.online; },
				setTimer: function (fn, ms) { var t = { fn: fn, ms: ms }; r.timers.push(t); return t; },
				clearTimer: function (t) { r.timers = r.timers.filter(function (x) { return x !== t; }); }
			});
			r.wait = function (ms) { r.clock.t += ms; };
			r.fire = async function () { var t = r.timers.shift(); if (t) t.fn(); await h.tickAll(); await h.tickAll(); };
			return r;
		}
		function song(n, more) { var s = { id: 'Ab3_dE5-fG' + n, title: 'Song ' + n, artist: 'Mirai Kousaten', durationSec: 200 }; Object.keys(more || {}).forEach(function (k) { s[k] = more[k]; }); return s; }
		var HEARD = { listenedSec: 150, durationSec: 200, completed: true };

		// opt-in: nothing without a token
		var off = lbRig({ token: '' });
		var offRes = [await off.sc.playingNow(SONG), await off.sc.listened(SONG, HEARD)];
		await off.sc.flush();
		h.eq([offRes[0].reason, offRes[1].reason, off.lb.calls.length, off.store.data.scrobble, off.sc.status().on, off.sc.status().text], ['off', 'off', 0, undefined, false, 'Off: no ListenBrainz token.'], 'scrobble: without a token nothing is sent, kept or asked');

		// playing now
		var s1 = lbRig();
		var pn = await s1.sc.playingNow(SONG);
		var c0 = s1.lb.calls[0];
		h.eq([pn.sent, c0.url, c0.init.method, c0.init.headers, c0.init.credentials, c0.init.referrerPolicy], [true, 'https://api.listenbrainz.org/1/submit-listens', 'POST', { Authorization: 'Token ' + TOKEN, 'Content-Type': 'application/json' }, 'omit', 'no-referrer'], 'playingNow: a POST to submit-listens with the token in the Authorization header, no cookies, no referrer');
		h.eq(c0.body, { listen_type: 'playing_now', payload: [{ track_metadata: META }] }, 'playingNow: listen_type playing_now, one listen, no listened_at');
		s1.wait(10000);
		h.eq([(await s1.sc.playingNow(SONG)).reason, s1.lb.calls.length], ['twice', 1], 'playingNow: not sent twice within 30 s');
		s1.wait(90000);
		h.eq([(await s1.sc.listened(SONG, { listenedSec: 100, durationSec: 254, at: s1.clock.t })).reason, s1.lb.calls.length], ['short', 1], 'listened: 100 s of 254 is not a listen: nothing sent');
		s1.wait(27000);
		var l1 = await s1.sc.listened(SONG, { listenedSec: 127, durationSec: 254, completed: false, at: s1.clock.t });
		var c1 = s1.lb.calls[1];
		h.eq([l1.sent, c1.body.listen_type, c1.body.payload.length, c1.body.payload[0].listened_at, c1.body.payload[0].track_metadata], [true, 'single', 1, T0 / 1000, META], 'listened: half the song is a listen: sent as single, timed from its start');
		h.eq([s1.sc.status().sentToday, s1.sc.status().waiting, s1.sc.status().text], [1, 0, '1 listen sent today'], 'status: one sent today');

		// offline: kept, then sent together
		s1.online = false;
		await s1.sc.listened(song(1), HEARD);
		await s1.sc.listened(song(2), HEARD);
		h.eq([s1.lb.calls.length, s1.store.data.scrobble.queue.length, s1.sc.status().text], [2, 2, '1 listen sent today; 2 waiting. This device is offline; the listens wait.'], 'offline: the listens wait in the store; Settings says so');
		s1.online = true;
		await s1.sc.flush();
		var c2 = s1.lb.calls[2];
		h.eq([s1.lb.calls.length, c2.body.listen_type, c2.body.payload.map(function (l) { return l.track_metadata.track_name; }), s1.sc.status().text], [3, 'import', ['Song 1', 'Song 2'], '3 listens sent today'], 'offline: back online, both go in one import, oldest first');

		// refused: kept, retried later, the wait doubling
		s1.lb.mode = 'down';
		await s1.sc.listened(song(3), HEARD);
		var st3 = s1.sc.status();
		h.eq([st3.waiting, st3.lastError.code, st3.retryAt - s1.clock.t, s1.timers.length, s1.timers[0] && s1.timers[0].ms], [1, 'server', 30000, 1, 30000], 'refused (503): kept, tried again in 30 s');
		await s1.sc.listened(song(4), HEARD);
		h.eq([s1.lb.calls.length, s1.sc.status().waiting], [4, 2], 'refused: a listen before the wait is over is kept without asking');
		s1.wait(30000);
		await s1.fire();
		h.eq([s1.lb.calls.length, s1.sc.status().retryAt - s1.clock.t], [5, 60000], 'refused again: the wait doubles (60 s)');
		s1.lb.mode = 'ok';
		s1.wait(60000);
		await s1.fire();
		h.eq([s1.lb.calls.length, s1.lb.calls[5].body.payload.length, s1.sc.status().waiting, s1.sc.status().lastError, s1.sc.status().sentToday], [6, 2, 0, null, 5], 'refused: after the wait both are sent');

		// a thrown fetch (no answer at all: offline or blocked) keeps the listen too
		s1.lb.mode = 'throw';
		await s1.sc.listened(song(5), HEARD);
		h.eq([s1.sc.status().waiting, s1.sc.status().lastError.code], [1, 'network'], 'no answer: kept, "could not be reached"');
		s1.lb.mode = 'ok';
		s1.wait(30000);
		await s1.fire();
		h.eq(s1.sc.status().waiting, 0, 'no answer: sent on the retry');

		// the token refused
		s1.lb.mode = 'auth';
		await s1.sc.listened(song(6), HEARD);
		var nAuth = s1.lb.calls.length;
		await s1.sc.flush();
		var pAuth = await s1.sc.playingNow(song(7));
		h.eq([s1.sc.status().lastError.code, s1.sc.status().waiting, s1.lb.calls.length - nAuth, pAuth.reason], ['auth', 1, 0, 'auth'], 'token refused (401): kept, and nothing more is sent with that token');
		s1.lb.mode = 'ok';
		s1.token = OTHER;
		await s1.sc.tokenChanged();
		h.eq([s1.sc.status().waiting, s1.lb.calls[s1.lb.calls.length - 1].init.headers.Authorization], [0, 'Token ' + OTHER], 'a new token: what waited is sent with it');

		// a malformed listen in a batch: the batch one by one, that one dropped
		s1.online = false;
		await s1.sc.listened(song(8), HEARD);
		await s1.sc.listened(song(9, { title: 'Malformed' }), HEARD);
		await s1.sc.listened(song(10), HEARD);
		s1.online = true;
		var nBad = s1.lb.calls.length;
		await s1.sc.flush();
		var badCalls = s1.lb.calls.slice(nBad).map(function (c) { return c.body.listen_type + ':' + c.body.payload.map(function (l) { return l.track_metadata.track_name; }).join(','); });
		h.eq([badCalls, s1.sc.status().waiting, s1.sc.status().dropped], [['import:Song 8,Malformed,Song 10', 'single:Song 8', 'single:Malformed', 'single:Song 10'], 0, 1], 'malformed (400): the batch is sent one by one, the bad listen dropped, the others sent');

		// too many requests
		s1.lb.mode = 'rate';
		await s1.sc.listened(song(11), HEARD);
		h.eq([s1.sc.status().lastError.code, s1.sc.status().retryAt - s1.clock.t], ['rate', 7000], 'too many requests (429): waits as long as X-RateLimit-Reset-In says');

		// at most 500 kept
		var k = lbRig();
		k.online = false;
		for (var i = 0; i < 503; i++) { k.wait(1000); await k.sc.listened(song('k' + i, { title: 'Kept ' + i }), HEARD); }
		var pend = await k.sc.pending();
		h.eq([pend.length, pend[0].track_metadata.track_name, pend[499].track_metadata.track_name, k.sc.status().dropped], [500, 'Kept 3', 'Kept 502', 3], 'at most 500 kept: the oldest go first');
		await k.sc.clear();
		h.eq([k.sc.status().waiting, k.store.data.scrobble.queue.length], [0, 0], 'clear: what waited is forgotten (the token was taken away)');

		// a new page: the queue is read back from the store
		var store = memStore();
		var p1 = lbRig({ store: store });
		p1.online = false;
		await p1.sc.listened(song(20), HEARD);
		await p1.sc.listened(song(21), HEARD);
		var p2 = lbRig({ store: store, lb: lbFake() });
		await p2.sc.flush();
		h.eq([p2.lb.calls.length, p2.lb.calls[0].body.payload.length, p2.sc.status().waiting], [1, 2, 0], 'restart: the listens kept by the last page are sent by the next');
		h.eq(Object.keys(store.data), ['scrobble'], 'store: one key, scrobble');
		h.ok(JSON.stringify(store.data).indexOf(TOKEN) < 0, 'store: the token itself is never stored there');

		// a store that answers at once works too; the day rolls over
		var sy = lbRig({ store: memStore(true) });
		await sy.sc.listened(song(30), HEARD);
		h.eq(sy.sc.status().sentToday, 1, 'a store that answers at once (not a promise) works the same');
		sy.wait(86400000);
		h.eq([sy.sc.status().sentToday, sy.sc.status().sent], [0, 1], 'status: "today" starts again the next day');

		// ---- validate ----
		var v = lbFake();
		var good = await SC.validate(TOKEN, { fetch: v.fetch });
		h.eq([good, v.calls[0].url, v.calls[0].init.method, v.calls[0].init.headers, v.calls[0].init.credentials], [{ ok: true, user: 'listener_one', code: '', message: '' }, 'https://api.listenbrainz.org/1/validate-token', 'GET', { Authorization: 'Token ' + TOKEN }, 'omit'], 'validate: GET validate-token with the token in the header -> ok and the user name');
		var bad = await SC.validate(OTHER, { fetch: v.fetch });
		h.eq([bad.ok, bad.code], [false, 'auth'], 'validate: a token ListenBrainz does not know');
		v.mode = 'throw';
		h.eq((await SC.validate(TOKEN, { fetch: v.fetch })).code, 'network', 'validate: no answer (offline, or the browser blocked it): network, never a rejection');
		v.mode = 'missing';
		h.eq((await SC.validate(TOKEN, { fetch: v.fetch })).code, 'server', 'validate: ListenBrainz answers 404 (as it did on 2026-10-11): server');
		var nV = v.calls.length;
		h.eq([(await SC.validate('  ', { fetch: v.fetch })).code, v.calls.length - nV], ['empty', 0], 'validate: no token, nothing asked');
		h.eq(SC.statusText({ on: true, sentToday: 12, waiting: 2 }), '12 listens sent today; 2 waiting', 'statusText: "12 listens sent today; 2 waiting"');

		// ---- playing now on every "playing": a resume is the same play ----
		var pr = lbRig();
		await pr.sc.playingNow(SONG);
		pr.wait(120000);
		var resumed = await pr.sc.playingNow(SONG);
		await pr.sc.listened(SONG, { listenedSec: 200, durationSec: 254, at: pr.clock.t });
		h.eq([resumed.reason, pr.lb.calls.length, pr.lb.calls[1].body.payload[0].listened_at], ['twice', 2, T0 / 1000], 'playingNow: playing again after a 2-minute pause is the same play: not sent, its start kept');
		pr.wait(60000);
		h.eq([(await pr.sc.playingNow(SONG)).sent, pr.lb.calls.length], [true, 3], 'playingNow: the song again after it was left is a new play');

		// ---- Settings' field: the token is kept only once ListenBrainz knows it ----
		function el(tag, attrs, kids) {
			var e = { tag: tag, attrs: attrs || {}, children: [], value: '', textContent: (attrs && attrs.text) || '', listeners: {}, hidden: false };
			e.appendChild = function (c) { e.children.push(c); return c; };
			e.addEventListener = function (n, fn) { e.listeners[n] = fn; };
			(kids || []).forEach(function (c) { e.appendChild(c); });
			return e;
		}
		var said = [], kept = {}, fl = lbFake(), frig = lbRig({ token: '' });
		var box = SC.field({ h: el, say: function (s) { said.push(s); } }, frig.sc, { fetch: fl.fetch, load: function (k) { return kept[k]; }, store: function (k, v) { if (v == null) delete kept[k]; else kept[k] = v; } });
		var form = box.children[0], input = form.children[1], note = box.children[1];
		h.eq([form.tag, input.attrs.type, input.attrs.id, note.textContent], ['form', 'password', 'lb-token', 'Off: no ListenBrainz token.'], 'field: a password field and the status in words');
		async function submit(v) { input.value = v; form.listeners.submit({ preventDefault: function () {} }); for (var i = 0; i < 6; i++) await h.tickAll(); }
		await submit('not a token');
		h.eq([kept.lbToken, fl.calls.length, /looks like/.test(said[said.length - 1])], [undefined, 0, true], 'field: something that is not a token is refused at once, nothing asked');
		await submit(OTHER);
		h.eq([kept.lbToken, fl.calls.length, said[said.length - 1]], [undefined, 1, 'ListenBrainz does not know this token. Copy it again from listenbrainz.org/settings.'], 'field: a token ListenBrainz does not know is not kept');
		fl.mode = 'missing';
		await submit(TOKEN);
		h.eq(kept.lbToken, undefined, 'field: when ListenBrainz cannot check it (404, or the browser blocks it), it is not kept: nothing would ever be sent');
		fl.mode = 'ok';
		await submit(TOKEN);
		h.eq([kept.lbToken, said[said.length - 1]], [TOKEN, 'Scrobbling to ListenBrainz as listener_one, from this browser.'], 'field: a token ListenBrainz knows is kept, and says whose');
		await submit('');
		h.eq([kept.lbToken, said[said.length - 1]], [undefined, 'Scrobbling is off: nothing goes to ListenBrainz.'], 'field: an empty field turns it off');

		// ---- the song page's line ----
		var line1 = el('p'), r7 = rig();
		var painted = await C.paint(line1, {}, T1, { credits: r7.c });
		h.eq([painted, line1.textContent, line1.hidden], ['Music: Sora Aoki ' + DOT + ' Lyrics: June Halloway ' + DOT + ' Arranged by Rei Hoshino', painted, false], 'paint: the line on the song page');
		var line2 = el('p');
		h.eq([await C.paint(line2, {}, tr('n', 'Nothing Song', 'Nobody Here'), { credits: r7.c }), line2.hidden], ['', true], 'paint: hidden when MusicBrainz says nothing');
		var r8 = rig();
		r8.mb.busy = 9;
		var line3 = el('p');
		h.eq([await C.paint(line3, {}, T1, { credits: r8.c }), line3.hidden], ['', true], 'paint: hidden, and no error, when MusicBrainz cannot be asked');
		var line4 = el('p');
		h.ok(/^Music/.test(await C.paint(line4, { demo: true }, dt)) && !line4.hidden, 'paint: the demo\'s invented credits, nothing asked');
		h.eq(spec.lazy, true, 'lane: lazy (loads only when it comes near the screen)');
	});
};
