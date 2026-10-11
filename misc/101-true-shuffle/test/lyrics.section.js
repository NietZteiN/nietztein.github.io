/*
 * Lyrics: lyrics.js without a browser. parseLrc (stamps, several on a line,
 * offsets, tags, spacers, order), lineAt (against a plain scan), romajiLine,
 * queryFor, pick (timed words, the length, the artist, the titleAlt and the
 * native name, a cover's original artist, a song with no artist), answerOf,
 * cacheKey, snippet, toFind, and the client against a fake LRCLIB: api/get
 * then the search, a hit that needs no search, what is kept (the answer and
 * "none", 30 days, in sources.js's cache or its own), one lookup in flight
 * per song, failures not kept, the fetch options, the search rows, and
 * requests 300 ms apart. The panel, the karaoke page and tick() are checked
 * in a browser. Loaded by test.js, which runs it as the section "lyrics".
 */
'use strict';
var path = require('path');

module.exports = function (h) {
	h.describe('lyrics', async function () {
		var Ly = require(path.join(h.HERE, 'lyrics.js'));
		var Src = require(path.join(h.HERE, 'sources.js'));
		var Store = require(path.join(h.HERE, 'store.js'));
		var cp = String.fromCharCode;
		var DAY = 86400000;
		var i, k;

		// ---- parseLrc
		h.eq(Ly.parseLrc('[00:12.34]Hello\n[00:15.00]World'), { lines: [{ t: 12.34, text: 'Hello' }, { t: 15, text: 'World' }], offset: 0, tags: {} }, 'parseLrc: [mm:ss.xx] lines, in seconds');
		h.eq(Ly.parseLrc('[01:02]Two\n[00:01.234]Three\n[00:03:50]Colon\n[00:04.5]Half').lines, [{ t: 1.234, text: 'Three' }, { t: 3.5, text: 'Colon' }, { t: 4.5, text: 'Half' }, { t: 62, text: 'Two' }], 'parseLrc: [mm:ss], [mm:ss.xxx], [mm:ss:xx] and one digit of a second, sorted by time');
		h.eq(Ly.parseLrc('[00:10.00][00:40.00]Chorus\n[00:20.00]Verse').lines, [{ t: 10, text: 'Chorus' }, { t: 20, text: 'Verse' }, { t: 40, text: 'Chorus' }], 'parseLrc: several stamps on one line give the line at each time');
		var tagged = Ly.parseLrc('[ar: Paper Lanterns]\n[ti:Blue Signal]\n[al:Night Ferry]\n[length: 03:30]\n[by:someone]\n[00:01.00]a');
		h.eq(tagged.tags, { ar: 'Paper Lanterns', ti: 'Blue Signal', al: 'Night Ferry', length: '03:30', by: 'someone' }, 'parseLrc: [ar:], [ti:] and the other tags, trimmed');
		h.eq(tagged.lines, [{ t: 1, text: 'a' }], 'parseLrc: tag lines are not lines');
		var sooner = Ly.parseLrc('[offset:+500]\n[00:10.00]a\n[00:00.20]b');
		h.eq([sooner.offset, sooner.lines], [500, [{ t: 0, text: 'b' }, { t: 9.5, text: 'a' }]], 'parseLrc: [offset:+500] shows the words half a second sooner, never before 0');
		h.eq(Ly.parseLrc('[offset:-250]\n[00:10.00]a').lines, [{ t: 10.25, text: 'a' }], 'parseLrc: a negative offset, later');
		h.eq(Ly.parseLrc('[00:05.00]\n[00:06.00]   \n[00:07.00]x').lines, [{ t: 5, text: '' }, { t: 6, text: '' }, { t: 7, text: 'x' }], 'parseLrc: a stamp without words is a spacer, kept');
		h.eq(Ly.parseLrc('Just words\n[Chorus]\n[00:01.00][Chorus] la la').lines, [{ t: 1, text: '[Chorus] la la' }], 'parseLrc: lines without a stamp are left out; a bracket after the stamp is words');
		h.eq(Ly.parseLrc('[00:02.00]b\n[00:01.00]a1\n[00:01.00]a2').lines.map(function (l) { return l.text; }), ['a1', 'a2', 'b'], 'parseLrc: equal times keep the order they were written in');
		h.eq(Ly.parseLrc(cp(0xFEFF) + '[00:01.00]<00:01.00>Hel<00:01.50>lo   there\r\n[00:02.00]two\r[00:03.00]three').lines, [{ t: 1, text: 'Hello there' }, { t: 2, text: 'two' }, { t: 3, text: 'three' }], 'parseLrc: a byte order mark, CRLF and CR, word stamps, runs of spaces');
		h.eq([Ly.parseLrc(''), Ly.parseLrc(null)], [{ lines: [], offset: 0, tags: {} }, { lines: [], offset: 0, tags: {} }], 'parseLrc: nothing gives no lines');
		var kimiNoNa = cp(0x541B, 0x306E, 0x540D);
		h.eq(Ly.parseLrc('[00:01.00]' + kimiNoNa).lines[0].text, kimiNoNa, 'parseLrc: Japanese words as they are');

		// ---- lineAt
		var ls = [{ t: 5 }, { t: 10 }, { t: 10 }, { t: 20 }];
		h.eq([0, 4.99, 5, 9.99, 10, 15, 20, 1000].map(function (s) { return Ly.lineAt(ls, s); }), [-1, -1, 0, 0, 2, 2, 3, 3], 'lineAt: -1 before the first line, then the last line that has started (of equal times, the last)');
		h.eq([Ly.lineAt([], 3), Ly.lineAt(null, 3), Ly.lineAt(ls, NaN), Ly.lineAt(ls, '12')], [-1, -1, -1, 2], 'lineAt: no lines, no time; a time given as text');
		var seed = 7, bad = 0;
		function rand() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
		for (k = 0; k < 300; k++) {
			var times = [], n = 1 + Math.floor(rand() * 40);
			for (i = 0; i < n; i++) times.push(Math.round(rand() * 2000) / 10);
			times.sort(function (a, b) { return a - b; });
			var lines = times.map(function (t) { return { t: t, text: '' }; }), at = Math.round(rand() * 2100) / 10 - 5, want = -1;
			lines.forEach(function (l, j) { if (l.t <= at) want = j; });
			if (Ly.lineAt(lines, at) !== want) bad++;
		}
		h.eq(bad, 0, 'lineAt: the same answers as a plain scan, 300 random lyrics');

		// ---- romajiLine
		h.eq(Ly.romajiLine(cp(0x304D, 0x307F, 0x306E, 0x306A, 0x307E, 0x3048)), 'kiminonamae', 'romajiLine: hiragana in Hepburn');
		h.eq(Ly.romajiLine(cp(0x30AB, 0x30E9, 0x30B9)), 'karasu', 'romajiLine: katakana');
		h.eq(Ly.romajiLine(cp(0x541B, 0x306E, 0x540D, 0x524D, 0x306F)), cp(0x541B) + 'no' + cp(0x540D, 0x524D) + 'ha', 'romajiLine: kanji stay as they are');
		h.eq(Ly.romajiLine(cp(0x304D, 0x307F, 0x3001, 0x3053, 0x3053, 0x3002, 0x3000, 0x300C, 0x3042, 0x300D)), 'kimi, koko. "a"', 'romajiLine: Japanese commas, stops, quotes and the wide space in Latin form');
		h.eq(Ly.romajiLine('Love ' + cp(0x30E9, 0x30D6)), 'Love rabu', 'romajiLine: Latin words stay');
		h.eq([Ly.romajiLine('Hello there'), Ly.romajiLine(cp(0x541B)), Ly.romajiLine(''), Ly.romajiLine(null)], ['', '', '', ''], 'romajiLine: nothing without kana (kanji alone have no reading here)');

		// ---- queryFor
		var aoi = cp(0x9752, 0x3044, 0x4FE1, 0x53F7);
		var pl = cp(0x30DA, 0x30FC, 0x30D1, 0x30FC, 0x30E9, 0x30F3, 0x30BF, 0x30F3, 0x30BA);
		h.eq(Ly.queryFor({ title: 'Blue Signal (TV Size)', titleAlt: aoi, artist: 'Paper Lanterns', durationSec: 89.6 }), [
			{ artist_name: 'Paper Lanterns', track_name: 'Blue Signal', duration: 90 },
			{ artist_name: 'Paper Lanterns', track_name: aoi, duration: 90 }
		], 'queryFor: the artist with the base title, then with the titleAlt; the length rounded');
		h.eq(Ly.queryFor({ title: 'Blue Signal', titleAlt: aoi, artist: 'Paper Lanterns', artistNative: pl, origArtist: 'Glass Orchard', durationSec: 200 }).map(function (q) { return q.artist_name + ' / ' + q.track_name; }),
			['Paper Lanterns / Blue Signal', 'Paper Lanterns / ' + aoi, pl + ' / ' + aoi, 'Glass Orchard / Blue Signal'], 'queryFor: the native name with the titleAlt, then a cover\'s original artist; four at most');
		h.eq(Ly.queryFor({ title: 'Blue Signal', artist: 'Paper Lanterns' }), [{ artist_name: 'Paper Lanterns', track_name: 'Blue Signal' }], 'queryFor: no length, no duration');
		h.eq(Ly.queryFor({ title: 'Blue Signal', titleAlt: 'Blue Signal', artist: 'Paper Lanterns', origArtist: 'paper lanterns' }).length, 1, 'queryFor: the same lookup is not asked twice');
		h.eq(Ly.queryFor({ title: 'Blue Signal', artistGuess: 'musicfan1987' })[0].artist_name, 'musicfan1987', 'queryFor: the guessed artist when there is no sure one');
		h.eq(Ly.queryFor({ raw: { title: 'Blue Signal' }, artist: 'Paper Lanterns' })[0].track_name, 'Blue Signal', 'queryFor: the upload\'s title when the track has none');
		h.eq([Ly.queryFor({ title: 'Blue Signal' }), Ly.queryFor(null), Ly.queryFor({ artist: 'Paper Lanterns' })], [[], [], []], 'queryFor: nothing to ask without an artist or a title');

		// ---- pick
		function rec(o) { return Object.assign({ id: 1, trackName: 'Blue Signal', artistName: 'Paper Lanterns', albumName: 'Night Ferry', duration: 200, instrumental: false, plainLyrics: 'words', syncedLyrics: null }, o); }
		var song = { title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 200 };
		var LRC = '[00:01.00]words';
		h.eq(Ly.pick([rec({ id: 1 }), rec({ id: 2, syncedLyrics: LRC })], song).id, 2, 'pick: timed words before plain ones');
		h.eq(Ly.pick([rec({ id: 1, duration: 231, syncedLyrics: LRC }), rec({ id: 2, duration: 201.5, syncedLyrics: LRC })], song).id, 2, 'pick: a length within 3 s before a farther one');
		h.eq(Ly.pick([rec({ id: 1, duration: 200 }), rec({ id: 2, duration: 213, syncedLyrics: LRC })], song).id, 1, 'pick: plain words of this length before timed words 13 s off');
		h.eq(Ly.pick([rec({ id: 1, duration: 200 }), rec({ id: 2, duration: 206, syncedLyrics: LRC })], song).id, 2, 'pick: timed words 6 s off before plain words of this length');
		h.eq(Ly.pick([rec({ id: 1, artistName: 'Other Band', syncedLyrics: LRC }), rec({ id: 2 })], song).id, 2, 'pick: another artist is another song, even with timed words');
		h.eq(Ly.pick([rec({ id: 1, syncedLyrics: LRC }), rec({ id: 2, syncedLyrics: LRC })], song).id, 1, 'pick: of equal records, the first (LRCLIB\'s order)');
		h.eq(Ly.pick([rec({ id: 1, artistName: 'Other Band' }), rec({ id: 2, trackName: 'Red Signal' })], song), null, 'pick: null when no record is this song');
		h.eq([Ly.pick([], song), Ly.pick(null, song), Ly.pick([null, 7, 'x', [], rec({ trackName: '' })], song)], [null, null, null], 'pick: nothing, or junk');
		h.eq(Ly.pick([rec({ id: 1, plainLyrics: '', syncedLyrics: '' }), rec({ id: 2, plainLyrics: null, instrumental: true })], song).id, 2, 'pick: a record without words counts only when it says the song is an instrumental');
		h.eq(Ly.pick([rec({ id: 3, trackName: aoi, artistName: pl, syncedLyrics: LRC })], { title: 'Aoi Shingou', titleAlt: aoi, artist: 'Paper Lanterns', artistNative: pl, durationSec: 200 }).id, 3, 'pick: the Japanese title through titleAlt, the artist through the native name');
		h.eq(Ly.pick([rec({ id: 4, trackName: cp(0x30AB, 0x30E9, 0x30B9), syncedLyrics: LRC })], { title: 'Karasu', artist: 'Paper Lanterns', durationSec: 200 }).id, 4, 'pick: a katakana title meets its romaji');
		h.eq(Ly.pick([rec({ id: 5, artistName: 'Glass Orchard' })], { title: 'Blue Signal', artist: 'Some Singer', origArtist: 'Glass Orchard', version: 'cover', durationSec: 210 }).id, 5, 'pick: a cover takes the original artist\'s record');
		h.eq(Ly.pick([rec({ id: 6, trackName: 'Blue Signal (TV Size)', duration: 90, syncedLyrics: LRC }), rec({ id: 7, duration: 250, syncedLyrics: LRC })], { title: 'Blue Signal (TV Size)', artist: 'Paper Lanterns', durationSec: 89 }).id, 6, 'pick: the TV size record for a TV size upload');
		h.eq(Ly.pick([rec({ id: 8, artistName: 'Paper Lanterns feat. Glass Orchard' })], song).id, 8, 'pick: a person in the credit counts as the artist');
		var noArtist = { title: 'Blue Signal', durationSec: 200 };
		h.eq([(Ly.pick([rec({ id: 9, duration: 201 })], noArtist) || {}).id, Ly.pick([rec({ id: 10, duration: 210 })], noArtist)], [9, null], 'pick: with no artist, only a record within 3 s of the length');

		// ---- answerOf, cacheKey
		h.eq(Ly.answerOf(rec({ id: 11, syncedLyrics: '[offset:+1000]\n[00:11.00]one\n[00:12.00]\n[00:13.00]two', plainLyrics: 'one\n\ntwo' }), song),
			{ synced: [{ t: 10, text: 'one' }, { t: 11, text: '' }, { t: 12, text: 'two' }], plain: 'one\n\ntwo', instrumental: false, otherCut: false, source: { id: 11, artist: 'Paper Lanterns', title: 'Blue Signal', duration: 200 } },
			'answerOf: the timed lines (the offset applied), the plain words, where they came from');
		h.eq(Ly.answerOf(rec({ syncedLyrics: '[00:01.00]one\n[00:02.00]two', plainLyrics: '' }), song).plain, 'one\ntwo', 'answerOf: plain words made from the timed ones when LRCLIB has none');
		var cut = Ly.answerOf(rec({ duration: 250, syncedLyrics: LRC }), { title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 90 });
		h.eq([cut.synced, cut.plain, cut.otherCut], [null, 'words', true], 'answerOf: timed words for a cut 160 s longer are kept as words only');
		h.eq(Ly.answerOf(rec({ plainLyrics: null, instrumental: true }), song).instrumental, true, 'answerOf: an instrumental');
		var blank = Ly.answerOf(rec({ syncedLyrics: '[00:01.00]\n[00:02.00]', plainLyrics: '' }), song);
		h.eq([blank.synced, blank.plain, blank.instrumental], [null, null, false], 'answerOf: timed lines that are all spacers are no words');
		h.eq(Ly.answerOf(null, song), null, 'answerOf: no record, no answer');
		h.eq([Ly.cacheKey({ id: 'dQw4w9WgXcQ', title: 'x' }), Ly.cacheKey({ videoId: 'abcdefghijk', id: 'demo-1' }), Ly.cacheKey({ id: 'demo-002', artist: 'Paper Lanterns', title: 'The Blue Letters!' }), Ly.cacheKey({}), Ly.cacheKey(null)],
			['ly:dQw4w9WgXcQ', 'ly:abcdefghijk', 'ly:paperlanterns|blueletters', '', ''], 'cacheKey: ly: and the video id, else the folded artist and title');

		// ---- snippet, toFind
		var words = 'Under the bridge\nthe paper lanterns glow tonight above the harbour\nWe sing\nall night';
		h.eq(Ly.snippet(words, 'lanterns GLOW'), 'the paper lanterns glow tonight above the harbour', 'snippet: the line that holds the words, in any case');
		h.eq(Ly.snippet(words, 'we sing'), 'We sing / all night', 'snippet: a short line takes the next one along');
		h.eq(Ly.snippet('Caf' + cp(0xE9) + ' au lait', 'cafe'), 'Caf' + cp(0xE9) + ' au lait', 'snippet: accents do not matter');
		h.eq(Ly.snippet('[00:01.00]the paper lanterns glow', 'paper'), 'the paper lanterns glow', 'snippet: stamps left in the text are dropped');
		h.eq(Ly.snippet('the cat and the dog in the hall\nwe lit a paper lantern tonight', 'the lanterns'), 'we lit a paper lantern tonight', 'snippet: small words do not count when there are others, and a plural finds its singular');
		h.eq(Ly.snippet('nothing here\nit is what it is', 'it is'), 'it is what it is', 'snippet: small words count when they are all there is');
		h.eq(Ly.snippet(new Array(60).join('paper lantern '), 'paper').length, 160, 'snippet: 160 characters at most');
		h.eq([Ly.snippet(words, 'zebra'), Ly.snippet('', 'x'), Ly.snippet(words, '')], ['', '', ''], 'snippet: nothing when no line holds the words');
		var f = Ly.toFind({ id: 77, title: 'Blue Signal', artist: 'Paper Lanterns', album: 'Night Ferry', duration: 201 });
		h.eq([f.key, f.title, f.artist, f.album, f.durationSec, f.source, f.videoId, f.ids], ['lrc:77', 'Blue Signal', 'Paper Lanterns', 'Night Ferry', 201, 'lrclib', null, { lrc: 77 }], 'toFind: a search row as a find (sources.js shape) for the engine to resolve');

		// ---- the client, against a fake LRCLIB
		var clock = Date.UTC(2026, 9, 10, 12, 0, 0);
		// a clock that moves only when the client waits (the wait ends in a later task, as a timer's would)
		function fakeTime() { return { now: function () { return clock; }, wait: function (ms) { return new Promise(function (r) { setTimeout(function () { clock += ms; r(); }, 0); }); } }; }
		// answer(path, query, n) -> a body (an object or a list), null (404), { status, headers } or an Error (the network fails)
		function fakeLrclib(answer) {
			var calls = [];
			function fetch(url, init) {
				var u = new URL(url), q = {};
				u.searchParams.forEach(function (v, key) { q[key] = v; });
				calls.push({ path: u.pathname, q: q, init: init, at: clock });
				var r = answer(u.pathname.replace(/^\/api\//, ''), q, calls.length);
				if (r instanceof Error) return Promise.reject(r);
				var status = r == null ? 404 : r.status || 200, body = r && r.status ? null : r;
				return Promise.resolve({
					ok: status >= 200 && status < 300, status: status,
					headers: { get: function (name) { return r && r.headers ? r.headers[name.toLowerCase()] || null : null; } },
					json: function () { return Promise.resolve(JSON.parse(JSON.stringify(body == null ? { statusCode: status } : body))); }
				});
			}
			fetch.calls = calls;
			return fetch;
		}
		function trail(fk) { return fk.calls.map(function (x) { return x.path + ' ' + (x.q.artist_name ? x.q.artist_name + ' / ' : '') + (x.q.track_name || x.q.q) + (x.q.duration ? ' ' + x.q.duration : ''); }); }
		var timed = rec({ id: 41, duration: 200, syncedLyrics: '[00:01.00]one\n[00:02.00]two' });
		var tf = fakeTime();

		// api/get finds nothing: the search, and pick
		var fk1 = fakeLrclib(function (p) { return p === 'get' ? null : [rec({ id: 40, artistName: 'Other Band', syncedLyrics: LRC }), timed]; });
		var c1 = Ly.createClient({ fetch: fk1, now: tf.now, wait: tf.wait });
		var track1 = { id: 'vidBlueSig1', title: 'Blue Signal', titleAlt: aoi, artist: 'Paper Lanterns', durationSec: 201 };
		var ans1 = await c1.get(track1);
		h.eq(trail(fk1), ['/api/get Paper Lanterns / Blue Signal 201', '/api/get Paper Lanterns / ' + aoi + ' 201', '/api/search Paper Lanterns / Blue Signal'], 'get: api/get with each lookup (404), then api/search with the first');
		h.eq([ans1.source.id, ans1.synced, ans1.plain], [41, [{ t: 1, text: 'one' }, { t: 2, text: 'two' }], 'words'], 'get: the record pick chooses, its words as lines');
		h.ok(fk1.calls.every(function (x) { return x.init.method === 'GET' && x.init.credentials === 'omit' && x.init.referrerPolicy === 'no-referrer' && /^True Shuffle \(https:\/\/nietztein\.github\.io\//.test(x.init.headers['Lrclib-Client']); }), 'get: every request goes without cookies or a referrer, and names the app in Lrclib-Client');
		h.ok(fk1.calls.every(function (x) { return x.path.indexOf('/api/') === 0; }) && Ly.API === 'https://lrclib.net/api/', 'get: the requests go to ' + Ly.API);
		h.eq([fk1.calls[1].at - fk1.calls[0].at, fk1.calls[2].at - fk1.calls[1].at], [300, 300], 'get: the lookups leave 300 ms apart');
		var n1 = fk1.calls.length, again1 = await c1.get(track1);
		h.eq([fk1.calls.length - n1, again1], [0, ans1], 'get: the second time comes from the cache, without a request');
		again1.synced[0].text = 'changed';
		h.eq((await c1.get(track1)).synced[0].text, 'one', 'get: what the cache gives is a copy');

		// a hit from api/get: no search
		var fk2 = fakeLrclib(function (p) { return p === 'get' ? timed : null; });
		var a2 = await Ly.createClient({ fetch: fk2, now: tf.now, wait: tf.wait }).get({ id: 'vidBlueSig2', title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 199 });
		h.eq([trail(fk2), a2.source.id], [['/api/get Paper Lanterns / Blue Signal 199'], 41], 'get: timed words of this length from api/get need no search');
		var fk3 = fakeLrclib(function (p) { return p === 'get' ? rec({ id: 50, duration: 200 }) : [rec({ id: 51, duration: 202, syncedLyrics: LRC, plainLyrics: null })]; });
		var a3 = await Ly.createClient({ fetch: fk3, now: tf.now, wait: tf.wait }).get({ id: 'vidBlueSig3', title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 200 });
		h.eq([fk3.calls.map(function (x) { return x.path; }), a3.source.id, a3.plain], [['/api/get', '/api/search'], 51, 'words'], 'get: plain words from api/get, timed ones from the search: the timed ones');

		// a cover nobody has under its singer: the original artist, searched for once more
		var fk4 = fakeLrclib(function (p, q) { return p === 'get' ? null : q.artist_name === 'Glass Orchard' ? [rec({ id: 70, artistName: 'Glass Orchard', duration: 230, syncedLyrics: LRC })] : []; });
		var a4 = await Ly.createClient({ fetch: fk4, now: tf.now, wait: tf.wait }).get({ id: 'vidCover0001', title: 'Blue Signal', artist: 'Some Singer', origArtist: 'Glass Orchard', version: 'cover', durationSec: 214 });
		h.eq([trail(fk4), a4 && a4.source.id], [['/api/get Some Singer / Blue Signal 214', '/api/get Glass Orchard / Blue Signal 214', '/api/search Some Singer / Blue Signal', '/api/search Glass Orchard / Blue Signal'], 70], 'get: a cover the search does not know under its singer: once more with the original artist');

		// "none" is kept 30 days, in sources.js's cache
		var fk5 = fakeLrclib(function (p) { return p === 'get' ? null : []; });
		var store5 = Store.memory(), cache5 = Src.createCache({ store: store5, now: tf.now });
		var c5 = Ly.createClient({ fetch: fk5, cache: cache5, now: tf.now, wait: tf.wait });
		var quiet = { id: 'vidNoWords1', title: 'Quiet Song', artist: 'Paper Lanterns', durationSec: 180 };
		h.eq(await c5.get(quiet), null, 'get: null when nothing is found');
		var n5 = fk5.calls.length;
		h.eq([await c5.get(quiet), fk5.calls.length - n5], [null, 0], 'get: "none" is kept too: no second request');
		h.eq(await cache5.get('ly:vidNoWords1'), null, 'get: kept in sources.js\'s cache under ly:<videoId>, as a stored no (null)');
		var rows5 = await store5.cacheRange('ly:', { now: clock });
		h.ok(rows5.length === 1 && rows5[0].exp - rows5[0].at === 30 * DAY && Ly.TTL_MS === 30 * DAY, 'get: kept 30 days');
		var c5b = Ly.createClient({ fetch: fk5, cache: Src.createCache({ store: store5, now: tf.now }), now: tf.now, wait: tf.wait });
		await c5b.get(quiet);
		h.eq(fk5.calls.length - n5, 0, 'get: a new client over the same store (a reload) asks nothing');
		clock += 31 * DAY;
		await c5b.get(quiet);
		h.ok(fk5.calls.length - n5 > 0, 'get: after 30 days it asks again');
		var fk6 = fakeLrclib(function () { return timed; });
		var c6 = Ly.createClient({ fetch: fk6, now: tf.now, wait: tf.wait });
		h.eq([await c6.get({ id: 'vidNoArtist1', title: 'Blue Signal' }), await c6.get(null), await c6.get({}), fk6.calls.length], [null, null, null, 0], 'get: a track without an artist, or nothing, asks nothing');
		var mapped = { id: 'demo-002', title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 200 };
		var c6b = Ly.createClient({ fetch: fk6, now: tf.now, wait: tf.wait });
		await c6b.get(mapped);
		var n6 = fk6.calls.length;
		clock += 29 * DAY;
		await c6b.get(mapped);
		var n6b = fk6.calls.length;
		clock += 2 * DAY;
		await c6b.get(mapped);
		h.eq([n6, n6b - n6, fk6.calls.length - n6b], [1, 0, 1], 'get: without a cache, a Map here keeps answers 30 days too');

		// one lookup in flight per song
		var release, gate = new Promise(function (r) { release = r; }), asked7 = 0;
		var c7 = Ly.createClient({ fetch: function () { asked7++; return gate.then(function () { return { ok: true, status: 200, json: function () { return Promise.resolve(timed); } }; }); }, now: tf.now, wait: tf.wait });
		var song7 = { id: 'vidBlueSig7', title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 200 };
		var pa = c7.get(song7), pb = c7.get(song7);
		h.ok(pa === pb, 'get: asked again while the first lookup is under way: the same promise');
		release();
		var both = await Promise.all([pa, pb]);
		h.eq([asked7, both[0].source.id, both[1].source.id], [1, 41, 41], 'get: one lookup in flight per song');

		// failures are not kept
		var fails = 1;
		var fk8 = fakeLrclib(function (p) { if (fails-- > 0) return new TypeError('Failed to fetch'); return p === 'get' ? timed : null; });
		var c8 = Ly.createClient({ fetch: fk8, now: tf.now, wait: tf.wait });
		var song8 = { id: 'vidBlueSig8', title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 200 };
		await h.rejects(c8.get(song8), function (e) { return e.code === 'offline' && /could not be reached/.test(e.message); }, 'get: a network failure rejects (code offline) with a sentence');
		h.eq((await c8.get(song8)).source.id, 41, 'get: a failure is not kept: the next ask looks again');
		await h.rejects(Ly.createClient({ fetch: fakeLrclib(function () { return { status: 500 }; }), now: tf.now, wait: tf.wait }).get(song8), function (e) { return e.code === 'http' && e.status === 500; }, 'get: a server error rejects (code http)');
		await h.rejects(Ly.createClient({ fetch: function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.reject(new SyntaxError('Unexpected token <')); } }); }, now: tf.now, wait: tf.wait }).search('paper lanterns'), function (e) { return e.code === 'bad-answer'; }, 'search: an answer that is not JSON rejects (code bad-answer)');
		var fk9 = fakeLrclib(function () { return { status: 429, headers: { 'retry-after': '7' } }; });
		var c9 = Ly.createClient({ fetch: fk9, now: tf.now, wait: tf.wait });
		await h.rejects(c9.search('paper lanterns'), function (e) { return e.code === 'busy' && e.status === 429 && /7 seconds/.test(e.message); }, 'search: 429 is busy, with LRCLIB\'s Retry-After in the sentence');
		await h.rejects(c9.search('other words'), null, 'search: still busy');
		h.ok(fk9.calls[1].at - fk9.calls[0].at >= 7000, 'search: after a 429 the next request waits as long as LRCLIB asked (' + (fk9.calls[1].at - fk9.calls[0].at) + ' ms)');
		var fk10 = fakeLrclib(function () { return []; });
		await Ly.createClient({ fetch: fk10, now: tf.now, wait: tf.wait, client: '' }).search('no header words');
		h.ok(fk10.calls[0].init.headers === undefined && fk10.calls[0].init.credentials === 'omit', 'createClient({ client: \'\' }) sends no Lrclib-Client header (no preflight)');

		// the search: one row per song, a snippet, kept ten minutes
		var fk11 = fakeLrclib(function () {
			return [
				rec({ id: 60, albumName: 'Night Ferry', duration: 200.4, plainLyrics: 'Under the bridge\nthe paper lanterns glow tonight above the harbour' }),
				rec({ id: 61, albumName: 'Night Ferry (Deluxe)', duration: 201, plainLyrics: null, syncedLyrics: '[00:01.00]Under the bridge\n[00:05.00]the paper lanterns glow tonight above the harbour' }),
				rec({ id: 62, trackName: 'Harbour Song', artistName: 'Glass Orchard', albumName: '', duration: null, plainLyrics: null, syncedLyrics: null, instrumental: true }),
				{ id: 63, trackName: '', artistName: 'Nobody' }, null
			];
		});
		var c11 = Ly.createClient({ fetch: fk11, now: tf.now, wait: tf.wait });
		var rows11 = await c11.search('  lanterns   glow ');
		h.eq(fk11.calls[0].q, { q: 'lanterns glow' }, 'search: api/search?q= with the words, spaces tidied');
		h.eq(rows11, [
			{ id: 61, title: 'Blue Signal', artist: 'Paper Lanterns', album: 'Night Ferry (Deluxe)', duration: 201, snippet: 'the paper lanterns glow tonight above the harbour', synced: true, instrumental: false },
			{ id: 62, title: 'Harbour Song', artist: 'Glass Orchard', album: '', duration: 0, snippet: '', synced: false, instrumental: true }
		], 'search: one row per song (the timed record kept), a snippet with the words, junk left out');
		var n11 = fk11.calls.length;
		await c11.search('Lanterns glow');
		h.eq(fk11.calls.length - n11, 0, 'search: the same words again (in any case) within ten minutes ask nothing');
		clock += 11 * 60000;
		await c11.search('lanterns glow');
		h.eq(fk11.calls.length - n11, 1, 'search: after ten minutes it asks again');
		h.eq([await c11.search('   '), await c11.search(null)], [[], []], 'search: no words, no request');

		// requests 300 ms apart
		var fk12 = fakeLrclib(function () { return []; });
		var c12 = Ly.createClient({ fetch: fk12, now: tf.now, wait: tf.wait });
		var start12 = clock;
		await Promise.all([c12.search('one two'), c12.search('three four'), c12.search('five six')]);
		h.eq(fk12.calls.map(function (x) { return x.at - start12; }), [0, 300, 600], 'requests: three asked at once leave 300 ms apart');
		clock += 1000;
		await c12.search('seven eight');
		h.eq(fk12.calls[3].at - fk12.calls[2].at, 1000, 'requests: after a quiet second the next leaves at once');
		h.eq(Ly.GAP_MS, 300, 'GAP_MS is 300');
		var c13 = Ly.createClient({ fetch: fakeLrclib(function () { return []; }) }), real0 = Date.now();
		await Promise.all([c13.search('alpha words'), c13.search('beta words')]);
		var took = Date.now() - real0;
		h.ok(took >= 290, 'requests: with the real clock, two take at least 300 ms (' + took + ' ms)');

		// configure: the fetch a client made without one uses
		var fk14 = fakeLrclib(function () { return []; });
		Ly.configure({ fetch: fk14 });
		await Ly.createClient({ now: tf.now, wait: tf.wait }).search('configured words');
		Ly.configure({ fetch: null });
		h.eq(fk14.calls.length, 1, 'configure({ fetch }): a client made without a fetch uses it; configure({ fetch: null }) puts the browser\'s back');
		h.ok(typeof Ly.panel === 'function' && typeof Ly.tick === 'function' && typeof Ly.view === 'function' && typeof Ly.searchSection === 'function' && !Ly.stub, 'the page hooks app.js calls are there, and the module is not a stub');
		Ly.tick(12, 'nothing-drawn');
		Ly.panel(null, {}, { id: 'x' });
		h.ok(true, 'tick and panel without a page do nothing (Node)');
	});
};
