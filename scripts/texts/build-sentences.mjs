/*
 * Builds misc/_texts/sentences.js : short everyday sentences in about fifty languages, for a
 * "which language is this" game.
 *
 *     node scripts/texts/build-sentences.mjs [--offline] [--review]
 *
 * Source: Tatoeba (tatoeba.org), through its public API (api.tatoeba.org/v1/sentences), because
 * the bulk exports are bz2 archives, which Node cannot read without a package. Sentences are
 * CC BY 2.0 FR; each one keeps its Tatoeba number and the user name of its owner.
 *
 * How a language is sampled, the same way for every language:
 *   1. Ask for sentences that are owned (not orphaned), approved, written by a self-declared
 *      native speaker, licensed
 *      CC BY 2.0 FR, of 4 to 10 words, and that have a direct English translation. Tatoeba
 *      counts characters, not words, for languages written without spaces: Japanese and
 *      Chinese are asked for at 8 to 22 characters, Thai and Khmer at 10 to 30. Order:
 *      Tatoeba's seeded random order, sort=random:SEED, which gives the same order on every
 *      request. 50 sentences come per request.
 *   2. Walk that order and drop a sentence when it fails one of the mechanical tests in
 *      `reject` below (length, digits, script, an English translation that touches a topic
 *      on the screen list, a repeat, a text also seen under another language). Stop at
 *      PER_LANG kept; fetch the next page when the first is not enough.
 * Nothing is edited: the text of a kept sentence is exactly what the API returned.
 *
 * The English translation that comes with each sentence (the direct one with the lowest
 * number) is also a Tatoeba sentence and is credited the same way. It is there so that a
 * game can show what the sentence means; it is also what the topic screen reads.
 *
 * The translation is whatever Tatoeba links, and its links are not always exact: a pronoun
 * or a number can differ from the sentence (kor #11597162 is paired with "They entered the
 * forest."), and some pairs are loose. Nothing here checks or repairs that.
 *
 * Every language is asked for with the native-speaker filter; there is no exception. The
 * first build made one, for Swahili, because only 4 Swahili sentences pass the filter with
 * the length range above. The 25 it then took all belonged to one contributor, whose
 * Tatoeba profile (read on 2026-10-05) gives Spanish at level 5 (native) and does not list
 * Swahili (swh) at all; the nearest entry is Congo Swahili (swc) at level 2 of 5. A reviewer judged that they read like word-for-word renderings of English. Asked on
 * 2026-10-05 at any length, Tatoeba has nine Swahili sentences by self-declared native
 * speakers with an English translation: not enough for an entry, so Swahili is left out
 * rather than shown in a learner's version.
 *
 * --review prints every kept sentence with its translation, for reading.
 */
import { get, writeData, requestCount } from './lib.mjs';
import { LD_EN, englishEntries } from './blocked.mjs';

const API = 'https://api.tatoeba.org/v1/sentences';
const SEED = 20261003;
const PER_LANG = 25;
const MAX_PAGES = 12;
const REVIEW = process.argv.includes('--review');

/* code, Tatoeba (ISO 639-3) code, English name, ISO 15924 script, family, branch, options.
 *   only:     keep sentences in this one script of a language written in two
 *   count:    Tatoeba counts this language in characters, not words; the range to ask for
 *   pool:     two entries that read the same API pages */
