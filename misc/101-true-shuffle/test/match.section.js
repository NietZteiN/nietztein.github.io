// match: is this the same song? Kana to romaji, romanisation styles, base
// titles, the evidence sameSong adds up, the library index, uploads, works,
// queries. Every name and title is invented except in the labels.json check,
// which reads the labels the app ships.
module.exports = function (h) {
	var fs = require('fs');
	var path = require('path');
	var M = require(path.join(h.HERE, 'match.js'));
	var DX = require(path.join(h.HERE, 'discover.js'));
	function cp() { return String.fromCharCode.apply(null, arguments); }
	function deepFreeze(o) {
		if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach(function (k) { deepFreeze(o[k]); }); }
		return o;
	}

	// Kana and the Hepburn romaji they read as: [kana, romaji, what the row shows].
	var KANA = [
		// the syllabary, hiragana
		['\u3042\u3044\u3046\u3048\u304A', 'aiueo', 'vowels'],
		['\u304B\u304D\u304F\u3051\u3053', 'kakikukeko', 'k row'],
		['\u3055\u3057\u3059\u305B\u305D', 'sashisuseso', 's row, shi'],
		['\u305F\u3061\u3064\u3066\u3068', 'tachitsuteto', 't row, chi and tsu'],
		['\u306A\u306B\u306C\u306D\u306E', 'naninuneno', 'n row'],
		['\u306F\u3072\u3075\u3078\u307B', 'hahifuheho', 'h row, fu'],
		['\u307E\u307F\u3080\u3081\u3082', 'mamimumemo', 'm row'],
		['\u3084\u3086\u3088', 'yayuyo', 'y row'],
		['\u3089\u308A\u308B\u308C\u308D', 'rarirurero', 'r row'],
		['\u308F\u3092\u3093', 'waon', 'wa, wo read o, n'],
		['\u304C\u304E\u3050\u3052\u3054', 'gagigugego', 'g row'],
		['\u3056\u3058\u305A\u305C\u305E', 'zajizuzezo', 'z row, ji'],
		['\u3060\u3062\u3065\u3067\u3069', 'dajizudedo', 'd row, ji and zu'],
		['\u3070\u3073\u3076\u3079\u307C', 'babibubebo', 'b row'],
		['\u3071\u3074\u3077\u307A\u307D', 'papipupepo', 'p row'],
		// the syllabary, katakana
		['\u30A2\u30A4\u30A6\u30A8\u30AA', 'aiueo', 'katakana vowels'],
		['\u30AB\u30AD\u30AF\u30B1\u30B3', 'kakikukeko', 'katakana k row'],
		['\u30B5\u30B7\u30B9\u30BB\u30BD', 'sashisuseso', 'katakana s row'],
		['\u30BF\u30C1\u30C4\u30C6\u30C8', 'tachitsuteto', 'katakana t row'],
		['\u30CA\u30CB\u30CC\u30CD\u30CE', 'naninuneno', 'katakana n row'],
		['\u30CF\u30D2\u30D5\u30D8\u30DB', 'hahifuheho', 'katakana h row'],
		['\u30DE\u30DF\u30E0\u30E1\u30E2', 'mamimumemo', 'katakana m row'],
		['\u30E4\u30E6\u30E8', 'yayuyo', 'katakana y row'],
		['\u30E9\u30EA\u30EB\u30EC\u30ED', 'rarirurero', 'katakana r row'],
		['\u30EF\u30F2\u30F3', 'waon', 'katakana wa, wo, n'],
		['\u30AC\u30AE\u30B0\u30B2\u30B4', 'gagigugego', 'katakana g row'],
		['\u30B6\u30B8\u30BA\u30BC\u30BE', 'zajizuzezo', 'katakana z row'],
		['\u30C0\u30C2\u30C5\u30C7\u30C9', 'dajizudedo', 'katakana d row'],
		['\u30D0\u30D3\u30D6\u30D9\u30DC', 'babibubebo', 'katakana b row'],
		['\u30D1\u30D4\u30D7\u30DA\u30DD', 'papipupepo', 'katakana p row'],
		// digraphs
		['\u304D\u3083\u304D\u3085\u304D\u3087', 'kyakyukyo', 'ky'],
		['\u304E\u3083\u304E\u3085\u304E\u3087', 'gyagyugyo', 'gy'],
		['\u3057\u3083\u3057\u3085\u3057\u3087', 'shashusho', 'sh'],
		['\u3058\u3083\u3058\u3085\u3058\u3087', 'jajujo', 'j'],
		['\u3061\u3083\u3061\u3085\u3061\u3087', 'chachucho', 'ch'],
		['\u3062\u3083', 'ja', 'dji with small ya'],
		['\u306B\u3083\u306B\u3085\u306B\u3087', 'nyanyunyo', 'ny'],
		['\u3072\u3083\u3072\u3085\u3072\u3087', 'hyahyuhyo', 'hy'],
		['\u3073\u3083\u3073\u3085\u3073\u3087', 'byabyubyo', 'by'],
		['\u3074\u3083\u3074\u3085\u3074\u3087', 'pyapyupyo', 'py'],
		['\u307F\u3083\u307F\u3085\u307F\u3087', 'myamyumyo', 'my'],
		['\u308A\u3083\u308A\u3085\u308A\u3087', 'ryaryuryo', 'ry'],
		['\u30AD\u30E3\u30AD\u30E5\u30AD\u30E7', 'kyakyukyo', 'katakana ky'],
		['\u30B7\u30E3\u30B7\u30E5\u30B7\u30E7', 'shashusho', 'katakana sh'],
		['\u30C1\u30E3\u30C1\u30E5\u30C1\u30E7', 'chachucho', 'katakana ch'],
		['\u30B8\u30E3\u30B8\u30E5\u30B8\u30E7', 'jajujo', 'katakana j'],
		['\u30CB\u30E3\u30CB\u30E5\u30CB\u30E7', 'nyanyunyo', 'katakana ny'],
		['\u30EA\u30E3\u30EA\u30E5\u30EA\u30E7', 'ryaryuryo', 'katakana ry'],
		// the small tsu
		['\u304D\u3063\u3066', 'kitte', 'small tsu before t'],
		['\u304C\u3063\u3053\u3046', 'gakkou', 'small tsu before k'],
		['\u305A\u3063\u3068', 'zutto', 'small tsu after z'],
		['\u307E\u3063\u3061\u3083', 'matcha', 'small tsu before cha: tch'],
		['\u3044\u3063\u3057\u3087', 'issho', 'small tsu before sho'],
		['\u3061\u3087\u3063\u3068', 'chotto', 'digraph, then small tsu'],
		['\u308D\u3063\u307D\u3093\u304E', 'roppongi', 'small tsu before p'],
		['\u30B6\u30C3\u30D4\u30F3\u30B0', 'zappingu', 'katakana small tsu before p'],
		['\u30DE\u30C3\u30C1', 'matchi', 'katakana small tsu before chi: tch'],
		['\u30B3\u30C3\u30D7', 'koppu', 'katakana small tsu, p'],
		['\u30D0\u30C3\u30CF', 'bahha', 'small tsu before h'],
		['\u3042\u3063', 'a', 'small tsu at the end: dropped'],
		['\u3063\u304B', 'kka', 'small tsu at the start'],
		// the long mark
		['\u30E9\u30FC\u30E1\u30F3', 'raamen', 'long a'],
		['\u30B3\u30FC\u30D2\u30FC', 'koohii', 'long o and i'],
		['\u30B9\u30FC\u30D1\u30FC', 'suupaa', 'long u and a'],
		['\u30BB\u30FC\u30E9\u30FC', 'seeraa', 'long e and a'],
		['\u30B1\u30FC\u30AD', 'keeki', 'long e'],
		['\u30EB\u30FC\u30EB', 'ruuru', 'long u'],
		['\u3089\u30FC\u3081\u3093', 'raamen', 'long mark after hiragana'],
		['\u30DC\u30FC\u30AB\u30ED\u30A4\u30C9', 'bookaroido', 'long o in a word'],
		['\u30FC\u30A2', 'a', 'a long mark with nothing before it'],
		// n
		['\u3057\u3093\u3044\u3061', 'shinichi', 'n before a vowel: no apostrophe'],
		['\u3053\u3093\u3084', 'konya', 'n before y'],
		['\u307B\u3093\u3084', 'honya', 'n before ya'],
		['\u304B\u3093\u3044', 'kani', 'n before i'],
		['\u306F\u3093\u304A\u3046', 'hanou', 'n before o'],
		['\u3057\u3093\u3076\u3093', 'shinbun', 'n before b stays n'],
		['\u3055\u3093\u307D', 'sanpo', 'n before p stays n'],
		['\u307B\u3093\u3068\u3046', 'hontou', 'n before t'],
		['\u30F3', 'n', 'katakana n alone'],
		// loanword sounds
		['\u30D5\u30A1\u30A4\u30C8', 'faito', 'fa'],
		['\u30D5\u30A3\u30EB\u30E0', 'firumu', 'fi'],
		['\u30D5\u30A7\u30B9', 'fesu', 'fe'],
		['\u30D5\u30A9\u30FC\u30AF', 'fooku', 'fo'],
		['\u30C6\u30A3\u30FC', 'tii', 'ti'],
		['\u30C7\u30A3\u30B9\u30B3', 'disuko', 'di'],
		['\u30C8\u30A5\u30EB\u30FC', 'turuu', 'tu'],
		['\u30C9\u30A5\u30FC', 'duu', 'du'],
		['\u30A6\u30A3\u30F3\u30BF\u30FC', 'wintaa', 'wi'],
		['\u30A6\u30A7\u30D6', 'webu', 'we'],
		['\u30A6\u30A9\u30FC\u30AF', 'wooku', 'wo'],
		['\u30F4\u30A1\u30A4\u30AA\u30EA\u30F3', 'vaiorin', 'va'],
		['\u30F4\u30A3\u30FC\u30CA\u30B9', 'viinasu', 'vi'],
		['\u30F4\u30A7\u30FC\u30EB', 'veeru', 've'],
		['\u30F4\u30A9\u30FC\u30AB\u30EB', 'vookaru', 'vo'],
		['\u30F4', 'vu', 'vu alone'],
		['\u30B7\u30A7\u30A2', 'shea', 'she'],
		['\u30C1\u30A7\u30C3\u30AF', 'chekku', 'che'],
		['\u30B8\u30A7\u30C3\u30C8', 'jetto', 'je'],
		['\u30C4\u30A1\u30FC', 'tsaa', 'tsa'],
		['\u30A4\u30A7\u30FC\u30A4', 'yeei', 'ye'],
		['\u30C7\u30E5\u30A8\u30C3\u30C8', 'dyuetto', 'dyu'],
		['\u30D5\u30E5\u30FC\u30B8\u30E7\u30F3', 'fyuujon', 'fyu'],
		['\u30AF\u30A1\u30EB\u30C6\u30C3\u30C8', 'kwarutetto', 'kwa'],
		['\u30B9\u30A3\u30FC\u30C8', 'siito', 'si'],
		['\u306D\u3047', 'nee', 'a small vowel drawing the same vowel out'],
		// words, odd kana, other characters
		['\u3055\u304F\u3089', 'sakura', 'a word'],
		['\u3072\u304B\u308A', 'hikari', 'a word'],
		['\u30AB\u30BF\u30AA\u30E2\u30A4', 'kataomoi', 'katakana word'],
		['\u304D\u3083\u308A\u30FC\u3071\u307F\u3085\u3071\u307F\u3085', 'kyariipamyupamyu', 'digraphs and a long mark in hiragana'],
		['\u3053\u3093\u306B\u3061\u306F', 'konnichiha', 'ha read as written'],
		['\u3064\u3065\u304F', 'tsuzuku', 'tsu and zu'],
		['\u3061\u3062\u3080', 'chijimu', 'chi and ji'],
		['\u3044\u3059\u309E', 'isuzu', 'the voiced iteration mark'],
		['\u3090\u3091', 'ie', 'wi and we read i and e'],
		['\u30F7\u30F8\u30F9\u30FA', 'vavivevo', 'va vi ve vo written with w'],
		['\u30F6\u30F5', 'keka', 'small ke and ka'],
		['\u309F', 'yori', 'the yori digraph'],
		['\uFF76\uFF9E\uFF97\uFF7D', 'garasu', 'half-width katakana with a sound mark'],
		[cp(0x304B, 0x3099), 'ga', 'a combining sound mark'],
		['Re:\u30BC\u30ED', 'Re:zero', 'Latin and punctuation kept'],
		['\u591C\u306B\u304B\u3051\u308B', '\u591Cnikakeru', 'kanji kept as they are'],
		['\u30AC\u30E9\u30B9\u30FB\u30CE\u30FB\u30DE\u30C1', 'garasu\u30FBno\u30FBmachi', 'a middle dot kept']
	];

	h.describe('match', function () {
		var API = ['SAME', 'STRONG', 'MIN_VIDEO', 'fold', 'kana', 'romaji', 'loose', 'baseTitle', 'titleKeys', 'artistKeys', 'signature', 'index', 'inLibrary', 'sameSong', 'scoreVideo', 'bestVideo', 'workScore', 'query'];
		h.eq(Object.keys(M).sort(), API.slice().sort(), 'the module exports exactly its documented names');
		h.eq([M.SAME, M.STRONG, M.MIN_VIDEO], [5, 7, 5], 'SAME is 5, STRONG 7, MIN_VIDEO 5');
		var src = fs.readFileSync(path.join(h.HERE, 'match.js'), 'utf8');
		h.ok(!/[^\x00-\x7F]/.test(src), 'match.js is plain ASCII');
		h.ok(!/[^\x00-\x7F]/.test(fs.readFileSync(__filename, 'utf8')), 'this test file is plain ASCII too');

		// ---- fold and kana ----
		var samples = ['Hello & Goodbye', 'The Paper Lanterns', 'Caf\u00E9 Tacuba', '\uFF21\uFF22\uFF23 123', '\u30AC\u30E9\u30B9', 'Glass, Orchard!', '', null, undefined, '\uFF34\uFF48\uFF45 \uFF25\uFF4E\uFF44'];
		h.eq(samples.map(M.fold), samples.map(DX.norm), 'fold is discover.js norm on ' + samples.length + ' strings');
		h.eq([M.fold('The Paper Lanterns'), M.fold('Hello & Goodbye'), M.fold('Caf\u00E9'), M.fold('\uFF21\uFF22\uFF23'), M.fold(null)], ['paperlanterns', 'helloandgoodbye', 'cafe', 'abc', ''], 'fold: a leading "the" goes, "&" is "and", no accents, full-width letters are letters');
		h.eq(M.fold('\u30AC\u30E9\u30B9'), '\u30AB\u30E9\u30B9', 'fold takes the sound marks off kana (NFKD), so romaji is read before folding');
		h.eq(M.kana('\u30AB\u30BF\u30AB\u30CA\u3068\u3072\u3089\u304C\u306A'), '\u304B\u305F\u304B\u306A\u3068\u3072\u3089\u304C\u306A', 'kana: katakana to hiragana, hiragana kept');
		h.eq(M.kana('A\u30F4\u30FC\u30FB'), 'A\u3094\u30FC\u30FB', 'kana: vu converted; the long mark, the middle dot and Latin kept');

		// ---- romaji ----
		h.ok(KANA.length >= 100, 'the kana table has at least 100 rows (' + KANA.length + ')');
		KANA.forEach(function (r) { h.eq(M.romaji(r[0]), r[1], 'romaji: ' + r[1] + ' (' + r[2] + ')'); });
		h.eq(M.romaji(M.kana('\u30AB\u30BF\u30AA\u30E2\u30A4')), M.romaji('\u30AB\u30BF\u30AA\u30E2\u30A4'), 'romaji reads katakana and hiragana alike');
		h.eq(M.romaji('Plain ASCII, unchanged.'), 'Plain ASCII, unchanged.', 'romaji leaves text without kana alone');

		// ---- loose ----
		var STYLES = [
			[['Toukyou', 'T\u014Dky\u014D', 'Tokyo', 'Tookyoo', 'Tohkyoh'], 'tokyo', 'ou, oo, oh and a macron are one o'],
			[['Shinjuku', 'Sinzyuku'], 'sinzyuku', 'Hepburn shi and ju against Kunrei si and zyu'],
			[['Tsukimi', 'Tukimi'], 'tukimi', 'tsu and tu'],
			[['Fujisan', 'Huzisan'], 'huzisan', 'fu and hu, ji and zi'],
			[['Chiisana', 'Tiisana', 'Chisana'], 'tisana', 'chi and ti, ii and i'],
			[['Jinja', 'Zinzya'], 'zinzya', 'ja and zya'],
			[['Shimbun', 'Shinbun', 'Sinbun'], 'sinbun', 'm before b is n'],
			[['Kimi wo', 'Kimi o'], 'kimio', 'the particle wo is o'],
			[['Ryuusei', 'Ry\u016Bsei', 'Ryusei', 'Ryuse'], 'ryuse', 'uu, a macron u, and ei'],
			[['Matcha', 'Maccha', 'Mattya'], 'mattya', 'tch, cch and tty'],
			[['Shoujo', 'Syouzyo', 'Sh\u014Djo'], 'syozyo', 'sho and syo, jo and zyo, ou'],
			[['Ohno', 'Oono', '\u014Cno'], 'ono', 'oh before a consonant'],
			[['Seeraa', 'S\u0113r\u0101', 'Sera'], 'sera', 'ee and aa'],
			[['Shashin', 'Syasin'], 'syasin', 'sha and sya']
		];
		STYLES.forEach(function (g) {
			var got = g[0].map(M.loose);
			h.eq(got, g[0].map(function () { return g[1]; }), 'loose: ' + g[0].join(' = ') + ' (' + g[2] + ')');
		});
		h.ok(M.loose('Kohaku') !== M.loose('Kosaku'), 'loose keeps different words apart');
		h.eq(M.loose(M.romaji('\u30AC\u30E9\u30B9\u30CE\u30DE\u30C1')), M.loose('Garasu no Machi'), 'loose(romaji(katakana)) meets the romaji spelling');
		h.eq(M.loose(M.romaji('\u3057\u3087\u3046\u3058\u3087')), M.loose('Sh\u014Djo'), 'loose(romaji(hiragana)) meets the macron spelling');
		h.eq(M.loose('\u591C\u306E\u7A93'), M.fold('\u591C\u306E\u7A93'), 'loose leaves kanji and kana as fold does (romaji is a separate step)');

		// ---- baseTitle ----
		var BASE = [
			['Blue Signal (TV Size)', 'Blue Signal'],
			['Blue Signal (TV ver.)', 'Blue Signal'],
			['Blue Signal (TV Edit)', 'Blue Signal'],
			['Blue Signal - TV size', 'Blue Signal'],
			['Blue Signal -TV size-', 'Blue Signal'],
			['Blue Signal (Short Ver.)', 'Blue Signal'],
			['Blue Signal (Full Version)', 'Blue Signal'],
			['Blue Signal (Off Vocal)', 'Blue Signal'],
			['Blue Signal [Instrumental]', 'Blue Signal'],
			['Blue Signal (Karaoke)', 'Blue Signal'],
			['Blue Signal (MV)', 'Blue Signal'],
			['Blue Signal [PV]', 'Blue Signal'],
			['Blue Signal MV', 'Blue Signal'],
			['Blue Signal (Official Music Video)', 'Blue Signal'],
			['Blue Signal (Official Audio)', 'Blue Signal'],
			['Blue Signal - Lyric Video', 'Blue Signal'],
			['Blue Signal (Lyrics)', 'Blue Signal'],
			['Blue Signal Lyrics', 'Blue Signal'],
			['Blue Signal (Audio)', 'Blue Signal'],
			['Blue Signal [HD]', 'Blue Signal'],
			['Blue Signal [4K]', 'Blue Signal'],
			['Blue Signal (Remastered 2011)', 'Blue Signal'],
			['Blue Signal - Remastered 2011', 'Blue Signal'],
			['Blue Signal (covered by Mira Osei)', 'Blue Signal'],
			['Blue Signal covered by Mira Osei', 'Blue Signal'],
			['Blue Signal (feat. Mira Osei)', 'Blue Signal'],
			['Blue Signal ft. Mira Osei', 'Blue Signal'],
			['Blue Signal (Opening 2)', 'Blue Signal'],
			['Blue Signal [ED]', 'Blue Signal'],
			['Blue Signal (Starfall Odyssey OP)', 'Blue Signal'],
			['Blue Signal (Starfall Odyssey Opening Theme)', 'Blue Signal'],
			['Blue Signal - Starfall Odyssey OP 3', 'Blue Signal'],
			['Blue Signal (Starfall Odyssey)', 'Blue Signal (Starfall Odyssey)'],
			['Blue Signal - From "Starfall Odyssey"', 'Blue Signal'],
			['Blue Signal (Piano Version)', 'Blue Signal'],
			['Blue Signal (Live at Red Hollow)', 'Blue Signal'],
			['Blue Signal (Instrumental) [Official Audio]', 'Blue Signal'],
			['Blue Signal ~Aoi Shingou~', 'Blue Signal'],
			['"Blue Signal"', 'Blue Signal'],
			['\u3010MV\u3011Blue Signal', 'Blue Signal'],
			['Blue Signal\u3010\u516C\u5F0F\u3011', 'Blue Signal'],
			['Blue Signal\uFF08TV\u30B5\u30A4\u30BA\uFF09', 'Blue Signal'],
			['Blue Signal (\u30D5\u30EB\u30B5\u30A4\u30BA)', 'Blue Signal'],
			['\u300C\u3072\u304B\u308A\u306E\u307E\u3069\u300D', '\u3072\u304B\u308A\u306E\u307E\u3069'],
			['\u300C\u3072\u304B\u308A\u306E\u307E\u3069\u300D(TV Size)', '\u3072\u304B\u308A\u306E\u307E\u3069'],
			['\u300E\u30AC\u30E9\u30B9\u30CE\u30DE\u30C1\u300F', '\u30AC\u30E9\u30B9\u30CE\u30DE\u30C1'],
			['\u3072\u304B\u308A\u306E\u307E\u3069\u301CTV size\u301C', '\u3072\u304B\u308A\u306E\u307E\u3069'],
			['\u3072\u304B\u308A\u306E\u307E\u3069 (TV\u30A2\u30CB\u30E1\u300C\u661F\u306E\u7A93\u300D\u30AA\u30FC\u30D7\u30CB\u30F3\u30B0\u30C6\u30FC\u30DE)', '\u3072\u304B\u308A\u306E\u307E\u3069'],
			['Nocturne (Op. 9 No. 2)', 'Nocturne (Op. 9 No. 2)'],
			['Re:Start', 'Re:Start'],
			['Live Wire Heart', 'Live Wire Heart'],
			['Paper Lanterns - Blue Signal / THE FIRST TAKE', 'Paper Lanterns - Blue Signal / THE FIRST TAKE'],
			['Starfall Odyssey - Opening | Blue Signal', 'Starfall Odyssey - Opening | Blue Signal'],
			['\u3010MV\u3011', '\u3010MV\u3011'],
			['  Blue   Signal  ', 'Blue Signal']
		];
		h.ok(BASE.length >= 25, 'the base title table has at least 25 rows (' + BASE.length + ')');
		BASE.forEach(function (r) { h.eq(M.baseTitle(r[0]), r[1], 'baseTitle: ' + r[0]); });

		// ---- titleKeys, artistKeys, signature ----
		h.eq(M.titleKeys('Blue Signal (TV Size)', 'Aoi Shingou'), ['bluesignal', 'bluesignaltvsize', 'aoishingou', 'aoisingo'], 'titleKeys: base, whole, the alt, then the loose keys');
		h.eq(M.titleKeys('\u30AC\u30E9\u30B9\u30CE\u30DE\u30C1'), ['\u30AB\u30E9\u30B9\u30CE\u30DE\u30C1', 'garasunomati'], 'titleKeys: a katakana title gets its romaji loose key');
		h.eq(M.titleKeys('\u7A93 (Mado)'), ['\u7A93mado', '\u7A93', 'mado'], 'titleKeys: both halves of "Kanji (Romaji)"');
		h.eq(M.titleKeys('\u7A93'), ['\u7A93'], 'titleKeys: one kanji is a key; one Latin letter is not (' + JSON.stringify(M.titleKeys('X')) + ')');
		h.eq(M.titleKeys('X'), [], 'titleKeys: keys under two characters are dropped');
		h.ok(M.titleKeys('\u30AC\u30E9\u30B9\u30CE\u30DE\u30C1', '', { title: 'Glass Orchard - Garasu no Machi (Official Video)', channel: 'Glass Orchard' }).indexOf('garasunomachi') >= 0, 'titleKeys: with the upload\'s raw title, the title parse.js reads there is a key');
		var up = 'Neon Abacus - Ai (Official Video)';
		h.ok(M.titleKeys(up, '', { title: up, channel: 'Neon Abacus' }).indexOf('ai') >= 0 && M.titleKeys(up).indexOf('ai') < 0, 'titleKeys: an upload\'s own title given as raw yields the song title parse.js reads there');
		h.ok(M.titleKeys('Blue Signal', '', { title: 'Paper Lanterns - Blue Signal (Live)', channel: 'Paper Lanterns' }).join() === 'bluesignal', 'titleKeys: a raw title that holds the clean title adds nothing');
		var cv = M.artistKeys('Kaede Mori (CV: Yui Sato)');
		h.ok(cv[0] === 'kaedemoricvyuisato' && cv.indexOf('yuisato') >= 0 && cv.indexOf('kaedemori') >= 0, 'artistKeys: the whole credit first, then the character and the voice actor');
		h.ok(M.artistKeys('\u30AC\u30E9\u30B9\u30AA\u30FC\u30C1\u30E3\u30FC\u30C9').indexOf(M.loose('Garasu Oochaado')) >= 0, 'artistKeys: a kana name gets its romaji loose key');
		h.ok(M.artistKeys('Hikki Band', '', function (n) { return n === 'Hikki Band' ? 'Glass Orchard' : ''; }).indexOf('glassorchard') >= 0, 'artistKeys: aliasOf(name) adds the canonical name');
		h.eq(M.artistKeys('', ''), [], 'artistKeys: no credit, no keys');
		var sig = M.signature({ id: 'aaaaaaaaaa1', title: 'Blue Signal (TV Size)', artist: 'Paper Lanterns', durationSec: 89, work: 'Starfall Odyssey', role: 'OP' });
		h.eq([sig.v, sig.d, sig.ver, sig.w, sig.r, sig.t[0], sig.a[0]], ['aaaaaaaaaa1', 89, 'tv-size', 'starfallodyssey', 'OP', 'bluesignal', 'paperlanterns'], 'signature: id as video, length, the version from the title, folded work, role, keys');
		h.eq(M.signature({ id: 'demo-001', title: 'X Y' }).v, null, 'signature: an id that is not a YouTube id is no video');
		h.eq(M.signature({ videoId: 'bbbbbbbbbb1', title: 'Blue Signal (Piano Version)', version: 'live' }).ver, 'live', 'signature: a stated version wins over the title\'s');
		h.eq(M.signature({ title: 'Blue Signal (Piano Version)' }).ver, 'piano', 'signature: the version a title names');

		// ---- sameSong ----
		var r = M.sameSong({ title: '\u30AC\u30E9\u30B9\u30CE\u30DE\u30C1', artist: 'Glass Orchard' }, { title: 'Garasu no Machi', artist: 'Glass Orchard' });
		h.ok(r.same && r.sameRecording && r.why.indexOf('title-loose') >= 0 && r.score === 6, 'sameSong: a kana title and its romaji, same artist: same (' + r.score + ' ' + r.why.join(',') + ')');
		r = M.sameSong({ title: 'Sinzyuku Yoru', artist: 'Neon Abacus' }, { title: 'Shinjuku Yoru', artist: 'Neon Abacus' });
		h.ok(r.same && r.why[0] === 'title-loose', 'sameSong: Kunrei and Hepburn spellings of one title');
		var tv = { title: 'Blue Signal (TV Size)', artist: 'Paper Lanterns', durationSec: 90 }, full = { title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 270 };
		r = M.sameSong(tv, full);
		h.ok(r.same && !r.sameRecording && r.why.indexOf('length-off') < 0, 'sameSong: the TV size and the full song (90 and 270 s): the same song, not the same recording (' + r.score + ')');
		r = M.sameSong({ title: 'Blue Signal', artist: 'Mira Osei', version: 'cover' }, full);
		h.ok(!r.same && !r.sameRecording && r.why.indexOf('other-artist') >= 0 && r.why.indexOf('other-version') >= 0, 'sameSong: a cover by someone else and the original: neither the same song entry nor the same recording (' + r.score + ')');
		r = M.sameSong({ title: 'Blue Signal (Piano Version)', artist: 'Paper Lanterns' }, { title: 'Blue Signal', artist: 'Paper Lanterns' });
		h.ok(r.same && !r.sameRecording && r.score === 5, 'sameSong: the artist\'s own piano version: the same song, another recording (' + r.score + ')');
		r = M.sameSong({ title: 'Hikari', artist: 'Neon Abacus' }, { title: 'Hikari', artist: 'Mira Osei' });
		h.ok(!r.same && r.score === 1 && r.why.join(',') === 'title,other-artist', 'sameSong: the Hikari trap: one title, two known artists, not the same song (' + r.score + ')');
		r = M.sameSong({ title: 'Hikari', artist: 'Neon Abacus', work: 'Starfall Odyssey', role: 'OP' }, { title: 'Hikari', artist: 'Mira Osei', work: 'Starfall Odyssey', role: 'ED' });
		h.ok(!r.same, 'sameSong: the Hikari trap holds inside one work too (' + r.score + ')');
		r = M.sameSong({ title: 'Terminal', artist: 'Kaede Mori (CV: Yui Sato)' }, { title: 'Terminal', artist: 'Yui Sato' });
		h.ok(r.same && r.why.indexOf('person') >= 0 && r.score === 6.5, 'sameSong: "Character (CV: Name)" and the voice actor\'s own name (' + r.score + ')');
		r = M.sameSong({ title: 'Terminal', artist: 'Kaede Mori & Yui Sato' }, { title: 'Terminal', artist: 'Kaede Mori' });
		h.ok(r.same && r.why.indexOf('person') >= 0, 'sameSong: one person of a duet credit');
		r = M.sameSong({ title: 'Terminal', artist: 'Neon Abacus' }, { title: 'Winter Almanac', artist: 'Neon Abacus', work: 'Starfall Odyssey' });
		h.eq([r.score, r.why, r.same, r.sameRecording], [0, ['no-title'], false, false], 'sameSong: no title evidence: score 0 and nothing else counted');
		r = M.sameSong({ title: 'Blue Signal', durationSec: 214 }, { title: 'Blue Signal', artist: 'Paper Lanterns', work: 'Starfall Odyssey', durationSec: 216 });
		h.eq([r.score, r.why, r.same], [5, ['title', 'length'], true], 'sameSong: an unknown artist neither adds nor costs (title and length; a work on one side only says nothing)');
		r = M.sameSong({ title: 'Blue Signal', work: 'Starfall Odyssey' }, { title: 'Blue Signal', artist: 'Paper Lanterns', work: 'Starfall Odyssey' });
		h.ok(r.same && r.why.indexOf('work') >= 0 && r.score === 5.5, 'sameSong: the title and the work, artist unknown: same');
		r = M.sameSong({ title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 214 }, { title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 216 });
		h.ok(r.sameRecording && r.why.indexOf('length') >= 0 && r.score === 8, 'sameSong: lengths within 4 s count for it');
		r = M.sameSong({ title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 214 }, { title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 300 });
		h.ok(r.same && !r.sameRecording && r.why.indexOf('length-off') >= 0 && r.score === 5.5, 'sameSong: 86 s apart counts against it, and it is not the same recording');
		r = M.sameSong({ title: 'Blue Signal Reprise', artist: 'Paper Lanterns', work: 'Starfall Odyssey' }, { title: 'Blue Signal', artist: 'Paper Lanterns', work: 'Starfall Odyssey' });
		h.ok(r.why[0] === 'title-part' && r.score === 6, 'sameSong: one title inside the other (both 6 or more) counts a little');
		r = M.sameSong({ title: 'Garasu', artist: 'Yorushika' }, { title: 'Garasu', artist: '\u30E8\u30EB\u30B7\u30AB' });
		h.ok(r.same && r.why.indexOf('artist') >= 0, 'sameSong: an artist in kana and in romaji');
		r = M.sameSong({ videoId: 'ccccccccccc', title: 'Anything' }, { id: 'ccccccccccc', title: 'Else' });
		h.eq([r.score, r.sameRecording], [99, true], 'sameSong: the same video is the same recording');
		r = M.sameSong(M.signature({ title: 'Blue Signal', artist: 'Paper Lanterns' }), { title: 'Blue Signal', artist: 'Paper Lanterns' });
		h.ok(r.same && r.score === 7, 'sameSong takes signatures as well as tracks and finds');
		var pairs = [[tv, full], [{ title: '\u30AC\u30E9\u30B9\u30CE\u30DE\u30C1', artist: 'Glass Orchard', durationSec: 200 }, { title: 'Garasu no Machi', artist: 'Glass Orchard', durationSec: 260, version: 'live' }], [{ title: 'Terminal', artist: 'Kaede Mori (CV: Yui Sato)' }, { title: 'Terminal', artist: 'Yui Sato', role: 'ED' }]];
		h.ok(pairs.every(function (p) { return JSON.stringify(M.sameSong(p[0], p[1]).score) === JSON.stringify(M.sameSong(p[1], p[0]).score); }), 'sameSong is symmetric in its score');

		// ---- index and inLibrary ----
		var TRACKS = [
			{ id: 'aaaaaaaaaa1', title: '\u30AC\u30E9\u30B9\u30CE\u30DE\u30C1', artist: 'Glass Orchard', work: 'Starfall Odyssey', role: 'OP', durationSec: 241 },
			{ id: 'aaaaaaaaaa2', title: 'Garasu no Machi', artist: 'Glass Orchard', version: 'live', durationSec: 262 },
			{ id: 'aaaaaaaaaa3', title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 214, removed: true },
			{ id: 'aaaaaaaaaa4', title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 215 },
			{ id: 'aaaaaaaaaa5', title: 'Hikari', artist: 'Neon Abacus' },
			{ id: 'aaaaaaaaaa6', title: 'Terminal', artist: 'Kaede Mori (CV: Yui Sato)' },
			{ id: 'demo-001', title: 'Winter Almanac', artist: 'Glass Orchard' }
		];
		var ix = M.index(TRACKS);
		h.ok(ix.title && ix.video && ix.sig && ix.tracks && ix.tracks['demo-001'] === TRACKS[6], 'index: title, video, sig and tracks');
		h.eq(Object.keys(ix.video).sort(), ['aaaaaaaaaa1', 'aaaaaaaaaa2', 'aaaaaaaaaa3', 'aaaaaaaaaa4', 'aaaaaaaaaa5', 'aaaaaaaaaa6'], 'index: the YouTube ids (not demo ids) are the videos');
		h.ok(ix.title.garasunomati && ix.title.garasunomati.indexOf('aaaaaaaaaa1') >= 0 && ix.title.garasunomati.indexOf('aaaaaaaaaa2') >= 0, 'index: the kana and the romaji upload share a loose title key');
		var hit = M.inLibrary(ix, { title: 'whatever', videoId: 'aaaaaaaaaa4' });
		h.eq([hit && hit.id, hit && hit.score], ['aaaaaaaaaa4', 99], 'inLibrary: a find whose video is in the library is that track (99)');
		hit = M.inLibrary(ix, { title: 'Garasu no Machi', artist: 'Glass Orchard' });
		h.ok(hit && hit.id === 'aaaaaaaaaa1' && hit.sameRecording, 'inLibrary: the same recording (the kana upload) before the live one, though the live one spells the title the same (' + JSON.stringify(hit) + ')');
		hit = M.inLibrary(ix, { title: 'Garasu no Machi', artist: 'Glass Orchard', version: 'live' });
		h.ok(hit && hit.id === 'aaaaaaaaaa2' && hit.sameRecording, 'inLibrary: a find asking for the live version gets the live upload');
		hit = M.inLibrary(ix, { title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 214 });
		h.eq(hit && hit.id, 'aaaaaaaaaa4', 'inLibrary: of two uploads of the same recording, the one that plays (the other is removed)');
		var blocked = M.index([{ id: 'bbbbbbbbbb1', title: 'Blue Signal', artist: 'Paper Lanterns', blocked: true }, { id: 'bbbbbbbbbb2', title: 'Blue Signal', artist: 'Paper Lanterns' }]);
		h.eq(M.inLibrary(blocked, { title: 'Blue Signal', artist: 'Paper Lanterns' }).id, 'bbbbbbbbbb2', 'inLibrary: a blocked upload comes after one the listener has not blocked');
		h.eq(M.inLibrary(ix, { title: 'Hikari', artist: 'Mira Osei' }), null, 'inLibrary: the Hikari trap finds nothing');
		hit = M.inLibrary(ix, { title: 'Terminal', artist: 'Yui Sato' });
		h.eq(hit && hit.id, 'aaaaaaaaaa6', 'inLibrary: the voice actor finds the character song');
		h.eq(M.inLibrary(ix, { title: 'Winter Almanac', artist: 'Hikki Band' }), null, 'inLibrary: another artist name without an alias: nothing');
		var ixA = M.index(TRACKS, { aliasOf: function (n) { return n === 'Hikki Band' ? 'Glass Orchard' : ''; } });
		hit = M.inLibrary(ixA, { title: 'Winter Almanac', artist: 'Hikki Band' });
		h.eq(hit && hit.id, 'demo-001', 'inLibrary: with aliasOf the alias finds the track');
		var byObj = {};
		TRACKS.forEach(function (t) { byObj[t.id] = t; });
		h.eq(Object.keys(M.index(byObj).sig).sort(), Object.keys(ix.sig).sort(), 'index takes { id: track } as well as a list');
		h.eq(M.inLibrary(M.index([]), { title: 'Blue Signal' }), null, 'inLibrary: an empty library has nothing');

		// ---- scoreVideo and bestVideo ----
		var find = { title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 214 };
		var V = {
			nightcore: { videoId: 'vvvvvvvvvv1', title: 'Nightcore - Blue Signal', channel: 'Nightcore Zone', durationSec: 170 },
			cover: { videoId: 'vvvvvvvvvv2', title: 'Blue Signal (Cover) - Mira Osei', channel: 'Mira Osei', durationSec: 220 },
			lyrics: { videoId: 'vvvvvvvvvv3', title: 'Paper Lanterns - Blue Signal (Lyrics)', channel: 'Lyric Hub', durationSec: 214 },
			mv: { videoId: 'vvvvvvvvvv4', title: 'Paper Lanterns - Blue Signal (Official Video)', channel: 'Paper Lanterns', durationSec: 230 },
			topic: { videoId: 'vvvvvvvvvv5', title: 'Blue Signal', channel: 'Paper Lanterns - Topic', durationSec: 214 }
		};
		var order = ['topic', 'mv', 'lyrics', 'cover', 'nightcore'];
		var scores = order.map(function (k) { return M.scoreVideo(V[k], find).score; });
		h.ok(scores.every(function (s, i) { return i === 0 || s < scores[i - 1]; }), 'scoreVideo: Topic > official video > lyrics video > cover > nightcore (' + scores.join(' > ') + ')');
		var list = [V.nightcore, V.cover, V.lyrics, V.mv, V.topic];
		var best = M.bestVideo(list, find);
		h.ok(best && best.video === V.topic && best.score === 12, 'bestVideo: the Topic upload wins (' + (best && best.score) + ')');
		h.eq(best && best.alts.map(function (a) { return a.video.videoId; }), [V.mv.videoId, V.lyrics.videoId], 'bestVideo: alts are the next ones that reach the minimum (the cover and the nightcore do not)');
		h.eq(M.bestVideo([V.nightcore, V.cover], find), null, 'bestVideo: nothing reaches the minimum: null');
		h.eq(M.bestVideo(list, find, { min: 20 }), null, 'bestVideo: opts.min raises the bar');
		h.eq(M.bestVideo([], find), null, 'bestVideo: no uploads, nothing');
		var noTitle = M.scoreVideo({ videoId: 'vvvvvvvvvv6', title: 'Paper Lanterns - Winter Almanac', channel: 'Paper Lanterns - Topic', durationSec: 214 }, find);
		h.ok(noTitle.score <= 0, 'scoreVideo: without the title the score is at most 0, Topic channel or not (' + noTitle.score + ')');
		var tie = [{ videoId: 'vvvvvvvvvv7', title: 'Blue Signal', channel: 'Someone' }, { videoId: 'vvvvvvvvvv8', title: 'Blue Signal', channel: 'Someone Else' }];
		h.eq(M.bestVideo(tie, { title: 'Blue Signal', artist: 'Paper Lanterns' }, { min: 0 }).video.videoId, 'vvvvvvvvvv7', 'bestVideo: equal scores keep the input order');
		var piano = { title: 'Garasu no Machi', artist: 'Glass Orchard', version: 'piano' };
		var pv = [
			{ videoId: 'pppppppppp1', title: 'Garasu no Machi', channel: 'Glass Orchard - Topic' },
			{ videoId: 'pppppppppp2', title: 'Garasu no Machi (Piano Cover)', channel: 'Keys by Ilse' },
			{ videoId: 'pppppppppp3', title: 'Glass Orchard - Garasu no Machi (Official Video)', channel: 'Glass Orchard Official' }
		];
		best = M.bestVideo(pv, piano);
		h.eq(best && best.video.videoId, 'pppppppppp2', 'bestVideo: a find asking for a piano version prefers the piano upload');
		best = M.bestVideo(pv, { title: 'Garasu no Machi', artist: 'Glass Orchard' });
		h.eq(best && best.video.videoId, 'pppppppppp1', 'bestVideo: the same uploads for the plain song: the Topic one');
		h.eq(M.bestVideo(pv.slice(0, 1).concat(pv.slice(2)), piano), null, 'bestVideo: a piano find with no piano upload finds nothing');
		var jp = M.scoreVideo({ videoId: 'jjjjjjjjjj1', title: '\u3010MV\u3011\u30AC\u30E9\u30B9\u30CE\u30DE\u30C1 / Glass Orchard', channel: 'Glass Orchard' }, { title: 'Garasu no Machi', titleAlt: '\u30AC\u30E9\u30B9\u30CE\u30DE\u30C1', artist: 'Glass Orchard' });
		h.ok(jp.why.indexOf('title') >= 0 && jp.why.indexOf('channel') >= 0, 'scoreVideo: a Japanese upload title matches through the find\'s titleAlt');
		var jp2 = M.scoreVideo({ videoId: 'jjjjjjjjjj2', title: '\u30AC\u30E9\u30B9\u30CE\u30DE\u30C1', channel: 'Glass Orchard - Topic' }, { title: 'Garasu no Machi', artist: 'Glass Orchard' });
		h.ok(jp2.why.indexOf('title') >= 0 && jp2.score === 10, 'scoreVideo: a katakana upload title matches the romaji title through romaji (' + jp2.score + ')');
		var shortT = M.scoreVideo({ videoId: 'sssssssssss', title: 'Aimless Days', channel: 'Neon Abacus' }, { title: 'Ai', artist: 'Neon Abacus' });
		h.ok(shortT.score <= 0, 'scoreVideo: a two-letter title must be a whole word of the upload\'s title');
		var live = M.bestVideo([{ videoId: 'llllllllll1', title: 'Neon Abacus - Live Wire Heart (Live at Red Hollow)', channel: 'Neon Abacus' }, { videoId: 'llllllllll2', title: 'Live Wire Heart', channel: 'Neon Abacus - Topic' }], { title: 'Live Wire Heart', artist: 'Neon Abacus' });
		h.ok(live && live.video.videoId === 'llllllllll2', 'bestVideo: "Live" in the song\'s own title is not a live version; the live one loses');
		var inside = M.scoreVideo({ videoId: 'iiiiiiiiii1', title: 'Neon Abacus - Ove (cover)', channel: 'Somebody' }, { title: 'Ove', artist: 'Neon Abacus' });
		h.ok(inside.why.indexOf('cover') >= 0, 'scoreVideo: the song\'s own words leave the upload\'s title as whole words only ("Ove" does not hide "cover")');
		var asked = M.scoreVideo({ videoId: 'tttttttttt1', title: 'Blue Signal (TV Size)', channel: 'Paper Lanterns' }, { title: 'Blue Signal (TV Size)', artist: 'Paper Lanterns' });
		h.ok(asked.why.indexOf('tv-size') < 0 && asked.why.indexOf('version') >= 0, 'scoreVideo: TV size costs nothing when the find asks for it');
		var len = [M.scoreVideo(V.topic, { title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 218 }), M.scoreVideo(V.topic, { title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 260 })];
		h.ok(len[0].why.indexOf('length') >= 0 && len[1].why.indexOf('length-off') >= 0 && len[0].score - len[1].score === 4, 'scoreVideo: within 5 s +2, over 30 s off -2');
		var many = M.scoreVideo({ videoId: 'mmmmmmmmmm1', title: 'Blue Signal Nightcore Sped Up 8D 1 Hour Loop', channel: 'X' }, { title: 'Blue Signal', artist: 'Paper Lanterns' });
		h.ok(many.score === 4 - 6, 'scoreVideo: version words cost 6 at most (' + many.score + ')');

		// ---- workScore and query ----
		var oregairu = { name: 'Yahari Ore no Seishun Love Comedy wa Machigatteiru.', synonyms: ['Oregairu', 'My Teen Romantic Comedy SNAFU'] };
		h.eq(M.workScore('Oregairu', oregairu), 1, 'workScore: a synonym is a match');
		h.eq(M.workScore('Starfall Odyssey', 'Starfall Odyssey!'), 1, 'workScore: equal folded names');
		h.eq(M.workScore('Hoshi no Mado', 'Hoshi no Madou'), 1, 'workScore: equal loose names (romanisation styles)');
		h.eq(M.workScore('Starfall', 'Starfall Odyssey'), 0.8, 'workScore: one name inside the other');
		var part = M.workScore('Starfall Odyssey Zero', 'Starfall Odyssey 2: Embers');
		h.ok(part > 0.2 && part < 0.8, 'workScore: names sharing words score between (' + part + ')');
		h.ok(M.workScore('Starfall Odyssey', 'Paper Moon') < 0.1 && M.workScore('', 'Paper Moon') === 0, 'workScore: unrelated names and no name score about 0');
		h.eq(M.query({ title: 'Blue Signal (TV Size)', artist: 'Paper Lanterns' }), 'Paper Lanterns Blue Signal', 'query: the artist and the base title');
		h.eq(M.query({ title: 'Garasu no Machi', titleAlt: '\u30AC\u30E9\u30B9\u30CE\u30DE\u30C1', artist: 'Glass Orchard' }), 'Glass Orchard \u30AC\u30E9\u30B9\u30CE\u30DE\u30C1', 'query: the Japanese title when the title is romaji');
		h.eq(M.query({ title: '\u30AC\u30E9\u30B9\u30CE\u30DE\u30C1', titleAlt: 'Garasu no Machi', artist: 'Glass Orchard' }), 'Glass Orchard \u30AC\u30E9\u30B9\u30CE\u30DE\u30C1', 'query: a Japanese title stays');
		var longQ = M.query({ title: new Array(30).join('Signal '), artist: 'Paper Lanterns' });
		h.ok(longQ.length <= 100 && longQ.indexOf('Paper Lanterns') === 0, 'query: at most 100 characters (' + longQ.length + ')');

		// ---- labels.json: every labelled anime song with a titleAlt finds itself by it ----
		var labels = JSON.parse(fs.readFileSync(path.join(h.HERE, 'labels.json'), 'utf8'));
		var ids = Object.keys(labels.tracks);
		var lib = M.index(ids.map(function (id) { var l = labels.tracks[id]; return { id: id, title: l.title, titleAlt: l.titleAlt, artist: l.artist, work: l.work, role: l.role }; }));
		var anime = ids.filter(function (id) { var l = labels.tracks[id]; return (l.role === 'OP' || l.role === 'ED' || l.role === 'insert' || l.work) && l.titleAlt; });
		var misses = [];
		anime.forEach(function (id) {
			var l = labels.tracks[id], f = { title: l.titleAlt, artist: l.artist };
			var got = M.inLibrary(lib, f);
			if (got && got.id === id) return;
			if (got) { var s = M.sameSong(lib.tracks[got.id], f); if (s.same || s.sameRecording) return; }
			misses.push(id);
		});
		var rate = anime.length ? (anime.length - misses.length) / anime.length : 0;
		h.ok(anime.length > 100 && rate >= 0.95, 'labels.json: ' + (anime.length - misses.length) + ' of ' + anime.length + ' labelled anime songs found by their titleAlt (' + (rate * 100).toFixed(1) + '%, ' + misses.length + ' misses' + (misses.length ? ': ' + misses.slice(0, 5).join(', ') : '') + ')');

		// ---- purity and determinism ----
		var frozenTracks = deepFreeze(JSON.parse(JSON.stringify(TRACKS)));
		var frozenFind = deepFreeze({ title: 'Garasu no Machi (TV Size)', titleAlt: '\u30AC\u30E9\u30B9\u30CE\u30DE\u30C1', artist: 'Glass Orchard', people: [{ name: 'Glass Orchard', key: 'glassorchard', as: '' }], durationSec: 90, version: '' });
		var frozenVideos = deepFreeze(JSON.parse(JSON.stringify(list)));
		var before = JSON.stringify([frozenTracks, frozenFind, frozenVideos]);
		var threw = null, out1, out2;
		try {
			var fix = M.index(frozenTracks);
			out1 = JSON.stringify([M.inLibrary(fix, frozenFind), M.bestVideo(frozenVideos, find), M.sameSong(frozenTracks[0], frozenFind), M.signature(frozenFind), M.query(frozenFind), M.workScore('Garasu', { name: 'Garasu no Machi', synonyms: [] })]);
			out2 = JSON.stringify([M.inLibrary(M.index(frozenTracks), frozenFind), M.bestVideo(frozenVideos, find), M.sameSong(frozenTracks[0], frozenFind), M.signature(frozenFind), M.query(frozenFind), M.workScore('Garasu', { name: 'Garasu no Machi', synonyms: [] })]);
		} catch (e) { threw = e; }
		h.ok(!threw, 'nothing writes to frozen tracks, finds or uploads' + (threw ? ': ' + threw.message : ''));
		h.eq(JSON.stringify([frozenTracks, frozenFind, frozenVideos]), before, 'the inputs are unchanged');
		h.eq(out1, out2, 'the same inputs give the same answers twice');
		var keys = M.titleKeys('Blue Signal (TV Size)', 'Aoi Shingou');
		keys.push('changed');
		h.ok(M.titleKeys('Blue Signal (TV Size)', 'Aoi Shingou').indexOf('changed') < 0, 'a returned key list belongs to the caller (the remembered answers are not shared)');
		var rev = M.index(TRACKS.slice().reverse());
		var probes = [{ title: 'Garasu no Machi', artist: 'Glass Orchard' }, { title: 'Terminal', artist: 'Yui Sato' }, { title: 'Blue Signal', artist: 'Paper Lanterns', durationSec: 214 }];
		h.eq(probes.map(function (p) { var x = M.inLibrary(rev, p); return x && x.id; }), probes.map(function (p) { var x = M.inLibrary(ix, p); return x && x.id; }), 'inLibrary does not depend on the order of the library');
		var shuffled = [V.topic, V.cover, V.mv, V.nightcore, V.lyrics];
		h.eq(M.bestVideo(shuffled, find).video.videoId, V.topic.videoId, 'bestVideo does not depend on the order of the uploads when scores differ');
	});
};
