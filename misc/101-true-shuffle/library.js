/*
 * True Shuffle: the library model.
 *
 * A library is one plain object that survives JSON:
 *
 *   { version, tracks: { id: track }, playlists: { id: playlist },
 *     aliases: { key: 'Canonical Name' }, channelRules: { channelKey: rule },
 *     genres: { artist: { artistKey: [..] }, channel: { channelKey: [..] },
 *               mb: { artistKey: { genres, mbid, at } } },
 *     settings: { minConfidence } }
 *
 * and a track is
 *
 *   { id, title, artist, artistKey, version, versionText, feat, album, trackNo,
 *     channel, channelId, durationSec, publishedAt, year, yearSource, decade,
 *     addedAt: { playlistId: ISO date }, playlists: [playlistId],
 *     genres, topics, embeddable, removed, removedReason, playerError,
 *     rating, plays, skips, lastPlayed, blocked, tags, userEdits,
 *     raw: { title, channel }, guess: { artist, title, rule, confidence },
 *     run: { key, n } | null, live, categoryId, fetchedAt }
 *
 * The fields a person can correct (title, artist, version, year, genres) are
 * derived: derive() computes them from the raw title and channel through
 * parse.js, then the channel's rule, the artist aliases, the genre overrides
 * and finally track.userEdits, which always wins. Nothing here deletes a
 * track or an edit by itself, and a refresh from YouTube (upsert) touches
 * only what YouTube knows: ratings, play counts, history and corrections stay.
 *
 * Every function that changes the library returns the ids it changed, so the
 * page can write just those to the store.
 *
 * UMD: window.TrueShuffle.library in the browser, module.exports in Node.
 * Pure: no DOM, no network; the clock is passed in (`now`, milliseconds).
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(node ? require('./parse.js') : (root.TrueShuffle || {}).parse);
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.library = api; }
})(typeof self !== 'undefined' ? self : this, function (Parse) {
	'use strict';

	var VERSION = 1;
	var DAY = 86400000;

	// ---- Genres ------------------------------------------------------------------

	// YouTube's topicDetails.topicCategories are Wikipedia addresses such as
	// https://en.wikipedia.org/wiki/Rock_music. This is the one table from the
	// last part of the address to a short genre name. null means "says nothing
	// about the genre": "Music" alone is the parent topic of every music video.
	var GENRE_TOPICS = {
		'Music': null,
		'Rock_music': 'Rock',
		'Pop_music': 'Pop',
		'Hip_hop_music': 'Hip hop',
		'Electronic_music': 'Electronic',
		'Independent_music': 'Indie',
		'Jazz': 'Jazz',
		'Classical_music': 'Classical',
		'Country_music': 'Country',
		'Rhythm_and_blues': 'R&B',
		'Soul_music': 'Soul',
		'Reggae': 'Reggae',
		'Christian_music': 'Christian',
		'Music_of_Asia': 'Asian',
		'Music_of_Latin_America': 'Latin',
		// Topics YouTube also attaches to music videos that are not genres.
		'Entertainment': null,
		'Film': null,
		'Television_program': null,
		'Performing_arts': null,
		'Video_game_culture': null,
		'Action_game': null,
		'Role-playing_video_game': null,
		'Lifestyle_(sociology)': null,
		'Society': null,
		'Knowledge': null,
		'Hobby': null,
		'Humour': null
	};

	// ['https://en.wikipedia.org/wiki/Rock_music', '.../Music'] -> ['Rock'].
	// Several genres per track are normal. [] means unknown.
	function genresFromTopics(urls) {
		var out = [];
		(urls || []).forEach(function (u) {
			var m = /\/wiki\/([^/?#]+)$/.exec(String(u || ''));
			if (!m) return;
			var slug = m[1], name;
			try { slug = decodeURIComponent(slug); } catch (e) { /* keep as it is */ }
			if (Object.prototype.hasOwnProperty.call(GENRE_TOPICS, slug)) name = GENRE_TOPICS[slug];
			else if (/_music$/.test(slug)) name = slug.replace(/_music$/, '').replace(/_/g, ' ');   // a music topic this table has not met
			else name = null;
			if (name && out.indexOf(name) < 0) out.push(name);
		});
		return out;
	}

	// ---- Names ---------------------------------------------------------------------

	function str(v) { return v == null ? '' : String(v); }
	function iso(ms) { return new Date(ms == null ? Date.now() : ms).toISOString(); }
	function time(v) { var t = v ? Date.parse(v) : NaN; return isNaN(t) ? 0 : t; }

	// The key two spellings of one artist share: no case, no accents, no
	// punctuation, no leading "The", "&" the same as "and".
	function normArtist(name) {
		var s = str(name).normalize('NFKD').replace(/[\u0300-\u036F]/g, '').toLowerCase();
		s = s.replace(/&/g, ' and ').replace(/^\s*the\s+/, '');
		return s.replace(/[^\p{L}\p{N}]+/gu, '');
	}
	function normTitle(title) { return Parse.fold(title); }
	// The people in an artist credit, for "also sung by" and the voice-actor pages:
	// 'A & B', 'A feat. B', 'Character (CV: Voice actor)' (a CV list may hold several,
	// and full-width brackets count). -> [{ name, key, as }], as being 'cv' for a voice
	// actor, 'character' for the part voiced, '' for a plain artist.
	var IDEO_COMMA = String.fromCharCode(0x3001);
	function people(credit) {
		var s = str(credit).normalize('NFKC'), parts = [], cur = '', depth = 0, out = [], seen = {};
		for (var i = 0; i < s.length; i++) {
			var ch = s.charAt(i);
			if (ch === '(') depth++;
			else if (ch === ')' && depth > 0) depth--;
			if (depth === 0) {
				// a comma splits only a list of characters ('A (CV: X), B (CV: Y)'), so names
				// such as 'Earth, Wind & Fire' keep theirs
				var m = /^( & | feat[.] | ft[.] | featuring )/i.exec(s.slice(i)) || (/[)] *$/.test(cur) && /^, /.exec(s.slice(i)) ? [', ', ', '] : null);
				if (m) { parts.push(cur); cur = ''; i += m[1].length - 1; continue; }
			}
			cur += ch;
		}
		parts.push(cur);
		function add(name, as) {
			name = name.trim();
			var k = normArtist(name);
			if (!k || seen[k + '|' + as]) return;
			seen[k + '|' + as] = true;
			out.push({ name: name, key: k, as: as });
		}
		// Plain names wait: in 'A, B & C (CV: X, Y & Z)' they are characters, paired in order.
		var pending = [];
		function flush() { pending.forEach(function (n) { add(n, ''); }); pending = []; }
		parts.forEach(function (p) {
			var cv = /^(.*?) *[(] *(?:CV|C[.]V[.]) *[:.]? *(.+?)[)] *$/i.exec(p.trim());
			if (!cv) { pending.push(p); return; }
			var voices = cv[2].split(new RegExp(' & |, |' + IDEO_COMMA)).map(function (n) { return n.trim(); }).filter(Boolean), names = [];
			pending.forEach(function (x) { names = names.concat(x.split(', ')); });
			if (cv[1] && voices.length > 1 && names.length + 1 === voices.length) {
				names.concat([cv[1]]).forEach(function (c, i) { add(c, 'character'); add(voices[i], 'cv'); });
				pending = [];
				return;
			}
			flush();
			if (cv[1]) add(cv[1], 'character');
			voices.forEach(function (n) { add(n, 'cv'); });
		});
		flush();
		return out;
	}

	// Text for searching: folded, but words stay apart.
	function foldText(s) {
		return str(s).normalize('NFKD').replace(/[\u0300-\u036F]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
	}

	// The artist a name stands for once the user's aliases are applied.
	function artistOf(lib, name) {
		var key = normArtist(name);
		var canon = key && lib.aliases[key];
		if (canon) return { name: canon, key: normArtist(canon) };
		return { name: str(name).trim(), key: key };
	}

	// The name a channel goes by, as an artist would be written: "Paper
	// Lanterns" for PaperLanternsVEVO; '' for "Various Artists - Topic".
	function channelName(t) {
		var info = Parse.channelInfo(str(t.channel || (t.raw && t.raw.channel)));
		if (info.kind === 'various' || info.kind === 'none') return '';
		return info.name || info.raw;
	}

	function channelKey(t) {
		if (!t) return '';
		var id = str(t.channelId), name = str(t.channel || (t.raw && t.raw.channel));
		return id || (name ? 'name:' + Parse.fold(name) : '');
	}

	// ---- Durations and dates -----------------------------------------------------

	// 'PT1H2M3S' -> 3723. A live stream ('P0D') is 0.
	function parseDuration(isoDuration) {
		var m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(str(isoDuration));
		if (!m) return 0;
		return Math.round((+m[1] || 0) * 604800 + (+m[2] || 0) * 86400 + (+m[3] || 0) * 3600 + (+m[4] || 0) * 60 + (+m[5] || 0));
	}

	var LENGTH_CLASSES = [
		{ key: 'short', name: 'Under 2:30', min: 1, max: 149 },
		{ key: 'medium', name: '2:30 to 5:00', min: 150, max: 300 },
		{ key: 'long', name: '5 to 10 minutes', min: 301, max: 600 },
		{ key: 'epic', name: 'Over 10 minutes', min: 601, max: Infinity },
		{ key: 'unknown', name: 'Length unknown', min: 0, max: 0 }
	];
	function lengthClass(sec) {
		sec = +sec || 0;
		for (var i = 0; i < LENGTH_CLASSES.length; i++) if (sec >= LENGTH_CLASSES[i].min && sec <= LENGTH_CLASSES[i].max) return LENGTH_CLASSES[i].key;
		return 'unknown';
	}

	function decadeOf(year) {
		year = +year;
		return year >= 1000 && year <= 2999 ? Math.floor(year / 10) * 10 + 's' : '';
	}

	// The first time a track was added to any playlist.
	function firstAdded(track) {
		var best = 0;
		for (var k in track.addedAt) { var t = time(track.addedAt[k]); if (t && (!best || t < best)) best = t; }
		return best;
	}
	function lastAdded(track) {
		var best = 0;
		for (var k in track.addedAt) { var t = time(track.addedAt[k]); if (t > best) best = t; }
		return best;
	}

	// ---- The library ---------------------------------------------------------------

	function create() {
		return {
			version: VERSION,
			tracks: {},
			playlists: {},
			aliases: {},
			channelRules: {},
			genres: { artist: {}, channel: {}, mb: {} },
			profiles: {},
			settings: { minConfidence: 0.6 }
		};
	}

	// A stored library (or part of one) with every field in place.
	function load(data) {
		var lib = create(), d = data && typeof data === 'object' ? data : {};
		var k;
		if (d.tracks && typeof d.tracks === 'object') {
			var list = Array.isArray(d.tracks) ? d.tracks : Object.keys(d.tracks).map(function (id) { return d.tracks[id]; });
			list.forEach(function (t) { if (t && t.id) lib.tracks[t.id] = fill(t); });
		}
		if (d.playlists && typeof d.playlists === 'object') {
			var pls = Array.isArray(d.playlists) ? d.playlists : Object.keys(d.playlists).map(function (id) { return d.playlists[id]; });
			pls.forEach(function (p) { if (p && p.id) lib.playlists[p.id] = p; });
		}
		if (d.aliases && typeof d.aliases === 'object') for (k in d.aliases) lib.aliases[k] = str(d.aliases[k]);
		if (d.channelRules && typeof d.channelRules === 'object') for (k in d.channelRules) lib.channelRules[k] = d.channelRules[k];
		if (d.genres && typeof d.genres === 'object') {
			['artist', 'channel', 'mb'].forEach(function (level) {
				if (d.genres[level] && typeof d.genres[level] === 'object') for (var key in d.genres[level]) lib.genres[level][key] = d.genres[level][key];
			});
		}
		if (d.profiles && typeof d.profiles === 'object') for (k in d.profiles) if (d.profiles[k] && typeof d.profiles[k] === 'object') lib.profiles[k] = d.profiles[k];
		if (d.settings && typeof d.settings === 'object') for (k in d.settings) lib.settings[k] = d.settings[k];
		return lib;
	}

	// What the store keeps: the tracks and playlists one by one, the rest as
	// one small record.
	function toParts(lib) {
		return {
			tracks: list(lib),
			playlists: Object.keys(lib.playlists).map(function (id) { return lib.playlists[id]; }),
			meta: { version: VERSION, aliases: lib.aliases, channelRules: lib.channelRules, genres: lib.genres, profiles: lib.profiles, settings: lib.settings }
		};
	}
	function fromParts(parts) {
		parts = parts || {};
		var meta = parts.meta || {};
		return load({ tracks: parts.tracks || [], playlists: parts.playlists || [], aliases: meta.aliases, channelRules: meta.channelRules, genres: meta.genres, profiles: meta.profiles, settings: meta.settings });
	}
	function meta(lib) { return toParts(lib).meta; }

	function blank(id) {
		return {
			id: id, title: '', artist: '', artistKey: '', version: '', versionText: '', feat: [], album: '', trackNo: null,
			channel: '', channelId: '', durationSec: 0, publishedAt: null, year: null, yearSource: '', decade: '',
			addedAt: {}, playlists: [],
			genres: [], topics: [], embeddable: true, removed: false, removedReason: '', playerError: null,
			rating: 0, plays: 0, skips: 0, lastPlayed: null, blocked: false, tags: [], userEdits: {}, labels: null, stateAt: null,
			titleAlt: '', artistNative: '', origArtist: '', scene: '', work: '', role: '', lang: '', mood: '', kind: '',
			raw: { title: '', channel: '' }, guess: { artist: '', title: '', rule: 'none', confidence: 0 }, artistGuess: '', spreadKey: '',
			run: null, live: false, releaseYear: null, categoryId: '', fetchedAt: null
		};
	}
	function fill(t) {
		var b = blank(t.id);
		for (var k in b) if (t[k] === undefined) t[k] = b[k];
		if (!t.spreadKey) t.spreadKey = t.artistKey || '~' + (channelKey(t) || t.id);   // stored before the field existed
		return t;
	}

	function list(lib) { return Object.keys(lib.tracks).map(function (id) { return lib.tracks[id]; }); }
	function get(lib, id) { return lib.tracks[id] || null; }

	// Can this track be played in the embedded player?
	function playable(t) { return !!t && !t.removed && t.embeddable !== false && !t.playerError; }

	// ---- Deriving the corrected fields -------------------------------------------

	function uniq(arr) {
		var out = [];
		(arr || []).forEach(function (g) { g = str(g).trim(); if (g && out.indexOf(g) < 0) out.push(g); });
		return out;
	}

	// The genres of a track and where they came from. Order of authority: the
	// user's choice for the track, for its artist, for its channel; then
	// MusicBrainz for the artist (fetched only when the user asked); then
	// YouTube's topics and what the title itself says (a soundtrack).
	function genresOf(lib, t) {
		var e = t.userEdits || {}, lab = t.labels || {};
		if (Array.isArray(e.genres)) return { genres: uniq(e.genres), source: 'track' };
		if (Array.isArray(lab.genres) && lab.genres.length) return { genres: uniq(lab.genres), source: 'label' };
		var a = t.artistKey && lib.genres.artist[t.artistKey];
		if (Array.isArray(a)) return { genres: uniq(a), source: 'artist' };
		var c = lib.genres.channel[channelKey(t)];
		if (Array.isArray(c)) return { genres: uniq(c), source: 'channel' };
		var mb = t.artistKey && lib.genres.mb[t.artistKey];
		if (mb && Array.isArray(mb.genres) && mb.genres.length) return { genres: uniq(mb.genres), source: 'musicbrainz' };
		var g = (t.topics || []).slice();
		if (t.hints) t.hints.forEach(function (h) { if (g.indexOf(h) < 0) g.push(h); });
		return { genres: g, source: g.length ? 'youtube' : '' };
	}

	// The parse rules whose answer can change with what the rest of the
	// library knows (parse.js decideSides).
	// A reading taught from one tap is among them: once something sure names
	// the artist, that reading wins again.
	var AMBIGUOUS_RULES = { 'dash': true, 'dash-guess': true, 'known-artist': true, 'channel-taught': true, 'dash-session': true, 'dash-label': true };

	// What the library says about artists, for Parse.parse's opts.known:
	// function(name) -> { sure, seen, left, right }. left and right count the
	// toss-up uploads ("A - B (Lyrics)") with the name on that side. sure counts the tracks that name the
	// artist by a correction or by a guess at 0.85 or more; seen counts the
	// tracks that only guess the name from a plain "A - B". Guesses that
	// themselves leaned on this list, or are toss-ups, count for neither.
	function knownArtists(lib) {
		var c = knownCollector(lib);
		c.add(list(lib));
		return c.result();
	}
	// The same, gathered a part at a time (the page reads a large library in
	// slices so that it never holds the page for long): add(tracks) for every
	// part, then result(). Gathering in parts gives what knownArtists gives.
	function knownCollector(lib) {
		var sure = {}, seen = {}, left = {}, right = {};
		function add(tracks) { (tracks || []).forEach(tally); }
		function tally(t) {
			var g = t.guess || {};
			if (g.rule === 'dash-guess' || g.rule === 'known-artist') {
				// the two sides of a toss-up, as written (left - right)
				var p = Parse.parse(t.raw.title, t.raw.channel);
				if (p.rule === 'dash-guess') {
					var lk = artistOf(lib, p.artist).key, rk = artistOf(lib, p.title).key;
					if (lk) left[lk] = (left[lk] || 0) + 1;
					if (rk) right[rk] = (right[rk] || 0) + 1;
				}
			}
			var edited = fixedArtist(t);
			// a reading taught from one tap is the user's generalisation, not a
			// source: it counts for no name, sure or seen (else it would keep
			// itself in place against a sure artist found later)
			if (edited || (t.artistKey && g.confidence >= 0.85 && g.rule !== 'known-artist' && g.rule !== 'channel-taught')) {
				if (t.artistKey) sure[t.artistKey] = (sure[t.artistKey] || 0) + 1;
				return;
			}
			if (g.artist && g.confidence > 0 && g.rule !== 'known-artist' && g.rule !== 'dash-guess' && g.rule !== 'channel-taught') {
				var k = artistOf(lib, g.artist).key;
				if (k) seen[k] = (seen[k] || 0) + 1;
			}
		}
		function result() {
			return function (name) {
				var k = artistOf(lib, name).key;
				return { sure: (k && sure[k]) || 0, seen: (k && seen[k]) || 0, left: (k && left[k]) || 0, right: (k && right[k]) || 0 };
			};
		}
		return { add: add, result: result };
	}

	// Recompute everything derived on one track. known: knownArtists(lib),
	// passed in by callers that derive many tracks. Returns the track.
	function minConfidence(lib) { return lib.settings.minConfidence == null ? 0.6 : lib.settings.minConfidence; }
	// Does this reading name an artist the library may show as sure? A
	// soundtrack piece with no artist counts as settled too.
	function readsSure(lib, p) { return (!!p.artist && p.confidence >= minConfidence(lib)) || p.rule === 'ost'; }

	// A rule taught from one tap ("read the other unsure tracks the same
	// way"): { scope: 'guesses', rule: <a channel rule> }. It reads only the
	// tracks that nothing else names; sure readings and corrections stay.
	function taughtRule(rule) { return rule && typeof rule === 'object' && rule.scope === 'guesses' ? rule.rule : null; }

	// Labels: a hand-made reading of a track (applyLabels), between what the
	// parser reads and the user's own corrections, which still win. The fields
	// beyond the corrected five describe where a track lives and how it sounds:
	//   titleAlt    romaji or English title, for search
	//   origArtist  the original artist of a cover
	//   scene       anime, vn, game, vtuber, vocaloid, utaite, touhou, film, tv, stage, meme, or ''
	//   work        the anime, game, film or musical it comes from
	//   role        OP, ED, insert, theme, OST, image
	//   lang        ja, en, ko, zh, fr, de, es, la, other, inst
	//   mood        bright, driving, wistful, tender, dark, quirky
	//   kind        song, set (an album, medley, mix), clip (not music)
	var LABEL_FIELDS = ['titleAlt', 'origArtist', 'scene', 'work', 'role', 'lang', 'mood', 'kind'];
	// An artist named by hand (a correction or a label) is never re-read.
	function fixedArtist(t) { return !!t && ((t.userEdits && t.userEdits.artist != null) || !!(t.labels && t.labels.artist)); }

	function derive(lib, t, known) {
		var rule = lib.channelRules[channelKey(t)], taught = taughtRule(rule);
		var opts = {};
		if (rule && !taught) opts.channelRule = rule;
		if (known) opts.known = known;
		var p = Parse.parse(t.raw.title, t.raw.channel, opts);
		var e = t.userEdits || (t.userEdits = {});
		if (taught && e.artist == null && !readsSure(lib, p)) {
			var q = Parse.parse(t.raw.title, t.raw.channel, { channelRule: taught, known: known });
			if (q.rule === 'channel-rule' && q.artist) { q.rule = 'channel-taught'; q.confidence = 0.9; q.vouched = 'rule'; p = q; }
		}
		var trusted = p.confidence >= minConfidence(lib);
		t.guess = { artist: p.artist, title: p.title, rule: p.rule, confidence: p.confidence };
		var lab = t.labels && typeof t.labels === 'object' ? t.labels : {};

		var artist = trusted ? p.artist : '';
		var title = trusted || !p.artist ? p.title : p.whole;
		if (lab.artist) artist = str(lab.artist).trim();
		if (lab.title && str(lab.title).trim()) title = str(lab.title).trim();
		if (e.artist != null) artist = str(e.artist).trim();
		if (e.title != null && str(e.title).trim()) title = str(e.title).trim();
		var who = artistOf(lib, artist);
		t.artist = who.name;
		t.artistKey = who.key;
		t.title = title || str(t.raw.title);
		// No artist anything vouches for: the page shows the channel's name in
		// its place, marked as a guess, and the title as it was uploaded. The
		// artist stays unknown for counting, filters and the shuffle (which
		// already treats the channel as the artist of such a track).
		t.artistGuess = !t.artist && e.artist == null && !lab.artist && p.rule !== 'channel-rule' ? channelName(t) : '';
		// The rest of the labels: the user's value, the track's label, then what
		// the artist's profile says (scene and language), else nothing.
		var prof = (t.artistKey && lib.profiles && lib.profiles[t.artistKey]) || {};
		LABEL_FIELDS.forEach(function (k) {
			t[k] = e[k] != null ? str(e[k]) : lab[k] != null ? str(lab[k]) : (k === 'scene' || k === 'lang') && prof[k] ? str(prof[k]) : '';
		});
		t.artistNative = prof.native ? str(prof.native) : '';
		// Who the track counts as for the shuffle's "not the same artist
		// twice" and for the by-artist view: its sure artist, else its channel
		// (marked with "~", so it never mixes with an artist's key), else itself.
		// artistKey stays empty for a guess: counts, filters and MusicBrainz see
		// only artists something vouches for.
		t.spreadKey = t.artistKey || '~' + (channelKey(t) || t.id);
		if (e.version != null) { t.version = str(e.version); t.versionText = str(e.version); }
		else if (lab.version != null) { t.version = str(lab.version); t.versionText = t.version ? (p.version && p.versionText ? p.versionText : t.version) : ''; }
		else { t.version = p.version; t.versionText = p.versionText; }
		t.feat = p.feat;
		t.album = p.album;
		t.trackNo = p.trackNo;
		t.performer = p.performer;

		// The year: the user's, else the release date an auto-generated
		// description states, else a year in the title, else the upload year.
		var up = t.publishedAt ? new Date(t.publishedAt).getUTCFullYear() : null;
		if (e.year != null && +e.year) { t.year = +e.year; t.yearSource = 'edit'; }
		else if (lab.year != null && +lab.year) { t.year = +lab.year; t.yearSource = 'label'; }
		else if (t.releaseYear) { t.year = t.releaseYear; t.yearSource = 'release'; }
		else if (p.year && (!up || p.year <= up)) { t.year = p.year; t.yearSource = 'title'; }
		else if (up) { t.year = up; t.yearSource = 'upload'; }
		else { t.year = null; t.yearSource = ''; }
		t.decade = decadeOf(t.year);

		t.hints = [];
		if (p.soundtrack) t.hints.push('Soundtrack');
		if (p.classical) t.hints.push('Classical');
		var g = genresOf(lib, t);
		t.genres = g.genres;
		t.genreSource = g.source;

		// A numbered part of one work (Pt. 2, II. Andante, [2/3]): kept together
		// by "keep runs". The numbered tracks of a soundtrack are separate
		// pieces, not parts, and shuffle like any other track.
		var part = Parse.partOf(t.title), owner = t.artistKey || channelKey(t);
		if (part && Parse.fold(part.base)) t.run = { key: owner + '|' + Parse.fold(part.base), n: part.n };
		else t.run = null;
		return t;
	}

	// What deriving can change on a track, as one string to compare.
	function snapshot(t, withGuess) {
		var v = [t.title, t.artist, t.artistKey, t.version, t.year, t.genres, t.run, t.guess, t.artistNative];
		if (withGuess) v.push(t.artistGuess);
		LABEL_FIELDS.forEach(function (k) { v.push(t[k]); });
		return JSON.stringify(v);
	}

	function deriveAll(lib, test, known) {
		var changed = [];
		known = known || knownArtists(lib);
		list(lib).forEach(function (t) {
			if (test && !test(t)) return;
			var before = snapshot(t, false);
			derive(lib, t, known);
			if (snapshot(t, false) !== before) changed.push(t.id);
		});
		return changed;
	}

	// ---- What YouTube says -------------------------------------------------------

	// Add videos, or refresh the ones already here. `videos` are yt.js's
	// normalised records { id, title, channel, channelId, durationSec,
	// publishedAt, embeddable, topics, year, live }. ctx: { playlistId,
	// addedAt: { videoId: ISO date }, now }. Ratings, play counts, history and
	// corrections are left alone. -> { added: [ids], updated: [ids] }
	function upsert(lib, videos, ctx) {
		ctx = ctx || {};
		var stamp = iso(ctx.now), added = [], updated = [];
		(videos || []).forEach(function (v) {
			if (!v || !v.id) return;
			var t = lib.tracks[v.id], isNew = !t;
			if (isNew) { t = blank(v.id); lib.tracks[v.id] = t; }
			t.raw = { title: str(v.title), channel: str(v.channel) };
			t.channel = str(v.channel);
			t.channelId = str(v.channelId);
			if (v.durationSec != null) t.durationSec = +v.durationSec || 0;
			if (v.publishedAt) t.publishedAt = v.publishedAt;
			if (v.embeddable != null) t.embeddable = !!v.embeddable;
			t.topics = genresFromTopics(v.topics);
			t.releaseYear = v.year || null;
			t.categoryId = str(v.categoryId);
			t.live = !!v.live;
			t.removed = false;
			t.removedReason = '';
			t.fetchedAt = stamp;
			if (ctx.playlistId) {
				if (t.playlists.indexOf(ctx.playlistId) < 0) t.playlists.push(ctx.playlistId);
				var when = ctx.addedAt && ctx.addedAt[v.id];
				if (when) t.addedAt[ctx.playlistId] = when;
				else if (!t.addedAt[ctx.playlistId]) t.addedAt[ctx.playlistId] = stamp;
			}
			derive(lib, t);
			(isNew ? added : updated).push(v.id);
		});
		// Once the whole batch is in, an "A - B" with nothing on the upload to
		// say which side is the artist asks the library.
		var known = knownArtists(lib);
		added.concat(updated).forEach(function (id) { if (AMBIGUOUS_RULES[lib.tracks[id].guess.rule]) derive(lib, lib.tracks[id], known); });
		return { added: added, updated: updated };
	}

	// Videos YouTube no longer returns (deleted or made private). The tracks
	// stay, marked, with everything the user did to them. -> ids changed
	function markMissing(lib, ids, now) {
		var changed = [];
		(ids || []).forEach(function (id) {
			var t = lib.tracks[id];
			if (!t) return;
			if (!t.removed) changed.push(id);
			t.removed = true;
			t.removedReason = 'gone';
			t.fetchedAt = iso(now);
		});
		return changed;
	}

	// What the player found when it tried: 100 (removed or private), 101 and
	// 150 (the owner does not allow embedding). -> the track, or null
	function markUnplayable(lib, id, code, now) {
		var t = lib.tracks[id];
		if (!t) return null;
		code = +code;
		if (code === 100) { t.removed = true; t.removedReason = 'player'; }
		else if (code === 101 || code === 150) t.embeddable = false;
		t.playerError = { code: code, at: iso(now) };
		return t;
	}
	// "Try the unplayable ones again": forget what the player found. -> ids
	function clearPlayerErrors(lib, ids) {
		var changed = [];
		(ids || Object.keys(lib.tracks)).forEach(function (id) {
			var t = lib.tracks[id];
			if (!t || !t.playerError) return;
			if (t.playerError.code === 100 && t.removedReason === 'player') { t.removed = false; t.removedReason = ''; }
			if (t.playerError.code === 101 || t.playerError.code === 150) t.embeddable = true;
			t.playerError = null;
			changed.push(id);
		});
		return changed;
	}

	function setPlaylist(lib, playlist) {
		var old = lib.playlists[playlist.id] || {};
		var p = {};
		for (var k in old) p[k] = old[k];
		for (k in playlist) p[k] = playlist[k];
		lib.playlists[p.id] = p;
		return p;
	}

	// After a playlist was listed in full: tracks that are no longer in it
	// leave it (they stay in the library). -> { changed: [ids], orphans: [ids] }
	function reconcilePlaylist(lib, playlistId, keepIds) {
		var keep = {}, changed = [], orphans = [];
		(keepIds || []).forEach(function (id) { keep[id] = true; });
		list(lib).forEach(function (t) {
			var at = t.playlists.indexOf(playlistId);
			if (at < 0 || keep[t.id]) return;
			t.playlists.splice(at, 1);
			delete t.addedAt[playlistId];
			changed.push(t.id);
			if (!t.playlists.length) orphans.push(t.id);
		});
		return { changed: changed, orphans: orphans };
	}

	// Take a playlist out of the library. Its tracks stay unless they are in no
	// other playlist and `dropOrphans` is set; even then a track the user has
	// played, rated or corrected is kept. -> { changed, deleted }
	function removePlaylist(lib, playlistId, opts) {
		var r = reconcilePlaylist(lib, playlistId, []);
		delete lib.playlists[playlistId];
		var deleted = [];
		if (opts && opts.dropOrphans) {
			r.orphans.forEach(function (id) {
				var t = lib.tracks[id];
				if (t.plays || t.skips || t.rating || t.blocked || t.tags.length || Object.keys(t.userEdits).length) return;
				delete lib.tracks[id];
				deleted.push(id);
			});
		}
		return { changed: r.changed.filter(function (id) { return deleted.indexOf(id) < 0; }), deleted: deleted };
	}

	// Tracks whose YouTube data is older than `days` (30 by default): the API
	// terms ask for these to be refreshed or deleted. -> ids
	function stale(lib, now, days) {
		var limit = (now == null ? Date.now() : now) - (days == null ? 30 : days) * DAY;
		return list(lib).filter(function (t) { return !t.fetchedAt || time(t.fetchedAt) < limit; }).map(function (t) { return t.id; });
	}

	// ---- What the user says ------------------------------------------------------

	// Correct one track. fields: title, artist, version, year, genres (null
	// takes a correction back), and rating (0 to 5), blocked, tags. -> the track
	// known (optional): knownArtists(lib), computed once by a caller that
	// edits many tracks. A rating, a block or tags change nothing derived, so
	// they cost no parse at all.
	var PLAIN_FIELDS = { rating: true, blocked: true, tags: true };
	function needsDerive(fields) {
		for (var k in fields) if (!PLAIN_FIELDS[k]) return true;
		return false;
	}
	function setFields(t, fields) {
		['title', 'artist', 'version', 'year', 'genres'].concat(LABEL_FIELDS).forEach(function (k) {
			if (!(k in fields)) return;
			if (fields[k] == null) delete t.userEdits[k];
			else t.userEdits[k] = k === 'genres' ? uniq(fields[k]) : (k === 'year' ? +fields[k] || null : str(fields[k]));
			if (t.userEdits[k] === null) delete t.userEdits[k];
		});
		if ('rating' in fields || 'blocked' in fields) t.stateAt = fields.at ? iso(fields.at) : iso();
		if ('rating' in fields) t.rating = Math.max(0, Math.min(5, Math.round(+fields.rating || 0)));
		if ('blocked' in fields) t.blocked = !!fields.blocked;
		if ('tags' in fields) t.tags = uniq(fields.tags);
	}
	function edit(lib, id, fields, known) {
		var t = lib.tracks[id];
		if (!t) return null;
		fields = fields || {};
		setFields(t, fields);
		if (needsDerive(fields)) derive(lib, t, known || knownArtists(lib));
		return t;
	}

	// The same correction on many tracks, in time linear in their number:
	// what the library knows about artists is read once, not once per track.
	// The page calls it on slices of a large selection, passing the same
	// `known`, and then resolveArtists once. -> ids edited
	function editMany(lib, ids, fields, known) {
		fields = fields || {};
		var need = needsDerive(fields), out = [];
		if (need && !known) known = knownArtists(lib);
		(ids || []).forEach(function (id) {
			var t = lib.tracks[id];
			if (!t) return;
			setFields(t, fields);
			if (need) derive(lib, t, known);
			out.push(id);
		});
		return out;
	}

	// Derive the given tracks again with one reading of the library.
	// -> ids of the tracks that changed
	function deriveIds(lib, ids, known) {
		var changed = [];
		known = known || knownArtists(lib);
		(ids || []).forEach(function (id) {
			var t = lib.tracks[id];
			if (!t) return;
			var before = snapshot(t, true);
			derive(lib, t, known);
			if (snapshot(t, true) !== before) changed.push(id);
		});
		return changed;
	}

	// The tracks whose artist was a toss-up that the rest of the library can
	// settle.
	function ambiguousIds(lib) {
		return Object.keys(lib.tracks).filter(function (id) { var g = lib.tracks[id].guess; return !!(g && AMBIGUOUS_RULES[g.rule]); });
	}

	// Ask the library again about every track whose artist was a toss-up:
	// tracks imported earlier may now have an artist named elsewhere. Run
	// after an import, a refresh or a bulk correction. -> ids that changed
	function resolveArtists(lib) {
		return deriveIds(lib, ambiguousIds(lib));
	}

	// "Paper Lanterns Band" is "Paper Lanterns". -> ids of the tracks that changed
	function declareAlias(lib, alias, canonical) {
		return declareAliases(lib, [alias], canonical);
	}
	// Several spellings merged into one name at once, deriving each affected
	// track once. -> ids of the tracks that changed
	function declareAliases(lib, aliases, canonical) {
		var ids = planAliases(lib, aliases, canonical);
		return ids.length ? deriveIds(lib, ids) : [];
	}
	// Record the aliases and say which tracks they can change, without
	// deriving them: the page derives those in slices (deriveIds). A track
	// changes when it carries one of the merged keys, or when its artist was
	// a toss-up that the library's knowledge of names decides. -> ids
	function planAliases(lib, aliases, canonical) {
		var keys = {}, any = false;
		(aliases || []).forEach(function (alias) {
			var a = normArtist(alias), name = str(canonical).trim(), c = normArtist(name);
			if (!a || !c || a === c) return;
			// One hop only: an alias of an alias points at the final name.
			if (lib.aliases[c]) { name = lib.aliases[c]; c = normArtist(name); if (a === c) return; }
			for (var k in lib.aliases) if (normArtist(lib.aliases[k]) === a) lib.aliases[k] = name;
			// tracks under an earlier alias of this spelling carry that one's key
			if (lib.aliases[a]) keys[normArtist(lib.aliases[a])] = true;
			lib.aliases[a] = name;
			keys[a] = true;
			any = true;
		});
		return any ? affectedBy(lib, keys) : [];
	}
	function affectedBy(lib, keys) {
		return Object.keys(lib.tracks).filter(function (id) {
			var t = lib.tracks[id];
			return keys[t.artistKey] || (t.guess && AMBIGUOUS_RULES[t.guess.rule]);
		});
	}
	function removeAlias(lib, alias) {
		var a = normArtist(alias);
		if (!lib.aliases[a]) return [];
		var keys = {};
		keys[normArtist(lib.aliases[a])] = true;
		delete lib.aliases[a];
		return deriveIds(lib, affectedBy(lib, keys));
	}

	// "On this channel the format is Title / Artist." rule: one of
	// Parse.CHANNEL_RULES, { artist: 'Name' }, or null to forget it. -> ids
	function setChannelRule(lib, key, rule) {
		if (!key) return [];
		if (rule == null || rule === '') delete lib.channelRules[key]; else lib.channelRules[key] = rule;
		return deriveAll(lib, function (t) { return channelKey(t) === key; });
	}

	// What one correction says about the whole channel: the rule that, set on
	// the channel, reads this track with the artist the user gave. Tried in
	// order: "Artist - Title", "Title - Artist", "the channel is the artist";
	// failing those, "every track there is by this artist".
	// -> a rule for setChannelRule, or null
	function learnRule(lib, id, artist) {
		var t = lib.tracks[id], want = normArtist(artist);
		if (!t || !want) return null;
		var tries = ['artist-title', 'title-artist', 'channel'];
		for (var i = 0; i < tries.length; i++) {
			var p = Parse.parse(t.raw.title, t.raw.channel, { channelRule: tries[i] });
			if (p.rule === 'channel-rule' && normArtist(p.artist) === want) return tries[i];
		}
		return { artist: str(artist).trim() };
	}

	// Is this track's artist a guess the one-tap teaching may read again? Its
	// reading names no sure artist, and the user has not set its artist.
	function teachable(lib, t) {
		if (!t || fixedArtist(t)) return false;
		if (t.artist && t.guess && t.guess.rule === 'channel-taught') return true;
		return !t.artist && !(t.guess && (t.guess.rule === 'ost' || t.guess.rule === 'channel-rule'));
	}

	// What one tap would teach: after the user named the artist of track `id`,
	// the rule that reads it that way, and the other tracks of its channel the
	// rule would read: only the guesses, never a sure reading or a correction.
	// `conflicts` counts the channel's sure tracks the rule would read with a
	// different artist (the channel mixes orders; the page says so).
	// -> { key, rule, ids, conflicts } or null
	function teachPlan(lib, id, artist) {
		var t = lib.tracks[id];
		if (!t) return null;
		var rule = learnRule(lib, id, artist);
		if (!rule) return null;
		var key = channelKey(t), ids = [], conflicts = 0;
		list(lib).forEach(function (x) {
			if (x.id === id || channelKey(x) !== key) return;
			if (teachable(lib, x)) { ids.push(x.id); return; }
			if (!x.artistKey || fixedArtist(x)) return;
			var q = Parse.parse(x.raw.title, x.raw.channel, { channelRule: rule });
			if (q.rule === 'channel-rule' && q.artist && artistOf(lib, q.artist).key !== x.artistKey) conflicts++;
		});
		return { key: key, rule: rule, ids: ids, conflicts: conflicts };
	}

	// Teach it: the rule is kept for the channel, scoped to its guesses (new
	// guesses from a later import are read the same way). -> { ids: the
	// tracks whose artist or title changed, prev: the channel's rule before,
	// for undo }
	function teachChannel(lib, plan) {
		var prev = Object.prototype.hasOwnProperty.call(lib.channelRules, plan.key) ? lib.channelRules[plan.key] : null;
		var before = {};
		list(lib).forEach(function (x) { if (channelKey(x) === plan.key) before[x.id] = x.artist + '|' + x.title; });
		lib.channelRules[plan.key] = { scope: 'guesses', rule: plan.rule };
		var ids = deriveAll(lib, function (x) { return channelKey(x) === plan.key; });
		return { ids: ids.filter(function (id) { return before[id] !== lib.tracks[id].artist + '|' + lib.tracks[id].title; }), touched: ids, prev: prev };
	}

	// Genres for one track, one artist or one channel. level: 'track' (key is
	// the track id), 'artist' (an artistKey) or 'channel' (a channelKey).
	// genres: a list, or null to take the override back. -> ids
	function setGenres(lib, level, key, genres) {
		if (level === 'track') {
			var t = lib.tracks[key];
			if (!t) return [];
			edit(lib, key, { genres: genres });
			return [key];
		}
		if (level !== 'artist' && level !== 'channel') return [];
		if (genres == null) delete lib.genres[level][key]; else lib.genres[level][key] = uniq(genres);
		return deriveAll(lib, function (t) { return (level === 'artist' ? t.artistKey : channelKey(t)) === key; });
	}
	// What MusicBrainz said for an artist: { genres, mbid, at }. -> ids
	function setArtistGenresFromMB(lib, artistKey, record) {
		if (!artistKey) return [];
		if (record == null) delete lib.genres.mb[artistKey];
		else lib.genres.mb[artistKey] = { genres: uniq(record.genres), mbid: str(record.mbid), at: record.at || null };
		return deriveAll(lib, function (t) { return t.artistKey === artistKey; });
	}

	// ---- Labels files ------------------------------------------------------------------
	// A labels file is a hand-made reading of a library, kept apart from it so
	// it can be applied again after an import or a wipe:
	//   { format: 'true-shuffle-labels', version: 1,
	//     tracks:  { videoId: { artist, title, version, year, genres, titleAlt, origArtist,
	//                           scene, work, role, lang, mood, kind } },
	//     artists: { 'Name': { native, genres, scene, lang } },   // inherited by later imports
	//     aliases: { 'Other spelling': 'Name' } }
	var LABELS_FORMAT = 'true-shuffle-labels';
	var LABEL_KEYS = ['artist', 'title', 'version', 'year', 'genres'].concat(LABEL_FIELDS);
	// -> '' when data is a labels file, else a sentence saying why not
	function checkLabels(data) {
		if (!data || typeof data !== 'object' || data.format !== LABELS_FORMAT) return 'That file is not a True Shuffle labels file, so nothing was changed.';
		if (+data.version !== 1) return 'That labels file is from a newer version of True Shuffle, so nothing was changed.';
		if (!data.tracks || typeof data.tracks !== 'object') return 'That labels file has no tracks, so nothing was changed.';
		return '';
	}
	function cleanLabel(x) {
		var out = {};
		LABEL_KEYS.forEach(function (k) {
			if (x[k] == null) return;
			if (k === 'genres') { if (Array.isArray(x[k])) out.genres = uniq(x[k]); return; }
			if (k === 'year') { if (+x[k] >= 1000 && +x[k] <= 2999) out.year = +x[k]; return; }
			out[k] = str(x[k]).trim();
		});
		return out;
	}
	// Apply a labels file. Tracks the library does not have are counted and
	// skipped; the artists' profiles and aliases are kept for later imports.
	// -> { ids: tracks changed, matched, missing, artists }
	function applyLabels(lib, data) {
		var why = checkLabels(data);
		if (why) throw new Error(why);
		var matched = 0, missing = 0, artists = 0, k;
		if (data.aliases && typeof data.aliases === 'object') {
			for (k in data.aliases) {
				var a = normArtist(k), c = str(data.aliases[k]).trim();
				if (a && c && a !== normArtist(c)) lib.aliases[a] = c;
			}
		}
		if (data.artists && typeof data.artists === 'object') {
			for (k in data.artists) {
				var info = data.artists[k] || {}, key = artistOf(lib, k).key;
				if (!key) continue;
				var prof = {};
				['native', 'scene', 'lang'].forEach(function (f) { if (info[f]) prof[f] = str(info[f]).trim(); });
				lib.profiles[key] = prof;
				if (Array.isArray(info.genres) && info.genres.length) lib.genres.artist[key] = uniq(info.genres);
				artists++;
			}
		}
		for (k in data.tracks) {
			var t = lib.tracks[k];
			if (!t) { missing++; continue; }
			t.labels = cleanLabel(data.tracks[k] || {});
			matched++;
		}
		var ids = deriveAll(lib, null, knownArtists(lib));
		return { ids: ids, matched: matched, missing: missing, artists: artists };
	}
	// The labels of a library as a file: every labelled track, with the user's
	// own corrections folded in, and the profiles. -> a labels file
	function exportLabels(lib, now) {
		var out = { format: LABELS_FORMAT, version: 1, createdAt: iso(now), tracks: {}, artists: {}, aliases: {} };
		list(lib).forEach(function (t) {
			if (!t.labels && !Object.keys(t.userEdits).length) return;
			var x = {};
			LABEL_KEYS.forEach(function (f) {
				var v = f === 'year' ? (t.yearSource === 'edit' || t.yearSource === 'label' ? t.year : null) : t[f];
				if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) x[f] = Array.isArray(v) ? v.slice() : v;
			});
			out.tracks[t.id] = x;
		});
		var names = {};
		list(lib).forEach(function (t) { if (t.artistKey) names[t.artistKey] = t.artist; });
		Object.keys(lib.profiles).forEach(function (key) {
			var p = lib.profiles[key], a = { native: p.native || '', scene: p.scene || '', lang: p.lang || '' };
			if (lib.genres.artist[key]) a.genres = lib.genres.artist[key].slice();
			out.artists[names[key] || key] = a;
		});
		for (var k in lib.aliases) out.aliases[k] = lib.aliases[k];
		return out;
	}

	// One listen. info: { at (ms), completed, listenedSec }. It counts as a
	// play when the track ran to its end or at least half of it was heard,
	// and as a skip otherwise. -> the track
	function recordPlay(lib, id, info) {
		var t = lib.tracks[id];
		if (!t) return null;
		info = info || {};
		var half = t.durationSec > 0 && +info.listenedSec >= t.durationSec / 2;
		if (info.completed || half) { t.plays++; t.lastPlayed = iso(info.at); }
		else t.skips++;
		return t;
	}

	// ---- Looking at the library -----------------------------------------------------

	// The same song more than once: tracks with the same normalised artist and
	// title (and version, unless ignoreVersion). Reported, never removed.
	// -> [{ key, artist, title, version, ids }]
	function duplicates(lib, opts) {
		opts = opts || {};
		var groups = {};
		list(lib).forEach(function (t) {
			var key;
			if (t.artistKey) key = t.artistKey + '|' + normTitle(t.title) + (opts.ignoreVersion ? '' : '|' + t.version);
			else if (t.durationSec) key = '?|' + normTitle(t.raw.title) + '|' + Math.round(t.durationSec / 3);   // unknown artist: the same upload posted twice
			else return;
			(groups[key] || (groups[key] = [])).push(t);
		});
		return Object.keys(groups).filter(function (k) { return groups[k].length > 1; }).map(function (k) {
			var g = groups[k];
			return { key: k, artist: g[0].artist, title: g[0].title, version: opts.ignoreVersion ? '' : g[0].version, ids: g.map(function (t) { return t.id; }) };
		}).sort(function (a, b) { return a.key < b.key ? -1 : 1; });
	}
	// One video sitting in several playlists. -> [{ id, playlists }]
	function inSeveralPlaylists(lib) {
		return list(lib).filter(function (t) { return t.playlists.length > 1; }).map(function (t) { return { id: t.id, playlists: t.playlists.slice() }; });
	}

	function sameMonth(ms, now) {
		var a = new Date(ms), b = new Date(now);
		return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
	}

	function count(map, key, name) {
		var e = map[key] || (map[key] = { key: key, name: name, count: 0, names: {} });
		e.count++;
		if (name) e.names[name] = (e.names[name] || 0) + 1;
	}
	function ranked(map, byKey) {
		return Object.keys(map).map(function (k) {
			var e = map[k], best = e.name, n = 0;
			for (var s in e.names) if (e.names[s] > n) { n = e.names[s]; best = s; }   // the commonest spelling
			return { key: e.key, name: best, count: e.count };
		}).sort(function (a, b) {
			if (byKey) return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
			return b.count - a.count || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1);
		});
	}

	// What there is to choose from, with counts. `tracks` defaults to the whole
	// library; pass a filtered list to count within a selection. The keys are
	// the ones shuffle.js's select() takes.
	function facets(lib, tracks, now) {
		tracks = tracks || list(lib);
		now = now == null ? Date.now() : now;
		var f = { artist: {}, genre: {}, decade: {}, playlist: {}, channel: {}, length: {}, tag: {}, scene: {}, work: {}, lang: {}, mood: {}, kind: {} };
		var never = 0, month = 0, blocked = 0, unplayable = 0;
		tracks.forEach(function (t) {
			// a guess is counted under its channel, labelled as a guess, never
			// among the artists something vouches for
			if (t.artistKey) count(f.artist, t.artistKey, t.artist);
			else if (t.artistGuess) count(f.artist, t.spreadKey || '~' + (channelKey(t) || t.id), t.artistGuess + ' (guess)');
			else count(f.artist, '', 'Unknown artist');
			if (t.genres.length) t.genres.forEach(function (g) { count(f.genre, g, g); }); else count(f.genre, '', 'Unknown genre');
			count(f.decade, t.decade, t.decade || 'Unknown year');
			t.playlists.forEach(function (p) { count(f.playlist, p, (lib.playlists[p] && lib.playlists[p].title) || p); });
			count(f.channel, channelKey(t), t.channel || 'Unknown channel');
			count(f.length, lengthClass(t.durationSec), '');
			(t.tags || []).forEach(function (g) { count(f.tag, g, g); });
			['scene', 'lang', 'mood', 'kind'].forEach(function (k) { if (t[k]) count(f[k], t[k], t[k]); });
			if (t.work) count(f.work, t.work, t.work);
			if (!t.plays) never++;
			if (lastAdded(t) && sameMonth(lastAdded(t), now)) month++;
			if (t.blocked) blocked++;
			if (!playable(t)) unplayable++;
		});
		var lengths = LENGTH_CLASSES.map(function (c) { return { key: c.key, name: c.name, count: f.length[c.key] ? f.length[c.key].count : 0 }; });
		return {
			total: tracks.length,
			artist: ranked(f.artist).map(function (e) { e.guess = e.key.charAt(0) === '~'; return e; }), genre: ranked(f.genre), decade: ranked(f.decade, true), playlist: ranked(f.playlist), channel: ranked(f.channel),
			length: lengths, tag: ranked(f.tag),
			scene: ranked(f.scene), work: ranked(f.work), lang: ranked(f.lang), mood: ranked(f.mood), kind: ranked(f.kind),
			neverPlayed: never, addedThisMonth: month, blocked: blocked, unplayable: unplayable
		};
	}

	// Find tracks by words. Every word must occur somewhere in the title,
	// artist, credits, album, channel, version, genres or tags; accents and case
	// do not matter. Best matches first. An empty query returns everything.
	function search(lib, query, tracks) {
		tracks = tracks || list(lib);
		var q = foldText(query);
		if (!q) return tracks.slice();
		var terms = q.split(' '), out = [];
		tracks.forEach(function (t) {
			var title = foldText(t.title + ' ' + (t.titleAlt || '')), artist = foldText(t.artist + ' ' + (t.artistNative || ''));
			var rest = foldText([t.feat.join(' '), t.album, t.channel, t.versionText || t.version, t.genres.join(' '), t.tags.join(' '), t.raw.title, t.work || '', t.origArtist || ''].join(' '));
			var hay = ' ' + title + ' ' + artist + ' ' + rest + ' ', score = 0;
			for (var i = 0; i < terms.length; i++) {
				if (hay.indexOf(terms[i]) < 0) return;
				if ((' ' + title + ' ').indexOf(' ' + terms[i]) >= 0) score += 3;
				else if ((' ' + artist + ' ').indexOf(' ' + terms[i]) >= 0) score += 3;
				else if (hay.indexOf(' ' + terms[i]) >= 0) score += 1;
			}
			if (title === q || artist === q) score += 10;
			else if (title.indexOf(q) === 0 || artist.indexOf(q) === 0) score += 5;
			out.push({ t: t, score: score });
		});
		out.sort(function (a, b) { return b.score - a.score || (foldText(a.t.artist + ' ' + a.t.title) < foldText(b.t.artist + ' ' + b.t.title) ? -1 : 1); });
		return out.map(function (o) { return o.t; });
	}

	var PLAY_BUCKETS = [
		{ label: '0', min: 0, max: 0 }, { label: '1', min: 1, max: 1 }, { label: '2-4', min: 2, max: 4 },
		{ label: '5-9', min: 5, max: 9 }, { label: '10-19', min: 10, max: 19 }, { label: '20+', min: 20, max: Infinity }
	];

	// Numbers for the page: how much there is, how much was never played, how
	// plays are spread over the tracks.
	function stats(lib, now) {
		var tracks = list(lib), artists = {}, limit = (now == null ? Date.now() : now) - 30 * DAY;
		var s = {
			tracks: tracks.length, playlists: Object.keys(lib.playlists).length, playable: 0, removed: 0, notEmbeddable: 0, blocked: 0,
			artists: 0, unknownArtist: 0, guessedArtist: 0, edited: 0, neverPlayed: 0, played: 0, plays: 0, skips: 0, durationSec: 0,
			playsHistogram: PLAY_BUCKETS.map(function (b) { return { label: b.label, min: b.min, max: b.max, count: 0 }; }),
			mostPlayed: [], staleCount: 0, oldestFetchedAt: null
		};
		tracks.forEach(function (t) {
			if (playable(t)) s.playable++;
			if (t.removed) s.removed++;
			if (t.embeddable === false) s.notEmbeddable++;
			if (t.blocked) s.blocked++;
			if (t.artistKey) artists[t.artistKey] = true; else s.unknownArtist++;
			if (!t.artistKey && t.guess && t.guess.artist) s.guessedArtist++;
			if (Object.keys(t.userEdits).length) s.edited++;
			if (t.plays) s.played++; else s.neverPlayed++;
			s.plays += t.plays;
			s.skips += t.skips;
			s.durationSec += t.durationSec || 0;
			for (var i = 0; i < PLAY_BUCKETS.length; i++) if (t.plays >= PLAY_BUCKETS[i].min && t.plays <= PLAY_BUCKETS[i].max) { s.playsHistogram[i].count++; break; }
			var f = time(t.fetchedAt);
			if (!f || f < limit) s.staleCount++;
			if (f && (!s.oldestFetchedAt || f < time(s.oldestFetchedAt))) s.oldestFetchedAt = t.fetchedAt;
		});
		s.artists = Object.keys(artists).length;
		s.mostPlayed = tracks.filter(function (t) { return t.plays > 0; }).sort(function (a, b) { return b.plays - a.plays || (a.id < b.id ? -1 : 1); }).slice(0, 10).map(function (t) { return t.id; });
		return s;
	}

	// The channels in the library, for teaching formats: how many tracks each
	// has, how many of them have no artist, the rule set, a few raw titles.
	function channels(lib) {
		var map = {};
		list(lib).forEach(function (t) {
			var k = channelKey(t);
			var c = map[k] || (map[k] = { key: k, name: t.channel, kind: Parse.channelInfo(t.raw.channel).kind, count: 0, unknown: 0, rule: lib.channelRules[k] || null, samples: [] });
			c.count++;
			if (!t.artistKey) c.unknown++;
			if (c.samples.length < 3) c.samples.push(t.raw.title);
		});
		return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.unknown - a.unknown || b.count - a.count || (a.name < b.name ? -1 : 1); });
	}

	return {
		VERSION: VERSION,
		GENRE_TOPICS: GENRE_TOPICS,
		LABEL_FIELDS: LABEL_FIELDS, LABELS_FORMAT: LABELS_FORMAT,
		applyLabels: applyLabels, checkLabels: checkLabels, exportLabels: exportLabels, fixedArtist: fixedArtist,
		LENGTH_CLASSES: LENGTH_CLASSES,
		create: create, load: load, toParts: toParts, fromParts: fromParts, meta: meta,
		list: list, get: get, playable: playable,
		normArtist: normArtist, normTitle: normTitle, people: people, artistOf: artistOf, channelKey: channelKey,
		parseDuration: parseDuration, lengthClass: lengthClass, decadeOf: decadeOf, firstAdded: firstAdded, lastAdded: lastAdded,
		genresFromTopics: genresFromTopics, genresOf: genresOf,
		derive: derive, deriveAll: deriveAll, knownArtists: knownArtists, knownCollector: knownCollector, resolveArtists: resolveArtists,
		upsert: upsert, markMissing: markMissing, markUnplayable: markUnplayable, clearPlayerErrors: clearPlayerErrors,
		setPlaylist: setPlaylist, reconcilePlaylist: reconcilePlaylist, removePlaylist: removePlaylist, stale: stale,
		edit: edit, editMany: editMany, deriveIds: deriveIds, ambiguousIds: ambiguousIds,
		declareAlias: declareAlias, declareAliases: declareAliases, planAliases: planAliases, removeAlias: removeAlias,
		setChannelRule: setChannelRule, learnRule: learnRule, channelName: channelName,
		teachable: teachable, teachPlan: teachPlan, teachChannel: teachChannel,
		setGenres: setGenres, setArtistGenresFromMB: setArtistGenresFromMB, recordPlay: recordPlay,
		duplicates: duplicates, inSeveralPlaylists: inSeveralPlaylists, facets: facets, search: search, stats: stats, channels: channels
	};
});
