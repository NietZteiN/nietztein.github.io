/* haiku_data.js
 *
 * Word banks, templates and the generator for the multilingual haiku clock.
 * The file is shared by index.html (browser) and test.js (node). It has no
 * dependencies and does no I/O.
 *
 * Every bank entry has the same shape:
 *   t  display text                (kanji for Japanese)
 *   r  reading in kana             (Japanese only)
 *   n  precomputed count           (morae for ja, syllables for en/de, words for vi)
 *   g  English gloss; fills that come after a word use "{w}" for the word gloss
 *   p  true for phrase-shaped kigo (e.g. 秋の空) that must not take a "の..." extension
 *   any  true for fills that may follow any word, phrase or noun
 *   whole  fill allowed only in a line that holds the complete time expression
 *   nf   fill that must not end the poem (の, に ...)
 *
 * A template is three lines. Each line is a list of items:
 *   'HOUR' 'MIN' 'HALF' 'TOH' 'REM' 'TIME' 'PERIOD'  time chunks supplied by the time form
 *   'KIGO'                                            the seasonal word
 *   'P5' 'P7'                                         a whole line from the phrase bank
 *   '~X'                                              a fill chosen from bank X so the line sums exactly
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HAIKU = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------ counters

  // Small kana that merge with the previous kana (they add no mora).
  const SMALL_MERGE = 'ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ';

  // Mora count of a kana string. Rules: small ya/yu/yo (and small vowels) merge
  // with the previous kana, small tsu counts one, the long vowel mark counts
  // one, n counts one. Anything that is not kana (spaces, punctuation) is ignored.
  function moraCount(kana) {
    let n = 0;
    for (const ch of kana) {
      const code = ch.codePointAt(0);
      const isKana = (code >= 0x3041 && code <= 0x3096) || (code >= 0x30a1 && code <= 0x30fa);
      if (ch === 'ー') { n += 1; continue; }
      if (!isKana) continue;
      if (SMALL_MERGE.indexOf(ch) >= 0) continue;
      n += 1; // includes っ and ん
    }
    return n;
  }

  // Vietnamese is written one syllable per word, so a word count is exact.
  function wordCount(s) {
    return s.trim().split(/\s+/).filter(Boolean).length;
  }

  // ------------------------------------------------------------------ romaji

  const ROMAJI = {
    あ:'a',い:'i',う:'u',え:'e',お:'o',か:'ka',き:'ki',く:'ku',け:'ke',こ:'ko',さ:'sa',し:'shi',す:'su',せ:'se',そ:'so',
    た:'ta',ち:'chi',つ:'tsu',て:'te',と:'to',な:'na',に:'ni',ぬ:'nu',ね:'ne',の:'no',は:'ha',ひ:'hi',ふ:'fu',へ:'he',ほ:'ho',
    ま:'ma',み:'mi',む:'mu',め:'me',も:'mo',や:'ya',ゆ:'yu',よ:'yo',ら:'ra',り:'ri',る:'ru',れ:'re',ろ:'ro',わ:'wa',を:'o',ん:'n',
    が:'ga',ぎ:'gi',ぐ:'gu',げ:'ge',ご:'go',ざ:'za',じ:'ji',ず:'zu',ぜ:'ze',ぞ:'zo',だ:'da',ぢ:'ji',づ:'zu',で:'de',ど:'do',
    ば:'ba',び:'bi',ぶ:'bu',べ:'be',ぼ:'bo',ぱ:'pa',ぴ:'pi',ぷ:'pu',ぺ:'pe',ぽ:'po',
    きゃ:'kya',きゅ:'kyu',きょ:'kyo',しゃ:'sha',しゅ:'shu',しょ:'sho',ちゃ:'cha',ちゅ:'chu',ちょ:'cho',にゃ:'nya',にゅ:'nyu',にょ:'nyo',
    ひゃ:'hya',ひゅ:'hyu',ひょ:'hyo',みゃ:'mya',みゅ:'myu',みょ:'myo',りゃ:'rya',りゅ:'ryu',りょ:'ryo',
    ぎゃ:'gya',ぎゅ:'gyu',ぎょ:'gyo',じゃ:'ja',じゅ:'ju',じょ:'jo',びゃ:'bya',びゅ:'byu',びょ:'byo',ぴゃ:'pya',ぴゅ:'pyu',ぴょ:'pyo'
  };
  const MACRON = { a:'ā', i:'ī', u:'ū', e:'ē', o:'ō' };

  // Hepburn romaji for a hiragana string (katakana is folded to hiragana first).
  function toRomaji(kana) {
    const s = kana.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
    let out = '';
    let pendingTsu = false;
    for (let i = 0; i < s.length; i++) {
      const two = s.slice(i, i + 2);
      let syl = null;
      if (ROMAJI[two]) { syl = ROMAJI[two]; i += 1; }
      else if (s[i] === 'っ') { pendingTsu = true; continue; }
      else if (s[i] === 'ー') { out = lengthen(out); continue; }
      else if (ROMAJI[s[i]]) syl = ROMAJI[s[i]];
      else { out += s[i]; continue; }
      // う after an o- or u- vowel lengthens it (とう -> tō, くう -> kū)
      if (syl === 'u' && /[ou]$/.test(out)) { out = lengthen(out); continue; }
      if (pendingTsu) { out += syl[0]; pendingTsu = false; }
      // n before a vowel or y needs an apostrophe (しんや -> shin'ya)
      if (/n$/.test(out) && /^[aiueoy]/.test(syl)) out += "'";
      out += syl;
    }
    return out;
  }
  function lengthen(out) {
    const last = out.slice(-1);
    return MACRON[last] ? out.slice(0, -1) + MACRON[last] : out + last;
  }

  // ------------------------------------------------------------------ helpers

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  function shuffled(rng, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // Entry constructors. J = Japanese (kanji, kana, morae, gloss), W = other languages.
  const J = (t, r, n, g, extra) => Object.assign({ t, r, n, g }, extra || {});
  const W = (t, n, g, extra) => Object.assign({ t, n, g: g === undefined ? t : g }, extra || {});
  const NUM_EN = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const TENS_EN = { 20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty' };
  function numEn(n) {
    if (n < 20) return NUM_EN[n];
    const t = TENS_EN[n - n % 10];
    return n % 10 ? t + '-' + NUM_EN[n % 10] : t;
  }

  // ------------------------------------------------------------------ Japanese

  const JA_HOURS = [null,
    J('一時', 'いちじ', 3), J('二時', 'にじ', 2), J('三時', 'さんじ', 3), J('四時', 'よじ', 2), J('五時', 'ごじ', 2), J('六時', 'ろくじ', 3),
    J('七時', 'しちじ', 3), J('八時', 'はちじ', 3), J('九時', 'くじ', 2), J('十時', 'じゅうじ', 3), J('十一時', 'じゅういちじ', 5), J('十二時', 'じゅうにじ', 4)];
  const JA_MIN_UNIT = { 1: J('一分', 'いっぷん', 4), 2: J('二分', 'にふん', 3), 3: J('三分', 'さんぷん', 4), 4: J('四分', 'よんぷん', 4), 5: J('五分', 'ごふん', 3),
    6: J('六分', 'ろっぷん', 4), 7: J('七分', 'ななふん', 4), 8: J('八分', 'はっぷん', 4), 9: J('九分', 'きゅうふん', 4) };
  const JA_TENS = { 10: J('十', 'じゅう', 2), 20: J('二十', 'にじゅう', 3), 30: J('三十', 'さんじゅう', 4), 40: J('四十', 'よんじゅう', 4), 50: J('五十', 'ごじゅう', 3) };
  const JA_EXACT_TENS = { 10: J('十分', 'じゅっぷん', 4), 20: J('二十分', 'にじゅっぷん', 5), 30: J('三十分', 'さんじゅっぷん', 6), 40: J('四十分', 'よんじゅっぷん', 6), 50: J('五十分', 'ごじゅっぷん', 5) };

  function jaMinuteWord(m) {
    let e;
    if (m % 10 === 0) e = JA_EXACT_TENS[m];
    else if (m < 10) e = JA_MIN_UNIT[m];
    else {
      const t = JA_TENS[m - m % 10], u = JA_MIN_UNIT[m % 10];
      e = J(t.t + u.t, t.r + u.r, t.n + u.n);
    }
    return J(e.t, e.r, e.n, numEn(m) + ' minutes');
  }

  // Period-of-day words with the connecting の already attached. hours = which hours (24h) they fit.
  const JA_PERIODS = [
    J('朝の', 'あさの', 3, 'in the morning', { hours: [5, 6, 7, 8, 9, 10] }),
    J('昼の', 'ひるの', 3, 'at midday', { hours: [11, 12, 13] }),
    J('午後の', 'ごごの', 3, 'in the afternoon', { hours: [13, 14, 15, 16, 17] }),
    J('宵の', 'よいの', 3, 'in the early evening', { hours: [18, 19, 20] }),
    J('夜の', 'よるの', 3, 'at night', { hours: [20, 21, 22, 23] }),
    J('夜更けの', 'よふけの', 4, 'late at night', { hours: [23, 0, 1] }),
    J('真夜中の', 'まよなかの', 5, 'in the dead of night', { hours: [0, 1, 2] }),
    J('暁の', 'あかつきの', 5, 'at dawn', { hours: [4, 5] }),
    J('明け方の', 'あけがたの', 5, 'toward daybreak', { hours: [5, 6] })
  ];

  // Fills after a time word. "{w}" stands for the time expression.
  const JA_T = [
    J('や', 'や', 1, '{w}...'), J('に', 'に', 1, 'at {w},', { nf: true }), J('の', 'の', 1, '{w}, and', { nf: true }), J('は', 'は', 1, '{w}:', { nf: true }), J('よ', 'よ', 1, '{w}!'),
    J('かな', 'かな', 2, 'ah, {w}'), J('なり', 'なり', 2, 'it is {w}'), J('にて', 'にて', 2, 'at {w}', { nf: true }), J('過ぎ', 'すぎ', 2, 'just past {w}', { whole: true }),
    J('にして', 'にして', 3, 'being {w},', { nf: true }), J('なれば', 'なれば', 3, 'since it is {w},', { nf: true }), J('となる', 'となる', 3, 'it becomes {w}'),
    J('の針', 'のはり', 3, 'the hand at {w}'), J('の鐘', 'のかね', 3, 'the bell of {w}'), J('の窓', 'のまど', 3, 'the window at {w}', { whole: true }),
    J('の空', 'のそら', 3, 'the sky at {w}', { whole: true }), J('の街', 'のまち', 3, 'the town at {w}', { whole: true }), J('の影', 'のかげ', 3, 'shadows at {w}', { whole: true }), J('の部屋', 'のへや', 3, 'the room at {w}', { whole: true }),
    J('なりけり', 'なりけり', 4, 'so it is {w}'), J('を過ぎて', 'をすぎて', 4, 'just past {w}', { whole: true, nf: true }), J('を指して', 'をさして', 4, 'pointing at {w}', { whole: true, nf: true }),
    J('を告げて', 'をつげて', 4, 'telling {w}', { whole: true, nf: true }), J('の光', 'のひかり', 4, 'the light at {w}', { whole: true }), J('の時計', 'のとけい', 4, 'the clock at {w}', { whole: true }),
    J('の窓辺', 'のまどべ', 4, 'the windowsill at {w}', { whole: true }), J('の茶碗', 'のちゃわん', 4, 'a teacup at {w}', { whole: true }), J('の静寂', 'のしじま', 4, 'the hush of {w}', { whole: true }),
    J('の鐘の音', 'のかねのね', 5, 'the bell sound at {w}', { whole: true }), J('の窓の灯', 'のまどのひ', 5, 'the window lamp at {w}', { whole: true }), J('を指す針', 'をさすはり', 5, 'the hand pointing at {w}', { whole: true }),
    J('の茶の湯気', 'のちゃのゆげ', 5, 'tea steam at {w}', { whole: true }), J('の灯ひとつ', 'のひひとつ', 5, 'a single lamp at {w}', { whole: true }), J('なりにけり', 'なりにけり', 5, 'it has become {w}')
  ];

  // Fills after a kigo. Entries without "any" need a plain noun before them.
  const JA_K = [
    J('や', 'や', 1, '{w}...', { any: true }), J('の', 'の', 1, '{w}, and', { any: true, nf: true }), J('に', 'に', 1, 'in the {w},', { any: true, nf: true }), J('よ', 'よ', 1, '{w}!', { any: true }),
    J('かな', 'かな', 2, 'ah, {w}', { any: true }), J('なり', 'なり', 2, 'it is {w}', { any: true }), J('にて', 'にて', 2, 'amid {w}', { any: true, nf: true }),
    J('にも', 'にも', 2, 'even in {w}', { any: true, nf: true }), J('より', 'より', 2, 'from the {w}', { any: true, nf: true }), J('の日', 'のひ', 2, 'a day of {w}'), J('の夜', 'のよ', 2, 'a night of {w}'),
    J('の空', 'のそら', 3, 'the sky of {w}'), J('の朝', 'のあさ', 3, 'a morning of {w}'), J('の窓', 'のまど', 3, 'a window of {w}'), J('の道', 'のみち', 3, 'a road of {w}'),
    J('の街', 'のまち', 3, 'a town of {w}'), J('の中', 'のなか', 3, 'amid the {w}'), J('の音', 'のおと', 3, 'the sound of {w}'), J('のころ', 'のころ', 3, 'the time of {w}'),
    J('の光', 'のひかり', 4, 'the light of {w}'), J('の窓辺', 'のまどべ', 4, 'the windowsill of {w}'), J('の匂い', 'のにおい', 4, 'the scent of {w}'),
    J('の夕べ', 'のゆうべ', 4, 'an evening of {w}'), J('のごとく', 'のごとく', 4, 'like the {w}'), J('のあとに', 'のあとに', 4, 'after the {w}'),
    J('の中に', 'のなかに', 4, 'in the midst of {w}'), J('の向こう', 'のむこう', 4, 'beyond the {w}'), J('の名残', 'のなごり', 4, 'traces of {w}'),
    J('のかなた', 'のかなた', 4, 'far beyond the {w}'), J('ふたたび', 'ふたたび', 4, '{w} once more', { any: true }),
    J('の匂いに', 'のにおいに', 5, 'in the scent of {w}'), J('の光に', 'のひかりに', 5, 'in the light of {w}'), J('の窓辺に', 'のまどべに', 5, 'at the windowsill of {w}'),
    J('の夕べに', 'のゆうべに', 5, 'on an evening of {w}'), J('の向こうに', 'のむこうに', 5, 'beyond the {w}'), J('のかなたに', 'のかなたに', 5, 'far beyond the {w}'),
    J('の名残に', 'のなごりに', 5, 'in traces of {w}'), J('の街の灯', 'のまちのひ', 5, 'town lamps of {w}'), J('ふたたびの', 'ふたたびの', 5, '{w}, once again,', { any: true, nf: true }),
    J('のごとくに', 'のごとくに', 5, 'just like the {w}')
  ];

  const JA_P5 = [
    J('目覚めれば', 'めざめれば', 5, 'waking up,'), J('窓を開け', 'まどをあけ', 5, 'I open the window'), J('茶を淹れて', 'ちゃをいれて', 5, 'brewing tea'),
    J('針は指す', 'はりはさす', 5, 'the hand points on'), J('時計見る', 'とけいみる', 5, 'I look at the clock'), J('音もなく', 'おともなく', 5, 'without a sound'),
    J('灯をともす', 'ひをともす', 5, 'I light a lamp'), J('静かなる', 'しずかなる', 5, 'all is quiet'), J('遠くから', 'とおくから', 5, 'from far away'),
    J('ふと気づく', 'ふときづく', 5, 'I suddenly notice'), J('目を上げて', 'めをあげて', 5, 'raising my eyes'), J('手を止めて', 'てをとめて', 5, 'pausing my hands'),
    J('ひとり居て', 'ひとりいて', 5, 'sitting alone'), J('息をつく', 'いきをつく', 5, 'I draw a breath'), J('針の音', 'はりのおと', 5, 'the ticking hand'),
    J('本を閉じ', 'ほんをとじ', 5, 'closing the book'), J('鐘が鳴る', 'かねがなる', 5, 'a bell rings'), J('影長し', 'かげながし', 5, 'shadows grow long')
  ];
  const JA_P7 = [
    J('時を告げつつ', 'ときをつげつつ', 7, 'telling the hour'), J('影を引く針', 'かげをひくはり', 7, 'the hand trailing its shadow'),
    J('湯気立つ茶碗', 'ゆげたつちゃわん', 7, 'a steaming teacup'), J('窓辺にひとり', 'まどべにひとり', 7, 'alone at the window'),
    J('ページをめくり', 'ぺーじをめくり', 7, 'turning a page'), J('鐘の音ひとつ', 'かねのねひとつ', 7, 'a single bell'),
    J('灯をともしつつ', 'ひをともしつつ', 7, 'lighting the lamp'), J('静けさのなか', 'しずけさのなか', 7, 'in the stillness'),
    J('目覚めてすぐに', 'めざめてすぐに', 7, 'just after waking'), J('眠れぬままに', 'ねむれぬままに', 7, 'still unable to sleep'),
    J('茶を淹れなおし', 'ちゃをいれなおし', 7, 'brewing tea again'), J('机に向かい', 'つくえにむかい', 7, 'facing the desk'),
    J('針は進みて', 'はりはすすみて', 7, 'the hand moves on'), J('誰も言わずに', 'だれもいわずに', 7, 'no one says a word'),
    J('影のうつろい', 'かげのうつろい', 7, 'the shifting of shadows'), J('街静まりて', 'まちしずまりて', 7, 'the town falls silent')
  ];

  // Kigo per month (index 0 = January). Real saijiki words; p marks phrase-shaped ones.
  const JA_KIGO = [
    [J('初雪', 'はつゆき', 4, 'first snow'), J('初日', 'はつひ', 3, 'the first sunrise'), J('初夢', 'はつゆめ', 4, 'the first dream of the year'), J('寒月', 'かんげつ', 4, 'the cold moon'),
      J('霜柱', 'しもばしら', 5, 'frost columns'), J('雑煮', 'ぞうに', 3, 'New Year soup'), J('門松', 'かどまつ', 4, 'the gate pines'), J('寒椿', 'かんつばき', 5, 'winter camellia'),
      J('水仙', 'すいせん', 4, 'narcissus'), J('冬の朝', 'ふゆのあさ', 5, 'a winter morning', { p: true })],
    [J('梅', 'うめ', 2, 'plum blossom'), J('節分', 'せつぶん', 4, 'the bean-throwing day'), J('残雪', 'ざんせつ', 4, 'lingering snow'), J('春の雪', 'はるのゆき', 5, 'spring snow', { p: true }),
      J('鶯', 'うぐいす', 4, 'the bush warbler'), J('立春', 'りっしゅん', 4, 'the first day of spring'), J('薄氷', 'うすらい', 4, 'thin ice'), J('猫柳', 'ねこやなぎ', 5, 'pussy willow'),
      J('余寒', 'よかん', 3, 'the lingering cold')],
    [J('雛祭', 'ひなまつり', 5, 'the doll festival'), J('春風', 'はるかぜ', 4, 'spring wind'), J('菜の花', 'なのはな', 4, 'rapeseed flowers'), J('春の月', 'はるのつき', 5, 'the spring moon', { p: true }),
      J('蕗の薹', 'ふきのとう', 5, 'butterbur sprouts'), J('雪解', 'ゆきどけ', 4, 'snowmelt'), J('雲雀', 'ひばり', 3, 'a skylark'), J('彼岸', 'ひがん', 3, 'equinox week'),
      J('土筆', 'つくし', 3, 'horsetail shoots'), J('東風', 'こち', 2, 'the east wind')],
    [J('桜', 'さくら', 3, 'cherry blossom'), J('花冷え', 'はなびえ', 4, 'blossom chill'), J('春の雨', 'はるのあめ', 5, 'spring rain', { p: true }), J('蝶', 'ちょう', 2, 'a butterfly'),
      J('花吹雪', 'はなふぶき', 5, 'a blizzard of petals'), J('燕', 'つばめ', 3, 'swallows'), J('朧月', 'おぼろづき', 5, 'the hazy moon'), J('春眠', 'しゅんみん', 4, 'spring sleep'),
      J('山吹', 'やまぶき', 4, 'kerria blossom'), J('花の雲', 'はなのくも', 5, 'a cloud of blossom', { p: true })],
    [J('新緑', 'しんりょく', 4, 'fresh green'), J('薫風', 'くんぷう', 4, 'the fragrant breeze'), J('藤', 'ふじ', 2, 'wisteria'), J('鯉のぼり', 'こいのぼり', 5, 'carp streamers'),
      J('若葉', 'わかば', 3, 'young leaves'), J('牡丹', 'ぼたん', 3, 'the peony'), J('立夏', 'りっか', 3, 'the first day of summer'), J('卯の花', 'うのはな', 4, 'deutzia flowers'),
      J('麦秋', 'ばくしゅう', 4, 'the wheat harvest')],
    [J('梅雨', 'つゆ', 2, 'the rainy season'), J('紫陽花', 'あじさい', 4, 'hydrangea'), J('蛍', 'ほたる', 3, 'fireflies'), J('青葉', 'あおば', 3, 'green leaves'),
      J('五月雨', 'さみだれ', 4, 'early summer rain'), J('蝸牛', 'かたつむり', 5, 'a snail'), J('夏至', 'げし', 2, 'the summer solstice'), J('花菖蒲', 'はなしょうぶ', 5, 'irises'),
      J('田植', 'たうえ', 3, 'rice planting'), J('短夜', 'みじかよ', 4, 'the short night')],
    [J('蝉時雨', 'せみしぐれ', 5, 'the cicada chorus'), J('七夕', 'たなばた', 4, 'the star festival'), J('夕立', 'ゆうだち', 4, 'an evening shower'), J('朝顔', 'あさがお', 4, 'morning glory'),
      J('風鈴', 'ふうりん', 4, 'a wind chime'), J('夏の月', 'なつのつき', 5, 'the summer moon', { p: true }), J('入道雲', 'にゅうどうぐも', 6, 'thunderheads'),
      J('打ち水', 'うちみず', 4, 'water sprinkled on the street'), J('蓮', 'はす', 2, 'the lotus'), J('涼風', 'すずかぜ', 4, 'a cool breeze')],
    [J('残暑', 'ざんしょ', 3, 'lingering heat'), J('花火', 'はなび', 3, 'fireworks'), J('盆', 'ぼん', 2, 'the Bon festival'), J('送り火', 'おくりび', 4, 'the send-off fires'),
      J('星月夜', 'ほしづきよ', 5, 'a starlit night'), J('流れ星', 'ながれぼし', 5, 'a shooting star'), J('蜩', 'ひぐらし', 4, 'the evening cicada'), J('西瓜', 'すいか', 3, 'watermelon'),
      J('天の川', 'あまのがわ', 5, 'the Milky Way'), J('秋の声', 'あきのこえ', 5, 'the voice of autumn', { p: true })],
    [J('名月', 'めいげつ', 4, 'the harvest moon'), J('月見', 'つきみ', 3, 'moon viewing'), J('秋風', 'あきかぜ', 4, 'autumn wind'), J('虫の声', 'むしのこえ', 5, 'insect voices', { p: true }),
      J('秋の空', 'あきのそら', 5, 'the autumn sky', { p: true }), J('台風', 'たいふう', 4, 'a typhoon'), J('萩', 'はぎ', 2, 'bush clover'), J('稲妻', 'いなずま', 4, 'lightning'),
      J('鈴虫', 'すずむし', 4, 'bell crickets'), J('曼珠沙華', 'まんじゅしゃげ', 5, 'red spider lilies')],
    [J('紅葉', 'もみじ', 3, 'autumn leaves'), J('秋の暮', 'あきのくれ', 5, 'autumn dusk', { p: true }), J('柿', 'かき', 2, 'persimmons'), J('鰯雲', 'いわしぐも', 5, 'a mackerel sky'),
      J('野分', 'のわき', 3, 'the autumn gale'), J('栗', 'くり', 2, 'chestnuts'), J('秋の雨', 'あきのあめ', 5, 'autumn rain', { p: true }), J('菊', 'きく', 2, 'chrysanthemums'),
      J('秋刀魚', 'さんま', 3, 'grilled saury'), J('夜長', 'よなが', 3, 'the long night')],
    [J('木枯らし', 'こがらし', 4, 'the withering wind'), J('時雨', 'しぐれ', 3, 'a passing winter shower'), J('落葉', 'おちば', 3, 'fallen leaves'), J('初霜', 'はつしも', 4, 'first frost'),
      J('小春日', 'こはるび', 4, 'a mild late-autumn day'), J('立冬', 'りっとう', 4, 'the first day of winter'), J('枯野', 'かれの', 3, 'the withered field'),
      J('大根', 'だいこん', 4, 'daikon radish'), J('山茶花', 'さざんか', 4, 'sasanqua'), J('冬隣', 'ふゆどなり', 5, 'winter next door')],
    [J('雪', 'ゆき', 2, 'snow'), J('冬の月', 'ふゆのつき', 5, 'the winter moon', { p: true }), J('師走', 'しわす', 3, 'the year-end month'), J('炬燵', 'こたつ', 3, 'the kotatsu'),
      J('大晦日', 'おおみそか', 5, "New Year's Eve"), J('冬ざれ', 'ふゆざれ', 4, 'winter desolation'), J('北風', 'きたかぜ', 4, 'the north wind'), J('湯豆腐', 'ゆどうふ', 4, 'hot tofu'),
      J('冬至', 'とうじ', 3, 'the winter solstice'), J('年の暮', 'としのくれ', 5, "the year's end", { p: true })]
  ];

  // Time forms: each gives the chunks it supplies and an English gloss of the whole expression.
  function jaForms(h, m) {
    const h12 = h % 12 || 12, n12 = (h + 1) % 12 || 12;
    const hour = J(JA_HOURS[h12].t, JA_HOURS[h12].r, JA_HOURS[h12].n, numEn(h12) + " o'clock");
    const forms = [];
    if (m === 0) {
      forms.push({ chunks: { HOUR: hour }, g: hour.g });
      forms.push({ chunks: { HOUR: hour, MIN: J('ちょうど', 'ちょうど', 3, 'sharp', { attach: true }) }, g: hour.g + ' sharp' });
    } else {
      const min = jaMinuteWord(m);
      forms.push({ chunks: { HOUR: hour, MIN: min }, g: m <= 30 ? numEn(m) + ' past ' + numEn(h12) : numEn(h12) + ' ' + numEn(m) });
      if (m === 30) forms.push({ chunks: { HALF: J(hour.t + '半', hour.r + 'はん', hour.n + 2, 'half past ' + numEn(h12)) }, g: 'half past ' + numEn(h12) });
      if (m > 30) {
        const nh = JA_HOURS[n12];
        forms.push({ chunks: { TOH: J(nh.t + 'まで', nh.r + 'まで', nh.n + 2, 'until ' + numEn(n12)), REM: jaMinuteWord(60 - m) }, g: numEn(60 - m) + ' to ' + numEn(n12) });
      }
      // 三十一分 and 四十一分 are 8 morae, too long for any line. Two more spellings keep 5-7-5:
      // "十時半 / 一分後" (half past ten, one minute on) for 31 to 49, and, only when the hour
      // itself fills a whole line (十一時), the older reading しじゅう for 四十 (as in 四十九日 shijūkunichi).
      if (m > 30 && m < 50) {
        const after = jaMinuteWord(m - 30);
        forms.push({ chunks: { HALF: J(hour.t + '半', hour.r + 'はん', hour.n + 2, 'half past ' + numEn(h12)), AFTER: J(after.t + '後', after.r + 'ご', after.n + 1, numEn(m - 30) + ' minutes on') },
          g: numEn(h12) + ' ' + numEn(m) });
      }
      if (m > 40 && m < 50 && hour.n === 5) {
        const u = JA_MIN_UNIT[m - 40];
        forms.push({ chunks: { HOUR: hour, MIN: J('四十' + u.t, 'しじゅう' + u.r, 3 + u.n, numEn(m) + ' minutes') }, g: numEn(h12) + ' ' + numEn(m) });
      }
    }
    return forms;
  }

  // Templates. 'PERIOD' variants (朝の三時...) are generated automatically in front of HOUR/HALF.
  const JA_TEMPLATES = [
    [['HOUR', '~T'], ['MIN', '~T'], ['KIGO', '~K']],
    [['KIGO', '~K'], ['HOUR', 'MIN', '~T'], ['P5']],
    [['P5'], ['HOUR', 'MIN', '~T'], ['KIGO', '~K']],
    [['KIGO', '~K'], ['HOUR', '~T'], ['MIN', '~T']],
    [['HOUR', 'MIN', '~T'], ['P7'], ['KIGO', '~K']],
    [['KIGO', '~K'], ['P7'], ['HOUR', 'MIN', '~T']],
    [['KIGO', '~K'], ['HALF', '~T'], ['P5']],
    [['P5'], ['HALF', '~T'], ['KIGO', '~K']],
    [['HALF', '~T'], ['P7'], ['KIGO', '~K']],
    [['HALF', '~T'], ['KIGO', '~K'], ['P5']],
    [['TOH', '~T'], ['REM', '~T'], ['KIGO', '~K']],
    [['KIGO', '~K'], ['HALF', '~T'], ['AFTER', '~T']],
    [['HALF', '~T'], ['AFTER', '~T'], ['KIGO', '~K']],
    [['P5'], ['HALF', '~T'], ['AFTER', '~T']],
    [['HOUR', '~T'], ['P7'], ['KIGO', '~K']],
    [['KIGO', '~K'], ['HOUR', '~T'], ['P5']],
    [['P5'], ['HOUR', '~T'], ['KIGO', '~K']],
    [['KIGO', '~K'], ['P7'], ['HOUR', '~T']],
    [['HOUR', '~T'], ['KIGO', '~K'], ['P5']]
  ];

  // ------------------------------------------------------------------ English

  const EN_HOUR_N = [0, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 3, 1];
  function enNumN(n) { // syllables of a spoken number 1..59
    if (n < 20) return [0, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 3, 1, 2, 2, 2, 2, 3, 2, 2][n];
    return 2 + (n % 10 ? enNumN(n % 10) : 0);
  }
  const EN_PERIODS = [
    W('in the morning', 4, undefined, { hours: [5, 6, 7, 8, 9, 10, 11] }), W('past noon', 2, undefined, { hours: [12, 13] }),
    W('in the afternoon', 5, undefined, { hours: [13, 14, 15, 16, 17] }), W('at dusk', 2, undefined, { hours: [17, 18, 19] }),
    W('in the evening', 4, undefined, { hours: [18, 19, 20, 21] }), W('at night', 2, undefined, { hours: [21, 22, 23, 0, 1, 2, 3] }),
    W('past midnight', 3, undefined, { hours: [0, 1, 2] }), W('at dawn', 2, undefined, { hours: [4, 5, 6] }), W('before dawn', 3, undefined, { hours: [3, 4, 5] })
  ];
  function enForms(h, m) {
    const h12 = h % 12 || 12, n12 = (h + 1) % 12 || 12;
    const H = numEn(h12), HN = EN_HOUR_N[h12], NH = numEn(n12), NHN = EN_HOUR_N[n12];
    const f = (t, n) => ({ chunks: { TIME: W(t, n) }, g: t });
    const forms = [];
    if (m === 0) { forms.push(f(H + " o'clock", HN + 2)); forms.push(f(H + ' sharp', HN + 1)); }
    else if (m < 10) { forms.push(f(H + ' oh ' + numEn(m), HN + 1 + enNumN(m))); forms.push(f(numEn(m) + ' past ' + H, enNumN(m) + 1 + HN)); }
    else if (m < 30) { forms.push(f(H + ' ' + numEn(m), HN + enNumN(m))); forms.push(f(numEn(m) + ' past ' + H, enNumN(m) + 1 + HN)); if (m === 15) forms.push(f('quarter past ' + H, 3 + HN)); }
    else if (m === 30) { forms.push(f('half past ' + H, 2 + HN)); forms.push(f(H + ' thirty', HN + 2)); }
    else { forms.push(f(H + ' ' + numEn(m), HN + enNumN(m))); forms.push(f(numEn(60 - m) + ' to ' + NH, enNumN(60 - m) + 1 + NHN)); if (m === 45) forms.push(f('quarter to ' + NH, 3 + NHN)); }
    return forms;
  }
  const EN_TP = [W('it is', 2), W("now it's", 2), W('the clock says', 3), W('already', 3), W('just now', 2), W("somewhere it's", 3), W('and now', 2), W('so, it is', 3)];
  const EN_T = [W('now', 1), W('here', 1), W('still', 1), W('again', 2), W('at last', 2), W('and still', 2), W('and yet', 2), W('already', 3), W('on the dot', 3),
    W('and counting', 3), W('or near it', 3), W('by the clock', 3), W('and no more', 3), W('and quiet', 3), W('and nothing else', 4), W('and all is still', 4), W('and the house asleep', 5)];
  const EN_KP = [W('the', 1), W('and the', 2), W('only the', 3), W('still, the', 2), W('outside, the', 3), W('somewhere, the', 3), W('and then the', 3), W('here, the', 2), W('again the', 3), W('only', 2)];
  const EN_K = [W('here', 1), W('near', 1), W('too', 1), W('still', 1), W('now', 1), W('outside', 2), W('still here', 2), W('once more', 2), W('again', 2), W('close by', 2),
    W('in the air', 3), W('on the hill', 3), W('somewhere near', 3), W('all around', 3), W('as before', 3), W('as always', 3), W('down the lane', 3), W('past the door', 3),
    W('far away', 3), W('everywhere', 3), W('at the window', 4), W('over the roofs', 4), W('beyond the glass', 4), W('and nothing more', 4), W('as it always is', 5)];
  const EN_P5 = [W('I look at the clock', 5), W('tea steam is rising', 5), W('no one is awake', 5), W('the house is quiet', 5), W('I turn one more page', 5),
    W('the lamp is still lit', 5), W('a bell far away', 5), W('the hands keep moving', 5), W('shadows on the wall', 5), W('I pause and listen', 5),
    W("somebody's footsteps", 5), W('the day begins here', 5), W('the dog is asleep', 5), W('I set down the book', 5)];
  const EN_P7 = [W('the second hand keeps moving', 7), W('steam rises from the teacup', 7), W('the house has gone quiet now', 7), W('one bell rings in the distance', 7),
    W('the window lamp is still lit', 7), W('I close the book and listen', 7), W("the hand's shadow moves along", 7), W('no one else is awake yet', 7),
    W('the kettle starts to whistle', 7), W('footsteps somewhere in the hall', 7), W('the day is just beginning', 7), W('and the clock ticks on unheard', 7), W('another cup of tea poured', 7)];
  const EN_KIGO = [
    [W('first snow', 2), W('frost', 1), W('bare trees', 2), W('winter moon', 3), W('long nights', 2), W('ice on the pond', 4), W('wool scarves', 2), W('cold stars', 2)],
    [W('snowdrops', 2), W('thaw', 1), W('cold rain', 2), W('candlelight', 3), W('wrens', 1), W('late frost', 2), W('gray skies', 2), W('melting snow', 3)],
    [W('crocuses', 3), W('spring wind', 2), W('mud', 1), W('first robin', 3), W('daffodils', 3), W('swelling buds', 3), W('lengthening days', 4), W('wet earth', 2)],
    [W('cherry blossoms', 4), W('spring rain', 2), W('tulips', 2), W('swallows', 2), W('green shoots', 2), W('April showers', 4), W('birdsong', 2), W('blossom petals', 4)],
    [W('lilacs', 2), W('bees', 1), W('may flowers', 3), W('warm rain', 2), W('cuckoo song', 3), W('new leaves', 2), W('blackbird', 2), W('wisteria', 4)],
    [W('roses', 2), W('fireflies', 3), W('long days', 2), W('hay scent', 2), W('thunder', 2), W('strawberries', 3), W('midsummer light', 4), W('warm dusk', 2)],
    [W('heat haze', 2), W('cicadas', 3), W('thunderstorm', 3), W('sunflowers', 3), W('ripe wheat', 2), W('summer rain', 3), W('open windows', 4), W('dust and heat', 3)],
    [W('shooting stars', 3), W('crickets', 2), W('late heat', 2), W('ripe plums', 2), W('summer dusk', 3), W('harvest dust', 3), W('warm nights', 2), W('dry grass', 2)],
    [W('harvest moon', 3), W('first chill', 2), W('apples', 2), W('migrating geese', 5), W('dragonflies', 3), W('early dark', 3), W('morning mist', 3), W('wild asters', 3)],
    [W('red leaves', 2), W('pumpkins', 2), W('wood smoke', 2), W('first frost', 2), W('mist', 1), W('acorns', 2), W('chestnuts', 2), W('fallen leaves', 3)],
    [W('bare branches', 3), W('cold wind', 2), W('fallen leaves', 3), W('fog', 1), W('early dark', 3), W('gray rain', 2), W('wet leaves', 2), W('November wind', 4)],
    [W('snowfall', 2), W('candles', 2), W('pine scent', 2), W('winter stars', 3), W('solstice', 2), W('frosted glass', 3), W('silent snow', 3), W("year's end", 2)]
  ];

  // ------------------------------------------------------------------ German

  const DE_NUM = [null, 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
  const DE_NUM_N = [0, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2];
  const DE_TENS = { 20: 'zwanzig', 30: 'dreißig', 40: 'vierzig', 50: 'fünfzig' };
  function deNum(n) { // word and syllable count
    if (n < 20) return [DE_NUM[n], DE_NUM_N[n]];
    const u = n % 10, t = DE_TENS[n - u];
    if (!u) return [t, 2];
    const unit = u === 1 ? 'ein' : DE_NUM[u];
    return [unit + 'und' + t, (u === 1 ? 1 : DE_NUM_N[u]) + 1 + 2];
  }
  const DE_PERIODS = [
    W('am Morgen', 3, 'in the morning', { hours: [6, 7, 8, 9, 10] }), W('am Vormittag', 4, 'in the late morning', { hours: [9, 10, 11] }),
    W('am Mittag', 3, 'at midday', { hours: [12, 13] }), W('am Nachmittag', 4, 'in the afternoon', { hours: [13, 14, 15, 16, 17] }),
    W('am Abend', 3, 'in the evening', { hours: [18, 19, 20, 21] }), W('in der Nacht', 3, 'at night', { hours: [22, 23, 0, 1, 2, 3] }),
    W('nach Mitternacht', 4, 'after midnight', { hours: [0, 1, 2] }), W('in der Früh', 3, 'early in the morning', { hours: [4, 5, 6, 7] })
  ];
  function deForms(h, m) {
    const h12 = h % 12 || 12, n12 = (h + 1) % 12 || 12;
    const H = DE_NUM[h12], HN = DE_NUM_N[h12], NH = DE_NUM[n12], NHN = DE_NUM_N[n12];
    const Huhr = h12 === 1 ? 'ein' : H; // "ein Uhr", but "nach eins"
    const f = (t, n, g) => ({ chunks: { TIME: W(t, n, g) }, g });
    const forms = [];
    const eh = numEn(h12), en = numEn(n12);
    if (m === 0) { forms.push(f(Huhr + ' Uhr', HN + 1, eh + " o'clock")); forms.push(f('Punkt ' + H, 1 + HN, eh + ' sharp')); }
    else {
      const [M, MN] = deNum(m);
      forms.push(f(Huhr + ' Uhr ' + M, HN + 1 + MN, eh + ' ' + numEn(m)));
      if (m <= 20) forms.push(f(M + ' nach ' + H, MN + 1 + HN, numEn(m) + ' past ' + eh));
      if (m === 15) forms.push(f('Viertel nach ' + H, 2 + 1 + HN, 'quarter past ' + eh));
      if (m === 30) forms.push(f('halb ' + NH, 1 + NHN, 'half past ' + eh));
      if (m >= 25 && m < 30) { const [R, RN] = deNum(30 - m); forms.push(f(R + ' vor halb ' + NH, RN + 2 + NHN, numEn(30 - m) + ' before half past ' + eh)); }
      if (m > 30 && m <= 35) { const [R, RN] = deNum(m - 30); forms.push(f(R + ' nach halb ' + NH, RN + 2 + NHN, numEn(m - 30) + ' after half past ' + eh)); }
      if (m === 45) forms.push(f('Viertel vor ' + NH, 2 + 1 + NHN, 'quarter to ' + en));
      if (m >= 36) { const [R, RN] = deNum(60 - m); forms.push(f(R + ' vor ' + NH, RN + 1 + NHN, numEn(60 - m) + ' to ' + en)); }
    }
    return forms;
  }
  const DE_TP = [W('Es ist', 2, 'it is'), W('Schon', 1, 'already'), W('Jetzt ist es', 3, 'now it is'), W('Die Uhr zeigt', 3, 'the clock shows'), W('Gerade', 3, 'just now'),
    W('Erst', 1, 'only'), W('Es ist jetzt', 3, 'it is now'), W('Und nun', 2, 'and now'), W('Genau', 2, 'exactly')];
  const DE_T = [W('nun', 1, '{w} now'), W('schon', 1, '{w} already'), W('erst', 1, '{w} just now'), W('und still', 2, '{w}, and still'), W('und Stille', 3, '{w}, and silence'),
    W('vorbei', 2, '{w} gone by'), W('genau', 2, '{w} exactly'), W('und kein Laut', 3, '{w}, not a sound'), W('und noch wach', 3, '{w}, still awake'),
    W('und Teeduft', 3, '{w}, and the scent of tea'), W('und dann nichts', 3, '{w}, and then nothing'), W('sagt die Uhr', 3, '{w}, says the clock'), W('leise', 2, '{w}, softly'),
    W('und Ruhe', 3, '{w}, and rest'), W('und alles ruht', 4, '{w}, and all is at rest'), W('und sonst kein Laut', 4, '{w}, no other sound'), W('und die Nacht so lang', 5, '{w}, and the night so long')];
  const DE_KP = [W('und', 1, 'and'), W('nur', 1, 'only'), W('noch', 1, 'still'), W('draußen', 2, 'outside,'), W('irgendwo', 3, 'somewhere,'), W('leise', 2, 'softly,'),
    W('wieder', 2, 'again,'), W('dann', 1, 'then'), W('endlich', 2, 'at last,'), W('überall', 3, 'everywhere,')];
  const DE_K = [W('noch', 1, '{w} still'), W('hier', 1, '{w} here'), W('nah', 1, '{w} close by'), W('draußen', 2, '{w} outside'), W('am Fenster', 3, '{w} at the window'),
    W('vor der Tür', 3, '{w} at the door'), W('in der Luft', 3, '{w} in the air'), W('und sonst nichts', 3, '{w} and nothing else'), W('wie immer', 3, '{w} as always'),
    W('weiter', 2, '{w} still going'), W('noch einmal', 3, '{w} once more'), W('im Dunkel', 3, '{w} in the dark'), W('überall', 3, '{w} everywhere'), W('ganz still', 2, '{w}, quite still'),
    W('über den Dächern', 5, '{w} over the roofs'), W('hinter dem Glas', 4, '{w} behind the glass'), W('und nichts weiter', 4, '{w} and nothing more'), W('vor dem Fenster', 4, '{w} outside the window')];
  const DE_P5 = [W('Ich schaue zur Uhr', 5, 'I look at the clock'), W('Der Tee dampft leise', 5, 'the tea steams softly'), W('Niemand ist noch wach', 5, 'no one is awake yet'),
    W('Das Haus ist ganz still', 5, 'the house is quite still'), W('Eine Seite noch', 5, 'one more page'), W('Die Lampe brennt noch', 5, 'the lamp is still lit'),
    W('Fern eine Glocke', 5, 'a bell far away'), W('Der Zeiger wandert', 5, 'the hand wanders on'), W('Schatten an der Wand', 5, 'shadows on the wall'),
    W('Ich halte inne', 5, 'I pause'), W('Schritte auf dem Flur', 5, 'footsteps in the hall'), W('Der Tag beginnt hier', 5, 'the day begins here'), W('Der Hund schläft noch fest', 5, 'the dog is fast asleep')];
  const DE_P7 = [W('Der Sekundenzeiger geht', 7, 'the second hand keeps going'), W('Dampf steigt aus der Tasse auf', 7, 'steam rises from the cup'),
    W('Das Haus ist wieder ganz still', 7, 'the house is quite still again'), W('Glockenklang in der Ferne', 7, 'the sound of a bell in the distance'),
    W('Die Lampe im Fenster brennt', 7, 'the lamp in the window is lit'), W('Ich schließe das Buch, lausche', 7, 'I close the book and listen'),
    W('Des Zeigers Schatten wandert', 7, 'the shadow of the hand wanders'), W('Sonst ist noch niemand erwacht', 7, 'no one else has woken yet'),
    W('Der Wasserkessel pfeift schon', 7, 'the kettle is already whistling'), W('Schritte irgendwo im Flur', 7, 'footsteps somewhere in the hall'),
    W('Der Tag fängt gerade an', 7, 'the day is just beginning'), W('Und die Uhr tickt ungehört', 7, 'and the clock ticks unheard'), W('Eine zweite Tasse Tee', 7, 'a second cup of tea')];
  const DE_KIGO = [
    [W('der erste Schnee', 4, 'the first snow'), W('der Frost', 2, 'the frost'), W('die Winterstille', 5, 'the winter stillness'), W('das Eis', 2, 'the ice'),
      W('der Neujahrsmorgen', 5, "the New Year's morning"), W('der Raureif', 3, 'the hoarfrost'), W('die langen Nächte', 5, 'the long nights'), W('der Wintermond', 4, 'the winter moon')],
    [W('das Schneeglöckchen', 4, 'the snowdrop'), W('der Fasching', 3, 'carnival'), W('das Tauwetter', 4, 'the thaw'), W('die Amsel', 3, 'the blackbird'),
      W('der Schneeregen', 4, 'the sleet'), W('die Kerzen', 3, 'the candles'), W('der letzte Schnee', 4, 'the last snow'), W('das Winterlicht', 4, 'the winter light')],
    [W('der Krokus', 3, 'the crocus'), W('der Frühlingswind', 4, 'the spring wind'), W('die Märzsonne', 4, 'the March sun'), W('die Knospen', 3, 'the buds'),
      W('der Lerchensang', 4, "the lark's song"), W('das Schmelzwasser', 4, 'the meltwater'), W('die Osterglocke', 5, 'the daffodil'), W('der Märzregen', 4, 'the March rain')],
    [W('die Kirschblüte', 4, 'the cherry blossom'), W('der Aprilregen', 5, 'the April rain'), W('die Tulpen', 3, 'the tulips'), W('die Schwalben', 3, 'the swallows'),
      W('das junge Grün', 4, 'the young green'), W('das Ostermorgenlicht', 6, 'the Easter morning light'), W('der Birkenduft', 4, 'the scent of birch'), W('die Regenschauer', 5, 'the rain showers')],
    [W('das Maiglöckchen', 4, 'the lily of the valley'), W('der Flieder', 3, 'the lilac'), W('der Maikäfer', 4, 'the May beetle'), W('das Rapsfeld', 3, 'the rapeseed field'),
      W('der Spargel', 3, 'the asparagus'), W('der Kuckucksruf', 4, "the cuckoo's call"), W('die Maiwiese', 4, 'the May meadow'), W('das Bienensummen', 5, 'the humming of bees')],
    [W('der Sommerabend', 5, 'the summer evening'), W('die Rosen', 3, 'the roses'), W('der Heuduft', 3, 'the scent of hay'), W('die Erdbeeren', 4, 'the strawberries'),
      W('die Glühwürmchen', 4, 'the fireflies'), W('die lange Dämmerung', 6, 'the long twilight'), W('das Mohnfeld', 3, 'the poppy field'), W('der Mittsommer', 4, 'midsummer')],
    [W('die Hitze', 3, 'the heat'), W('das Gewitter', 4, 'the thunderstorm'), W('das Kornfeld', 3, 'the cornfield'), W('die Zikaden', 4, 'the cicadas'),
      W('der Sommerregen', 5, 'the summer rain'), W('die Sonnenblume', 5, 'the sunflower'), W('das offene Fenster', 6, 'the open window'), W('der heiße Staub', 4, 'the hot dust')],
    [W('die Sternschnuppe', 4, 'the shooting star'), W('die Grillen', 3, 'the crickets'), W('die Ernte', 3, 'the harvest'), W('die Spätsommernacht', 5, 'the late summer night'),
      W('die reifen Pflaumen', 5, 'the ripe plums'), W('das trockene Gras', 5, 'the dry grass'), W('die warme Nacht', 4, 'the warm night'), W('der Abendwind', 4, 'the evening wind')],
    [W('der Nebel', 3, 'the fog'), W('die Weinlese', 4, 'the grape harvest'), W('die Äpfel', 3, 'the apples'), W('der Altweibersommer', 6, 'Indian summer'),
      W('die Kastanie', 4, 'the chestnut'), W('die Wildgänse', 4, 'the wild geese'), W('das erste Frösteln', 5, 'the first shiver'), W('der Herbstanfang', 4, 'the start of autumn')],
    [W('das bunte Laub', 4, 'the colored leaves'), W('der Kürbis', 3, 'the pumpkin'), W('der Drachen', 3, 'the kite'), W('der Nebelmorgen', 5, 'the misty morning'),
      W('der Herbstwind', 3, 'the autumn wind'), W('der erste Frost', 4, 'the first frost'), W('der Holzrauch', 3, 'the wood smoke'), W('die Eicheln', 3, 'the acorns')],
    [W('die Laterne', 4, 'the lantern'), W('der Novemberregen', 6, 'the November rain'), W('die kahlen Bäume', 5, 'the bare trees'), W('das Novembergrau', 5, 'the November gray'),
      W('der Nachtfrost', 3, 'the night frost'), W('das nasse Laub', 4, 'the wet leaves'), W('die frühe Dunkelheit', 6, 'the early dark'), W('der kalte Wind', 4, 'the cold wind')],
    [W('der Advent', 3, 'Advent'), W('die Kerzen', 3, 'the candles'), W('der Lebkuchen', 4, 'the gingerbread'), W('der Schneefall', 3, 'the snowfall'),
      W('der Weihnachtsmarkt', 4, 'the Christmas market'), W('die Wintersonnenwende', 7, 'the winter solstice'), W('der Tannenduft', 4, 'the scent of fir'), W('die Wintersterne', 5, 'the winter stars')]
  ];

  // ------------------------------------------------------------------ Vietnamese

  const VI_NUM = [null, 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín', 'mười'];
  function viNum(n) { // 1..59, one word per syllable
    if (n <= 10) return VI_NUM[n];
    if (n < 20) return 'mười ' + (n === 15 ? 'lăm' : VI_NUM[n - 10]);
    const u = n % 10, t = VI_NUM[(n - u) / 10] + ' mươi';
    if (!u) return t;
    return t + ' ' + (u === 1 ? 'mốt' : u === 5 ? 'lăm' : VI_NUM[u]);
  }
  const VI_PERIODS = [
    W('sáng', 1, 'in the morning', { hours: [5, 6, 7, 8, 9, 10] }), W('trưa', 1, 'at midday', { hours: [11, 12, 13] }),
    W('chiều', 1, 'in the afternoon', { hours: [14, 15, 16, 17] }), W('tối', 1, 'in the evening', { hours: [18, 19, 20, 21, 22] }),
    W('đêm', 1, 'at night', { hours: [23, 0, 1, 2, 3] }), W('khuya', 1, 'late at night', { hours: [23, 0, 1, 2] }), W('sáng sớm', 2, 'in the early morning', { hours: [4, 5] })
  ];
  function viForms(h, m) {
    const h12 = h % 12 || 12, n12 = (h + 1) % 12 || 12;
    const H = viNum(h12), NH = viNum(n12), eh = numEn(h12), en = numEn(n12);
    const f = (t, g) => ({ chunks: { TIME: W(t, wordCount(t), g) }, g });
    const forms = [];
    if (m === 0) { forms.push(f(H + ' giờ', eh + " o'clock")); forms.push(f(H + ' giờ đúng', eh + ' sharp')); forms.push(f('đúng ' + H + ' giờ', 'exactly ' + eh)); }
    else {
      const M = viNum(m);
      forms.push(f(H + ' giờ ' + M + ' phút', eh + ' ' + numEn(m)));
      if (m >= 10 && m !== 30) forms.push(f(H + ' giờ ' + M, eh + ' ' + numEn(m)));
      if (m === 30) forms.push(f(H + ' giờ rưỡi', 'half past ' + eh));
      if (m >= 40) forms.push(f(NH + ' giờ kém ' + viNum(60 - m), numEn(60 - m) + ' to ' + en));
    }
    return forms;
  }
  const VI_TP = [W('Đã', 1, 'already'), W('Bây giờ', 2, 'now'), W('Đồng hồ chỉ', 3, 'the clock shows'), W('Vừa đúng', 2, 'just exactly'), W('Mới', 1, 'only just'),
    W('Giờ là', 2, 'it is now'), W('Vậy là', 2, 'so it is'), W('Chợt thấy', 2, 'I suddenly see')];
  const VI_T = [W('rồi', 1, '{w} already'), W('đây', 1, '{w}, here'), W('im lặng', 2, '{w}, silence'), W('lặng thinh', 2, '{w}, all silent'), W('chưa ngủ', 2, '{w}, not yet asleep'),
    W('còn thức', 2, '{w}, still awake'), W('một mình', 2, '{w}, alone'), W('trôi qua', 2, '{w} passing by'), W('vẫn thế', 2, '{w}, still the same'), W('chậm rãi', 2, '{w}, slowly'),
    W('bên cửa sổ', 3, '{w} by the window'), W('ngoài hiên vắng', 3, '{w} on the empty porch'), W('trong đêm vắng', 3, '{w} in the empty night'), W('tách trà nguội', 3, '{w}, the tea gone cold'),
    W('và không gì hơn', 4, '{w}, and nothing more'), W('chẳng ai hay biết', 4, '{w}, no one knows'), W('ngoài kia gió thổi', 4, '{w}, wind blowing outside')];
  const VI_KP = [W('chỉ', 1, 'only'), W('và', 1, 'and'), W('ngoài kia', 2, 'out there,'), W('đâu đó', 2, 'somewhere,'), W('lại', 1, 'again,'), W('thoảng', 1, 'faintly,'),
    W('vẫn', 1, 'still,'), W('bỗng', 1, 'suddenly,'), W('ngoài kia lại', 3, 'out there, again,'), W('đâu đó vẫn', 3, 'somewhere, still,')];
  const VI_K = [W('về', 1, '{w} returning'), W('đây', 1, '{w}, here'), W('ngoài sân', 2, '{w} in the yard'), W('bên thềm', 2, '{w} by the doorstep'), W('trong gió', 2, '{w} in the wind'),
    W('đầu ngõ', 2, "{w} at the alley's mouth"), W('lặng lẽ', 2, '{w}, quietly'), W('đã về', 2, '{w}, arrived'), W('lại về', 2, '{w}, back again'), W('cuối ngõ', 2, "{w} at the alley's end"),
    W('ngoài cửa sổ', 3, '{w} outside the window'), W('trong sương sớm', 3, '{w} in the morning mist'), W('vẫn còn đó', 3, '{w}, still there'), W('chẳng ai hay', 3, '{w}, no one notices'),
    W('thoảng đâu đây', 3, '{w} drifting somewhere near'), W('và không gì hơn', 4, '{w}, and nothing more'), W('bên hiên nhà vắng', 4, '{w} by the empty porch'), W('ngoài kia lặng lẽ', 4, '{w} out there, quietly')];
  const VI_P5 = [W('tôi ngước nhìn đồng hồ', 5, 'I look up at the clock'), W('ấm trà vẫn còn nóng', 5, 'the teapot is still warm'), W('chưa có ai thức dậy', 5, 'no one is up yet'),
    W('căn nhà im lặng quá', 5, 'the house is so quiet'), W('lật thêm một trang sách', 5, 'turning one more page'), W('ngọn đèn vẫn còn sáng', 5, 'the lamp is still lit'),
    W('một tiếng chuông xa xa', 5, 'a bell far away'), W('kim đồng hồ vẫn trôi', 5, 'the clock hand drifts on'), W('bóng đổ dài trên tường', 5, 'shadows fall long on the wall'),
    W('tôi dừng tay lắng nghe', 5, 'I pause and listen'), W('tiếng bước chân ai đó', 5, "someone's footsteps"), W('ngày mới bắt đầu đây', 5, 'the new day begins here'), W('con chó còn ngủ say', 5, 'the dog is still fast asleep')];
  const VI_P7 = [W('kim giây vẫn lặng lẽ trôi đi', 7, 'the second hand drifts on quietly'), W('khói trà bay lên từ tách nhỏ', 7, 'tea steam rises from the small cup'),
    W('căn nhà lại chìm vào im lặng', 7, 'the house sinks back into silence'), W('một tiếng chuông vọng từ xa lắm', 7, 'a bell echoes from far away'),
    W('ngọn đèn nơi cửa sổ còn sáng', 7, 'the lamp at the window is still lit'), W('tôi gấp sách lại và lắng nghe', 7, 'I close the book and listen'),
    W('bóng chiếc kim chậm rãi trôi đi', 7, 'the shadow of the hand drifts slowly'), W('chưa có ai khác thức dậy cả', 7, 'no one else is up yet'),
    W('ấm nước bắt đầu reo khe khẽ', 7, 'the kettle starts to hum softly'), W('tiếng bước chân đâu đó ngoài hiên', 7, 'footsteps somewhere on the porch'),
    W('ngày mới chỉ vừa mới bắt đầu', 7, 'the new day has only just begun'), W('đồng hồ tích tắc chẳng ai nghe', 7, 'the clock ticks and no one hears'), W('rót thêm một tách trà nữa thôi', 7, 'just one more cup of tea')];
  // Seasonal words as used in northern Vietnam; Tết moves between late January and February.
  const VI_KIGO = [
    [W('hoa đào', 2, 'peach blossom'), W('gió mùa đông bắc', 4, 'the northeast monsoon'), W('mưa phùn', 2, 'drizzle'), W('rét đậm', 2, 'the deep cold'), W('chợ Tết', 2, 'the Tết market'),
      W('bánh chưng', 2, 'bánh chưng, the New Year rice cake'), W('hoa cải vàng', 3, 'yellow mustard flowers'), W('sương muối', 2, 'hoarfrost'), W('áo len', 2, 'a wool sweater')],
    [W('Tết', 1, 'Tết, the Lunar New Year'), W('hoa mai', 2, 'apricot blossom'), W('câu đối đỏ', 3, 'red couplets'), W('lộc non', 2, 'young buds'), W('mưa xuân', 2, 'spring rain'),
      W('chim én', 2, 'swallows'), W('lì xì', 2, 'lucky money'), W('mùa xuân', 2, 'springtime'), W('hội làng', 2, 'the village festival')],
    [W('hoa gạo', 2, 'red cotton tree flowers'), W('hoa bưởi', 2, 'pomelo blossom'), W('mưa bụi', 2, 'fine rain'), W('nồm ẩm', 2, 'the humid damp'), W('hoa xoan', 2, 'chinaberry blossom'),
      W('hoa ban', 2, 'bauhinia flowers'), W('hội chùa', 2, 'the pagoda festival'), W('cỏ non', 2, 'young grass')],
    [W('hoa loa kèn', 3, 'Easter lilies'), W('nắng mới', 2, 'the new sunshine'), W('hoa sưa', 2, 'sưa blossom'), W('gió nam', 2, 'the south wind'), W('Giỗ Tổ', 2, "the Hùng Kings' festival"),
      W('tiếng cuốc', 2, 'the call of the moorhen'), W('mưa rào đầu mùa', 4, 'the first downpour'), W('hoa xoan tím', 3, 'purple chinaberry blossom')],
    [W('hoa phượng', 2, 'flamboyant flowers'), W('ve sầu', 2, 'cicadas'), W('nắng hè', 2, 'summer sun'), W('mưa rào', 2, 'a downpour'), W('bằng lăng', 2, 'crape myrtle'),
      W('tiếng ve', 2, 'the sound of cicadas'), W('gió Lào', 2, 'the hot Lao wind'), W('hoa phượng đỏ', 3, 'red flamboyant flowers')],
    [W('hoa sen', 2, 'lotus flowers'), W('vải chín', 2, 'ripe lychees'), W('mưa giông', 2, 'a thunderstorm'), W('trưa hè', 2, 'a summer noon'), W('nắng gắt', 2, 'the harsh sun'),
      W('hồ sen', 2, 'the lotus pond'), W('chuồn chuồn', 2, 'dragonflies'), W('gió nồm nam', 3, 'the humid south wind')],
    [W('mùa bão', 2, 'typhoon season'), W('sấm chiều', 2, 'evening thunder'), W('nhãn chín', 2, 'ripe longans'), W('đom đóm', 2, 'fireflies'), W('ổi chín', 2, 'ripe guavas'),
      W('sen cuối mùa', 3, 'late-season lotus'), W('nắng cháy', 2, 'burning sun'), W('mưa đêm', 2, 'night rain')],
    [W('mưa ngâu', 2, 'the Ngâu rains'), W('cốm mới', 2, 'new green rice'), W('Vu Lan', 2, 'the Vu Lan festival'), W('gió heo may', 3, 'the first cool wind'), W('mùa thu', 2, 'autumn'),
      W('hương cốm', 2, 'the scent of green rice'), W('trăng rằm tháng bảy', 4, 'the full moon of the seventh month'), W('sen tàn', 2, 'the fading lotus')],
    [W('Trung thu', 2, 'the Mid-Autumn festival'), W('đèn ông sao', 3, 'star lanterns'), W('bánh nướng', 2, 'moon cakes'), W('trăng rằm', 2, 'the full moon'), W('gió heo may', 3, 'the cool autumn wind'),
      W('hoa sữa', 2, 'milk flower blossom'), W('cốm Vòng', 2, 'green rice from Vòng village'), W('hồng chín', 2, 'ripe persimmons'), W('múa lân', 2, 'the lion dance')],
    [W('hoa sữa', 2, 'milk flower blossom'), W('lá vàng', 2, 'yellow leaves'), W('gió heo may', 3, 'the cool autumn wind'), W('nắng hanh', 2, 'the dry sunshine'), W('hồng chín', 2, 'ripe persimmons'),
      W('sương thu', 2, 'autumn mist'), W('chiều thu', 2, 'an autumn afternoon'), W('cúc vàng', 2, 'yellow chrysanthemums')],
    [W('cúc họa mi', 3, 'daisies'), W('gió mùa', 2, 'the monsoon wind'), W('sương giăng', 2, 'the spreading mist'), W('rét đầu mùa', 3, 'the first cold'), W('áo ấm', 2, 'warm clothes'),
      W('khoai nướng', 2, 'roasted sweet potato'), W('ngô nướng', 2, 'roasted corn'), W('gió bấc', 2, 'the north wind'), W('hoa dã quỳ', 3, 'wild sunflowers')],
    [W('gió bấc', 2, 'the north wind'), W('Giáng sinh', 2, 'Christmas'), W('lá bàng đỏ', 3, 'red almond leaves'), W('sương muối', 2, 'hoarfrost'), W('hoa cải vàng', 3, 'yellow mustard flowers'),
      W('rét ngọt', 2, 'the sweet cold'), W('bếp lửa', 2, 'the kitchen fire'), W('chăn ấm', 2, 'a warm blanket'), W('cuối năm', 2, "the year's end"), W('mùa đông', 2, 'winter')]
  ];

  // Shared template set for English, German and Vietnamese (PERIOD is inserted after TIME automatically).
  const X_TEMPLATES = [
    [['~TP', 'TIME', '~T'], ['~KP', 'KIGO', '~K'], ['P5']],
    [['P5'], ['~TP', 'TIME', '~T'], ['~KP', 'KIGO', '~K']],
    [['~KP', 'KIGO', '~K'], ['~TP', 'TIME', '~T'], ['P5']],
    [['~TP', 'TIME', '~T'], ['P7'], ['~KP', 'KIGO', '~K']],
    [['~KP', 'KIGO', '~K'], ['P7'], ['~TP', 'TIME', '~T']],
    [['P5'], ['~KP', 'KIGO', '~K'], ['~TP', 'TIME', '~T']]
  ];

  // ------------------------------------------------------------------ languages

  const LANGS = {
    ja: { code: 'ja', name: 'Japanese', native: '日本語', unit: 'morae', join: '', count: e => moraCount(e.r),
      forms: jaForms, periods: JA_PERIODS, periodBefore: ['HOUR', 'HALF'], templates: JA_TEMPLATES,
      banks: { T: JA_T, K: JA_K }, phrases: { P5: JA_P5, P7: JA_P7 }, kigo: JA_KIGO },
    en: { code: 'en', name: 'English', native: 'English', unit: 'syllables', join: ' ', count: null,
      forms: enForms, periods: EN_PERIODS, periodAfter: 'TIME', templates: X_TEMPLATES,
      banks: { TP: EN_TP, T: EN_T, KP: EN_KP, K: EN_K }, phrases: { P5: EN_P5, P7: EN_P7 }, kigo: EN_KIGO },
    de: { code: 'de', name: 'German', native: 'Deutsch', unit: 'syllables', join: ' ', count: null,
      forms: deForms, periods: DE_PERIODS, periodAfter: 'TIME', templates: X_TEMPLATES,
      banks: { TP: DE_TP, T: DE_T, KP: DE_KP, K: DE_K }, phrases: { P5: DE_P5, P7: DE_P7 }, kigo: DE_KIGO },
    vi: { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', unit: 'words', join: ' ', count: e => wordCount(e.t),
      forms: viForms, periods: VI_PERIODS, periodAfter: 'TIME', templates: X_TEMPLATES,
      banks: { TP: VI_TP, T: VI_T, KP: VI_KP, K: VI_K }, phrases: { P5: VI_P5, P7: VI_P7 }, kigo: VI_KIGO }
  };
  const LANG_ORDER = ['en', 'ja', 'de', 'vi'];
  const TARGET = [5, 7, 5];
  const TIME_SLOTS = ['HOUR', 'MIN', 'HALF', 'AFTER', 'TOH', 'REM', 'TIME', 'PERIOD'];

  // ------------------------------------------------------------------ generator

  // Time forms for hour h, minute m, plus a copy of each with a fitting period word.
  function formsWithPeriods(lang, h, m) {
    const base = lang.forms(h, m);
    const out = [];
    for (const f of base) {
      f.slots = Object.keys(f.chunks).sort();
      out.push(f);
      if (!lang.periods) continue;
      const anchor = lang.periodAfter ? f.chunks[lang.periodAfter] : lang.periodBefore.find(s => f.chunks[s]);
      if (!anchor) continue;
      for (const p of lang.periods) {
        if (p.hours.indexOf(h) < 0) continue;
        const chunks = Object.assign({}, f.chunks, { PERIOD: p });
        out.push({ chunks, slots: Object.keys(chunks).sort(), g: f.g + ' ' + p.g, period: p });
      }
    }
    return out;
  }

  // Template variants: the PERIOD slot is spliced in before HOUR/HALF (ja) or after TIME (others).
  function templateVariants(lang, tpl) {
    const variants = [{ lines: tpl, slots: timeSlotsOf(tpl) }];
    const lines = tpl.map(line => line.slice());
    let placed = false;
    for (const line of lines) {
      if (lang.periodAfter) {
        const i = line.indexOf(lang.periodAfter);
        if (i >= 0) { line.splice(i + 1, 0, 'PERIOD'); placed = true; break; }
      } else {
        const i = line.findIndex(x => lang.periodBefore.indexOf(x) >= 0);
        if (i >= 0) { line.splice(i, 0, 'PERIOD'); placed = true; break; }
      }
    }
    if (placed) variants.push({ lines, slots: timeSlotsOf(lines) });
    return variants;
  }
  function timeSlotsOf(lines) {
    return lines.flat().filter(x => TIME_SLOTS.indexOf(x) >= 0).sort();
  }
  const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  // Words of a fill, cached on the entry (used to avoid "still ... still" in one line).
  function wordsOf(e) {
    if (e.ws === undefined) e.ws = e.t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean);
    return e.ws;
  }
  const shareWord = (a, b) => wordsOf(a).some(w => wordsOf(b).indexOf(w) >= 0);

  // All exact realizations of one line: each is a list of {slot, e} items.
  function lineOptions(lang, line, target, form, kigo, isLast) {
    const results = [];
    const whole = sameSet(line.filter(x => TIME_SLOTS.indexOf(x) >= 0).sort(), form.slots);
    (function walk(i, used, acc, prevKigo) {
      if (i === line.length) { if (used === target) results.push(acc); return; }
      const item = line[i];
      if (item[0] === '~') {
        const bank = lang.banks[item.slice(1)];
        walk(i + 1, used, acc, false); // a fill may be empty
        for (const e of bank) {
          if (used + e.n > target) continue;
          if (prevKigo && kigo.p && !e.any) continue; // phrase kigo take only particle-like fills
          if (e.whole && !whole) continue;              // extensions like の窓 need the whole time expression
          if (e.nf && isLast && i === line.length - 1) continue; // の, に... must not end the poem
          if (acc.some(x => x.slot[0] === '~' && shareWord(x.e, e))) continue; // no "still ... still"
          walk(i + 1, used + e.n, acc.concat([{ slot: item, e }]), false);
        }
        return;
      }
      if (item === 'P5' || item === 'P7') {
        for (const e of lang.phrases[item]) if (used + e.n <= target) walk(i + 1, used + e.n, acc.concat([{ slot: item, e }]), false);
        return;
      }
      const e = item === 'KIGO' ? kigo : form.chunks[item];
      if (!e || used + e.n > target) return;
      if (e.attach && !whole) return; // ちょうど only directly after its hour
      walk(i + 1, used + e.n, acc.concat([{ slot: item, e }]), item === 'KIGO');
    })(0, 0, [], false);
    return results;
  }

  // English gloss of one realized line. Fills after a word wrap the gloss so far with "{w}".
  function lineGloss(items, form) {
    const slotsHere = items.filter(x => TIME_SLOTS.indexOf(x.slot) >= 0).map(x => x.slot).sort();
    const wholeTime = slotsHere.length && sameSet(slotsHere, form.slots);
    let acc = '', timeDone = false;
    const join = (a, b) => a ? a + ' ' + b : b;
    for (const it of items) {
      if (TIME_SLOTS.indexOf(it.slot) >= 0) {
        if (wholeTime) { if (!timeDone) acc = join(acc, form.g); timeDone = true; }
        else if (it.slot !== 'PERIOD') acc = join(acc, it.e.g);
        continue;
      }
      const g = it.e.g || '';
      acc = g.indexOf('{w}') >= 0 ? g.replace('{w}', acc) : join(acc, g);
    }
    acc = acc.replace(/\s+/g, ' ').trim();
    return acc.charAt(0).toUpperCase() + acc.slice(1);
  }

  // Generate one haiku. date: {month (0-11), h, m}; seed: any integer.
  function generate(langCode, date, seed) {
    const lang = LANGS[langCode];
    const rng = mulberry32((seed ^ (langCode.charCodeAt(0) * 65599 + langCode.charCodeAt(1))) >>> 0);
    const forms = formsWithPeriods(lang, date.h, date.m);
    const variants = lang.templates.flatMap(t => templateVariants(lang, t));
    // Many templates share lines, so line realizations are memoized per form (and per kigo where it matters).
    const memo = new Map();
    const options = (line, i, fi, form, ki, kigo) => {
      const key = line.join(',') + '#' + TARGET[i] + '#' + fi + (line.indexOf('KIGO') >= 0 ? '#' + ki : '');
      if (!memo.has(key)) memo.set(key, lineOptions(lang, line, TARGET[i], form, kigo, i === 2));
      return memo.get(key);
    };
    const kigoList = lang.kigo[date.month];
    for (const kigo of shuffled(rng, kigoList)) {
      const ki = kigoList.indexOf(kigo);
      const valid = [];
      forms.forEach((form, fi) => {
        for (const v of variants) {
          if (!sameSet(v.slots, form.slots)) continue;
          const opts = v.lines.map((line, i) => options(line, i, fi, form, ki, kigo));
          if (opts.every(o => o.length)) valid.push({ form, v, opts });
        }
      });
      if (!valid.length) continue;
      const choice = pick(rng, valid);
      const usedFills = [];
      const lines = choice.opts.map((o, i) => {
        // prefer realizations whose fills were not already used in an earlier line
        const fresh = o.filter(items => !items.some(x => x.slot[0] === '~' && usedFills.indexOf(x.e.t) >= 0));
        const items = pick(rng, fresh.length ? fresh : o);
        items.forEach(x => { if (x.slot[0] === '~') usedFills.push(x.e.t); });
        const text = items.map(x => x.e.t).join(lang.join);
        const reading = langCode === 'ja' ? items.map(x => x.e.r).join('') : '';
        return {
          items, text: lang.join ? text.charAt(0).toUpperCase() + text.slice(1) : text,
          reading, romaji: reading ? toRomaji(reading) : '',
          n: items.reduce((s, x) => s + x.e.n, 0), target: TARGET[i],
          gloss: lineGloss(items, choice.form)
        };
      });
      return { lang: langCode, lines, kigo, time: choice.form.g, translation: lines.map(l => l.gloss) };
    }
    throw new Error('no haiku possible for ' + langCode + ' ' + date.h + ':' + date.m + ' month ' + date.month);
  }

  // Seed for a given minute; shuffle > 0 gives a different verse for the same minute.
  function seedFor(d, shuffle) {
    const day = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    return (Math.imul(day, 1440) + d.getHours() * 60 + d.getMinutes() + Math.imul(shuffle || 0, 104729)) >>> 0;
  }

  // Every bank entry of a language, for verification.
  function allEntries(lang) {
    const out = [];
    for (const k in lang.banks) out.push(...lang.banks[k]);
    for (const k in lang.phrases) out.push(...lang.phrases[k]);
    for (const month of lang.kigo) out.push(...month);
    if (lang.periods) out.push(...lang.periods);
    for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m++) for (const f of lang.forms(h, m)) for (const s in f.chunks) out.push(f.chunks[s]);
    return out;
  }

  return { moraCount, wordCount, toRomaji, mulberry32, LANGS, LANG_ORDER, TARGET, generate, seedFor, allEntries, numEn };
});