const LANGS = [
	['deu', 'deu', 'German', 'Latn', 'Indo-European', 'Germanic'],
	['nld', 'nld', 'Dutch', 'Latn', 'Indo-European', 'Germanic'],
	['afr', 'afr', 'Afrikaans', 'Latn', 'Indo-European', 'Germanic'],
	['swe', 'swe', 'Swedish', 'Latn', 'Indo-European', 'Germanic'],
	['dan', 'dan', 'Danish', 'Latn', 'Indo-European', 'Germanic'],
	['nob', 'nob', 'Norwegian (Bokmål)', 'Latn', 'Indo-European', 'Germanic'],
	['isl', 'isl', 'Icelandic', 'Latn', 'Indo-European', 'Germanic'],
	['fra', 'fra', 'French', 'Latn', 'Indo-European', 'Romance'],
	['spa', 'spa', 'Spanish', 'Latn', 'Indo-European', 'Romance'],
	['por', 'por', 'Portuguese', 'Latn', 'Indo-European', 'Romance'],
	['ita', 'ita', 'Italian', 'Latn', 'Indo-European', 'Romance'],
	['ron', 'ron', 'Romanian', 'Latn', 'Indo-European', 'Romance'],
	['cat', 'cat', 'Catalan', 'Latn', 'Indo-European', 'Romance'],
	['rus', 'rus', 'Russian', 'Cyrl', 'Indo-European', 'Slavic'],
	['ukr', 'ukr', 'Ukrainian', 'Cyrl', 'Indo-European', 'Slavic'],
	['bul', 'bul', 'Bulgarian', 'Cyrl', 'Indo-European', 'Slavic'],
	['srp', 'srp', 'Serbian (Cyrillic)', 'Cyrl', 'Indo-European', 'Slavic', { only: 'Cyrl' }],
	['mkd', 'mkd', 'Macedonian', 'Cyrl', 'Indo-European', 'Slavic'],
	['pol', 'pol', 'Polish', 'Latn', 'Indo-European', 'Slavic'],
	['ces', 'ces', 'Czech', 'Latn', 'Indo-European', 'Slavic'],
	['slk', 'slk', 'Slovak', 'Latn', 'Indo-European', 'Slavic'],
	['lit', 'lit', 'Lithuanian', 'Latn', 'Indo-European', 'Baltic'],
	['lvs', 'lvs', 'Latvian', 'Latn', 'Indo-European', 'Baltic'],
	['ell', 'ell', 'Greek', 'Grek', 'Indo-European', 'Hellenic'],
	['hye', 'hye', 'Armenian', 'Armn', 'Indo-European', 'Armenian'],
	['pes', 'pes', 'Persian', 'Arab', 'Indo-European', 'Iranian'],
	['urd', 'urd', 'Urdu', 'Arab', 'Indo-European', 'Indo-Aryan'],
	['hin', 'hin', 'Hindi', 'Deva', 'Indo-European', 'Indo-Aryan'],
	['mar', 'mar', 'Marathi', 'Deva', 'Indo-European', 'Indo-Aryan'],
	['ben', 'ben', 'Bengali', 'Beng', 'Indo-European', 'Indo-Aryan'],
	['fin', 'fin', 'Finnish', 'Latn', 'Uralic', 'Finnic'],
	['est', 'est', 'Estonian', 'Latn', 'Uralic', 'Finnic'],
	['hun', 'hun', 'Hungarian', 'Latn', 'Uralic', 'Ugric'],
	['tur', 'tur', 'Turkish', 'Latn', 'Turkic', 'Oghuz'],
	['ara', 'ara', 'Arabic', 'Arab', 'Afro-Asiatic', 'Semitic'],
	['heb', 'heb', 'Hebrew', 'Hebr', 'Afro-Asiatic', 'Semitic'],
	['kat', 'kat', 'Georgian', 'Geor', 'Kartvelian', 'Georgian'],
	['eus', 'eus', 'Basque', 'Latn', 'Language isolate', 'Basque'],
	// no Swahili: see the comment at the top
	['tam', 'tam', 'Tamil', 'Taml', 'Dravidian', 'Southern Dravidian'],
	['tha', 'tha', 'Thai', 'Thai', 'Kra–Dai', 'Tai', { count: '10-30' }],
	['khm', 'khm', 'Khmer', 'Khmr', 'Austroasiatic', 'Khmer', { count: '10-30' }],
	['vie', 'vie', 'Vietnamese', 'Latn', 'Austroasiatic', 'Vietic'],
	['ind', 'ind', 'Indonesian', 'Latn', 'Austronesian', 'Malayic'],
	['zsm', 'zsm', 'Malay', 'Latn', 'Austronesian', 'Malayic'],
	['tgl', 'tgl', 'Tagalog', 'Latn', 'Austronesian', 'Philippine'],
	['jpn', 'jpn', 'Japanese', 'Jpan', 'Japonic', 'Japanese', { count: '8-22' }],
	['kor', 'kor', 'Korean', 'Hang', 'Koreanic', 'Korean'],
	['cmn-Hans', 'cmn', 'Chinese (Mandarin, simplified characters)', 'Hans', 'Sino-Tibetan', 'Sinitic', { only: 'Hans', count: '8-22', pool: 'cmn' }],
	['cmn-Hant', 'cmn', 'Chinese (Mandarin, traditional characters)', 'Hant', 'Sino-Tibetan', 'Sinitic', { only: 'Hant', count: '8-22', pool: 'cmn' }],
].map(([code, iso, name, script, family, branch, opt]) => Object.assign({ code, iso, name, script, family, branch, pool: code }, opt || {}));

