/*
 * Builds misc/_texts/glosses-de.js : English glosses for the 5,000 most frequent German word
 * forms of freq-de.js (run build-freq.mjs first).
 *
 *     node scripts/texts/build-glosses.mjs [--offline] [--review]
 *
 * No gloss is written here. Every gloss is a list of translations taken from WikDict, a
 * dictionary extracted from Wiktionary (through DBnary) and published under CC BY-SA.
 * The difficulty is that the frequency list holds word forms as they occur (ist, hat, männer,
 * all lower case) and a dictionary holds headwords (sein, haben, Mann). A form is therefore
 * matched to headwords in three mechanical ways:
 *   1. directly: a WikDict headword that equals the form when capitals are ignored
 *      ("weg" finds both weg, away, and Weg, way);
 *   2. through UniMorph's German table (inflected forms of nouns, verbs and adjectives,
 *      extracted from the English Wiktionary, CC BY-SA 3.0): "männer" is a form of Mann;
 *   3. through the German Wiktionary page of the form itself, whose German section names the
 *      base form in a {{Grundformverweis}} template: "ist" is a form of sein. This covers what
 *      UniMorph lacks: the verb sein, pronouns, articles.
 * For every headword found, the gloss is the start of WikDict's own ranked translation list
 * (simple_translation), kept to translations that WikDict marks as good and, when the form is
 * known to be a verb form, noun form or adjective form, to that part of speech. A translation
 * that contains a word of the English blocked list (LDNOOBW's English list and the builders'
 * additions, see blocked.mjs: the list that cmu-phones.js flags by) is left out. At most three translations per
 * headword and three headwords per form are kept, headwords ordered by WikDict's importance
 * score (rel_importance, about 0.1 to 3.3). The most important headword always stays. Another
 * one stays when its importance is at least 0.8, or at least 0.5 if it is spelled exactly like
 * the form. The two numbers were chosen by reading the candidates of the 1,500 most frequent
 * forms (--candidates prints them): below them sit readings like Es (the id) beside es (it).
 *
 * Three guards against a wrong gloss:
 *   - UniMorph lists the finite forms of separable verbs without their particle ("will" under
 *     zurückwollen). A verb lemma that begins with a separable particle is ignored unless the
 *     form begins with that particle too (or with "ge" before it).
 *   - A form of one letter gets no gloss, and a translation with wiki markup left in it is
 *     skipped.
 *   - When the German Wiktionary has a page for the lower-case form that defines a word of its
 *     own (not only an inflected form), and no gloss was found for that word or its base
 *     forms, a headword that matches only when capitals are ignored is kept only if WikDict
 *     gives it an importance of at least 1: "zeit" keeps Zeit (time), "des" does not keep
 *     Des (D flat).
 *
 * Forms flagged in freq-de.js as blocked get no gloss. Forms that are names, English words or
 * subtitle noise find no headword and get none either. A form with several readings gets
 * several headwords; nothing here knows which reading a sentence means.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { get, writeData, loadData, sha256, CACHE, OUT, requestCount } from './lib.mjs';
import { WIKT_PATTERN, batchesOf, batchUrl } from './dewikt.mjs';
import { LD_EN, englishEntries } from './blocked.mjs';

const FORMS = 5000;
const MAX_TRANSLATIONS = 3;
const MAX_HEADWORDS = 3;
const SECOND_FLOOR = 0.8;     // a second or third headword needs this importance,
const EXACT_FLOOR = 0.5;      // or this one when it is spelled exactly like the form
const ALONE_FLOOR = 1;        // see the third guard in the comment above
const REVIEW = process.argv.includes('--review');
const UM_COMMIT = 'd226d2112d3490d8f04ece10d4538123d4297a39';
const WIKDICT_URL = 'https://download.wikdict.com/dictionaries/sqlite/2/de-en.sqlite3';
const UM_URL = 'https://raw.githubusercontent.com/unimorph/deu/' + UM_COMMIT + '/deu';

const freqFile = path.join(OUT, 'freq-de.js');
if (!fs.existsSync(freqFile)) throw new Error('misc/_texts/freq-de.js is missing: run build-freq.mjs first');
const F = loadData(freqFile, 'TEXTS_FREQ_DE');
const forms = F.words.slice(0, FORMS);
const formSet = new Set(forms);
const blocked = new Set(F.blocked);

const wikdict = await get('wikdict/de-en.sqlite3', WIKDICT_URL);
const unimorph = await get('unimorph/deu.tsv', UM_URL);
const bad = await get(LD_EN[1], LD_EN[2]);
const badWords = new Set();
const badPhrases = [];
for (const entry of englishEntries(bad.text)) {
	if (/ /.test(entry)) badPhrases.push(entry); else badWords.add(entry);
}
function rude(translation) {
	const lower = translation.toLowerCase();
	for (const word of lower.match(/[a-z]+/g) || []) if (badWords.has(word)) return true;
	return badPhrases.some((p) => lower.includes(p));
}

/* WikDict: good translations per headword and part of speech, and the ranked list per headword. */
const db = new DatabaseSync(path.join(CACHE, 'wikdict', 'de-en.sqlite3'), { readOnly: true });
const good = new Map();         // headword -> Map(part of speech -> Set(translation))
for (const row of db.prepare('select lexentry, written_rep, trans_list from translation where is_good = 1 and lexentry is not null order by rowid').all()) {
	const m = /^deu\/(.*)__(.+?)__(\d+)$/.exec(row.lexentry);
	if (!m) continue;
	if (!good.has(row.written_rep)) good.set(row.written_rep, new Map());
	const byPos = good.get(row.written_rep);
	if (!byPos.has(m[2])) byPos.set(m[2], new Set());
	for (const t of row.trans_list.split(' | ')) byPos.get(m[2]).add(t);
}
const ranked = new Map();       // headword -> { list, importance }
for (const row of db.prepare('select written_rep, trans_list, rel_importance from simple_translation order by rowid').all()) {
	if (ranked.has(row.written_rep)) throw new Error('two simple_translation rows for ' + row.written_rep);
	ranked.set(row.written_rep, { list: row.trans_list.split(' | '), importance: row.rel_importance || 0 });
}
db.close();
const headsByLower = new Map();
for (const head of good.keys()) {
	const key = head.toLowerCase();
	if (!headsByLower.has(key)) headsByLower.set(key, []);
	headsByLower.get(key).push(head);
}
const VERB = ['Verb', 'Hilfsverb'];
const UM_POS = { N: ['Substantiv'], V: VERB, 'V.PTCP': VERB, ADJ: ['Adjektiv'] };

