/*
 * The words that the word lists of misc/_texts flag as `blocked`: entries a toy should not
 * pick as a stimulus (a word to guess, type or judge). One module, so that cmu-phones.js,
 * freq-de.js, freq-vi.js, the gloss filter of glosses-de.js and the topic screen of
 * sentences.js cannot drift apart. Nothing is ever removed from a list; words are flagged.
 *
 * Where the flags come from:
 *   - LDNOOBW (Shutterstock's "List of Dirty, Naughty, Obscene, and Otherwise Bad Words"),
 *     CC BY 4.0, read at a fixed commit: its English list for every word list (the German and
 *     Vietnamese subtitle lists are full of English), its German list for German.
 *   - SEEN below: forms the builders found in the word lists themselves that the published
 *     lists miss. LDNOOBW holds base forms ("fuck", "slut", "whore") and few inflected ones,
 *     so "fucked", "sluts" and "whores" have to be added by hand; it has no Vietnamese at all;
 *     and it does not name Hitler or the Nazis.
 *   - SITE: an entry of a subtitle list that is the address of a subtitle or download site.
 * UNBLOCK lists the hits of a published list that are everyday words of the language.
 *
 * What is flagged: profanity, sexual terms (the acts, the trade, the genitals), slurs for
 * groups of people, rape, and the names Hitler and Nazi. What is left alone: mild words
 * (damn, hell, crap, bloody; verdammt, Mist), mild insults (idiot, moron; Idiot, Trottel),
 * neutral words for groups of people (gay, lesbian, Jew; schwul, Jude), other body parts
 * (breast, buttocks), and violence, drugs and illness, which are not this list's business.
 * A judgement, not a guarantee: a toy that shows random words should still let a reader skip
 * one.
 *
 * How SEEN was found.
 *   2026-10-03, first builder: the 20,000 German entries were searched for about 200 word
 *     stems and the hits read; every Vietnamese entry that has the shape of a syllable was
 *     read (4,356 of them).
 *   2026-10-05, after a review found thirteen unflagged obscenities in the English list and
 *     six in the German one: all three lists (30,000 + 20,000 + 10,000 entries) were searched
 *     again with the stems in review-blocked.mjs, as substrings this time, so that an
 *     inflected form or a compound of a flagged word cannot slip through, and every hit was
 *     read (about 870 English, 790 German and 140 Vietnamese-list hits). The English entries
 *     were also compared with a second published list (zacanger/profane-words, 2,725 entries,
 *     used as a search aid only: nothing of it is stored), which turned up two more spellings.
 *     The lists were not read from end to end; a word with a stem nobody thought of is still
 *     possible.
 *
 *     node scripts/texts/review-blocked.mjs      prints the stem hits again, for reading
 */

export const LD_COMMIT = '5faf2ba42d7b1c0977169ec3611df25a3c08eb13';
export const LD_BASE = 'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/' + LD_COMMIT + '/';
/** [label, cache name, URL] of the two published lists that are used. */
export const LD_EN = ['LDNOOBW en', 'blocked/ldnoobw-en.txt', LD_BASE + 'en'];
export const LD_DE = ['LDNOOBW de', 'blocked/ldnoobw-de.txt', LD_BASE + 'de'];