/* Groups whose members are easy to take for one another: the builder's judgement, for a game
 * that wants hard wrong answers. */
const LOOKALIKES = [
	['dan', 'nob', 'swe'],
	['nld', 'afr'],
	['ces', 'slk'],
	['bul', 'srp', 'mkd'],
	['rus', 'ukr'],
	['zsm', 'ind'],
	['hin', 'mar'],
	['pes', 'ara', 'urd'],
	['jpn', 'kor', 'cmn-Hans', 'cmn-Hant'],
	['spa', 'por', 'cat', 'ita'],
	['fin', 'est'],
	['lit', 'lvs'],
	['tha', 'khm'],
];

/* The topic screen, read against the English translations (lower-cased; whole words, or a
 * prefix when the entry ends in "*"). LDNOOBW's English list is added to it. The aim is a set
 * of sentences nobody minds being shown at random: no death, violence, sex, drink and drugs,
 * religion, politics, illness or insults. Written by the builder; it throws out many harmless
 * sentences too, which costs nothing. "tom" and "mary" are on it because Tatoeba uses those
 * two names in a large share of its sentences, and a game would show little else. After the
 * first selection the builder read all the English translations and added the last two lines
 * and the phrases. */
const SCREEN = ('kill* murder* die died dies dying dead death* deadly suicid* corpse* funeral* grave* buried bury* ' +
	'shoot* shot gun guns weapon* knife knives stab* bomb* war wars warfare battle* soldier* army armies militar* enemy enemies attack* invad* invasion* terror* hostage* ' +
	'rape* raping sex sexy sexual* naked nude porn* prostitut* virgin* condom* pregnan* abort* breast* penis vagina* ' +
	'drunk* drug* cocaine heroin marijuana weed alcohol* vodka whisk* beer beers wine wines smok* cigar* ' +
	'hate hates hated hatred stupid* idiot* fool* ugly fat dumb* liar* moron* jerk* bastard* crazy insane mad ' +
	'god gods goddess* jesus christ* allah bible* quran koran church* mosque* pray* priest* muslim* jew jews jewish islam* hindu* buddh* satan* devil* hell heaven* sin sins religio* atheis* ' +
	'nazi* hitler racis* slave* communis* fascis* president* politic* election* govern* democra* dictator* trump putin biden obama stalin israel* palestin* gaza russia* ukrain* nato soviet* ' +
	'prison* jail* arrest* police* crime* criminal* thief thieves steal* stole* rob robbed robber* guilty victim* ' +
	'cancer* disease* tumor* aids virus* epidemic* pandemic* covid* corona* disabled blind deaf wound* injur* blood* bleed* hospital* surgery ambulance* poison* ' +
	'divorce* cheat* affair* gay lesbian homosexual* transgender* ' +
	'toilet* piss* pee poop* fart* vomit* puke* butt butts ass ' +
	'beat beats beaten hit hits hurt hurts pain* cry cries crying cried scream* suffer* torture* hang hanged burn* drown* fire fired ' +
	'refugee* immigra* foreigner* race races beggar* ' +
	// added after reading the first selection
	'fatal* starv* orphan* whip* alive infect* handgun* pistol* rifle* halal kosher hijab* ramadan monk* nun nuns spirit* flesh vot* patriot* feminis* ' +
	// names and a topic that a few prolific contributors use in thousands of sentences
	'tom mary sami layla fadil yanni ziri skura algeria*').split(' ');
const SCREEN_PHRASES = ['passed away', 'little girl', 'my lap', 'shut up'];

function makeScreen(extra) {
	const whole = new Set();
	const prefixes = [];
	for (const entry of SCREEN) {
		if (entry.endsWith('*')) prefixes.push(entry.slice(0, -1));
		else whole.add(entry);
	}
	for (const entry of extra) if (/^[a-z]+$/.test(entry)) whole.add(entry);
	const phrases = SCREEN_PHRASES.concat(extra.filter((e) => / /.test(e)));
	return function (english) {
		const lower = english.toLowerCase();
		for (const word of lower.match(/[a-z]+/g) || []) {
			if (whole.has(word)) return word;
			for (const p of prefixes) if (word.startsWith(p)) return p + '*';
		}
		for (const phrase of phrases) if (lower.includes(phrase)) return phrase;
		return '';
	};
}

