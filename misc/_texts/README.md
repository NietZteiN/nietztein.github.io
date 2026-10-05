# The texts kit

Data for the language toys: a German text, two frequency lists, the opening of a Vietnamese poem, sentences in about fifty languages, English pronunciations, and German glosses. Every file is built by a script from a named public source. Nothing in it was written for this site: no sentence, no verse, no gloss, no translation.

Each file is a plain script that sets one global on `window` (and `module.exports` under Node, so a `test.js` can `require` it). In a Web Worker, where there is no `window`, `importScripts('../_texts/kieu-opening.js')` sets the same global on `self`. Each global has a `meta` object: `sources` (what was fetched: URL, SHA-256, day), `licence`, `licenceUrl` (for the Creative Commons ones), `credit` (the line your page must show), `kept` and `dropped`.

<!-- files:start -->
| File | Global | What | Bytes |
| --- | --- | --- | ---: |
| `zarathustra-vorrede.js` | `window.TEXTS_ZARATHUSTRA` | Zarathustra's prologue in German: 10 sections, 161 paragraphs | 30,626 |
| `freq-de.js` | `window.TEXTS_FREQ_DE` | 20,000 German word forms by frequency, with counts; 181 blocked | 266,620 |
| `freq-vi.js` | `window.TEXTS_FREQ_VI` | 10,000 Vietnamese syllables by frequency, with counts; 63 blocked; shape flags | 113,576 |
| `kieu-opening.js` | `window.TEXTS_KIEU` | Truyện Kiều, lines 1 to 38, in the 1911 transcription of Trương Vĩnh Ký | 8,914 |
| `sentences.js` | `window.TEXTS_SENTENCES` | 1,225 sentences in 49 language entries, each with a Tatoeba id, owner and English translation | 227,060 |
| `cmu-phones.js` | `window.TEXTS_CMU` | 30,000 English words with ARPAbet phonemes and stress digits; the 39 phonemes and their classes | 893,361 |
| `glosses-de.js` | `window.TEXTS_GLOSSES_DE` | English glosses for 4,431 of the 5,000 most frequent German forms | 223,346 |

Together 1,763,503 bytes. Sizes are of the files with LF line ends, before the server compresses them.
<!-- files:end -->

A server that compresses (GitHub Pages does) sends about a third of these sizes: gzip at its highest setting brings `cmu-phones.js` to 305 KB, `freq-de.js` to 93 KB, `sentences.js` to 77 KB, `glosses-de.js` to 76 KB, `freq-vi.js` to 44 KB, and the two texts to 12 and 3 KB. Still, load the large ones after the first paint.

`LICENSES.md` has a section per file with the same facts in prose, the full list of what was fetched, and the SHA-256 of each data file as built. `test.js` checks the data (`node misc/_texts/test.js`), including that no data file was edited after the build. Never edit a data file by hand: change its build script and run `node scripts/texts/build-all.mjs --offline`.