/* Candidate headwords of a form: headword -> null (any part of speech) or a Set of parts of speech. */
const candidates = new Map();
const routes = new Map();       // form -> Map(headword -> Set(route))
function propose(form, head, pos, route) {
	if (!candidates.has(form)) { candidates.set(form, new Map()); routes.set(form, new Map()); }
	const c = candidates.get(form);
	if (!c.has(head)) c.set(head, pos ? new Set(pos) : null);
	else if (c.get(head) !== null) { if (pos) for (const p of pos) c.get(head).add(p); else c.set(head, null); }
	const r = routes.get(form);
	if (!r.has(head)) r.set(head, new Set());
	r.get(head).add(route);
}

// 1. direct
for (const form of forms) for (const head of headsByLower.get(form) || []) propose(form, head, null, 'direct');

// 2. UniMorph
const PARTICLES = ('ab an auf aus bei da dar durch ein fort her hin los mit nach nieder um vor weg weiter wieder zu zurück zusammen ' +
	'heraus herein herum herunter hervor hinaus hinein hinter hinunter hinzu voraus vorbei über unter fest frei statt teil').split(' ');
function splitOff(lemma, form) {
	// true when the lemma begins with a separable particle that the form does not carry
	const fits = PARTICLES.filter((p) => lemma.startsWith(p) && lemma.length > p.length + 2);
	return fits.length > 0 && !fits.some((p) => form.startsWith(p) || form.startsWith('ge' + p));
}
let umLines = 0, umSplit = 0;
for (const line of unimorph.text.split('\n')) {
	if (!line) continue;
	const cols = line.split('\t');
	if (cols.length !== 3) throw new Error('unexpected UniMorph line: ' + JSON.stringify(line));
	umLines++;
	const [lemma, form, feats] = cols;
	const key = form.toLowerCase();
	if (!formSet.has(key) || form === lemma || / /.test(lemma) || / /.test(form)) continue;
	const pos = UM_POS[feats.split(';')[0]];
	if (!pos) throw new Error('unexpected UniMorph features: ' + feats);
	if (pos === VERB && splitOff(lemma, key)) { umSplit++; continue; }
	propose(key, lemma, pos, 'unimorph');
}

