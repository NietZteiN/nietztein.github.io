// Readers for the four files of the Electronic Dictionary Research and
// Development Group (EDRDG) that the kit uses, fetched from the Group's own
// servers: KANJIDIC2, KRADFILE, RADKFILE and JMdict (English).
//
// These files are rebuilt by the EDRDG (JMdict daily), and the server keeps
// only the newest, so a download on another day is a newer edition with
// another hash. The build is repeatable from scripts/lang/.cache/; the hash
// and day of what was fetched are recorded in each data file's meta.

import zlib from 'node:zlib';
import { fetchCached } from './lib.mjs';

export const EDRDG_LICENCE_URL = 'https://www.edrdg.org/edrdg/licence.html';
// Over HTTPS from www.edrdg.org (the ftp host of the same files has no valid certificate).
export const URLS = {
	kanjidic2: 'https://www.edrdg.org/kanjidic/kanjidic2.xml.gz',
	kradfile: 'https://www.edrdg.org/pub/Nihongo/kradfile.gz',
	radkfile: 'https://www.edrdg.org/pub/Nihongo/radkfile.gz',
	jmdict: 'https://www.edrdg.org/pub/Nihongo/JMdict_e.gz',
};

function xmlText(s) {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');
}
function elements(xml, tag) {
	// The text of every <tag ...>text</tag> directly present in `xml`.
	const out = [];
	const re = new RegExp('<' + tag + '(?: [^>]*)?>([\\s\\S]*?)</' + tag + '>', 'g');
	for (const m of xml.matchAll(re)) out.push(m[1]);
	return out;
}
function source(r) {
	return { url: r.url, sha256: r.sha256, fetched: r.fetched };
}

// ---- KANJIDIC2 ------------------------------------------------------------------

// Returns { source, databaseVersion, dateOfCreation, characters: [{ literal,
// grade, strokes, freq, on, kun, meanings, codepoints: { ucs, jis208, ... },
// variants: [literal, ...] }] }.
// `meanings` are the English ones (the <meaning> elements without m_lang);
// `strokes` is the first <stroke_count> (the later ones are common miscounts).
// `variants` are the characters the record cross-references (<variant>), for
// the references given as a code point or a JIS position; references given as
// an entry number of a printed dictionary are left out.
export async function loadKanjidic2() {
	const r = await fetchCached(URLS.kanjidic2, 'edrdg-kanjidic2.xml.gz');
	const xml = zlib.gunzipSync(r.buf).toString('utf8');
	const databaseVersion = (/<database_version>([^<]+)<\/database_version>/.exec(xml) || [])[1];
	const dateOfCreation = (/<date_of_creation>([^<]+)<\/date_of_creation>/.exec(xml) || [])[1];
	const characters = [];
	for (const m of xml.matchAll(/<character>([\s\S]*?)<\/character>/g)) {
		const c = m[1];
		const literal = /<literal>([^<]+)<\/literal>/.exec(c)[1];
		const grade = /<grade>(\d+)<\/grade>/.exec(c);
		const strokeCounts = elements(c, 'stroke_count').map(Number);
		const freq = /<freq>(\d+)<\/freq>/.exec(c);
		const groups = elements(c, 'rmgroup');
		if (groups.length > 1) throw new Error('KANJIDIC2: more than one reading group for ' + literal);
		const g = groups[0] || '';
		const on = [];
		const kun = [];
		for (const x of g.matchAll(/<reading r_type="(ja_on|ja_kun)"[^>]*>([^<]*)<\/reading>/g)) (x[1] === 'ja_on' ? on : kun).push(xmlText(x[2]));
		const meanings = [];
		for (const x of g.matchAll(/<meaning>([^<]*)<\/meaning>/g)) meanings.push(xmlText(x[1]));
		const codepoints = {};
		for (const x of c.matchAll(/<cp_value cp_type="([^"]+)">([^<]+)<\/cp_value>/g)) codepoints[x[1]] = x[2];
		const variantRefs = [...c.matchAll(/<variant var_type="([^"]+)">([^<]+)<\/variant>/g)].map((x) => [x[1], x[2]]);
		characters.push({ literal, grade: grade ? +grade[1] : null, strokes: strokeCounts[0], strokeCounts, freq: freq ? +freq[1] : null, on, kun, meanings, codepoints, variantRefs });
	}
	if (!databaseVersion || characters.length < 10000) throw new Error('KANJIDIC2 did not parse');
	// A cross-reference names a character by code point (ucs) or by its position
	// in JIS X 0208, 0212 or 0213; the positions are resolved through the
	// <cp_value> of the characters themselves.
	const byPosition = new Map();
	for (const c of characters) for (const [type, value] of Object.entries(c.codepoints)) if (type !== 'ucs') byPosition.set(type + ':' + value, c.literal);
	for (const c of characters) {
		const seen = new Set();
		for (const [type, value] of c.variantRefs) {
			const literal = type === 'ucs' ? String.fromCodePoint(parseInt(value, 16)) : byPosition.get(type + ':' + value);
			if (literal && literal !== c.literal) seen.add(literal);
		}
		c.variants = [...seen];
		delete c.variantRefs;
	}
	return { source: source(r), databaseVersion, dateOfCreation, characters };
}

