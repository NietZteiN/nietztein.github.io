# The Japanese data kit

Data for the language toys under `misc/`: the hundred poems of the Ogura Hyakunin Isshu, the joyo kanji with their components, the common words of JMdict, pitch accents, word frequencies, and one story by Soseki with its furigana.

Nothing Japanese in this folder was written by hand. Every poem, reading, romanisation, gloss, accent number and furigana is copied by a script from a named source, and each file says which one, with the hash of what was fetched (`meta.sources`). Where no source gives a value there is none: nothing is transliterated, translated or guessed. The scripts are in `scripts/lang/`; `LICENSES.md` has the sources, licences and hashes; `test.js` checks the files; `scripts/lang/spot-check.mjs` compares them with the sources again.

A source can be wrong. Where one was found wrong, the right string is copied from a second source, and the file's `meta` names the place, both strings and the reason; so far that is five poems of `hyakunin.js`. Two more kinds of change are made by a stated rule and listed: kanji of the poems written in their current form, and words left out of `jmdict-core.js`. Each section below says what its file changed.

## Files

<!-- generated:files -->
| File | Global | Bytes | Holds |
| --- | --- | ---: | --- |
| `hyakunin.js` | `LANG_HYAKUNIN` | 91,607 | The 100 poems of the Ogura Hyakunin Isshu: text, reading, kimariji, Porter's romanised text and English verse; what was corrected and what the sources disagree on |
| `kanji.js` | `LANG_KANJI` | 378,319 | The 2,136 joyo kanji: meanings, readings, components, grade, strokes, frequency; and the other forms of them |
| `kanji-grades.js` | `LANG_KANJI_GRADES` | 30,577 | The same kanji in school order with stroke counts |
| `jmdict-core.js` | `LANG_JMDICT` | 1,207,996 | The common words of JMdict: written form, reading, first gloss, tags, frequency band |
| `jmdict-tech.js` | `LANG_JMDICT_TECH` | 319,130 | All-kanji words with a computing or mathematics sense, common or not |
| `accents.js` | `LANG_ACCENT` | 599,092 | Pitch accents of the words in jmdict-core, and groups that differ only in accent |
| `freq-ja.js` | `LANG_FREQ_JA` | 810,234 | Two-kanji words with two frequency counts, and every attested two-kanji string |
| `texts/yume-juya-1.js` | `LANG_TEXT_YUMEJUYA1` | 10,586 | Soseki, Ten Nights of Dreams, the First Night, with the furigana of the source |
<!-- /generated:files -->

Sizes are of the files as the site serves them (LF line ends). GitHub Pages compresses them to roughly a third in transit.

## Using a file

Each file is a plain script that sets one global. Paths are relative to a toy's folder.

```html
<script src="../_lang/kanji-grades.js"></script>
<script>var rows = window.LANG_KANJI_GRADES.k;</script>
```

Load the larger files after the first paint and say that they are loading:

```js
ToyKit.loadScript('../_lang/jmdict-core.js', { global: 'LANG_JMDICT', timeoutMs: 30000 })
	.then(function (J) { start(J.e); })
	.catch(function (err) { ToyKit.fail(err); ToyKit.ready(); });
```

In a Node test, `require` returns the same object and sets no global:

```js
var K = require('../_lang/kanji.js');
```

Every global has `meta`: `{ sources: [{ url, sha256, fetched }], licence, credit, kept, dropped }`, plus notes on its fields.

Strings are JavaScript strings. One joyo kanji, 𠮟, is outside the Basic Multilingual Plane, so split text with `Array.from(text)`, not `text.split('')`.

The kit's pages are `lang="en"`. Put `lang="ja"` on every element that shows Japanese from these files: without it a browser on a machine set up for another language may draw the kanji with a Chinese font, in shapes a Japanese reader finds wrong.

What each toy is expected to load:

| Toy | Files |
| --- | --- |
| Karuta on the Hyakunin Isshu | `hyakunin.js` |
| Kanji components | `kanji.js` |
| Radicals that fuse into kanji, kanji into technical words | `kanji.js`, then `jmdict-tech.js` |
| Pitch-accent ear trainer | `accents.js` (its `pairs` carry their own glosses; other words need `jmdict-core.js` for theirs) |
| Soseki with fading furigana | `texts/yume-juya-1.js` |
| Camera that draws with kanji | `kanji-grades.js` |
| Word or not a word | `freq-ja.js` |