function query(lang, after) {
	const params = [
		['lang', lang.iso],
		['word_count', lang.count || '4-10'],
		['is_orphan', 'no'],
		['is_unapproved', 'no'],
		['is_native', 'yes'],
		['license', 'CC BY 2.0 FR'],
		['trans:lang', 'eng'],
		['trans:is_direct', 'yes'],
		['showtrans:lang', 'eng'],
		['showtrans:is_direct', 'yes'],
		['sort', 'random:' + SEED],
		['limit', '50'],
	];
	if (lang.only) params.push(['include', 'transcriptions']);
	if (after) params.push(['after', after]);
	return API + '?' + params.filter(([, v]) => v !== '').map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
}

const LATIN = /\p{Script=Latin}/u;
const SCRIPT_TEST = {
	Latn: /\p{Script=Latin}/u, Cyrl: /\p{Script=Cyrillic}/u, Grek: /\p{Script=Greek}/u, Armn: /\p{Script=Armenian}/u,
	Arab: /\p{Script=Arabic}/u, Hebr: /\p{Script=Hebrew}/u, Deva: /\p{Script=Devanagari}/u, Beng: /\p{Script=Bengali}/u,
	Taml: /\p{Script=Tamil}/u, Thai: /\p{Script=Thai}/u, Khmr: /\p{Script=Khmer}/u, Geor: /\p{Script=Georgian}/u, Hang: /\p{Script=Hangul}/u,
	Jpan: /[\p{Script=Hiragana}\p{Script=Katakana}]/u, Hans: /\p{Script=Han}/u, Hant: /\p{Script=Han}/u,
};
// Quotation marks, brackets, colons, dashes and ellipses: signs of a sentence that is not one plain sentence.
// (The semicolon is left alone: it is the Greek question mark.)
const FUSSY = new RegExp('["()\\[\\]:' + String.fromCharCode(0x201C, 0x201D, 0x201E, 0xAB, 0xBB, 0x2013, 0x2014, 0x2015, 0x2026, 0x300C, 0x300D, 0x300E, 0x300F) + ']|--|\\.\\.\\.');

function lengthRange(lang) {
	if (lang.script === 'Jpan' || lang.script === 'Hans' || lang.script === 'Hant') return [7, 24];
	if (lang.script === 'Hang' || lang.script === 'Thai' || lang.script === 'Khmr') return [8, 40];
	return [14, 60];
}

const bad = await get(LD_EN[1], LD_EN[2]);
const screen = makeScreen(englishEntries(bad.text));

function englishOf(s) {
	return (s.translations || []).filter((t) => t.lang === 'eng' && t.is_direct && !t.is_unapproved && t.license === 'CC BY 2.0 FR').sort((a, b) => a.id - b.id);
}

const pools = new Map();        // pool name -> { lang, pages: [[sentence...]], after, total, done, sources }
const everyText = new Map();    // exact text -> set of ISO codes it was fetched under

async function page(lang, n) {
	if (!pools.has(lang.pool)) pools.set(lang.pool, { lang, pages: [], after: '', total: 0, done: false, sources: [] });
	const p = pools.get(lang.pool);
	while (p.pages.length < n && !p.done) {
		const r = await get('tatoeba/' + lang.pool + '-' + SEED + '-p' + (p.pages.length + 1) + '.json', query(p.lang, p.after));
		p.sources.push(r.source);
		const j = JSON.parse(r.text);
		if (typeof j.paging.total === 'number') p.total = j.paging.total;
		p.pages.push(j.data);
		for (const s of j.data) {
			if (!everyText.has(s.text)) everyText.set(s.text, new Set());
			everyText.get(s.text).add(s.lang);
		}
		if (!j.paging.has_next) p.done = true;
		else p.after = new URL(j.paging.next).searchParams.get('after');
	}
	return p.pages[n - 1] || null;
}