// The 2,136 joyo kanji as KANJIDIC2 grades them: 1 to 6 are the six years of
// primary school, 8 is "the rest of the joyo set" (secondary school).
export function isJoyoGrade(grade) {
	return (grade >= 1 && grade <= 6) || grade === 8;
}

// Other forms of the joyo kanji: Map(kanji that is not joyo -> joyo kanji),
// for every kanji of KANJIDIC2 outside the joyo list that is cross-referenced
// with exactly one kanji on it (in its own record or in the joyo kanji's).
// That covers the older forms (the one KANJIDIC2 gives for "love" in the old
// style points at the joyo one) and the JIS X 0208 forms that the 2010 list
// replaced by forms from outside that set. A kanji cross-referenced with two
// joyo kanji is left out: there is no saying which one it stands for.
export function joyoAliases(kd) {
	const joyo = new Set(kd.characters.filter((c) => isJoyoGrade(c.grade)).map((c) => c.literal));
	const targets = new Map();
	const add = (other, joyoKanji) => {
		if (!targets.has(other)) targets.set(other, new Set());
		targets.get(other).add(joyoKanji);
	};
	for (const c of kd.characters) {
		for (const v of c.variants) {
			if (!joyo.has(c.literal) && joyo.has(v)) add(c.literal, v);
			if (joyo.has(c.literal) && !joyo.has(v)) add(v, c.literal);
		}
	}
	const aliases = new Map();
	const ambiguous = [];
	for (const [other, set] of [...targets].sort((a, b) => a[0].codePointAt(0) - b[0].codePointAt(0))) {
		if (set.size === 1) aliases.set(other, [...set][0]);
		else ambiguous.push(other);
	}
	return { aliases, ambiguous };
}

// ---- KRADFILE and RADKFILE ---------------------------------------------------------

function eucJp(buf) {
	return new TextDecoder('euc-jp', { fatal: true }).decode(buf);
}

// Returns { source, parts: Map(kanji -> [element, ...]), standIns: Map(element
// -> character) }. `standIns` is read from the file's own header: KRADFILE
// writes an element that is not in JIS X 0208 as a kanji that contains it, and
// lists the Unicode character of the real shape for each.
export async function loadKradfile() {
	const r = await fetchCached(URLS.kradfile, 'edrdg-kradfile.gz');
	const text = eucJp(zlib.gunzipSync(r.buf));
	const parts = new Map();
	const standIns = new Map();
	for (const line of text.split('\n')) {
		if (!line) continue;
		if (line.startsWith('#')) {
			const m = /^# (\S+) U\+([0-9A-F]{4,6})\s*$/.exec(line);
			if (m && [...m[1]].length === 1) standIns.set(m[1], String.fromCodePoint(parseInt(m[2], 16)));
			continue;
		}
		const m = /^(\S+) : (.+)$/.exec(line);
		if (!m || [...m[1]].length !== 1) throw new Error('KRADFILE: cannot read the line ' + line);
		if (parts.has(m[1])) throw new Error('KRADFILE: two lines for ' + m[1]);
		parts.set(m[1], m[2].trim().split(/\s+/));
	}
	if (parts.size !== 6355) throw new Error(`KRADFILE: ${parts.size} kanji, expected the 6,355 of JIS X 0208`);
	if (standIns.size !== 22) throw new Error(`KRADFILE: ${standIns.size} stand-in elements in the header, expected 22`);
	return { source: source(r), parts, standIns };
}

