/* Homophone Bridge: coarse grapheme-to-phoneme rules and sound distance.
 *
 * Shared by the one-off Node build script (which generated lexicon.js) and by
 * the page at runtime (free mode transcribes typed words that are not in the
 * lexicon). Everything is deliberately coarse: the whole point is to find
 * words in different languages that sound *roughly* alike, so we squash the
 * world's phonemes into 28 symbols, one character each:
 *
 *   vowels      a e i o u  @ (schwa / reduced vowel)
 *   stops       p b t d k g
 *   nasals      m n
 *   liquids     l r
 *   fricatives  s z S(sh) Z(zh) f v h T(th)
 *   affricates  C(ch) J(j as in judge)
 *   glides      w y
 *
 * Phoneme strings are plain ASCII so they are cheap to store and compare.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.HB_G2P = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VOWELS = 'aeiou@';
  function isV(c) { return c !== undefined && c !== '' && VOWELS.indexOf(c) >= 0; }
  /* True when ch is one of the characters in set (false for undefined/empty). */
  function has(set, ch) { return !!ch && set.indexOf(ch) >= 0; }

  /* IPA-ish rendering of a coarse phoneme string, for display. */
  var IPA_OUT = { S: 'ʃ', Z: 'ʒ', C: 'tʃ', J: 'dʒ', T: 'θ', y: 'j', '@': 'ə' };
  function toIPA(phon) {
    var out = '';
    for (var i = 0; i < phon.length; i++) out += IPA_OUT[phon[i]] || phon[i];
    return out;
  }

  /* Collapse doubled letters ("bello" -> "belo") after transcription. */
  function dedupe(p) {
    var out = '';
    for (var i = 0; i < p.length; i++) if (p[i] !== p[i - 1]) out += p[i];
    return out;
  }
  function stripAccents(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
  }

  /* ----------------------------------------------------------------------
   * Spanish: nearly phonemic. Seseo (c/z before e,i -> s), yeísmo (ll -> y).
   * -------------------------------------------------------------------- */
  function g2pEs(word) {
    var s = word.toLowerCase().normalize('NFC').replace(/ü/g, 'W');
    s = stripAccents(s.replace(/ñ/g, 'N')); // keep ñ and ü as markers
    var out = '', i = 0, c, n, n2;
    while (i < s.length) {
      c = s[i]; n = s[i + 1]; n2 = s[i + 2];
      if (c === 'c' && n === 'h') { out += 'C'; i += 2; continue; }
      if (c === 'l' && n === 'l') { out += 'y'; i += 2; continue; }
      if (c === 'r' && n === 'r') { out += 'r'; i += 2; continue; }
      if (c === 'q' && n === 'u') { out += 'k'; i += 2; continue; }
      if (c === 'g' && n === 'W') { out += 'gw'; i += 2; continue; }
      if (c === 'g' && n === 'u' && (n2 === 'e' || n2 === 'i')) { out += 'g'; i += 2; continue; }
      if (c === 'g' && (n === 'e' || n === 'i')) { out += 'h'; i++; continue; }
      if (c === 'c' && (n === 'e' || n === 'i')) { out += 's'; i++; continue; }
      if (c === 'c') { out += 'k'; i++; continue; }
      if (c === 'N') { out += 'ny'; i++; continue; }
      if (c === 'W') { out += 'w'; i++; continue; }
      if (c === 'h') { i++; continue; }
      if (c === 'j') { out += 'h'; i++; continue; }
      if (c === 'v') { out += 'b'; i++; continue; }
      if (c === 'x') { out += (i === 0 ? 's' : 'ks'); i++; continue; }
      if (c === 'z') { out += 's'; i++; continue; }
      if (c === 'y') { out += (n && 'aeiou'.indexOf(n) >= 0) ? 'y' : 'i'; i++; continue; }
      if (c === 'i' && n && 'aeou'.indexOf(n) >= 0) { out += 'y'; i++; continue; }
      if (c === 'u' && n && 'aeio'.indexOf(n) >= 0 && s[i - 1] !== 'q') { out += 'w'; i++; continue; }
      if (/[a-z]/.test(c)) out += c;
      i++;
    }
    return dedupe(out);
  }

  /* ----------------------------------------------------------------------
   * Italian: nearly phonemic; doubled consonants collapse (coarse).
   * -------------------------------------------------------------------- */
  function g2pIt(word) {
    var s = stripAccents(word.toLowerCase());
    var out = '', i = 0, c, n, n2;
    while (i < s.length) {
      c = s[i]; n = s[i + 1]; n2 = s[i + 2];
      if (c === n && !has('aeiou', c)) { i++; continue; } /* doubled consonant */
      if (c === 's' && n === 'c' && n2 === 'h') { out += 'sk'; i += 3; continue; }
      if (c === 's' && n === 'c' && n2 === 'i' && has('aeou', s[i + 3])) { out += 'S'; i += 3; continue; }
      if (c === 's' && n === 'c' && (n2 === 'e' || n2 === 'i')) { out += 'S'; i += 2; continue; }
      if (c === 'c' && n === 'h') { out += 'k'; i += 2; continue; }
      if (c === 'g' && n === 'h') { out += 'g'; i += 2; continue; }
      if (c === 'g' && n === 'l' && n2 === 'i') {
        out += 'ly'; i += 3;
        if (!has('aeou', s[i])) out += 'i';
        continue;
      }
      if (c === 'g' && n === 'n') { out += 'ny'; i += 2; continue; }
      if (c === 'c' && n === 'i' && has('aeou', n2)) { out += 'C'; i += 2; continue; }
      if (c === 'c' && (n === 'e' || n === 'i')) { out += 'C'; i++; continue; }
      if (c === 'c') { out += 'k'; i++; continue; }
      if (c === 'g' && n === 'i' && has('aeou', n2)) { out += 'J'; i += 2; continue; }
      if (c === 'g' && (n === 'e' || n === 'i')) { out += 'J'; i++; continue; }
      if (c === 'q' && n === 'u') { out += 'kw'; i += 2; continue; }
      if (c === 'z') { out += 'ts'; i++; continue; }
      if (c === 'h') { i++; continue; }
      if (c === 'i' && n && 'aeou'.indexOf(n) >= 0) { out += 'y'; i++; continue; }
      if (c === 'u' && n && 'aeio'.indexOf(n) >= 0) { out += 'w'; i++; continue; }
      if (/[a-z]/.test(c)) out += c;
      i++;
    }
    return dedupe(out);
  }

  /* ----------------------------------------------------------------------
   * German: rule-based, with final devoicing and reduced -e/-en/-er.
   * -------------------------------------------------------------------- */
  function g2pDe(word) {
    var s = word.toLowerCase().normalize('NFC')
      .replace(/ä/g, 'e').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 's');
    s = stripAccents(s);
    var out = '', i = 0, c, n, n2, n3;
    while (i < s.length) {
      c = s[i]; n = s[i + 1]; n2 = s[i + 2]; n3 = s[i + 3];
      if (c === 't' && n === 's' && n2 === 'c' && n3 === 'h') { out += 'C'; i += 4; continue; }
      if (c === 's' && n === 'c' && n2 === 'h') { out += 'S'; i += 3; continue; }
      if (c === 'c' && n === 'h' && n2 === 's') { out += 'ks'; i += 3; continue; }
      if (c === 'c' && n === 'h') { out += 'h'; i += 2; continue; }
      if (c === 'c' && n === 'k') { out += 'k'; i += 2; continue; }
      if (c === 'p' && n === 'h') { out += 'f'; i += 2; continue; }
      if (c === 'q' && n === 'u') { out += 'kv'; i += 2; continue; }
      if (c === 't' && n === 'h') { out += 't'; i += 2; continue; }
      if (c === 'd' && n === 't') { out += 't'; i += 2; continue; }
      if (c === 't' && n === 'z') { out += 'ts'; i += 2; continue; }
      if (c === 't' && n === 'i' && n2 === 'o' && n3 === 'n') { out += 'tsyon'; i += 4; continue; }
      if (c === 'z') { out += 'ts'; i++; continue; }
      if (c === 'v') { out += 'f'; i++; continue; }
      if (c === 'w') { out += 'v'; i++; continue; }
      if (c === 'j') { out += 'y'; i++; continue; }
      if (c === 'y') { out += 'i'; i++; continue; }
      if (c === 'x') { out += 'ks'; i++; continue; }
      if (c === 'c') { out += 'k'; i++; continue; }
      if (i === 0 && c === 's' && (n === 'p' || n === 't')) { out += 'S'; i++; continue; }
      if (c === 's' && n === 's') { out += 's'; i += 2; continue; }
      if (c === 's' && n && 'aeiou'.indexOf(n) >= 0) { out += 'z'; i++; continue; }
      if ((c === 'e' || c === 'a') && (n === 'i' || n === 'y')) { out += 'ai'; i += 2; continue; }
      if (c === 'i' && n === 'e') { out += 'i'; i += 2; continue; }
      if (c === 'e' && n === 'u') { out += 'oi'; i += 2; continue; }
      if (c === 'a' && n === 'u') { out += 'au'; i += 2; continue; }
      if (c === 'h' && i > 0 && 'aeiou'.indexOf(s[i - 1]) >= 0 && !(n && 'aeiou'.indexOf(n) >= 0)) { i++; continue; }
      if (c === 'n' && n === 'g') { out += 'n'; i += 2; continue; }
      if (c === 'i' && n === 'g' && i + 2 === s.length) { out += 'ih'; i += 2; continue; }
      if (c === 'e' && n === 'r' && i + 2 === s.length && i > 0) { out += '@'; i += 2; continue; }
      if (c === 'e' && i + 1 === s.length && i > 0) { out += '@'; i++; continue; }
      if (c === 'e' && n && 'nlmst'.indexOf(n) >= 0 && i + 2 === s.length && i > 0) { out += '@'; i++; continue; }
      if (/[a-z]/.test(c)) out += c;
      i++;
    }
    out = dedupe(out);
    /* Auslautverhärtung: final voiced stops devoice. */
    var last = out[out.length - 1];
    if (last === 'b') out = out.slice(0, -1) + 'p';
    else if (last === 'd') out = out.slice(0, -1) + 't';
    else if (last === 'g') out = out.slice(0, -1) + 'k';
    return out;
  }

  /* ----------------------------------------------------------------------
   * French: silent endings, nasal vowels, soft c/g, "ill" -> y.
   * -------------------------------------------------------------------- */
  var FR_ILL_EXC = { ville: 1, mille: 1, tranquille: 1, village: 1 };
  function g2pFr(word) {
    var s = word.toLowerCase().normalize('NFC')
      .replace(/œ/g, 'oe').replace(/æ/g, 'e').replace(/ç/g, 'S_');
    s = stripAccents(s).replace(/S_/g, 'ç');
    /* Endings that are pronounced [e]: -er (verbs), -ez, -et, -é. */
    if (/e[rz]$/.test(s) && s.length > 4) s = s.slice(0, -2) + 'E';
    else if (/et$/.test(s) && s.length > 3) s = s.slice(0, -2) + 'E';
    else if (/[^aeiouy]e$/.test(s) && s.length > 2) s = s.slice(0, -1); /* silent final e */
    else if (/[^aeiouy]es$/.test(s) && s.length > 3) s = s.slice(0, -2);
    if (s.length === 2 && /^[^aeiou]e$/.test(s)) s = s[0] + '@'; /* le, de, me, je */
    /* -ent is treated as a nasal noun/adverb ending (moment, vraiment). */
    if (/ent$/.test(s) && s.length > 4) s = s.slice(0, -3) + 'aN';
    /* Silent final consonants. */
    var guard = 0;
    while (s.length > 2 && /[dtsxzp]$/.test(s) && guard++ < 3) s = s.slice(0, -1);
    if (/[^n]g$/.test(s) && s.length > 3) s = s; else if (/ng$/.test(s)) s = s.slice(0, -1);
    if (/nc$/.test(s) && s.length > 3) s = s.slice(0, -1);
    if (/[aeou]il$/.test(s)) s = s.slice(0, -2) + 'Y';
    var out = '', i = 0, c, n, n2, n3, rest;
    function nasalNext(k) { var x = s[k]; return x === undefined || (!('aeiouy@E'.indexOf(x) >= 0) && x !== 'n' && x !== 'm' && x !== 'h'); }
    while (i < s.length) {
      c = s[i]; n = s[i + 1]; n2 = s[i + 2]; n3 = s[i + 3]; rest = s.slice(i);
      if (c === 'E') { out += 'e'; i++; continue; }
      if (c === 'N') { out += 'n'; i++; continue; }
      if (c === 'Y') { out += 'y'; i++; continue; }
      if (c === '@') { out += '@'; i++; continue; }
      if (rest.indexOf('eau') === 0) { out += 'o'; i += 3; continue; }
      if (rest.indexOf('tion') === 0) { out += 'syon'; i += 4; continue; }
      if (rest.indexOf('oin') === 0 && nasalNext(i + 3)) { out += 'wen'; i += 3; continue; }
      if (rest.indexOf('ien') === 0 && nasalNext(i + 3)) { out += 'yen'; i += 3; continue; }
      if (rest.indexOf('ion') === 0 && nasalNext(i + 3)) { out += 'yon'; i += 3; continue; }
      if ((rest.indexOf('ain') === 0 || rest.indexOf('aim') === 0 || rest.indexOf('ein') === 0) && nasalNext(i + 3)) { out += 'en'; i += 3; continue; }
      if (rest.indexOf('ill') === 0 && !FR_ILL_EXC[word.toLowerCase()]) {
        if (i > 0 && 'aeiou'.indexOf(s[i - 1]) >= 0) { out += 'y'; } else { out += 'iy'; }
        i += 3; continue;
      }
      if (rest.indexOf('au') === 0) { out += 'o'; i += 2; continue; }
      if (rest.indexOf('ou') === 0) { out += (has('aeio', n2) ? 'w' : 'u'); i += 2; continue; }
      if (rest.indexOf('oi') === 0) { out += 'wa'; i += 2; continue; }
      if (rest.indexOf('eu') === 0 || rest.indexOf('oe') === 0) { out += 'o'; i += 2; continue; }
      if (rest.indexOf('ai') === 0 || rest.indexOf('ei') === 0) { out += 'e'; i += 2; continue; }
      if (rest.indexOf('ay') === 0) { out += 'ey'; i += 2; continue; }
      if ((c === 'a' || c === 'e') && (n === 'n' || n === 'm') && nasalNext(i + 2)) { out += 'an'; i += 2; continue; }
      if ((c === 'i' || c === 'y' || c === 'u') && (n === 'n' || n === 'm') && nasalNext(i + 2)) { out += 'en'; i += 2; continue; }
      if (c === 'o' && (n === 'n' || n === 'm') && nasalNext(i + 2)) { out += 'on'; i += 2; continue; }
      if (c === 'c' && n === 'h') { out += 'S'; i += 2; continue; }
      if (c === 'p' && n === 'h') { out += 'f'; i += 2; continue; }
      if (c === 't' && n === 'h') { out += 't'; i += 2; continue; }
      if (c === 'g' && n === 'n') { out += 'ny'; i += 2; continue; }
      if (c === 'q' && n === 'u') { out += 'k'; i += 2; continue; }
      if (c === 'g' && n === 'u' && has('eiy', n2)) { out += 'g'; i += 2; continue; }
      if (c === 'g' && has('eiy', n)) { out += 'Z'; i++; continue; }
      if (c === 'c' && has('eiy', n)) { out += 's'; i++; continue; }
      if (c === 'c') { out += 'k'; i++; continue; }
      if (c === 'ç') { out += 's'; i++; continue; }
      if (c === 'j') { out += 'Z'; i++; continue; }
      if (c === 'h') { i++; continue; }
      if (c === 'x') { out += (i === 1 && s[0] === 'e' && has('aeiou', n)) ? 'gz' : 'ks'; i++; continue; }
      if (c === 's' && n === 's') { out += 's'; i += 2; continue; }
      if (c === 's' && i > 0 && 'aeiouy'.indexOf(s[i - 1]) >= 0 && has('aeiouy', n)) { out += 'z'; i++; continue; }
      if (c === 'y') { out += (has('aeiou', n) ? 'y' : 'i'); i++; continue; }
      if (c === 'e') {
        /* closed syllable -> e, open syllable before another vowel -> schwa */
        if (n === undefined) { out += 'e'; }
        else if (!isV(n) && n2 !== undefined && isV(n2) && n !== 'E') out += '@';
        else out += 'e';
        i++; continue;
      }
      if (c === 'i' && n && 'aeou'.indexOf(n) >= 0) { out += 'y'; i++; continue; }
      if (c === 'u' && n && 'aeio'.indexOf(n) >= 0) { out += 'w'; i++; continue; }
      if (/[a-z]/.test(c)) out += c;
      i++;
    }
    return dedupe(out);
  }

  /* ----------------------------------------------------------------------
   * English fallback for words missing from the CMU dictionary. Very rough:
   * English spelling is not a phonemic script and we do not pretend it is.
   * -------------------------------------------------------------------- */
  function g2pEnRules(word) {
    var s = stripAccents(word.toLowerCase()).replace(/[^a-z]/g, '');
    if (/[^aeiou][^aeiou]?e$/.test(s) && /[aeiou]/.test(s.slice(0, -1)) && s.length > 3) {
      /* magic e: rate, hope, fine */
      var m = s.match(/(^|[^aeiou])([aeiou])([^aeiou])e$/);
      if (m) {
        var v = { a: 'ei', i: 'ai', o: 'o', u: 'u', e: 'i' }[m[2]];
        s = s.slice(0, m.index) + m[1] + '{' + v + '}' + m[3];
      } else s = s.slice(0, -1);
    }
    var out = '', i = 0, c, n, n2, rest;
    while (i < s.length) {
      c = s[i]; n = s[i + 1]; n2 = s[i + 2]; rest = s.slice(i);
      if (c === '{') { var j = s.indexOf('}', i); out += s.slice(i + 1, j); i = j + 1; continue; }
      if (rest.indexOf('tch') === 0) { out += 'C'; i += 3; continue; }
      if (rest.indexOf('igh') === 0) { out += 'ai'; i += 3; continue; }
      if (rest.indexOf('ough') === 0) { out += 'o'; i += 4; continue; }
      if (rest.indexOf('tion') === 0) { out += 'S@n'; i += 4; continue; }
      if (c === 'c' && n === 'h') { out += 'C'; i += 2; continue; }
      if (c === 's' && n === 'h') { out += 'S'; i += 2; continue; }
      if (c === 't' && n === 'h') { out += 'T'; i += 2; continue; }
      if (c === 'p' && n === 'h') { out += 'f'; i += 2; continue; }
      if (c === 'w' && n === 'h') { out += 'w'; i += 2; continue; }
      if (c === 'c' && n === 'k') { out += 'k'; i += 2; continue; }
      if (c === 'q' && n === 'u') { out += 'kw'; i += 2; continue; }
      if (i === 0 && c === 'k' && n === 'n') { out += 'n'; i += 2; continue; }
      if (i === 0 && c === 'w' && n === 'r') { out += 'r'; i += 2; continue; }
      if (c === 'n' && n === 'g') { out += 'n'; i += 2; continue; }
      if (c === 'x') { out += 'ks'; i++; continue; }
      if (c === 'c' && has('eiy', n)) { out += 's'; i++; continue; }
      if (c === 'c') { out += 'k'; i++; continue; }
      if (c === 'g' && has('ey', n)) { out += 'J'; i++; continue; }
      if (c === 'j') { out += 'J'; i++; continue; }
      if (rest.indexOf('ee') === 0 || rest.indexOf('ea') === 0) { out += 'i'; i += 2; continue; }
      if (rest.indexOf('oo') === 0) { out += 'u'; i += 2; continue; }
      if (rest.indexOf('ou') === 0 || rest.indexOf('ow') === 0) { out += (rest.indexOf('ow') === 0 && n2 === undefined ? 'o' : 'au'); i += 2; continue; }
      if (rest.indexOf('ai') === 0 || rest.indexOf('ay') === 0) { out += 'ei'; i += 2; continue; }
      if (rest.indexOf('oa') === 0) { out += 'o'; i += 2; continue; }
      if (rest.indexOf('oi') === 0 || rest.indexOf('oy') === 0) { out += 'oi'; i += 2; continue; }
      if (rest.indexOf('au') === 0 || rest.indexOf('aw') === 0) { out += 'o'; i += 2; continue; }
      if (c === 'y') { out += (n && 'aeiou'.indexOf(n) >= 0 ? 'y' : 'i'); i++; continue; }
      if (c === 'u') { out += 'a'; i++; continue; }
      if (c === 'e' && n === 'r' && n2 === undefined) { out += '@'; i += 2; continue; }
      if (/[a-z]/.test(c)) out += c;
      i++;
    }
    return dedupe(out);
  }

  /* ----------------------------------------------------------------------
   * Japanese kana -> coarse phonemes and -> Hepburn romaji.
   * -------------------------------------------------------------------- */
  var KANA = {
    'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
    'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
    'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',
    'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
    'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no',
    'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
    'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo',
    'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
    'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',
    'わ': 'wa', 'ゐ': 'i', 'ゑ': 'e', 'を': 'o', 'ん': 'n',
    'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go',
    'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',
    'だ': 'da', 'ぢ': 'ji', 'づ': 'zu', 'で': 'de', 'ど': 'do',
    'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',
    'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po',
    'ゔ': 'vu',
    'ぁ': 'a', 'ぃ': 'i', 'ぅ': 'u', 'ぇ': 'e', 'ぉ': 'o'
  };
  var KANA_Y = { 'ゃ': 'ya', 'ゅ': 'yu', 'ょ': 'yo' };
  /* Katakana-only combinations for loanwords: preceding kana + small vowel. */
  var KANA_COMBO = {
    'てぃ': 'ti', 'でぃ': 'di', 'とぅ': 'tu', 'どぅ': 'du', 'でゅ': 'dyu', 'てゅ': 'tyu',
    'ふぁ': 'fa', 'ふぃ': 'fi', 'ふぇ': 'fe', 'ふぉ': 'fo', 'ふゅ': 'fyu',
    'うぃ': 'wi', 'うぇ': 'we', 'うぉ': 'wo',
    'ゔぁ': 'va', 'ゔぃ': 'vi', 'ゔぇ': 've', 'ゔぉ': 'vo',
    'しぇ': 'she', 'じぇ': 'je', 'ちぇ': 'che', 'つぁ': 'tsa', 'つぃ': 'tsi', 'つぇ': 'tse', 'つぉ': 'tso',
    'いぇ': 'ye'
  };
  function kataToHira(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      out += (code >= 0x30a1 && code <= 0x30f6) ? String.fromCharCode(code - 0x60) : s[i];
    }
    return out;
  }
  /* Returns Hepburn-ish romaji (wāpuro long vowels: ou, uu). */
  function kanaToRomaji(kana) {
    var s = kataToHira(kana.normalize('NFC'));
    var out = [], i = 0, c, n, pair, base;
    while (i < s.length) {
      c = s[i]; n = s[i + 1]; pair = c + (n || '');
      if (KANA_COMBO[pair]) { out.push(KANA_COMBO[pair]); i += 2; continue; }
      if (KANA[c] && n && KANA_Y[n]) {
        base = KANA[c];
        var cons = base.slice(0, -1); /* ki -> k, shi -> sh, chi -> ch, ji -> j */
        var y = KANA_Y[n];
        if (cons === 'sh' || cons === 'ch' || cons === 'j') out.push(cons + y.slice(1));
        else out.push(cons + y);
        i += 2; continue;
      }
      if (c === 'っ') { out.push('Q'); i++; continue; }
      if (c === 'ー') { out.push('-'); i++; continue; }
      if (KANA[c]) { out.push(KANA[c]); i++; continue; }
      if (KANA_Y[c]) { out.push(KANA_Y[c]); i++; continue; }
      i++; /* punctuation, unknown */
    }
    /* Resolve gemination and long-vowel marks. */
    var r = '';
    for (i = 0; i < out.length; i++) {
      var m = out[i];
      if (m === 'Q') { var nx = out[i + 1] || ''; r += (nx[0] && /[a-z]/.test(nx[0]) && !/[aeiou]/.test(nx[0])) ? (nx.slice(0, 2) === 'ch' ? 't' : nx[0]) : ''; continue; }
      if (m === '-') { var lv = r[r.length - 1]; r += (/[aeiou]/.test(lv || '') ? lv : ''); continue; }
      r += m;
    }
    return r;
  }
  /* Coarse phonemes from kana. Long vowels collapse, gemination is dropped. */
  function kanaToPhon(kana) {
    var r = kanaToRomaji(kana);
    var p = r.replace(/sh/g, 'S').replace(/ch/g, 'C').replace(/j/g, 'J').replace(/ts/g, 'ts');
    /* Devoiced /u/ in final -su is common (desu, -masu) but we keep it: coarse. */
    p = p.replace(/ou/g, 'o').replace(/oo/g, 'o').replace(/uu/g, 'u').replace(/aa/g, 'a').replace(/ii/g, 'i').replace(/ee/g, 'e');
    p = p.replace(/n(?=[bmp])/g, 'm');
    return dedupe(p.replace(/[^a-zSCJ@]/g, ''));
  }
  /* Romaji typed by a user in free mode -> phonemes (also used for kana via romaji). */
  function romajiToPhon(r) {
    var p = r.toLowerCase().replace(/ō/g, 'ou').replace(/ū/g, 'uu').replace(/ā/g, 'a').replace(/ē/g, 'e').replace(/ī/g, 'i');
    p = p.replace(/sh/g, 'S').replace(/ch/g, 'C').replace(/j/g, 'J');
    p = p.replace(/ou/g, 'o').replace(/oo/g, 'o').replace(/uu/g, 'u').replace(/aa/g, 'a').replace(/ii/g, 'i').replace(/ee/g, 'e');
    return dedupe(p.replace(/[^a-zSCJ@]/g, ''));
  }
  function isKana(s) { return /^[぀-ヿー]+$/.test(s); }
  function hasJapanese(s) { return /[぀-ヿ一-鿿]/.test(s); }

  /* ----------------------------------------------------------------------
   * IPA (as found in Wiktionary) -> coarse phonemes.
   * -------------------------------------------------------------------- */
  var IPA_MAP = {
    'a': 'a', 'ɑ': 'a', 'æ': 'a', 'ʌ': 'a', 'ɐ': 'a', 'ä': 'a', 'ɒ': 'o',
    'e': 'e', 'ɛ': 'e', 'ø': 'o', 'œ': 'o', 'ɶ': 'o', 'ɛ̈': 'e',
    'ə': '@', 'ɘ': '@', 'ɜ': '@', 'ɚ': '@', 'ɝ': '@', 'ɵ': '@', 'ɤ': 'o', 'ɞ': '@',
    'i': 'i', 'ɪ': 'i', 'ɨ': 'i', 'y': 'u', 'ʏ': 'u', 'ɿ': 'i',
    'o': 'o', 'ɔ': 'o', 'u': 'u', 'ʊ': 'u', 'ɯ': 'u', 'ʉ': 'u',
    'p': 'p', 'b': 'b', 't': 't', 'd': 'd', 'k': 'k', 'g': 'g', 'ɡ': 'g', 'q': 'k', 'ɢ': 'g', 'c': 'k', 'ɟ': 'J', 'ʈ': 't', 'ɖ': 'd',
    'm': 'm', 'n': 'n', 'ɲ': 'ny', 'ŋ': 'n', 'ɴ': 'n', 'ɱ': 'm', 'ɳ': 'n',
    'l': 'l', 'ɫ': 'l', 'ʎ': 'ly', 'ɭ': 'l', 'ɬ': 'l',
    'r': 'r', 'ɾ': 'r', 'ʁ': 'r', 'ʀ': 'r', 'ɹ': 'r', 'ɻ': 'r', 'ɽ': 'r', 'ʋ': 'v',
    's': 's', 'z': 'z', 'ʃ': 'S', 'ʒ': 'Z', 'ʂ': 'S', 'ʐ': 'Z', 'ɕ': 'S', 'ʑ': 'Z',
    'f': 'f', 'v': 'v', 'θ': 'T', 'ð': 'd', 'h': 'h', 'ɦ': 'h', 'x': 'h', 'χ': 'h', 'ç': 'h', 'ħ': 'h', 'ʝ': 'y', 'ɣ': 'g', 'β': 'b', 'ɸ': 'f',
    'j': 'y', 'w': 'w', 'ʍ': 'w', 'ɥ': 'w', 'ʔ': ''
  };
  function ipaToPhon(ipa) {
    /* ç would decompose to c + cedilla under NFD, so swap it first. */
    var s = ipa.replace(/\u00e7/g, '\u0127').normalize('NFD').replace(/[\u0361\u035c]/g, ''); /* tie bars */
    var out = '', unknown = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s[i], n = s[i + 1];
      if (c === '̃') { /* nasal tilde on the previous vowel */
        if (out && isV(out[out.length - 1])) out += 'n';
        continue;
      }
      if (c === 't' && (n === 'ʃ' || n === 'ɕ' || n === 'ʂ')) { out += 'C'; i++; continue; }
      if (c === 'd' && (n === 'ʒ' || n === 'ʑ' || n === 'ʐ')) { out += 'J'; i++; continue; }
      if (c === 'e' && n === 'ɪ' && s[i + 2] === '̯') { out += 'ei'; i += 2; continue; }
      if (c === '\u0329' || c === '\u030d') { /* syllabic consonant: insert a schwa before it */
        if (out && !isV(out[out.length - 1])) out = out.slice(0, -1) + "@" + out[out.length - 1];
        continue;
      }
      var code = c.charCodeAt(0);
      if (code >= 0x300 && code <= 0x36f) continue; /* other diacritics */
      if (IPA_MAP[c] !== undefined) { out += IPA_MAP[c]; continue; }
      if ('ˈˌːˑ.‍  -()[]/ʰʲʷˠˤ˞ⁿ‿|‖'.indexOf(c) >= 0) continue;
      if (/[A-Za-z]/.test(c)) { out += c.toLowerCase(); continue; }
      unknown++;
    }
    return { phon: dedupe(out), unknown: unknown };
  }

  /* ----------------------------------------------------------------------
   * CMU ARPAbet -> coarse phonemes (English).
   * -------------------------------------------------------------------- */
  var ARPA = {
    AA: 'a', AE: 'a', AH: 'a', AO: 'o', AW: 'au', AY: 'ai', EH: 'e', ER: '@r', EY: 'ei',
    IH: 'i', IY: 'i', OW: 'o', OY: 'oi', UH: 'u', UW: 'u',
    B: 'b', CH: 'C', D: 'd', DH: 'd', F: 'f', G: 'g', HH: 'h', JH: 'J', K: 'k', L: 'l', M: 'm',
    N: 'n', NG: 'n', P: 'p', R: 'r', S: 's', SH: 'S', T: 't', TH: 'T', V: 'v', W: 'w', Y: 'y', Z: 'z', ZH: 'Z'
  };
  function arpaToPhon(tokens) {
    var out = '';
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i], stress = t.slice(-1), base = t.replace(/[0-9]/g, '');
      if (base === 'AH' && stress === '0') { out += '@'; continue; }
      if (base === 'IH' && stress === '0' && i === tokens.length - 1 && false) { out += '@'; continue; }
      out += ARPA[base] || '';
    }
    return dedupe(out);
  }

  /* Rule-based transcription for any language code. */
  function g2p(lang, word) {
    switch (lang) {
      case 'es': return g2pEs(word);
      case 'it': return g2pIt(word);
      case 'de': return g2pDe(word);
      case 'fr': return g2pFr(word);
      case 'ja': return isKana(word) ? kanaToPhon(word) : romajiToPhon(word);
      default: return g2pEnRules(word);
    }
  }

  /* ----------------------------------------------------------------------
   * Sound distance: weighted edit distance with feature-based costs.
   * -------------------------------------------------------------------- */
  var FEAT = { /* place, manner, voice */
    p: ['lab', 'stop', 0], b: ['lab', 'stop', 1], t: ['alv', 'stop', 0], d: ['alv', 'stop', 1],
    k: ['vel', 'stop', 0], g: ['vel', 'stop', 1], m: ['lab', 'nas', 1], n: ['alv', 'nas', 1],
    l: ['alv', 'liq', 1], r: ['alv', 'liq', 1], s: ['alv', 'fric', 0], z: ['alv', 'fric', 1],
    S: ['pal', 'fric', 0], Z: ['pal', 'fric', 1], C: ['pal', 'aff', 0], J: ['pal', 'aff', 1],
    f: ['lab', 'fric', 0], v: ['lab', 'fric', 1], h: ['glot', 'fric', 0], T: ['alv', 'fric', 0],
    w: ['lab', 'glide', 1], y: ['pal', 'glide', 1]
  };
  var VPOS = { a: [0, 0], e: [1, 1], i: [2, 2], o: [1, -1], u: [2, -2], '@': [1, 0] };
  var subCache = {};
  function subCost(x, y) {
    if (x === y) return 0;
    var key = x < y ? x + y : y + x;
    if (subCache[key] !== undefined) return subCache[key];
    var c;
    var vx = isV(x), vy = isV(y);
    if (vx && vy) {
      var dx = VPOS[x][0] - VPOS[y][0], dy = VPOS[x][1] - VPOS[y][1];
      c = 0.25 + 0.16 * Math.sqrt(dx * dx + dy * dy);
      if (x === '@' || y === '@') c = 0.3;
    } else if (!vx && !vy) {
      var fx = FEAT[x], fy = FEAT[y];
      if (!fx || !fy) c = 1;
      else {
        c = 0.3;
        if (fx[0] !== fy[0]) c += 0.25;
        if (fx[1] !== fy[1]) c += (fx[1] === 'aff' && fy[1] === 'fric') || (fx[1] === 'fric' && fy[1] === 'aff') ? 0.12 : 0.3;
        if (fx[2] !== fy[2]) c += 0.15;
        /* pairs that ears merge: l/r, s/T, S/C, b/v, f/h, y/J */
        var pair = key;
        if (pair === 'lr') c = 0.4;
        if (pair === 'Ts') c = 0.4;
        if (pair === 'CS') c = 0.35;
        if (pair === 'bv') c = 0.4;
        if (pair === 'Jy') c = 0.55;
        if (pair === 'JZ') c = 0.35;
        if (pair === 'hw' || pair === 'fh') c = 0.7;
        if (c > 1) c = 1;
      }
    } else {
      /* vowel vs consonant: glides are half vowels */
      var g = vx ? y : x, v = vx ? x : y;
      if ((g === 'w' && (v === 'u' || v === 'o')) || (g === 'y' && (v === 'i' || v === 'e'))) c = 0.45;
      else c = 1.1;
    }
    subCache[key] = c;
    return c;
  }
  function indelCost(x) {
    if (x === '@') return 0.35;
    if (isV(x)) return 0.6;
    if (x === 'h') return 0.55;
    return 0.85;
  }
  var row0 = new Float64Array(64), row1 = new Float64Array(64);
  /* Weighted Levenshtein. `limit` allows an early exit (returns > limit). */
  function soundDistance(a, b, limit) {
    var la = a.length, lb = b.length;
    if (la === 0 || lb === 0) { var s = 0, k; for (k = 0; k < la; k++) s += indelCost(a[k]); for (k = 0; k < lb; k++) s += indelCost(b[k]); return s; }
    var prev = row0, cur = row1, i, j;
    prev[0] = 0;
    for (j = 1; j <= lb; j++) prev[j] = prev[j - 1] + indelCost(b[j - 1]);
    for (i = 1; i <= la; i++) {
      cur[0] = prev[0] + indelCost(a[i - 1]);
      var best = cur[0];
      for (j = 1; j <= lb; j++) {
        var v = prev[j - 1] + subCost(a[i - 1], b[j - 1]);
        var del = prev[j] + indelCost(a[i - 1]);
        var ins = cur[j - 1] + indelCost(b[j - 1]);
        if (del < v) v = del;
        if (ins < v) v = ins;
        cur[j] = v;
        if (v < best) best = v;
      }
      if (limit !== undefined && best > limit) return best;
      var t = prev; prev = cur; cur = t;
    }
    return prev[lb];
  }
  /* Distance scaled by average length, so that a 2-phoneme match is not
   * automatically "closer" than a 6-phoneme one. */
  function soundDistanceNorm(a, b) {
    var d = soundDistance(a, b);
    return d / Math.max(1.5, (a.length + b.length) / 2);
  }

  return {
    VOWELS: VOWELS, isVowel: isV, toIPA: toIPA,
    g2p: g2p, g2pEs: g2pEs, g2pIt: g2pIt, g2pDe: g2pDe, g2pFr: g2pFr, g2pEnRules: g2pEnRules,
    kanaToRomaji: kanaToRomaji, kanaToPhon: kanaToPhon, romajiToPhon: romajiToPhon, isKana: isKana, hasJapanese: hasJapanese, kataToHira: kataToHira,
    ipaToPhon: ipaToPhon, arpaToPhon: arpaToPhon,
    subCost: subCost, indelCost: indelCost, soundDistance: soundDistance, soundDistanceNorm: soundDistanceNorm
  };
});