/** Why a sentence is not kept, or '' when it is fine. */
function reject(lang, s, state) {
	if (s.lang !== lang.iso) return 'language';
	if (s.license !== 'CC BY 2.0 FR') return 'licence';
	if (!s.owner) return 'no owner';
	const text = s.text;
	if (lang.only) {
		// Tatoeba names the script of a Chinese sentence; for Serbian it gives none, so look at the letters.
		const detected = s.script || (SCRIPT_TEST[lang.only].test(text) && !LATIN.test(text) ? lang.only : 'other');
		if (detected !== lang.only) return 'other script';
	}
	if (text !== text.trim() || /[\n\r\t]/.test(text) || / {2}/.test(text)) return 'spacing';
	if (text !== text.normalize('NFC')) return 'not NFC';
	const [min, max] = lengthRange(lang);
	const length = [...text].length;
	if (length < min) return 'too short';
	if (length > max) return 'too long';
	if (/\p{Nd}/u.test(text)) return 'digits';
	if (!SCRIPT_TEST[lang.script].test(text)) return 'no letter of the script';
	if (lang.script !== 'Latn' && LATIN.test(text)) return 'Latin letters in another script';
	if (FUSSY.test(text)) return 'quotation marks, brackets, colons or dashes';
	if (lang.pool !== lang.code) {
		// Chinese: the sentence must be written differently in the other script, or nobody can tell which it is.
		const other = (s.transcriptions || []).find((t) => t.type === 'altscript');
		if (!other || other.text === text) return 'same in both scripts';
	}
	const english = englishOf(s);
	if (!english.length) return 'no usable English translation';
	for (const t of s.translations || []) if (screen(t.text)) return 'topic screen';
	if (everyText.get(text).size > 1) return 'same text under another language';
	const key = text.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
	if (state.seen.has(key)) return 'repeat';
	const enKey = english[0].text.toLowerCase().replace(/[^a-z]+/g, '');
	if (state.seenEn.has(enKey)) return 'same translation as another kept sentence';
	state.seen.add(key);
	state.seenEn.add(enKey);
	return '';
}

async function select() {
	const results = [];
	for (const lang of LANGS) {
		const state = { seen: new Set(), seenEn: new Set() };
		const kept = [];
		const why = {};
		let read = 0, pagesUsed = 0;
		for (let n = 1; n <= MAX_PAGES && kept.length < PER_LANG; n++) {
			const data = await page(lang, n);
			if (!data) break;
			pagesUsed = n;
			for (const s of data) {
				if (kept.length >= PER_LANG) break;
				read++;
				const r = reject(lang, s, state);
				if (r) { why[r] = (why[r] || 0) + 1; continue; }
				const en = englishOf(s)[0];
				kept.push({ id: s.id, text: s.text, by: s.owner, en: { id: en.id, text: en.text, by: en.owner || '' } });
			}
		}
		results.push({ lang, kept, why, read, pagesUsed });
	}
	return results;
}

// A later language can add pages, and with them texts that an earlier language also has.
// Select again until a pass fetches nothing new, so that the result does not depend on the order.
let results = null;
for (let pass = 1; pass <= 6; pass++) {
	const before = [...pools.values()].reduce((sum, p) => sum + p.pages.length, 0);
	results = await select();
	const after = [...pools.values()].reduce((sum, p) => sum + p.pages.length, 0);
	if (pass > 1 && after === before) break;
	if (pass === 6) throw new Error('the selection did not settle');
}

const sources = [bad.source];
for (const lang of LANGS) if (lang.pool === lang.code || lang.code === 'cmn-Hans') sources.push(...pools.get(lang.pool).sources);
const tally = {};
for (const r of results) for (const k of Object.keys(r.why)) tally[k] = (tally[k] || 0) + r.why[k];

const langs = results.map((r) => ({
	code: r.lang.code, iso: r.lang.iso, name: r.lang.name, script: r.lang.script, family: r.lang.family, branch: r.lang.branch,
	sentences: r.kept,
}));
const count = langs.reduce((sum, l) => sum + l.sentences.length, 0);
const fetched = [...pools.values()].reduce((sum, p) => sum + p.pages.reduce((a, d) => a + d.length, 0), 0);
const owners = new Set();
for (const l of langs) for (const s of l.sentences) owners.add(s.by);
const sizes = langs.map((l) => l.sentences.length);

