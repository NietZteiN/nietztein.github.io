// test.js: checks the word banks and the generator without a browser.
//   node test.js
//
// 1. Every stored count matches the counter for that language (morae for
//    Japanese via the kana rules, words for Vietnamese). English and German
//    counts are hand-counted, so they are only checked for being positive.
// 2. For every month, every minute of the day and a few seeds, every language
//    produces a verse whose lines count 5-7-5 (Japanese recounted from kana).
// 3. Japanese entries have a reading for every entry.
'use strict';
const H = require('./haiku_data.js');

let failures = 0;
function fail(msg) { failures++; console.log('FAIL ' + msg); }

// 1. bank counts
for (const code of H.LANG_ORDER) {
  const lang = H.LANGS[code];
  const entries = H.allEntries(lang);
  let checked = 0;
  for (const e of entries) {
    if (!(e.n > 0)) fail(code + ' entry without count: ' + JSON.stringify(e));
    if (code === 'ja' && !e.r) fail('ja entry without reading: ' + e.t);
    if (lang.count) {
      const c = lang.count(e);
      if (c !== e.n) fail(code + ' ' + e.t + ' (' + (e.r || '') + ') stored ' + e.n + ' counted ' + c);
      checked++;
    }
  }
  console.log(code + ': ' + entries.length + ' entries, ' + checked + ' recounted');
}

// spot checks of the mora counter itself
const moraCases = [['きょう', 2], ['がっこう', 4], ['とうきょう', 4], ['さんじ', 3], ['じゅっぷん', 4], ['にゅうどうぐも', 6], ['ぺーじ', 3], ['しゅんみん', 4]];
for (const [k, n] of moraCases) if (H.moraCount(k) !== n) fail('moraCount(' + k + ') = ' + H.moraCount(k) + ', expected ' + n);
const romajiCases = [['さんじじゅうごふん', 'sanjijūgofun'], ['じゅっぷん', 'juppun'], ['しちじ', 'shichiji'], ['きょう', 'kyō'], ['しんや', "shin'ya"]];
for (const [k, r] of romajiCases) if (H.toRomaji(k) !== r) fail('toRomaji(' + k + ') = ' + H.toRomaji(k) + ', expected ' + r);

// 2. every minute of the day in every month with one seed, plus a spread of
//    minutes in every hour with three seeds (the same minute must be stable).
const SPREAD = [0, 1, 5, 15, 25, 30, 31, 37, 45, 49, 55, 59];
let verses = 0;
const t0 = Date.now();
for (const code of H.LANG_ORDER) {
  for (let month = 0; month < 12; month++) {
    const cases = [];
    for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m++) {
      cases.push([h, m, 1]);
      if (SPREAD.indexOf(m) >= 0) cases.push([h, m, 2], [h, m, 3]);
    }
    for (const [h, m, seed] of cases) {
      let v;
      try { v = H.generate(code, { month, h, m }, seed * 7919 + h * 60 + m); }
      catch (err) { fail(err.message); continue; }
      verses++;
      v.lines.forEach((line, i) => {
        const stored = line.n;
        const counted = code === 'ja' ? H.moraCount(line.reading) : code === 'vi' ? H.wordCount(line.text) : stored;
        if (stored !== H.TARGET[i] || counted !== H.TARGET[i]) {
          fail(code + ' ' + h + ':' + m + ' month ' + (month + 1) + ' line ' + (i + 1) + ' = "' + line.text + '" (' + line.reading + ') stored ' + stored + ' counted ' + counted);
        }
      });
      if (!v.kigo || !v.translation.every(t => t.length)) fail(code + ' ' + h + ':' + m + ' missing kigo or translation');
    }
  }
}
console.log('generated ' + verses + ' verses in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');

// determinism: the same minute and seed give the same verse
const a = H.generate('ja', { month: 3, h: 7, m: 42 }, 12345), b = H.generate('ja', { month: 3, h: 7, m: 42 }, 12345);
if (JSON.stringify(a.lines.map(l => l.text)) !== JSON.stringify(b.lines.map(l => l.text))) fail('generation is not deterministic');

// a few samples for the eye
const now = new Date();
for (const code of H.LANG_ORDER) {
  const v = H.generate(code, { month: now.getMonth(), h: now.getHours(), m: now.getMinutes() }, H.seedFor(now, 0));
  console.log('\n[' + code + '] ' + v.time + ' / kigo: ' + v.kigo.t + ' (' + v.kigo.g + ')');
  for (const l of v.lines) console.log('  ' + l.text + (l.reading ? '  ' + l.reading + '  ' + l.romaji : '') + '  [' + l.n + ']');
  console.log('  -> ' + v.translation.join(' / '));
}

console.log(failures ? '\n' + failures + ' failure(s)' : '\nall checks passed');
process.exit(failures ? 1 : 0);
