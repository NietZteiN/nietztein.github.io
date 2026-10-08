/*
 * True Shuffle tests. Node built-ins only; run from anywhere:
 *     node misc/101-true-shuffle/test.js              every section
 *     node misc/101-true-shuffle/test.js parse yt     only the named sections
 * Prints one PASS or FAIL line per check and exits 1 if any check failed.
 *
 * Sections: parse (the table of titles), library, shuffle (uniformity, the
 * bag, the spread, seeds, limits, the queue reducer), store (the in-memory
 * twin), player (the mock and the controller), demo, yt (the client, the
 * sign-in helpers and the import, against test/fake-youtube.mjs on a local
 * port), readme (every exported name is documented).
 *
 * The browser half (IndexedDB, the real redirect, the IFrame player) is
 * exercised by drive scripts outside the repo; README.md says how.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var url = require('url');

var HERE = __dirname;
var passed = 0, failed = 0, section = '';
var failures = [];
function ok(cond, msg) {
	if (cond) { passed++; console.log('PASS  ' + section + ': ' + msg); return true; }
	failed++;
	failures.push(section + ': ' + msg);
	console.log('FAIL  ' + section + ': ' + msg);
	return false;
}
function eq(got, expected, msg) {
	var same = JSON.stringify(got) === JSON.stringify(expected);
	return ok(same, same ? msg : msg + '\n        got      ' + JSON.stringify(got) + '\n        expected ' + JSON.stringify(expected));
}
function near(got, expected, tol, msg) {
	return ok(Math.abs(got - expected) <= tol, msg + ' (got ' + got + ', expected ' + expected + ' +/- ' + tol + ')');
}
function throws(fn, msg) {
	try { fn(); } catch (e) { return ok(true, msg); }
	return ok(false, msg + ' (did not throw)');
}
async function rejects(promise, test, msg) {
	try { await promise; } catch (e) { return ok(!test || test(e), msg + (test && !test(e) ? ' (wrong error: ' + (e && e.code) + ' ' + (e && e.message) + ')' : '')); }
	return ok(false, msg + ' (did not reject)');
}

var SECTIONS = [];
function describe(name, fn) { SECTIONS.push({ name: name, fn: fn }); }

// Japanese-style punctuation is written as ASCII tokens and expanded here, so
// the table below stays readable and holds no look-alike characters.
function cp() { return String.fromCharCode.apply(null, arguments); }
var TOKENS = {
	'<q>': cp(0x300C), '</q>': cp(0x300D),            // corner brackets
	'<w>': cp(0x300E), '</w>': cp(0x300F),            // white corner brackets
	'<a>': cp(0x300A), '</a>': cp(0x300B),            // double angle brackets
	'<l>': cp(0x3010), '</l>': cp(0x3011),            // lenticular brackets
	'<fp>': cp(0xFF08), '</fp>': cp(0xFF09),          // fullwidth parentheses
	'<fs>': cp(0xFF0F),                               // fullwidth solidus
	'<fh>': cp(0xFF0D),                               // fullwidth hyphen-minus
	'<is>': cp(0x3000),                               // ideographic space
	'<wd>': cp(0x301C),                               // wave dash
	'<en>': cp(0x2013), '<em>': cp(0x2014), '<hb>': cp(0x2015),
	'<lq>': cp(0x201C), '<rq>': cp(0x201D),
	// single tag words, as uploaders write them
	'<jp:official>': cp(0x516C, 0x5F0F),
	'<jp:channel>': cp(0x30C1, 0x30E3, 0x30F3, 0x30CD, 0x30EB),
	'<jp:live>': cp(0x30E9, 0x30A4, 0x30D6),
	'<jp:cover>': cp(0x30AB, 0x30D0, 0x30FC),
	'<jp:sang>': cp(0x6B4C, 0x3063, 0x3066, 0x307F, 0x305F),
	'<jp:piano>': cp(0x30D4, 0x30A2, 0x30CE),
	'<jp:full>': cp(0x30D5, 0x30EB)
};
function jp(s) {
	return String(s).replace(/<\/?[a-z:]+>/g, function (t) {
		if (!(t in TOKENS)) throw new Error('unknown token ' + t);
		return TOKENS[t];
	});
}

// =============================================================================
// parse
// =============================================================================

// [ title, channel, expected artist, expected title, { more expectations } ]
//   v: version   r: rule   feat   album   trackNo   performer   year
//   min / max: bounds on the confidence   rule: a channel rule to apply
// Every artist, title and channel here is invented, except in the section
// "The channel's name, whole words only", which quotes a reviewer's real titles.
var PARSE_CASES = [
	// ---- Artist - Title, every dash ------------------------------------------
	['Paper Lanterns - Blue Signal', 'Paper Lanterns', 'Paper Lanterns', 'Blue Signal', { r: 'dash', min: 0.9 }],
	// A plain dash on a stranger's channel: nothing but the shape vouches for the artist, so it is a guess (policy of 2026-10-05).
	['Glass Orchard <en> Winter Almanac', 'cassette drawer', 'Glass Orchard', 'Winter Almanac', { r: 'dash', max: 0.5 }],
	['Hollow Compass <em> North by Nothing', 'musicfan1987', 'Hollow Compass', 'North by Nothing', { r: 'dash' }],
	['Neon Abacus <hb> Counting Backwards', 'musicfan1987', 'Neon Abacus', 'Counting Backwards', { r: 'dash' }],
	['Paper Lanterns <fh> Blue Signal', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'dash' }],
	['Paper Lanterns<is>-<is>Blue Signal', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'dash' }],
	['Jay-Lo Marsh - Half-Light', 'musicfan1987', 'Jay-Lo Marsh', 'Half-Light', { r: 'dash' }],
	['Up/Down - Elevator Music', 'musicfan1987', 'Up/Down', 'Elevator Music', { r: 'dash' }],
	['Paper Lanterns - 7 Years of Rain', 'musicfan1987', 'Paper Lanterns', '7 Years of Rain', {}],
	['PAPER LANTERNS - BLUE SIGNAL (OFFICIAL VIDEO)', 'musicfan1987', 'PAPER LANTERNS', 'BLUE SIGNAL', { v: '' }],
	['Paper Lanterns - Blue Signal #shorts #music', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', {}],
	['Paper Lanterns x Glass Orchard - Twin Rivers', 'musicfan1987', 'Paper Lanterns x Glass Orchard', 'Twin Rivers', {}],
	['Paper Lanterns & Glass Orchard - Twin Rivers', 'Paper Lanterns', 'Paper Lanterns & Glass Orchard', 'Twin Rivers', { min: 0.9 }],
	['Paper Lanterns - Ashes - Embers', 'musicfan1987', 'Paper Lanterns', 'Ashes - Embers', { r: 'dash-multi', max: 0.6 }],
	['Glass Orchard- Winter Almanac', 'musicfan1987', 'Glass Orchard', 'Winter Almanac', { r: 'dash-loose', max: 0.6 }],
	['Glass Orchard -Winter Almanac', 'musicfan1987', 'Glass Orchard', 'Winter Almanac', { r: 'dash-loose' }],
	['Glass Orchard<en>Winter Almanac', 'musicfan1987', 'Glass Orchard', 'Winter Almanac', { r: 'dash-loose' }],
	['Paper Lanterns - Live', 'musicfan1987', 'Paper Lanterns', 'Live', { v: '' }],
	['Paper Lanterns - Acoustic', 'musicfan1987', 'Paper Lanterns', 'Acoustic', { v: '' }],

	// ---- Title - Artist, told by the channel ---------------------------------
	['Blue Signal - Paper Lanterns', 'Paper Lanterns', 'Paper Lanterns', 'Blue Signal', { r: 'dash-title-artist', min: 0.85 }],
	['Blue Signal - Paper Lanterns', 'PaperLanternsVEVO', 'Paper Lanterns', 'Blue Signal', { r: 'dash-title-artist' }],
	['Blue Signal - Paper Lanterns', 'Paper Lanterns Official', 'Paper Lanterns', 'Blue Signal', { r: 'dash-title-artist' }],
	['Winter Almanac - Glass Orchard (Official Video)', 'GlassOrchardBand', 'Glass Orchard', 'Winter Almanac', { r: 'dash-title-artist' }],

	// ---- Junk in brackets, dropped ---------------------------------------------
	['Saffron Circuit - Slow Current (Official Video)', 'musicfan1987', 'Saffron Circuit', 'Slow Current', { v: '' }],
	['Saffron Circuit - Slow Current [Official Audio]', 'musicfan1987', 'Saffron Circuit', 'Slow Current', { v: '' }],
	['Quiet Ferrymen - The Crossing (Official Music Video) [HD]', 'musicfan1987', 'Quiet Ferrymen', 'The Crossing', { v: '' }],
	['Quiet Ferrymen - The Crossing | Official Video', 'musicfan1987', 'Quiet Ferrymen', 'The Crossing', { v: '' }],
	['Tin Lighthouse Trio - Harbor Lights (Lyrics)', 'musicfan1987', 'Tin Lighthouse Trio', 'Harbor Lights', { v: '' }],
	['Tin Lighthouse Trio - Harbor Lights Lyrics', 'lyric lantern', 'Tin Lighthouse Trio', 'Harbor Lights', { v: '' }],
	['Tin Lighthouse Trio - Harbor Lights // Lyrics', 'lyric lantern', 'Tin Lighthouse Trio', 'Harbor Lights', {}],
	['DJ Tessellate - Mosaic (4K)', 'musicfan1987', 'DJ Tessellate', 'Mosaic', {}],
	['DJ Tessellate - Mosaic [1080p 60fps]', 'musicfan1987', 'DJ Tessellate', 'Mosaic', {}],
	['Marrow & Pine - Kindling (Official Lyric Video)', 'musicfan1987', 'Marrow & Pine', 'Kindling', {}],
	['The Velvet Algorithms - Sorting Song (Visualizer)', 'musicfan1987', 'The Velvet Algorithms', 'Sorting Song', {}],
	['Paper Lanterns - Blue Signal (2019)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { year: 2019 }],
	['Paper Lanterns - Blue Signal (Official Video 2019)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { year: 2019 }],
	['Paper Lanterns - Blue Signal - Official Video', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', {}],
	['Paper Lanterns - Blue Signal MV', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', {}],
	['Paper Lanterns - Blue Signal Official Music Video', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', {}],
	['Paper Lanterns - Blue Signal (Original Mix)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: '' }],
	['Paper Lanterns - Blue Signal (Full Version)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: '' }],
	['Paper Lanterns - Blue Signal [Lyrics / Romaji]', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', {}],
	['Paper Lanterns - Blue Signal (Official Video) | Sunken Meadow', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', {}],
	['Paper Lanterns - Blue Signal (Prod. DJ Tessellate)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', {}],
	['Paper Lanterns - Blue Signal <fp>Official Video</fp>', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', {}],

	// ---- Brackets that are part of the name, kept ------------------------------
	['Paper Lanterns - Blue Signal (Live Forever)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal (Live Forever)', { v: '' }],
	['Paper Lanterns - Blue Signal (Part 2)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal (Part 2)', { v: '' }],
	['Paper Lanterns - Blue Signal (with Mira Osei)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal (with Mira Osei)', {}],
	['Paper Lanterns - (In the Now)', 'musicfan1987', 'Paper Lanterns', '(In the Now)', {}],
	['Paper Lanterns - Blue Signal (We Live in Hope)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal (We Live in Hope)', { v: '' }],
	['Paper Lanterns - Blue Signal (2019 Live in Red Hollow)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'live' }],
	['Paper Lanterns - Out Now (Official Video)', 'musicfan1987', 'Paper Lanterns', 'Out Now', {}],

	// ---- Versions, kept ---------------------------------------------------------
	['Paper Lanterns - Blue Signal (Remastered 2011)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'remaster', vt: 'Remastered 2011' }],
	['Paper Lanterns - Blue Signal (2011 Remaster)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'remaster' }],
	['Paper Lanterns - Blue Signal (Live at Red Hollow 2019)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'live', vt: 'Live at Red Hollow 2019' }],
	['Paper Lanterns - Blue Signal (Live)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'live' }],
	['Paper Lanterns - Blue Signal [LIVE]', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'live' }],
	['Paper Lanterns - Blue Signal (Live) [Official Video]', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'live' }],
	['Paper Lanterns - Blue Signal - Live at Red Hollow', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'live' }],
	['Paper Lanterns - Blue Signal (Acoustic)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'acoustic' }],
	['Paper Lanterns - Blue Signal (Acoustic Live Version)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'live+acoustic' }],
	['Paper Lanterns - Blue Signal (DJ Tessellate Remix)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'remix', vt: 'DJ Tessellate Remix' }],
	['Paper Lanterns - Blue Signal (Instrumental)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'instrumental' }],
	['Paper Lanterns - Blue Signal (Off Vocal)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'instrumental' }],
	['Paper Lanterns - Blue Signal (Piano Version)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'piano' }],
	['Paper Lanterns - Blue Signal (Piano ver.)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'piano' }],
	['Glass Orchard - Winter Almanac (Hollow Compass Cover)', 'musicfan1987', 'Glass Orchard', 'Winter Almanac', { v: 'cover' }],
	['Paper Lanterns - Blue Signal (Demo)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'demo' }],
	['Paper Lanterns - Blue Signal (Radio Edit)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'edit' }],
	['Paper Lanterns - Blue Signal (Extended Mix)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'extended' }],
	['Paper Lanterns - Blue Signal (Slowed + Reverb)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'slowed' }],
	['Paper Lanterns - Blue Signal (Sped Up)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'sped-up' }],
	['Paper Lanterns - Blue Signal (Nightcore)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'sped-up' }],
	['Paper Lanterns - Blue Signal (Karaoke)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'karaoke' }],
	['Paper Lanterns - Blue Signal (TV Size)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'tv-size' }],
	['Paper Lanterns - Blue Signal (English Ver.)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'language' }],
	['Paper Lanterns - Blue Signal (2020 Version)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'alt', vt: '2020 Version' }],
	['Paper Lanterns - Blue Signal (Official Video) (Remastered) [4K]', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'remaster' }],
	['The Velvet Algorithms - Sorting Song (Live at Red Hollow) (Remastered 2011)', 'musicfan1987', 'The Velvet Algorithms', 'Sorting Song', { v: 'live+remaster' }],
	['Paper Lanterns - Blue Signal -Piano ver.-', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'piano' }],
	['Paper Lanterns - Blue Signal ~Acoustic~', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'acoustic' }],
	['Paper Lanterns - Blue Signal <wd>Acoustic<wd>', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'acoustic' }],
	['Vessant - Piano Concerto No. 1 (Live)', 'musicfan1987', 'Vessant', 'Piano Concerto No. 1', { v: 'live' }],

	// ---- feat. and ft. -----------------------------------------------------------
	['Paper Lanterns feat. Mira Osei - Blue Signal', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { feat: ['Mira Osei'] }],
	['Paper Lanterns ft. Mira Osei - Blue Signal', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { feat: ['Mira Osei'] }],
	['Paper Lanterns Ft Mira Osei - Blue Signal', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { feat: ['Mira Osei'] }],
	['Paper Lanterns - Blue Signal (feat. Mira Osei)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { feat: ['Mira Osei'] }],
	['Paper Lanterns - Blue Signal ft. Mira Osei', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { feat: ['Mira Osei'] }],
	['Paper Lanterns - Blue Signal [feat. Mira Osei & Tobin Vale]', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { feat: ['Mira Osei', 'Tobin Vale'] }],
	['Paper Lanterns - Blue Signal featuring Mira Osei (Official Video)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { feat: ['Mira Osei'] }],
	['Paper Lanterns feat. Mira Osei - Blue Signal (Live)', 'Paper Lanterns', 'Paper Lanterns', 'Blue Signal', { feat: ['Mira Osei'], v: 'live', min: 0.9 }],
	['Blue Signal (feat. Mira Osei)', 'Paper Lanterns - Topic', 'Paper Lanterns', 'Blue Signal', { feat: ['Mira Osei'], r: 'topic' }],
	['Paper Lanterns - 6 ft Under the Pier', 'musicfan1987', 'Paper Lanterns', '6 ft Under the Pier', { feat: [] }],

	// ---- Auto-generated Topic channels --------------------------------------------
	['Blue Signal', 'Paper Lanterns - Topic', 'Paper Lanterns', 'Blue Signal', { r: 'topic', min: 0.95 }],
	['Blue Signal - Single Version', 'Paper Lanterns - Topic', 'Paper Lanterns', 'Blue Signal - Single Version', { r: 'topic' }],
	['Blue Signal (Remastered 2011)', 'Paper Lanterns - Topic', 'Paper Lanterns', 'Blue Signal', { r: 'topic', v: 'remaster' }],
	['Blue Signal (Live)', 'Paper Lanterns - Topic', 'Paper Lanterns', 'Blue Signal', { r: 'topic', v: 'live' }],
	['Ashes / Embers', 'Glass Orchard - Topic', 'Glass Orchard', 'Ashes / Embers', { r: 'topic' }],
	['Night Suite, Pt. 2', 'Tin Lighthouse Trio - Topic', 'Tin Lighthouse Trio', 'Night Suite, Pt. 2', { r: 'topic' }],
	['Symphony No. 3 in D minor: II. Andante', 'Orchestra of Minor Tides - Topic', 'Orchestra of Minor Tides', 'Symphony No. 3 in D minor: II. Andante', { r: 'topic' }],
	['Winter Almanac', 'Various Artists - Topic', '', 'Winter Almanac', { r: 'none', max: 0 }],
	['Release - Topic', 'Quiet Ferrymen - Topic', 'Quiet Ferrymen', 'Release - Topic', { r: 'topic' }],

	// ---- VEVO and "Official" channels ----------------------------------------------
	['Blue Signal (Official Video)', 'PaperLanternsVEVO', 'Paper Lanterns', 'Blue Signal', { r: 'vevo-channel', min: 0.7 }],
	['Paper Lanterns - Blue Signal (Official Video)', 'PaperLanternsVEVO', 'Paper Lanterns', 'Blue Signal', { r: 'dash', min: 0.95 }],
	['Mosaic', 'DJTessellateVEVO', 'DJ Tessellate', 'Mosaic', { r: 'vevo-channel' }],
	['Blue Signal', 'Paper Lanterns Official', 'Paper Lanterns', 'Blue Signal', { r: 'official-channel', min: 0.7 }],
	['Blue Signal (Official Audio)', 'Paper Lanterns (Official)', 'Paper Lanterns', 'Blue Signal', { r: 'official-channel' }],
	['Blue Signal', 'Official Paper Lanterns', 'Paper Lanterns', 'Blue Signal', { r: 'official-channel' }],
	['Blue Signal', 'Paper Lanterns Official YouTube Channel', 'Paper Lanterns', 'Blue Signal', { r: 'official-channel' }],
	['Blue Signal', 'PaperLanternsOfficial', 'Paper Lanterns', 'Blue Signal', { r: 'official-channel' }],
	['Blue Signal', 'Paper Lanterns <jp:official><jp:channel>', 'Paper Lanterns', 'Blue Signal', { r: 'official-channel' }],
	['Blue Signal (Official Video)', 'Paper Lanterns', 'Paper Lanterns', 'Blue Signal', { r: 'channel-official-video', max: 0.6 }],
	['Blue Signal', 'Paper Lanterns', '', 'Blue Signal', { r: 'none', max: 0 }],
	['Paper Lanterns Blue Signal Official Video', 'Paper Lanterns', 'Paper Lanterns', 'Blue Signal', { r: 'channel-prefix' }],
	['Blue Signal', 'Sunken Meadow Records', '', 'Blue Signal', { r: 'none' }],
	['Blue Signal (Official Video)', 'Sunken Meadow Records', '', 'Blue Signal', { r: 'none' }],
	['Paper Lanterns - Blue Signal', 'Sunken Meadow Records', 'Paper Lanterns', 'Blue Signal', { r: 'dash', max: 0.85 }],
	['03 - Blue Signal', 'Paper Lanterns Official', 'Paper Lanterns', 'Blue Signal', { r: 'official-channel', trackNo: 3 }],
	['03. Blue Signal', 'Paper Lanterns - Topic', 'Paper Lanterns', 'Blue Signal', { r: 'topic', trackNo: 3 }],

	// ---- Title / Artist against Artist / Title -----------------------------------------
	['Blue Signal / Paper Lanterns', 'Paper Lanterns', 'Paper Lanterns', 'Blue Signal', { r: 'slash-title-artist', min: 0.9 }],
	['Paper Lanterns / Blue Signal', 'Paper Lanterns', 'Paper Lanterns', 'Blue Signal', { r: 'slash-artist-title', min: 0.9 }],
	['Paper Lanterns / Blue Signal (Official Video)', 'Paper Lanterns Official', 'Paper Lanterns', 'Blue Signal', { r: 'slash-artist-title' }],
	['Blue Signal / Paper Lanterns <l>Official Music Video</l>', 'Paper Lanterns Official YouTube Channel', 'Paper Lanterns', 'Blue Signal', { r: 'slash-title-artist', min: 0.9 }],
	['Blue Signal / Paper Lanterns', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'slash-guess', max: 0.5 }],
	// Japanese punctuation makes Title / Artist the likely order, but nothing vouches for it: a guess.
	['Blue Signal<fs>Paper Lanterns', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'slash-title-artist', max: 0.5 }],
	['Blue Signal / Paper Lanterns<l>MV</l>', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'slash-title-artist', max: 0.5 }],
	['<l>MV</l>Blue Signal / Paper Lanterns', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'slash-title-artist' }],
	['Blue Signal / Paper Lanterns feat. Mira Osei', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'slash-title-artist', feat: ['Mira Osei'], max: 0.5 }],
	['Paper Lanterns feat. Mira Osei / Blue Signal', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'slash-artist-title', feat: ['Mira Osei'] }],
	['Blue Signal / Paper Lanterns (cover)', 'Aoba Rin', 'Paper Lanterns', 'Blue Signal', { r: 'slash-guess', v: 'cover', max: 0.5 }],
	['Blue Signal / Paper Lanterns / Live Mix', 'musicfan1987', '', 'Blue Signal / Paper Lanterns / Live Mix', { r: 'none' }],
	['Blue Signal<fs>Aoba Rin', 'Aoba Rin ch.', 'Aoba Rin', 'Blue Signal', { r: 'slash-title-artist', min: 0.9 }],

	// ---- Corner brackets around the title ------------------------------------------------
	// corner brackets on a stranger's channel: the reading is kept, as a guess
	['Paper Lanterns<q>Blue Signal</q>', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'quote-artist-first', max: 0.5 }],
	['Paper Lanterns <q>Blue Signal</q> Music Video', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'quote-artist-first' }],
	['Paper Lanterns<w>Blue Signal</w>Official Music Video', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'quote-artist-first' }],
	['Paper Lanterns<w>Blue Signal</w><l>Official Video</l>', 'Paper Lanterns Official', 'Paper Lanterns', 'Blue Signal', { r: 'quote-artist-first', min: 0.95 }],
	['Paper Lanterns<a>Blue Signal</a>MV', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'quote-artist-first' }],
	['Paper Lanterns - <q>Blue Signal</q>', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'quote-artist-first' }],
	['<q>Blue Signal</q>Paper Lanterns', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'quote-title-first', max: 0.7 }],
	['<q>Blue Signal</q>/ Paper Lanterns', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'quote-title-first' }],
	['<w>Blue Signal</w> Paper Lanterns', 'Paper Lanterns', 'Paper Lanterns', 'Blue Signal', { r: 'quote-title-first', min: 0.95 }],
	['<l>MV</l>Paper Lanterns<q>Blue Signal</q>', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'quote-artist-first' }],
	['Paper Lanterns<q>Blue Signal</q>(Live ver.)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'quote-artist-first', v: 'live' }],
	['Paper Lanterns<q>Blue Signal</q>Live at Red Hollow', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'quote-artist-first', v: 'live' }],
	['Paper Lanterns<q>Blue Signal</q>feat. Mira Osei', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { feat: ['Mira Osei'] }],
	['Paper Lanterns<q>Blue Signal (Acoustic)</q>', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'acoustic' }],
	['<q>Blue Signal</q>', 'Paper Lanterns Official', 'Paper Lanterns', 'Blue Signal', { r: 'official-channel' }],
	['<q>Blue Signal</q>', 'musicfan1987', '', 'Blue Signal', { r: 'quote-only', max: 0 }],
	['Kumori Station<q>Blue Signal</q>x<q>Twin Rivers</q>', 'musicfan1987', 'Kumori Station', 'Blue Signal', { max: 0.5 }],

	// ---- Tags in lenticular brackets ------------------------------------------------------
	['<l>MV</l>Paper Lanterns - Blue Signal', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'dash' }],
	['Paper Lanterns - Blue Signal<l>Official Music Video</l>', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'dash' }],
	['<l>LIVE</l>Paper Lanterns - Blue Signal', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'live' }],
	['<l>Paper Lanterns</l>Blue Signal<l>MV</l>', 'musicfan1987', '', 'Blue Signal', { r: 'none', tags: ['Paper Lanterns'] }],
	['<l>Lyric Video</l> Paper Lanterns - Blue Signal <l>4K</l>', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', {}],
	['<l><jp:official></l>Paper Lanterns<q>Blue Signal</q>', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'quote-artist-first' }],
	['<l><jp:sang></l>Blue Signal / Aoba Rin', 'musicfan1987', 'Aoba Rin', 'Blue Signal', { r: 'slash-title-artist', v: 'cover' }],
	['<l><jp:live></l>Paper Lanterns<q>Blue Signal</q>', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'live' }],
	['Paper Lanterns<q>Blue Signal</q><l><jp:piano></l>', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'piano' }],
	['<l><jp:full></l>Paper Lanterns - Blue Signal', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: '' }],
	['Blue Signal / Paper Lanterns<l><jp:cover></l>', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { v: 'cover' }],

	// ---- Quotation marks -----------------------------------------------------------------------
	['Paper Lanterns "Blue Signal" (Official Video)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'quote-ascii', max: 0.7 }],
	['Paper Lanterns <lq>Blue Signal<rq>', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'quote-ascii' }],
	['Paper Lanterns - "Blue Signal"', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'dash' }],
	['Paper Lanterns "Blue Signal" and other stories', 'musicfan1987', '', 'Paper Lanterns "Blue Signal" and other stories', { r: 'none' }],

	// ---- Soundtracks ------------------------------------------------------------------------------
	['Starfall Odyssey OST - 03 - Ember Fields', 'pixel archive', '', 'Ember Fields', { r: 'ost', album: 'Starfall Odyssey', trackNo: 3, min: 0.8 }],
	['Starfall Odyssey Original Soundtrack - Ember Fields', 'pixel archive', '', 'Ember Fields', { r: 'ost', album: 'Starfall Odyssey' }],
	['Ember Fields (Starfall Odyssey Original Soundtrack)', 'musicfan1987', '', 'Ember Fields', { r: 'ost', album: 'Starfall Odyssey' }],
	['Ember Fields [Starfall Odyssey OST]', 'musicfan1987', '', 'Ember Fields', { r: 'ost', album: 'Starfall Odyssey' }],
	['Ember Fields - Starfall Odyssey OST', 'musicfan1987', '', 'Ember Fields', { r: 'ost', album: 'Starfall Odyssey' }],
	['Starfall Odyssey OST: Ember Fields', 'musicfan1987', '', 'Ember Fields', { r: 'ost', album: 'Starfall Odyssey' }],
	['Starfall Odyssey OST - Track 12 - Ember Fields (Extended)', 'musicfan1987', '', 'Ember Fields', { r: 'ost', trackNo: 12, v: 'extended' }],
	['Starfall Odyssey (Original Game Soundtrack) - 01 - Main Theme', 'musicfan1987', '', 'Main Theme', { r: 'ost', album: 'Starfall Odyssey', trackNo: 1 }],
	['Starfall Odyssey BGM - Ember Fields', 'musicfan1987', '', 'Ember Fields', { r: 'ost', album: 'Starfall Odyssey' }],
	['Aldric Vessant - Starfall Odyssey OST - 07 - Ember Fields', 'musicfan1987', 'Aldric Vessant', 'Ember Fields', { album: 'Starfall Odyssey', trackNo: 7 }],
	['Mira Osei - Ember Fields (From "Starfall Odyssey")', 'musicfan1987', 'Mira Osei', 'Ember Fields', { r: 'dash', album: 'Starfall Odyssey' }],
	['Mira Osei - Ember Fields (Starfall Odyssey OST)', 'musicfan1987', 'Mira Osei', 'Ember Fields', { r: 'dash', album: 'Starfall Odyssey' }],
	['Paper Lanterns - Blue Signal (Anime Music Video)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal (Anime Music Video)', { album: '' }],

	// ---- Classical ------------------------------------------------------------------------------------
	['Vessant: Nocturne in E-flat major, Op. 9 No. 2 - Ilse Marwen', 'musicfan1987', 'Vessant', 'Nocturne in E-flat major, Op. 9 No. 2', { r: 'classical-colon', performer: 'Ilse Marwen' }],
	['Aldric Vessant: Symphony No. 3 in D minor, Op. 21 - II. Andante - Orchestra of Minor Tides', 'musicfan1987', 'Aldric Vessant', 'Symphony No. 3 in D minor, Op. 21 - II. Andante', { r: 'classical-colon', performer: 'Orchestra of Minor Tides' }],
	['Vessant: String Quartet No. 2 <en> I. Allegro moderato <en> Tin Lighthouse Quartet', 'musicfan1987', 'Vessant', 'String Quartet No. 2 - I. Allegro moderato', { r: 'classical-colon', performer: 'Tin Lighthouse Quartet' }],
	['Vessant: Prelude in C minor, Op. 12 No. 4', 'musicfan1987', 'Vessant', 'Prelude in C minor, Op. 12 No. 4', { r: 'classical-colon', performer: '' }],
	['Vessant: Piano Concerto No. 1 (Ilse Marwen, piano)', 'musicfan1987', 'Vessant', 'Piano Concerto No. 1 (Ilse Marwen, piano)', { r: 'classical-colon', v: '' }],
	['Vessant - Nocturne in E-flat major, Op. 9 No. 2', 'musicfan1987', 'Vessant', 'Nocturne in E-flat major, Op. 9 No. 2', { r: 'dash' }],
	['Nocturne in E-flat major, Op. 9 No. 2 - Ilse Marwen', 'musicfan1987', 'Ilse Marwen', 'Nocturne in E-flat major, Op. 9 No. 2', { r: 'classical-work-performer', performer: 'Ilse Marwen', max: 0.6 }],
	['Note to Self: Waltz Home', 'musicfan1987', '', 'Note to Self: Waltz Home', { r: 'none' }],
	['Paper Lanterns - Blues in A Minor', 'musicfan1987', 'Paper Lanterns', 'Blues in A Minor', { r: 'dash' }],

	// ---- "A - B" where either side could be the artist (review, 2026-10-05) ------------------------------
	// Lyrics and cover uploads by strangers use both orders: a guess, not trusted.
	['Blue Signal - Paper Lanterns (Lyrics)', 'lyric lantern', 'Blue Signal', 'Paper Lanterns', { r: 'dash-guess', max: 0.5 }],
	['Paper Lanterns - Blue Signal (Acoustic Cover)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'dash-guess', max: 0.5, v: 'cover+acoustic' }],
	['Paper Lanterns - Blue Signal (Official Lyric Video)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { r: 'dash', max: 0.5 }],
	['Paper Lanterns - Blue Signal (Lyrics)', 'Paper Lanterns', 'Paper Lanterns', 'Blue Signal', { r: 'dash', min: 0.9 }],
	// a composer by surname on either side, or before a colon
	// a composer's surname on the right is a guess: 'Film Composer - Bach' names a piece
	['Clair de Lune - Debussy', 'piano room', 'Debussy', 'Clair de Lune', { r: 'dash-composer', max: 0.5 }],
	['Moonlight Sonata (1st Movement) - Beethoven', 'piano room', 'Beethoven', 'Moonlight Sonata (1st Movement)', { r: 'dash-composer' }],
	['Vivaldi: The Four Seasons - Spring (La Primavera)', 'string hour', 'Vivaldi', 'The Four Seasons - Spring (La Primavera)', { r: 'classical-colon', performer: '' }],
	['Johann Sebastian Bach - Air', 'piano room', 'Johann Sebastian Bach', 'Air', { r: 'dash', min: 0.85 }],
	['Glass Orchard - Wagner Street', 'musicfan1987', 'Glass Orchard', 'Wagner Street', { r: 'dash', max: 0.8 }],
	// second review (2026-10-05): a title that ends in a composer's name is not a composer
	['Hollow Compass - Roll Over Vivaldi', 'musicfan1987', 'Hollow Compass', 'Roll Over Vivaldi', { r: 'dash', max: 0.5 }],
	['J.S. Bach - Air', 'piano room', 'J.S. Bach', 'Air', { r: 'dash', min: 0.85 }],
	// 'Performer - Composer: Work': the performer is not glued to the composer
	['Ilse Marwen - Bach: Partita No. 2 in D minor, BWV 1004', 'Ilse Marwen', 'Ilse Marwen', 'Partita No. 2 in D minor, BWV 1004', { r: 'classical-performer', performer: 'Ilse Marwen', min: 0.9 }],
	['Ilse Marwen - Chopin: Nocturne No. 20', 'string hour', 'Chopin', 'Nocturne No. 20', { r: 'classical-colon', performer: 'Ilse Marwen', min: 0.85 }],
	['Aldric Vessant: Symphony No. 3 in D minor, Op. 21 - Orchestra of Minor Tides', 'Orchestra of Minor Tides', 'Aldric Vessant', 'Symphony No. 3 in D minor, Op. 21', { r: 'classical-colon', performer: 'Orchestra of Minor Tides', min: 0.85 }],
	// a tutorial bracket is a piano version, so the composer on the right is seen
	['Winter Almanac - Debussy (Piano Tutorial)', 'piano room', 'Debussy', 'Winter Almanac', { r: 'dash-composer', v: 'piano', max: 0.5 }],
	// a bare soundtrack bracket: the left side is the film or game
	['Starfall Odyssey - Ember Fields (Soundtrack)', 'musicfan1987', '', 'Ember Fields', { r: 'ost', album: 'Starfall Odyssey' }],
	// a label's official channel is not an artist's
	['Blue Signal', 'Sunken Meadow Records Official', '', 'Blue Signal', { r: 'none', max: 0 }],
	// a short capitals channel name that abbreviates one side
	['Blue Signal - Paper Lanterns (Official Video)', 'PLNofficial', 'Paper Lanterns', 'Blue Signal', { r: 'dash-title-artist', min: 0.85 }],
	// a collection or a stream is nobody's name
	['Paper Lanterns Piano Collection - Blue Signal', 'keys at dusk', '', 'Paper Lanterns Piano Collection - Blue Signal', { r: 'none' }],
	['lofi radio - beats to read to', 'Quiet Ferrymen', '', 'lofi radio - beats to read to', { r: 'none' }],
	// the channel's artist at the end of a soundtrack title; a bracket after the channel's name is not part of it
	['Ember Fields Soundtrack - Night Crossing - Aldric Vessant', 'Aldric Vessant', 'Aldric Vessant', 'Night Crossing', { r: 'dash-title-artist', album: 'Ember Fields' }],
	['Blue Signal - Paper Lanterns (Harbor Lights Volume Alpha)', 'Paper Lanterns', 'Paper Lanterns', 'Blue Signal', { r: 'dash-title-artist', tags: ['Harbor Lights Volume Alpha'] }],

	// ---- The channel's name, whole words only (third review, 2026-10-06) -------------------------------
	// These rows quote the reviewer's titles, which name real songs and artists
	// (the one exception to "invented" in this table). A side that only starts
	// with the channel's name is not the channel's artist; a side that is the
	// name beats one that merely contains it; a channel "X Fan" does not vouch for X.
	['Kissin\' Time - KISS', 'KISS', 'KISS', 'Kissin\' Time', { r: 'dash-title-artist', min: 0.9 }],
	['Heartless - Heart (Live)', 'Heart', 'Heart', 'Heartless', { r: 'dash-title-artist', v: 'live', min: 0.9 }],
	['Heartless - Heart', 'Heart Official', 'Heart', 'Heartless', { r: 'dash-title-artist', min: 0.9 }],
	['Totoro - Toto (cover)', 'Toto', 'Toto', 'Totoro', { r: 'dash-title-artist', min: 0.9 }],
	['Rush Hour - Rush', 'Rush', 'Rush', 'Rush Hour', { r: 'dash-title-artist', min: 0.9 }],
	['Princess of China - Coldplay', 'Princess', 'Princess of China', 'Coldplay', { r: 'dash', max: 0.5 }],
	['Queen of the Night - Whitney Houston', 'Queen Official', 'Queen of the Night', 'Whitney Houston', { r: 'dash', max: 0.5 }],
	['Kissin You - Miranda Cosgrove', 'KISS', 'Kissin You', 'Miranda Cosgrove', { r: 'dash', max: 0.5 }],
	['Moonlight Sonata - Beethoven', 'Moonlight', 'Beethoven', 'Moonlight Sonata', { r: 'dash-composer', max: 0.5 }],
	['Bohemian Rhapsody - Queen', 'Bohemian Rhapsody Fan', 'Bohemian Rhapsody', 'Queen', { r: 'dash', max: 0.5 }],
	['Love Story - Taylor Swift (Lyrics)', 'Love', 'Love Story', 'Taylor Swift', { r: 'dash-guess', max: 0.5 }],
	['Dreams - Fleetwood Mac', 'Dream', 'Dreams', 'Fleetwood Mac', { r: 'dash', max: 0.5 }],
	['Summertime Sadness - Lana Del Rey', 'Summer', 'Summertime Sadness', 'Lana Del Rey', { r: 'dash', max: 0.5 }],
	['Moonlight - XXXTENTACION', 'Moon', 'Moonlight', 'XXXTENTACION', { r: 'dash', max: 0.5 }],
	['Rainbow Connection - Kermit the Frog', 'Rainbow', 'Rainbow Connection', 'Kermit the Frog', { r: 'dash', max: 0.5 }],
	['Blue Monday - New Order', 'Blue', 'Blue Monday', 'New Order', { r: 'dash', max: 0.5 }],
	['Golden Hour - JVKE', 'Golden', 'Golden Hour', 'JVKE', { r: 'dash', max: 0.5 }],
	['Night Changes - One Direction', 'Night', 'Night Changes', 'One Direction', { r: 'dash', max: 0.5 }],
	['Midnight City - M83', 'Midnight', 'Midnight City', 'M83', { r: 'dash', max: 0.5 }],
	// five more of the fixer's own: "&" after a one-word channel name is a title, not a credit;
	// whole words, "&" for "and" and a camel-case channel name are the same name
	['Heart & Soul - T\'Pau', 'Heart', 'Heart & Soul', 'T\'Pau', { r: 'dash', max: 0.5 }],
	['Abba Dabba Honeymoon - Debbie Reynolds', 'ABBA', 'Abba Dabba Honeymoon', 'Debbie Reynolds', { r: 'dash', max: 0.5 }],
	['Starman - David Bowie', 'Star', 'Starman', 'David Bowie', { r: 'dash', max: 0.5 }],
	['Hurt - Johnny Cash', 'Johnny Cash Fans', 'Hurt', 'Johnny Cash', { r: 'dash', max: 0.5 }],
	['Earth, Wind & Fire - September', 'Earth Wind and Fire', 'Earth, Wind & Fire', 'September', { r: 'dash', min: 0.95 }],
	['Wonderwall - Oasis', 'oasisinet', 'Oasis', 'Wonderwall', { r: 'dash-title-artist', min: 0.9 }],
	['The Piano Guys - Code Name Vivaldi', 'ThePianoGuys', 'The Piano Guys', 'Code Name Vivaldi', { r: 'dash', min: 0.95 }],
	['Heart feat. Ann Wilson - Barracuda', 'Heart', 'Heart', 'Barracuda', { r: 'dash', min: 0.95, feat: ['Ann Wilson'] }],
	// two uploaders that write "Artist - Title" and say who they are (invented names again):
	// a session channel named in the live tag, and a record label's official upload
	['Paper Lanterns - Blue Signal (Live at Red Hollow)', 'Red Hollow Sessions', 'Paper Lanterns', 'Blue Signal', { r: 'dash-session', min: 0.7, v: 'live' }],
	['Glass Orchard - Winter Almanac | A HARBOR SHOW', 'HARBOR', 'Glass Orchard', 'Winter Almanac', { r: 'dash-session', min: 0.7 }],
	['Twin Rivers - Glass Orchard (Live)', 'Red Hollow Sessions', 'Twin Rivers', 'Glass Orchard', { r: 'dash', max: 0.5, v: 'live' }],
	['Twin Rivers - Glass Orchard | Glass Orchard fan edit', 'Glass Orchard Fan', 'Twin Rivers', 'Glass Orchard', { r: 'dash', max: 0.5 }],
	['Paper Lanterns - Blue Signal (Live at Red Hollow) (Cover)', 'Red Hollow Sessions', 'Paper Lanterns', 'Blue Signal', { r: 'dash-guess', max: 0.5 }],
	['Paper Lanterns - Blue Signal (Official Video)', 'Sunken Meadow Records', 'Paper Lanterns', 'Blue Signal', { r: 'dash-label', min: 0.7 }],
	['Paper Lanterns - Blue Signal (Official Video)', 'Sunken Meadow Lyrics', 'Paper Lanterns', 'Blue Signal', { r: 'dash', max: 0.5 }],
	['Glass Orchard - Winter Almanac', 'Sunken Meadow Records', 'Glass Orchard', 'Winter Almanac', { r: 'dash', max: 0.5 }],

	// ---- Rules the user taught for a channel --------------------------------------------------------------
	['Blue Signal / Paper Lanterns', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { rule: 'title-artist', r: 'channel-rule', min: 1 }],
	['Paper Lanterns / Blue Signal', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { rule: 'artist-title', r: 'channel-rule', min: 1 }],
	['Blue Signal - Paper Lanterns', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { rule: 'title-artist', r: 'channel-rule' }],
	['Blue Signal - Paper Lanterns (Live)', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { rule: 'title-artist', r: 'channel-rule', v: 'live' }],
	['Blue Signal (Official Video)', 'Marrow and Pine TV', 'Marrow and Pine', 'Blue Signal', { rule: 'channel', r: 'channel-rule' }],
	['Kindling', 'm&p uploads', 'Marrow & Pine', 'Kindling', { rule: { artist: 'Marrow & Pine' }, r: 'channel-rule' }],
	['Marrow & Pine - Kindling', 'm&p uploads', 'Marrow & Pine', 'Kindling', { rule: { artist: 'Marrow & Pine' }, r: 'channel-rule' }],
	['Paper Lanterns - Blue Signal', 'talk show clips', '', 'Paper Lanterns - Blue Signal', { rule: 'none', r: 'channel-rule' }],
	['Paper Lanterns<q>Blue Signal</q>', 'musicfan1987', 'Paper Lanterns', 'Blue Signal', { rule: 'title-artist', r: 'channel-rule' }],
	['Blue Signal', 'musicfan1987', '', 'Blue Signal', { rule: 'title-artist', r: 'none' }],

	// ---- Nothing to go on ------------------------------------------------------------------------------------
	['', '', '', '', { r: 'none', max: 0 }],
	['Blue Signal', '', '', 'Blue Signal', { r: 'none' }],
	['Full Album 1987', 'musicfan1987', '', 'Full Album 1987', { r: 'none' }],
	['Paper Lanterns | Blue Signal | Red Hollow Sessions', 'Red Hollow', '', 'Paper Lanterns', { r: 'none' }],
	['2 hours of rain on a tin roof', 'sleepy sounds', '', '2 hours of rain on a tin roof', { r: 'none' }]
];

describe('parse', function () {
	var Parse = require('./parse.js');
	ok(PARSE_CASES.length >= 120, 'the table has at least 120 title and channel pairs (' + PARSE_CASES.length + ')');
	var seen = {};
	PARSE_CASES.forEach(function (c, i) {
		var title = jp(c[0]), channel = jp(c[1]), want = c[4] || {};
		var key = c[0] + '\u0000' + c[1] + '\u0000' + JSON.stringify(want.rule || '');
		if (seen[key]) ok(false, 'case ' + (i + 1) + ' repeats an earlier one: ' + c[0]);
		seen[key] = true;
		var got = Parse.parse(title, channel, want.rule ? { channelRule: want.rule } : undefined);
		var problems = [];
		if (got.artist !== c[2]) problems.push('artist ' + JSON.stringify(got.artist) + ' != ' + JSON.stringify(c[2]));
		if (got.title !== c[3]) problems.push('title ' + JSON.stringify(got.title) + ' != ' + JSON.stringify(c[3]));
		if ('v' in want && got.version !== want.v) problems.push('version ' + JSON.stringify(got.version) + ' != ' + JSON.stringify(want.v));
		if ('vt' in want && got.versionText !== want.vt) problems.push('versionText ' + JSON.stringify(got.versionText) + ' != ' + JSON.stringify(want.vt));
		if ('r' in want && got.rule !== want.r) problems.push('rule ' + got.rule + ' != ' + want.r);
		if ('feat' in want && JSON.stringify(got.feat) !== JSON.stringify(want.feat)) problems.push('feat ' + JSON.stringify(got.feat));
		if ('album' in want && got.album !== want.album) problems.push('album ' + JSON.stringify(got.album));
		if ('trackNo' in want && got.trackNo !== want.trackNo) problems.push('trackNo ' + got.trackNo);
		if ('performer' in want && got.performer !== want.performer) problems.push('performer ' + JSON.stringify(got.performer));
		if ('year' in want && got.year !== want.year) problems.push('year ' + got.year);
		if ('tags' in want && JSON.stringify(got.tags) !== JSON.stringify(want.tags)) problems.push('tags ' + JSON.stringify(got.tags));
		if ('min' in want && !(got.confidence >= want.min)) problems.push('confidence ' + got.confidence + ' < ' + want.min);
		if ('max' in want && !(got.confidence <= want.max)) problems.push('confidence ' + got.confidence + ' > ' + want.max);
		if (!(got.confidence >= 0 && got.confidence <= 1)) problems.push('confidence out of range');
		if (!Parse.RULES[got.rule]) problems.push('rule ' + got.rule + ' is not in RULES');
		if (!got.artist && got.confidence !== 0 && got.rule !== 'ost' && got.rule !== 'channel-rule') problems.push('no artist but confidence ' + got.confidence);
		ok(!problems.length, (i + 1) + ' ' + JSON.stringify(c[0]) + ' @ ' + JSON.stringify(c[1]) + (problems.length ? '\n        ' + problems.join('\n        ') : ' -> ' + (got.artist || '(unknown)') + ' | ' + got.title + (got.version ? ' [' + got.version + ']' : '') + ' (' + got.rule + ' ' + got.confidence + ')'));
	});

	// The same answer whatever the parser was asked before (no state leaks
	// between calls through a global regular expression).
	var first = PARSE_CASES.map(function (c) { return JSON.stringify(Parse.parse(jp(c[0]), jp(c[1]), c[4] && c[4].rule ? { channelRule: c[4].rule } : undefined)); });
	var second = PARSE_CASES.slice().reverse().map(function (c) { return JSON.stringify(Parse.parse(jp(c[0]), jp(c[1]), c[4] && c[4].rule ? { channelRule: c[4].rule } : undefined)); }).reverse();
	eq(first, second, 'parsing is stateless: the table gives the same answers in reverse order');

	// Never throws, whatever it is given.
	var odd = [null, undefined, 42, {}, [], '   ', '-', ' - ', '/', '()', '(((', ')))', '[]', jp('<q></q>'), jp('<l></l>'), ' - - - ', 'a - ', ' - b', '(Official Video)', 'feat.', jp('<fs>'), new Array(3000).join('x - ')];
	var threw = 0;
	odd.forEach(function (t) { odd.forEach(function (c) { try { var r = Parse.parse(t, c); if (typeof r.title !== 'string' || typeof r.artist !== 'string') threw++; } catch (e) { threw++; } }); });
	eq(threw, 0, 'never throws and always returns strings, on ' + (odd.length * odd.length) + ' odd inputs');

	// channelInfo
	eq(Parse.channelInfo('Paper Lanterns - Topic').kind, 'topic', 'channelInfo: a Topic channel');
	eq(Parse.channelInfo('Various Artists - Topic').kind, 'various', 'channelInfo: Various Artists - Topic names nobody');
	eq(Parse.channelInfo('PaperLanternsVEVO').name, 'Paper Lanterns', 'channelInfo: VEVO name is split at its capitals');
	eq(Parse.channelInfo('Sunken Meadow Records').kind, 'label', 'channelInfo: a label is not an artist');
	eq(Parse.channelInfo('Paper Lanterns').kind, 'plain', 'channelInfo: a plain channel');
	eq(Parse.channelInfo('').kind, 'none', 'channelInfo: no channel');

	// partOf
	eq(Parse.partOf('Night Suite, Pt. 2'), { base: 'Night Suite', n: 2, of: null }, 'partOf: "Pt. 2"');
	eq(Parse.partOf('Night Suite (Part 3)'), { base: 'Night Suite', n: 3, of: null }, 'partOf: "(Part 3)"');
	eq(Parse.partOf('Night Suite Part II'), { base: 'Night Suite', n: 2, of: null }, 'partOf: a roman numeral');
	eq(Parse.partOf('Symphony No. 3 in D minor: II. Andante'), { base: 'Symphony No. 3 in D minor', n: 2, of: null }, 'partOf: a movement');
	eq(Parse.partOf('Harbor Tapes - Side B'), { base: 'Harbor Tapes', n: 2, of: null }, 'partOf: "Side B"');
	eq(Parse.partOf('Long Mix [2/3]'), { base: 'Long Mix', n: 2, of: 3 }, 'partOf: "[2/3]"');
	eq(Parse.partOf('Field Recording #4'), { base: 'Field Recording', n: 4, of: null }, 'partOf: "#4"');
	eq(Parse.partOf('Symphony No. 5'), null, 'partOf: a work number is not a part');
	eq(Parse.partOf('Blue Signal'), null, 'partOf: an ordinary title');
	eq(Parse.partOf('Part of Me'), null, 'partOf: the word "Part" at the start of a title');

	// releaseYear
	eq(Parse.releaseYear('Provided to YouTube by Sunken Meadow\n\nBlue Signal\n\nReleased on: 1997-05-21\n'), 1997, 'releaseYear: "Released on:" line');
	eq(Parse.releaseYear('Blue Signal ' + cp(0x2117) + ' 2004 Sunken Meadow'), 2004, 'releaseYear: the sound-recording copyright line');
	eq(Parse.releaseYear('no date here 12345'), null, 'releaseYear: nothing stated');

	// fold
	eq(Parse.fold('  Las Polillas El' + cp(0xE9) + 'ctricas! '), 'laspolillaselectricas', 'fold: accents, case, spaces and punctuation go');
});

// =============================================================================
// library
// =============================================================================

var WIKI = 'https://en.wikipedia.org/wiki/';
var T0 = Date.parse('2026-10-15T12:00:00Z');   // "now" for the tests: mid-month, so local time zones agree on the month
var DAY = 86400000;

function video(id, title, channel, more) {
	var v = { id: id, title: title, channel: channel, channelId: 'ch-' + channel.toLowerCase().replace(/[^a-z0-9]+/g, '-'), durationSec: 200, publishedAt: '2015-03-01T00:00:00Z', embeddable: true, topics: [] };
	for (var k in (more || {})) v[k] = more[k];
	return v;
}

describe('library', function () {
	var L = require('./library.js');
	var Shuffle = require('./shuffle.js');

	// ---- durations, genres, names
	eq([L.parseDuration('PT4M13S'), L.parseDuration('PT1H2M3S'), L.parseDuration('PT45S'), L.parseDuration('P1DT1S'), L.parseDuration('P0D'), L.parseDuration('nonsense')], [253, 3723, 45, 86401, 0, 0], 'parseDuration reads ISO 8601 durations; a live stream is 0');
	eq(L.genresFromTopics([WIKI + 'Rock_music', WIKI + 'Music']), ['Rock'], 'topics: Rock_music and Music give Rock');
	eq(L.genresFromTopics([WIKI + 'Music']), [], 'topics: "Music" alone means unknown');
	eq(L.genresFromTopics([WIKI + 'Pop_music', WIKI + 'Music_of_Asia', WIKI + 'Electronic_music']), ['Pop', 'Asian', 'Electronic'], 'topics: several genres per track');
	eq(L.genresFromTopics([WIKI + 'Rhythm_and_blues', WIKI + 'Hip_hop_music', WIKI + 'Independent_music']), ['R&B', 'Hip hop', 'Indie'], 'topics: the short names');
	eq(L.genresFromTopics([WIKI + 'Video_game_culture', WIKI + 'Entertainment', 'not a url', null]), [], 'topics: what is not a genre is ignored');
	eq(L.genresFromTopics([WIKI + 'Folk_music']), ['Folk'], 'topics: a music topic the table has not met still gets a name');
	eq(L.genresFromTopics([]), [], 'topics: none');
	var named = Object.keys(L.GENRE_TOPICS).filter(function (k) { return L.GENRE_TOPICS[k]; });
	eq(named.length, 14, 'the genre table names 14 genres, one per YouTube music topic');
	eq(new Set(named.map(function (k) { return L.GENRE_TOPICS[k]; })).size, 14, 'no two topics share a short name');

	eq(L.normArtist('The Paper Lanterns'), L.normArtist('paper lanterns'), 'normArtist: a leading "The" and case do not matter');
	eq(L.normArtist('Marrow & Pine'), L.normArtist('Marrow and Pine'), 'normArtist: "&" is "and"');
	eq(L.normArtist('Las Polillas El' + cp(0xE9) + 'ctricas'), 'laspolillaselectricas', 'normArtist: accents go');
	ok(L.normArtist('Glass Orchard') !== L.normArtist('Glass Orchid'), 'normArtist: different names stay different');
	eq(L.normArtist(''), '', 'normArtist: empty');
	eq([L.lengthClass(0), L.lengthClass(149), L.lengthClass(150), L.lengthClass(300), L.lengthClass(301), L.lengthClass(600), L.lengthClass(601)], ['unknown', 'short', 'medium', 'medium', 'long', 'long', 'epic'], 'lengthClass boundaries');
	var agree = true;
	for (var sec = 0; sec <= 700; sec++) if (L.lengthClass(sec) !== Shuffle.lengthClass(sec)) agree = false;
	ok(agree, 'library.js and shuffle.js put every length from 0 to 700 s in the same class');
	eq([L.decadeOf(1997), L.decadeOf(2010), L.decadeOf(null)], ['1990s', '2010s', ''], 'decadeOf');

	// ---- a small library
	var lib = L.create();
	var r = L.upsert(lib, [
		video('v1', 'Paper Lanterns - Blue Signal (Official Video)', 'Paper Lanterns', { topics: [WIKI + 'Rock_music', WIKI + 'Music'], durationSec: 215 }),
		video('v2', 'Blue Signal / Paper Lanterns', 'musicfan1987', { durationSec: 216 }),
		video('v3', 'PAPER LANTERNS - Blue Signal (Live at Red Hollow)', 'Red Hollow', { durationSec: 260 }),
		video('v4', 'The Paper Lanterns - Twin Rivers', 'musicfan1987', { topics: [WIKI + 'Pop_music'], durationSec: 100 }),
		video('v5', 'Night Suite, Pt. 2', 'Tin Lighthouse Trio - Topic', { topics: [WIKI + 'Jazz'], year: 1997, durationSec: 640 }),
		video('v6', 'Night Suite, Pt. 1', 'Tin Lighthouse Trio - Topic', { topics: [WIKI + 'Jazz'], year: 1997, durationSec: 580 }),
		video('v7', 'Starfall Odyssey OST - 03 - Ember Fields', 'pixel archive', { durationSec: 0, live: true }),
		video('v8', 'Glass Orchard - Winter Almanac (1984)', 'cassette drawer', { publishedAt: '2012-01-01T00:00:00Z' })
	], { playlistId: 'PL1', addedAt: { v1: '2026-10-03T08:00:00Z', v2: '2024-01-01T00:00:00Z' }, now: T0 });
	eq([r.added.length, r.updated.length], [8, 0], 'upsert adds eight tracks');
	var t = lib.tracks;
	eq([t.v1.artist, t.v1.title, t.v1.artistKey, t.v1.genres], ['Paper Lanterns', 'Blue Signal', 'paperlanterns', ['Rock']], 'a track gets its artist, title, key and genres');
	eq([t.v2.artist, t.v2.title, t.v2.guess.artist, t.v2.guess.rule], ['', 'Blue Signal / Paper Lanterns', 'Paper Lanterns', 'slash-guess'], 'a guess under the confidence threshold leaves the artist unknown, keeps the whole title, and keeps the guess');
	eq([t.v3.artistKey, t.v3.version], ['paperlanterns', 'live'], 'another spelling of the artist shares the key; the live version is kept');

	// ---- "A - B" settled by what the rest of the library knows (review, 2026-10-05)
	(function () {
		var kl = L.create();
		// imported first, while nothing is known: a toss-up, the artist left unknown
		L.upsert(kl, [
			video('k1', 'Blue Signal - Paper Lanterns (Lyrics)', 'lyric lantern'),
			video('k2', 'Twin Rivers - Paper Lanterns', 'musicfan1987'),
			video('k3', 'Hollow Compass - Glass Orchard', 'cassette drawer'),
			video('k4', 'Hollow Compass - Late Static', 'cassette drawer'),
			video('k5', 'Neon Abacus - Counting Backwards (Lyrics)', 'lyric lantern'),
			video('k6', 'Neon Abacus - Small Hours', 'musicfan1987')
		], { playlistId: 'PK1', now: T0 });
		// policy of 2026-10-05: nothing vouches for a plain dash on a stranger's channel, so it is a guess too
		eq([kl.tracks.k1.artist, kl.tracks.k1.guess.rule, kl.tracks.k2.artist, kl.tracks.k2.guess.artist, kl.tracks.k2.artistGuess, kl.tracks.k2.title], ['', 'dash-guess', '', 'Twin Rivers', 'musicfan1987', 'Twin Rivers - Paper Lanterns'], 'known artists: before the library knows anyone, a lyrics upload and a plain dash are guesses: the channel shown as the artist, the title as uploaded, the split kept');
		eq([kl.tracks.k5.artist, kl.tracks.k5.guess.rule, kl.tracks.k5.guess.artist], ['', 'known-artist', 'Neon Abacus'], 'known artists: a side only guessed elsewhere leans the guess that way, and it stays a guess');
		// then playlists that name Paper Lanterns and Glass Orchard for sure
		L.upsert(kl, [
			video('k7', 'Blue Signal', 'Paper Lanterns - Topic'),
			video('k8', 'Winter Almanac', 'Glass Orchard - Topic')
		], { playlistId: 'PK2', now: T0 });
		var fixed = L.resolveArtists(kl);
		eq([kl.tracks.k1.artist, kl.tracks.k1.title, kl.tracks.k1.guess.rule], ['Paper Lanterns', 'Blue Signal', 'known-artist'], 'known artists: resolveArtists settles a lyrics upload imported before the artist was known');
		eq([kl.tracks.k2.artist, kl.tracks.k2.title], ['Paper Lanterns', 'Twin Rivers'], 'known artists: a plain "Title - Artist" is turned round when the right side is a sure artist and the left is nobody');
		eq([kl.tracks.k3.artist, kl.tracks.k3.title, kl.tracks.k3.guess.artist], ['', 'Hollow Compass - Glass Orchard', 'Hollow Compass'], 'known artists: a song named after a known band is not given to that band; it stays a guess for the other side');
		ok(fixed.indexOf('k1') >= 0 && fixed.indexOf('k2') >= 0 && fixed.indexOf('k3') < 0, 'known artists: resolveArtists returns the ids it changed (' + fixed.join(', ') + ')');
		eq(L.resolveArtists(kl), [], 'known artists: a second resolveArtists changes nothing');
		var kn = L.knownArtists(kl);
		eq([kn('paper lanterns').sure, kn('Hollow Compass').seen, kn('Nobody').sure], [1, 2, 0], 'knownArtists counts sure and guessed names');
		// a fresh upsert of the same video keeps the settled answer
		L.upsert(kl, [video('k1', 'Blue Signal - Paper Lanterns (Lyrics)', 'lyric lantern')], { now: T0 });
		eq(kl.tracks.k1.artist, 'Paper Lanterns', 'known artists: a refresh keeps the answer');
		// nothing sure anywhere: a name that heads many lyrics uploads is the artist; a title met twice is not
		var rl = L.create();
		L.upsert(rl, [
			video('m1', 'Saffron Circuit - Amber Hours (Lyrics)', 'lyric lantern'), video('m2', 'Saffron Circuit - Late Ferry (Lyrics)', 'lyric lantern'),
			video('m3', 'Saffron Circuit - Copper Sky (Lyrics)', 'lyric lantern'), video('m4', 'Saffron Circuit - Night Rail (Lyrics)', 'lyric lantern'),
			video('h1', 'Hollow Hymn - Quiet Ferrymen (Lyrics)', 'lyric lantern'), video('h2', 'Hollow Hymn - Marrow & Pine (Lyrics)', 'lyric lantern')
		], { now: T0 });
		L.resolveArtists(rl);
		eq(['m1', 'm2', 'm3', 'm4'].map(function (id) { return rl.tracks[id].artist || rl.tracks[id].guess.artist + '?'; }), ['Saffron Circuit?', 'Saffron Circuit?', 'Saffron Circuit?', 'Saffron Circuit?'], 'known artists: a name heading four lyrics uploads with four different titles is the guess for all four (a count is not a voucher)');
		eq([rl.tracks.h1.artist, rl.tracks.h2.artist], ['', ''], 'known artists: a title that heads two uploads by different artists stays a toss-up');
	})();
	eq(t.v4.artistKey, 'paperlanterns', '"The Paper Lanterns" is the same artist');
	eq([t.v5.year, t.v5.yearSource, t.v5.decade], [1997, 'release', '1990s'], 'the release year a description states wins over the upload year');
	eq([t.v8.year, t.v8.yearSource, t.v8.decade], [1984, 'title', '1980s'], 'a year in the title wins over the upload year');
	eq([t.v1.year, t.v1.yearSource], [2015, 'upload'], 'otherwise the upload year');
	eq([t.v7.genres, t.v7.album, t.v7.trackNo, t.v7.run], [['Soundtrack'], 'Starfall Odyssey', 3, null], 'a soundtrack title gives a genre, an album and a track number, but no run: its tracks are separate pieces');
	eq([t.v5.run, t.v6.run], [{ key: 'tinlighthousetrio|nightsuite', n: 2 }, { key: 'tinlighthousetrio|nightsuite', n: 1 }], 'numbered parts of one work share a run');
	eq([t.v1.addedAt.PL1, t.v1.playlists], ['2026-10-03T08:00:00Z', ['PL1']], 'the date added is kept per playlist');
	eq(t.v1.fetchedAt, new Date(T0).toISOString(), 'fetchedAt is the time of the upsert');
	eq([t.v1.rating, t.v1.plays, t.v1.skips, t.v1.lastPlayed, t.v1.blocked, t.v1.removed, t.v1.embeddable], [0, 0, 0, null, false, false, true], 'a new track starts unrated and unplayed');

	// ---- the user's state survives a refresh
	L.edit(lib, 'v2', { artist: 'Paper Lanterns', title: 'Blue Signal', rating: 4 });
	L.edit(lib, 'v1', { rating: 5, tags: ['morning', 'morning', 'drive'], genres: ['Indie', 'Rock'] });
	L.recordPlay(lib, 'v1', { at: T0 - DAY, completed: true });
	L.recordPlay(lib, 'v1', { at: T0 - 3600000, listenedSec: 150 });
	L.recordPlay(lib, 'v1', { at: T0, listenedSec: 5 });
	eq([t.v1.plays, t.v1.skips, t.v1.lastPlayed], [2, 1, new Date(T0 - 3600000).toISOString()], 'recordPlay: an ended track and one heard past half are plays, a short listen is a skip');
	eq([t.v2.artist, t.v2.title, t.v2.artistKey, t.v2.rating], ['Paper Lanterns', 'Blue Signal', 'paperlanterns', 4], 'edit: a corrected artist and title');
	eq([t.v1.tags, t.v1.genres, t.v1.genreSource], [['morning', 'drive'], ['Indie', 'Rock'], 'track'], 'edit: tags without repeats, genres set for the track');
	var r2 = L.upsert(lib, [
		video('v1', 'Paper Lanterns - Blue Signal (Official Video) [Remastered 2020]', 'Paper Lanterns', { topics: [WIKI + 'Pop_music'], durationSec: 217, embeddable: false }),
		video('v2', 'Blue Signal / Paper Lanterns', 'musicfan1987', {})
	], { playlistId: 'PL2', now: T0 + DAY });
	eq([r2.added, r2.updated], [[], ['v1', 'v2']], 'upsert of known ids updates them');
	eq([t.v1.rating, t.v1.plays, t.v1.skips, t.v1.tags, t.v1.genres], [5, 2, 1, ['morning', 'drive'], ['Indie', 'Rock']], 'a refresh keeps rating, counts, tags and the genre correction');
	eq([t.v1.version, t.v1.durationSec, t.v1.embeddable, t.v1.raw.title], ['remaster', 217, false, 'Paper Lanterns - Blue Signal (Official Video) [Remastered 2020]'], 'a refresh takes the new title, length and embeddable flag');
	eq([t.v2.artist, t.v2.title, t.v2.userEdits.artist, t.v2.userEdits.title], ['Paper Lanterns', 'Blue Signal', 'Paper Lanterns', 'Blue Signal'], 'a refresh keeps the corrected artist and title');
	eq([t.v1.playlists, t.v1.addedAt.PL1], [['PL1', 'PL2'], '2026-10-03T08:00:00Z'], 'the second playlist is added; the first date added stays');
	L.edit(lib, 'v2', { artist: null, title: null });
	eq([t.v2.artist, t.v2.title, t.v2.userEdits], ['', 'Blue Signal / Paper Lanterns', {}], 'edit with null takes a correction back');
	eq(L.edit(lib, 'nope', { rating: 3 }), null, 'edit of an unknown id is null');
	L.edit(lib, 'v8', { rating: 9 }); eq(t.v8.rating, 5, 'a rating is clamped to 0..5');
	L.edit(lib, 'v8', { rating: 0, year: 1985 }); eq([t.v8.year, t.v8.yearSource, t.v8.decade], [1985, 'edit', '1980s'], 'a corrected year wins');
	L.edit(lib, 'v8', { year: null });

	// ---- removed and unplayable
	eq(L.markMissing(lib, ['v4', 'nope'], T0 + DAY), ['v4'], 'markMissing marks what the library has');
	eq([t.v4.removed, t.v4.removedReason, L.playable(t.v4)], [true, 'gone', false], 'a missing video is removed and not playable');
	L.upsert(lib, [video('v4', 'The Paper Lanterns - Twin Rivers', 'musicfan1987', { topics: [WIKI + 'Pop_music'], durationSec: 100 })], { now: T0 + DAY });
	eq([t.v4.removed, L.playable(t.v4)], [false, true], 'a video that comes back is playable again');
	L.markUnplayable(lib, 'v3', 150, T0);
	eq([t.v3.embeddable, t.v3.removed, t.v3.playerError.code, L.playable(t.v3)], [false, false, 150, false], 'player error 150: embedding disabled');
	L.markUnplayable(lib, 'v8', 100, T0);
	eq([t.v8.removed, t.v8.removedReason, L.playable(t.v8)], [true, 'player', false], 'player error 100: removed');
	eq(L.clearPlayerErrors(lib).sort(), ['v3', 'v8'], 'clearPlayerErrors forgets what the player found');
	eq([L.playable(t.v3), L.playable(t.v8)], [true, true], 'and the tracks can be tried again');
	eq(L.markUnplayable(lib, 'nope', 100, T0), null, 'markUnplayable of an unknown id is null');

	// ---- aliases
	L.upsert(lib, [video('v9', 'Paper Lanterns Band - Harbor Lights', 'Paper Lanterns Band', {})], { playlistId: 'PL1', now: T0 });
	eq(t.v9.artistKey, 'paperlanternsband', 'before the alias: a different key');
	var changed = L.declareAlias(lib, 'Paper Lanterns Band', 'Paper Lanterns');
	eq([changed, t.v9.artist, t.v9.artistKey], [['v9'], 'Paper Lanterns', 'paperlanterns'], 'declareAlias merges the artist and reports the track');
	L.upsert(lib, [video('v10', 'paper lanterns band - Kindling', 'Paper Lanterns Band', {})], { playlistId: 'PL1', now: T0 });
	eq(t.v10.artist, 'Paper Lanterns', 'a track added later goes through the alias too');
	eq(L.declareAlias(lib, 'Paper Lanterns', 'Paper Lanterns'), [], 'an alias of itself changes nothing');
	L.declareAlias(lib, 'PL Band', 'Paper Lanterns Band');
	eq(lib.aliases[L.normArtist('PL Band')], 'Paper Lanterns', 'an alias of an alias points at the final name');
	L.removeAlias(lib, 'Paper Lanterns Band');
	eq(t.v9.artistKey, 'paperlanternsband', 'removeAlias undoes it');
	L.declareAlias(lib, 'Paper Lanterns Band', 'Paper Lanterns');

	// ---- channel rules
	L.upsert(lib, [video('v11', 'Harbor Lights / Tin Lighthouse Trio', 'slash channel', {}), video('v12', 'Mosaic / DJ Tessellate', 'slash channel', {})], { playlistId: 'PL1', now: T0 });
	eq([t.v11.artist, t.v12.artist], ['', ''], 'before the rule: unknown artists');
	changed = L.setChannelRule(lib, L.channelKey(t.v11), 'title-artist');
	eq([changed.sort(), t.v11.artist, t.v11.title, t.v12.artist, t.v11.guess.rule], [['v11', 'v12'], 'Tin Lighthouse Trio', 'Harbor Lights', 'DJ Tessellate', 'channel-rule'], 'setChannelRule re-reads every track of the channel');
	var chans = L.channels(lib);
	var sc = chans.filter(function (c) { return c.name === 'slash channel'; })[0];
	eq([sc.count, sc.unknown, sc.rule, sc.samples.length], [2, 0, 'title-artist', 2], 'channels() lists a channel with its rule and samples');
	L.setChannelRule(lib, L.channelKey(t.v11), null);
	eq(t.v11.artist, '', 'forgetting the rule brings the guess back');
	L.setChannelRule(lib, L.channelKey(t.v11), 'title-artist');

	// ---- genres: who wins
	eq([t.v4.genres, t.v4.genreSource], [['Pop'], 'youtube'], 'genres: YouTube topics by default');
	L.setArtistGenresFromMB(lib, 'paperlanterns', { genres: ['Dream pop', 'Shoegaze'], mbid: 'x', at: '2026-10-05T00:00:00Z' });
	eq([t.v4.genres, t.v4.genreSource], [['Dream pop', 'Shoegaze'], 'musicbrainz'], 'genres: MusicBrainz for the artist beats the topics');
	L.setGenres(lib, 'channel', L.channelKey(t.v4), ['Bedroom']);
	eq([t.v4.genres, t.v4.genreSource], [['Bedroom'], 'channel'], 'genres: the user\'s choice for the channel beats MusicBrainz');
	L.setGenres(lib, 'artist', 'paperlanterns', ['Indie']);
	eq([t.v4.genres, t.v4.genreSource, t.v9.genres], [['Indie'], 'artist', ['Indie']], 'genres: the user\'s choice for the artist beats the channel');
	eq([t.v1.genres, t.v1.genreSource], [['Indie', 'Rock'], 'track'], 'genres: the user\'s choice for the track beats everything');
	L.setGenres(lib, 'track', 'v4', ['Lullaby']);
	eq(t.v4.genres, ['Lullaby'], 'setGenres at track level');
	L.setGenres(lib, 'track', 'v4', null); L.setGenres(lib, 'artist', 'paperlanterns', null); L.setGenres(lib, 'channel', L.channelKey(t.v4), null); L.setArtistGenresFromMB(lib, 'paperlanterns', null);
	eq([t.v4.genres, t.v4.genreSource], [['Pop'], 'youtube'], 'taking every override back returns to the topics');

	// ---- duplicates
	L.edit(lib, 'v2', { artist: 'Paper Lanterns', title: 'Blue Signal' });
	var dups = L.duplicates(lib);
	eq(dups.length, 0, 'duplicates: the remaster, the plain upload and the live take differ in version');
	L.edit(lib, 'v1', { version: '' });
	dups = L.duplicates(lib);
	eq([dups.length, dups[0] && dups[0].ids.sort(), dups[0] && dups[0].title], [1, ['v1', 'v2'], 'Blue Signal'], 'duplicates: the same artist and title uploaded twice is reported');
	eq(L.duplicates(lib, { ignoreVersion: true })[0].ids.sort(), ['v1', 'v2', 'v3'], 'duplicates: with ignoreVersion the live take joins the group');
	eq(Object.keys(lib.tracks).length, 12, 'duplicates() removed nothing');
	eq(L.inSeveralPlaylists(lib).map(function (x) { return x.id; }).sort(), ['v1', 'v2'], 'inSeveralPlaylists: one video in two playlists');

	// ---- facets
	L.setPlaylist(lib, { id: 'PL1', title: 'Evening', count: 12 });
	L.setPlaylist(lib, { id: 'PL2', title: 'Liked videos', count: 2 });
	L.edit(lib, 'v5', { blocked: true });
	var f = L.facets(lib, null, T0);
	eq(f.total, 12, 'facets: total');
	eq([f.artist[0].key, f.artist[0].name, f.artist[0].count], ['paperlanterns', 'Paper Lanterns', 6], 'facets: the artist with most tracks first, under its commonest spelling');
	eq(f.artist.reduce(function (s, a) { return s + a.count; }, 0), 12, 'facets: artist counts add up to the total');
	var guessRows = f.artist.filter(function (a) { return a.guess; });
	ok(guessRows.length > 0 && guessRows.every(function (a) { return a.key.charAt(0) === '~' && / \(guess\)$/.test(a.name); }), 'facets: a guess is a row of its own, under its channel, labelled "(guess)" (' + guessRows.map(function (a) { return a.name; }).join(', ') + ')');
	ok(f.artist.filter(function (a) { return !a.guess && a.key; }).every(function (a) { return !/\(guess\)/.test(a.name); }), 'facets: the rows of sure artists carry no guess');
	eq(f.genre.filter(function (g) { return g.key === 'Jazz'; })[0].count, 2, 'facets: genre count');
	ok(f.genre.some(function (g) { return g.key === '' && g.name === 'Unknown genre'; }), 'facets: unknown genre is a row');
	eq(f.decade.map(function (d) { return d.key; }), ['1980s', '1990s', '2010s'], 'facets: decades in order');
	eq(f.playlist.map(function (p) { return [p.key, p.name, p.count]; }), [['PL1', 'Evening', 12], ['PL2', 'Liked videos', 2]], 'facets: playlists with their titles');
	eq(f.length.map(function (c) { return c.count; }), [1, 8, 1, 1, 1], 'facets: length classes');
	eq([f.neverPlayed, f.blocked, f.unplayable], [11, 1, 1], 'facets: never played, blocked, unplayable');
	eq(f.addedThisMonth, 12, 'facets: added this month');
	eq(L.facets(lib, null, T0 + 40 * DAY).addedThisMonth, 0, 'facets: next month nothing was added this month');
	eq(L.facets(lib, [t.v5, t.v6], T0).total, 2, 'facets: counts within a given list');
	eq(f.tag, [{ key: 'drive', name: 'drive', count: 1 }, { key: 'morning', name: 'morning', count: 1 }], 'facets: the tags the listener gave');

	// ---- search
	eq(L.search(lib, 'night suite').map(function (x) { return x.id; }).sort(), ['v5', 'v6'], 'search: all words must occur');
	eq(L.search(lib, 'LANTERNS twin').map(function (x) { return x.id; }), ['v4'], 'search: case does not matter, artist and title both count');
	eq(L.search(lib, 'jazz').length, 2, 'search: genres are searched');
	eq(L.search(lib, 'morning').map(function (x) { return x.id; }), ['v1'], 'search: tags are searched');
	eq(L.search(lib, 'zzzz'), [], 'search: no match');
	eq(L.search(lib, '   ').length, 12, 'search: an empty query returns everything');
	eq(L.search(lib, 'ember')[0].id, 'v7', 'search: a word of the title');
	L.upsert(lib, [video('v13', 'Las Polillas El' + cp(0xE9) + 'ctricas - Coraz' + cp(0xF3) + 'n de Ne' + cp(0xF3) + 'n', 'musicfan1987', {})], { playlistId: 'PL1', now: T0 });
	eq(L.search(lib, 'electricas corazon').map(function (x) { return x.id; }), ['v13'], 'search: accents do not matter');
	eq(L.search(lib, 'blue signal')[0].title, 'Blue Signal', 'search: an exact title comes first');

	// ---- stats
	var s = L.stats(lib, T0);
	eq([s.tracks, s.playlists, s.neverPlayed, s.played, s.plays, s.skips, s.blocked], [13, 2, 12, 1, 2, 1, 1], 'stats: counts');
	eq(s.playsHistogram.reduce(function (n, b) { return n + b.count; }, 0), 13, 'stats: the plays histogram covers every track');
	eq(s.playsHistogram.map(function (b) { return b.label + ':' + b.count; }), ['0:12', '1:0', '2-4:1', '5-9:0', '10-19:0', '20+:0'], 'stats: the plays histogram');
	eq(s.mostPlayed, ['v1'], 'stats: most played');
	// unknown: the soundtrack v7, and v8 and v13, plain dashes on strangers' channels that are guesses since 2026-10-05
	eq([s.unknownArtist, s.guessedArtist, s.notEmbeddable, s.staleCount], [3, 2, 1, 0], 'stats: unknown artists, guessed ones, not embeddable, stale');
	ok(s.durationSec > 0 && s.artists >= 3, 'stats: total length and artist count (' + s.artists + ')');
	eq(L.stats(lib, T0 + 45 * DAY).staleCount, 13, 'stats: after 45 days every track is stale');

	// ---- stale
	eq(L.stale(lib, T0 + 10 * DAY).length, 0, 'stale: nothing after 10 days');
	eq(L.stale(lib, T0 + 31 * DAY + DAY).length, 13, 'stale: everything after 32 days');
	eq(L.stale(lib, T0 + 10 * DAY, 5).length, 13, 'stale: the limit can be set');

	// ---- playlists
	var rec = L.reconcilePlaylist(lib, 'PL2', ['v1']);
	eq([rec.changed, rec.orphans, t.v2.playlists], [['v2'], [], ['PL1']], 'reconcilePlaylist: a track no longer listed leaves the playlist');
	rec = L.removePlaylist(lib, 'PL2', { dropOrphans: true });
	eq([rec.changed, rec.deleted, !!lib.playlists.PL2], [['v1'], [], false], 'removePlaylist: tracks in another playlist stay');
	L.upsert(lib, [video('v14', 'Hollow Compass - North by Nothing', 'musicfan1987', {}), video('v15', 'Hollow Compass - South by Something', 'musicfan1987', {})], { playlistId: 'PL3', now: T0 });
	L.edit(lib, 'v15', { rating: 3 });
	rec = L.removePlaylist(lib, 'PL3', { dropOrphans: true });
	eq([rec.deleted, !!lib.tracks.v14, !!lib.tracks.v15, rec.changed], [['v14'], false, true, ['v15']], 'removePlaylist with dropOrphans deletes an untouched track and keeps a rated one');

	// ---- storing
	var parts = JSON.parse(JSON.stringify(L.toParts(lib)));
	var back = L.fromParts(parts);
	eq(JSON.stringify(back), JSON.stringify(lib), 'toParts and fromParts survive JSON unchanged');
	eq(JSON.stringify(L.load(JSON.parse(JSON.stringify(lib)))), JSON.stringify(lib), 'load of a whole library survives JSON unchanged');
	var old = L.load({ tracks: [{ id: 'x1', raw: { title: 'A - B', channel: 'c' } }] });
	eq([old.tracks.x1.plays, old.tracks.x1.playlists, old.settings.minConfidence], [0, [], 0.6], 'load fills in fields an older record lacks');
	eq(Object.keys(L.load(null).tracks).length, 0, 'load of nothing is an empty library');
	lib.settings.minConfidence = 0.3;
	L.deriveAll(lib);
	eq(L.get(lib, 'v2').guess.confidence <= 0.5, true, 'settings.minConfidence is the threshold a guess must reach');

	// ---- bulk edits in linear time (second review, 2026-10-05)
	(function () {
		var Parse = require('./parse.js');
		function bigLib(n) {
			var b = L.create(), vids = [];
			for (var i = 0; i < n; i++) {
				var k = i % 40;
				vids.push(k < 10 ? video('b' + i, 'Song ' + i, 'Artist ' + k + ' - Topic')
					: k < 25 ? video('b' + i, 'Artist ' + k + ' - Song ' + i, 'Artist ' + k)
					: video('b' + i, 'Artist ' + (k % 10) + ' - Song ' + i + (i % 3 ? ' (Lyrics)' : ''), 'fan channel ' + (k % 4)));
			}
			L.upsert(b, vids, { playlistId: 'PB', now: T0 });
			return b;
		}
		function parses(fn) {
			var real = Parse.parse, count = 0;
			Parse.parse = function () { count++; return real.apply(null, arguments); };
			try { fn(); } finally { Parse.parse = real; }
			return count;
		}
		var big = bigLib(800), ids = Object.keys(big.tracks);
		var n1 = parses(function () { L.editMany(big, ids, { genres: ['Test'] }); });
		ok(n1 <= 2 * ids.length, 'editMany: setting genres on 800 tracks parses each about once, not once per track per track (' + n1 + ' parses)');
		ok(ids.every(function (id) { return big.tracks[id].genres.join() === 'Test'; }), 'editMany: every track got the genre');
		var n2 = parses(function () { L.editMany(big, ids, { rating: 4 }); L.editMany(big, ids, { blocked: true }); });
		eq([n2, ids.every(function (id) { return big.tracks[id].rating === 4 && big.tracks[id].blocked; })], [0, true], 'editMany: a rating or a block parses nothing');
		var n3 = parses(function () { L.edit(big, ids[0], { rating: 2 }); });
		eq(n3, 0, 'edit: a rating alone parses nothing');
		// the slices the page uses give what one call gives
		var a = bigLib(300), b = bigLib(300), aid = Object.keys(a.tracks);
		L.editMany(a, aid, { artist: 'Merged' });
		var known = L.knownArtists(b);
		for (var i = 0; i < aid.length; i += 70) L.editMany(b, aid.slice(i, i + 70), { artist: 'Merged' }, known);
		L.resolveArtists(a); L.resolveArtists(b);
		eq(JSON.stringify(b.tracks), JSON.stringify(a.tracks), 'editMany in slices with one known gives the same library as one call');
		// merging spellings: one pass, the same answer as one alias at a time
		var m1 = bigLib(400), m2 = bigLib(400), names = ['Artist 11', 'Artist 12', 'Artist 13', 'Artist 14'];
		var n4 = parses(function () { L.declareAliases(m1, names, 'Artist 10'); });
		names.forEach(function (nm) { L.declareAlias(m2, nm, 'Artist 10'); });
		ok(n4 <= 3 * 400, 'declareAliases: four spellings merged with about one parse per track (' + n4 + ')');
		eq(JSON.stringify(m1.tracks), JSON.stringify(m2.tracks), 'declareAliases gives what four declareAlias calls give');
		eq(L.facets(m1, null, T0).artist.filter(function (x) { return x.key === L.normArtist('Artist 10'); })[0].count, 50, 'declareAliases: the five spellings count as one artist');
		var all = L.create(); L.upsert(all, L.list(m2).map(function (t) { return video(t.id, t.raw.title, t.raw.channel); }), { now: T0 });
		names.forEach(function (nm) { all.aliases[L.normArtist(nm)] = 'Artist 10'; }); L.deriveAll(all);
		eq(L.list(all).map(function (t) { return t.artistKey; }), L.list(m1).map(function (t) { return t.artistKey; }), 'declareAliases derives every track a full pass would change');
		// what one correction teaches about a channel
		var lr = L.create();
		L.upsert(lr, [video('r1', 'Paper Lanterns - Blue Signal', 'tape shelf'), video('r2', 'Twin Rivers - Glass Orchard', 'other shelf'), video('r3', 'Blue Signal', 'harbor fan'), video('r4', 'Blue Signal - Ember', 'mixed shelf')], { now: T0 });
		eq([L.learnRule(lr, 'r1', 'Paper Lanterns'), L.learnRule(lr, 'r2', 'Glass Orchard'), L.learnRule(lr, 'r3', 'harbor fan'), L.learnRule(lr, 'r4', 'Mira Osei'), L.learnRule(lr, 'nope', 'X'), L.learnRule(lr, 'r1', '')],
			['artist-title', 'title-artist', 'channel', { artist: 'Mira Osei' }, null, null], 'learnRule: Artist - Title, Title - Artist, the channel itself, else a fixed artist');
		eq([lr.tracks.r1.artist, lr.tracks.r1.artistGuess, lr.tracks.r1.title], ['', 'tape shelf', 'Paper Lanterns - Blue Signal'], 'a guess shows the channel in place of the artist and the title as uploaded');
		L.edit(lr, 'r1', { artist: 'Paper Lanterns' });
		eq(lr.tracks.r1.artistGuess, '', 'a correction clears the guess mark');

		// The one-tap teaching reads only the channel's guesses (third review,
		// 2026-10-06): on a stranger's channel that mixes both orders, sure
		// readings and the user's corrections stay as they are.
		var tl = L.create();
		L.upsert(tl, [
			video('a1', 'Blue Signal - Hollow Compass', 'oldies shelf'),
			video('a2', 'Amber Kindling - Glass Orchard', 'oldies shelf'),
			video('a3', 'Paper Lanterns - Harbor Lights', 'oldies shelf'),
			video('a5', 'Twin Rivers - Paper Lanterns', 'oldies shelf'),
			video('a6', 'Winter Almanac - Neon Abacus', 'oldies shelf'),
			video('a7', 'Salt Tide - Quiet Ferrymen', 'oldies shelf'),
			video('b1', 'Morning Static', 'Paper Lanterns - Topic'),
			video('b2', 'Late Window', 'Glass Orchard - Topic')
		], { now: T0 });
		L.resolveArtists(tl);
		L.edit(tl, 'a7', { artist: 'Salt Tide', title: 'Quiet Ferrymen' });   // a correction, even a wrong one, is the user's
		var sure0 = ['a2', 'a3', 'a5'].map(function (id) { return tl.tracks[id].artist; });
		eq([sure0, tl.tracks.a1.artist, tl.tracks.a6.artist], [['Glass Orchard', 'Paper Lanterns', 'Paper Lanterns'], '', ''], 'teach: before, three sure tracks (through two Topic channels) and two guesses on the mixed channel');
		L.edit(tl, 'a1', { artist: 'Hollow Compass', title: 'Blue Signal' });
		var tp = L.teachPlan(tl, 'a1', 'Hollow Compass');
		eq([tp.rule, tp.ids, tp.conflicts], ['title-artist', ['a6'], 1], 'teachPlan: Title - Artist, for the one other guess only; one sure track (Paper Lanterns - Harbor Lights) is written the other way');
		var tres = L.teachChannel(tl, tp);
		eq([tres.ids, tl.tracks.a6.artist, tl.tracks.a6.title, tl.tracks.a6.guess.rule], [['a6'], 'Neon Abacus', 'Winter Almanac', 'channel-taught'], 'teachChannel: exactly the guess it counted changed');
		eq(['a2', 'a3', 'a5'].map(function (id) { return tl.tracks[id].artist; }), sure0, 'teachChannel: the sure readings are untouched (the review\'s "Let It Be" flip cannot happen)');
		eq([tl.tracks.a7.artist, tl.tracks.a1.artist], ['Salt Tide', 'Hollow Compass'], 'teachChannel: corrections are untouched');
		eq(L.knownArtists(tl)('Neon Abacus').sure, 0, 'a taught reading vouches for no other track');
		L.upsert(tl, [video('a8', 'Copper Engine - Saffron Circuit', 'oldies shelf')], { now: T0 });
		eq(tl.tracks.a8.artist, 'Saffron Circuit', 'a guess imported later on the taught channel is read the taught way');
		L.upsert(tl, [video('a9', 'Faded Echo - Paper Lanterns', 'oldies shelf'), video('a10', 'Glass Orchard - Open Meadow', 'oldies shelf')], { now: T0 });
		eq([tl.tracks.a9.artist, tl.tracks.a10.artist], ['Paper Lanterns', 'Glass Orchard'], 'a later upload whose artist the library knows for sure keeps that reading, whatever the taught order says');
		var back = L.setChannelRule(tl, tp.key, tres.prev);
		eq([tl.tracks.a6.artist, tl.tracks.a6.artistGuess, tl.tracks.a8.artist, tl.tracks.a1.artist, tl.tracks.a3.artist, tl.channelRules[tp.key]], ['', 'oldies shelf', '', 'Hollow Compass', 'Paper Lanterns', undefined], 'undo: one call puts every taught track back to a guess and forgets the rule; corrections and sure tracks stay (' + back.length + ' re-read)');

		// spreadKey: who a track counts as for the shuffle's spread
		eq([tl.tracks.a6.spreadKey, tl.tracks.a3.spreadKey, tl.tracks.a3.artistKey], ['~' + L.channelKey(tl.tracks.a6), 'paperlanterns', 'paperlanterns'], 'spreadKey: a sure artist\'s key, or "~" and the channel for a guess; artistKey stays empty for the guess');
	})();
});

// =============================================================================
// shuffle
// =============================================================================

// The 0.999 and 0.001 points of a chi-square distribution with df degrees of
// freedom (Wilson and Hilferty's approximation; z = 3.0902 is the normal
// 0.999 point).
function chiCritical(df, z) { var a = 2 / (9 * df); return df * Math.pow(1 - a + z * Math.sqrt(a), 3); }
function chiSquare(observed, expected) {
	var x = 0;
	for (var i = 0; i < observed.length; i++) x += (observed[i] - expected) * (observed[i] - expected) / expected;
	return x;
}
function isPermutation(order, idsList) { return order.length === idsList.length && order.slice().sort().join('|') === idsList.slice().sort().join('|'); }
function deepFreeze(o) {
	if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach(function (k) { deepFreeze(o[k]); }); }
	return o;
}
function tr(id, artistKey, more) {
	var t = { id: id, artistKey: artistKey, artist: artistKey, title: id, durationSec: 200, genres: [], playlists: [], addedAt: {}, plays: 0, skips: 0, rating: 0, lastPlayed: null, blocked: false, removed: false, embeddable: true, tags: [], decade: '', channelId: 'c', feat: [] };
	for (var k in (more || {})) t[k] = more[k];
	return t;
}

describe('shuffle', function () {
	var S = require('./shuffle.js');
	var Z = 3.0902, i, j, k;

	// ---- the random source
	var a = S.rng('2026-10-05'), b = S.rng('2026-10-05'), c = S.rng('2026-10-06');
	var sa = [], sb = [], sc = [];
	for (i = 0; i < 50; i++) { sa.push(a.u32()); sb.push(b.u32()); sc.push(c.u32()); }
	eq(sa, sb, 'rng: the same seed gives the same numbers');
	ok(sa.join() !== sc.join(), 'rng: another seed gives other numbers');
	eq(S.rng('2026-10-05').u32(), 2888689259, 'rng: the first number for "2026-10-05" is pinned, so stored seeds keep their orders');
	var inRange = true, r = S.rng('range');
	for (i = 0; i < 20000; i++) { var x = r(); if (!(x >= 0 && x < 1)) inRange = false; var n = r.int(7); if (!(n >= 0 && n < 7 && n === Math.floor(n))) inRange = false; }
	ok(inRange, 'rng: r() is in [0, 1) and int(7) is an integer in 0..6');
	eq([r.int(1), r.int(0), r.int(-3)], [0, 0, 0], 'rng: int of 1 or less is 0');
	var faces = [0, 0, 0, 0, 0, 0];
	r = S.rng('dice');
	for (i = 0; i < 60000; i++) faces[r.int(6)]++;
	var chiDice = chiSquare(faces, 10000);
	ok(chiDice < chiCritical(5, Z), 'rng: int(6) over 60,000 draws is uniform (chi-square ' + chiDice.toFixed(2) + ' < ' + chiCritical(5, Z).toFixed(2) + ', df 5, p 0.001)');
	var cr = S.cryptoRng(), okCrypto = true;
	for (i = 0; i < 2000; i++) { var y = cr.int(10); if (!(y >= 0 && y < 10)) okCrypto = false; }
	ok(okCrypto && cr() < 1, 'cryptoRng: works here and stays in range');
	ok(S.source().seed === null && S.source('x').seed === 'x', 'source: a seed gives rng, none gives the cryptographic source');
	ok(/^[0-9a-z]{6,10}$/.test(S.newSeed()) && S.newSeed() !== S.newSeed(), 'newSeed: short and different each time');

	// ---- true shuffle: a permutation
	var list = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
	var frozen = Object.freeze(list.slice());
	var sh = S.trueShuffle(frozen, S.rng('p'));
	ok(isPermutation(sh, list), 'trueShuffle returns every item once and leaves its input alone');
	eq(S.trueShuffle([], S.rng('p')), [], 'trueShuffle of nothing');
	eq(S.trueShuffle(['only'], S.rng('p')), ['only'], 'trueShuffle of one');
	eq(S.trueShuffle([tr('t1', 'a'), tr('t2', 'b')], S.rng('p')).sort(), ['t1', 't2'], 'trueShuffle takes tracks or ids');
	ok(isPermutation(S.trueShuffle(list, S.cryptoRng()), list), 'trueShuffle with the cryptographic source');

	// ---- true shuffle: uniform. Five tracks have 120 orders. Over 120,000
	// shuffles, each with its own seed, every order should come up about 1,000
	// times. The statistic must lie below the 0.999 point of chi-square with
	// 119 degrees of freedom (172.5), and above the 0.001 point (76.9): an
	// order count that is too even is as wrong as one that is too uneven.
	var five = ['1', '2', '3', '4', '5'], RUNS = 120000, counts = {}, hi = chiCritical(119, Z), lo = chiCritical(119, -Z);
	for (i = 0; i < RUNS; i++) { k = S.trueShuffle(five, S.rng('uniform-' + i)).join(''); counts[k] = (counts[k] || 0) + 1; }
	var obs = Object.keys(counts).map(function (key) { return counts[key]; });
	eq(obs.length, 120, 'uniformity: all 120 orders of five tracks occur');
	var chi = chiSquare(obs, RUNS / 120);
	ok(chi < hi && chi > lo, 'uniformity over 120,000 seeded runs: chi-square ' + chi.toFixed(1) + ' lies between ' + lo.toFixed(1) + ' and ' + hi.toFixed(1) + ' (df 119, p 0.001 each side)');
	// The same from one long stream.
	counts = {}; r = S.rng('one-stream');
	for (i = 0; i < RUNS; i++) { k = S.trueShuffle(five, r).join(''); counts[k] = (counts[k] || 0) + 1; }
	chi = chiSquare(Object.keys(counts).map(function (key) { return counts[key]; }), RUNS / 120);
	ok(Object.keys(counts).length === 120 && chi < hi && chi > lo, 'uniformity along one stream of 120,000 shuffles: chi-square ' + chi.toFixed(1));
	// A larger list: where each of 40 tracks lands. 40,000 runs, 1,000 expected
	// per (track, place) cell; 39 x 39 degrees of freedom.
	var forty = [], cells = [];
	for (i = 0; i < 40; i++) { forty.push('t' + i); for (j = 0; j < 40; j++) cells.push(0); }
	for (i = 0; i < 40000; i++) { var o = S.trueShuffle(forty, S.rng('places-' + i)); for (j = 0; j < 40; j++) cells[(+o[j].slice(1)) * 40 + j]++; }
	chi = chiSquare(cells, 1000);
	ok(chi < chiCritical(1521, Z) && chi > chiCritical(1521, -Z), 'uniformity of places, 40 tracks over 40,000 runs: chi-square ' + chi.toFixed(0) + ' lies between ' + chiCritical(1521, -Z).toFixed(0) + ' and ' + chiCritical(1521, Z).toFixed(0) + ' (df 1521)');
	// The test has teeth: the well-known wrong shuffle (swap each place with any
	// place) fails it.
	counts = {}; r = S.rng('naive');
	for (i = 0; i < RUNS; i++) {
		var w = five.slice();
		for (j = 0; j < 5; j++) { var m = r.int(5), tmp = w[j]; w[j] = w[m]; w[m] = tmp; }
		k = w.join(''); counts[k] = (counts[k] || 0) + 1;
	}
	chi = chiSquare(Object.keys(counts).map(function (key) { return counts[key]; }), RUNS / 120);
	ok(chi > hi * 10, 'the same test rejects the naive biased shuffle (chi-square ' + chi.toFixed(0) + ')');

	// ---- the bag
	var bagIds = [];
	for (i = 0; i < 23; i++) bagIds.push('b' + i);
	r = S.rng('bag');
	var bag = S.bagCreate(bagIds, r), seen = [], okBag = true, boundary = true, prev = null;
	for (i = 0; i < 23 * 4; i++) {
		// Every draw crosses a serialise and a restore, as a reload would.
		bag = JSON.parse(JSON.stringify(bag));
		var step = S.bagNext(deepFreeze(bag), r);
		if (step.id === prev) boundary = false;
		prev = step.id;
		seen.push(step.id);
		bag = step.bag;
		if (seen.length === 23) { if (!isPermutation(seen, bagIds)) okBag = false; seen = []; }
	}
	ok(okBag, 'bag: over four passes of 23 tracks, each pass plays every track exactly once, across a serialise and restore at every draw');
	ok(boundary, 'bag: a new pass never opens with the track that closed the last');
	eq(bag.cycle, 4, 'bag: the pass number counts up');
	var b0 = S.bagCreate(bagIds, S.rng('bag-a'));
	eq(S.bagCreate(bagIds, S.rng('bag-a')).order, b0.order, 'bag: the same seed fills the bag the same way');
	eq(S.bagNext(S.bagCreate([], r), r).id, null, 'bag: an empty bag gives null');
	var one = S.bagCreate(['solo'], r), ones = [];
	for (i = 0; i < 3; i++) { step = S.bagNext(one, r); ones.push(step.id); one = step.bag; }
	eq(ones, ['solo', 'solo', 'solo'], 'bag: a bag of one repeats it (nothing else to play)');
	var taken = S.bagTake(b0, 5, r);
	eq([taken.ids, taken.bag.pos, b0.pos], [b0.order.slice(0, 5), 5, 0], 'bagTake draws several and leaves the bag it was given alone');
	eq([S.bagPlayed(taken.bag), S.bagRemaining(taken.bag).length], [b0.order.slice(0, 5), 18], 'bagPlayed and bagRemaining');
	// adding: only among what is left, each slot equally likely
	var added = S.bagAdd(taken.bag, ['new1', 'new2', 'b3'], r);
	eq([added.order.length, added.order.slice(0, 5), added.pos], [25, b0.order.slice(0, 5), 5], 'bagAdd: new tracks go in after the played part; a known id is ignored');
	ok(added.order.indexOf('new1') >= 5 && added.order.indexOf('new2') >= 5, 'bagAdd: the new tracks are among what is left');
	eq(added.order.filter(function (id) { return id !== 'new1' && id !== 'new2'; }), b0.order, 'bagAdd: the tracks already there keep their order');
	var small = { v: 1, order: ['p1', 'p2', 'p3', 'p4', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6'], pos: 4, cycle: 1, last: 'p4' }, slots = [0, 0, 0, 0, 0, 0, 0];
	r = S.rng('insert');
	for (i = 0; i < 70000; i++) slots[S.bagAdd(small, ['n'], r).order.indexOf('n') - 4]++;
	chi = chiSquare(slots, 10000);
	ok(chi < chiCritical(6, Z), 'bagAdd: a new track lands in each of the 7 places left equally often (chi-square ' + chi.toFixed(2) + ' < ' + chiCritical(6, Z).toFixed(2) + ', df 6)');
	var removed = S.bagRemove(small, ['p2', 'r3', 'zzz']);
	eq([removed.order, removed.pos], [['p1', 'p3', 'p4', 'r1', 'r2', 'r4', 'r5', 'r6'], 3], 'bagRemove: takes tracks out and keeps the place');
	var sync = S.bagSync(small, ['p1', 'p2', 'p3', 'p4', 'r1', 'r2', 'x1', 'x2'], S.rng('sync'));
	eq([sync.added, sync.removed.sort(), sync.bag.pos], [['x1', 'x2'], ['r3', 'r4', 'r5', 'r6'], 4], 'bagSync: reports what came and went');
	ok(isPermutation(sync.bag.order, ['p1', 'p2', 'p3', 'p4', 'r1', 'r2', 'x1', 'x2']) && sync.bag.order.slice(0, 4).join() === 'p1,p2,p3,p4', 'bagSync: the bag holds exactly the selection, the played part untouched');
	// a track added mid-pass still plays exactly once in that pass
	r = S.rng('mid');
	bag = S.bagCreate(bagIds, r); seen = [];
	for (i = 0; i < 10; i++) { step = S.bagNext(bag, r); seen.push(step.id); bag = step.bag; }
	bag = S.bagAdd(bag, ['late1', 'late2', 'late3'], r);
	for (i = 0; i < 16; i++) { step = S.bagNext(bag, r); seen.push(step.id); bag = step.bag; }
	ok(isPermutation(seen, bagIds.concat(['late1', 'late2', 'late3'])) && bag.cycle === 1, 'bag: tracks added in the middle of a pass each play once before anything repeats');

	// a track that leaves the selection after it was drawn, and comes back, does not play again in that round (review, 2026-10-05)
	var replays = 0;
	for (i = 0; i < 2000; i++) {
		r = S.rng('back-' + i);
		bag = S.bagCreate(bagIds, r); seen = [];
		for (j = 0; j < 3; j++) { step = S.bagNext(bag, r); seen.push(step.id); bag = step.bag; }
		bag = S.bagSync(bag, bagIds.filter(function (id) { return id !== seen[0]; }), r).bag;
		bag = JSON.parse(JSON.stringify(bag));
		bag = S.bagSync(bag, bagIds, r).bag;
		while (bag.cycle === 1) { step = S.bagNext(bag, r); if (step.bag.cycle !== 1) break; seen.push(step.id); bag = step.bag; }
		if (!isPermutation(seen, bagIds)) replays++;
	}
	eq(replays, 0, 'bag: a drawn track that leaves and comes back in the same round is not drawn again in it (2,000 rounds)');
	r = S.rng('ret');
	bag = S.bagTake(S.bagCreate(bagIds, r), 5, r).bag;
	var back = S.bagReturn(bag, [bag.order[3], bag.order[4]], r);
	ok(back.pos === 3 && isPermutation(back.order, bagIds) && back.order.slice(3).indexOf(bag.order[3]) >= 0 && !back.gone, 'bagReturn: drawn but unheard tracks go back among what is still to come');
	// bagRunDraw: a run plays where its first part falls
	var runBag = { v: 1, order: ['x1', 'p3', 'x2', 'p1', 'x3', 'p2', 'x4'], pos: 2, cycle: 1, last: 'p3' };
	var put = S.bagRunDraw(runBag, ['p1', 'p2', 'p3']);
	eq([put.id, put.bag.order, put.bag.pos], [null, ['x1', 'x2', 'p1', 'p3', 'x3', 'p2', 'x4'], 1], 'bagRunDraw: a later part drawn first waits behind the first part');
	var lead = S.bagRunDraw({ v: 1, order: put.bag.order, pos: 3, cycle: 1, last: 'p1' }, ['p1', 'p2', 'p3']);
	eq([lead.id, lead.bag.order, lead.bag.pos], ['p1', ['x1', 'x2', 'p1', 'p2', 'p3', 'x3', 'x4'], 3], 'bagRunDraw: drawing the first part brings the others right behind it, in order');
	var runIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'p1', 'p2', 'p3'], members = ['p1', 'p2', 'p3'], okRuns = 0, firstAt = [0, 0, 0, 0, 0, 0, 0, 0, 0];
	for (i = 0; i < 9000; i++) {
		r = S.rng('rd-' + i);
		bag = S.bagCreate(runIds, r); var drawnIds = [];
		for (j = 0; j < 200 && drawnIds.length < runIds.length; j++) {
			step = S.bagNext(bag, r);
			var rd = S.bagRunDraw(step.bag, members);
			bag = rd.bag;
			if (rd.id != null) drawnIds.push(rd.id);
		}
		var at1 = drawnIds.indexOf('p1');
		if (isPermutation(drawnIds, runIds) && drawnIds[at1 + 1] === 'p2' && drawnIds[at1 + 2] === 'p3') okRuns++;
		firstAt[drawnIds.filter(function (id) { return id !== 'p2' && id !== 'p3'; }).indexOf('p1')]++;
	}
	eq(okRuns, 9000, 'bagRunDraw: over 9,000 rounds every track plays once and the run plays whole, in order');
	chi = 0; firstAt.forEach(function (c) { chi += (c - 1000) * (c - 1000) / 1000; });
	ok(chi < chiCritical(8, Z), 'bagRunDraw: the run lands in each of the 9 places among the 8 other tracks equally often (chi-square ' + chi.toFixed(2) + ', df 8)');
	// a run longer than MAX_RUN is shuffled like separate tracks
	var longRun = [];
	for (i = 1; i <= S.MAX_RUN + 1; i++) longRun.push({ id: 'e' + i, artistKey: 'x', run: { key: 'x|series', n: i } });
	eq(S.foldRuns(longRun).units.length, S.MAX_RUN + 1, 'foldRuns: a run of more than MAX_RUN (' + S.MAX_RUN + ') parts is not folded');


	// ---- spread shuffle
	function lib(counts, prefix) {
		var out = [];
		counts.forEach(function (n, ai) { for (var q = 0; q < n; q++) out.push(tr((prefix || 't') + ai + '_' + q, 'artist' + ai)); });
		return out;
	}
	var gen = S.rng('libraries'), feasible = 0, feasibleBad = 0, notPerm = 0, dominated = 0, dominatedBad = 0, worstExtra = 0;
	for (i = 0; i < 600; i++) {
		var nArtists = 1 + gen.int(12), cnts = [];
		for (j = 0; j < nArtists; j++) cnts.push(1 + gen.int(gen.int(4) === 0 ? 30 : 6));
		// Every third library gets one dominant artist: exactly half (rounded
		// up) of the tracks, the most that can still be separated; every fifth
		// gets one that is over the line.
		var others = cnts.reduce(function (s2, v) { return s2 + v; }, 0);
		if (i % 3 === 0) cnts.push(gen.int(2) ? others : others + 1);
		else if (i % 5 === 0) cnts.push(others + 2 + gen.int(10));
		var tracks = lib(cnts), byId = {};
		tracks.forEach(function (t2) { byId[t2.id] = t2; });
		var order = S.spreadShuffle(tracks, S.rng('spread-' + i));
		if (!isPermutation(order, tracks.map(function (t2) { return t2.id; }))) notPerm++;
		var reps = S.adjacentRepeats(order, byId);
		if (S.canSeparate(tracks)) { feasible++; if (reps) feasibleBad++; }
		else {
			dominated++;
			var big = Math.max.apply(null, cnts), rest = cnts.reduce(function (s2, v) { return s2 + v; }, 0) - big;
			if (reps !== big - rest - 1) { dominatedBad++; worstExtra = Math.max(worstExtra, reps - (big - rest - 1)); }
		}
	}
	eq(notPerm, 0, 'spread: every order is a permutation of its library (600 random libraries)');
	ok(feasible >= 400 && feasibleBad === 0, 'spread: no artist twice in a row in any of the ' + feasible + ' libraries where that is possible (a third of them with one artist at exactly half)');
	ok(dominated >= 50 && dominatedBad === 0, 'spread: in the ' + dominated + ' libraries where one artist has more than half, the repeats are the fewest possible (its count, minus the others, minus one)' + (dominatedBad ? ' [' + dominatedBad + ' wrong, worst ' + worstExtra + ' extra]' : ''));
	// exact boundary cases
	[[1], [2], [1, 1], [2, 1], [3, 2], [3, 3], [4, 3], [5, 5], [5, 4, 1], [10, 9], [10, 5, 5], [1, 1, 1, 1], [50, 49], [50, 25, 25]].forEach(function (cs) {
		var tracks = lib(cs), byId = {}, bad = 0;
		tracks.forEach(function (t2) { byId[t2.id] = t2; });
		for (var q = 0; q < 50; q++) if (S.adjacentRepeats(S.spreadShuffle(tracks, S.rng('edge-' + q)), byId) !== (cs.length === 1 ? cs[0] - 1 : 0)) bad++;
		ok(bad === 0, 'spread: counts ' + JSON.stringify(cs) + ' over 50 seeds: ' + (cs.length === 1 ? 'one artist, so only repeats' : 'never a repeat'));
	});
	// evenly spread: gaps between an artist's tracks stay near the ideal, and
	// much nearer than in a true shuffle
	var even = lib([20, 10, 10, 8, 8, 6, 6, 5, 5, 4, 4, 4, 3, 3, 2, 1, 1]), evenById = {}, total = even.length;
	even.forEach(function (t2) { evenById[t2.id] = t2; });
	function gapError(order) {
		var at = {}, err = 0, worst = 0;
		order.forEach(function (id, p) { var key = evenById[id].artistKey; (at[key] || (at[key] = [])).push(p); });
		Object.keys(at).forEach(function (key) {
			var ps = at[key], ideal = total / ps.length;
			for (var q = 1; q < ps.length; q++) { var g = ps[q] - ps[q - 1]; err += (g - ideal) * (g - ideal); worst = Math.max(worst, g / ideal); }
		});
		return { err: err, worst: worst };
	}
	var errSpread = 0, errTrue = 0, worstGap = 0;
	for (i = 0; i < 200; i++) {
		var gs = gapError(S.spreadShuffle(even, S.rng('even-' + i))), gt = gapError(S.trueShuffle(even, S.rng('even-' + i)));
		errSpread += gs.err; errTrue += gt.err; worstGap = Math.max(worstGap, gs.worst);
	}
	ok(errSpread < errTrue * 0.2, 'spread: the gaps between an artist\'s tracks are far more even than in a true shuffle (squared error ' + (100 * errSpread / errTrue).toFixed(1) + '% of the true shuffle\'s, 200 seeds)');
	ok(worstGap <= 2.5, 'spread: no gap between an artist\'s tracks is more than 2.5 times the even gap (worst ' + worstGap.toFixed(2) + ')');
	// still random
	var firsts = {}, orders = {};
	for (i = 0; i < 300; i++) { var so = S.spreadShuffle(even, S.rng('rand-' + i)); firsts[so[0]] = true; orders[so.join()] = true; }
	ok(Object.keys(orders).length === 300 && Object.keys(firsts).length > 40, 'spread: 300 seeds give 300 different orders, and ' + Object.keys(firsts).length + ' different opening tracks');
	eq(S.spreadShuffle(even, S.rng('same')), S.spreadShuffle(even, S.rng('same')), 'spread: the same seed gives the same order');
	var afterOk = true;
	for (i = 0; i < 100; i++) if (evenById[S.spreadShuffle(even, S.rng('after-' + i), { after: 'artist0' })[0]].artistKey === 'artist0') afterOk = false;
	ok(afterOk, 'spread: with `after`, the order never opens with the artist that just played');
	var unknowns = [tr('u1', '', { channelId: 'cA' }), tr('u2', '', { channelId: 'cA' }), tr('u3', '', { channelId: 'cB' }), tr('u4', '', { channelId: 'cB' })], uById = {};
	unknowns.forEach(function (t2) { uById[t2.id] = t2; });
	var uBad = 0;
	for (i = 0; i < 50; i++) if (S.adjacentRepeats(S.spreadShuffle(unknowns, S.rng('unk-' + i)), uById)) uBad++;
	eq(uBad, 0, 'spread: tracks without an artist are kept apart by channel');
	eq(S.spreadShuffle([], S.rng('e')), [], 'spread: nothing in, nothing out');

	// ---- selection
	var NOW = T0;
	var pool = [
		tr('s1', 'a', { genres: ['Rock'], decade: '1990s', playlists: ['P1'], durationSec: 100, plays: 0, tags: ['gym'] }),
		tr('s2', 'a', { genres: ['Rock', 'Pop'], decade: '2000s', playlists: ['P1', 'P2'], durationSec: 250, plays: 3, lastPlayed: new Date(NOW - 2 * 3600000).toISOString(), rating: 5 }),
		tr('s3', 'b', { genres: ['Jazz'], decade: '1990s', playlists: ['P2'], durationSec: 400, plays: 1, lastPlayed: new Date(NOW - 5 * DAY).toISOString(), rating: 2 }),
		tr('s4', 'b', { genres: [], decade: '', playlists: ['P2'], durationSec: 700, plays: 0, addedAt: { P2: new Date(NOW - 2 * DAY).toISOString() } }),
		tr('s5', '', { genres: ['Pop'], decade: '2010s', playlists: ['P3'], durationSec: 180, blocked: true }),
		tr('s6', 'c', { genres: ['Pop'], decade: '2010s', playlists: ['P3'], durationSec: 180, removed: true }),
		tr('s7', 'c', { genres: ['Pop'], decade: '2010s', playlists: ['P3'], durationSec: 180, embeddable: false }),
		tr('s8', '', { genres: ['Electronic'], decade: '2020s', playlists: ['P3'], durationSec: 0, title: 'Neon Coraz' + cp(0xF3) + 'n', channelId: 'c9', addedAt: { P3: new Date(NOW - 50 * DAY).toISOString() } })
	];
	function sel(s2) { return S.select(pool, s2, NOW).map(function (t2) { return t2.id; }); }
	eq(sel({}), ['s1', 's2', 's3', 's4', 's8'], 'select: blocked, removed and non-embeddable tracks are skipped by default');
	eq(sel({ includeBlocked: true, includeUnplayable: true }).length, 8, 'select: unless asked for');
	eq(sel({ artists: ['a'] }), ['s1', 's2'], 'select: one artist');
	eq(sel({ artists: ['a', 'b'] }), ['s1', 's2', 's3', 's4'], 'select: two artists are alternatives');
	eq(sel({ artists: [''] }), ['s8'], 'select: the unknown artist');
	eq(sel({ genres: ['Rock'], decades: ['1990s'] }), ['s1'], 'select: different facets must all hold');
	eq(sel({ genres: ['Pop', 'Jazz'] }), ['s2', 's3'], 'select: a track with several genres matches any of them');
	eq(sel({ genres: [''] }), ['s4'], 'select: unknown genre');
	eq(sel({ playlists: ['P2'], decades: ['1990s', '2000s'], artists: ['a', 'b'] }), ['s2', 's3'], 'select: three facets combined');
	eq(sel({ channels: ['c9'] }), ['s8'], 'select: a channel');
	eq(sel({ lengths: ['short', 'epic'] }), ['s1', 's4'], 'select: length classes');
	eq(sel({ tags: ['gym'] }), ['s1'], 'select: a tag');
	eq(sel({ not: { genres: ['Rock'], artists: [''] } }), ['s3', 's4'], 'select: leaving out a genre and an artist');
	eq(sel({ neverPlayed: true }), ['s1', 's4', 's8'], 'select: never played');
	eq(sel({ minRating: 4 }), ['s2'], 'select: a minimum rating');
	eq(sel({ minSec: 200, maxSec: 500 }), ['s2', 's3'], 'select: skip tracks shorter or longer than a length');
	eq(sel({ notPlayedWithinHours: 24 }), ['s1', 's3', 's4', 's8'], 'select: avoid what played in the last 24 hours');
	eq(sel({ notPlayedWithinHours: 24 * 7 }), ['s1', 's4', 's8'], 'select: or in the last week');
	eq(sel({ addedWithinDays: 7 }), ['s4'], 'select: added in the last 7 days');
	eq(sel({ addedThisMonth: true }), ['s4'], 'select: added this month');
	eq(sel({ text: 'neon corazon' }), ['s8'], 'select: text, accents ignored');
	eq(sel({ text: 'rock' }), ['s1', 's2'], 'select: text matches genres too');
	eq(sel({ artists: [], genres: [] }), ['s1', 's2', 's3', 's4', 's8'], 'select: an empty list is no restriction');

	// ---- fresh, newest
	var fr = [tr('f1', 'a', { plays: 2, lastPlayed: '2026-10-01T00:00:00Z' }), tr('f2', 'a', { plays: 0 }), tr('f3', 'b', { plays: 1, lastPlayed: '2026-09-01T00:00:00Z' }), tr('f4', 'b', { plays: 0 }), tr('f5', 'c', { plays: 9, lastPlayed: '2026-10-10T00:00:00Z' }), tr('f6', 'c', { plays: 0 })];
	var freshOk = true, neverOrders = {};
	for (i = 0; i < 60; i++) {
		var fo = S.freshFirst(fr, S.rng('fresh-' + i));
		if (fo.slice(0, 3).sort().join() !== 'f2,f4,f6' || fo.slice(3).join() !== 'f3,f1,f5') freshOk = false;
		neverOrders[fo.slice(0, 3).join()] = true;
	}
	ok(freshOk, 'fresh first: never played come first, then the rest from longest ago to most recent');
	eq(Object.keys(neverOrders).length, 6, 'fresh first: the never played come in every possible order across seeds');
	var nw = [tr('n1', 'a', { addedAt: { P: '2026-01-01T00:00:00Z' } }), tr('n2', 'a', { addedAt: { P: '2026-03-01T00:00:00Z', Q: '2026-09-01T00:00:00Z' } }), tr('n3', 'b', { addedAt: { P: '2026-05-01T00:00:00Z' } }), tr('n4', 'b', {})];
	eq(S.newestFirst(nw, S.rng('n')), ['n2', 'n3', 'n1', 'n4'], 'newest first: by the date last added; a track with no date comes last');

	// ---- favourites and neglected
	var two = [tr('heavy', 'a'), tr('light', 'b')], heavyFirst = 0;
	for (i = 0; i < 40000; i++) if (S.weightedOrder(two, S.rng('w-' + i), function (t2) { return t2.id === 'heavy' ? 3 : 1; })[0] === 'heavy') heavyFirst++;
	near(heavyFirst / 40000, 0.75, 0.01, 'weightedOrder: with weights 3 and 1 the heavier track comes first three times in four');
	var fav = [];
	for (i = 0; i < 30; i++) fav.push(tr('fv' + i, 'a' + (i % 5), { rating: i < 10 ? 5 : i < 20 ? 0 : 1, plays: i < 10 ? 8 : 1 }));
	var rankLoved = 0, rankDisliked = 0, rankNever = 0, rankWorn = 0;
	var neg = [];
	for (i = 0; i < 30; i++) neg.push(tr('ng' + i, 'a' + (i % 5), { plays: i < 15 ? 0 : 40, lastPlayed: i < 15 ? null : new Date(NOW - DAY).toISOString() }));
	for (i = 0; i < 300; i++) {
		S.favourites(fav, S.rng('fav-' + i)).forEach(function (id, p) { var q = +id.slice(2); if (q < 10) rankLoved += p; else if (q >= 20) rankDisliked += p; });
		S.neglected(neg, S.rng('neg-' + i), NOW).forEach(function (id, p) { var q = +id.slice(2); if (q < 15) rankNever += p; else rankWorn += p; });
	}
	ok(rankLoved / 10 < rankDisliked / 10 - 30 * 300 / 4, 'favourites: five-star, much-played tracks come far earlier on average than one-star ones (mean place ' + (rankLoved / 3000).toFixed(1) + ' against ' + (rankDisliked / 3000).toFixed(1) + ' of 30)');
	ok(rankNever / 15 < rankWorn / 15 - 30 * 300 / 4, 'neglected: never played tracks come far earlier on average than ones played 40 times (mean place ' + (rankNever / 4500).toFixed(1) + ' against ' + (rankWorn / 4500).toFixed(1) + ' of 30)');
	ok(isPermutation(S.favourites(fav, S.rng('x')), fav.map(function (t2) { return t2.id; })) && isPermutation(S.neglected(neg, S.rng('x'), NOW), neg.map(function (t2) { return t2.id; })), 'favourites and neglected still play everything once');
	ok(S.favouriteWeight(tr('x', 'a', { rating: 5 })) > S.favouriteWeight(tr('x', 'a', { rating: 3 })) && S.favouriteWeight(tr('x', 'a', { rating: 3, skips: 9 })) < S.favouriteWeight(tr('x', 'a', { rating: 3 })), 'favouriteWeight: more for a higher rating, less for skips');
	ok(S.neglectedWeight(tr('x', 'a', { plays: 0 }), NOW) > S.neglectedWeight(tr('x', 'a', { plays: 5, lastPlayed: new Date(NOW - DAY).toISOString() }), NOW), 'neglectedWeight: more for what was never played');

	// ---- rotation
	var rot = lib([5, 3, 3, 2, 1]), rotById = {};
	rot.forEach(function (t2) { rotById[t2.id] = t2; });
	var rotOk = true;
	for (i = 0; i < 40; i++) {
		var ro = S.artistRotation(rot, S.rng('rot-' + i));
		if (!isPermutation(ro, rot.map(function (t2) { return t2.id; }))) rotOk = false;
		var firstRound = ro.slice(0, 5).map(function (id) { return rotById[id].artistKey; });
		if (new Set(firstRound).size !== 5) rotOk = false;
		var second = ro.slice(5, 9).map(function (id) { return rotById[id].artistKey; });
		if (second.join() !== firstRound.filter(function (key) { return key !== 'artist4'; }).join()) rotOk = false;
	}
	ok(rotOk, 'artist rotation: the first round is one track from each of the five artists, the second round the same artists in the same turn (40 seeds)');
	var gb = [];
	for (i = 0; i < 31; i++) gb.push(tr('g' + i, 'a' + (i % 7), { genres: i < 12 ? ['Rock'] : i < 22 ? ['Jazz'] : i < 28 ? ['Pop'] : [] }));
	var gbOk = true;
	for (i = 0; i < 40; i++) {
		var blocks = S.genreBlockList(gb, S.rng('gb-' + i), { size: 4 }), flat = [];
		blocks.forEach(function (bl, bi) {
			flat = flat.concat(bl.ids);
			if (bl.ids.length > 4 || !bl.ids.length) gbOk = false;
			bl.ids.forEach(function (id) { var g2 = gb[+id.slice(1)].genres[0] || ''; if (g2 !== bl.genre) gbOk = false; });
			var leftOthers = blocks.slice(bi + 1).some(function (later) { return later.genre !== bl.genre; });
			if (bi + 1 < blocks.length && blocks[bi + 1].genre === bl.genre && leftOthers) gbOk = false;
		});
		if (!isPermutation(flat, gb.map(function (t2) { return t2.id; }))) gbOk = false;
		if (S.genreBlocks(gb, S.rng('gb-' + i), { size: 4 }).join() !== flat.join()) gbOk = false;
	}
	ok(gbOk, 'genre blocks: blocks of at most 4 tracks, one genre each, the genre changing from block to block while another has tracks, everything played once (40 seeds)');

	// ---- numbered runs
	var runTracks = [tr('r1', 'a'), tr('p2', 'b', { run: { key: 'b|suite', n: 2 } }), tr('r2', 'a'), tr('p1', 'b', { run: { key: 'b|suite', n: 1 } }), tr('r3', 'c'), tr('p3', 'b', { run: { key: 'b|suite', n: 3 } }), tr('q1', 'c', { run: { key: 'c|lonely', n: 1 } }), tr('r4', 'd')];
	var runById = {};
	runTracks.forEach(function (t2) { runById[t2.id] = t2; });
	eq(S.keepRuns(['r1', 'p2', 'r2', 'p1', 'r3', 'p3', 'q1', 'r4'], runById), ['r1', 'p1', 'p2', 'p3', 'r2', 'r3', 'q1', 'r4'], 'keepRuns: the parts play together, in order, where the first of them came up; a run of one stays put');
	var runsOk = true;
	for (i = 0; i < 50; i++) {
		var ko = S.keepRuns(S.trueShuffle(runTracks, S.rng('runs-' + i)), runById), at = ko.indexOf('p1');
		if (!isPermutation(ko, runTracks.map(function (t2) { return t2.id; })) || ko.slice(at, at + 3).join() !== 'p1,p2,p3') runsOk = false;
	}
	ok(runsOk, 'keepRuns: holds over 50 shuffles, and nothing is lost');
	var folded = S.foldRuns(runTracks);
	eq([folded.units.map(function (t2) { return t2.id; }), folded.members], [['r1', 'r2', 'p1', 'r3', 'q1', 'r4'], { p1: ['p1', 'p2', 'p3'] }], 'foldRuns: a run of three becomes one unit, its first part; a run of one is left alone');
	eq(S.unfoldRuns(['r4', 'p1', 'r1'], folded.members), ['r4', 'p1', 'p2', 'p3', 'r1'], 'unfoldRuns: the unit opens into its parts, in order');

	// ---- limits
	var lim = [], limById = {};
	for (i = 0; i < 20; i++) { lim.push(tr('l' + i, 'a' + i, { durationSec: 100 + i * 10 })); limById['l' + i] = lim[i]; }
	var limOrder = lim.map(function (t2) { return t2.id; });
	var cut = S.limit(limOrder, limById, { maxTracks: 5 });
	eq([cut.order.length, cut.stoppedBy, cut.seconds], [5, 'tracks', 600], 'limit: stop after 5 tracks');
	cut = S.limit(limOrder, limById, { maxMinutes: 10 });
	eq([cut.order.length, cut.seconds, cut.stoppedBy], [5, 600, 'minutes'], 'limit: stop after 10 minutes (five tracks fill them exactly)');
	cut = S.limit(limOrder, limById, { maxMinutes: 9.99 });
	eq([cut.order.length, cut.seconds <= 599.4], [4, true], 'limit: a track that would run over is not started');
	cut = S.limit(limOrder, limById, { maxMinutes: 30, maxTracks: 3 });
	eq([cut.order.length, cut.stoppedBy], [3, 'tracks'], 'limit: whichever comes first');
	cut = S.limit(limOrder, limById, {});
	eq([cut.order.length, cut.stoppedBy], [20, null], 'limit: none');
	eq(S.limit(limOrder, limById, { maxMinutes: 1 }).order, [], 'limit: nothing fits in one minute');

	// ---- build
	var world = [];
	for (i = 0; i < 60; i++) world.push(tr('w' + (i < 10 ? '0' : '') + i, 'artist' + (i % 9), { genres: [['Rock', 'Jazz', 'Pop'][i % 3]], decade: ['1990s', '2000s'][i % 2], durationSec: 120 + (i * 7) % 300, plays: i % 4, rating: i % 6, lastPlayed: i % 4 ? new Date(NOW - i * DAY).toISOString() : null, addedAt: { P: new Date(NOW - i * 3600000).toISOString() }, playlists: ['P'], blocked: i === 7 }));
	world[20].run = { key: 'k', n: 2 }; world[40].run = { key: 'k', n: 1 };
	var worldById = {};
	world.forEach(function (t2) { worldById[t2.id] = t2; });
	S.MODES.forEach(function (mode) {
		var plan = { mode: mode.key, seed: '2026-10-05', select: { genres: ['Rock', 'Jazz'] }, keepRuns: true, limits: { maxTracks: 25 }, blockSize: 3 };
		var one1 = S.build(world, plan, { now: NOW }), again = S.build(world.slice().reverse(), plan, { now: NOW }), other = S.build(world, Object.assign({}, plan, { seed: '2026-10-06' }), { now: NOW });
		var allIn = one1.order.every(function (id) { return worldById[id].genres[0] !== 'Pop' && !worldById[id].blocked; });
		ok(one1.order.length === 25 && one1.selected === 39 && allIn && new Set(one1.order).size === 25 && one1.stoppedBy === 'tracks' && one1.mode === mode.key,
			'build "' + mode.key + '": 25 of the 39 selected tracks, none repeated, none outside the selection');
		eq(again.order, one1.order, 'build "' + mode.key + '": the same seed gives the same order, whatever order the tracks arrive in');
		ok(mode.key === 'fresh' || mode.key === 'newest' || other.order.join() !== one1.order.join(), 'build "' + mode.key + '": another seed gives another order');
	});
	eq(S.build(world, { mode: 'true', seed: 'pin' }, { now: NOW }).order.slice(0, 5), S.build(world, { mode: 'true', seed: 'pin' }, { now: NOW }).order.slice(0, 5), 'build: a seed reproduces an order exactly');
	var full = S.build(world, { mode: 'spread', seed: 's', keepRuns: true }, { now: NOW });
	var at40 = full.order.indexOf('w40');
	ok(full.order.length === 59 && full.order[at40 + 1] === 'w20', 'build: keepRuns after a spread shuffle keeps part 1 and part 2 together, and the blocked track is out');
	var timed = S.build(world, { mode: 'true', seed: 't', limits: { maxMinutes: 30 } }, { now: NOW });
	ok(timed.seconds <= 1800 && timed.stoppedBy === 'minutes' && timed.order.length > 3, 'build: a 30-minute limit gives ' + timed.order.length + ' tracks, ' + timed.seconds + ' s');
	var unseeded1 = S.build(world, { mode: 'true' }, { now: NOW }), unseeded2 = S.build(world, { mode: 'true' }, { now: NOW });
	ok(unseeded1.seed === null && unseeded1.order.join() !== unseeded2.order.join() && isPermutation(unseeded1.order, unseeded2.order), 'build: without a seed the cryptographic source is used, and two builds differ');
	ok(S.build(world, { mode: 'genres', seed: 'g', blockSize: 5 }, { now: NOW }).blocks.length >= 12, 'build: genre blocks are reported');
	throws(function () { S.build(world, { mode: 'nonsense' }); }, 'build: an unknown mode throws');
	eq(S.build([], { mode: 'spread', seed: 'x' }).order, [], 'build: an empty library gives an empty order');
	eq(S.MODES.map(function (m2) { return m2.key; }), ['true', 'spread', 'fresh', 'newest', 'favourites', 'neglected', 'artists', 'genres', 'flow'], 'MODES lists the nine modes');
	// works apart, one version per song, mood flow
	(function () {
		var r = S.rng('apart'), ts = [];
		for (var i = 0; i < 60; i++) ts.push({ id: 't' + i, artistKey: 'a' + (i % 12), spreadKey: 'a' + (i % 12), work: i < 30 ? 'Work ' + (i % 3) : '', title: 'Song ' + i, genres: [i % 2 ? 'City pop' : 'Anison pop'], mood: S.MOOD_RING[i % 6], playlists: [], addedAt: {}, durationSec: 200 });
		var byId = {}; ts.forEach(function (t) { byId[t.id] = t; });
		function clashes(order) { var c = 0; for (var k = 1; k < order.length; k++) { var a = byId[order[k - 1]], b = byId[order[k]]; if (a.artistKey === b.artistKey || (a.work && a.work === b.work)) c++; } return c; }
		var raw = S.trueShuffle(ts, r), fixed = S.apart(raw, byId);
		ok(clashes(fixed) < clashes(raw) && clashes(fixed) <= 1, 'apart: neighbours sharing an artist or a work fall from ' + clashes(raw) + ' to ' + clashes(fixed));
		eq(fixed.slice().sort(), raw.slice().sort(), 'apart keeps the same tracks');
		var built = S.build(ts, { mode: 'spread', apart: true, seed: 'x' }, { now: 0 });
		ok(clashes(built.order) <= 1, 'build with apart: a spread keeps works apart too (' + clashes(built.order) + ' clashes)');
		var versions = [{ id: 'v1', title: 'Sakura', artistKey: 'hana', version: '' }, { id: 'v2', title: 'Sakura', artistKey: 'alo', origArtist: 'hana', version: 'orchestral' }, { id: 'v3', title: 'Sakura', artistKey: 'hana', version: 'live' }, { id: 'v4', title: 'Other', artistKey: 'hana', version: '' }];
		eq(S.songKey(versions[0]) === S.songKey(versions[1]) && S.songKey(versions[0]) !== S.songKey(versions[3]), true, 'songKey: a cover shares the key of its original');
		eq(S.oneVersion(versions, S.rng('v')).length, 2, 'oneVersion keeps one version of each song');
		var flow = S.flowOrder(ts, S.rng('flow'));
		eq(flow.slice().sort(), ts.map(function (t) { return t.id; }).sort(), 'flowOrder is a permutation');
		var jumps = 0, rjumps = 0;
		for (var k = 1; k < flow.length; k++) { jumps += S.moodDistance(byId[flow[k - 1]].mood, byId[flow[k]].mood); rjumps += S.moodDistance(byId[raw[k - 1]].mood, byId[raw[k]].mood); }
		ok(jumps < rjumps, 'mood flow moves between nearer moods than a true shuffle (' + jumps + ' against ' + rjumps + ')');
	})();


	// ---- signature
	eq(S.signature({ genres: ['Rock', 'Jazz'], artists: [] }), S.signature({ artists: undefined, genres: ['Jazz', 'Rock'], neverPlayed: false }), 'signature: the same choices in another order, with empty ones left out, give the same name');
	ok(S.signature({ genres: ['Rock'] }) !== S.signature({ genres: ['Jazz'] }) && S.signature(null) === S.signature({}), 'signature: different choices give different names');

	// ---- the queue reducer
	var q0 = S.queueInit();
	eq([q0.items, q0.index, S.current(q0)], [[], -1, null], 'queue: starts empty');
	var q = S.queue(q0, { type: 'load', ids: ['a', 'b', 'c', 'd'] });
	eq([q.items, q.index, S.current(q), S.upcoming(q)], [['a', 'b', 'c', 'd'], 0, 'a', ['b', 'c', 'd']], 'queue: load makes the first track current');
	q = S.queue(q, { type: 'next' });
	eq([S.current(q), q.history], ['b', ['a']], 'queue: next moves on and remembers what played');
	q = S.queue(q, { type: 'previous' });
	eq([S.current(q), q.history], ['a', ['a']], 'queue: previous goes one back');
	eq(S.queue(q, { type: 'previous' }), q, 'queue: previous at the start changes nothing');
	q = S.queue(q, { type: 'jump', index: 2 });
	eq([S.current(q), q.history], ['c', ['a', 'a']], 'queue: jump');
	eq(S.queue(q, { type: 'jump', index: 9 }), q, 'queue: a jump outside the queue changes nothing');
	q = S.queue(q, { type: 'playNext', ids: ['x', 'd'] });
	eq([q.items, S.current(q)], [['a', 'b', 'c', 'x', 'd'], 'c'], 'queue: playNext puts tracks right after the current one, moving one that was later');
	q = S.queue(q, { type: 'enqueue', ids: ['y'] });
	eq(q.items, ['a', 'b', 'c', 'x', 'd', 'y'], 'queue: enqueue adds at the end');
	q = S.queue(q, { type: 'remove', index: 0 });
	eq([q.items, q.index, S.current(q)], [['b', 'c', 'x', 'd', 'y'], 1, 'c'], 'queue: removing an earlier track keeps the current one current');
	q = S.queue(q, { type: 'remove', id: 'y' });
	eq([q.items, S.current(q)], [['b', 'c', 'x', 'd'], 'c'], 'queue: remove by id');
	q = S.queue(q, { type: 'remove', index: 1 });
	eq([q.items, q.index, S.current(q)], [['b', 'x', 'd'], 1, 'x'], 'queue: removing the current track makes the next one current');
	q = S.queue(q, { type: 'move', from: 2, to: 0 });
	eq([q.items, q.index, S.current(q)], [['d', 'b', 'x'], 2, 'x'], 'queue: moving a later track before the current one');
	q = S.queue(q, { type: 'move', from: 2, to: 0 });
	eq([q.items, q.index, S.current(q)], [['x', 'd', 'b'], 0, 'x'], 'queue: moving the current track');
	q = S.queue(q, { type: 'move', from: 1, to: 2 });
	eq([q.items, S.current(q)], [['x', 'b', 'd'], 'x'], 'queue: reordering what is to come');
	q = S.queue(S.queue(q, { type: 'next' }), { type: 'next' });
	eq([S.current(q), q.done], ['d', false], 'queue: the last track');
	q = S.queue(q, { type: 'next' });
	eq([S.current(q), q.done, q.index, q.history.slice(-3)], [null, true, 3, ['x', 'b', 'd']], 'queue: next past the end is done');
	eq(S.queue(q, { type: 'next' }), q, 'queue: next when done changes nothing');
	var q2 = S.queue(q, { type: 'enqueue', ids: ['z'] });
	eq([S.current(q2), q2.done], ['z', false], 'queue: a finished queue that gets a track has it as current');
	q = S.queue(q, { type: 'previous' });
	eq([S.current(q), q.done], ['d', false], 'queue: previous after the end returns to the last track');
	q = S.queue(S.queue(q, { type: 'setRepeat', value: true }), { type: 'next' });
	eq([S.current(q), q.done, q.repeat], ['x', false, true], 'queue: with repeat on, next after the last track is the first');
	q = S.queue(q, { type: 'clearUpcoming' });
	eq([q.items, S.current(q)], [['x'], 'x'], 'queue: clearUpcoming keeps the current track');
	q = S.queue(q, { type: 'remove', index: 0 });
	eq([q.items, q.index, q.done], [[], -1, false], 'queue: removing the only track empties the queue');
	eq(S.queue(q, { type: 'next' }), q, 'queue: next on an empty queue changes nothing');
	eq(S.queue(q, { type: 'whatever' }), q, 'queue: an unknown action changes nothing');
	eq(S.queue(undefined, { type: 'load', ids: ['a'], index: 5 }).index, 0, 'queue: a start index outside the list is clamped');
	eq(S.queue(q, { type: 'reset' }), S.queueInit(), 'queue: reset');
	// Random actions: the state stays sound and is never changed in place.
	var fz = S.rng('queue-fuzz'), st = S.queueInit(), sound = true, why = '', nextId = 0;
	for (i = 0; i < 4000 && sound; i++) {
		var kinds = ['next', 'next', 'next', 'previous', 'jump', 'playNext', 'enqueue', 'remove', 'move', 'clearUpcoming', 'setRepeat', 'load'];
		var kind = kinds[fz.int(kinds.length)], act = { type: kind };
		if (kind === 'jump' || kind === 'remove') act.index = fz.int(st.items.length + 2) - 1;
		if (kind === 'move') { act.from = fz.int(st.items.length + 1); act.to = fz.int(st.items.length + 1); }
		if (kind === 'playNext' || kind === 'enqueue') act.ids = ['id' + (nextId++), 'id' + (nextId++)];
		if (kind === 'load') { if (fz.int(10)) continue; act.ids = ['id' + (nextId++), 'id' + (nextId++), 'id' + (nextId++)]; }
		if (kind === 'setRepeat') act.value = !!fz.int(2);
		var before = deepFreeze(st), curBefore = S.current(before), out;
		try { out = S.queue(before, act); } catch (e) { sound = false; why = kind + ' threw ' + e.message; break; }
		if (!(out.index >= -1 && out.index <= out.items.length)) { sound = false; why = kind + ': index ' + out.index + ' of ' + out.items.length; }
		if (out.items.length && out.index === -1 && kind !== 'reset' && before.index !== -1) { sound = false; why = kind + ': lost its place'; }
		if (out.done !== (out.items.length > 0 && out.index >= out.items.length)) { sound = false; why = kind + ': done is ' + out.done + ' at ' + out.index + '/' + out.items.length; }
		if ((kind === 'move' || kind === 'playNext' || kind === 'enqueue' || kind === 'clearUpcoming' || kind === 'setRepeat') && curBefore != null && S.current(out) !== curBefore) { sound = false; why = kind + ': the current track changed'; }
		if (kind === 'move' && out.items.slice().sort().join() !== before.items.slice().sort().join()) { sound = false; why = 'move lost a track'; }
		if (new Set(out.items).size !== out.items.length) { sound = false; why = kind + ': a track is in the queue twice'; }
		if (out.history.length > 500) { sound = false; why = 'history too long'; }
		st = out;
	}
	ok(sound, 'queue: 4,000 random actions on frozen states keep the index in range, the current track current, and never change a state in place' + (why ? ' [' + why + ']' : ''));
});

// =============================================================================
// store (the in-memory twin; the IndexedDB half runs in a browser)
// =============================================================================

describe('store', async function () {
	var Store = require('./store.js');
	var L = require('./library.js');
	var s = Store.memory();
	eq([s.kind, s.fallback], ['memory', false], 'memory(): an in-memory store');

	// tracks, copied in and out
	var rec = { id: 't1', title: 'One', nested: { a: 1 } };
	await s.putTracks([rec, { id: 't2', title: 'Two' }]);
	rec.title = 'changed after put'; rec.nested.a = 99;
	var got = await s.getTracks();
	eq(got.map(function (t) { return [t.id, t.title]; }), [['t1', 'One'], ['t2', 'Two']], 'putTracks then getTracks; a record is copied on the way in');
	got[0].title = 'changed after get';
	eq((await s.getTracks())[0].title, 'One', 'a record is copied on the way out');
	await s.putTracks([{ id: 't1', title: 'One again' }]);
	eq((await s.getTracks()).length, 2, 'putting a known id replaces it');
	await s.deleteTracks(['t2', 'nope']);
	eq((await s.getTracks()).map(function (t) { return t.id; }), ['t1'], 'deleteTracks');
	await rejects(s.putTracks([{ title: 'no id' }]), null, 'a track without an id is refused');
	eq(await s.putTracks([]), 0, 'putTracks of nothing');
	await s.putPlaylists([{ id: 'PL1', title: 'Evening' }, { id: 'PL2', title: 'Liked' }]);
	await s.deletePlaylists(['PL2']);
	eq((await s.getPlaylists()).map(function (p) { return p.id; }), ['PL1'], 'playlists are stored and deleted the same way');

	// named records
	eq(await s.get('missing', 'fallback'), 'fallback', 'get: the fallback for a missing key');
	await s.set('plan', { mode: 'spread', select: { genres: ['Jazz'] } });
	await s.set('bag:abc', { order: ['a', 'b'], pos: 1 });
	await s.set('bag:def', { order: [], pos: 0 });
	await s.set('zero', 0); await s.set('no', false);
	eq(await s.get('plan'), { mode: 'spread', select: { genres: ['Jazz'] } }, 'set then get');
	eq([await s.get('zero', 5), await s.get('no', true)], [0, false], 'falsy values are values, not missing');
	eq(await s.keys('bag:'), ['bag:abc', 'bag:def'], 'keys by prefix');
	eq(Object.keys(await s.entries()).length, 5, 'entries: everything');
	await s.set('bag:def', null);
	await s.remove('zero');
	eq(await s.keys(), ['bag:abc', 'no', 'plan'], 'set(key, null) and remove(key) delete');

	// history
	await s.addHistory({ id: 't1', at: 1000, kind: 'play', listenedSec: 200 });
	await s.addHistory({ id: 't2', at: 2000, kind: 'skip', listenedSec: 4 });
	await s.addHistory({ id: 't1', at: 3000, kind: 'play', listenedSec: 199 });
	var h = await s.getHistory();
	eq(h.map(function (e) { return e.at; }), [3000, 2000, 1000], 'history: newest first');
	eq((await s.getHistory({ limit: 2 })).length, 2, 'history: a limit');
	eq((await s.getHistory({ since: 2000 })).map(function (e) { return e.at; }), [3000, 2000], 'history: since a time');

	// the library goes through unchanged
	var lib = L.create();
	L.upsert(lib, [video('v1', 'Paper Lanterns - Blue Signal', 'Paper Lanterns', {}), video('v2', 'Glass Orchard - Winter Almanac (Live)', 'x', {})], { playlistId: 'PL1', now: T0 });
	L.setPlaylist(lib, { id: 'PL1', title: 'Evening', count: 2 });
	L.declareAlias(lib, 'PL', 'Paper Lanterns'); L.edit(lib, 'v1', { rating: 4 });
	var s2 = Store.memory(), parts = L.toParts(lib);
	await s2.putTracks(parts.tracks); await s2.putPlaylists(parts.playlists); await s2.saveLibraryMeta(parts.meta);
	eq(JSON.stringify(L.fromParts(await s2.loadLibrary())), JSON.stringify(lib), 'a library saved in parts and loaded again is the same library');

	// export and import
	await s2.addHistory({ id: 'v1', at: 5, kind: 'play' });
	await s2.set('import:PL1', { phase: 'list' });
	var exported = await s2.exportAll(T0);
	eq([exported.format, exported.version, exported.exportedAt, exported.tracks.length, exported.playlists.length, exported.history.length], ['true-shuffle-export', 1, new Date(T0).toISOString(), 2, 1, 1], 'exportAll: one object with everything');
	ok(!('import:PL1' in exported.kv) && 'library' in exported.kv, 'exportAll: import progress is left out');
	var file = JSON.parse(JSON.stringify(exported));
	var s3 = Store.memory();
	await s3.putTracks([{ id: 'old', title: 'Old' }]); await s3.set('old-key', 1);
	var counts = await s3.importAll(file);
	eq([counts.mode, counts.tracks, counts.playlists, counts.history], ['replace', 2, 1, 1], 'importAll: counts what it read');
	var again = await s3.exportAll(T0);
	eq(JSON.stringify(again), JSON.stringify(exported), 'export, import into another store, export again: the same file');
	eq(JSON.stringify(L.fromParts(await s3.loadLibrary())), JSON.stringify(lib), 'and the same library');
	var s4 = Store.memory();
	await s4.putTracks([{ id: 'keep', title: 'Keep' }, { id: 'v1', title: 'to be replaced' }]); await s4.set('mine', 1);
	await s4.importAll(file, { mode: 'merge' });
	eq([(await s4.getTracks()).map(function (t) { return t.id; }).sort(), await s4.get('mine')], [['keep', 'v1', 'v2'], 1], 'importAll merge: what the file does not mention stays');
	eq((await s4.getTracks()).filter(function (t) { return t.id === 'v1'; })[0].artist, 'Paper Lanterns', 'importAll merge: the file wins where both have a record');
	var bad = [null, 'text', {}, { format: 'something-else' }, { format: 'true-shuffle-export', version: 99 }, { format: 'true-shuffle-export', version: 1, tracks: 'x' }, { format: 'true-shuffle-export', version: 1, tracks: [{ title: 'no id' }] }, { format: 'true-shuffle-export', version: 1, kv: [] }, { format: 'true-shuffle-export', version: 1, history: [5] }];
	var refused = 0;
	for (var i = 0; i < bad.length; i++) { try { await s4.importAll(bad[i]); } catch (e) { if (e.message && /export/.test(e.message)) refused++; } }
	eq(refused, bad.length, 'importAll refuses ' + bad.length + ' files that are not exports, each with a sentence');
	eq((await s4.getTracks()).length, 3, 'a refused import changes nothing');
	eq((await Store.memory().importAll({ format: 'true-shuffle-export', version: 1 })).tracks, 0, 'importAll: an empty export is fine');

	// counting and deleting
	eq(await s2.usage(), { tracks: 2, playlists: 1, kv: 2, history: 1, bytes: null }, 'usage: how much is stored');
	await s2.wipe();
	eq(await s2.usage(), { tracks: 0, playlists: 0, kv: 0, history: 0, bytes: null }, 'wipe: everything is gone and the store still works');
	await s2.clearHistory();
	await s2.destroy();
	await rejects(s2.getTracks(), null, 'destroy: the store cannot be used afterwards');

	// open
	var m = await Store.open({ memory: true });
	eq([m.kind, m.fallback], ['memory', false], 'open({ memory: true })');
	if (typeof indexedDB === 'undefined') {
		var fb = await Store.open();
		ok(fb.kind === 'memory' && fb.fallback === true && /IndexedDB/.test(fb.reason), 'open(): without IndexedDB it falls back to memory and says so');
		await rejects(Store.open({ fallback: false }), null, 'open({ fallback: false }) rejects instead');
	}
});

// =============================================================================
// player (the mock, and the controller)
// =============================================================================

function tickAll() { return new Promise(function (resolve) { setImmediate(resolve); }); }

describe('player', async function () {
	var P = require('./player.js');
	var S = require('./shuffle.js');
	var durations = { a: 100, b: 200, c: 50, d: 80, e: 60 };
	function mock(errors) { return P.create({ kind: 'mock', auto: false, durationOf: function (id) { return durations[id] || 30; }, errorOf: function (id) { return (errors || {})[id]; } }); }

	// ---- the mock player
	var p = mock({ bad: 150 }), log = [];
	['ready', 'playing', 'paused', 'ended', 'error'].forEach(function (name) { p.on(name, function (e) { log.push(name + (e && e.id ? ':' + e.id : '') + (e && e.code ? ':' + e.code : '')); }); });
	var times = [];
	p.on('time', function (e) { times.push(e.current); });
	eq([p.kind, p.state(), p.id()], ['mock', 'idle', null], 'mock: starts idle');
	await p.load('a');
	eq([p.state(), p.id(), p.time()], ['playing', 'a', { current: 0, duration: 100 }], 'mock: load starts the track');
	p.tick(30000); p.tick(30000);
	eq([p.time().current, times], [60, [30, 60]], 'mock: tick advances the clock and fires "time"');
	p.pause(); p.tick(10000);
	eq([p.state(), p.time().current], ['paused', 60], 'mock: a paused clock does not move');
	p.play(); p.seek(95); p.tick(4000);
	eq([p.state(), p.time().current], ['playing', 99], 'mock: play and seek');
	p.tick(5000);
	eq([p.state(), p.time().current], ['ended', 100], 'mock: the track ends at its length');
	await p.load('bad');
	eq(p.state(), 'error', 'mock: a track it was told to fail on fails');
	await p.load('b', { autoplay: false, startSec: 20 });
	eq([p.state(), p.time().current], ['paused', 20], 'mock: load without autoplay, from a start time');
	p.stop();
	eq([p.state(), p.id()], ['idle', null], 'mock: stop');
	eq(log, ['ready', 'playing:a', 'paused:a', 'playing:a', 'ended:a', 'error:bad:150', 'paused:b'], 'mock: the events, in order');
	var off = p.on('playing', function () { log.push('extra'); });
	off(); await p.load('c');
	ok(log.indexOf('extra') < 0, 'on() returns a function that unsubscribes');
	var first = p.load('a'), second = p.load('b');
	await first; await second;
	eq(p.id(), 'b', 'mock: a second load before the first answered wins');
	p.destroy();
	throws(function () { P.create({ kind: 'other' }); }, 'create: an unknown kind throws');
	eq([P.MIN_SIZE, P.UNPLAYABLE[100], P.UNPLAYABLE[101], P.UNPLAYABLE[150], P.UNPLAYABLE[5]], [200, 'removed', 'embedding', 'embedding', undefined], 'the YouTube constants: 200 px minimum; 100, 101 and 150 are the unplayable codes');
	ok(/^https:\/\/www\.youtube\.com\/iframe_api$/.test(P.IFRAME_API), 'the IFrame API address');
	var yt = P.create({ kind: 'youtube', container: null });
	eq([yt.kind, yt.state()], ['youtube', 'idle'], 'creating the YouTube player does nothing by itself (no document is needed until load)');
	var ytErr = null;
	yt.on('error', function (e) { ytErr = e.code; });
	await rejects(yt.load('whatever'), function (e) { return e.code === 'too-small'; }, 'the YouTube player refuses to build without a visible box of 200 by 200');
	eq(ytErr, 'too-small', 'and says so through the error event');

	// ---- the controller
	var clock = 1000000;
	function rig(errors, extra) {
		var player = mock(errors), events = { listened: [], unplayable: [], errors: [], changes: [], halts: [] };
		var opts = {
			player: player, now: function () { return clock; },
			onListened: function (id, info) { events.listened.push([id, info.completed, info.listenedSec]); },
			onUnplayable: function (id, code) { events.unplayable.push([id, code]); },
			onError: function (id, code) { events.errors.push([id, code]); },
			onChange: function (state, why) { events.changes.push(why); },
			onHalt: function (reason) { events.halts.push(reason); }
		};
		for (var k in (extra || {})) opts[k] = extra[k];
		return { player: player, events: events, c: P.controller(opts) };
	}
	async function playOut(r, id) { await tickAll(); if (r.player.id() !== id) throw new Error('expected ' + id + ' but ' + r.player.id() + ' is loaded'); r.player.tick(10000); r.player.finish(); await tickAll(); }

	var r = rig({ gone: 100, noembed: 150, alsono: 101 });
	r.c.load(['a', 'gone', 'b', 'noembed', 'alsono', 'c']);
	await tickAll();
	eq([r.c.current(), r.player.state()], ['a', 'playing'], 'controller: load starts the first track');
	await playOut(r, 'a');
	await tickAll();
	eq([r.c.current(), r.events.unplayable], ['b', [['gone', 100]]], 'controller: when a track ends the next starts; a removed track (100) is reported and skipped');
	await playOut(r, 'b');
	await tickAll(); await tickAll();
	eq([r.c.current(), r.events.unplayable], ['c', [['gone', 100], ['noembed', 150], ['alsono', 101]]], 'controller: 150 and 101 (embedding not allowed) are reported and skipped');
	r.player.tick(20000);
	r.c.next();
	await tickAll();
	eq([r.c.current(), r.c.state().done, r.events.halts], [null, true, ['finished']], 'controller: after the last track the queue is done');
	eq(r.events.listened, [['a', true, 100], ['b', true, 200], ['c', false, 20]], 'controller: reports each listen: completed tracks in full, a track skipped by hand with the seconds heard');
	eq(r.events.listened.filter(function (l) { return l[0] === 'gone'; }).length, 0, 'controller: a track that never played is neither a play nor a skip');
	ok(r.events.changes.indexOf('ended') >= 0 && r.events.changes.indexOf('skip') >= 0 && r.events.changes[0] === 'load', 'controller: onChange says why the queue changed');

	// errors that are not the track's fault stop after a few, instead of burning the queue
	var many = []; for (var i = 0; i < 40; i++) many.push('x' + i);
	var allBad = {}; many.forEach(function (id) { allBad[id] = 5; });
	r = rig(allBad);
	r.c.load(many);
	for (i = 0; i < 20; i++) await tickAll();
	eq([r.events.errors.length, r.events.halts, r.c.state().index], [5, ['errors'], 4], 'controller: five failures in a row and it stops, with 35 tracks untouched');
	eq(r.events.unplayable, [], 'controller: error 5 does not mark a track as unplayable');

	// by hand: previous, jump, playNext, remove, move
	r = rig();
	r.c.load(['a', 'b', 'c', 'd']);
	await tickAll();
	r.c.jump(2); await tickAll();
	eq([r.c.current(), r.player.id()], ['c', 'c'], 'controller: jump');
	r.c.previous(); await tickAll();
	eq(r.player.id(), 'b', 'controller: previous');
	r.c.playNext('d'); r.c.move(3, 0);
	eq([r.c.state().items, r.c.current(), r.player.id()], [['c', 'a', 'b', 'd'], 'b', 'b'], 'controller: playNext and move change the queue, not what is playing');
	r.c.remove('b'); await tickAll();
	eq([r.c.state().items, r.player.id()], [['c', 'a', 'd'], 'd'], 'controller: removing the current track starts the one after it');
	r.c.pause(); eq(r.player.state(), 'paused', 'controller: pause');
	r.c.toggle(); eq(r.player.state(), 'playing', 'controller: toggle resumes');
	r.c.destroy();

	// repeat with one track
	r = rig();
	r.c.load(['e']); r.c.setRepeat(true);
	await playOut(r, 'e'); await playOut(r, 'e');
	await tickAll();
	eq([r.events.listened.length, r.player.state(), r.c.current()], [2, 'playing', 'e'], 'controller: with repeat on, a queue of one starts again when it ends');

	// an endless true shuffle: the queue draws from a bag when it runs low
	var rand = S.rng('endless'), bag = S.bagCreate(['a', 'b', 'c', 'd', 'e'], rand), heard = [];
	r = rig(null, {
		onNeedMore: function () { var t = S.bagTake(bag, 2, rand); bag = t.bag; return t.ids; },
		onListened: function (id) { heard.push(id); }
	});
	var start = S.bagTake(bag, 2, rand); bag = start.bag;
	r.c.load(start.ids);
	for (i = 0; i < 15; i++) { await tickAll(); r.player.finish(); }
	await tickAll();
	var passes = [heard.slice(0, 5), heard.slice(5, 10), heard.slice(10, 15)];
	ok(heard.length === 15 && passes.every(function (pass) { return isPermutation(pass, ['a', 'b', 'c', 'd', 'e']); }), 'controller with a bag: 15 tracks played without stopping, each pass of five playing every track once');
	eq(r.events.halts, [], 'controller with a bag: it never runs dry');

	// a restored queue: nothing plays until resume()
	var restored = S.queue(S.queueInit(), { type: 'load', ids: ['a', 'b', 'c'], index: 1 });
	var pl = mock();
	var c2 = P.controller({ player: pl, state: JSON.parse(JSON.stringify(restored)) });
	await tickAll();
	eq([pl.state(), c2.current()], ['idle', 'b'], 'controller: a queue restored from storage does not start by itself');
	c2.resume(); await tickAll();
	eq([pl.state(), pl.id()], ['playing', 'b'], 'controller: resume() starts the restored current track');
});

// =============================================================================
// demo
// =============================================================================

describe('demo', function () {
	var Demo = require('./demo.js');
	var L = require('./library.js');
	var S = require('./shuffle.js');
	var d = Demo.build(T0), lib = d.lib, tracks = L.list(lib);
	eq(JSON.stringify(Demo.build(T0).lib), JSON.stringify(lib), 'build: the same moment gives the same library');
	ok(/invented/.test(Demo.LABEL) && d.label === Demo.LABEL, 'the label says the library is invented');
	eq(tracks.length, 160, '160 tracks');
	ok(tracks.every(function (t) { return /^demo-\d{3}$/.test(t.id); }), 'every id is "demo-NNN"');
	ok(tracks.every(function (t) { return !/^[A-Za-z0-9_-]{11}$/.test(t.id); }), 'no id has the shape of a YouTube video id');
	eq(Object.keys(lib.playlists).length, 4, 'four playlists');
	ok(tracks.every(function (t) { return t.playlists.length >= 1; }), 'every track is in a playlist');
	var f = L.facets(lib, null, T0);
	var expected = { 'Paper Lanterns': 26, 'Glass Orchard': 16, 'Neon Abacus': 12, 'Saffron Circuit': 10, 'Quiet Ferrymen': 10, 'Tin Lighthouse Trio': 12, 'DJ Tessellate': 10, 'Marrow & Pine': 9, 'The Velvet Algorithms': 9, 'Kumori Station': 10, 'Aldric Vessant': 6 };
	var wrong = [];
	Object.keys(expected).forEach(function (name) {
		var row = f.artist.filter(function (a) { return a.key === L.normArtist(name); })[0];
		if (!row || row.count !== expected[name]) wrong.push(name + ': ' + (row ? row.count : 'missing'));
	});
	eq(wrong, [], 'the parser finds every artist of the demo that something vouches for, with all of that artist\'s tracks (11 checked)');
	eq(f.artist.filter(function (a) { return a.key === L.normArtist('Las Polillas El' + cp(0xE9) + 'ctricas'); })[0].count, 8, 'an artist with an accent in the name');
	eq(f.artist.filter(function (a) { return !a.key || a.guess; }).reduce(function (s, a) { return s + a.count; }, 0), 22, 'twenty-two tracks have no sure artist: six of a soundtrack, four on a channel with an ambiguous format, twelve on a stranger\'s channel');
	eq(f.artist.filter(function (a) { return a.guess && a.name === 'cassette drawer (guess)'; }).map(function (a) { return a.count; }), [12], 'the facets list the stranger\'s twelve guesses under the channel, labelled as a guess');
	var porch = tracks.filter(function (t) { return t.channel === 'cassette drawer'; });
	eq([porch.length, porch.every(function (t) { return !t.artist && t.artistGuess === 'cassette drawer' && t.guess.artist === 'Hollow Compass'; })], [12, true], 'the stranger\'s twelve uploads are guesses: the channel shown as the artist, the parser\'s reading kept');
	var probe2 = L.load(JSON.parse(JSON.stringify(lib)));
	var learnt = L.learnRule(probe2, porch[0].id, 'Hollow Compass');
	L.setChannelRule(probe2, L.channelKey(porch[0]), learnt);
	eq([learnt, L.list(probe2).filter(function (t) { return t.artist === 'Hollow Compass'; }).length], ['artist-title', 12], 'confirming one of them learns Artist - Title for the channel, which names all twelve');
	var slashKey = L.channelKey(tracks.filter(function (t) { return t.channel === 'aozora uploads'; })[0]);
	var before = JSON.stringify(lib);
	var probe = L.load(JSON.parse(before));
	eq(L.setChannelRule(probe, slashKey, 'title-artist').length, 4, 'teaching that channel "Title / Artist" names the artist of its four tracks');
	eq(L.facets(probe, null, T0).artist.filter(function (a) { return a.name === 'Mizuiro Parade'; })[0].count, 4, 'and the artist appears in the facets');
	ok(f.genre.filter(function (g) { return g.key; }).length >= 10, 'at least ten genres (' + f.genre.filter(function (g) { return g.key; }).map(function (g) { return g.key; }).join(', ') + ')');
	ok(f.decade.filter(function (x) { return x.key; }).length >= 6, 'at least six decades (' + f.decade.map(function (x) { return x.key; }).join(', ') + ')');
	ok(f.neverPlayed >= 40 && f.neverPlayed <= 80, 'a good share was never played (' + f.neverPlayed + ')');
	ok(f.addedThisMonth >= 5, 'some tracks were added this month (' + f.addedThisMonth + ')');
	ok(tracks.filter(function (t) { return t.rating > 0; }).length >= 40, 'some tracks are rated');
	eq([f.blocked, f.unplayable], [2, 1], 'two blocked tracks, one YouTube reports as not embeddable');
	eq(Object.keys(d.errors).map(function (id) { return d.errors[id]; }).sort(), [100, 101, 150], 'three tracks the mock player will refuse: 100, 101 and 150');
	ok(Object.keys(d.errors).every(function (id) { return lib.tracks[id] && L.playable(lib.tracks[id]); }), 'the library does not know yet that those three will fail');
	eq(L.duplicates(lib).length, 2, 'two songs are in the library twice');
	var runs = {};
	tracks.forEach(function (t) { if (t.run) runs[t.run.key] = (runs[t.run.key] || 0) + 1; });
	eq(Object.keys(runs).map(function (k) { return runs[k]; }).sort(), [3, 3, 3], 'three numbered runs: a suite in three parts, two works in three movements (the soundtrack of six is not a run)');
	ok(tracks.some(function (t) { return t.version === 'live'; }) && tracks.some(function (t) { return t.version === 'remix'; }) && tracks.some(function (t) { return t.version === 'remaster'; }) && tracks.some(function (t) { return t.feat.length; }), 'live takes, a remix, remasters and guest credits are present');
	var byId = {};
	tracks.forEach(function (t) { byId[t.id] = t; });
	S.MODES.forEach(function (m) {
		var out = S.build(tracks, { mode: m.key, seed: 'demo', keepRuns: true }, { now: T0 });
		ok(out.order.length === 157 && new Set(out.order).size === 157, 'mode "' + m.key + '" orders the 157 playable, unblocked tracks');
	});
	var spreadBad = 0;
	for (var i = 0; i < 50; i++) spreadBad += S.adjacentRepeats(S.build(tracks, { mode: 'spread', seed: 'demo-' + i }, { now: T0 }).order, byId);
	eq(spreadBad, 0, 'spread shuffle of the demo never plays an artist twice in a row (50 seeds), although one artist has 26 tracks');
	var insideRuns = 0, outsideRuns = 0;
	for (i = 0; i < 50; i++) {
		var ko = S.build(tracks, { mode: 'spread', seed: 'demo-' + i, keepRuns: true }, { now: T0 }).order;
		for (var q = 1; q < ko.length; q++) {
			var a1 = byId[ko[q - 1]], a2 = byId[ko[q]];
			if (S.artistKey(a1) !== S.artistKey(a2)) continue;
			if (a1.run && a2.run && a1.run.key === a2.run.key && a2.run.n > a1.run.n) insideRuns++; else outsideRuns++;
		}
	}
	eq([insideRuns, outsideRuns], [50 * 6, 0], 'with keepRuns the only neighbours by one artist are consecutive parts of a run (6 per order: 2 + 2 + 2), never anything else');
	var ostLib = L.create(), ostVideos = [];
	for (i = 1; i <= 25; i++) ostVideos.push(video('o' + i, 'Starfall Odyssey OST - ' + (i < 10 ? '0' : '') + i + ' - Track ' + i, 'pixel archive'));
	for (i = 1; i <= 25; i++) ostVideos.push(video('s' + i, 'Band' + i + ' - Song ' + i, 'Band' + i));
	L.upsert(ostLib, ostVideos, { now: T0 });
	var longest = {};
	['spread', 'artists', 'favourites', 'fresh', 'true'].forEach(function (mode) {
		var o = S.build(L.list(ostLib), { mode: mode, seed: 'ost', keepRuns: true }, { now: T0 }).order, cur = 0, most = 0;
		o.forEach(function (id) { if (id.charAt(0) === 'o') { cur++; most = Math.max(most, cur); } else cur = 0; });
		longest[mode] = most;
	});
	ok(['spread', 'favourites', 'fresh', 'true'].every(function (m) { return longest[m] <= 8; }), 'keepRuns: a 25-track soundtrack no longer plays as one block (longest stretch ' + JSON.stringify(longest) + '; artist rotation ends on the one group left once the 25 singles are used, as rotation must)');
	var rot = S.build(L.list(ostLib), { mode: 'artists', seed: 'ost', keepRuns: true }, { now: T0 }).order.slice(0, 26);
	eq(rot.filter(function (id) { return id.charAt(0) === 'o'; }).length, 1, 'keepRuns: artist rotation plays the soundtrack channel once per round, like any artist');
	ok(longest.spread === 1, 'keepRuns: spread shuffle keeps the 25 soundtrack tracks (one channel, no artist) apart');
	var trueRepeats = 0;
	for (i = 0; i < 50; i++) trueRepeats += S.adjacentRepeats(S.build(tracks, { mode: 'true', seed: 'demo-' + i }, { now: T0 }).order, byId);
	ok(trueRepeats > 200, 'while a true shuffle does, about ' + Math.round(trueRepeats / 50) + ' times per pass, which is what makes the difference visible');
	var jazz = S.build(tracks, { mode: 'true', seed: 'x', select: { genres: ['Jazz arrangement'], decades: ['1970s'] } }, { now: T0 });
	ok(jazz.order.length >= 3 && jazz.order.every(function (id) { return byId[id].genres.indexOf('Jazz arrangement') >= 0 && byId[id].decade === '1970s'; }), 'a selection by genre and decade finds tracks (' + jazz.order.length + ' jazz tracks of the 1970s)');
	eq(Demo.videos(T0).length, 160, 'videos(): the raw records');
	ok(Demo.ARTISTS.length >= 12, 'about a dozen artists (' + Demo.ARTISTS.length + ')');
});

// =============================================================================
// yt (sign-in helpers, the Data API client, the import: against the fake)
// =============================================================================

function fakeStorage() {
	var m = {};
	return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; }, dump: function () { return m; } };
}
function fakeLocation(href) {
	var u = new URL(href);
	return { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, hostname: u.hostname, assigned: null, assign: function (to) { this.assigned = to; } };
}
function fakeHistory(loc) {
	return { replaced: [], replaceState: function (a, b, to) { this.replaced.push(to); var u = new URL(to, loc.origin); loc.pathname = u.pathname; loc.search = u.search; loc.hash = u.hash; } };
}

describe('yt', async function () {
	var Y = require('./yt.js');
	var L = require('./library.js');
	var Store = require('./store.js');
	var P = require('./player.js');
	var i;

	// ---- the pure parts of the sign-in
	eq(Y.redirectUriFor({ origin: 'https://nietztein.github.io', pathname: '/misc/101-true-shuffle/' }), 'https://nietztein.github.io/misc/101-true-shuffle/', 'redirectUriFor: the page\'s own address');
	eq(Y.redirectUriFor({ origin: 'https://nietztein.github.io', pathname: '/misc/101-true-shuffle/index.html', search: '?demo=1', hash: '#x' }), 'https://nietztein.github.io/misc/101-true-shuffle/', 'redirectUriFor: without index.html, query or fragment');
	var au = new URL(Y.buildAuthUrl({ clientId: 'abc.apps.googleusercontent.com', redirectUri: 'https://nietztein.github.io/misc/101-true-shuffle/', state: 's1' }));
	eq([au.origin + au.pathname, au.searchParams.get('client_id'), au.searchParams.get('redirect_uri'), au.searchParams.get('response_type'), au.searchParams.get('scope'), au.searchParams.get('state')],
		['https://accounts.google.com/o/oauth2/v2/auth', 'abc.apps.googleusercontent.com', 'https://nietztein.github.io/misc/101-true-shuffle/', 'token', 'https://www.googleapis.com/auth/youtube.readonly', 's1'],
		'buildAuthUrl: Google\'s endpoint, response_type=token, the read-only YouTube scope, the state');
	ok(!au.searchParams.has('prompt') && new URL(Y.buildAuthUrl({ clientId: 'a', redirectUri: 'b', state: 'c', prompt: 'consent' })).searchParams.get('prompt') === 'consent', 'buildAuthUrl: prompt only when asked');
	eq(Y.parseAuthResponse('#access_token=tok&token_type=Bearer&expires_in=3599&scope=' + encodeURIComponent(Y.SCOPE) + '&state=s1'), { access_token: 'tok', token_type: 'Bearer', expires_in: '3599', scope: Y.SCOPE, state: 's1' }, 'parseAuthResponse: the fields of the fragment');
	eq([Y.parseAuthResponse(''), Y.parseAuthResponse('#/misc'), Y.parseAuthResponse('#help'), Y.parseAuthResponse(null)], [null, null, null, null], 'parseAuthResponse: an ordinary fragment is not a sign-in answer');
	var good = { access_token: 'tok', expires_in: '3599', scope: Y.SCOPE, state: 's1' };
	var chk = Y.checkAuthResponse(good, 's1', 1000);
	eq([chk.ok, chk.token.accessToken, chk.token.expiresAt], [true, 'tok', 1000 + 3599000], 'checkAuthResponse: a good answer gives the token and when it ends');
	eq(Y.checkAuthResponse(good, 'other', 1000).error.code, 'state', 'checkAuthResponse: another state is refused');
	eq(Y.checkAuthResponse(good, null, 1000).error.code, 'state', 'checkAuthResponse: an answer nobody asked for is refused');
	eq(Y.checkAuthResponse({ error: 'access_denied', state: 's1' }, 's1', 1000).error.code, 'denied', 'checkAuthResponse: access denied');
	eq(Y.checkAuthResponse({ access_token: 'tok', scope: 'openid email', state: 's1' }, 's1', 1000).error.code, 'scope', 'checkAuthResponse: without the YouTube scope there is nothing to read');
	eq(Y.checkAuthResponse({ state: 's1' }, 's1', 1000).error.code, 'state', 'checkAuthResponse: no token');
	ok(/^[0-9a-f]{32}$/.test(Y.randomState()) && Y.randomState() !== Y.randomState(), 'randomState: 128 random bits as hex');

	// ---- where to talk to
	var st0 = fakeStorage();
	eq(Y.endpoints({ search: '?api=http://127.0.0.1:9999', hostname: 'nietztein.github.io', storage: st0 }).api, 'https://www.googleapis.com/youtube/v3', 'endpoints: ?api= is ignored on the real site');
	eq(st0.dump(), {}, 'endpoints: and nothing is remembered there');
	var epLocal = Y.endpoints({ search: '?api=http://127.0.0.1:9999', hostname: '127.0.0.1', storage: st0 });
	eq([epLocal.api, epLocal.auth, epLocal.revoke, epLocal.test], ['http://127.0.0.1:9999/youtube/v3', 'http://127.0.0.1:9999/o/oauth2/v2/auth', 'http://127.0.0.1:9999/revoke', true], 'endpoints: honoured on localhost');
	eq(Y.endpoints({ search: '', hostname: 'localhost', storage: st0 }).api, 'http://127.0.0.1:9999/youtube/v3', 'endpoints: remembered for the tab, so it survives the sign-in redirect');
	eq(Y.endpoints({ search: '?api=off', hostname: 'localhost', storage: st0 }).test, false, 'endpoints: ?api=off forgets it');
	eq(Y.endpoints({ search: '?api=https://example.org', hostname: 'localhost', storage: fakeStorage() }).test, false, 'endpoints: an override that is not on localhost is ignored');
	eq(Y.endpoints({ search: '', hostname: 'localhost', storage: fakeStorage() }).auth, 'https://accounts.google.com/o/oauth2/v2/auth', 'endpoints: Google by default');
	eq([Y.pacificDay(Date.UTC(2026, 9, 5, 6, 59)), Y.pacificDay(Date.UTC(2026, 9, 5, 7, 0)), Y.pacificDay(Date.UTC(2026, 0, 5, 7, 59)), Y.pacificDay(Date.UTC(2026, 0, 5, 8, 0))], ['2026-10-04', '2026-10-05', '2026-01-04', '2026-01-05'], 'pacificDay: the quota day turns over at midnight Pacific, summer and winter');
	eq([Y.tallyQuota(null, 5, Date.UTC(2026, 9, 5, 12)), Y.tallyQuota({ day: '2026-10-05', units: 40 }, 5, Date.UTC(2026, 9, 5, 12)), Y.tallyQuota({ day: '2026-10-04', units: 9000 }, 5, Date.UTC(2026, 9, 5, 12))], [{ day: '2026-10-05', units: 5 }, { day: '2026-10-05', units: 45 }, { day: '2026-10-05', units: 5 }], 'tallyQuota: adds within a day, starts again on the next');

	// ---- the manifest lists every host this code can reach
	var toy = JSON.parse(fs.readFileSync(path.join(HERE, 'toy.json'), 'utf8'));
	var hosts = [Y.GOOGLE.auth, Y.GOOGLE.revoke, Y.GOOGLE.api, Y.GOOGLE.mb, P.IFRAME_API, 'https://www.youtube-nocookie.com', 'https://i.ytimg.com'].map(function (u) { return new URL(u).hostname; });
	ok(hosts.every(function (h) { return toy.origins.indexOf(h) >= 0; }), 'toy.json lists every host the code can contact (' + hosts.join(', ') + ')');
	eq([toy.n, toy.slug, toy.title, toy.group, toy.surfaces, toy.added, toy.kit], [101, '101-true-shuffle', 'True Shuffle', 'art', ['grid'], '2026-10-05', true], 'toy.json: the fields the task gives');
	// the brief: "wip" until the tests, the smoke gate and the thumbnail are done, then "live"
	ok(toy.status === 'wip' || (toy.status === 'live' && fs.existsSync(path.join(HERE, '..', '..', 'assets', 'img', 'misc', '101-true-shuffle.jpg'))), 'toy.json: status is "wip", or "live" with its thumbnail in place');
	ok(toy.desc.length >= 60 && toy.desc.length <= 185 && toy.title.length <= 24, 'toy.json: the description is 60 to 185 characters');
	ok(/^https:\/\/www\.youtube\.com\/t\/terms$/.test(Y.TERMS.youtubeTerms) && /^https:\/\/policies\.google\.com\/privacy$/.test(Y.TERMS.googlePrivacy), 'TERMS: the links the YouTube API terms ask for');

	// ---- the fake server
	var mod = await import(url.pathToFileURL(path.join(HERE, 'test', 'fake-youtube.mjs')).href);
	var fake = await mod.startFake();
	try {
		var clock = Date.parse('2026-10-05T18:00:00Z');
		var now = function () { return clock; };
		var CLIENT_ID = 'test-client.apps.googleusercontent.com';
		var PAGE = 'http://127.0.0.1:5555/misc/101-true-shuffle/';

		// One sign-in through the fake's redirect, as a browser would do it.
		async function signInThroughFake(storage, search) {
			var loc = fakeLocation(PAGE + (search || ''));
			var auth = Y.createAuth({ clientId: CLIENT_ID, endpoints: Y.endpoints({ search: loc.search, hostname: loc.hostname, storage: storage }), storage: storage, location: loc, history: fakeHistory(loc), now: now });
			auth.signIn();
			var res = await fetch(loc.assigned, { redirect: 'manual' });
			await res.text();
			var loc2 = fakeLocation(res.headers.get('location')), hist2 = fakeHistory(loc2);
			var auth2 = Y.createAuth({ clientId: CLIENT_ID, endpoints: Y.endpoints({ search: loc2.search, hostname: loc2.hostname, storage: storage }), storage: storage, location: loc2, history: hist2, now: now });
			return { first: auth, assigned: loc.assigned, status: res.status, auth: auth2, loc: loc2, hist: hist2, back: auth2.handleRedirect() };
		}

		// ---- sign-in, end to end against the fake
		var storage = fakeStorage();
		var s = await signInThroughFake(storage, '?api=' + fake.url + '&x=1');
		ok(s.assigned.indexOf(fake.url + '/o/oauth2/v2/auth?') === 0 && new URL(s.assigned).searchParams.get('redirect_uri') === PAGE, 'signIn: leaves for the sign-in address with this page as the redirect URI');
		eq([s.status, s.back.status, s.auth.signedIn(), /^fake-token-\d+$/.test(s.auth.token())], [302, 'signed-in', true, true], 'handleRedirect: the answer is accepted and the token kept');
		eq([s.hist.replaced, s.loc.hash], [['/misc/101-true-shuffle/?api=' + fake.url + '&x=1'], ''], 'handleRedirect: the token is taken out of the address and the page\'s query is put back');
		ok(s.auth.test && s.auth.secondsLeft() > 3500 && s.auth.secondsLeft() <= 3599, 'the token lasts about an hour (' + s.auth.secondsLeft() + ' s left)');
		eq([Object.keys(storage.dump()).sort(), JSON.parse(storage.dump()[Y.KEYS.token]).accessToken === s.auth.token()], [[Y.KEYS.api, Y.KEYS.token], true], 'sessionStorage holds the token (and the test override), and the pending state is gone');
		eq(s.auth.handleRedirect().status, 'none', 'handleRedirect: nothing to do the second time');
		var reload = Y.createAuth({ clientId: CLIENT_ID, endpoints: s.auth.test ? Y.endpoints({ search: '', hostname: '127.0.0.1', storage: storage }) : null, storage: storage, location: fakeLocation(PAGE), history: null, now: now });
		eq(reload.token(), s.auth.token(), 'a reload keeps the session: the token comes back from sessionStorage');
		var changes = [];
		reload.onChange(function (signedIn) { changes.push(signedIn); });
		clock += 3540 * 1000;
		eq([reload.token(), reload.signedIn(), changes, storage.dump()[Y.KEYS.token]], [null, false, [false], undefined], 'a minute before its hour is over the token counts as gone and is deleted');
		clock -= 3540 * 1000;

		// answers that must be refused
		var st2 = fakeStorage(), loc3 = fakeLocation(PAGE + '#access_token=stolen&token_type=Bearer&expires_in=3599&scope=' + encodeURIComponent(Y.SCOPE) + '&state=abc');
		var a3 = Y.createAuth({ clientId: CLIENT_ID, storage: st2, location: loc3, history: fakeHistory(loc3), now: now, endpoints: Y.endpoints({ search: '?api=' + fake.url, hostname: '127.0.0.1', storage: st2 }) });
		var back3 = a3.handleRedirect();
		eq([back3.status, back3.error.code, a3.token(), loc3.hash], ['error', 'state', null, ''], 'a token in the address that this page did not ask for is refused, and removed from the address');
		st2.setItem(Y.KEYS.state, JSON.stringify({ state: 'abc', at: clock - 11 * 60000, search: '' }));
		loc3.hash = '#access_token=late&expires_in=3599&scope=' + encodeURIComponent(Y.SCOPE) + '&state=abc';
		eq(a3.handleRedirect().error.code, 'state', 'an answer that arrives more than ten minutes after the question is refused');
		st2.setItem(Y.KEYS.state, JSON.stringify({ state: 'abc', at: clock, search: '' }));
		loc3.hash = '#access_token=wrong&expires_in=3599&scope=' + encodeURIComponent(Y.SCOPE) + '&state=abd';
		eq([a3.handleRedirect().error.code, st2.getItem(Y.KEYS.state)], ['state', null], 'a wrong state is refused, and the pending state cannot be tried twice');
		fake.set({ deny: true });
		var denied = await signInThroughFake(fakeStorage(), '?api=' + fake.url);
		eq([denied.back.status, denied.back.error.code, denied.auth.token()], ['error', 'denied', null], 'when access is denied there is no token and the error says so');
		fake.set({ deny: false });
		var noId = Y.createAuth({ clientId: '', storage: fakeStorage(), location: fakeLocation(PAGE), now: now });
		eq(noId.configured(), false, 'without a client id the page is not configured');
		await rejects(noId.signIn(), function (e) { return e.code === 'config'; }, 'and signIn says so instead of leaving the page');
		noId.setClientId(' pasted-id '); eq([noId.configured(), noId.clientId()], [true, 'pasted-id'], 'setClientId: a visitor\'s own client id');

		// disconnect
		var s5 = await signInThroughFake(fakeStorage(), '?api=' + fake.url);
		var tok5 = s5.auth.token();
		var c5 = Y.createClient({ getToken: function () { return tok5; }, endpoints: s5.auth.test ? Y.endpoints({ search: '?api=' + fake.url, hostname: '127.0.0.1', storage: null }) : null, sleep: function () { return Promise.resolve(); } });
		ok((await c5.me()).likes === 'LL', 'the token works against the API');
		var out5 = await s5.auth.signOut();
		eq([out5, s5.auth.token(), fake.stats.revoked.indexOf(tok5) >= 0], [{ revoked: true }, null, true], 'signOut: the token is revoked at the endpoint and forgotten here');
		await rejects(c5.me(), function (e) { return e.code === 'signed-out'; }, 'a revoked token is no longer accepted');
		eq(await s5.auth.signOut(), { revoked: false }, 'signOut with no token does nothing');
		// the browser may refuse to show the page the answer: the request still goes out
		var calls = [], sneaky = fakeStorage();
		sneaky.setItem(Y.KEYS.token, JSON.stringify({ accessToken: 'tok-x', expiresAt: clock + 3000000 }));
		var a6 = Y.createAuth({ clientId: CLIENT_ID, storage: sneaky, location: fakeLocation(PAGE), now: now, endpoints: Y.endpoints({ search: '', hostname: 'nietztein.github.io', storage: null }), fetch: function (u, init) { calls.push([u, init.mode || 'cors', init.method, init.body]); return init.mode === 'no-cors' ? Promise.resolve({ ok: false, status: 0 }) : Promise.reject(new TypeError('Failed to fetch')); } });
		eq([await a6.signOut(), calls, a6.token()], [{ revoked: 'sent' }, [['https://oauth2.googleapis.com/revoke', 'cors', 'POST', 'token=tok-x'], ['https://oauth2.googleapis.com/revoke', 'no-cors', 'POST', 'token=tok-x']], null], 'signOut: if the answer cannot be read the revocation is sent again without asking to read it');

		// ---- the client
		function session(extra) {
			fake.reset();
			var token = fake.issueToken(), sleeps = [];
			var opts = { getToken: function () { return token; }, endpoints: Y.endpoints({ search: '?api=' + fake.url, hostname: '127.0.0.1', storage: null }), sleep: function (ms) { sleeps.push(ms); return Promise.resolve(); }, now: now };
			for (var k in (extra || {})) opts[k] = extra[k];
			return { client: Y.createClient(opts), sleeps: sleeps, lib: L.create(), store: Store.memory(), token: token, renew: function () { token = fake.issueToken(); } };
		}
		var x = session();
		var src = await x.client.sources();
		eq([src.me.title, src.sources.length, src.sources[0], src.sources[1].id, src.sources[1].count, src.sources[2].privacy], ['Fake Listener', 60, { id: 'LL', title: 'Liked videos', count: null, privacy: 'private', special: 'likes', publishedAt: null }, 'PL_BIG', 1230, 'private'], 'sources: the Liked videos, then 59 playlists over two pages, private ones included');
		eq([x.client.quota().units, x.client.quota().byMethod, fake.stats.units], [3, { 'channels.list': 1, 'playlists.list': 2 }, 3], 'quota: three units, counted the same as the server counted');
		ok(src.sources.every(function (p) { return p.id !== 'PL_FORBIDDEN'; }), 'sources: a playlist that is not his is not listed');
		var pg = await x.client.playlistPage('PL_BIG');
		eq([pg.total, pg.items.length, typeof pg.nextPageToken, pg.items[0].videoId, pg.items[40].unavailable, pg.items[39].unavailable], [1230, 50, 'string', 'fake0000001', true, false], 'playlistPage: 50 items, the total, the next page; a deleted video is flagged');
		var vb = await x.client.videoBatch(['fake0000001', 'fake0000041', 'fake0000037', 'fake0000097', 'fake0000006']);
		eq([vb.videos.map(function (v) { return v.id; }), vb.missing], [['fake0000001', 'fake0000037', 'fake0000006'], ['fake0000041', 'fake0000097']], 'videoBatch: deleted and private videos are not returned, and are reported missing');
		var v37 = vb.videos[1], v6 = vb.videos[2];
		eq([v37.embeddable, v37.durationSec > 0, v37.categoryId, v37.topics.length > 0, typeof v37.publishedAt], [false, true, '10', true, 'string'], 'videoBatch: length, category, topics and the embeddable flag');
		eq([v6.channel, v6.year, 'description' in v6], ['Tin Lighthouse Trio - Topic', 1976, false], 'videoBatch: an auto-generated description gives the release year, and is not kept');
		await rejects(x.client.videoBatch(new Array(51).fill('fake0000001')), function (e) { return e.code === 'bad-request'; }, 'videoBatch: more than 50 ids is refused before asking');
		eq(await x.client.videoBatch([]), { videos: [], missing: [] }, 'videoBatch: nothing asked, nothing spent');

		// typed errors
		var before = fake.stats.requests;
		var out = Y.createClient({ getToken: function () { return null; }, endpoints: x.client.endpoints });
		await rejects(out.playlists(), function (e) { return e.code === 'signed-out' && Y.isYTError(e); }, 'signed out: no token');
		eq(fake.stats.requests, before, 'signed out: and no request was sent');
		var signedOut = 0;
		var stale = Y.createClient({ getToken: function () { return 'fake-token-never-issued'; }, endpoints: x.client.endpoints, onSignedOut: function () { signedOut++; } });
		await rejects(stale.playlists(), function (e) { return e.code === 'signed-out' && e.status === 401; }, 'signed out: a token the server does not accept');
		eq(signedOut, 1, 'onSignedOut is told');
		await rejects(x.client.playlistPage('PL_FORBIDDEN'), function (e) { return e.code === 'forbidden' && e.reason === 'playlistItemsNotAccessible' && e.status === 403; }, 'forbidden: a playlist that is not his');
		await rejects(x.client.playlistPage('PL_NO_SUCH'), function (e) { return e.code === 'not-found' && e.status === 404; }, 'not found: no such playlist');
		await rejects(x.client.playlistPage('PL_BIG', 'garbage'), function (e) { return e.code === 'bad-request' && e.reason === 'invalidPageToken'; }, 'bad request: a page token the server does not know');
		ok(x.sleeps.length === 0, 'none of those were retried');
		fake.set({ quotaAfter: 2 });
		await x.client.me(); await x.client.me();
		await rejects(x.client.me(), function (e) { return e.code === 'quota' && /midnight Pacific/.test(e.message); }, 'quota exceeded: a typed error that says when the quota starts again');
		ok(x.sleeps.length === 0, 'quota exceeded is not retried');
		fake.set({ quotaAfter: null });

		// retries
		x = session();
		fake.set({ failNext: 2 });
		eq((await x.client.me()).likes, 'LL', '5xx: two failures, then the answer');
		ok(x.sleeps.length === 2 && x.sleeps[0] >= 500 && x.sleeps[0] < 750 && x.sleeps[1] >= 1000 && x.sleeps[1] < 1250, '5xx: it waited about 0.5 s, then about 1 s (' + x.sleeps.join(', ') + ' ms)');
		eq([x.client.quota().units, fake.stats.units], [3, 3], '5xx: the failed attempts are counted as spent, as Google counts them');
		x = session();
		fake.set({ failNext: 99 });
		await rejects(x.client.me(), function (e) { return e.code === 'server' && e.status === 503; }, '5xx: after four retries it gives up with a typed error');
		eq([x.sleeps.length, fake.stats.requests], [4, 5], '5xx: five attempts in all');
		x = session();
		fake.set({ rateLimitNext: 1 });
		eq((await x.client.me()).likes, 'LL', 'rate limit: waited and tried again');
		eq(x.sleeps.length, 1, 'rate limit: one wait');
		x = session();
		fake.set({ noChannel: true });
		eq(await x.client.me(), null, 'me: null for a Google account without a YouTube channel');
		var dead = Y.createClient({ getToken: function () { return 't'; }, endpoints: { api: 'http://127.0.0.1:1/youtube/v3' }, sleep: function () { return Promise.resolve(); }, maxRetries: 2 });
		await rejects(dead.me(), function (e) { return e.code === 'network'; }, 'network: no answer at all is a typed error, after retries');
		eq(dead.quota().units, 0, 'network: a request that got no answer is not counted');
		var ac = new AbortController(); ac.abort();
		await rejects(x.client.me({ signal: ac.signal }), function (e) { return e.code === 'aborted'; }, 'aborted: a signal that has fired stops the call');

		// ---- the import: 1,230 items
		x = session();
		var progress = [];
		var big = { id: 'PL_BIG', title: 'Everything since 2009', privacy: 'public', special: '' };
		var sum = await Y.importInto({ client: x.client, lib: x.lib, store: x.store, playlist: big, now: now, onProgress: function (p) { progress.push(p); } });
		eq([sum.total, sum.unique, sum.fetched, sum.missing.length, sum.added.length, sum.skippedFresh, sum.resumed], [1230, 1200, 1159, 41, 1159, 0, false], 'import of the 1,230-item playlist: 1,200 different videos, 41 of them deleted or private, 1,159 tracks');
		eq([sum.quota, fake.stats.units, fake.stats.byMethod], [49, 49, { 'playlistItems.list': 25, 'videos.list': 24 }], 'import: 25 pages and 24 batches of details, 49 quota units, counted the same on both sides');
		eq([Object.keys(x.lib.tracks).length, (await x.store.getTracks()).length, (await x.store.getPlaylists()).length], [1159, 1159, 1], 'import: the library and the store hold the same 1,159 tracks');
		var listSteps = progress.filter(function (p) { return p.phase === 'list'; }), detailSteps = progress.filter(function (p) { return p.phase === 'details'; });
		ok(listSteps.length === 25 && listSteps[0].listed === 50 && listSteps[24].listed === 1230 && listSteps.every(function (p) { return p.total === 1230; }), 'import: progress through the list, 50 at a time, with the total known from the first page');
		ok(detailSteps[detailSteps.length - 1].detailed === 24 && detailSteps[0].toDetail === 24 && progress[progress.length - 1].phase === 'done', 'import: progress through the details, then done');
		ok(progress.every(function (p, n) { return n === 0 || p.quota >= progress[n - 1].quota; }), 'import: the quota in the progress never goes down');
		var t1 = x.lib.tracks.fake0000001, t5 = x.lib.tracks.fake0000005;
		eq([t1.artist, t1.title, t1.playlists, t1.addedAt.PL_BIG, t1.genres], ['Glass Orchard', 'Electric Orchard', ['PL_BIG'], '2020-01-01T00:00:00.000Z', ['Pop']], 'import: a track has its artist, title, playlist, date added and genre');
		ok(t5.addedAt.PL_BIG < '2020-02-21', 'import: a video listed twice keeps the earlier date added (' + t5.addedAt.PL_BIG + ')');
		eq([L.list(x.lib).filter(function (t) { return t.embeddable === false; }).length, !!x.lib.tracks.fake0000041, !!x.lib.tracks.fake0000097], [32, false, false], 'import: 32 tracks are marked not embeddable; deleted and private videos made no tracks');
		eq([x.lib.playlists.PL_BIG.count, x.lib.playlists.PL_BIG.listed, x.lib.playlists.PL_BIG.unavailable, await x.store.get('import:PL_BIG', 'none')], [1200, 1230, 41, 'none'], 'import: the playlist record, and the saved position is cleared when done');
		eq(await Y.pendingImport(x.store, 'PL_BIG'), null, 'pendingImport: nothing unfinished');
		var fullIds = Object.keys(x.lib.tracks).sort().join();

		// a second playlist whose videos are all known: only the listing is paid for
		var u0 = fake.stats.units;
		L.edit(x.lib, 'fake0000001', { rating: 5, artist: 'Glass Orchard (corrected)' });
		L.recordPlay(x.lib, 'fake0000001', { at: clock, completed: true });
		sum = await Y.importInto({ client: x.client, lib: x.lib, store: x.store, playlist: { id: 'PL_SMALL', title: 'Short list', privacy: 'unlisted' }, now: now });
		eq([sum.total, sum.fetched, sum.skippedFresh, sum.quota, fake.stats.units - u0, fake.stats.byMethod['videos.list']], [12, 0, 12, 1, 1, 24], 'import of a playlist of known videos: one unit for the list, no details asked again');
		eq([x.lib.tracks.fake0000001.playlists, x.lib.tracks.fake0000001.rating, x.lib.tracks.fake0000001.artist, x.lib.tracks.fake0000001.plays], [['PL_BIG', 'PL_SMALL'], 5, 'Glass Orchard (corrected)', 1], 'the track is now in both playlists, with its rating, correction and play count');
		eq((await x.store.getTracks()).filter(function (t) { return t.playlists.length === 2; }).length, 12, 'and the store has the twelve updated tracks');
		// the playlist shrinks: two tracks leave it, and stay in the library
		fake.set({ shrink: { PL_SMALL: 2 } });
		sum = await Y.importInto({ client: x.client, lib: x.lib, store: x.store, playlist: { id: 'PL_SMALL', title: 'Short list' }, now: now });
		eq([sum.left.sort(), x.lib.tracks.fake0000012.playlists, x.lib.playlists.PL_SMALL.count], [['fake0000011', 'fake0000012'], ['PL_BIG'], 10], 'importing a playlist again: tracks that left it leave it in the library, and stay in the library');
		// forcing fresh details keeps what he did
		sum = await Y.importInto({ client: x.client, lib: x.lib, store: x.store, playlist: { id: 'PL_SMALL', title: 'Short list' }, now: now, freshDays: 0 });
		eq([sum.fetched, sum.added.length, x.lib.tracks.fake0000001.rating, x.lib.tracks.fake0000001.artist, x.lib.tracks.fake0000001.plays, x.lib.tracks.fake0000001.userEdits], [10, 0, 5, 'Glass Orchard (corrected)', 1, { artist: 'Glass Orchard (corrected)' }], 'details fetched again leave the rating, the correction and the play count alone');
		// a private playlist, and the Liked videos
		sum = await Y.importInto({ client: x.client, lib: x.lib, store: x.store, playlist: { id: 'PL_PRIVATE', title: 'Private drafts', privacy: 'private' }, now: now });
		eq([sum.total, sum.added.length, sum.missing, sum.quota], [37, 36, ['fake0002009'], 2], 'a private playlist is read like any other');
		sum = await Y.importInto({ client: x.client, lib: x.lib, store: x.store, playlist: src.sources[0], now: now });
		eq([sum.total, sum.added.length, sum.skippedFresh, sum.missing.length, sum.quota, x.lib.playlists.LL.special], [180, 115, 58, 7, 7, 'likes'], 'the Liked videos: 180 listed, 115 new, 58 already here, 7 gone, 7 units');
		sum = await Y.importInto({ client: x.client, lib: x.lib, store: x.store, playlist: { id: 'PL_EMPTY', title: 'Nothing yet' }, now: now });
		eq([sum.total, sum.added, sum.quota], [0, [], 1], 'an empty playlist');
		await rejects(Y.importInto({ client: x.client, lib: x.lib, store: x.store, playlist: { id: 'PL_FORBIDDEN', title: 'x' }, now: now }), function (e) { return e.code === 'forbidden'; }, 'a playlist he may not read: the import fails with the typed error');
		eq(JSON.stringify(L.fromParts(await x.store.loadLibrary())), JSON.stringify(x.lib), 'after all of that the store holds exactly the library in memory');

		// ---- the import, interrupted and resumed
		// (a) the token stops being accepted after ten calls, in the list phase
		x = session();
		fake.set({ expireAfter: 10 });
		await rejects(Y.importInto({ client: x.client, lib: x.lib, store: x.store, playlist: big, now: now }), function (e) { return e.code === 'signed-out'; }, 'interrupted while listing: the import stops with "signed out"');
		var pend = await Y.pendingImport(x.store, 'PL_BIG');
		eq([pend.phase, pend.items.length, pend.total, pend.quota, Object.keys(x.lib.tracks).length], ['list', 500, 1230, 11, 0], 'the position is saved: 500 of 1,230 listed');
		fake.set({ expireAfter: null }); x.renew();
		var resumedProgress = [];
		sum = await Y.importInto({ client: x.client, lib: x.lib, store: x.store, playlist: big, now: now, onProgress: function (p) { resumedProgress.push(p); } });
		eq([sum.resumed, sum.total, sum.added.length, resumedProgress[0].listed, fake.stats.byMethod['playlistItems.list'], fake.stats.units, sum.quota], [true, 1230, 1159, 550, 26, 50, 50], 'resumed: it goes on from item 500, and both runs together cost one unit more than an uninterrupted import');
		eq(Object.keys(x.lib.tracks).sort().join() === fullIds, true, 'resumed: the library is the same as after an uninterrupted import');
		// (b) interrupted in the details phase, then the page is reloaded
		x = session();
		fake.set({ expireAfter: 30 });
		await rejects(Y.importInto({ client: x.client, lib: x.lib, store: x.store, playlist: big, now: now }), function (e) { return e.code === 'signed-out'; }, 'interrupted while fetching details');
		pend = await Y.pendingImport(x.store, 'PL_BIG');
		eq([pend.phase, pend.items.length, pend.detailIndex, (await x.store.getTracks()).length], ['details', 1230, 5, 250], 'the position is saved: the list is complete and 250 tracks are stored');
		var reloaded = L.fromParts(await x.store.loadLibrary());
		fake.set({ expireAfter: null }); x.renew();
		sum = await Y.importInto({ client: x.client, lib: reloaded, store: x.store, playlist: big, now: now });
		eq([sum.resumed, sum.skippedFresh, sum.fetched, fake.stats.byMethod['playlistItems.list'], fake.stats.units, sum.quota], [true, 250, 909, 25, 50, 50], 'resumed after a reload: the list is not read again, the 250 stored tracks are not fetched again');
		eq(Object.keys(reloaded.tracks).sort().join() === fullIds, true, 'resumed after a reload: the same library');
		// (c) stopped by the caller
		x = session();
		var stopper = new AbortController();
		await rejects(Y.importInto({ client: x.client, lib: x.lib, store: x.store, playlist: big, now: now, signal: stopper.signal, onProgress: function (p) { if (p.listed >= 150) stopper.abort(); } }), function (e) { return e.code === 'aborted'; }, 'stopped by the caller');
		eq((await Y.pendingImport(x.store, 'PL_BIG')).items.length, 150, 'what was listed before the stop is saved');
		// (d) the quota runs out
		x = session();
		fake.set({ quotaAfter: 5 });
		await rejects(Y.importInto({ client: x.client, lib: x.lib, store: x.store, playlist: big, now: now }), function (e) { return e.code === 'quota'; }, 'the quota runs out during an import: a typed error');
		eq((await Y.pendingImport(x.store, 'PL_BIG')).items.length, 250, 'and the five pages read are saved for tomorrow');
		// (e) a saved page token the server no longer accepts
		x = session();
		await x.store.set('import:PL_SMALL', { v: 1, playlistId: 'PL_SMALL', phase: 'list', pageToken: 'no-longer-valid', total: 12, items: [['fake0000001', '2020-01-01T00:00:00.000Z', 0]], detailIndex: 0, missing: [], quota: 1 });
		sum = await Y.importInto({ client: x.client, lib: x.lib, store: x.store, playlist: { id: 'PL_SMALL', title: 'Short list' }, now: now });
		eq([sum.total, sum.added.length, sum.resumed], [12, 12, true], 'a saved page token that is no longer accepted: the list is read again from the top');

		// ---- refresh
		x = session();
		await Y.importInto({ client: x.client, lib: x.lib, store: x.store, playlist: { id: 'PL_SMALL', title: 'Short list' }, now: now });
		await Y.importInto({ client: x.client, lib: x.lib, store: x.store, playlist: { id: 'PL_PRIVATE', title: 'Private drafts' }, now: now });
		L.edit(x.lib, 'fake0000002', { rating: 4, title: 'My title' });
		L.recordPlay(x.lib, 'fake0000002', { at: clock, completed: true });
		var u1 = fake.stats.units;
		var rf = await Y.refreshInto({ client: x.client, lib: x.lib, store: x.store, now: now });
		eq([rf.checked, rf.quota, fake.stats.units - u1], [0, 0, 0], 'refresh: nothing is older than 30 days, so nothing is asked');
		clock += 31 * 86400000;
		fake.set({ gone: ['fake0000002', 'fake0000003'] });
		rf = await Y.refreshInto({ client: x.client, lib: x.lib, store: x.store, now: now });
		eq([rf.checked, rf.quota, rf.removed.sort(), rf.updated.length], [48, 1, ['fake0000002', 'fake0000003'], 46], 'refresh after 31 days: all 48 tracks in one call; two have disappeared');
		var t2 = x.lib.tracks.fake0000002;
		eq([t2.removed, L.playable(t2), t2.rating, t2.title, t2.plays, t2.userEdits], [true, false, 4, 'My title', 1, { title: 'My title' }], 'a track that disappeared is marked removed and keeps its rating, correction and play count');
		eq((await x.store.getTracks()).filter(function (t) { return t.removed; }).length, 2, 'the store has the marks');
		eq(L.stale(x.lib, clock).length, 0, 'after the refresh nothing is stale');
		fake.set({ gone: [] });
		rf = await Y.refreshInto({ client: x.client, lib: x.lib, store: x.store, now: now, all: true });
		eq([rf.restored.sort(), x.lib.tracks.fake0000002.removed, x.lib.tracks.fake0000002.rating], [['fake0000002', 'fake0000003'], false, 4], 'refresh: a video that comes back is restored');
		rf = await Y.refreshInto({ client: x.client, lib: x.lib, store: x.store, now: now, ids: ['fake0000001', 'fake0000004'] });
		eq([rf.checked, rf.quota], [2, 1], 'refresh: chosen tracks only');
		clock -= 31 * 86400000;

		// ---- MusicBrainz (the fake's copy of its two calls)
		fake.reset();
		var mbClock = 5000000, mbSleeps = [];
		var mb = Y.createMusicBrainz({ endpoints: Y.endpoints({ search: '?api=' + fake.url, hostname: '127.0.0.1', storage: null }), now: function () { return mbClock; }, sleep: function (ms) { mbSleeps.push(ms); mbClock += ms; return Promise.resolve(); } });
		eq(await mb.artistGenres('Paper Lanterns'), { mbid: '00000000-0000-4000-8000-000000000001', name: 'Paper Lanterns', genres: ['Indie Rock', 'Dream Pop', 'Shoegaze'] }, 'MusicBrainz: the three commonest genres of an artist');
		eq((await mb.artistGenres('the PAPER lanterns')).name, 'Paper Lanterns', 'MusicBrainz: case and "The" do not matter');
		eq((await mb.artistGenres('Velvet Algorithms')).genres, ['Soul', 'Funk'], 'MusicBrainz: an alias matches');
		eq(await mb.artistGenres('Nobody Anybody Knows'), null, 'MusicBrainz: a weak match with another name is not accepted');
		eq((await mb.artistGenres('Tin Lighthouse Trio')).genres, [], 'MusicBrainz: an artist without genres');
		eq(await mb.artistGenres(''), null, 'MusicBrainz: no name, no request');
		eq([mb.requests(), fake.stats.mb, mbSleeps], [9, 9, [1100, 1100, 1100, 1100, 1100, 1100, 1100, 1100]], 'MusicBrainz: nine requests, each 1.1 s after the one before');
		var mlib = L.create();
		// each on the artist's own channel: a plain dash on a stranger's channel is only a guess (2026-10-05)
		L.upsert(mlib, [video('m1', 'Paper Lanterns - Blue Signal', 'Paper Lanterns', { topics: [WIKI + 'Rock_music'] }), video('m2', 'Glass Orchard - Winter Almanac', 'Glass Orchard', {}), video('m3', 'Unknown Band - Song', 'Unknown Band', {})], { now: clock });
		var steps = [];
		var res = await mb.genresForArtists(L.facets(mlib, null, clock).artist, { lib: mlib, onProgress: function (p) { steps.push(p.found + (p.hit ? '+' : '')); } });
		eq([res.found, res.notFound, res.changed.sort(), mlib.tracks.m1.genres, mlib.tracks.m1.genreSource, mlib.tracks.m2.genres, mlib.tracks.m3.genres, steps.length], [2, 1, ['m1', 'm2'], ['Indie Rock', 'Dream Pop', 'Shoegaze'], 'musicbrainz', ['Synth-Pop'], [], 3], 'MusicBrainz: genres for every artist of a library, written into it');
		var counts = steps.map(function (x) { return parseInt(x, 10); }), rising = counts.every(function (c, k) { return k === 0 || c >= counts[k - 1]; });
		ok(rising && counts[counts.length - 1] === res.found && steps.filter(function (x) { return x.slice(-1) === '+'; }).length === res.found, 'MusicBrainz: progress counts the artists found so far (' + steps.join(' ') + ')');
	} finally {
		await fake.close();
	}
});

// =============================================================================
// labels (a hand-made reading of the library) and the taste map
// =============================================================================

describe('labels', function () {
	var L = require('./library.js'), S = require('./shuffle.js'), T = require('./taxonomy.js');
	function lib3() {
		var lib = L.create();
		L.upsert(lib, [
			{ id: 'aaaaaaaaaaa', title: 'Kumo no Ue - Hollow Signal (Lyrics)', channel: 'lyric shelf', durationSec: 200, publishedAt: '2019-01-01T00:00:00Z', topics: ['https://en.wikipedia.org/wiki/Music_of_Asia'] },
			{ id: 'bbbbbbbbbbb', title: 'Paper Signal', channel: 'Hollow Signal - Topic', durationSec: 240, publishedAt: '2018-01-01T00:00:00Z', topics: [] },
			{ id: 'ccccccccccc', title: 'stream highlights #3', channel: 'clip zone', durationSec: 600, publishedAt: '2021-01-01T00:00:00Z', topics: [] }
		], { playlistId: 'PL1', addedAt: {}, now: Date.UTC(2026, 0, 1) });
		return lib;
	}
	var file = {
		format: L.LABELS_FORMAT, version: 1,
		tracks: {
			aaaaaaaaaaa: { artist: 'Hollow Signal', title: 'Kumo no Ue', titleAlt: 'Above the Clouds', genres: ['Alt J-rock'], mood: 'wistful', scene: 'anime', work: 'Paper Sky', role: 'ED', lang: 'ja', kind: 'song', year: 2009 },
			ccccccccccc: { genres: ['Spoken & clips'], kind: 'clip' },
			zzzzzzzzzzz: { artist: 'Nobody' }
		},
		artists: { 'Hollow Signal': { native: '\u30DB\u30ED\u30A6', genres: ['Alt J-rock', 'Shoegaze & dream pop'], scene: 'anime', lang: 'ja' } },
		aliases: { '\u30DB\u30ED\u30A6': 'Hollow Signal' }
	};
	eq(L.checkLabels({ format: 'x' }) !== '', true, 'checkLabels refuses a file that is not a labels file');
	var lib = lib3();
	var r = L.applyLabels(lib, file);
	eq([r.matched, r.missing, r.artists], [2, 1, 1], 'applyLabels: two tracks matched, one missing from the library, one artist profile');
	var a = lib.tracks.aaaaaaaaaaa, b = lib.tracks.bbbbbbbbbbb, c = lib.tracks.ccccccccccc;
	eq([a.artist, a.title, a.titleAlt, a.genres, a.mood, a.scene, a.work, a.role, a.lang, a.year, a.yearSource], ['Hollow Signal', 'Kumo no Ue', 'Above the Clouds', ['Alt J-rock'], 'wistful', 'anime', 'Paper Sky', 'ED', 'ja', 2009, 'label'], 'a labelled track carries every label');
	eq([b.genres, b.scene, b.lang, b.artistNative], [['Alt J-rock', 'Shoegaze & dream pop'], 'anime', 'ja', '\u30DB\u30ED\u30A6'], 'an unlabelled track by a profiled artist inherits genres, scene, language and the native name');
	eq(L.fixedArtist(a) && !L.teachable(lib, a), true, 'a labelled artist is fixed: never re-read or taught over');
	L.edit(lib, 'aaaaaaaaaaa', { mood: 'bright', artist: 'Someone Else' });
	eq([a.mood, a.artist], ['bright', 'Someone Else'], 'the user\'s correction wins over the label');
	L.edit(lib, 'aaaaaaaaaaa', { mood: null, artist: null });
	eq([a.mood, a.artist], ['wistful', 'Hollow Signal'], 'taking the correction back returns to the label, not to the parser');
	eq(L.search(lib, 'above clouds').map(function (t) { return t.id; }), ['aaaaaaaaaaa'], 'search finds the romaji or English title');
	eq(L.search(lib, '\u30DB\u30ED\u30A6').length, 2, 'search finds an artist by the native name');
	var f = L.facets(lib);
	eq([f.mood.length, f.kind.map(function (e) { return e.key; }).sort()], [1, ['clip', 'song']], 'facets count moods and kinds');
	eq(S.select(L.list(lib), { not: { kinds: ['clip'] } }).length, 2, 'select leaves clips out with not.kinds');
	eq(S.select(L.list(lib), { works: ['Paper Sky'], roles: ['ED'] }).map(function (t) { return t.id; }), ['aaaaaaaaaaa'], 'select by work and role');
	var parts = L.toParts(lib), back = L.fromParts(JSON.parse(JSON.stringify(parts)));
	eq(back.profiles, lib.profiles, 'profiles survive the store');
	var out = L.exportLabels(lib, Date.UTC(2026, 9, 8));
	eq([out.format, Object.keys(out.tracks).sort(), out.artists['Hollow Signal'].native], [L.LABELS_FORMAT, ['aaaaaaaaaaa', 'ccccccccccc'], '\u30DB\u30ED\u30A6'], 'exportLabels writes the labelled tracks and the profiles');
	var again = lib3();
	L.applyLabels(again, out);
	eq([again.tracks.aaaaaaaaaaa.artist, again.tracks.aaaaaaaaaaa.work], ['Hollow Signal', 'Paper Sky'], 'an exported labels file applies to a fresh import');
	// the taste map
	var names = {};
	T.FAMILIES.forEach(function (fam) { fam.list.forEach(function (g) { ok(!names[g.name], 'genre named once: ' + g.name); names[g.name] = true; }); });
	eq([T.familyOf('City pop'), T.familyOf('Rock'), T.trackFamily({ genres: ['Rock', 'Vocaloid'] })], ['retro', 'other', 'net'], 'familyOf and trackFamily (an unknown genre is Other)');
	ok(T.genresOfFamily('other', ['Rock']).indexOf('Rock') >= 0, 'Other also holds genres the map does not know');
	var lab = require('./demo.js').build(Date.UTC(2026, 9, 5)).lib;
	ok(L.list(lab).every(function (t) { return t.mood && t.genres.length; }), 'the demo carries a mood and genres on every track');
});

// =============================================================================
// embed (vectors, neighbours, the map layout)
// =============================================================================

describe('embed', function () {
	var E = require('./embed.js'), S = require('./shuffle.js'), T = require('./taxonomy.js'), L = require('./library.js');
	var demo = require('./demo.js').build(Date.UTC(2026, 9, 5)).lib, ts = L.list(demo).filter(function (t) { return t.kind !== 'clip'; });
	E.RECIPES.forEach(function (r) {
		if (r.key === 'lm') return;
		var v = E.vectors(ts, r.key, { taxonomy: T, firstAdded: L.firstAdded });
		ok(v.length === ts.length && v.every(function (x) { var n2 = E.dot(x, x); return n2 === 0 || Math.abs(n2 - 1) < 1e-4; }), 'vectors (' + r.key + '): one unit vector per track');
	});
	var v = E.vectors(ts, 'labels', { taxonomy: T }), nn = E.knn(v, 10);
	var same = 0, total = 0;
	nn.forEach(function (row, i) { for (var k = 0; k < 5; k++) { total++; if (ts[row.ids[k]].genres[0] === ts[i].genres[0]) same++; } });
	ok(same / total > 0.7, 'knn on labels: ' + Math.round(100 * same / total) + '% of the five nearest share the first genre');
	ok(nn.every(function (row, i) { return Array.prototype.indexOf.call(row.ids, i) < 0; }), 'knn never lists a track as its own neighbour');
	var lay = E.layout(v, nn, { rand: S.rng('t') });
	lay.step();
	ok(lay.done && lay.pos.length === ts.length * 2 && Array.prototype.every.call(lay.pos, isFinite), 'layout: finite positions for every track');
	var pos = lay.pos, near = 0, far = 0, cnt = 0;
	nn.forEach(function (row, i) { var j = row.ids[0], r2 = Math.floor(S.rng('p' + i)() * ts.length); near += Math.hypot(pos[2 * i] - pos[2 * j], pos[2 * i + 1] - pos[2 * j + 1]); far += Math.hypot(pos[2 * i] - pos[2 * r2], pos[2 * i + 1] - pos[2 * r2 + 1]); cnt++; });
	ok(near * 3 < far, 'layout: nearest neighbours land closer than random pairs (' + (near / cnt).toFixed(2) + ' against ' + (far / cnt).toFixed(2) + ')');
	var lay2 = E.layout(v, nn, { rand: S.rng('t') }); lay2.step();
	eq(Array.from(lay2.pos).slice(0, 6), Array.from(pos).slice(0, 6), 'layout: the same seed gives the same map');
	var regs = E.regions(pos, ts, 8, S.rng('r'));
	ok(regs.length >= 2 && regs.every(function (r) { return r.name && r.size > 0; }), 'regions: named groups (' + regs.map(function (r) { return r.name; }).join(', ') + ')');
	ok(E.describe(ts[0], T).indexOf(ts[0].title) === 0, 'describe starts with the title');
	var job = E.knnJob(v, 5); while (!job.step(1)); eq(job.result.length, ts.length, 'knnJob finishes in slices');
});

// =============================================================================
// discover (related artists from Deezer, through a transport the tests fake)
// =============================================================================

describe('discover', async function () {
	var D = require('./discover.js'), Y = require('./yt.js');
	var calls = [];
	var data = {
		'search/artist?q=Paper%20Lanterns&limit=6': { data: [{ id: 1, name: 'PAPER LANTERNS', nb_fan: 10 }, { id: 2, name: 'Paper Lanterns', nb_fan: 900 }] },
		'artist/1/top?limit=25': { data: [{ id: 11, title: 'Blue Signal', artist: { name: 'Paper Lanterns' } }] },
		'artist/2/top?limit=25': { data: [{ id: 21, title: 'Other Song', artist: { name: 'Paper Lanterns' } }] },
		'artist/1/related?limit=20': { data: [{ id: 5, name: 'Glass Orchard', nb_fan: 50 }, { id: 6, name: 'Hollow Compass', nb_fan: 500 }, { id: 7, name: 'paper lanterns', nb_fan: 1 }, { id: 8, name: 'Hidden One', nb_fan: 9 }] },
		'artist/5/top?limit=3': { data: [{ id: 51, title: 'Mosaic', duration: 200, preview: 'https://cdnt-preview.dzcdn.net/x.mp3', album: { title: 'A', cover_medium: 'https://evil.example/x.jpg' }, artist: { name: 'Glass Orchard' } }] },
		'artist/6/top?limit=3': { data: [{ id: 61, title: 'Tide', preview: 'https://evil.example/x.mp3', artist: { name: 'Hollow Compass' } }] },
		'search/artist?q=Nobody&limit=6': { data: [{ id: 9, name: 'Nobody', nb_fan: 1 }] },
		'artist/9/top?limit=25': { data: [{ id: 91, title: 'Unrelated' }] }
	};
	var dz = D.createDeezer({ transport: function (u) { calls.push(u); var k = u.replace(D.API, ''); return data[k] ? Promise.resolve(data[k]) : Promise.reject(new Error('no ' + k)); } });
	var r = await D.suggest(dz, { names: ['Paper Lanterns'], titles: ['Blue Signal'], known: function (n) { return n === 'Hollow Compass'; }, hidden: { [D.norm('Hidden One')]: true } });
	eq([r.artist.id, r.verified], [1, true], 'findArtist: of two artists with the name, the one whose songs the library has (not the one with more fans)');
	eq(r.related.map(function (a) { return a.name; }), ['Glass Orchard', 'Hollow Compass'], 'suggest: the artist itself and hidden artists left out; artists the library lacks first');
	eq([r.related[0].known, r.related[1].known], [false, true], 'suggest: marks the artists the library already has');
	eq([r.related[0].tracks[0].preview, r.related[0].tracks[0].cover, r.related[1].tracks[0].preview], ['https://cdnt-preview.dzcdn.net/x.mp3', '', ''], 'only the hosts of Deezer are kept for previews and pictures');
	var none = await D.suggest(dz, { names: ['Nobody'], titles: ['Some Song'] });
	eq(none.artist, null, 'a name whose songs do not match the library is taken for another artist');
	var before = calls.length;
	await dz.related(1);
	eq(calls.length, before, 'answers are cached');
	eq(D.bestVideo([{ videoId: 'a', title: 'Mosaic (cover)', channel: 'someone' }, { videoId: 'b', title: 'Mosaic', channel: 'Glass Orchard - Topic' }], { artist: 'Glass Orchard', title: 'Mosaic' }).videoId, 'b', 'bestVideo prefers the Topic channel of the artist to a cover');
	eq(D.youtubeQuery({ artist: 'Glass Orchard', title: 'Mosaic' }), 'Glass Orchard Mosaic', 'youtubeQuery');
	// the YouTube client's search, and its quota
	var spent = [];
	var client = Y.createClient({ getToken: function () { return 'tok'; }, endpoints: Y.GOOGLE, onQuota: function (u, m) { spent.push([u, m]); }, fetch: function (u) {
		ok(u.indexOf('/search?') >= 0 && /type=video/.test(u) && /videoEmbeddable=true/.test(u), 'search asks for embeddable videos');
		return Promise.resolve({ ok: true, status: 200, headers: { get: function () { return 'application/json'; } }, json: function () { return Promise.resolve({ items: [{ id: { videoId: 'abcdefghijk' }, snippet: { title: 'Mosaic', channelTitle: 'Glass Orchard - Topic', channelId: 'UCx', publishedAt: '2020-01-01T00:00:00Z' } }, { id: { channelId: 'UCy' }, snippet: {} }] }); }, text: function () { return Promise.resolve(''); } });
	} });
	var found = await client.search('Glass Orchard Mosaic', { max: 3 });
	eq(found.map(function (f) { return f.videoId + ' ' + f.channel; }), ['abcdefghijk Glass Orchard - Topic'], 'client.search returns the videos (a channel result is dropped)');
	eq(spent, [[Y.SEARCH_UNITS, 'search.list']], 'a search costs ' + Y.SEARCH_UNITS + ' quota units');
});

// =============================================================================
// readme (every name the page can call is documented)
// =============================================================================

describe('readme', function () {
	var text = fs.readFileSync(path.join(HERE, 'README.md'), 'utf8');
	// Exported names are plain identifiers, so they can go into a pattern as they are.
	function mentions(name) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && new RegExp('(^|[^A-Za-z0-9_])' + name + '([^A-Za-z0-9_]|$)').test(text); }
	var Store = require('./store.js'), P = require('./player.js'), Y = require('./yt.js');
	var mock = P.create({ kind: 'mock', auto: false });
	var groups = {
		config: Object.keys(require('./config.js')),
		parse: Object.keys(require('./parse.js')),
		library: Object.keys(require('./library.js')),
		shuffle: Object.keys(require('./shuffle.js')),
		store: Object.keys(Store),
		'a store': Object.keys(Store.memory()),
		player: Object.keys(P),
		'a player': Object.keys(mock),
		'a controller': Object.keys(P.controller({ player: mock })),
		demo: Object.keys(require('./demo.js')),
		taxonomy: Object.keys(require('./taxonomy.js')),
		embed: Object.keys(require('./embed.js')),
		discover: Object.keys(require('./discover.js')),
		yt: Object.keys(Y),
		'an auth': Object.keys(Y.createAuth({ clientId: 'x', storage: null, location: fakeLocation('http://127.0.0.1/'), endpoints: Y.GOOGLE })),
		'a client': Object.keys(Y.createClient({ getToken: function () { return null; }, endpoints: Y.GOOGLE })),
		'a MusicBrainz client': Object.keys(Y.createMusicBrainz({ endpoints: Y.GOOGLE }))
	};
	var total = 0;
	Object.keys(groups).forEach(function (g) {
		var missing = groups[g].filter(function (name) { return !mentions(name); });
		total += groups[g].length;
		ok(missing.length === 0, 'README.md mentions every name of ' + g + ' (' + groups[g].length + ')' + (missing.length ? ': missing ' + missing.join(', ') : ''));
	});
	ok(total > 200, total + ' names checked');
	ok(text.indexOf(PARSE_CASES.length + ' title and channel pairs') >= 0, 'README.md states the size of the parse table (' + PARSE_CASES.length + ')');
	var setup = ['YouTube Data API v3', 'External', 'Testing', 'Test users', 'https://www.googleapis.com/auth/youtube.readonly', 'Web application', 'https://nietztein.github.io', 'https://nietztein.github.io/misc/101-true-shuffle/', 'config.js', 'Google hasn\'t verified this app'];
	var at = -1, inOrder = true;
	var from = text.indexOf('## Setup in Google Cloud');
	setup.forEach(function (s) { var i = text.indexOf(s, from); if (i < 0 || i < at) inOrder = false; at = Math.max(at, i); });
	ok(from > 0 && inOrder, 'README.md has the owner\'s setup steps, in order: project, API, consent screen, test user, scope, client, origin, redirect URI, client id, the unverified-app screen');
	var parseKeys = Object.keys(require('./parse.js').RULES), undocumented = parseKeys.filter(function (r) { return r !== 'dash-multi' && r !== 'dash-loose' && r !== 'quote-only' && r !== 'classical-work-performer' && r !== 'channel-official-video' && r !== 'channel-prefix' && text.indexOf(r) < 0; });
	eq(undocumented, [], 'README.md shows the main parser rules by name');
});

// =============================================================================
// run
// =============================================================================

(async function main() {
	var only = process.argv.slice(2);
	for (var i = 0; i < SECTIONS.length; i++) {
		var s = SECTIONS[i];
		if (only.length && only.indexOf(s.name) < 0) continue;
		section = s.name;
		try { await s.fn(); }
		catch (e) { ok(false, 'section threw: ' + (e && e.stack || e)); }
	}
	console.log('');
	if (failed) {
		console.log(failed + ' FAILED, ' + passed + ' passed');
		failures.forEach(function (f) { console.log('  - ' + f.split('\n')[0]); });
		process.exit(1);
	}
	console.log('all ' + passed + ' checks passed');
})();
