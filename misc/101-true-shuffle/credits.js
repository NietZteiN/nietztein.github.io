/*
 * True Shuffle: credits. Who wrote a song, from MusicBrainz: its composer,
 * lyricist and arranger, the people who played on it, and the work behind
 * it; and the other songs a composer or lyricist wrote, as found songs, for
 * Explore's lane "More by <composer>".
 *
 *     var C = TrueShuffle.credits;
 *     var credits = C.create({ cache, index, endpoints });   // or C.forCtx(pageCtx)
 *     credits.of(track, { signal })        -> Promise<null | result>
 *     credits.byPerson(person, { signal }) -> Promise<[find]>   (the library's own marked `mine`)
 *     C.line(result)                       -> 'Music: X \u00B7 Lyrics: Y \u00B7 Arranged by Z'
 *     C.lane(ctx, seed, o)                 -> a lanes.js spec for Explore (id 'credits')
 *     C.paint(el, ctx, track)              the song page's line, into el (hidden when there is none)
 *
 *   result: { recording: { id, title, artist, durationSec }, work: { id, title } | null,
 *             composers: [{ id, name, native }], lyricists, writers, arrangers,
 *             performers: [{ id, name, native, roles }], sure, score, why }
 *
 * A song is looked up by its artist and title (and its titleAlt and the
 * artist's native name, since MusicBrainz keeps Japanese songs under their
 * own script): one recording search, then the best recording's relations
 * (inc=work-rels+artist-rels), then its work's (inc=artist-rels), where the
 * composer and the lyricist are. The best recording is the one match.js says
 * is the same song with the artist as part of the evidence, so an equal
 * title by another artist never passes; then the same recording (lengths
 * within 4 s), then the one on most releases. Three requests a song (five
 * when the best recording is linked to no work and the next one is read
 * too), kept 30 days ("nothing" 7).
 *
 * A person's other songs: one work search (arid:<id>; MusicBrainz ranks the
 * most recorded first), then recording searches for their recordings
 * (rid:(...), 100 at a time, two at most), and for each work the original
 * performer's recording: the artist whose recordings of it are on most
 * releases (a cover is on one or two). Two or three requests, kept 30 days.
 *
 * Polite to MusicBrainz: one request at a time, 1.1 s apart (2.2 s where the
 * browser sends our User-Agent, which costs a preflight each time: Firefox;
 * Chrome and Safari drop the header and identify the page by its Origin),
 * no cookies, no referrer, only artist and song names in the questions.
 * MusicBrainz's "busy" answer (503) waits and tries again. Requests go
 * through sources.js createHttp (its line, retries, breaker, offline and
 * abort), so errors are sources.js SourceError objects with host
 * 'musicbrainz'.
 *
 * The demo (?demo=1) asks nothing: `demo(track, lib)` and `demoPerson(person,
 * lib)` invent credits from the demo library, shaped exactly as the real ones.
 *
 * The source is plain ASCII: other characters are written as escapes.
 * UMD: window.TrueShuffle.credits in the browser (after match.js, library.js
 * and sources.js), module.exports in Node.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(root,
		function () { return node ? require('./match.js') : (root.TrueShuffle || {}).match; },
		function () { return node ? require('./library.js') : (root.TrueShuffle || {}).library; },
		function () { return node ? require('./sources.js') : (root.TrueShuffle || {}).sources; });
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.credits = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root, getMatch, getLibrary, getSources) {
	'use strict';

	var DAY = 86400000;
	var KEEP_MS = 30 * DAY;          // what MusicBrainz said is kept this long
	var KEEP_NONE_MS = 7 * DAY;      // and "it does not know the song" this long
	var GAP_MS = 1100;               // between two requests (MusicBrainz asks for one a second)
	var BASE = 'https://musicbrainz.org/ws/2';
	var AGENT = 'TrueShuffle/1.0 ( https://nietztein.github.io/misc/101-true-shuffle/ )';
	var SEARCH_LIMIT = 10;           // recordings read for a song
	var WORKS = 10;                  // works read for a person
	var PER_WORK = 40;               // recordings asked about per work
	var RIDS = 100;                  // recordings asked about in one search (MusicBrainz gives 100 at most)
	var BATCHES = 2;                 // and searches of them for one person
	var DOT = String.fromCharCode(0xB7);
	var OWN = Object.prototype.hasOwnProperty;

	// MusicBrainz relationship types, and where each goes in a result.
	var RECORDING_ROLES = {
		arranger: 'arrangers', 'instrument arranger': 'arrangers', 'vocal arranger': 'arrangers', orchestrator: 'arrangers',
		vocal: 'performers', instrument: 'performers', performer: 'performers', 'performing orchestra': 'performers',
		conductor: 'performers', 'chorus master': 'performers'
	};
	var WORK_ROLES = {
		composer: 'composers', lyricist: 'lyricists', librettist: 'lyricists', writer: 'writers',
		arranger: 'arrangers', 'instrument arranger': 'arrangers', 'vocal arranger': 'arrangers', orchestrator: 'arrangers'
	};
	// What a person did for a work, in the words of a find's why line.
	var DID = { composer: 'music by', lyricist: 'words by', librettist: 'words by', writer: 'written by' };
	// A recording's disambiguation, as parse.js's version kinds.
	var DISAMBIGUATION = [
		['live', /\blive\b/i], ['instrumental', /\binstrumental\b|\boff[\s-]*vocal\b/i], ['karaoke', /\bkaraoke\b/i],
		['remix', /\bremix\b|\bdj-mix(ed)?\b/i], ['acoustic', /\bacoustic\b|\bunplugged\b/i], ['demo', /\bdemo\b/i],
		['tv-size', /\btv\s*(size|version|ver)\b/i], ['short', /\bshort\s*(version|ver)\b/i], ['cover', /\bcover\b/i]
	];
	// Scripts other than Latin: Greek to Hangul Jamo, and CJK, kana, Hangul and full-width forms.
	var NON_LATIN = /[\u0370-\u1DFF\u2E80-\uFFEF]/;

	// ---- Small helpers --------------------------------------------------------------------------

	function has(o, k) { return !!o && OWN.call(o, k); }
	function str(v) { return v == null ? '' : String(v); }
	function num(v) { var n = +v; return isFinite(n) ? n : 0; }
	function arr(v) { return Array.isArray(v) ? v : []; }
	function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
	function uniq(list) {
		var out = [], seen = {};
		arr(list).forEach(function (x) { x = str(x).trim(); if (x && !has(seen, '#' + x.toLowerCase())) { seen['#' + x.toLowerCase()] = true; out.push(x); } });
		return out;
	}
	// FNV-1a: a string as a 32-bit number (the demo's choices and ids).
	function hash(s) {
		var x = 0x811c9dc5;
		s = str(s);
		for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
		return x;
	}
	function fold(s, M) { M = M || getMatch(); return M && M.fold ? M.fold(str(s)) : str(s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
	function yearOf(date) { var m = /^(\d{4})/.exec(str(date)); return m ? +m[1] : 0; }
	function stopped() {
		var Src = getSources();
		if (Src && Src.SourceError) return Src.SourceError('aborted', 'Stopped.', { host: 'musicbrainz' });
		var e = new Error('Stopped.');
		e.name = 'SourceError';
		e.code = 'aborted';
		return e;
	}

	// ---- Questions ------------------------------------------------------------------------------

	// One Lucene phrase: field:"words", with " and \ escaped.
	function phrase(field, s) { return field + ':"' + str(s).replace(/(["\\])/g, '\\$1') + '"'; }

	// The recording search for a track: any of its titles (the base title,
	// and titleAlt's) by any of its names (the credit, the native name, each
	// person in the credit). '' when there is no title or no artist.
	function searchQuery(track, M, L) {
		M = M || getMatch();
		L = L || getLibrary();
		var t = track || {};
		var titles = uniq([M.baseTitle(str(t.title)), M.baseTitle(str(t.titleAlt))]).slice(0, 2);
		var names = [str(t.artist), str(t.artistNative)];
		if (L && L.people) L.people(str(t.artist)).forEach(function (p) { names.push(p.name); });
		names = uniq(names).slice(0, 4);
		if (!titles.length || !names.length) return '';
		return '(' + titles.map(function (x) { return phrase('recording', x); }).join(' OR ') + ') AND (' +
			names.map(function (x) { return phrase('artist', x); }).join(' OR ') + ')';
	}
	// The cache key for a track's credits: its artist, base title and version.
	function keyOf(track, M) {
		M = M || getMatch();
		var t = track || {};
		return 'mb:credits:' + fold(t.artist, M) + '|' + fold(M.baseTitle(str(t.title)), M) + (t.version ? '|' + fold(t.version, M) : '');
	}

	// ---- Reading MusicBrainz's answers ----------------------------------------------------------

	// A name in Latin letters: the name itself, or for a name in another
	// script its sort name, "Kajiura, Yuki" read as "Yuki Kajiura".
	function latinName(artist) {
		var a = artist || {}, name = str(a.name).trim(), sort = str(a['sort-name']).trim();
		if (!NON_LATIN.test(name) || !sort || NON_LATIN.test(sort)) return name || sort;
		var parts = sort.split(/\s*,\s*/);
		return parts.length === 2 && a.type !== 'Group' ? parts[1] + ' ' + parts[0] : sort;
	}
	// A related artist as a person: { id, name, native }.
	function personOf(artist) {
		var a = artist || {};
		if (!a.id) return null;
		var name = latinName(a), own = str(a.name).trim();
		return { id: str(a.id), name: name, native: own && own !== name ? own : '' };
	}
	// An artist credit as one string: "A feat. B".
	function creditText(ac) {
		return arr(ac).map(function (c) { return str(c && (c.name || (c.artist && c.artist.name))) + str(c && c.joinphrase); }).join('').trim();
	}
	// Every name an artist credit is known by (the names, the Latin names, the aliases), as match.js people.
	function creditNames(ac) {
		var names = [];
		arr(ac).forEach(function (c) {
			if (!c) return;
			var a = c.artist || {};
			names.push(c.name, a.name, latinName(a));
			arr(a.aliases).forEach(function (x) { if (x && x.name) names.push(x.name); });
		});
		return uniq(names);
	}
	// The version kinds a recording's disambiguation names.
	function kindsOf(text) {
		var out = [];
		DISAMBIGUATION.forEach(function (k) { if (k[1].test(str(text))) out.push(k[0]); });
		return out;
	}
	// A recording from a search, as something match.js compares.
	function candidateOf(rec, M) {
		M = M || getMatch();
		var r = rec || {}, title = str(r.title);
		var kinds = str(M.signature({ title: title }).ver).split('+').concat(kindsOf(r.disambiguation));
		return {
			id: str(r.id), title: title, artist: creditText(r['artist-credit']),
			people: creditNames(r['artist-credit']).map(function (n) { return { name: n }; }),
			durationSec: r.length ? Math.round(num(r.length) / 1000) : 0,
			version: uniq(kinds).join('+'),
			releases: arr(r.releases).length, first: str(r['first-release-date']), video: !!r.video,
			mbScore: num(r.score), disambiguation: str(r.disambiguation)
		};
	}
	// Version kinds as one comparable string.
	function versionKey(v) { return str(v).split(/[+,\s]+/).filter(function (k) { return k && k !== 'remaster'; }).sort().join('+'); }
	// The recordings of a search that are this track's song, best first:
	// match.js sameSong reaches SAME with the artist (or a person of it) as
	// evidence; then the same recording, the track's own version (no live
	// take or TV size for a studio upload), not a video, on more releases, a
	// better search score, a better match, released earlier.
	// -> [{ rec, cand, match }]
	function rankRecordings(track, recordings, M) {
		M = M || getMatch();
		var out = [], own = versionKey(M.signature(track || {}).ver);
		arr(recordings).forEach(function (rec) {
			if (!rec || !rec.id) return;
			var cand = candidateOf(rec, M), m = M.sameSong(track, cand);
			if (!m.same || !(m.why.indexOf('artist') >= 0 || m.why.indexOf('person') >= 0)) return;
			out.push({ rec: rec, cand: cand, match: m, sameVersion: versionKey(cand.version) === own });
		});
		out.sort(function (a, b) {
			return (b.match.sameRecording - a.match.sameRecording) || (b.sameVersion - a.sameVersion) || (a.cand.video - b.cand.video) ||
				(b.cand.releases - a.cand.releases) || (b.cand.mbScore - a.cand.mbScore) ||
				(b.match.score - a.match.score) || ((a.cand.first || '9999') < (b.cand.first || '9999') ? -1 : (a.cand.first || '9999') > (b.cand.first || '9999') ? 1 : 0);
		});
		return out;
	}
	// The work a recording performs: { id, title, attributes } or null (a
	// whole performance before a partial one or a medley).
	function workOf(recJson) {
		var best = null;
		arr(recJson && recJson.relations).forEach(function (r) {
			if (!r || r.type !== 'performance' || !r.work || !r.work.id) return;
			var attrs = arr(r.attributes).map(str), part = attrs.indexOf('partial') >= 0 || attrs.indexOf('medley') >= 0;
			if (!best || (best.part && !part)) best = { id: str(r.work.id), title: str(r.work.title), attributes: attrs, part: part };
		});
		if (!best) return null;
		delete best.part;
		return best;
	}
	// The people of a recording's relations and its work's: composers,
	// lyricists, writers, arrangers (both), performers (the recording's, each
	// once with every role: 'lead vocals', 'guitar', 'conductor' ...).
	function relationsOf(recJson, workJson) {
		var out = { composers: [], lyricists: [], writers: [], arrangers: [], performers: [] };
		function add(kind, rel) {
			var p = personOf(rel.artist);
			if (!p) return;
			var list = out[kind], role = kind === 'performers' ? (arr(rel.attributes).filter(function (x) { return x && !/^(additional|guest|solo)$/.test(x); }).join(' ') || rel.type) : '';
			var have = list.filter(function (x) { return x.id === p.id; })[0];
			if (kind !== 'performers') { if (!have) list.push(p); return; }
			if (have) { if (have.roles.indexOf(role) < 0) have.roles.push(role); return; }
			p.roles = [role];
			list.push(p);
		}
		arr(workJson && workJson.relations).forEach(function (r) { if (r && r.artist && has(WORK_ROLES, r.type)) add(WORK_ROLES[r.type], r); });
		arr(recJson && recJson.relations).forEach(function (r) { if (r && r.artist && has(RECORDING_ROLES, r.type)) add(RECORDING_ROLES[r.type], r); });
		return out;
	}

	// ---- The line on a song's page ----------------------------------------------------------------

	function names(list, most) {
		var n = arr(list).map(function (p) { return str(p && p.name); }).filter(Boolean);
		most = most || 3;
		if (n.length > most) return n.slice(0, most).join(', ') + ' and ' + (n.length - most) + ' more';
		return n.length > 1 ? n.slice(0, -1).join(', ') + ' & ' + n[n.length - 1] : n.join('');
	}
	function samePeople(a, b) {
		var x = arr(a).map(function (p) { return p.id; }).sort().join(' '), y = arr(b).map(function (p) { return p.id; }).sort().join(' ');
		return !!x && x === y;
	}
	// "Music: X \u00B7 Lyrics: Y \u00B7 Arranged by Z" ('Music and lyrics: X'
	// when one person wrote both; 'Written by X' when MusicBrainz only says
	// "writer"). '' for nothing. o: { most (3 names a role), dot }
	function line(result, o) {
		o = o || {};
		var r = result || {}, out = [], most = o.most || 3;
		var c = arr(r.composers), l = arr(r.lyricists), w = arr(r.writers), a = arr(r.arrangers);
		if (c.length && samePeople(c, l)) out.push('Music and lyrics: ' + names(c, most));
		else {
			if (c.length) out.push('Music: ' + names(c, most));
			if (l.length) out.push('Lyrics: ' + names(l, most));
		}
		if (!c.length && !l.length && w.length) out.push('Written by ' + names(w, most));
		if (a.length) out.push('Arranged by ' + names(a, most));
		return out.join(' ' + (o.dot || DOT) + ' ');
	}
	// The person "More by" is about: the first composer, else a writer, else
	// the first lyricist; one who is not the song's own performer first.
	function personFor(result, artist, M) {
		var r = result || {}, own = fold(artist, M);
		var list = arr(r.composers).concat(arr(r.writers), arr(r.lyricists));
		var other = list.filter(function (p) { return fold(p.name, M) !== own && fold(p.native, M) !== own; })[0];
		return other || list[0] || null;
	}

	// ---- A person's songs -------------------------------------------------------------------------

	// The works of a work search that the person wrote (composer, lyricist,
	// writer or librettist), with up to PER_WORK of their recordings to ask
	// about: not videos, no version in the title (instrumental, TV size ...),
	// the ones titled as the work first.
	// -> [{ id, title, did: ['composer', ...], rids: [ids] }]
	function worksOf(json, personId, M) {
		M = M || getMatch();
		var out = [];
		arr(json && json.works).forEach(function (w) {
			if (!w || !w.id) return;
			var did = [], recs = [];
			arr(w.relations).forEach(function (r) {
				if (!r) return;
				if (r.artist && r.artist.id === personId && has(DID, r.type) && did.indexOf(r.type) < 0) did.push(r.type);
				if (r.type === 'performance' && r.recording && r.recording.id && !r.recording.video && !M.signature({ title: str(r.recording.title) }).ver) recs.push(r.recording);
			});
			if (!did.length) return;
			var key = fold(M.baseTitle(str(w.title)), M);
			recs.sort(function (a, b) { return (fold(M.baseTitle(str(b.title)), M) === key) - (fold(M.baseTitle(str(a.title)), M) === key); });
			out.push({ id: str(w.id), title: str(w.title), did: did, rids: recs.slice(0, PER_WORK).map(function (r) { return str(r.id); }) });
		});
		return out;
	}
	// The rid:(...) questions for some works' recordings: RIDS ids each, at
	// most BATCHES of them, the works taking turns so each gets its first
	// recordings asked about.
	function ridQueries(works) {
		var rids = [], seen = {}, most = RIDS * BATCHES, list = arr(works), more = true;
		for (var i = 0; more && rids.length < most; i++) {
			more = false;
			for (var j = 0; j < list.length && rids.length < most; j++) {
				var id = arr(list[j].rids)[i];
				if (id == null) continue;
				more = true;
				if (!has(seen, id)) { seen[id] = true; rids.push(id); }
			}
		}
		var out = [];
		for (var k = 0; k < rids.length; k += RIDS) out.push('rid:(' + rids.slice(k, k + RIDS).join(' OR ') + ')');
		return out;
	}
	// Each work's recording as a find (sources.js shape, source 'musicbrainz',
	// no videoId). Of the recordings asked about, the original performer's:
	// the artist whose recordings of the work are on most releases (a cover
	// is on one or two), earliest first; then their recording that is no
	// other version, on most releases, released earliest.
	function findsOf(works, recJson, person, M) {
		M = M || getMatch();
		var Src = getSources(), byId = {};
		arr(recJson && recJson.recordings).forEach(function (r) { if (r && r.id) byId[r.id] = r; });
		var out = [];
		function earlier(a, b) { a = a || '9999'; b = b || '9999'; return a < b ? -1 : a > b ? 1 : 0; }
		arr(works).forEach(function (w) {
			var recs = w.rids.map(function (id) { return byId[id]; }).filter(Boolean);
			if (!recs.length) return;
			var c = recs.map(function (r) { return { r: r, c: candidateOf(r, M) }; }), by = {}, groups = [];
			c.forEach(function (x) {
				var k = '#' + fold(x.c.artist, M);
				if (!has(by, k)) { by[k] = { n: 0, first: '', items: [] }; groups.push(by[k]); }
				by[k].n += Math.max(1, x.c.releases);
				if (!by[k].first || earlier(x.c.first, by[k].first) < 0) by[k].first = x.c.first;
				by[k].items.push(x);
			});
			groups.sort(function (a, b) { return (b.n - a.n) || earlier(a.first, b.first); });
			var mine = groups[0].items.slice().sort(function (a, b) { return (!!a.c.version - !!b.c.version) || (b.c.releases - a.c.releases) || earlier(a.c.first, b.c.first); });
			var best = mine[0], r = best.r, rel = arr(r.releases).slice().sort(function (a, b) { return earlier(str(a.date), str(b.date)); })[0];
			var did = w.did.indexOf('composer') >= 0 ? 'composer' : w.did[0];
			var f = {
				key: 'mb:rec:' + best.c.id, videoId: null, title: best.c.title, titleAlt: fold(w.title, M) !== fold(best.c.title, M) ? w.title : '',
				artist: best.c.artist, people: creditNames(r['artist-credit']), album: str(rel && rel.title),
				year: yearOf(best.c.first), durationSec: best.c.durationSec, version: best.c.version,
				source: 'musicbrainz', ids: { mb: best.c.id, mbWork: w.id },
				why: [['credit', DID[did] + ' ' + str(person && person.name)]]
			};
			out.push(Src && Src.find ? Src.find(f) : f);
		});
		return out;
	}
	// The library's copy of each find (match.js inLibrary, the same song and
	// not another version of it), as `mine`; new objects, the given ones untouched.
	function markMine(finds, ix, M) {
		M = M || getMatch();
		return arr(finds).map(function (f) {
			var x = {};
			for (var k in f) if (has(f, k)) x[k] = f[k];
			var probe = { title: x.title, titleAlt: x.titleAlt, artist: x.artist, durationSec: x.durationSec, version: x.version, people: arr(x.people).map(function (n) { return { name: n }; }) };
			var hit = ix && M.inLibrary ? M.inLibrary(ix, probe) : null;
			x.mine = hit && hit.why.indexOf('other-version') < 0 ? hit.id : (x.mine || null);
			x.sameRecording = !!(hit && hit.sameRecording);
			return x;
		});
	}

	// ---- The demo ---------------------------------------------------------------------------------

	// Invented composers, lyricists and arrangers, and the singers and titles
	// of the invented songs; words demo.js never uses, so they meet no library song.
	var DEMO_WRITERS = ['Odile Brackwater', 'Teodor Quillmere', 'Sachi Amagiri', 'Rufus Pellbrook', 'Nadia Fenwhistle', 'Ilka Morrowind'];
	var DEMO_SINGERS = ['Wrenna Calloway', 'The Juniper Coats', 'Linnet Hollis', 'Kestrel Ostrander'];
	var DEMO_TITLES = ['Tamarind Hour', 'Ochre Waltz', 'Marigold Line', 'Heron Song', 'Lilac Bridges', 'Thistle Road', 'Peregrine Air', 'Bramble Coda'];
	function demoWriter(i) { return { id: 'demo-writer-' + (i + 1), name: DEMO_WRITERS[i], native: '' }; }
	// Invented credits for a demo track: its artist's composer, a lyricist and
	// an arranger, all from DEMO_WRITERS, the same every time. null without an
	// artist or a title.
	function demoCredits(track, M) {
		M = M || getMatch();
		var t = track || {}, artist = str(t.artist).trim(), title = str(t.title).trim();
		if (!artist || !title) return null;
		var n = DEMO_WRITERS.length, a = hash('c|' + fold(artist, M)) % n, words = hash('l|' + fold(artist, M) + '|' + fold(title, M)) % 3 ? a : (a + 1) % n;
		var h = hash(fold(artist, M) + '|' + fold(M.baseTitle(title), M));
		return {
			recording: { id: 'demo-rec-' + h, title: title, artist: artist, durationSec: num(t.durationSec) },
			work: { id: 'demo-work-' + h, title: M.baseTitle(title) || title },
			composers: [demoWriter(a)], lyricists: [demoWriter(words)], writers: [], arrangers: [demoWriter((a + 2 + h % 3) % n)],
			performers: [{ id: 'demo-artist-' + hash(fold(artist, M)), name: artist, native: '', roles: ['lead vocals'] }],
			sure: true, score: 9, why: ['title', 'artist', 'length'], demo: true
		};
	}
	// An invented person's songs: the demo library's songs they are credited
	// with (mine), then three invented ones (videoId null, mine null), as finds.
	function demoPerson(person, lib, M) {
		M = M || getMatch();
		var Src = getSources(), id = str(person && person.id), out = [], seen = {};
		if (!/^demo-writer-/.test(id) || !lib) return [];
		var tracks = lib.tracks && typeof lib.tracks === 'object' ? Object.keys(lib.tracks).map(function (k) { return lib.tracks[k]; }) : arr(lib);
		tracks.slice().sort(function (a, b) { return num(b.plays) - num(a.plays) || (a.id < b.id ? -1 : 1); }).forEach(function (t) {
			if (out.length >= 8 || !t || !t.artist) return;
			var c = demoCredits(t, M);
			if (!c || has(seen, c.work.id)) return;
			var did = c.composers[0].id === id ? 'composer' : c.lyricists[0].id === id ? 'lyricist' : '';
			if (!did) return;
			seen[c.work.id] = true;
			out.push({ key: 'mb:rec:' + c.recording.id, videoId: null, title: str(t.title), artist: str(t.artist), people: [str(t.artist)], album: str(t.album),
				year: num(t.year), durationSec: num(t.durationSec), source: 'musicbrainz', ids: { mb: c.recording.id, mbWork: c.work.id },
				why: [['credit', DID[did] + ' ' + str(person.name)]], mine: t.id, demo: true });
		});
		var h = hash(id);
		for (var i = 0; i < 3; i++) {
			var title = DEMO_TITLES[(h + i * 3) % DEMO_TITLES.length], singer = DEMO_SINGERS[(h + i) % DEMO_SINGERS.length], rid = 'demo-rec-' + hash(id + '|' + i);
			out.push({ key: 'mb:rec:' + rid, videoId: null, title: title, artist: singer, people: [singer], album: '', year: 2010 + (h + i * 4) % 15,
				durationSec: 180 + (h >> (i * 4)) % 120, source: 'musicbrainz', ids: { mb: rid, mbWork: 'demo-work-' + hash(id + '|w|' + i) },
				why: [['credit', 'music by ' + str(person.name)]], mine: null, demo: true });
		}
		return out.map(function (f) { return Src && Src.find ? Src.find(f) : f; });
	}

	// ---- The network ------------------------------------------------------------------------------

	// Will this browser send our User-Agent (Firefox), and so a preflight with each request?
	function agentAllowed() {
		try { return typeof root.Request === 'function' && new root.Request(BASE + '/', { headers: { 'User-Agent': AGENT } }).headers.has('User-Agent'); } catch (e) { return false; }
	}
	// A sources.js http with one line for MusicBrainz. o: { fetch, now, sleep,
	// onLine, base, agent (send the User-Agent: by default where the browser
	// allows it), gapMs }
	function createLine(o) {
		o = o || {};
		var Src = getSources();
		var doFetch = o.fetch || (root.fetch ? root.fetch.bind(root) : null);
		var agent = o.agent == null ? agentAllowed() : !!o.agent;
		var gap = o.gapMs != null ? +o.gapMs : agent && root.document ? 2 * GAP_MS : GAP_MS;
		var hosts = { musicbrainz: { base: str(o.base || BASE).replace(/\/+$/, ''), gap: gap, at: 1, tries: 3, pauseOn: [503, 429], pauseMs: 4000, name: 'MusicBrainz' } };
		return Src.createHttp({
			fetch: doFetch ? function (url, init) {
				if (agent && init && init.headers) init.headers['User-Agent'] = AGENT;
				return doFetch(url, init);
			} : null,
			now: o.now, sleep: o.sleep, onLine: o.onLine, hosts: hosts
		});
	}

	// ---- The credits object -----------------------------------------------------------------------

	// deps: { http (a createLine() http, else one is made from fetch, now,
	//         sleep, onLine, base, agent, gapMs), cache (sources.js createCache,
	//         or a function giving it; else one in memory), index() (match.js
	//         index of the library, for mine), M, L, now }
	function create(deps) {
		deps = deps || {};
		var M = deps.M || getMatch(), L = deps.L || getLibrary(), Src = getSources();
		var http = deps.http || createLine(deps);
		var mem = null;
		function cache() {
			var c = typeof deps.cache === 'function' ? deps.cache() : deps.cache;
			if (c) return c;
			if (!mem) mem = Src.createCache({ now: deps.now });
			return mem;
		}
		function index() { return typeof deps.index === 'function' ? deps.index() : deps.index || null; }
		function get(path, query, signal) { return http.get('musicbrainz', path, { query: Object.assign({ fmt: 'json' }, query), signal: signal }); }

		// One recording's relations and its work's -> a result.
		function detail(c, signal) {
			return get('/recording/' + encodeURIComponent(c.cand.id), { inc: 'work-rels+artist-rels' }, signal).then(function (rec) {
				var w = workOf(rec);
				var wp = w ? get('/work/' + encodeURIComponent(w.id), { inc: 'artist-rels' }, signal).then(null, function (e) { if (e && e.code === 'aborted') throw e; return null; }) : Promise.resolve(null);
				return wp.then(function (work) {
					var rel = relationsOf(rec, work);
					return {
						recording: { id: c.cand.id, title: str(rec && rec.title) || c.cand.title, artist: c.cand.artist, durationSec: c.cand.durationSec },
						work: w ? { id: w.id, title: str(work && work.title) || w.title } : null,
						composers: rel.composers, lyricists: rel.lyricists, writers: rel.writers, arrangers: rel.arrangers, performers: rel.performers,
						sure: c.match.score >= M.STRONG, score: c.match.score, why: c.match.why.slice()
					};
				});
			});
		}
		function lookUp(track, signal) {
			var q = searchQuery(track, M, L);
			if (!q) return Promise.resolve(null);
			return get('/recording', { query: q, limit: SEARCH_LIMIT }, signal).then(function (j) {
				var ranked = rankRecordings(track, j && j.recordings, M);
				if (!ranked.length) return null;
				return detail(ranked[0], signal).then(function (d) {
					if (d.work || ranked.length < 2) return d;
					// the best recording is linked to no work: the next one may be
					return detail(ranked[1], signal).then(function (d2) { return d2.work ? d2 : d; }, function (e) { if (e && e.code === 'aborted') throw e; return d; });
				});
			});
		}

		return {
			// -> Promise<null | result> (null: no recording of this song by this artist)
			of: function (track, o) {
				o = o || {};
				if (o.signal && o.signal.aborted) return Promise.reject(stopped());
				if (!track || !str(track.title).trim() || !(str(track.artist).trim() || str(track.artistNative).trim())) return Promise.resolve(null);
				return cache().wrap(keyOf(track, M), KEEP_MS, function () { return lookUp(track, o.signal); }, { negTtlMs: KEEP_NONE_MS, signal: o.signal }).then(function (r) { return r ? copy(r) : null; });
			},
			// person: { id, name } (a result's composer, lyricist ...). -> Promise<[find]>, the library's own with `mine`.
			byPerson: function (person, o) {
				o = o || {};
				if (o.signal && o.signal.aborted) return Promise.reject(stopped());
				var id = str(person && person.id);
				if (!/^[0-9a-f-]{36}$/i.test(id)) return Promise.resolve([]);
				return cache().wrap('mb:person:' + id, KEEP_MS, function () {
					return get('/work', { query: 'arid:' + id, limit: WORKS }, o.signal).then(function (j) {
						var works = worksOf(j, id, M), qs = ridQueries(works);
						if (!qs.length) return [];
						return Promise.all(qs.map(function (q) { return get('/recording', { query: q, limit: RIDS }, o.signal); })).then(function (answers) {
							var all = [];
							answers.forEach(function (a) { all = all.concat(arr(a && a.recordings)); });
							return findsOf(works, { recordings: all }, person, M);
						});
					});
				}, { negTtlMs: KEEP_NONE_MS, signal: o.signal }).then(function (list) { return markMine(list || [], index(), M); });
			},
			line: line,
			demo: function (track) { return demoCredits(track, M); },
			demoPerson: function (person, lib) { return markMine(demoPerson(person, lib, M), null, M); },
			http: http
		};
	}

	// One credits object per page context (explore.js's lanes, the song page).
	var inst = { ctx: null, obj: null };
	function forCtx(ctx) {
		if (inst.ctx === ctx && inst.obj) return inst.obj;
		var ep = ctx && ctx.endpoints ? ctx.endpoints() : null, M = getMatch();
		inst = { ctx: ctx, obj: create({
			base: ep && ep.mb ? ep.mb : BASE,
			cache: function () { return ctx && ctx.cache ? ctx.cache() : null; },
			index: function () { return ctx.libIndex ? ctx.libIndex() : M.index(ctx.L.list(ctx.lib())); },
			L: ctx && ctx.L, now: ctx && ctx.now
		}) };
		return inst.obj;
	}

	// The song page's line: el gets line(of(track)) as its text and shows, or
	// stays hidden when MusicBrainz says nothing (or cannot be asked). The
	// demo's invented credits in the demo. -> Promise<the line or ''>; never rejects.
	function paint(el, ctx, track, o) {
		if (!el) return Promise.resolve('');
		el.hidden = true;
		var got;
		try { got = ctx && ctx.demo ? Promise.resolve(demoCredits(track)) : ((o && o.credits) || forCtx(ctx)).of(track, o); } catch (e) { got = Promise.reject(e); }
		return got.then(function (r) {
			var s = line(r);
			if (s) { el.textContent = s; el.title = 'Credits from MusicBrainz'; el.hidden = false; }
			return s;
		}, function () { return ''; });
	}

	// ---- Explore's lane: "More by <composer>" ------------------------------------------------------

	// A lanes.js spec for an Explore seed (explore.js seedOf). o: { compact,
	// credits (a create() object; by default forCtx(ctx)) }.
	// data: { items: [find], person, credits, sub: the credits line }.
	function lane(ctx, seed, o) {
		o = o || {};
		var M = getMatch(), X = root.TrueShuffle && root.TrueShuffle.explore, s = seed || {};
		var href = X && X.hrefOf ? X.hrefOf(s.track ? { track: s.track } : s.find || s) : '';
		// a library song as it is; a found song, or one whose artist is only guessed, by the seed's names
		// (match.js still checks that artist against MusicBrainz's credit)
		var track = s.track && str(s.track.artist).trim() ? s.track : { id: s.videoId || (s.find && s.find.key) || '', title: s.title, titleAlt: s.titleAlt, artist: s.artist, artistNative: s.native, durationSec: s.durationSec, version: (s.track && s.track.version) || '' };
		return {
			id: 'credits', badge: ['ext', 'MusicBrainz'],
			title: function (d) { return d && d.person ? 'More by ' + d.person.name : 'More by its composer'; },
			sub: 'from MusicBrainz',
			layout: o.compact ? 'rows' : 'cards', limit: o.compact ? 3 : 12, lazy: true,
			key: 'x:credits:' + fold(s.artist, M) + ':' + fold(s.title, M),
			seeAll: o.compact && href ? { href: href + '?lane=credits', label: 'See all' } : null,
			unavailable: function () {
				if (!s.title || !s.artist || s.kind === 'artist') return { text: 'This song has no sure artist and title to look up.', fix: null };
				if (!ctx.demo && !o.credits && !root.fetch) return { text: 'Looking up who wrote a song needs a network.', fix: null };
				return null;
			},
			empty: function (d) {
				if (d && d.credits && !d.person) return 'MusicBrainz knows this song but not who wrote it.';
				if (d && d.person) return 'MusicBrainz has no other songs by ' + d.person.name + '.';
				return 'MusicBrainz does not know this song yet.';
			},
			load: function (signal) {
				var C = ctx.demo ? null : o.credits || forCtx(ctx);
				var got = ctx.demo ? Promise.resolve(demoCredits(track, M)) : C.of(track, { signal: signal });
				return got.then(function (r) {
					if (!r) return { items: [], credits: null, person: null };
					var p = personFor(r, s.artist, M), sub = line(r) || 'from MusicBrainz';
					if (!p) return { items: [], credits: r, person: null, sub: sub };
					var more = ctx.demo ? Promise.resolve(markMine(demoPerson(p, ctx.lib(), M), null, M)) : C.byPerson(p, { signal: signal });
					return more.then(function (list) {
						var items = list.filter(function (f) { return !(r.work && f.ids && f.ids.mbWork === r.work.id) && !(f.mine && s.track && f.mine === s.track.id); });
						return { items: items, total: items.length, person: p, credits: r, sub: sub };
					});
				});
			}
		};
	}

	return {
		create: create, forCtx: forCtx, lane: lane, line: line, paint: paint, createLine: createLine,
		searchQuery: searchQuery, keyOf: keyOf, latinName: latinName, creditText: creditText, creditNames: creditNames,
		candidateOf: candidateOf, rankRecordings: rankRecordings, workOf: workOf, relationsOf: relationsOf, personFor: personFor,
		worksOf: worksOf, ridQueries: ridQueries, findsOf: findsOf, markMine: markMine, demoCredits: demoCredits, demoPerson: demoPerson,
		BASE: BASE, AGENT: AGENT, KEEP_MS: KEEP_MS, KEEP_NONE_MS: KEEP_NONE_MS, GAP_MS: GAP_MS
	};
});