// Returns { source, strokes: Map(element -> stroke count) } from the "$" lines.
export async function loadRadkfile() {
	const r = await fetchCached(URLS.radkfile, 'edrdg-radkfile.gz');
	const text = eucJp(zlib.gunzipSync(r.buf));
	const strokes = new Map();
	for (const line of text.split('\n')) {
		if (!line.startsWith('$')) continue;
		const m = /^\$ (\S+) (\d+)(?: \S+)?\s*$/.exec(line);
		if (!m) throw new Error('RADKFILE: cannot read the line ' + line);
		strokes.set(m[1], +m[2]);
	}
	if (strokes.size < 200) throw new Error('RADKFILE did not parse');
	return { source: source(r), strokes };
}

// ---- JMdict ------------------------------------------------------------------------

// Returns { source, created, entities: Map(code -> description), entries: [{
//   seq,
//   k: [{ text, info: [codes], pri: [tags] }],
//   r: [{ text, noKanji, restr: [kanji forms], info: [codes], pri: [tags] }],
//   s: [{ stagk, stagr, pos: [codes], field: [codes], misc: [codes], dial: [codes], gloss: [strings] }] }] }.
// Part-of-speech, field, misc and dialect values are entity references in the
// file (&n; and so on); the entity names are the codes, and their definitions
// in the DTD are the descriptions.
export async function loadJmdict() {
	const r = await fetchCached(URLS.jmdict, 'edrdg-JMdict_e.gz');
	const xml = zlib.gunzipSync(r.buf).toString('utf8');
	const start = xml.indexOf('<JMdict>');
	const created = (/<!-- JMdict created: (\d{4}-\d{2}-\d{2}) -->/.exec(xml) || [])[1];
	const entities = new Map();
	for (const m of xml.slice(0, start).matchAll(/<!ENTITY (\S+) "([^"]*)">/g)) entities.set(m[1], m[2]);
	const codes = (x, tag) =>
		elements(x, tag).map((v) => {
			const m = /^&([^;]+);$/.exec(v);
			if (!m || !entities.has(m[1])) throw new Error(`JMdict: <${tag}> holds ${v}, not a known entity`);
			return m[1];
		});
	const entries = [];
	for (const m of xml.slice(start).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
		const e = m[1];
		const seq = /<ent_seq>(\d+)<\/ent_seq>/.exec(e)[1];
		const k = elements(e, 'k_ele').map((x) => ({ text: xmlText(elements(x, 'keb')[0]), info: codes(x, 'ke_inf'), pri: elements(x, 'ke_pri') }));
		const rr = elements(e, 'r_ele').map((x) => ({
			text: xmlText(elements(x, 'reb')[0]),
			noKanji: x.includes('<re_nokanji/>'),
			restr: elements(x, 're_restr').map(xmlText),
			info: codes(x, 're_inf'),
			pri: elements(x, 're_pri'),
		}));
		const s = elements(e, 'sense').map((x) => ({
			stagk: elements(x, 'stagk').map(xmlText),
			stagr: elements(x, 'stagr').map(xmlText),
			pos: codes(x, 'pos'),
			field: codes(x, 'field'),
			misc: codes(x, 'misc'),
			dial: codes(x, 'dial'),
			gloss: elements(x, 'gloss').map(xmlText),
		}));
		// The DTD lets a sense inherit the part of speech of the sense before it.
		for (let i = 1; i < s.length; i++) if (s[i].pos.length === 0) s[i].pos = s[i - 1].pos;
		if (!rr.length || !s.length) throw new Error('JMdict: entry ' + seq + ' has no reading or no sense');
		entries.push({ seq, k, r: rr, s });
	}
	if (!created || entries.length < 150000) throw new Error('JMdict did not parse');
	return { source: source(r), created, entities, entries };
}

// The priority tags that make JMdict call an entry "common" (the entries
// marked (P) in EDICT). From the JMdict documentation, "ke_pri"/"re_pri":
// news1, ichi1, spec1, spec2 and gai1.
export const COMMON_TAGS = new Set(['news1', 'ichi1', 'spec1', 'spec2', 'gai1']);

// The smallest nfNN among priority tags (1 to 48: the NN-th block of 500
// words in the newspaper frequency file), or 0 when there is none.
export function nfBand(pri) {
	let best = 0;
	for (const p of pri) {
		const m = /^nf(\d\d)$/.exec(p);
		if (m && (best === 0 || +m[1] < best)) best = +m[1];
	}
	return best;
}
