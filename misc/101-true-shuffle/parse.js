/*
 * True Shuffle: from a video's title and its channel, the artist and the
 * track title.
 *
 *     TrueShuffle.parse.parse(title, channel, { channelRule, known }) ->
 *       { artist, title, version, versionText, feat, performer, album,
 *         trackNo, year, tags, soundtrack, classical, whole, confidence, rule }
 *
 * The parser is conservative. A wrong artist is worse than no artist, so a
 * shape it cannot tell apart (a bare "A / B" with nothing to decide which side
 * is which) comes back with a low confidence, and library.js treats anything
 * under its threshold as "unknown artist" while keeping the guess for the
 * page to offer. `rule` names the rule that fired; RULES explains each.
 *
 * What it knows (README.md has an example of every shape):
 *   - "Artist - Title" with any dash, and "Title - Artist" when the channel
 *     says so;
 *   - "Title / Artist" (usual on Japanese uploads) against "Artist / Title";
 *   - corner brackets around the title, the artist before or after;
 *   - tags in lenticular brackets, such as an MV marker;
 *   - "Artist - Topic" channels, VEVO and "Official" channel names;
 *   - junk in round and square brackets (Official Video, Lyrics, HD ...),
 *     dropped, and the words that tell one recording from another (live,
 *     remix, cover, acoustic, instrumental, piano ...), kept as `version`;
 *   - "feat." and "ft." credits;
 *   - soundtracks ("Game OST - 03 - Title", "Title (Game Original Soundtrack)");
 *   - classical titles ("Composer: Work, Op. 9 No. 2 - Performer");
 *   - a rule the user teaches for one channel, which overrides the guess;
 *   - for an "A - B" nothing on the upload decides, what the library knows
 *     (opts.known, from library.js knownArtists).
 *
 * The source is plain ASCII: every other character is written as an escape.
 * The few Japanese words in the tables are single dictionary words that
 * uploaders use as tags; each has its reading and meaning beside it.
 *
 * UMD: window.TrueShuffle.parse in the browser, module.exports in Node.
 * Pure: no DOM, no network, no clock.
 */