export const SEEN = {
	/* English. Applied to all three lists. The last line is German that the English web list
	 * holds (CMUdict knows the words as surnames). */
	en: ('fucked fucks fucker fuckers blowjobs dildos dicks sluts slutty pussies whores bastards assholes asses arse jackass butts ' +
		'piss pissed sucking sucked vibrators escorts swingers orgies orgasms nudes nudist naked erotica pornographic sexes sexiest ' +
		'masterbating masterbation raped rapes ' +
		'fetish sperm condom condoms erection genital vaginal penile testicles testicular pubic foreskin rectal ' +
		'stripper strippers striptease prostitute prostitutes prostitution pimp pervert perverted prick ' +
		'homo queer dyke dykes jap gypsy gypsies midget midgets cripple retard retarded redskins ' +
		'nazi nazis hitler ' +
		'fick ficken geil').split(' '),
	/* German. The first eleven lines are the first builder's; the last three were added on 2026-10-05. */
	de: ('scheiß scheisse scheiss scheißkerl scheißkerle scheißegal scheißer scheißen scheißt scheißdreck scheißding ' +
		'klugscheißer hosenscheißer bescheißen beschissen geschissen schiss ' +
		'arschlöcher arschlöchern arschgesicht verarschen verarscht verarschst verarsch verarsche ' +
		'fickt fickst ficke gefickt verfickt verfickte verfickten verfickter ' +
		'verpiss verpisst verpissen angepisst pisse pisst ' +
		'huren hurensöhne schlampen schwuchteln tunte homo ' +
		'schwanz schwänze schlappschwanz gevögelt vögelt vögelst gebumst bumst flachlegen ' +
		'geil geile geiler geilen geiles ' +
		'pornos sperma hoden muschis nackte nackten masturbieren ' +
		'vergewaltigt vergewaltigung vergewaltigen vergewaltiger ' +
		'krüppel missgeburt zigeuner bastarde ' +
		'drecksack dreckskerl dreckskerle drecksau dreckschwein drecksloch miststück mistkerl mistkerle ' +
		'kotzen kotzt kotze gekotzt fresse ' +
		'nazi nazis hitler hitlers ' +
		'ärsche beschissene beschissenen beschissener beschissenes flachgelegt gepinkelt pinkelt ' +
		'prostituierte prostituierten zuhälter stripperin bordell luder orgie genitalien kondom kondome ' +
		'sexuell sexuelle sexuellen sexueller sexuelles sexualität sexleben pervers perverse perversen perverser perversling').split(' '),
	/* Vietnamese: found by reading every syllable-shaped entry. */
	vi: ('địt đụ đéo đếch đệt đệch đếu éo đù lồn lìn cặc buồi dái cứt đĩ điếm đít đái ỉa ' +
		'nứng chịch phò cave trym chym bím vếu vãi dâm hiếp khựa mẽo mịa móa ' +
		'đm đ.m vl cmn clgt').split(' '),
};

/* Hits of the English lists that are everyday words of the language and stay unflagged. */
export const UNBLOCK = {
	en: [],
	de: [],
	vi: ['mong'],   // "to hope, to expect", rank 627
};

/* The address of a web site: two or more labels of at least two characters, the last one
 * letters only. "phudeviet.org" and "board.tv4user.de" match; "mr.", "l.a", "t.anh" and
 * "fsp-0.75" do not. */
export const SITE = /^(?:[a-z0-9-]{2,}\.)+[a-z]{2,}$/;

function nfc(s) {
	return s.normalize('NFC');
}

/** The entries of a published list: one per line, lower-cased, NFC. Phrases are kept. */
export function entriesOf(text) {
	return text.split('\n').map((s) => nfc(s.trim().toLowerCase())).filter(Boolean);
}

/** LDNOOBW's English list plus SEEN.en: what the gloss filter and the topic screen read. */
export function englishEntries(ldEnText) {
	return [...new Set(entriesOf(ldEnText).concat(SEEN.en))];
}

/**
 * Flag the words of one list.
 *   words      the kept entries, most frequent first
 *   published  [[label, text of the published list], ...]
 *   seen       [[label, array of words], ...]   (labels like "seen de")
 *   unblock    words to leave unflagged although a published list has them
 *   sites      true to flag entries that match SITE
 * Returns { blocked (in the order of `words`), why (Map word -> labels), publishedHits
 * ({ label: entries of that list that occur here }), seenNew ({ label: words flagged that no
 * list before it in the call had flagged }), seenMissing ({ label: words of it that are not
 * among the entries }), sites (the entries flagged as addresses) }.
 */
export function flagBlocked(words, { published = [], seen = [], unblock = [], sites = false }) {
	const has = new Set(words);
	const why = new Map();
	const note = (word, label) => {
		if (!has.has(word)) return false;
		if (!why.has(word)) why.set(word, []);
		why.get(word).push(label);
		return true;
	};
	const publishedHits = {};
	for (const [label, text] of published) publishedHits[label] = entriesOf(text).filter((w) => note(w, label)).length;
	const seenNew = {};
	const seenMissing = {};
	for (const [label, list] of seen) {
		const entries = list.map(nfc);
		if (new Set(entries).size !== entries.length) throw new Error(label + ' repeats a word');
		seenMissing[label] = entries.filter((w) => !has.has(w));
		seenNew[label] = entries.filter((w) => has.has(w) && !why.has(w)).length;
		for (const w of entries) note(w, label);
	}
	for (const w of unblock.map(nfc)) {
		if (!why.has(w)) throw new Error('UNBLOCK names ' + w + ', which nothing blocks');
		why.delete(w);
	}
	const siteHits = [];
	if (sites) {
		for (const w of words) {
			if (!SITE.test(w)) continue;
			siteHits.push(w);
			note(w, 'site');
		}
	}
	return { blocked: words.filter((w) => why.has(w)), why, publishedHits, seenNew, seenMissing, sites: siteHits };
}