const data = {
	meta: {
		sources,
		licence: 'CC BY 2.0 FR',
		credit: 'Sentences and their English translations: Tatoeba (tatoeba.org), each by the contributor named with it, CC BY 2.0 FR (https://creativecommons.org/licenses/by/2.0/fr/).',
		licenceUrl: 'https://creativecommons.org/licenses/by/2.0/fr/',
		attribution: 'Tatoeba #{id} by {by}',
		attributionNote: 'For toy builders, not for the page: the licence asks that every author be credited. Show each sentence with its own number and owner, and the English translation with its own (en.id, en.by), by filling the pattern in attribution. Where en.by is empty the translation has no owner on Tatoeba: show "Tatoeba #" and the number alone.',
		translationNote: 'en is the lowest-numbered direct English translation that Tatoeba links to the sentence. The links are made by contributors and are not always exact: a pronoun or a number can differ from the sentence (kor #11597162 is one such pair), and some pairs are loose. Present en as a translation found on Tatoeba, not as the one meaning of the sentence.',
		kept: count.toLocaleString('en-US') + ' sentences in ' + langs.length + ' languages (' + Math.min(...sizes) + ' to ' + Math.max(...sizes) +
			' each), each with one direct English translation; text exactly as the API returned it',
		dropped: 'of the ' + fetched.toLocaleString('en-US') + ' sentences fetched: those read before the quota of ' + PER_LANG + ' was full that failed a test (' +
			Object.keys(tally).sort((a, b) => tally[b] - tally[a]).map((k) => k + ': ' + tally[k]).join('; ') +
			'), and everything after the ' + PER_LANG + 'th kept sentence of a language',
		seed: SEED,
		sampling: 'Tatoeba API v1, sort=random:' + SEED + ' (a seeded order that repeats), filters: owned, approved, owner is a self-declared native speaker, CC BY 2.0 FR, has a direct English translation, 4 to 10 words (8 to 22 characters for Japanese and Chinese, 10 to 30 for Thai and Khmer, which Tatoeba counts in characters). Every language was asked for with the native-speaker filter. A rebuild from the cache gives this file again; a rebuild without it asks the live corpus, which changes, so some sentences may differ.',
		sentenceUrl: 'https://tatoeba.org/en/sentences/show/{id}',
		oneOwner: langs.filter((l) => new Set(l.sentences.map((s) => s.by)).size === 1).map((l) => l.code),
		oneOwnerNote: 'codes whose sentences all belong to one contributor (a self-declared native speaker, like every owner here): one person\'s usage, not a sample of the language',
		notIncluded: 'Swahili. Tatoeba has nine Swahili sentences by self-declared native speakers with an English translation (asked on 2026-10-05), too few for an entry; an earlier build took 25 from a single contributor whose Tatoeba profile does not give Swahili as a native language, and they were removed.',
		lookalikes: LOOKALIKES,
		lookalikesNote: 'groups of codes that are easy to take for one another (the builder\'s judgement, for choosing hard wrong answers)',
		owners: owners.size,
	},
	langs,
};

const body = '{\n"meta": ' + JSON.stringify(data.meta, null, '\t') + ',\n"langs": [\n' +
	langs.map((l) => '{"code": ' + JSON.stringify(l.code) + ', "iso": ' + JSON.stringify(l.iso) + ', "name": ' + JSON.stringify(l.name) + ', "script": ' + JSON.stringify(l.script) +
		', "family": ' + JSON.stringify(l.family) + ', "branch": ' + JSON.stringify(l.branch) + ', "sentences": [\n' +
		l.sentences.map((s) => '\t' + JSON.stringify(s)).join(',\n') + '\n]}').join(',\n') + '\n]\n}';
writeData('sentences.js', 'TEXTS_SENTENCES', [
	'misc/_texts/sentences.js : window.TEXTS_SENTENCES',
	'Short everyday sentences in ' + langs.length + ' languages, each with an English translation.',
	'Source: Tatoeba (tatoeba.org), CC BY 2.0 FR. Every sentence carries its Tatoeba number and owner.',
	'Built by scripts/texts/build-sentences.mjs. Do not edit by hand. See LICENSES.md.',
], body, data);

console.log('  requests made now: ' + requestCount() + '; API responses used: ' + (sources.length - 1) + '; sentences fetched: ' + fetched + '; kept: ' + count + '; owners: ' + owners.size);
for (const r of results) {
	console.log('  ' + r.lang.code.padEnd(9) + String(r.kept.length).padStart(3) + ' kept of ' + String(r.read).padStart(4) + ' read (' + r.pagesUsed + ' pages; ' + pools.get(r.lang.pool).total + ' match the query)  ' +
		Object.keys(r.why).sort((a, b) => r.why[b] - r.why[a]).map((k) => k + ' ' + r.why[k]).join(', '));
}
if (REVIEW) {
	for (const l of langs) {
		console.log('\n== ' + l.code + ' ' + l.name);
		for (const s of l.sentences) console.log('  #' + s.id + ' ' + s.by + ' | ' + s.text + ' | ' + s.en.text + ' (#' + s.en.id + ' ' + s.en.by + ')');
	}
}