// 3. German Wiktionary: {{Grundformverweis ...}} in the German section of the form's own page
const wiktSources = [];
const templates = {};
const ownWord = new Set();      // forms whose lower-case page defines a German word of its own, not only an inflected form
const INFLECTED = /^(Konjugierte Form|Deklinierte Form|Partizip I|Partizip II|Komparativ|Superlativ|Erweiterter Infinitiv)$/;
let pagesFound = 0, pagesWithBase = 0;
const batches = batchesOf(forms);
for (let b = 0; b < batches.length; b++) {
	const r = await get('dewikt/forms-' + String(b + 1).padStart(3, '0') + '.json', batchUrl(batches[b]));
	wiktSources.push(r.source);
	const j = JSON.parse(r.text);
	const back = new Map();     // normalised title -> the title that was asked for
	for (const n of (j.query.normalized || [])) back.set(n.to, n.from);
	for (const page of j.query.pages) {
		if (page.missing || page.invalid || !page.revisions) continue;
		const form = back.get(page.title) || page.title;
		if (form !== page.title) continue;        // the API capitalised nothing here, but be strict: the page must be the form itself
		if (!formSet.has(form)) continue;
		pagesFound++;
		const text = page.revisions[0].slots.main.content;
		// the German section: from "== form ({{Sprache|Deutsch}}) ==" to the next "== ... ==" of level 2
		const parts = text.split(/^(?=== [^=].*\(\{\{Sprache\|[^}]+\}\}\) ==\s*$)/m);
		let found = false;
		for (const part of parts) {
			if (!/^== [^=].*\(\{\{Sprache\|Deutsch\}\}\) ==/.test(part)) continue;
			for (const w of part.matchAll(/\{\{Wortart\|([^|}]+)\|Deutsch\}\}/g)) if (!INFLECTED.test(w[1].trim())) ownWord.add(form);
			const re =/\{\{(Grundformverweis[^|}]*)\|([^}]*)\}\}/g;
			let m;
			while ((m = re.exec(part))) {
				const name = m[1].trim();
				const args = m[2].split('|').map((a) => a.trim());
				if (args.some((a) => /^spr=/.test(a) && a !== 'spr=de')) continue;
				const base = args.find((a) => a && !/=/.test(a));
				if (!base) continue;
				templates[name] = (templates[name] || 0) + 1;
				propose(form, base.replace(/#.*$/, ''), /Konj|Partizip/.test(name) ? VERB : null, 'dewikt');
				found = true;
			}
		}
		if (found) pagesWithBase++;
	}
}