Licences, in short: the two texts are public domain; the frequency lists and the glosses are CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/); the sentences are CC BY 2.0 FR (https://creativecommons.org/licenses/by/2.0/fr/); the pronunciations carry the CMU dictionary's own BSD-style licence; the blocked words come in part from a CC BY 4.0 list (https://creativecommons.org/licenses/by/4.0/). Each `meta.credit` carries the address of its licence, so a footer that prints the credit lines is complete.

## Using a file

In the page, either a script tag before your `app.js`, or, for the large files, after the first paint:

```html
<script src="../_texts/kieu-opening.js"></script>
```

```js
ToyKit.loadScript('../_texts/cmu-phones.js', { global: 'TEXTS_CMU', timeoutMs: 30000 }).then(function (cmu) {
	start(cmu);
}).catch(function (err) { ToyKit.fail(err); ToyKit.ready(); });
```

`loadScript` gives up after 8 seconds unless told otherwise; `cmu-phones.js` is 305 KB on the wire, which a slow phone connection does not deliver in 8 seconds, so pass a longer `timeoutMs` for the large files.

In a Node test:

```js
var KIEU = require('../_texts/kieu-opening.js');
```

Rules for a toy that uses the kit:

- Put `meta.credit` in the "How it works" footer, word for word, for every file you load. A credit line is written for the visitor and holds no instruction to you.
- For `sentences.js`, also credit every sentence you show, next to it or right after it, with its own number and owner: `Tatoeba #` + `id` + ` by ` + `by` (the pattern is in `meta.attribution`). The English translation was written by someone else: when you show `en.text`, credit it with `en.id` and `en.by`, not with the owner of the sentence. The licence requires both.
- Do not copy a file into your folder. Load it from `../_texts/` and say in your report which files you load.
- Do not show a word from a `blocked` list as a stimulus (a word to guess, type or judge). Blocked words stay in the lists because coverage figures need them. The lists are a judgement made by searching for word stems and reading the hits, not by reading every entry (see "The blocked lists" below), so a toy that shows random words should still let the reader skip one.
- When you look a word up in `TEXTS_CMU.w` or `TEXTS_GLOSSES_DE.g`, test with `Object.prototype.hasOwnProperty.call(...)` as the examples below do. They are plain objects: `w['__proto__']` and `g['constructor']` are not entries but are not `undefined` either, and a reader can type anything.
- Do not add text of your own in these languages around the data.

## `window.TEXTS_ZARATHUSTRA` (zarathustra-vorrede.js)

"Zarathustra's Vorrede", the prologue of Nietzsche's *Also sprach Zarathustra*, from Project Gutenberg's ebook 7205. Public domain.

```js
{ meta, title, sections: [{ n, label, paras: [string, ...] }, ...] }
```

- Ten sections, 161 paragraphs, 4,530 words. `n` is 1 to 10. `label` is the heading as the source prints it; the source heads the ninth section "8.", so use `n`.
- The spelling is that of the source and of the 1880s: giebt, gieng, Thier, Thür, todt, diess; and ss where today's spelling has ß (dreissig, verliess, grosses). The source is not consistent about it: one ß stands in the text, in `großen` (section 3, paragraph 3), and is kept; `meta.sharpS` lists it. A modern frequency list does not know these forms. Measured against `freq-de.js`: the text has 4,530 word tokens and 1,198 different forms; the 1,000 most frequent subtitle forms cover 70.6% of the tokens, 2,000 cover 75.5%, 5,000 cover 80.8%, all 20,000 cover 89.0%, and 292 forms of the text are not in the list at all. `glosses-de.js` has an entry for 651 of the 1,198 forms (79.4% of the tokens).
- Emphasis is marked `_like this_`, as in the plain-text source. Quotation marks are „ and “, the dash is —, the apostrophe is ’.
- Paragraphs are single lines; the source's line wrapping is gone.

```js
var Z = window.TEXTS_ZARATHUSTRA;
var known = {};
window.TEXTS_FREQ_DE.words.slice(0, 2000).forEach(function (w) { known[w] = true; });
var words = Z.sections[0].paras.join(' ').replace(/_/g, '').match(/[A-Za-zÄÖÜäöüß]+/g);
var hits = words.filter(function (w) { return known[w.toLowerCase()]; }).length;
// hits / words.length is the share of section 1 that a 2,000-word vocabulary covers
```

## `window.TEXTS_FREQ_DE` (freq-de.js)

The 20,000 most frequent German word forms in film subtitles (hermitdave/FrequencyWords, 2018; CC BY-SA 4.0).

```js
{ meta, words: [string x 20000], counts: [number x 20000], blocked: [string, ...] }
```

- `words[0]` is the most frequent form (`ich`); `counts[i]` is how often `words[i]` occurred in the corpus. Everything is lower case, nouns too (`haus`, `zeit`), because the source is.
- `meta.sourceTokens` (151,705,378) is the sum of the counts of all 50,000 entries of the source file; `meta.keptTokens` is the sum over these 20,000 (97.56% of it). A share computed from `counts` is a share of the 50,000-entry list, not of all German.
- It is a raw subtitle list. Besides German words it holds names (`john`), English (`the`, `prison`), abbreviations with full stops (`mr.`), subtitle markup (`ch00ffff`), and the addresses of three subtitle sites, taken from the credits of subtitle files (`board.tv4user.de` at rank 2,966, `subcentral.de`, `tv4user.de`; `meta.sites` lists them). 129 entries are not letters only. `/^[a-zäöüß]+$/` keeps the plain ones; `glosses-de.js` tells you which of the top 5,000 a dictionary knows.
- `blocked` (181 entries), in rank order: profanity, sexual terms, slurs, the names Hitler and Nazi, and the three site addresses. All of them are also in `words`. The German words `dick` (thick) and `jap` (colloquial yes) are blocked because the English list has them. Mild words (`verdammt`, `mist`), mild insults (`idiot`, `trottel`) and neutral words for groups of people (`schwul`, `jude`) are not blocked.

```js
var F = window.TEXTS_FREQ_DE;
var rank = {};                       // word -> 1-based rank
F.words.forEach(function (w, i) { rank[w] = i + 1; });
var isBlocked = {};
F.blocked.forEach(function (w) { isBlocked[w] = true; });
function inVocabulary(word, n) { var r = rank[word.toLowerCase()]; return !!r && r <= n; }
```

## `window.TEXTS_FREQ_VI` (freq-vi.js)

The 10,000 most frequent Vietnamese syllables in film subtitles (same source and licence).

```js
{ meta, words: [string x 10000], counts: [number x 10000], blocked: [string, ...], syllable: '1101...' }
```

- Syllable level: `words` are single syllables (`tôi`, `không`), not words of two syllables.
- All entries are NFC. The source spells 2,589 syllables twice (precomposed letters, and letters with combining tone marks); those pairs were merged and their counts added before the cut at 10,000.
- More than half of the entries are not Vietnamese: names, English words, subtitle markup, broken encodings, and the addresses of nine subtitle and download sites (`phudeviet.org` at rank 2,334, `phimhd.vn`, `viettorrent.vn` and six more; `meta.sites` lists them). `syllable.charAt(i) === '1'` says that `words[i]` has the shape of a Vietnamese syllable (initial, rhyme, at most one tone mark, the usual spelling rules); 4,356 entries pass, and they carry 96.5% of the tokens. It is a test of shape: `an`, `to` and `can` pass, and a misspelling with a misplaced tone mark can pass.
- `blocked` (63 entries): Vietnamese profanity and slurs found by reading the syllable-shaped entries, the English ones (LDNOOBW's list and the additions that `cmu-phones.js` also uses), and the nine site addresses. `mong` (to hope) is on the English list and is left unflagged; `meta.unblocked` says so.

```js
var V = window.TEXTS_FREQ_VI;
var blocked = {};
V.blocked.forEach(function (w) { blocked[w] = true; });
var practice = V.words.filter(function (w, i) { return V.syllable.charAt(i) === '1' && !blocked[w]; });
// practice.slice(0, 500): the 500 most frequent syllables that are safe to show
```

## `window.TEXTS_KIEU` (kieu-opening.js)

Nguyễn Du, *Truyện Kiều*, lines 1 to 38: the opening and the portrait of the two sisters, up to the line that ends "mặc ai." Public domain.

```js
{ meta, lines: [string x 38] }
```

- The text is the quốc ngữ transcription of Trương Vĩnh Ký (third edition, Saigon 1911) as transcribed on Vietnamese Wikisource from a scan. It is not the modern school text: compounds are hyphenated (`người-ta`), every second line begins in lower case unless a name comes first, and some words differ (`mạng` where modern editions have `mệnh`, `đều` for `điều`). `meta.spelling` says this for your footer. `LICENSES.md` says why the modern-spelling pages on Wikisource were not used.
- Wikisource is not letter for letter the book. The 38 lines were compared with the scan of the printed pages, and four of them follow the print where the transcription departs from it: line 4 (`đều`, transcribed `điều`), line 8 (`phong-tình`, transcribed without the hyphen), lines 23 and 24 (no comma inside, where the transcription adds one). `meta.corrections` gives both readings of each, and `meta.pages[].image` is the picture of the printed page. The limit of that comparison: the scan is coarse, so letters, hyphens and the places of punctuation marks were checked, and tone marks were not (a hook and a grave accent look alike in it). Do not present the text as verified against the 1911 print in every tone mark.
- Stored NFC-normalised: every vowel with its marks is one code point. A Telex engine that composes NFC can compare with `===`.
- Lục bát: lines of six and eight syllables in turn, counting a syllable as a run of letters between spaces or hyphens. One exception, in `meta.exceptions`: line 37 has ten, because the editor put a second reading in brackets inside the verse, `(hay là iêm-liềm)`. `meta.exceptions[0].without` is the line without the brackets, for a toy that wants six syllables there.
- No translation is included. Do not add one.

```js
var K = window.TEXTS_KIEU;
function syllables(line) {
	return line.split(/[\s-]+/).map(function (t) { return t.replace(/[^\p{L}]/gu, ''); }).filter(Boolean);
}
syllables(K.lines[0]);   // ['Trăm', 'năm', 'trong', 'cõi', 'người', 'ta']
```

## `window.TEXTS_SENTENCES` (sentences.js)

Short everyday sentences from Tatoeba (CC BY 2.0 FR) for a "which language is this" game.

```js
{ meta, langs: [{ code, iso, name, script, family, branch,
                  sentences: [{ id, text, by, en: { id, text, by } }, ...] }, ...] }
```

- 49 entries, 25 sentences each. 48 languages: Chinese appears twice, as `cmn-Hans` (simplified characters) and `cmn-Hant` (traditional), and only sentences that are written differently in the two scripts were taken. Serbian (`srp`) is Cyrillic only.
- `code` is unique; `iso` is the ISO 639-3 code Tatoeba uses (`cmn` for both Chinese entries); `script` is an ISO 15924 code; `name` is in English. `family` and `branch` are labels for hints, chosen by the builder.
- `id` is the Tatoeba sentence number and `by` the user name of its owner. `en` is a direct English translation from Tatoeba with its own number and owner (`by` is `''` when that sentence has no owner, which is so for 19 of the 1,225). Link a sentence with `meta.sentenceUrl`.
- `en` is a translation that some contributor linked to the sentence, not a checked meaning. Most are exact; some are not: Korean #11597162, whose subject is "he", is paired with "They entered the forest." Nothing in the build checks the translations. Label `en` as a translation from Tatoeba, and do not build a game that marks a reader wrong on the strength of it.
- Every entry comes from contributors who declare the language as their native one; each request to Tatoeba carried that filter. Four entries (Danish, Macedonian, Latvian, Marathi; `meta.oneOwner`) come from a single contributor each. Swahili is not included: Tatoeba has nine Swahili sentences by native speakers with an English translation, too few for an entry (`meta.notIncluded`).
- `meta.lookalikes` lists groups of codes that are easy to confuse, for choosing wrong answers: Danish, Norwegian and Swedish; Dutch and Afrikaans; Czech and Slovak; Bulgarian, Serbian and Macedonian; Russian and Ukrainian; Malay and Indonesian; Hindi and Marathi; Persian, Arabic and Urdu; Japanese, Korean and the two Chinese entries; Spanish, Portuguese, Catalan and Italian; Finnish and Estonian; Lithuanian and Latvian; Thai and Khmer.
- The text is exactly what Tatoeba holds, typing mistakes included. Khmer sentences contain zero-width spaces between words; leave them in.
- Arabic, Persian, Urdu and Hebrew run right to left: put a sentence in an element of its own with `dir="auto"`, or the full stop lands on the wrong side. All sixteen scripts rendered with the system fonts in the test browser on the build machine (Windows 11); a reader's device may lack a font for Khmer, Tamil, Georgian or Armenian, so do not make the game depend on telling two boxes apart.
- The sentences were picked mechanically (seeded random order, length and script tests, a topic screen on the English translation). They are sentences that people wrote to illustrate a language, not a balanced sample of it.

```js
var S = window.TEXTS_SENTENCES;
var rng = ToyKit.rng(ToyKit.daily());
var lang = rng.pick(S.langs);
var s = rng.pick(lang.sentences);
function by(x) { return 'Tatoeba #' + x.id + (x.by ? ' by ' + x.by : ''); }   // an orphaned translation has no owner
show(s.text);                                            // the question
// after the answer: the sentence under its own author, the translation under its own
credit(by(s));                                           // 'Tatoeba #5299977 by katalex'
translation(s.en.text, by({ id: s.en.id, by: s.en.by }));
```

## `window.TEXTS_CMU` (cmu-phones.js)

Pronunciations from the CMU Pronouncing Dictionary (BSD-style licence, in the file's first comment).

```js
{ meta, phones: { AA: 'vowel', B: 'stop', ... }, w: { the: 'DH AH0', cat: 'K AE1 T', ... }, blocked: [string, ...] }
```

- `w` has the 30,000 most frequent English words that the dictionary knows. `Object.keys(w)` is in frequency order, the order of `misc/18-zipf-karaoke/freq.js`; the 30,000th word has rank 36,275 there, because 6,275 of the more frequent "words" of that web list (abbreviations, jargon) are not in the dictionary.
- A value is the phonemes separated by spaces. A vowel ends in a stress digit: 0 none, 1 primary, 2 secondary. Consonants have no digit. Where the dictionary lists several pronunciations, this is the first.
- `phones` gives the class of each of the 39 phonemes: 15 vowels, and stop, affricate, fricative, aspirate, liquid, nasal, semivowel for the consonants.
- `blocked` (174 words), for a toy that shows sample words: the 95 entries that are on LDNOOBW's English list, and 79 that the list lacks, which are inflected forms of its words (`fucked`, `sluts`, `whores`), further obscenities and slurs (`piss`, `dyke`, `jap`, `retard`), and `hitler`, `nazi`, `nazis`. Mild words (`damn`, `hell`, `crap`), mild insults (`idiot`, `moron`) and neutral words for groups of people (`gay`, `lesbian`) are not blocked. Looking up what the reader typed needs no such filter.
- `w` is a plain object. `w['constructor']` happens to be a real entry; `w['__proto__']` is not an entry and is not `undefined`. Test with `hasOwnProperty`, as below.

```js
var C = window.TEXTS_CMU;
function hits(word) {
	var key = word.toLowerCase();
	if (!Object.prototype.hasOwnProperty.call(C.w, key)) return null;   // not in the dictionary: fall back to spelling
	var p = C.w[key];
	return p.split(' ').map(function (ph) {
		var stress = /[012]$/.test(ph) ? +ph.slice(-1) : -1;
		var name = stress < 0 ? ph : ph.slice(0, -1);
		return { phone: name, kind: C.phones[name], stress: stress };
	});
}
hits('cat');   // K stop, AE vowel with stress 1, T stop
```

## `window.TEXTS_GLOSSES_DE` (glosses-de.js)

English glosses for the most frequent German forms of `freq-de.js`, from WikDict (Wiktionary through DBnary, CC BY-SA).

```js
{ meta, g: { ist: [['sein', 'be; exist; have']], weg: [['Weg', 'way; route; path'], ['weg', 'away; ...']], ... } }
```

- `g[form]` is a list of one to three `[headword, gloss]` pairs. The headword is the dictionary entry the gloss belongs to. When it differs from the form in more than capitals, it is the base form: `ist` is glossed under `sein`, `männer` under `Mann`.
- 4,431 of the 5,000 most frequent forms have an entry; they carry 96.8% of the tokens of those 5,000. The rest are names, English words, subtitle noise, the 40 blocked forms, and some real words the sources miss, among them `dem`, `am` and `beim`.
- No gloss was written or edited by hand, and the matching is mechanical. It does not know which reading a sentence means, and the order of the pairs follows the dictionary's importance score, not the usage in subtitles: `mal` lists the verb `malen` (to paint) before the particle. Show the headword with the gloss, and do not present a gloss as the meaning of the word in a given sentence.
- The old spelling of the Zarathustra text (`Thier`, `giebt`) is not in this list.

```js
var G = window.TEXTS_GLOSSES_DE;
function glossOf(word) {
	var key = word.toLowerCase();
	if (!Object.prototype.hasOwnProperty.call(G.g, key)) return '';      // g is a plain object: g['constructor'] is not an entry
	return G.g[key].map(function (p) { return p[0] + ': ' + p[1]; }).join(' / ');
}
glossOf('Macht');   // 'machen: make; do; perform / Macht: power; might; potency'
```

## Rebuilding

```
node scripts/texts/build-all.mjs             fetch what is not cached, build every file, write the documents
node scripts/texts/build-all.mjs --offline   the same from the cache alone; fails if something is missing
node scripts/texts/spot-check.mjs            compare samples of the data with the live sources (needs the network)
node misc/_texts/test.js                     no network
```

The scripts need Node 24 and nothing else (`build-glosses.mjs` uses Node's built-in `node:sqlite`). They make one request at a time, at least 1.5 seconds apart, with a User-Agent that names the site. Downloads go to `scripts/texts/.cache/` (gitignored, 66 MB after a full build) with a `.meta.json` beside each (URL, day, SHA-256); a second run reads them and makes no request, and gives the same files byte for byte.

Without the cache, a rebuild fetches again: 168 requests (100 of them to the German Wiktionary, 52 to Tatoeba), some five minutes. The files from GitHub and the three Wikisource pages are read at fixed commits and revisions and come back identical. The rest can change under you: Project Gutenberg revises its files now and then, WikDict regenerates its database, Wiktionary pages are edited, Wikimedia may render the three page images of the Kiều scan afresh (only their recorded hashes would change), and Tatoeba is a live corpus (read in a seeded random order, so most sentences come back, not all). `test.js` holds a few exact expectations (161 paragraphs, the rank of the last CMU word, `des` without a gloss), so it will say when a source has moved.

`build-docs.mjs`, the last step of `build-all.mjs`, writes the size and SHA-256 of every data file into `LICENSES.md`, and `test.js` compares. Running one build script alone therefore leaves the test red until `node scripts/texts/build-docs.mjs` has run too. That is deliberate: it is what catches a data file changed by hand.

## The blocked lists

`cmu-phones.js`, `freq-de.js` and `freq-vi.js` each carry `blocked`. One module, `scripts/texts/blocked.mjs`, holds the rules for all three, and its opening comment is the full account. In short:

- Sources: LDNOOBW's English list for every file and its German list for German (CC BY 4.0), plus words the builders added because the published lists hold base forms and few inflected ones, hold no Vietnamese, and do not name Hitler or the Nazis. The subtitle lists also flag the addresses of subtitle and download sites.
- The English part is the same everywhere: a word that `cmu-phones.js` blocks is blocked in the two subtitle lists wherever it occurs (the test checks this), except `mong` in Vietnamese. The gloss filter of `glosses-de.js` and the topic screen of `sentences.js` read the same English list.
- Flagged: profanity, sexual terms, slurs for groups of people, rape, Hitler and Nazi. Not flagged: mild words, mild insults, neutral words for groups of people, body parts other than the genitals, and violence, drugs and illness.
- How the additions were found: by searching each list for several hundred word stems, matched anywhere in a word, and reading every hit; the Vietnamese syllables were read one by one. The lists were not read from end to end, and the first build missed forms that a review then found (`fucked`, `whores`, `ärsche`). A word with a stem nobody thought of can still be unflagged. `node scripts/texts/review-blocked.mjs` prints the hits for reading again.