Name the files you load in your report, and show their credit lines (below).

## The credit a page must show

A page that loads a file shows that file's `meta.credit` in its "How it works" footer, word for word, and links the source names to the addresses in `meta.sources` where it can. The EDRDG asks that pages showing words from its dictionaries acknowledge them on the page itself; Kanjium asks for the quoted sentence; Aozora Bunko asks that the people named in a file's colophon stay named.

Every file except the Soseki text is adapted from material under a Creative Commons Attribution-ShareAlike licence and is offered under CC BY-SA 4.0 in turn. The licence asks for two things that a credit line alone does not give, so next to the credit the page also:

- links the licence name to the licence text: <https://creativecommons.org/licenses/by-sa/4.0/> for CC BY-SA 4.0 and <https://creativecommons.org/licenses/by-sa/3.0/> for the CC BY-SA 3.0 of the Wikisource page;
- says that the data was changed, and links `LICENSES.md` in this folder (`../_lang/LICENSES.md` from a toy), which lists for each file what was left out or changed. One sentence does it: "The data was trimmed and rearranged for this site; the changes are listed in the licence notes."

<!-- generated:credits -->
- `hyakunin.js`: Ogura Hyakunin Isshu: text and readings from Japanese Wikisource (CC BY-SA 3.0), corrected in 5 poems after the table of poems in Japanese Wikipedia (CC BY-SA 4.0), with 10 kanji written in their current form after KANJIDIC2 (Electronic Dictionary Research and Development Group, CC BY-SA 4.0); romanised text and English verse from William N. Porter, A Hundred Verses from Old Japan (1909), as transcribed at English Wikisource (public domain); kimariji checked against the list in Japanese Wikipedia (CC BY-SA 4.0).
- `kanji.js`: Kanji data from KANJIDIC2, KRADFILE and RADKFILE, the property of the Electronic Dictionary Research and Development Group, used in conformance with the Group's licence (CC BY-SA 4.0): https://www.edrdg.org/wiki/index.php/KANJIDIC_Project
- `kanji-grades.js`: Kanji grades and stroke counts from KANJIDIC2, the property of the Electronic Dictionary Research and Development Group, used in conformance with the Group's licence (CC BY-SA 4.0): https://www.edrdg.org/wiki/index.php/KANJIDIC_Project
- `jmdict-core.js`: Words and glosses from JMdict, the property of the Electronic Dictionary Research and Development Group, used in conformance with the Group's licence (CC BY-SA 4.0): https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project
- `jmdict-tech.js`: Words and glosses from JMdict, the property of the Electronic Dictionary Research and Development Group, used in conformance with the Group's licence (CC BY-SA 4.0): https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project
- `accents.js`: Pitch accents from Kanjium (https://github.com/mifunetoshiro/kanjium, CC BY-SA 4.0): "The pitch accent notation, verb particle data, phonetics, homonyms and other additions or modifications to EDICT, KANJIDIC or KRADFILE were provided by Uros O. through his free database." Glosses from JMdict (Electronic Dictionary Research and Development Group, CC BY-SA 4.0).
- `freq-ja.js`: Word frequencies from Kanjium (https://github.com/mifunetoshiro/kanjium, CC BY-SA 4.0): "The pitch accent notation, verb particle data, phonetics, homonyms and other additions or modifications to EDICT, KANJIDIC or KRADFILE were provided by Uros O. through his free database." Words and glosses from JMdict (Electronic Dictionary Research and Development Group, CC BY-SA 4.0).
- `texts/yume-juya-1.js`: 夏目漱石「夢十夜」第一夜. Text and furigana from Aozora Bunko (https://www.aozora.gr.jp/cards/000148/card799.html); 入力：野口英司; 底本：「夏目漱石全集10巻」ちくま文庫、筑摩書房
<!-- /generated:credits -->

## `LANG_HYAKUNIN` (hyakunin.js)

```js
{
	meta,   // sources and credit, and four lists explained below: corrections, variants, forms, poetKana
	poems: [{
		n: 1,
		poet: '天智天皇', poetKana: 'てんちてんわう',
		text: '秋の田の かりほの庵の とまをあらみ わが衣手は 露にぬれつつ',
		kana: 'あきのたの かりほのいほの とまをあらみ わがころもでは つゆにぬれつつ',
		kami: 'あきのたの かりほのいほの とまをあらみ',
		shimo: 'わがころもでは つゆにぬれつつ',
		kimariji: 'あきの',
		romaji: 'Aki no ta no\nKari ho no iho no\nToma wo arami\nWaga koromode wa\nTsuyu ni nure-tsutsu.',
		en: 'Out in the fields this autumn day\n...',
		poetRomaji: 'TENCHI TENNŌ', poetEn: 'THE EMPEROR TENCHI',
		anthology: '後撰集秋中302'
	}, ...],
	published: { wikisource: [...100], bySound: [...100] }
}
```

- `text`, `kana`, `poet`, `poetKana`, `anthology` come from the Japanese Wikisource page, character for character except for the changes listed under "What was changed" below (seven strings in five poems, and ten kanji written in their current form). `text` and `kana` have five phrases separated by single spaces (the page breaks the line after the third); `kami` and `shimo` are the two halves of `kana`.
- `kana` is in historical kana throughout. `text` is in the current forms of the kanji throughout. `poetKana` is not in one spelling: see the last point under "What was changed".
- `romaji` and `en` are William N. Porter's book of 1909: the romanised poem and his English verse, five lines each, joined by `\n`. `poetRomaji` and `poetEn` are the headings he prints over them, in his capitals. No field is `null`: both sources give all hundred poems.
- `kimariji` is computed: the shortest prefix of the reading that no other poem shares **when the cards are read aloud**. It is cut from `kana` as the source spells it. Two openings count as the same when they are equal after writing out the iteration mark (the source writes こゝろ), counting を ゐ ゑ as お い え, and counting an opening あふ or おほ as おお. Those last two rules matter for exactly two poems. Compared letter by letter, poem 26 (をぐらやま) would be alone under を and so a one-kana card, and poem 44 (あふことの) would be decided at あふ. Heard, 26 starts like the other お cards, and 44 starts with the long o of おほえやま (60) and おほけなく (95). So the kimariji are をぐ and あふこ, which is what players count (they write おぐ and おおこ), and the lengths come to 7, 42, 37, 6, 2 and 6 cards of one to six kana, the published count. The one-kana cards are む す め ふ さ ほ せ.
- `published.bySound[n - 1]` is the kimariji of poem n as the list in Japanese Wikipedia writes it, by sound (おおこ for poem 44): the name players use for the card. `published.wikisource[n - 1]` is the prefix the Wikisource page prints in bold; it agrees with `kimariji` except for poem 44, where the page marks あふ. `test.js` checks `kimariji` against both, poem by poem.
- Where the published count comes from: the Wikipedia article lists the hundred kimariji, and counting its list gives 7, 42, 37, 6, 2, 6 (the article does not print the sums, and it carries a notice asking for references). The All Japan Karuta Association's introduction to the game (<https://www.karuta.or.jp/karuta/first-time/>) defines the kimariji as the sound that decides a card and states the two ends of the count: seven one-kana cards, and the six-kana cards of three openings.

```js
// The reading of a card with its kimariji marked, and the card to grab (the lower half, in kana).
var p = window.LANG_HYAKUNIN.poems[43];              // poem 44
var flat = p.kami.replace(/ /g, '');
var marked = '<b>' + p.kimariji + '</b>' + flat.slice(p.kimariji.length);
var grab = p.shimo;
```

### What was changed, and what the sources disagree on

The Wikisource page has mistakes, and it prints two poems in a reading that is not the one used for the game. So the build reads a second witness beside it, the table of the hundred poems in the Japanese Wikipedia article on the Hyakunin Isshu, and compares the two phrase by phrase and name by name. The table is not a better edition (it mixes older and current kanji too, and prints variants of its own), so it does not replace the page. What follows from the comparison is recorded in `meta`, four lists in all.

`meta.corrections`: the strings taken from the Wikipedia table instead of the Wikisource page. Each entry is `{ n, field, phrase, from, to, why }`: `from` is what the page prints, `to` is what the file holds, `phrase` (1 to 5) is absent for a poet.

| Poem | Where | The Wikisource page prints | The file holds | Why |
| --- | --- | --- | --- | --- |
| 28 | poet | 源宗行朝臣 | 源宗于朝臣 | One character of the name is wrong. The page's own link leads to the right person, and both Wikipedia pages print the name as it is here. |
| 46 | poet | 曽根好忠 | 曽禰好忠 | The same. |
| 70 | phrase 4, text and reading | いづくも同じ, いづくもおなじ | いづこも同じ, いづこもおなじ | A variant of the first word. The reading in use for the game is the other one. |
| 74 | phrase 3, text and reading | 山おろし, やまおろし | 山おろしよ, やまおろしよ | The page prints the phrase without its last syllable, as some editions do (Porter's `romaji` of this poem among them). The reading in use for the game has it, and so does the page's own caption of the picture beside the poem. |
| 89 | phrase 5, reading | よはりもぞする | よわりもぞする | Misspelt: the verb has わ in historical kana too. |

The build takes a string from the table only where an entry names the place, and stops if the two pages do not differ there by exactly one character. Nothing in the table above was typed into the build: the strings are read from the two pages.

`meta.variants`: the eight places where the two pages still differ and the file keeps the Wikisource page. `here` is what the file holds, `there` what the Wikipedia table prints.

- Readings: poem 33 has しづごころなく (the table: しづこころなく) and poem 49 has よるはもえ (the table: よるはもえて). Both readings of each are in circulation; a page that asks a visitor for these phrases should accept either. Poem 44 opens あふことの (the table: おふことの); that is not another reading, the table writes this opening partly by sound.
- Poets: 柿本人麿 (the table: 柿本人麻呂) for poem 3, 山部赤人 (山邊赤人) for 4, 猿丸太夫 (猿丸大夫) for 5, 阿倍仲麻呂 (阿倍仲麿) for 7, 大僧正行尊 (前大僧正行尊) for 66. These are spellings and titles that editions differ on, not mistakes.
- The wording in kanji is not compared. Which words are written in kanji is an editor's choice, and the table makes it differently in 93 of the hundred poems (`meta.compared`).

`meta.forms`: the Wikisource page writes ten kanji in an older form in some poems and the same kanji in the current form in others. They are written in the current (joyo) form everywhere: 聲 as 声 (poem 5), 峯 as 峰 (13, 26), 戀 as 恋 (13, 27, 39, 40, 41, 46, 65, 68, 84, 88), 龍 as 竜 (17, 69), 晝 as 昼 (49), 獨 as 独 (53, 91), 瀧 as 滝 (55, 77), 濱 as 浜 (72), and in the poets' names 貮 as 弐 (58) and 圓 as 円 (95). Which kanji is a form of which is taken from KANJIDIC2 (the `alias` table of `kanji.js`), not judged here. `meta.forms.replaced` lists `{ from, to, text: [poems], poet: [poems], anthology: [poems] }`, which is enough to put the page's forms back. Kanji that are simply not on the joyo list (庵, 逢, 篠 and others) are left alone: they have no current form.

`meta.poetKana.modernSpelling`: `poetKana` could not be brought to one spelling. The page gives the poets' names in historical kana (くわうかうてんわう for poem 15) but spells part of five names the modern way, in poems 24, 55, 72, 76, 80. No source at hand prints those five in historical kana, and nothing is transliterated in this kit, so they stay as the page prints them. Do not present `poetKana` as historical kana throughout. `poetRomaji`, Porter's heading, is the reading of the names that is consistent.

Things to know before showing it:

- The source uses the iteration marks ゝ and ゞ in the readings of six poems (6, 23, 26, 29, 35, 68). Write them out if you compare kana.
- Porter's romanisation is a text of 1909, not a key to `kana`: it follows his reading and his spelling (`Wada no hara`, `Sumi-no-ye`, `Ohoye yama`), and his names for the poets are his own. Show it as Porter's. He also read some poems in another variant than the one here: his poem 74 has no `yo` at the end of the third line, and his poem 49 has `Yo wa moete`.

## `LANG_KANJI` (kanji.js)

```js
{
	meta,
	k: { '明': { m: ['bright', 'light'], on: ['メイ', 'ミョウ', 'ミン'], kun: ['あ.かり', 'あか.るい', ...], parts: ['月', '日'], grade: 2, strokes: 8, freq: 67 }, ... },
	el: { '日': { s: 4 }, '化': { s: 2, shape: '⺅' }, ... },
	alias: { '叱': '𠮟', '戀': '恋', ... }
}
```

- `k` has the 2,136 joyo kanji in school order. `m`: English meanings (KANJIDIC2). `on`, `kun`: readings; in `kun` a dot separates the part the kanji writes from the okurigana and a hyphen marks a prefix or suffix. `grade`: 1 to 6 for the years of primary school, 8 for the rest of the joyo set. `strokes`: the stroke count. `freq`: rank among the 2,500 kanji most used in newspapers, or `null`. `kokuji: true` on the kanji KANJIDIC2 marks as made in Japan (働 is one).
- `parts` are the visible components KRADFILE lists, in its order. They describe what can be seen in the glyph, not the kanji's history. A component that is itself a kanji lists itself (`'日'` has parts `['日']`).
- `el[part]` gives a component's stroke count `s` (RADKFILE). KRADFILE has to write 22 components as a kanji that contains the shape, because the shape alone is not in its character set: 化 stands for the left-hand person radical. For those, `el[part].shape` is the Unicode character KRADFILE names for the real shape (⺅). Draw `el[p].shape || p`. Two shapes are outside the Basic Multilingual Plane and missing from some fonts; fall back to the stand-in. Do not pass a shape through `normalize('NFKC')`: two of them (⽧ and ⽱) are radical code points that Unicode would turn into ordinary kanji.
- Four joyo kanji have `parts: []`: 𠮟 剝 塡 頰. KRADFILE covers JIS X 0208, and these are the forms the 2010 list took from outside it (`meta.noParts`). The same four have `freq: null`: KANJIDIC2 gives these forms no newspaper rank (where it has one, it is on the JIS X 0208 form the list replaced, which is not joyo and so not in this file).
- `alias` leads from 818 kanji that are not on the joyo list to the joyo kanji they are a form of: older forms (戀 to 恋), variant forms, and the JIS X 0208 forms of the four kanji just named (叱 剥 填 頬). It is KANJIDIC2's cross-references, kept where a kanji outside the list is cross-referenced with exactly one kanji on it. JMdict keeps to JIS X 0208 and writes those four the older way, so `jmdict-core.js` has 叱る, 剥がす, 充填 and 頬, and a lookup by `K.k[c]` alone takes eleven of its rows for words with a kanji outside the list. Look a character up through `alias` as well:

```js
var K = window.LANG_KANJI;
var withSun = Object.keys(K.k).filter(function (c) { return K.k[c].parts.indexOf('日') >= 0; });
// The record of a kanji as a dictionary writes it: the joyo kanji itself, or the one it is a form of.
function joyo(c) { return K.k[c] || K.k[K.alias[c]] || null; }
```

## `LANG_KANJI_GRADES` (kanji-grades.js)

```js
{ meta, counts: { 1: 80, 2: 160, 3: 200, 4: 202, 5: 193, 6: 191, 8: 1110 }, k: [['一', 1, 1], ['七', 1, 2], ...] }
```

Rows are `[kanji, grade, strokes]`, sorted by grade, then strokes, then code point. "The kanji known by the end of year 3" is `k.filter(function (r) { return r[1] <= 3; })`; grade 8 is everything after primary school. The counts are those of the table of kanji by school year in force since 2020 (1,026 kanji).

## `LANG_JMDICT` (jmdict-core.js)

```js
{ meta, e: [['学校', 'がっこう', 'school', 'n', 1], ..., ['', 'テレビ', 'television', 'n,abbr', 0], ...] }
```

Rows are `[kanji, kana, gloss, tags, band]`, one per JMdict entry that JMdict calls common (a form tagged news1, ichi1, spec1, spec2 or gai1).

- `kanji`: the first written form with such a tag; `''` when the entry is common only in kana. The tag `uk` means the word is usually written in kana all the same. Numbers appear as JMdict writes them (１月).
- `gloss`: the first gloss of the first sense that applies to those forms. Nothing is shortened.
- `tags`: that sense's codes, comma-separated: part of speech, then field (`comp`, `math`, `med`, ...), then misc (`uk`, `abbr`, ...). Use `row[3].split(',')`. `meta.tags.pos`, `.field`, `.misc` explain each code in JMdict's own words.
- `band`: 1 to 48 from JMdict's nfNN tags (blocks of 500 words in a newspaper frequency file, 1 the most frequent); 0 when the forms have no such tag. Rows are sorted by band, the 0s last. The band is a newspaper's view and JMdict's tagging is uneven: 人, 行く, する and テレビ have band 0, 日本 has band 25, and the file opens with 安全, 安保, 以来, 委員, 委員会. Do not read 0 as rare, and do not use the band to say how common a word is in speech.
- A few written forms belong to two entries and so to two rows.
- Left out on purpose, for pages that draw words at random: the entries whose first sense JMdict marks vulgar, derogatory, rude or sensitive (32 in the edition of 2026-10-03), and the entries whose gloss names a sex act, sex work, pornography or a sexual offence (22; JMdict's tags do not mark these). The second rule is the pattern in `meta.unwantedGloss`, applied to the gloss without regard to case. Both groups are also missing from `accents.js` and from `w` in `freq-ja.js`, which are built on this file; `known` in `freq-ja.js` still has their spellings.
- The pattern is narrow. Words glossed "sex education", "sexual harassment", "the opposite sex" or "murder" stay, as newspaper vocabulary. This is not a children's word list: a page that needs one applies its own.

```js
// The thousand most frequent nouns that are normally written with kanji.
var nouns = window.LANG_JMDICT.e.filter(function (r) {
	var tags = r[3].split(',');
	return r[0] && r[4] >= 1 && r[4] <= 20 && tags.indexOf('n') >= 0 && tags.indexOf('uk') < 0;
}).slice(0, 1000);
```

## `LANG_JMDICT_TECH` (jmdict-tech.js)

Same row shape. The words of JMdict that are written only in kanji and have a sense in computing or mathematics, common or not: 行列 is here as `['行列', 'ぎょうれつ', 'matrix', 'n,math', 11]`, where jmdict-core glosses it with its everyday first sense. Sorted by the number of kanji. Only a few dozen rows of jmdict-core carry `comp` or `math`, so a page that builds technical words needs this file.

```js
// Mathematical words of two kanji that can be built from kanji taught by the end of primary school.
var K = window.LANG_KANJI.k;
var words = window.LANG_JMDICT_TECH.e.filter(function (r) {
	var chars = Array.from(r[0]);
	return chars.length === 2 && r[3].split(',').indexOf('math') >= 0 && chars.every(function (c) { return K[c] && K[c].grade <= 6; });
});
```

## `LANG_ACCENT` (accents.js)

```js
{
	meta,
	a: { '橋|はし': [2], '端|はし': [0], '箸|はし': [1], '|テレビ': [1], ... },
	q: { ... },
	pairs: [['はし', [['橋', 2, 'bridge'], ['端', 0, 'end (e.g. of street)'], ['箸', 1, 'chopsticks']]], ...]
}
```

- `a`: key `'<kanji>|<kana>'` exactly as the row of jmdict-core has them (`'|<kana>'` for a word in kana); value: the accent numbers Kanjium lists. 0 is flat; n means the pitch falls after the n-th mora. Several numbers are several accepted accents. About nine rows in ten of jmdict-core have an entry.
- A key is a spelling, not a word. Kanjium lists an accent per spelling, and 32 keys, all of words written in kana, stand for two rows of jmdict-core: `'|クロス'` is both "cross" and "cloth", `'|カラー'` both "color" and "collar". Nothing says which word a number under such a key belongs to. `meta.sharedKeys` lists them; do not show one of their glosses beside the accent as if the two belonged together. They are never in `pairs`.
- `q`: for the few words whose numbers Kanjium qualifies by part of speech, its field word for word.
- `pairs`: `[kana, [[kanji, accent, gloss], ...]]`: words with the same kana, exactly one accent number each, and at least two different numbers in the group. Words with several accepted accents are left out, so two words of a group with different numbers really do differ.
- A mora is one kana, except that small ゃ ゅ ょ and small vowels belong to the kana before them; ー, っ and ん are morae of their own.
- Kanjium does not say where its accent numbers were compiled from.

```js
// Pitch of each mora of a word (true = high), as textbooks read the number.
// accent 0: low, then high to the end. 1: high, then low. n: low, high up to mora n, then low
// (when n is the last mora, the fall is on whatever follows the word).
function pitches(morae, accent) {
	var out = [];
	for (var i = 1; i <= morae; i++) out.push(accent === 0 ? i > 1 : accent === 1 ? i === 1 : i > 1 && i <= accent);
	return out;
}
var group = window.LANG_ACCENT.pairs.filter(function (g) { return g[0] === 'はし'; })[0];   // 橋 2, 端 0, 箸 1
```

## `LANG_FREQ_JA` (freq-ja.js)

```js
{
	meta,
	w: [['日本', 'にほん', 'Japan', 5998, 102489], ...],
	alt: { '市場': [['しじょう', 'market (financial, stock, domestic, etc.)']], ... },
	known: { '学': '一三事二人会位...', ... }
}
```

- `w`: `[kanji, kana, gloss, wiki, novels]` for every written form of exactly two kanji in jmdict-core, with its count in Kanjium's Wikipedia list and in its novels list (0 when a list lacks it), largest Wikipedia count first. The counts belong to the spelling, whatever the reading. `alt` lists the other readings jmdict-core has for a form.
- The novels list has artefacts: its segmenter turned some kana strings into the wrong kanji, so a few forms (野中 is one) have counts far above their real use. Rank by `wiki`; use `novels` for coverage.
- `known[first]` is a string of every second kanji that follows it in a two-kanji string attested in JMdict (any entry, common or not) or in either list, for kanji that are joyo or occur in `w`. A string a page invents is "not a word" only if it is absent from `known`:

```js
function attested(a, b) { var s = window.LANG_FREQ_JA.known[a]; return !!s && s.indexOf(b) >= 0; }
```

Names are covered only as far as the two lists happen to hold them. Say "not in the dictionary", not "not a word".

## `LANG_TEXT_YUMEJUYA1` (texts/yume-juya-1.js)

```js
{
	meta,
	title: '夢十夜', author: '夏目漱石', part: '第一夜',
	lines: [{ t: '　こんな夢を見た。', ruby: [] }, { t: '　腕組をして枕元に坐っていると、...', ruby: [[9, 10, 'すわ'], [16, 18, 'あおむき'], ...] }, ...]
}
```

- One line is one paragraph of the Aozora Bunko file. Narration starts with a full-width space, as in the file; render with `white-space: pre-wrap` or strip it.
- `ruby` is `[start, end, reading]`: `t.slice(start, end)` is the base, always kanji. The readings are the ruby of the source and nothing else: a kanji without ruby in the file has none here. The file marks 70 words, which cover 88 of the 501 kanji of the First Night; a reader built on it has furigana to fade on those and on no others.
- The base text is a modern edition (new character forms, modern kana), named in `meta.colophon`, which keeps the file's whole colophon.
- One character of the text is outside the file's character set and is described there in words; it is replaced by the character itself, 睜 (`meta.gaiji`).

```js
function lineHtml(line) {
	var out = '', at = 0;
	line.ruby.forEach(function (r) {
		out += esc(line.t.slice(at, r[0])) + '<ruby>' + esc(line.t.slice(r[0], r[1])) + '<rt>' + esc(r[2]) + '</rt></ruby>';
		at = r[1];
	});
	return out + esc(line.t.slice(at));
}
```

## Rebuilding

```
node scripts/lang/build-all.mjs             every file, from the cache
node scripts/lang/build-all.mjs --refresh   download the newest EDRDG files first
node scripts/lang/build-all.mjs --relock    pin the newest revisions of the wiki pages
node scripts/lang/build-<name>.mjs          one file
node misc/_lang/test.js                     afterwards
node scripts/lang/spot-check.mjs            compares the files with their sources again (needs the network)
```

- Downloads are kept in `scripts/lang/.cache/` (gitignored). A build from the cache makes no request and writes the same bytes. Requests go out one at a time, a second apart, under a User-Agent that names the site.
- Pinned sources give the same bytes whenever they are fetched: the wiki pages (revisions in `scripts/lang/hyakunin.lock.json`), Kanjium (a commit, in `scripts/lang/kanjium.mjs`), the Aozora file (its hash, in the build script).
- After `--relock` the wiki pages may have been edited. `build-hyakunin.mjs` then stops if the Wikisource page and the Wikipedia table no longer differ, by exactly one character, in the places its `CORRECTIONS` table names (someone may have fixed the page: drop the entry), and `test.js` fails if a correction, a variant or a replaced kanji is not named in this file. New differences between the two pages are not adopted: they appear in `meta.variants` and in the build's output, for a person to judge.
- The EDRDG files are not pinned: its server keeps only the newest edition, and JMdict changes daily. The EDRDG licence asks that data in use is kept up to date, so run `--refresh` from time to time (the licence suggests monthly for dictionary servers). After a refresh the counts and the size of the JMdict files move a little; `build-all.mjs` rewrites the generated parts of this file and of `LICENSES.md`.
- `jmdict-core.js` must be built before `accents.js` and `freq-ja.js`, and `kanji.js` before `freq-ja.js`; `build-all.mjs` keeps the order. `hyakunin.js` reads KANJIDIC2 from the cache for the kanji forms, so after a `--refresh` it is rebuilt against the new edition like the others.
