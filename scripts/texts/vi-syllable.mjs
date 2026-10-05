/*
 * Does a string have the shape of one Vietnamese syllable in quoc ngu spelling?
 * (initial consonant) + rhyme + at most one tone mark, with the usual spelling rules
 * (k, gh, ngh before e, ê, i; c, g, ng elsewhere; qu and gi as initials; only the sac and
 * nang tones before a final p, t, c or ch).
 *
 * This is a test of shape, not of meaning: "an", "to" and "can" pass, although in a
 * subtitle list they may be English, and a rare real syllable outside the rhyme table
 * fails. It is used by build-freq.mjs to flag the entries of the Vietnamese frequency
 * list that cannot be Vietnamese (names, English words, subtitle markup).
 */

// The five tone marks as combining characters: grave (huyen), acute (sac), tilde (nga),
// hook above (hoi), dot below (nang). Built from code points so that the source stays ASCII here.
const SAC = String.fromCharCode(0x301);
const NANG = String.fromCharCode(0x323);
const TONE_MARKS = new Set([0x300, 0x301, 0x303, 0x309, 0x323].map((c) => String.fromCharCode(c)));

// Rhymes without tone, in NFC (the vowel-quality marks of ă â ê ô ơ ư stay on the letter).
const RHYMES = new Set((
	// one vowel
	'a e ê i o ô ơ u ư y ' +
	// open rhymes of two or three vowels
	'ai ao au ay âu ây eo êu ia iu iêu oa oe oi oai oay oao oeo ôi ơi ' +
	'ua uê ui uy uơ uya uôi uây uyu ưa ưi ưu ươi ươu yêu ' +
	// closed rhymes
	'am an ang anh ap at ac ach ' +
	'ăm ăn ăng ăp ăt ăc ' +
	'âm ân âng âp ât âc ' +
	'em en eng ep et ec ' +
	'êm ên ênh êp êt êch ' +
	'im in inh ip it ich ' +
	'om on ong op ot oc oong ooc ' +
	'ôm ôn ông ôp ôt ôc ' +
	'ơm ơn ơp ơt ' +
	'um un ung up ut uc ' +
	'ưm ưn ưng ưt ưc ' +
	'iêm iên iêng iêp iêt iêc ' +
	'yêm yên yêng yêt ' +
	'uôm uôn uông uôt uôc ' +
	'ươm ươn ương ươp ươt ươc ' +
	'oam oan oang oanh oap oat oac oach ' +
	'oăm oăn oăng oăt oăc ' +
	'oen oet oem ' +
	'uân uâng uât ' +
	'uên uênh uêch ' +
	'uyn uynh uyt uych uyên uyêt'
).normalize('NFC').split(' '));

// Longest first, so that "ngh" is tried before "ng" and "n".
const ONSETS = ['ngh', 'ng', 'nh', 'gh', 'gi', 'kh', 'ph', 'qu', 'th', 'tr', 'ch',
	'b', 'c', 'd', 'đ', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'x', ''];

const BACK = 'aăâoôơuư'.normalize('NFC');     // c, g, ng are written before these
const FRONT = 'eêi'.normalize('NFC');         // k, gh, ngh are written before these
const QU_FIRST = 'aăâeêiyơ'.normalize('NFC');
const GI_FIRST = 'aăâeoôơuư'.normalize('NFC');
const E_CIRC = 'ê'.normalize('NFC');
const BASE_LETTERS = new RegExp('^[a-zđăâêôơư]+$'.normalize('NFC'));
const Y_AFTER = new Set(['', 'h', 'k', 'l', 'm', 's', 't', 'v', 'th']);

function rhymeFits(onset, rest) {
	const first = rest.charAt(0);
	switch (onset) {
		case 'qu':
			return (rest !== '' && RHYMES.has(rest) && QU_FIRST.includes(first)) || RHYMES.has('u' + rest);
		case 'gi':
			if (rest === '' || rest === 'n' || rest === 'm') return true;          // gì, gìn, (gim)
			if (first === E_CIRC) return RHYMES.has('i' + rest);                   // giêng, giết: g + iêng
			return RHYMES.has(rest) && GI_FIRST.includes(first);
		case 'c': case 'g': case 'ng':
			return RHYMES.has(rest) && BACK.includes(first);
		case 'gh': case 'ngh':
			return RHYMES.has(rest) && FRONT.includes(first);
		case 'k':
			return RHYMES.has(rest) && (FRONT.includes(first) || rest === 'y');
		default:
			if (!RHYMES.has(rest)) return false;
			if (rest === 'y') return Y_AFTER.has(onset);
			if (rest.startsWith('y' + E_CIRC)) return onset === '';
			if (rest.startsWith('i' + E_CIRC)) return onset !== '';
			return true;
	}
}

export function isViSyllable(word) {
	let tone = '';
	let base = '';
	let letter = '';        // the last base letter seen: a tone mark must sit on a vowel
	for (const ch of word.normalize('NFD')) {
		if (TONE_MARKS.has(ch)) {
			if (tone || !'aeiouy'.includes(letter) || letter === '') return false;
			tone = ch;
		} else {
			base += ch;
			if (ch >= 'a' && ch <= 'z') letter = ch;
			else if (ch.charCodeAt(0) < 0x300 || ch.charCodeAt(0) > 0x36F) letter = '-';
		}
	}
	base = base.normalize('NFC');
	if (!BASE_LETTERS.test(base)) return false;
	const stop = /(?:ch|c|p|t)$/.test(base);
	for (const onset of ONSETS) {
		if (!base.startsWith(onset)) continue;
		const rest = base.slice(onset.length);
		if (onset !== 'gi' && rest === '') continue;
		if (!rhymeFits(onset, rest)) continue;
		// A final stop carries only the sac or the nang tone. ("gi" alone has no final.)
		if (stop && rest !== '' && tone !== SAC && tone !== NANG) continue;
		return true;
	}
	return false;
}
