/*
 * True Shuffle: the taste map. Genres in families, and the names of the
 * other labels (scene, mood, language, kind, role), for the page to group,
 * colour and describe what a labels file says. Written by hand for one
 * listener's library: anime and visual-novel music, J-rock, city pop, net
 * music, western indie and classics, scores and classical. A genre this map
 * does not know (YouTube's own "Rock", "Pop") lands in "Other".
 *
 * UMD: window.TrueShuffle.taxonomy in the browser, module.exports in Node.
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory();
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.taxonomy = api; }
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	// hue: the family's colour on the page (HSL hue, 0-360).
	var FAMILIES = [
		{ key: 'anime', name: 'Anime & idol', hue: 330, blurb: 'Theme songs, voice actors, idols and visual-novel vocals.', genres: [
			['Anison pop', 'Bright, polished anime-theme pop.'],
			['Anime rock', 'Band-driven, high-energy rock made for anime.'],
			['Seiyuu & character song', 'Voice actors singing as themselves or in character.'],
			['Idol pop', 'Idol groups and idol-style pop.'],
			['Denpa & kawaii', 'Hyper-cute, frantic, brainwave pop.'],
			['Galge song', 'The vocal sound of visual-novel and bishoujo-game themes.'],
			['Ethereal & fantasy vocal', 'Airy, Celtic and choral-pop voices.']
		] },
		{ key: 'jpop', name: 'J-pop', hue: 200, blurb: 'From the net-born wave to radio ballads.', genres: [
			['Net-born J-pop', 'The Vocaloid-producers-turned-mainstream wave: Yorushika, YOASOBI, Eve, Ado.'],
			['Mainstream J-pop', 'Chart pop and J-ballads.'],
			['J-pop rock', 'Mainstream band pop-rock.'],
			['J-folk & singer-songwriter', 'Voice with guitar or piano.']
		] },
		{ key: 'jrock', name: 'J-rock & alternative', hue: 12, blurb: 'Guitars, noise and youth.', genres: [
			['Alt J-rock', 'Guitar-driven alternative and indie rock.'],
			['J-punk & garage', 'Raw punk and garage.'],
			['Psych & art rock (JP)', 'Psychedelic, experimental and avant rock.'],
			['J-metal & visual kei', 'Metal, visual kei and their anime covers.']
		] },
		{ key: 'retro', name: 'Japanese retro', hue: 40, blurb: 'City lights, kayou and neo-acoustic.', genres: [
			['City pop', 'Late-70s and 80s urban pop and its revival.'],
			['Showa kayou & 80s idol', 'Kayoukyoku and the idols of the Showa era.'],
			['Shibuya-kei & neo-acoustic', 'Bossa, sixties pop and bright guitars, the Tokyo way.'],
			['Technopop & new wave', 'Synths and new wave.']
		] },
		{ key: 'indie', name: 'Indie, dream & bedroom', hue: 265, blurb: 'Reverb, jangle and home recordings, any country.', genres: [
			['Shoegaze & dream pop', 'Walls of sound and hazy reverb.'],
			['Indie pop & bedroom pop', 'Lo-fi, jangly or home-made pop.'],
			['Indie rock', 'Guitar indie and the garage revival.'],
			['Indie folk & chamber', 'Folk storytelling and chamber pop.'],
			['Cult & quirky', 'Idiosyncratic, theatrical art pop.']
		] },
		{ key: 'rock', name: 'Rock classics', hue: 25, blurb: 'Fifty years of guitars in English.', genres: [
			['Rock \'n\' roll & 60s', 'Chuck Berry to the Beatles and Dylan.'],
			['70s classic & soft rock', 'ELO, Steely Dan, Fleetwood Mac, Queen.'],
			['Mod & Britpop', 'Paul Weller and his heirs.'],
			['Post-punk & jangle', 'The Smiths and their kin.'],
			['Emo & pop-punk', 'My Chemical Romance, Green Day.'],
			['Alt metal & hard rock', 'Heavy and loud.']
		] },
		{ key: 'pop', name: 'Pop, soul & world', hue: 290, blurb: 'Grooves and songs from everywhere else.', genres: [
			['Funk, soul & R&B', 'Grooves.'],
			['Hip hop & rap', 'Any language.'],
			['Western pop', 'Chart pop in English.'],
			['K-pop & C-pop', 'Korean and Chinese pop.'],
			['Chanson & world', 'French chanson, Latin and other popular music.'],
			['Ska & brass', 'Offbeats and horns.']
		] },
		{ key: 'net', name: 'Net & game sounds', hue: 160, blurb: 'Vocal synths, doujin, chiptune and remixes.', genres: [
			['Vocaloid', 'Songs sung by a vocal synthesiser.'],
			['Touhou arrange', 'Doujin arrangements of Touhou Project music.'],
			['Chiptune & 8-bit', 'NES, Game Boy and tracker renditions.'],
			['Remix & future bass', 'Electronic remixes and kawaii future bass.'],
			['Lo-fi & jazz hop', 'Beats to study to.'],
			['Meme song', 'Songs whose point is the joke.']
		] },
		{ key: 'score', name: 'Score & stage', hue: 220, blurb: 'Soundtracks and musicals.', genres: [
			['Anime score', 'Instrumental music from anime.'],
			['Game & VN score', 'Instrumental music from games and visual novels.'],
			['Film & TV score', 'Scores for live-action film and TV.'],
			['Musical theatre', 'Stage musicals.']
		] },
		{ key: 'arrange', name: 'Arrangements', hue: 120, blurb: 'Songs retold on other instruments.', genres: [
			['Piano arrangement', 'Solo piano covers and improvisations.'],
			['Jazz arrangement', 'Jazz takes on pop, anime and game tunes.'],
			['Orchestral arrangement', 'Orchestra, brass, strings, organ or music box.'],
			['Acoustic arrangement', 'Guitar and unplugged versions.']
		] },
		{ key: 'classical', name: 'Classical', hue: 50, blurb: 'Concert music from the Hurrian hymn to Szemzo.', genres: [
			['Baroque', 'Vivaldi, Bach, Handel.'],
			['Classical & Romantic orchestral', 'Symphonies and concertos, 1750 to 1910.'],
			['Classical piano & chamber', 'Original piano and chamber repertoire.'],
			['Impressionist & art song', 'Debussy, Ravel, melodie and Lied.'],
			['Modern & minimalist', 'Twentieth- and twenty-first-century concert music.'],
			['Early & ancient', 'Medieval, renaissance and ancient music.'],
			['Choral & sacred', 'Choirs, hymns and organ works.']
		] },
		{ key: 'other', name: 'Other', hue: 0, sat: 0, blurb: 'Folk songs, anthems, clips, and genres the map does not know.', genres: [
			['Folk & traditional', 'Traditional songs of any country.'],
			['Anthems & school songs', 'National anthems and school songs.'],
			['Spoken & clips', 'Not music: talk, stream clips, skits.']
		] }
	];

	var SCENES = [
		['anime', 'Anime'], ['vn', 'Visual novels'], ['game', 'Games'], ['vtuber', 'VTubers'], ['vocaloid', 'Vocaloid'],
		['utaite', 'Utaite covers'], ['touhou', 'Touhou'], ['film', 'Film'], ['tv', 'TV & drama'], ['stage', 'Stage'], ['meme', 'Memes']
	];
	var MOODS = [
		['bright', 'Bright', 'Upbeat, sunny, catchy.'], ['driving', 'Driving', 'Loud, fast, intense.'], ['wistful', 'Wistful', 'Bittersweet and nostalgic.'],
		['tender', 'Tender', 'Soft, calm, intimate.'], ['dark', 'Dark', 'Heavy, eerie, despairing.'], ['quirky', 'Quirky', 'Playful, comic, strange.']
	];
	var LANGS = [
		['ja', 'Japanese'], ['en', 'English'], ['ko', 'Korean'], ['zh', 'Chinese'], ['fr', 'French'], ['de', 'German'],
		['es', 'Spanish'], ['la', 'Latin'], ['other', 'Other languages'], ['inst', 'Instrumental']
	];
	var KINDS = [['song', 'Songs'], ['set', 'Albums, medleys and mixes'], ['clip', 'Clips (not music)']];
	var ROLES = [['OP', 'Opening'], ['ED', 'Ending'], ['insert', 'Insert song'], ['theme', 'Theme song'], ['OST', 'Score cue'], ['image', 'Image or character song']];

	var byGenre = {}, byFamily = {};
	FAMILIES.forEach(function (f) {
		byFamily[f.key] = f;
		f.list = f.genres.map(function (g) { var e = { name: g[0], blurb: g[1], family: f.key }; byGenre[g[0].toLowerCase()] = e; return e; });
	});
	function table(rows) { var m = {}; rows.forEach(function (r) { m[r[0]] = r[1]; }); return m; }
	var SCENE_NAME = table(SCENES), MOOD_NAME = table(MOODS), LANG_NAME = table(LANGS), KIND_NAME = table(KINDS), ROLE_NAME = table(ROLES);

	// 'Anison pop' -> { name, blurb, family } or null.
	function genre(name) { return byGenre[String(name || '').toLowerCase()] || null; }
	// The family key of a genre: 'other' for one the map does not know.
	function familyOf(name) { var g = genre(name); return g ? g.family : 'other'; }
	function family(key) { return byFamily[key] || null; }
	// The family a track belongs to: that of its first known genre.
	function trackFamily(t) {
		var gs = (t && t.genres) || [];
		for (var i = 0; i < gs.length; i++) { var g = genre(gs[i]); if (g) return g.family; }
		return 'other';
	}
	// The genres of a family, plus any unknown genres for 'other'.
	function genresOfFamily(key, known) {
		var f = byFamily[key];
		var out = f ? f.list.map(function (g) { return g.name; }) : [];
		if (key === 'other' && known) known.forEach(function (n) { if (!genre(n) && out.indexOf(n) < 0) out.push(n); });
		return out;
	}
	// A colour for a genre or family, as HSL numbers, so the page can make
	// light and dark variants. Genres in one family share the hue with a small
	// shift each.
	function hueOf(name) {
		var g = genre(name), f = g ? byFamily[g.family] : byFamily[name] || byFamily.other;
		if (!g) return { h: f.hue, s: f.sat == null ? 55 : f.sat };
		var i = f.list.indexOf(g);
		return { h: (f.hue + (i - (f.list.length - 1) / 2) * 9 + 360) % 360, s: f.sat == null ? 55 : f.sat };
	}

	return {
		FAMILIES: FAMILIES, SCENES: SCENES, MOODS: MOODS, LANGS: LANGS, KINDS: KINDS, ROLES: ROLES,
		SCENE_NAME: SCENE_NAME, MOOD_NAME: MOOD_NAME, LANG_NAME: LANG_NAME, KIND_NAME: KIND_NAME, ROLE_NAME: ROLE_NAME,
		genre: genre, family: family, familyOf: familyOf, trackFamily: trackFamily, genresOfFamily: genresOfFamily, hueOf: hueOf
	};
});