/* Glosses. */
function glossOf(head, pos) {
	const byPos = good.get(head);
	const rank = ranked.get(head);
	if (!byPos || !rank) return null;
	const allowed = new Set();
	for (const [p, set] of byPos) if (pos === null || pos.has(p)) for (const t of set) allowed.add(t);
	const items = [];
	for (const t of rank.list) {
		if (!allowed.has(t) || rude(t) || items.includes(t) || /[#\[\]{}|<>]/.test(t)) continue;
		items.push(t);
		if (items.length === MAX_TRANSLATIONS) break;
	}
	return items.length ? { text: items.join('; '), importance: rank.importance } : null;
}

const g = {};
const stats = { direct: 0, base: 0, both: 0, none: 0, blocked: 0, oneLetter: 0, guarded: 0, tokens: 0, glossedTokens: 0, headwords: 0 };
const unglossed = [];
const guarded = [];
forms.forEach((form, i) => {
	stats.tokens += F.counts[i];
	if (blocked.has(form)) { stats.blocked++; return; }
	if ([...form].length < 2) { stats.oneLetter++; return; }
	let found = [];
	for (const [head, pos] of candidates.get(form) || []) {
		const gl = glossOf(head, pos);
		if (!gl) continue;
		const route = routes.get(form).get(head);
		// "own": the gloss belongs to the lower-case word itself or to a base form of it
		const own = head === form || route.has('dewikt') || (route.has('unimorph') && head.toLowerCase() !== form);
		found.push({ head, text: gl.text, importance: gl.importance, own });
	}
	if (ownWord.has(form) && found.length && !found.some((e) => e.own)) {
		const strong = found.filter((e) => e.importance >= ALONE_FLOOR);
		if (strong.length < found.length) { stats.guarded++; guarded.push(form + ' (' + found.filter((e) => e.importance < ALONE_FLOOR).map((e) => e.head).join(', ') + ')'); }
		found = strong;
	}
	if (!found.length) { stats.none++; unglossed.push(form); return; }
	found.sort((a, b) => b.importance - a.importance || (a.head < b.head ? -1 : 1));
	const kept = found.filter((e, k) => k === 0 || e.importance >= SECOND_FLOOR || (e.head === form && e.importance >= EXACT_FLOOR)).slice(0, MAX_HEADWORDS);
	if (process.argv.includes('--candidates') && found.length > 1 && i < 1500) {
		console.log('  ? ' + form + ': ' + found.map((e) => (kept.includes(e) ? '' : '-') + e.head + ' ' + e.importance.toFixed(2)).join(', '));
	}
	g[form] = kept.map((e) => [e.head, e.text]);
	stats.headwords += kept.length;
	stats.glossedTokens += F.counts[i];
	const d = kept.some((e) => e.head.toLowerCase() === form);
	const b = kept.some((e) => e.head.toLowerCase() !== form);
	if (d && b) stats.both++; else if (d) stats.direct++; else stats.base++;
});

const glossed = Object.keys(g).length;
const n = (x) => x.toLocaleString('en-US');
const data = {
	meta: {
		// The hundred Wiktionary requests are one entry here; each one's hash is in `batches`, and
		// LICENSES.md spells out every URL.
		sources: [wikdict.source, unimorph.source, bad.source, {
			url: WIKT_PATTERN,
			sha256: sha256(wiktSources.map((s) => s.sha256).join('')),
			fetched: wiktSources.map((s) => s.fetched).sort().pop(),
		}],
		batches: {
			note: 'The German Wiktionary was asked ' + wiktSources.length + ' times, with the URL in sources and {titles} = fifty consecutive forms of freq-de.js joined by "|" (forms 1 to 50, 51 to 100, ...; forms containing | # < > [ ] { } _ or : left out). sha256[k] is the hash of answer k; the hash in sources is the SHA-256 of these hashes written one after another.',
			sha256: wiktSources.map((s) => s.sha256),
		},
		licence: 'CC BY-SA 4.0',
		credit: 'German–English glosses: WikDict (wikdict.com), from Wiktionary through DBnary, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). Base forms: UniMorph German, CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/), and the German Wiktionary, CC BY-SA 4.0.',
		licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
		kept: 'for ' + n(glossed) + ' of the ' + n(FORMS) + ' most frequent forms of freq-de.js: up to ' + MAX_HEADWORDS + ' headwords, each with up to ' + MAX_TRANSLATIONS +
			' translations in WikDict\'s own order. ' + n(stats.direct) + ' forms are glossed as headwords themselves, ' + n(stats.base) + ' only through a base form, ' + n(stats.both) + ' both ways',
		dropped: n(stats.none) + ' forms for which no headword with a good translation was found (names, English words, subtitle noise, and real words the three sources miss, among them dem, am and beim), the ' +
			stats.blocked + ' forms flagged as blocked in freq-de.js, the ' + stats.oneLetter + ' one-letter forms, translations WikDict does not mark as good, translations containing a word of the English blocked list (LDNOOBW\'s English list with the builders\' additions), second and third headwords with a WikDict importance below ' + SECOND_FLOOR + ' (below ' + EXACT_FLOOR + ' when spelled exactly like the form), and everything else in the three sources',
		forms: FORMS,
		glossed,
		tokenShare: Math.round(1000 * stats.glossedTokens / stats.tokens) / 1000,
		note: 'g[form] is a list of [headword, gloss] pairs. A headword that differs from the form (apart from capitals) is its base form: g.ist is [["sein", "be; exist; have"]]. Nothing says which reading a sentence means, and a rare reading can stand beside a common one.',
		freq: { file: 'misc/_texts/freq-de.js', sha256: sha256(fs.readFileSync(freqFile, 'utf8').replace(/\r\n/g, '\n')) },
	},
	g,
};

const body = '{\n"meta": ' + JSON.stringify(data.meta, null, '\t') + ',\n"g": {\n' +
	Object.keys(g).map((form) => JSON.stringify(form) + ':' + JSON.stringify(g[form])).join(',\n') + '\n}\n}';
writeData('glosses-de.js', 'TEXTS_GLOSSES_DE', [
	'misc/_texts/glosses-de.js : window.TEXTS_GLOSSES_DE',
	'English glosses for the most frequent German word forms of freq-de.js.',
	'Glosses: WikDict (from Wiktionary through DBnary), CC BY-SA. Base forms: UniMorph German and the',
	'German Wiktionary. Built by scripts/texts/build-glosses.mjs. Do not edit by hand. See LICENSES.md.',
], body, data);

console.log('  requests made now: ' + requestCount() + '; Wiktionary batches: ' + wiktSources.length + '; pages found: ' + pagesFound + ', with a base form: ' + pagesWithBase + '; templates: ' + JSON.stringify(templates));
console.log('  UniMorph lines: ' + umLines + '; WikDict headwords with good translations: ' + good.size);
console.log('  forms glossed: ' + glossed + ' of ' + FORMS + ' (as headword ' + stats.direct + ', through a base form ' + stats.base + ', both ' + stats.both + '); none: ' + stats.none + '; blocked: ' + stats.blocked);
console.log('  token share of the glossed forms among the top ' + FORMS + ': ' + (100 * stats.glossedTokens / stats.tokens).toFixed(1) + '%; headwords in all: ' + stats.headwords);
console.log('  UniMorph lines ignored as split-off forms of separable verbs: ' + umSplit + '; one-letter forms: ' + stats.oneLetter + '; forms whose lower-case page defines a word of its own: ' + ownWord.size);
console.log('  capitalised look-alikes dropped by the third guard (' + stats.guarded + '): ' + guarded.join(' '));
console.log('  first unglossed: ' + unglossed.slice(0, 120).join(' '));
if (REVIEW) {
	const pick = forms.filter((f) => g[f]).filter((f, k) => k < 220 || k % 23 === 0);
	for (const f of pick) console.log('  ' + f + ' => ' + g[f].map((e) => e[0] + ': ' + e[1]).join(' | '));
}