(function (root, factory) {
	var api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.parse = api; }
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	// ---- Tables ----------------------------------------------------------------

	// What each rule name means, for the page to show beside a guess.
	var RULES = {
		'channel-rule': 'The format you set for this channel.',
		'dash-session': 'Artist - Title on a live-session channel that names itself in the title ("Live on ..."); sessions put the artist first.',
		'dash-label': 'Artist - Title, an official upload by a record label; labels put the artist first.',
		'channel-taught':'The format you taught this channel from one track, applied only to its tracks that nothing else names.',
		'topic': 'An auto-generated "Artist - Topic" channel: the channel is the artist.',
		'dash': '"Artist - Title".',
		'dash-title-artist': '"Title - Artist": the right-hand side is the channel\'s own name.',
		'dash-multi': 'Several dashes: the first part taken as the artist.',
		'dash-loose': 'A dash without spaces on both sides, read as "Artist - Title".',
		'dash-guess': '"A - B" on a lyrics or cover upload, where "Title - Artist" is as common as "Artist - Title": a guess.',
		'dash-composer': '"Work - Composer": the right-hand side is a composer\'s name.',
		'known-artist': 'One side is an artist your library already names with confidence.',
		'slash-title-artist': '"Title / Artist".',
		'slash-artist-title': '"Artist / Title".',
		'slash-guess': '"A / B" with nothing to tell which side is the artist: a guess.',
		'quote-artist-first': 'Title in corner brackets, artist before it.',
		'quote-title-first': 'Title in corner brackets, artist after it.',
		'quote-only': 'Title in corner brackets, no artist beside it.',
		'quote-ascii': 'Title in quotation marks, artist before it.',
		'classical-colon': '"Composer: Work - Performer".',
		'classical-work-performer': '"Work, Op. ... - Performer": no composer named.',
		'classical-performer': '"Performer - Composer: Work" on the performer\'s own channel.',
		'ost': 'A soundtrack title: album and track, no artist named.',
		'vevo-channel': 'No artist in the title; the VEVO channel names one.',
		'official-channel': 'No artist in the title; the channel is an artist\'s official one.',
		'channel-official-video': 'No artist in the title, which is marked official: the uploader taken as the artist.',
		'channel-prefix': 'The title begins with the channel\'s name.',
		'none': 'No artist found.'
	};

	// Words that say which recording this is. A bracket can carry several
	// ("Acoustic Live Version"). The order here is the order kinds are listed
	// in `version`.
	var VERSION_KINDS = [
		['cover', /\bcover(?:ed)?\b(?!\s+art)|\btribute\s+version\b/i],
		['remix', /\bremix(?:ed)?\b|\bre-mix\b|\brmx\b|\bbootleg\b|\bmash-?up\b|\b(?:club|dub|vip)\s+mix\b|\brework\b/i],
		['live', /^live$|^live\s+(?:(?:video|acoustic|studio|lounge|stream|concert|tour)\b|@|\d{4}|'\d\d)|(?:^|\d\s+|[-,:]\s*)live\s+(?:at|in|from|on)\s|\blive\s+(?:version|ver|session|sessions|performance|recording|edit)\b|\blive\s*(?:\d{4})?$|\bin\s+concert\b/i],
		['acoustic', /\bacoustic\b|\bunplugged\b|\bstripped\b/i],
		['instrumental', /\binstrumental\b|\binst\.?(?=\s|$)|\boff\s*vocal\b|\bbacking\s+track\b|\bminus\s+one\b/i],
		['karaoke', /\bkaraoke\b/i],
		['piano', /^piano$|\bpiano\s*(?:version|ver|arrangement|arranged|arrange|arr|solo|cover|only|edition|instrumental|tutorial|lesson)(?![a-z])|\bsolo\s+piano\b/i],
		['orchestral', /\borchestra(?:l)?\s*(?:version|ver|arrangement|arranged|arrange|arr|mix|edition)(?![a-z])|^orchestral$|\bsymphonic\s+(?:version|ver|mix)(?![a-z])/i],
		['remaster', /\bre-?master(?:ed)?\b/i],
		['demo', /\bdemo\b/i],
		['extended', /\bextended\b/i],
		['edit', /\b(?:radio|single|video|short|tv)\s+edit\b|^edit$/i],
		['sped-up', /\bsped\s*up\b|\bspeed\s*up\b|\bnightcore\b/i],
		['slowed', /\bslowed\b|\breverb\b/i],
		['tv-size', /\btv\s*(?:size|version|ver)(?![a-z])/i],
		['short', /\bshort\s*(?:version|ver|size)(?![a-z])/i],
		['acapella', /\ba\s*cappella\b|\bacapella\b|\bvocals?\s+only\b/i],
		['session', /\bfirst\s+take\b|\bsessions?\b/i],
		['language', /\b(?:english|japanese|korean|chinese|mandarin|cantonese|spanish|german|french|italian|portuguese)\s*(?:version|ver|cover)(?![a-z])/i]
	];
	// Any other bracket that ends in one of these is still a version of some
	// kind ("2020 Version", "Moonlight Mix"), reported as 'alt'.
	var VERSION_GENERIC = /(?:\bver\.?|\bversion|\bmix|\barr(?:ange(?:ment)?)?\.?|\btake\s*\d+)$/i;

	// Tags written in Japanese on Japanese uploads: [kind, word].
	var JP_VERSION = [
		['live', '\u30E9\u30A4\u30D6'],                 // raibu: live
		['cover', '\u30AB\u30D0\u30FC'],                // kabaa: cover
		['cover', '\u6B4C\u3063\u3066\u307F\u305F'],            // utattemita, "tried singing": the usual tag on a vocal cover
		['cover', '\u5F3E\u3044\u3066\u307F\u305F'],            // hiitemita, "tried playing": the usual tag on an instrumental cover
		['remix', '\u30EA\u30DF\u30C3\u30AF\u30B9'],            // rimikkusu: remix
		['acoustic', '\u30A2\u30B3\u30FC\u30B9\u30C6\u30A3\u30C3\u30AF'],    // akoosutikku: acoustic
		['acoustic', '\u5F3E\u304D\u8A9E\u308A'],           // hikigatari: singing to one's own accompaniment
		['instrumental', '\u30A4\u30F3\u30B9\u30C8'],       // insuto: instrumental
		['karaoke', '\u30AB\u30E9\u30AA\u30B1'],            // karaoke
		['piano', '\u30D4\u30A2\u30CE']                 // piano
	];
	var JP_OFFICIAL = ['\u516C\u5F0F', '\u30AA\u30D5\u30A3\u30B7\u30E3\u30EB'];   // koushiki, ofisharu: official
	var JP_JUNK = JP_OFFICIAL.concat([
		'\u6B4C\u8A5E\u4ED8\u304D',       // kashitsuki: with lyrics
		'\u6B4C\u8A5E',           // kashi: lyrics
		'\u5B57\u5E55',           // jimaku: subtitles
		'\u9AD8\u97F3\u8CEA',         // kouonshitsu: high sound quality
		'\u30D5\u30EB',           // furu: full
		'\u30AA\u30EA\u30B8\u30CA\u30EB'      // orijinaru: original
	]);
	var JP_CHANNEL = '\u30C1\u30E3\u30F3\u30CD\u30EB';             // channeru: channel

	// A bracket made only of junk words says nothing about the recording. It
	// needs at least one strong word, or to be one of a few fixed phrases;
	// weak words alone ("In the Now") can be part of a name.
	var JUNK_STRONG = words('official oficial officiel offizielles video videoclip clip audio lyric lyrics lyrical letra letras ' +
		'mv pv hd hq uhd 4k 8k hifi lossless flac visualizer visualiser cc sub subs subtitle subtitles subtitled romaji kanji hangul ' +
		'vietsub kbps fps upscaled upscale stereo mono explicit premiere');
	var JUNK_WEAK = words('music musical hi res high quality full original version ver with on screen the a new upload exclusive ' +
		'clean eng english espanol han rom kan color colour coded static pseudo stream streaming out now free download dl link in ' +
		'description bonus track album single art cover-art and by ai song size');
	var JUNK_PHRASE = /^(?:full(?:\s+(?:ver(?:sion)?\.?|song|size|album))?|original(?:\s+(?:mix|ver(?:sion)?\.?))?|(?:album|single)\s+ver(?:sion)?\.?|bonus\s+track|out\s+now|free\s+(?:download|dl)|clean(?:\s+ver(?:sion)?\.?)?)$/i;

	function words(s) {
		var map = {};
		s.split(' ').forEach(function (w) { map[w] = true; });
		return map;
	}

	var OST_RE = /\b(?:o\.?s\.?t\b|original\s+(?:game\s+|video\s*game\s+|motion\s+picture\s+|movie\s+|film\s+|anime\s+|tv\s+|television\s+|series\s+)?(?:sound\s*track|score)\b|(?:game|movie|film|anime)\s+(?:sound\s*track|rip)\b|sound\s*track\b|bgm\b)/i;
	var OST_WORDS = /\s*\b(?:the\s+)?(?:complete\s+)?(?:official\s+)?(?:original\s+)?(?:game\s+|video\s*game\s+|motion\s+picture\s+|movie\s+|film\s+|anime\s+|tv\s+|television\s+|series\s+)?(?:o\.?s\.?t\b\.?|sound\s*track\b|score\b|bgm\b)\s*/i;
	// "Game (Original Soundtrack) - 03 - Title": the bracket belongs to the album.
	var OST_PREFIX = /^(.+?)\s*[(\[]\s*((?:the\s+)?(?:complete\s+)?(?:official\s+)?(?:original\s+)?(?:game\s+|video\s*game\s+|motion\s+picture\s+|movie\s+|film\s+|anime\s+|tv\s+|television\s+|series\s+)?(?:o\.?s\.?t\b\.?|sound\s*track|score|bgm))\s*[)\]]\s*(?=[-:\u2013\u2014]\s)/i;
	var OST_COLON = /^(.*?(?:\bo\.?s\.?t\b\.?|\bsound\s*track|\bbgm))\s*:\s+(?=\S)/i;

	var FORM = 'symphon(?:y|ie)|sonat[ae]|concerto|nocturne|pr[e\u00E9]lude|fugue|[e\u00E9]tude|waltz|mazurka|polonaise|quartet|quintet|suite|partita|toccata|ballade|impromptu|scherzo|rhapsody';
	var CATALOGUE = 'op(?:us)?\\.?\\s*\\d+|bwv\\s*\\d+|kv?\\.?\\s*\\d{1,3}\\b|hob\\.?\\s*[ivxlc]+|rv\\s*\\d+|hwv\\s*\\d+|woo\\s*\\d+|d\\.?\\s*\\d{3}\\b|in\\s+[a-g](?:[\\s-](?:flat|sharp))?\\s+(?:major|minor)\\b';
	// Anything that smells of a classical work, and the stricter test that a
	// rule must pass before it calls a title classical.
	var CLASSICAL_RE = new RegExp('\\b(?:' + CATALOGUE + '|(?:' + FORM + '|requiem|cantata|variations|overture)\\b)', 'i');
	var CLASSICAL_STRONG = new RegExp('\\b(?:' + CATALOGUE + ')|\\b(?:' + FORM + ')\\b[^:]*\\bno\\.?\\s*\\d+', 'i');
	var MOVEMENT_RE = /^[IVX]{1,4}\.\s|\b(?:allegro|allegretto|andante|andantino|adagio|presto|largo|larghetto|vivace|moderato|lento|menuetto|rondo|finale)\b/i;

	var DASH = '\\-\\u2010-\\u2015\\u2212';
	var SEP_DASH = new RegExp('\\s+[' + DASH + ']{1,2}\\s+');
	var SEP_SLASH = /\s+\/\s+/;
	var SEP_PIPE = /\s+\|\s+|\s+\/\/\s+/;
	// corner brackets, white corner brackets, double angle brackets
	var QUOTE_SRC = '[\u300C\u300E\u300A]([^\u300C\u300E\u300A\u300D\u300F\u300B]+)[\u300D\u300F\u300B]';
	var QUOTE_ONE = new RegExp(QUOTE_SRC);
	// lenticular and tortoise-shell brackets
	var LENT_SRC = '[\u3010\u3014]([^\u3010\u3011\u3014\u3015]*)[\u3011\u3015]';
	// Japanese-style punctuation or script anywhere: angle, corner and
	// lenticular brackets, kana, ideographs, the fullwidth solidus.
	var JP_RE = /[\u3008-\u3011\u3014\u3015\u3040-\u30FF\u4E00-\u9FFF\uFF0F]/;
	var TRACKNO_RE = /^(?:track\s*)?#?(\d{1,3})\.?$/i;

	// Junk that trails a title without brackets: "... Official Video", "... MV".
	var TRAIL_HEAD = '(?:\\s*[|:~\\/\\-\\u2013\\u2014]\\s*|\\s+)';
	var TRAIL_WORDS = '\\(?(?:the\\s+)?official\\s+(?:music\\s+|lyrics?\\s+|hd\\s+|4k\\s+|full\\s+)?(?:video|audio|mv|m\\/v|pv|clip|visuali[sz]er)\\)?|music\\s+video|lyrics?\\s+video|video\\s*clip|lyrics|with\\s+lyrics|full\\s+(?:mv|pv|ver\\.?|version)|audio\\s+only';
	var TRAIL_JUNK_I = new RegExp(TRAIL_HEAD + '(?:' + TRAIL_WORDS + ')\\s*$', 'i');
	var TRAIL_JUNK_CAPS = new RegExp(TRAIL_HEAD + '(?:MV|M\\/V|PV|HD|HQ|4K)\\s*$');
	var LEAD_JUNK = /^(?:\(?(?:official\s+)?(?:music\s+video|mv|m\/v|pv)\)?)\s*[:|\-\u2013\u2014]\s+/i;

	// ---- Small helpers ---------------------------------------------------------

	function str(v) { return v == null ? '' : String(v); }

	// One spelling for the characters that come in several: fullwidth forms to
	// ASCII, odd spaces to a space, zero-width characters out.
	function tidy(s) {
		s = str(s);
		s = s.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
		s = s.replace(/\uFF0F/g, ' / ');   // a fullwidth solidus separates even without spaces
		s = s.replace(/[\uFF01-\uFF5E]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
		s = s.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
		s = s.replace(/[\u2018\u2019]/g, '\'');
		return s.replace(/\s+/g, ' ').trim();
	}

	// A comparison key: no case, no accents, no spaces or punctuation.
	function fold(s) {
		s = str(s).normalize('NFKD').replace(/[\u0300-\u036F]/g, '').toLowerCase();
		return s.replace(/[^\p{L}\p{N}]+/gu, '');
	}

	var TRIM_LEFT = new RegExp('^[\\s' + DASH + '|/:~,\\u30FB]+');
	var TRIM_RIGHT = new RegExp('[\\s' + DASH + '|/:~,\\u30FB]+$');
	function trimSeps(s) { return str(s).replace(TRIM_LEFT, '').replace(TRIM_RIGHT, ''); }

	var WRAP_PAIRS = { '"': '"', '\u201C': '\u201D', '\u300C': '\u300D', '\u300E': '\u300F', '\u300A': '\u300B', '\'': '\'' };
	function stripWrapQuotes(s) {
		if (s.length < 3) return s;
		var open = s.charAt(0), close = s.charAt(s.length - 1), inner = s.slice(1, -1);
		if (WRAP_PAIRS[open] !== close) return s;
		if (inner.indexOf(open) >= 0 || inner.indexOf(close) >= 0) return s;
		return inner.trim();
	}

	function cleanSide(s) { return trimSeps(str(s).replace(/\s+/g, ' ')).trim(); }

	function decamel(s) {
		return str(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').trim();
	}

	function splitNames(s) {
		return str(s).split(/\s*(?:,|&|\u3001)\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
	}

	function wordCount(s) { return str(s).trim().split(/\s+/).filter(Boolean).length; }

	function hasAny(s, list) {
		for (var i = 0; i < list.length; i++) if (s.indexOf(list[i]) >= 0) return true;
		return false;
	}

	// A side that names a compilation or a stream, not anyone who plays.
	var NOT_ARTIST_RE = /\b(?:collection|compilation|playlist|medley|mixtape|megamix|anthology|greatest\s+hits|best\s+of|lo-?fi|24\/7)\b|\b(?:hip\s*hop|jazz|chill|study|sleep|relaxing)\s+(?:radio|beats|music|mix)\b/i;

	function plausibleArtist(s) {
		s = str(s).trim();
		if (!s || s.length > 60 || wordCount(s) > 8) return false;
		if (!/[\p{L}\p{N}]/u.test(s)) return false;
		if (TRACKNO_RE.test(s)) return false;
		if (OST_RE.test(s)) return false;
		if (NOT_ARTIST_RE.test(s)) return false;
		return classifyGroup(s).kind !== 'junk';
	}

	// Composers whose surname alone is how uploads name them, folded. A side
	// that is one of these, or a short name ending in one, is a composer.
	// Surnames that are also common words or song titles are left out.
	var COMPOSERS = words('bach beethoven mozart chopin debussy vivaldi tchaikovsky tschaikowsky brahms schubert handel haendel haydn ' +
		'liszt satie ravel rachmaninoff rachmaninov dvorak grieg mahler wagner verdi puccini schumann mendelssohn prokofiev ' +
		'stravinsky shostakovich sibelius elgar pachelbel saintsaens faure bizet rossini paganini albinoni purcell monteverdi ' +
		'telemann scarlatti mussorgsky rimskykorsakov bartok gershwin borodin offenbach delibes massenet gounod smetana janacek ' +
		'bruckner berlioz czerny clementi boccherini corelli pergolesi buxtehude rameau couperin tartini sarasate granados ' +
		'albeniz scriabin glinka khachaturian vaughanwilliams strauss');
	// The words that may stand before such a surname: given names, initials
	// and particles ("Johann Sebastian Bach", "J.S. Bach", "Ludwig van
	// Beethoven"). Anything else before it ("Roll Over Beethoven") makes the
	// side a title that mentions a composer, not a composer.
	var GIVEN = words('johann sebastian wolfgang amadeus ludwig van von de der frederic fryderyk franz claude antonio pyotr peter ilyich ' +
		'johannes georg george frideric friedrich joseph edvard gustav richard giuseppe giacomo robert clara felix sergei sergey igor dmitri ' +
		'jean philippe maurice erik camille gabriel georges modest nikolai nikolay bela edward ralph antonin leos anton hector carl karl ' +
		'muzio arcangelo giovanni battista domenico alessandro henry niccolo tomaso dietrich francois heitor alexander aram mikhail ' +
		'jacques gioachino gaetano vincenzo pablo isaac enrique manuel aaron samuel leonard philip steve arvo charles');
	function isComposer(s) {
		s = str(s).trim();
		if (!s || wordCount(s) > 4 || /[()\[\]:]/.test(s)) return false;
		if (COMPOSERS[fold(s)]) return true;
		var w = s.split(/\s+/);
		if (w.length < 2 || !COMPOSERS[fold(w[w.length - 1])] || !/^[\p{Lu}]/u.test(s)) return false;
		for (var i = 0; i < w.length - 1; i++) {
			if (/^(?:[\p{Lu}]\.)+$/u.test(w[i])) continue;   // initials: "J.S."
			if (!GIVEN[fold(w[i])]) return false;
		}
		return true;
	}

	// "PTX" on the channel "PTXofficial" for "Pentatonix": a short capitals
	// name on an artist's own channel whose letters run, in order, through
	// one side's name, starting with its first letter.
	function abbrevOf(side, ch) {
		if (ch.kind !== 'official' && ch.kind !== 'vevo') return false;
		var a = str(ch.name);
		if (!/^[A-Z0-9]{2,5}$/.test(a)) return false;
		var k = fold(side), at = 0;
		a = a.toLowerCase();
		if (!k || k.charAt(0) !== a.charAt(0) || k.length > 30) return false;
		for (var i = 0; i < a.length; i++) { at = k.indexOf(a.charAt(i), at); if (at < 0) return false; at++; }
		return true;
	}

	// "C418 (Minecraft Volume Alpha)" read as the channel's artist: the name
	// is the part before the bracket, which is kept as a tag.
	function artistSide(side, ch, st) {
		var m = /^(.*\S)\s*[(\[]([^()\[\]]+)[)\]]$/.exec(side);
		if (m && sameArtist(m[1], ch)) { st.tags.push(m[2].trim()); return m[1].trim(); }
		return side;
	}

	// The two sides of an unconfirmed "A - B" (or "A / B"): what the library
	// and the upload itself say about which side is the artist. null when
	// nothing does.
	function decideSides(A, B, ch, st, opts) {
		var known = opts && typeof opts.known === 'function' ? opts.known : null;
		if (isComposer(B) && !isComposer(A) && !CLASSICAL_STRONG.test(B)) {
			st.classical = true;
			return { artist: B, title: A, confidence: 0.85, rule: 'dash-composer' };
		}
		if (isComposer(A) && !isComposer(B)) { st.classical = true; return { artist: A, title: B, confidence: 0.85, rule: 'dash' }; }
		if (abbrevOf(B, ch) && !abbrevOf(A, ch)) return { artist: B, title: A, confidence: 0.85, rule: 'dash-title-artist' };
		if (abbrevOf(A, ch) && !abbrevOf(B, ch)) return { artist: A, title: B, confidence: 0.85, rule: 'dash' };
		if (known) {
			// known(name) -> { sure, seen }: how many tracks name this artist with
			// confidence, and how many only guess it from an "A - B" title.
			var a = counts(known(withoutFeat(A))), b = counts(known(withoutFeat(B)));
			// backed: the side is named by a sure source elsewhere in the library
			// (a Topic channel, the artist's own channel, a rule or a correction).
			// Counting how often a name turns up is only a better guess.
			var toB = { artist: B, title: A, confidence: 0.85, rule: 'known-artist', backed: true };
			var toA = { artist: A, title: B, confidence: 0.85, rule: 'known-artist', backed: true };
			var leanB = { artist: B, title: A, confidence: 0.5, rule: 'known-artist' };
			var leanA = { artist: A, title: B, confidence: 0.5, rule: 'known-artist' };
			if (eitherOrder(st)) {
				if (b.sure && !a.sure) return toB;
				if (a.sure && !b.sure) return toA;
				if (!a.sure && !b.sure && b.seen && !a.seen) return leanB;
				if (!a.sure && !b.sure && a.seen && !b.seen) return leanA;
				// Nothing sure either way: a name that heads many such uploads of
				// one shape, against a side met here and hardly anywhere else, is
				// the artist (an artist has many songs; a song title seldom recurs).
				if (!a.sure && !b.sure && a.left >= 3 && a.left >= 3 * (b.left + b.right)) return leanA;
				if (!a.sure && !b.sure && b.right >= 3 && b.right >= 3 * (a.left + a.right)) return leanB;
			} else if (a.sure && !b.sure && !b.seen) {
				// A plain "A - B" whose left side is an artist the library names
				// for sure, and whose right side is named nowhere: the usual order,
				// confirmed. (It misreads a song called after an artist, such as
				// "Name - Other Artist" where Name has a Topic channel; that shape
				// is rare.)
				return toA;
			} else if (b.sure && !a.sure && a.seen <= 1) {
				// A plain "A - B" is read "Title - Artist" only when B is a sure
				// artist and A is named as one nowhere but here (a song can be
				// called after another band).
				return toB;
			}
		}
		return null;
	}
	function counts(k) {
		if (k === true) return { sure: 1, seen: 0, left: 0, right: 0 };
		if (!k || typeof k !== 'object') return { sure: 0, seen: 0, left: 0, right: 0 };
		return { sure: +k.sure || 0, seen: +k.seen || 0, left: +k.left || 0, right: +k.right || 0 };
	}

	// A lyrics or cover upload by someone who is neither side: "Title -
	// Artist" is as usual there as "Artist - Title".
	function eitherOrder(st) {
		if (st.lyrics) return true;
		for (var i = 0; i < st.versions.length; i++) if (st.versions[i].kinds.indexOf('cover') >= 0) return true;
		return false;
	}

	// ---- The channel -----------------------------------------------------------

	// What the channel's name says about who uploads there:
	//   { raw, kind: 'topic'|'various'|'vevo'|'official'|'label'|'plain'|'none',
	//     name: the artist the channel stands for ('' when it stands for none),
	//     names: every spelling worth comparing a side of a title with }
	var LABEL_RE = /\b(?:records?|recordings|music\s+group|entertainment|labels?|publishing|lyrics|network|radio|mixes|playlists?|compilations?|sounds|nation|collective|archives?|uploads?|osts?|soundtracks?|bgm|classics|hits|vibes|beats|promotions?)\b/i;
	function channelInfo(channel) {
		var raw = tidy(channel);
		var out = { raw: raw, kind: 'plain', name: '', names: [] };
		if (!raw) { out.kind = 'none'; return out; }
		var m;
		if ((m = /^(.*?)\s+-\s+Topic$/.exec(raw))) {
			if (/^various\s+artists?$/i.test(m[1])) { out.kind = 'various'; return out; }
			out.kind = 'topic'; out.name = m[1].trim(); out.names = [out.name];
			return out;
		}
		if ((m = /^(.+?)\s*VEVO$/.exec(raw))) {
			out.kind = 'vevo'; out.name = decamel(m[1]); out.names = [out.name];
			return out;
		}
		var s = raw, official = false, i, a;
		// "Name <official><channel>" written in Japanese
		if (s.length > JP_CHANNEL.length && s.slice(-JP_CHANNEL.length) === JP_CHANNEL) s = s.slice(0, -JP_CHANNEL.length).trim();
		for (i = 0; i < JP_OFFICIAL.length; i++) {
			var w = JP_OFFICIAL[i];
			if (s.length > w.length && s.slice(-w.length) === w) { s = s.slice(0, -w.length).trim(); official = true; }
		}
		a = s.replace(/\s*[-|\/:]?\s*[(\[]?\b(?:the\s+)?official\b[)\]]?(?:\s+(?:youtube\s+)?(?:artist\s+)?(?:channel|music|videos?|tv|page)|\s+youtube)?\s*$/i, '');
		if (a !== s && a) { official = true; s = a.trim(); }
		a = s.replace(/^official\s+/i, '');
		if (a !== s && a) { official = true; s = a.replace(/\s+(?:youtube\s+)?channel$/i, '').trim(); }
		if ((m = /^(\S+?)official$/i.exec(s)) && m[1].length >= 3) { official = true; s = decamel(m[1]); }
		// "Sunken Meadow Records Official" is a label's official channel, not an
		// artist's.
		var label = LABEL_RE.test(s);
		if (official && !label) {
			out.kind = 'official'; out.name = s; out.names = [s];
			return out;
		}
		if (label) {
			out.kind = 'label';
			return out;
		}
		// A plain channel: its name is compared with the sides of a title, and
		// is never the artist merely because it uploaded the video.
		out.names = [s];
		a = s.replace(/\s+(?:youtube\s+)?(?:channel|ch\.?|music|tv|band|videos?)$/i, '');
		if (a !== s && a) out.names.push(a.trim());
		// "Ayase / YOASOBI": a channel named for two names answers to each
		var two = s.split(/\s+\/\s+/);
		if (two.length === 2 && two[0].trim() && two[1].trim()) { out.names.push(two[0].trim()); out.names.push(two[1].trim()); }
		return out;
	}

	// A name as lower-case words: no accents, "&" is "and", a leading "The"
	// dropped. The same on both sides of every comparison with a channel.
	function nameText(s) {
		return str(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ');
	}
	function nameWords(s) {
		var w = nameText(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
		if (w.length > 1 && w[0] === 'the') w.shift();
		return w;
	}
	function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
	// Words a channel adds to its artist's name ("Name Music", "NameBand",
	// "nameinet"). "Fan" and "Fans" are not among them: "Bohemian Rhapsody
	// Fan" is not Bohemian Rhapsody.
	var CH_TAIL = words('official officiel oficial music band tv channel ch vevo videos video hq net inet online');
	// What may follow the channel's name inside a side that names the channel
	// and someone else: a credit word anywhere; "&", "and", ",", "+", "/" and
	// "with" only on the artist's own (official or VEVO) channel or after a
	// name of two words or more, because a song can be called "Heart & Soul"
	// and be uploaded by a channel "Heart".
	var JOIN_STRONG = /^(?:feat\b|ft\b|featuring\b|x\b|×|vs\b)/;
	var JOIN_WEAK = /^(?:and\b|with\b|,|\+|\/)/;

	// Is this side of a title the channel's own artist? Whole words only.
	//   2  the side is the channel's name ("Earth, Wind & Fire" on "Earth Wind
	//      and Fire"; "Oasis" on "oasisinet"; "Lil Nas X" on "Lil Nas X Music")
	//   1  the side is the channel's name and a credit ("Name feat. X")
	//   0  anything else: "Kissin' Time" on "KISS", "Rush Hour" on "Rush",
	//      "Heartless" on "Heart", "Bohemian Rhapsody" on "Bohemian Rhapsody Fan"
	// Callers that weigh two sides take the higher level (sideOf).
	function sameArtist(side, ch) {
		var sw = nameWords(side);
		if (!sw.length) return 0;
		var sk = sw.join(''), best = 0;
		var forms = [];
		ch.names.forEach(function (nm) {
			var w = nameWords(nm);
			forms.push(w);
			// "ThePianoGuys", "GlassOrchardBand": the words a camel-case name hides
			if (w.length === 1) { var d = nameWords(decamel(nm)); if (d.length > 1) forms.push(d); }
		});
		for (var i = 0; i < forms.length; i++) {
			var hw = forms[i];
			if (!hw.length) continue;
			var hk = hw.join('');
			if (sk === hk) return 2;
			// the channel is the side and a channel word: "Name Music", "nameinet"
			var j, tail = true;
			if (hw.length > sw.length) {
				for (j = 0; j < sw.length; j++) if (hw[j] !== sw[j]) { tail = false; break; }
				for (j = sw.length; tail && j < hw.length; j++) if (!CH_TAIL[hw[j]]) tail = false;
				if (tail) return 2;
			}
			// a channel name written as one word: "GlassOrchardBand", "oasisinet"
			if (hw.length === 1 && sk.length >= 3 && hk.indexOf(sk) === 0 && CH_TAIL[hk.slice(sk.length)]) return 2;
			// the side is the channel's name and a credit
			if (hk.length >= 2 && sw.length > hw.length) {
				var m = new RegExp('^\\s*(?:the\\s+)?' + hw.map(escapeRe).join('[^\\p{L}\\p{N}]+') + '(?![\\p{L}\\p{N}])[\\s.]*(.*)$', 'u').exec(nameText(side));
				if (m && (JOIN_STRONG.test(m[1]) || ((ch.kind === 'official' || ch.kind === 'vevo' || hw.length >= 2) && JOIN_WEAK.test(m[1])))) best = 1;
			}
		}
		return best;
	}
	// A channel of live sessions that names itself in the title's live tag:
	// "Artist - Title (Live on KEXP)" on KEXP, "(Live at Red Hollow)" on Red
	// Hollow Sessions, "| A COLORS SHOW" on COLORS. Such series write the
	// artist first. The channel's own words (without "Sessions", "Live",
	// "Music" and the like) must all stand, as whole words, in a tag that
	// speaks of a performance: "| Glass Orchard fan edit" on "Glass Orchard
	// Fan" is not one.
	var SESSION_GENERIC = words('sessions session live music tv official channel the studio studios radio presents');
	var SESSION_WORD = /\b(?:live|session|sessions|show|concert|performance|tiny\s+desk)\b/i;
	function sessionTag(ch, st) {
		if (!ch.raw || ch.kind === 'topic' || ch.kind === 'various') return false;
		var cw = nameWords(ch.raw).filter(function (w) { return !SESSION_GENERIC[w]; });
		if (!cw.length || cw.join('').length < 3) return false;
		var texts = [];
		st.versions.forEach(function (v) { if (v.kinds.indexOf('live') >= 0) texts.push(v.text); });
		st.tags.forEach(function (t) { if (SESSION_WORD.test(t)) texts.push(t); });
		for (var i = 0; i < texts.length; i++) {
			var tw = nameWords(texts[i]), all = true;
			for (var j = 0; j < cw.length; j++) if (tw.indexOf(cw[j]) < 0) { all = false; break; }
			if (all) return true;
		}
		return false;
	}
	// A record label by name (not a lyrics, mix or "hits" channel, which the
	// broader LABEL_RE also counts as "not an artist").
	var LABEL_STRICT = /\b(?:records|recordings|music\s+group|entertainment|label)\b/i;

	// Which of two sides is the channel's artist: 'a', 'b', 'both' (alike)
	// or '' (neither). A side that is the channel's name beats one that only
	// contains it.
	function sideOf(a, b, ch) {
		var x = sameArtist(withoutFeat(a), ch), y = sameArtist(withoutFeat(b), ch);
		if (!x && !y) return '';
		if (x > y) return 'a';
		if (y > x) return 'b';
		return 'both';
	}

	// ---- Brackets --------------------------------------------------------------

	// What the text inside one bracket (or one dash-separated part) is:
	//   { kind: 'junk'|'version'|'feat'|'ost'|'year'|'credit'|null, ... }
	// junk carries `strong`: true when it holds a word that is junk anywhere.
	function classifyGroup(text) {
		var t = str(text).trim().replace(/^[\s\-~:]+|[\s\-~:]+$/g, '');
		if (!t) return { kind: 'junk', strong: true };
		var m, i;
		if (/^(?:19|20)\d\d$/.test(t)) return { kind: 'year', year: +t };
		if ((m = /^(?:feat\.?|ft\.?|featuring)\s+(.+)$/i.exec(t))) return { kind: 'feat', names: splitNames(m[1]) };
		if (/^(?:prod\.?|produced)\s+(?:by\s+)?\S/i.test(t)) return { kind: 'credit', text: t };
		if ((m = /^from\s+(?:the\s+)?["\u201C]?(.+?)["\u201D]?$/i.exec(t)) && /^from\s+(?:the\s+)?["\u201C]|soundtrack|\bost\b|\bfilm\b|\bmovie\b|\bgame\b|\banime\b|\bseries\b|\bmusical\b/i.test(t)) {
			return { kind: 'ost', album: cleanSide(m[1].replace(OST_WORDS, ' ').replace(/["\u201C\u201D]/g, '')) };
		}
		if (OST_RE.test(t)) return { kind: 'ost', album: cleanSide(t.replace(OST_WORDS, ' ')) };

		var kinds = [];
		for (i = 0; i < VERSION_KINDS.length; i++) if (VERSION_KINDS[i][1].test(t)) kinds.push(VERSION_KINDS[i][0]);
		for (i = 0; i < JP_VERSION.length; i++) if (t.indexOf(JP_VERSION[i][1]) >= 0 && kinds.indexOf(JP_VERSION[i][0]) < 0) kinds.push(JP_VERSION[i][0]);
		if (kinds.length) return { kind: 'version', kinds: kinds, text: t };

		// Junk: every word is a junk word, a resolution or a year.
		var rest = t, strong = hasAny(t, JP_JUNK), official = hasAny(t, JP_OFFICIAL);
		for (i = 0; i < JP_JUNK.length; i++) rest = rest.split(JP_JUNK[i]).join(' ');
		var low = rest.toLowerCase().replace(/m\/v/g, 'mv').replace(/cover\s+art/g, 'cover-art').replace(/original\s+mix/g, 'original');
		var list = low.split(/[\s\/_,.:;!+&|\u30FB]+/).filter(Boolean);
		var year = null, allJunk = true;
		for (i = 0; i < list.length; i++) {
			var w = list[i].replace(/^-+|-+$/g, '');
			if (!w) continue;
			if (w === 'official' || w === 'oficial' || w === 'officiel' || w === 'offizielles') official = true;
			if (JUNK_STRONG[w] || /^\d{3,4}p$|^\d{2,3}fps$|^\d{2,4}kbps$|^[48]k$/.test(w)) { strong = true; continue; }
			if (JUNK_WEAK[w]) continue;
			if (/^(?:19|20)\d\d$/.test(w)) { year = +w; continue; }
			allJunk = false;
			break;
		}
		if (allJunk && (strong || JUNK_PHRASE.test(t))) return { kind: 'junk', strong: strong, official: official, year: year, lyrics: !official && (/lyric|letra/i.test(t) || t.indexOf(JP_JUNK[3]) >= 0) };
		if (VERSION_GENERIC.test(t)) return { kind: 'version', kinds: ['alt'], text: t };
		return { kind: null, text: t };
	}

	function note(st, c) {
		if (c.kind === 'version') st.versions.push({ kinds: c.kinds, text: c.text });
		else if (c.kind === 'feat') st.feat = st.feat.concat(c.names);
		else if (c.kind === 'ost') { if (!st.album && c.album) st.album = c.album; st.ost = true; }
		else if (c.kind === 'year') { if (!st.year) st.year = c.year; }
		else if (c.kind === 'credit') st.tags.push(c.text);
		else if (c.kind === 'junk') {
			if (c.official) st.official = true;
			if (c.lyrics) st.lyrics = true;
			if (c.year && !st.year) st.year = c.year;
		}
	}

	// Take the brackets out of a title: recognised ones are noted and removed,
	// unknown round and square ones stay where they are (they are part of the
	// name), unknown lenticular ones become tags.
	var PARK = [String.fromCharCode(1), String.fromCharCode(2), String.fromCharCode(3), String.fromCharCode(4)];
	function stripGroups(s, st) {
		var guard = 0, before;
		var lentRe = new RegExp(LENT_SRC, 'g');
		function round(all, inner) {
			var c = classifyGroup(inner);
			if (c.kind) { note(st, c); return ' '; }
			// Parked as control characters so that the loop sees the brackets
			// around this one; put back below.
			return all.charAt(0) === '(' ? PARK[0] + inner + PARK[1] : PARK[2] + inner + PARK[3];
		}
		function lent(all, inner) {
			var c = classifyGroup(inner);
			if (c.kind) note(st, c);
			else if (inner.trim()) st.tags.push(inner.trim());
			return ' ';
		}
		do {
			before = s;
			s = s.replace(lentRe, lent);
			s = s.replace(/\(([^()]*)\)/g, round);
			s = s.replace(/\[([^\[\]]*)\]/g, round);
		} while (s !== before && ++guard < 8);
		s = s.split(PARK[0]).join('(').split(PARK[1]).join(')').split(PARK[2]).join('[').split(PARK[3]).join(']');
		return s.replace(/\s+/g, ' ').trim();
	}

	// "Title -Piano ver.-" and "Title ~Acoustic~": a decorated tail.
	function stripDecorated(s, st) {
		var m = /^(.*\S)\s+([\-~\u301C])\s*([^\-~\u301C]{2,40}?)\s*[\-~\u301C]\s*$/.exec(s);
		if (!m) return s;
		var c = classifyGroup(m[3]);
		if (c.kind === 'version' || c.kind === 'junk') { note(st, c); return m[1].trim(); }
		return s;
	}

	function stripTrailJunk(s, st) {
		var guard = 0, m;
		while (guard++ < 6) {
			m = TRAIL_JUNK_CAPS.exec(s) || TRAIL_JUNK_I.exec(s);
			if (!m || m.index === 0) break;
			var head = s.slice(0, m.index).trim();
			if (!head) break;
			if (/official/i.test(m[0])) st.official = true;
			if (/lyric/i.test(m[0]) && !/official/i.test(m[0])) st.lyrics = true;
			s = head;
		}
		m = LEAD_JUNK.exec(s);
		if (m && s.length > m[0].length) s = s.slice(m[0].length);
		return s;
	}

	// "... feat. Someone" at the end of a side.
	var FEAT_TAIL = /^(.*?\S)\s+[(\[]?(?:feat\.?|featuring|ft\.?)\s+(\S.*?)[)\]]?\s*$/i;
	function takeFeat(s, st) {
		var m = FEAT_TAIL.exec(s);
		if (!m || /\d$/.test(m[1])) return s;
		st.feat = st.feat.concat(splitNames(m[2]));
		return m[1].trim();
	}
	// The side without its "feat." tail, for comparing with the channel.
	function withoutFeat(s) {
		var m = FEAT_TAIL.exec(s);
		return m && !/\d$/.test(m[1]) ? m[1] : s;
	}
	function hasFeat(s) { return withoutFeat(s) !== s; }

	// ---- The rules -------------------------------------------------------------

	// A rule the user set for this channel: 'artist-title', 'title-artist',
	// 'channel' (the channel is the artist and the title is the whole title),
	// 'none' (never guess), or { artist: 'Name' } for a channel that uploads one
	// artist under another name.
	function byRule(main, ch, st, rule) {
		var fixed = rule && typeof rule === 'object' ? str(rule.artist).trim() : '';
		var kind = typeof rule === 'string' ? rule : (fixed ? 'fixed' : str(rule && rule.format));
		var q, parts;
		if (kind === 'none') return { artist: '', title: main, confidence: 1, rule: 'channel-rule' };
		if (kind === 'channel' || kind === 'fixed') {
			var name = fixed || ch.name || ch.names[ch.names.length - 1] || ch.raw;
			parts = main.split(SEP_DASH).map(cleanSide).filter(Boolean);
			if (parts.length === 2 && fold(parts[0]) === fold(name)) main = parts[1];
			else if (parts.length === 2 && fold(parts[1]) === fold(name)) main = parts[0];
			return { artist: name, title: main, confidence: 1, rule: 'channel-rule' };
		}
		if (kind !== 'artist-title' && kind !== 'title-artist') return null;
		q = QUOTE_ONE.exec(main);
		if (q) {
			var other = cleanSide(stripTrailJunk(main.slice(0, q.index) + ' ' + main.slice(q.index + q[0].length), st));
			if (other) return { artist: other, title: q[1].trim(), confidence: 1, rule: 'channel-rule' };
		}
		parts = main.split(SEP_DASH).map(cleanSide).filter(Boolean);
		if (parts.length < 2) parts = main.split(SEP_SLASH).map(cleanSide).filter(Boolean);
		if (parts.length < 2) return null;
		if (kind === 'artist-title') return { artist: parts[0], title: parts.slice(1).join(' - '), confidence: 1, rule: 'channel-rule' };
		return { artist: parts[parts.length - 1], title: parts.slice(0, -1).join(' - '), confidence: 1, rule: 'channel-rule' };
	}

	// What is left beside a quoted title may be only a version, a credit or
	// junk; then it is noted and the side is empty.
	function leftover(s, st) {
		if (!s) return '';
		var c = classifyGroup(s);
		if (c.kind === 'junk' ? c.strong : (c.kind && c.kind !== 'year')) { note(st, c); return ''; }
		return s;
	}

	function byQuote(main, ch, st) {
		var re = new RegExp(QUOTE_SRC, 'g'), groups = [], m, i;
		while ((m = re.exec(main))) groups.push({ index: m.index, len: m[0].length, text: m[1].trim() });
		if (!groups.length) return null;
		var g = groups[0];
		var before = cleanSide(stripTrailJunk(main.slice(0, g.index), st));
		var after = main.slice(g.index + g.len);
		var extra = groups.length > 1;
		if (extra) {
			// More than one quoted piece: the others are kept as tags and the
			// answer is marked as a guess.
			after = after.replace(new RegExp(QUOTE_SRC, 'g'), ' ');
			for (i = 1; i < groups.length; i++) st.tags.push(groups[i].text);
		}
		after = cleanSide(stripTrailJunk(' ' + after, st));
		before = leftover(before, st);
		after = leftover(after, st);
		var title = g.text, res;
		if (before && !after) res = { artist: before, title: title, confidence: sameArtist(before, ch) ? 0.95 : 0.85, rule: 'quote-artist-first' };
		else if (!before && after) res = { artist: after, title: title, confidence: sameArtist(after, ch) ? 0.95 : 0.7, rule: 'quote-title-first' };
		else if (before && after) {
			var qs = sideOf(before, after, ch);
			if (qs === 'b') { res = { artist: after, title: title, confidence: 0.9, rule: 'quote-title-first' }; st.tags.push(before); }
			else { res = { artist: before, title: title, confidence: qs ? 0.9 : 0.6, rule: 'quote-artist-first' }; st.tags.push(after); }
		} else {
			res = byChannel(title, ch, st);
			if (res.rule === 'none') res.rule = 'quote-only';
			return res;
		}
		if (extra) res.confidence = Math.min(res.confidence, 0.5);
		if (!plausibleArtist(res.artist)) { st.tags.push(res.artist); res = { artist: '', title: title, confidence: 0, rule: 'quote-only' }; }
		return res;
	}

	function byClassical(main, ch, st) {
		var m = /^([^:]{2,40}):\s+(.+)$/.exec(main);
		if (!m) return null;
		var composer = m[1].trim(), rest = m[2], before = '';
		// "Performer - Composer: Work", the usual shape on a performer's or a
		// label's channel: the performer is not part of the composer's name.
		var lead = composer.split(SEP_DASH).map(cleanSide).filter(Boolean);
		if (lead.length === 2 && isComposer(lead[1]) && plausibleArtist(lead[0])) { before = lead[0]; composer = lead[1]; }
		else if (lead.length > 1) return null;
		if (wordCount(composer) > 4 || !/^[\p{L}][\p{L} .'\-]*$/u.test(composer)) return null;
		if (before) {
			st.classical = true;
			st.performer = before;
			st.tags.push(composer);
			var work = cleanSide(rest);
			// The performer is the artist when the channel is theirs; otherwise
			// the composer, as on every other classical title.
			if (sameArtist(before, ch)) return { artist: before, title: work, confidence: 0.9, rule: 'classical-performer' };
			return { artist: composer, title: work, confidence: 0.85, rule: 'classical-colon' };
		}
		if (!CLASSICAL_STRONG.test(rest)) {
			// "Vivaldi: The Four Seasons - Spring": a composer by name, no catalogue
			// number; the whole rest is the work.
			if (!isComposer(composer)) return null;
			st.classical = true;
			return { artist: composer, title: cleanSide(rest), confidence: 0.85, rule: 'classical-colon' };
		}
		var parts = rest.split(SEP_DASH).map(cleanSide).filter(Boolean);
		// Movements stay with the work; the first part that is neither a
		// movement nor a catalogue number starts the performer.
		var keep = [parts[0]], who = [];
		for (var i = 1; i < parts.length; i++) {
			if (!who.length && (MOVEMENT_RE.test(parts[i]) || CLASSICAL_STRONG.test(parts[i]))) keep.push(parts[i]);
			else who.push(parts[i]);
		}
		st.performer = who.join(' - ');
		st.classical = true;
		return { artist: composer, title: keep.join(' - '), confidence: 0.85, rule: 'classical-colon' };
	}

	function byDash(main, ch, st, opts) {
		var parts = main.split(SEP_DASH).map(cleanSide).filter(Boolean);
		if (parts.length < 2) return null;
		var c, i;
		// Junk at the end goes; a version at the end goes when what is left can
		// still be an artist and a title ("Artist - Live" keeps its title).
		while (parts.length > 1) {
			c = classifyGroup(parts[parts.length - 1]);
			if (c.kind === 'junk' && c.strong) { note(st, c); parts.pop(); }
			else if (c.kind === 'version' && parts.length > 2 && c.kinds[0] !== 'alt') { note(st, c); parts.pop(); }
			else break;
		}
		// A soundtrack: one part names the album, a number is the track.
		var ostAt = -1;
		for (i = 0; i < parts.length; i++) if (OST_RE.test(parts[i])) { ostAt = i; break; }
		if (ostAt >= 0 && parts.length >= 2) {
			var album = parts[ostAt], lead = [], tail = [];
			for (i = 0; i < parts.length; i++) {
				if (i === ostAt) continue;
				var tn = TRACKNO_RE.exec(parts[i]);
				if (tn) { st.trackNo = +tn[1]; continue; }
				(i < ostAt ? lead : tail).push(parts[i]);
			}
			st.album = cleanSide(album.replace(OST_WORDS, ' ')) || album;
			st.ost = true;
			// "Film Soundtrack - Title - Composer" on the composer's channel
			if (!lead.length && tail.length > 1 && sameArtist(tail[tail.length - 1], ch)) return { artist: tail.pop(), title: tail.join(' - '), confidence: 0.9, rule: 'dash-title-artist' };
			if (lead.length && tail.length) return { artist: lead.join(' - '), title: tail.join(' - '), confidence: sameArtist(lead.join(' - '), ch) ? 0.9 : 0.7, rule: 'dash-multi' };
			var only = (tail.length ? tail : lead).join(' - ');
			return only ? { artist: '', title: only, confidence: 0.8, rule: 'ost' } : null;
		}
		// "03 - Title", "Artist - 03 - Title": a number that is not the last part.
		for (i = parts.length - 2; i >= 0; i--) {
			var t = TRACKNO_RE.exec(parts[i]);
			if (t && (i === 0 || /^\d{1,2}$/.test(parts[i]))) { st.trackNo = +t[1]; parts.splice(i, 1); }
		}
		if (parts.length < 2) return parts.length ? byLater(parts[0], ch, st, opts) : null;

		var first = parts[0], last = parts[parts.length - 1];
		if (parts.length === 2) {
			// The side that is the channel's name, whole words; when both
			// mention it, the one that is exactly the name ("Rush Hour - Rush"
			// on the channel Rush is by Rush).
			var side = sideOf(artistSide(first, ch, { tags: [] }), artistSide(last, ch, { tags: [] }), ch);
			if (side === 'a' || side === 'both') return { artist: artistSide(first, ch, st), title: last, confidence: 0.95, rule: 'dash' };
			if (side === 'b') return { artist: artistSide(last, ch, st), title: first, confidence: 0.9, rule: 'dash-title-artist' };
			if (CLASSICAL_STRONG.test(first) && !CLASSICAL_RE.test(last) && plausibleArtist(last)) {
				st.performer = last; st.classical = true;
				return { artist: last, title: first, confidence: 0.6, rule: 'classical-work-performer' };
			}
			// "Film - Theme (Soundtrack)": a bare soundtrack bracket with no album
			// in it; the left side is then the film far more often than anyone
			// who plays.
			if (st.ost && !st.album && !CLASSICAL_RE.test(first) && !isComposer(first)) {
				st.album = first;
				return { artist: '', title: last, confidence: 0.8, rule: 'ost' };
			}
			var sided = decideSides(first, last, ch, st, opts);
			if (sided) return sided;
			// Two uploaders who write "Artist - Title" and say who they are:
			// a live-session channel named in the title's live tag ("Live on
			// KEXP" on KEXP), and a record label's official upload.
			if (!eitherOrder(st) && plausibleArtist(first)) {
				if (sessionTag(ch, st)) return { artist: first, title: last, confidence: 0.75, rule: 'dash-session' };
				if ((st.official || /\bofficial\b/i.test(ch.raw)) && ch.kind === 'label' && LABEL_STRICT.test(ch.raw)) return { artist: first, title: last, confidence: 0.7, rule: 'dash-label' };
			}
			if (!plausibleArtist(first)) return { artist: '', title: parts.join(' - '), confidence: 0, rule: 'none' };
			if (eitherOrder(st)) return { artist: first, title: last, confidence: 0.5, rule: 'dash-guess' };
			return { artist: first, title: last, confidence: wordCount(first) > 5 || first.length > 40 ? 0.5 : 0.8, rule: 'dash' };
		}
		var multi = sideOf(first, last, ch);
		if (multi === 'b') {
			return { artist: last, title: parts.slice(0, -1).join(' - '), confidence: 0.7, rule: 'dash-title-artist' };
		}
		if (!plausibleArtist(first)) return { artist: '', title: parts.join(' - '), confidence: 0, rule: 'none' };
		return { artist: first, title: parts.slice(1).join(' - '), confidence: multi ? 0.9 : 0.6, rule: 'dash-multi' };
	}

	// After the dash rule has eaten its junk parts and one part is left.
	function byLater(main, ch, st, opts) {
		return bySlash(main, ch, st) || byAsciiQuote(main, ch, st) || byChannel(main, ch, st);
	}

	function bySlash(main, ch, st) {
		var parts = main.split(SEP_SLASH).map(cleanSide).filter(Boolean);
		if (parts.length !== 2) return null;
		var L = parts[0], R = parts[1];
		var s = sideOf(L, R, ch);
		if (s === 'b') return { artist: R, title: L, confidence: 0.9, rule: 'slash-title-artist' };
		if (s === 'a') return { artist: L, title: R, confidence: 0.9, rule: 'slash-artist-title' };
		// A "feat." credit hangs on the artist's side.
		if (hasFeat(R) && !hasFeat(L)) return { artist: R, title: L, confidence: 0.7, rule: 'slash-title-artist' };
		if (hasFeat(L) && !hasFeat(R)) return { artist: L, title: R, confidence: 0.7, rule: 'slash-artist-title' };
		if (!plausibleArtist(R)) return null;
		// Japanese-style punctuation or script anywhere in the title or the
		// channel makes "Title / Artist" the likely reading; without it this is
		// a coin toss and is reported as one.
		if (st.jp) return { artist: R, title: L, confidence: 0.65, rule: 'slash-title-artist' };
		return { artist: R, title: L, confidence: 0.4, rule: 'slash-guess' };
	}

	// "Artist- Title", "Artist -Title", "Artist<en dash>Title": a single dash
	// that is not spaced on both sides.
	var LOOSE_DASH = new RegExp('^([^' + DASH + ']+?)(?:\\s+[' + DASH + ']|[' + DASH + ']\\s+|[\\u2013\\u2014])([^' + DASH + ']+)$');
	function byLooseDash(main, ch, st) {
		var m = LOOSE_DASH.exec(main);
		if (!m) return null;
		var L = cleanSide(m[1]), R = cleanSide(m[2]);
		if (!L || !R || !plausibleArtist(L)) return null;
		var s = sideOf(L, R, ch);
		if (s === 'b') return { artist: R, title: L, confidence: 0.8, rule: 'dash-title-artist' };
		return { artist: L, title: R, confidence: s ? 0.9 : 0.6, rule: 'dash-loose' };
	}

	// Artist "Title", with nothing after it but junk.
	function byAsciiQuote(main, ch, st) {
		var m = /^(.+?)\s+["\u201C]([^"\u201C\u201D]+)["\u201D]\s*(.*)$/.exec(main);
		if (!m) return null;
		var before = cleanSide(m[1]), after = cleanSide(stripTrailJunk(' ' + m[3], st));
		if (after && leftover(after, st)) return null;
		if (!plausibleArtist(before)) return null;
		return { artist: before, title: m[2].trim(), confidence: sameArtist(before, ch) ? 0.9 : 0.7, rule: 'quote-ascii' };
	}

	// No separator: only the channel can name the artist.
	function byChannel(main, ch, st) {
		var name = ch.name || '', i;
		// "Name Title" on the channel "Name".
		var candidates = ch.kind === 'vevo' || ch.kind === 'official' ? ch.names : ch.names.filter(function (n) { return wordCount(n) >= 2; });
		for (i = 0; i < ch.names.length; i++) {
			var n = ch.names[i];
			if (n.length < 4 || main.length <= n.length + 1 || main.slice(0, n.length).toLowerCase() !== n.toLowerCase()) continue;
			// a one-word name is a prefix only before a colon ("Paramore: Title")
			var after = main.charAt(n.length);
			if (candidates.indexOf(n) >= 0 ? /^[\s:,]/.test(after) : after === ':') {
				return { artist: n, title: cleanSide(main.slice(n.length).replace(/^\s*:/, '')), confidence: 0.7, rule: 'channel-prefix' };
			}
		}
		if (ch.kind === 'topic') return { artist: name, title: main, confidence: 0.95, rule: 'topic' };
		if (ch.kind === 'vevo' && name) return { artist: name, title: main, confidence: 0.75, rule: 'vevo-channel' };
		if (ch.kind === 'official' && name) return { artist: name, title: main, confidence: 0.7, rule: 'official-channel' };
		if (ch.kind === 'plain' && st.official && ch.names.length) {
			return { artist: ch.names[ch.names.length - 1], title: main, confidence: 0.6, rule: 'channel-official-video' };
		}
		return { artist: '', title: main, confidence: 0, rule: 'none' };
	}

	// ---- parse -----------------------------------------------------------------

	var KIND_ORDER = VERSION_KINDS.map(function (k) { return k[0]; }).concat(['alt']);

	function parse(rawTitle, rawChannel, opts) {
		opts = opts || {};
		var ch = channelInfo(rawChannel);
		var st = { versions: [], feat: [], tags: [], album: '', trackNo: null, year: null, performer: '', official: false, lyrics: false, ost: false, classical: false, jp: false };
		var s0 = tidy(rawTitle);
		st.jp = JP_RE.test(str(rawTitle) + ' ' + str(rawChannel));

		var s = s0.replace(/(?:\s+#[\p{L}\p{N}_]+)+\s*$/u, '');
		var m = OST_PREFIX.exec(s);
		if (m) s = m[1] + ' OST ' + s.slice(m[0].length);
		s = stripGroups(s, st);
		s = stripDecorated(s, st);
		m = OST_COLON.exec(s);
		if (m) s = m[1] + ' - ' + s.slice(m[0].length);

		// "Main | extra | extra": the main part is the first one, unless only a
		// later one has the shape of "artist - title".
		var segs = s.split(SEP_PIPE).map(function (x) { return x.trim(); }).filter(Boolean);
		var main = segs.length ? segs[0] : s, mainAt = 0, i;
		// "Artist | Title" (or "Title | Artist") where one part is the channel's
		// own name: read as a dash between them.
		var pipeSide = segs.length === 2 && !SEP_DASH.test(s) && ch.kind !== 'topic' ? sideOf(segs[0], segs[1], ch) : '';
		if (pipeSide === 'a' || pipeSide === 'b') {
			main = pipeSide === 'a' ? segs[0] + ' - ' + segs[1] : segs[1] + ' - ' + segs[0];
			segs = [main];
		}
		if (segs.length > 1 && !SEP_DASH.test(segs[0]) && !QUOTE_ONE.test(segs[0])) {
			for (i = 1; i < segs.length; i++) if (SEP_DASH.test(segs[i])) { main = segs[i]; mainAt = i; break; }
		}
		for (i = 0; i < segs.length; i++) {
			if (i === mainAt) continue;
			var c = classifyGroup(segs[i]);
			if (c.kind) note(st, c); else st.tags.push(segs[i]);
		}
		main = cleanSide(stripTrailJunk(main, st));

		var res = null;
		if (main) {
			if (opts.channelRule) res = byRule(main, ch, st, opts.channelRule);
			if (!res && ch.kind === 'topic') res = { artist: ch.name, title: main, confidence: 0.95, rule: 'topic' };
			if (!res) res = byQuote(main, ch, st);
			if (!res) res = byClassical(main, ch, st);
			if (!res) res = byDash(main, ch, st, opts);
			if (!res) res = bySlash(main, ch, st);
			if (!res) res = byLooseDash(main, ch, st);
			if (!res) res = byAsciiQuote(main, ch, st);
			if (!res) res = byChannel(main, ch, st);
		}
		if (!res || !str(res.title).trim()) res = { artist: '', title: s0, confidence: 0, rule: 'none' };
		if (res.rule === 'none' && st.ost) { res.rule = 'ost'; res.confidence = 0.8; }

		// Tidy the two sides.
		var artist = cleanSide(takeFeat(cleanSide(res.artist), st));
		var title = cleanSide(takeFeat(cleanSide(res.title), st));
		title = stripWrapQuotes(cleanSide(stripTrailJunk(title, st)));
		var lead = /^(\d{1,3})\.\s+(?=\S)/.exec(title) || /^(0\d{1,2})\s+(?=\S)/.exec(title);
		if (lead && title.length > lead[0].length && st.trackNo == null) { st.trackNo = +lead[1]; title = title.slice(lead[0].length); }
		artist = stripWrapQuotes(artist);
		if (!title) { title = s0; artist = ''; res.confidence = 0; res.rule = 'none'; }
		if (artist && fold(artist) === fold(title) && res.rule !== 'channel-rule' && res.rule !== 'topic') res.confidence = Math.min(res.confidence, 0.5);
		// The policy: an artist is trusted only when something besides the
		// shape of the title vouches for it. Every other reading is kept as a
		// guess, under the threshold, for the page to offer.
		var why = artist ? vouched(res, artist, ch, st) : '';
		if (artist && !why) res.confidence = Math.min(res.confidence, GUESS_CAP);

		// The versions, in a fixed order, each kind once.
		var kinds = [], texts = [];
		st.versions.forEach(function (v) {
			v.kinds.forEach(function (k) { if (kinds.indexOf(k) < 0) kinds.push(k); });
			if (texts.indexOf(v.text) < 0) texts.push(v.text);
		});
		if (kinds.length > 1) kinds = kinds.filter(function (k) { return k !== 'alt'; });
		kinds.sort(function (a, b) { return KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b); });
		var feat = [];
		st.feat.forEach(function (f) { if (f && feat.indexOf(f) < 0) feat.push(f); });
		var sure = artist || res.rule === 'ost' || res.rule === 'channel-rule';

		return {
			artist: artist,
			title: title,
			version: kinds.join('+'),
			versionText: texts.join('; '),
			feat: feat,
			performer: st.performer || '',
			album: st.album || '',
			trackNo: st.trackNo,
			year: st.year,
			tags: st.tags,
			soundtrack: !!st.ost,
			classical: !!st.classical,
			// the title with its junk gone but not split: what to show when the
			// split is not trusted
			whole: stripWrapQuotes(main) || s0,
			confidence: sure ? Math.round(res.confidence * 100) / 100 : 0,
			rule: res.rule,
			// what vouches for the artist ('' when the artist is a guess or none)
			vouched: why
		};
	}

	// The confidence a reading nothing vouches for can reach: under
	// library.js's threshold (0.6), so the page shows it as a guess.
	var GUESS_CAP = 0.5;

	// What, besides the shape of the title, says that this artist is right:
	//   'rule'      a format the user set for the channel;
	//   'topic'     an auto-generated "Artist - Topic" channel;
	//   'channel'   the artist is the channel's own name, or contains it, or the
	//               channel is the artist's VEVO or official one, or the other
	//               side of the split is the channel's name ("Composer: Work -
	//               Performer" on the performer's channel);
	//   'library'   the library names this artist from one of the above;
	//   'composer'  a composer from the table, named first or before a colon.
	// '' when nothing does.
	function vouched(res, artist, ch, st) {
		var rule = res.rule;
		if (rule === 'channel-rule') return 'rule';
		if (rule === 'topic') return 'topic';
		if (rule === 'channel-official-video') return '';
		if (rule === 'vevo-channel' || rule === 'official-channel') return 'channel';
		if (rule === 'dash-session') return 'session';
		if (rule === 'dash-label') return 'label';
		var a = withoutFeat(artist);
		if (sameArtist(a, ch) || abbrevOf(a, ch)) return 'channel';
		if (rule === 'classical-colon' && st && st.performer && sameArtist(st.performer, ch)) return 'channel';
		if (rule === 'known-artist') return res.backed ? 'library' : '';
		if ((rule === 'classical-colon' || rule === 'dash') && isComposer(a)) return 'composer';
		return '';
	}

	// ---- Numbered runs -----------------------------------------------------------

	function roman(s) {
		var map = { i: 1, v: 5, x: 10, l: 50, c: 100 }, total = 0, prev = 0;
		s = str(s).toLowerCase();
		for (var i = s.length - 1; i >= 0; i--) {
			var v = map[s.charAt(i)];
			if (!v) return NaN;
			if (v < prev) total -= v; else { total += v; prev = v; }
		}
		return total;
	}

	// Is this title one numbered part of something longer?
	//   partOf('Night Suite, Pt. 2')          -> { base: 'Night Suite', n: 2, of: null }
	//   partOf('Symphony No. 5: II. Andante') -> { base: 'Symphony No. 5', n: 2, of: null }
	//   partOf('Long Mix [2/3]')              -> { base: 'Long Mix', n: 2, of: 3 }
	// null when it is not. library.js stores the answer as track.run and
	// shuffle.js keeps such runs in order.
	function partOf(title) {
		var t = tidy(title), m, n;
		if (!t) return null;
		m = /^(.*?)[\s,:;(\[\-\u2013\u2014]*\b(part|pt\.?|movement|mvt\.?|mov\.?|act|side|disc|vol\.?|volume|chapter|episode|scene|teil)\s*(\d{1,3}|[ivxlc]{1,7}|[a-d])\b[)\]]?(.*)$/i.exec(t);
		if (m && m[1].trim()) {
			var word = m[2].toLowerCase(), tok = m[3];
			if (/^\d+$/.test(tok)) n = +tok;
			else if (/^[a-d]$/i.test(tok) && word === 'side') n = tok.toLowerCase().charCodeAt(0) - 96;
			else if (/^[ivxlc]+$/i.test(tok)) n = roman(tok);
			else n = NaN;
			if (n > 0 && n < 400) return { base: cleanSide(m[1]), n: n, of: null };
		}
		m = /^(.*?\S)\s*[:,\-\u2013\u2014]\s*([IVX]{1,4})\.\s+\S/.exec(t);
		if (m) { n = roman(m[2]); if (n > 0) return { base: cleanSide(m[1]), n: n, of: null }; }
		m = /^(.*?\S)[\s(\[]+(\d{1,2})\s*\/\s*(\d{1,2})[)\]]?\s*$/.exec(t);
		if (m && +m[2] >= 1 && +m[2] <= +m[3]) return { base: cleanSide(m[1]), n: +m[2], of: +m[3] };
		m = /^(.*?\S)\s+#(\d{1,3})\s*$/.exec(t);
		if (m) return { base: cleanSide(m[1]), n: +m[2], of: null };
		return null;
	}

	// The release year an auto-generated description states ("Released on:
	// 1997-05-21", or the sound-recording copyright line). null when it
	// states none.
	function releaseYear(description) {
		var d = str(description);
		var m = /Released on:\s*(\d{4})-\d{2}-\d{2}/.exec(d) || /\u2117\s*(\d{4})\b/.exec(d);
		if (!m) return null;
		var y = +m[1];
		return y >= 1900 && y <= 2100 ? y : null;
	}

	return {
		parse: parse,
		channelInfo: channelInfo,
		classifyGroup: classifyGroup,
		partOf: partOf,
		releaseYear: releaseYear,
		tidy: tidy,
		fold: fold,
		RULES: RULES,
		VERSION_KINDS: KIND_ORDER.slice(),
		CHANNEL_RULES: ['artist-title', 'title-artist', 'channel', 'none']
	};
});
