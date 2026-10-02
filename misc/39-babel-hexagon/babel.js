/* Babel Hexagon: the Library itself, with no DOM in it so the same file runs under Node.
 *
 * A page is 40 lines of 80 characters over 29 symbols (a-z, space, comma, period), i.e. a
 * 3200-digit number P in base 29. An address (hexagon name in base 36, wall 1-4, shelf 1-5,
 * volume 1-32, page 1-410) is likewise one number A = hexagon * 26240 + slot. The two are tied
 * together by an affine bijection on Z/N, N = 29^3200:
 *
 *     P = (a * A + c) mod N        A = a' * (P - c) mod N        with a * a' = 1 (mod N)
 *
 * a and c are fixed 3200-digit constants drawn from a seeded generator; a is a unit (not a
 * multiple of 29) so a' exists and is found by Hensel lifting. Because the map is a bijection,
 * every page has exactly one canonical address with A < N and every text has a shelf. Hexagon
 * names longer than about 3000 characters wrap around (A mod N): the Library is cyclical.
 *
 * Exposed as window.Babel in the browser and module.exports under Node.
 */
(function (root) {
  'use strict';
  var B = {};

  /* ---------- constants ---------- */
  var ALPHABET = 'abcdefghijklmnopqrstuvwxyz ,.';
  var LINES = 40, COLS = 80, PAGE_LEN = LINES * COLS;
  var WALLS = 4, SHELVES = 5, VOLUMES = 32, PAGES = 410;
  var SLOTS = WALLS * SHELVES * VOLUMES * PAGES;        // 26240 pages per hexagon
  var BIG29 = 29n, BIGSLOTS = BigInt(SLOTS);
  var CHUNK = 10;                                       // 29^10 and 36^10 both fit a double exactly
  var CHUNK29 = 29n ** 10n, CHUNK29N = Math.pow(29, 10);
  var CHUNK36 = 36n ** 10n;
  var N = BIG29 ** BigInt(PAGE_LEN);
  var MAX_HEX_LEN = 0;                                  // longest canonical hexagon name (computed below)

  B.ALPHABET = ALPHABET; B.LINES = LINES; B.COLS = COLS; B.PAGE_LEN = PAGE_LEN;
  B.WALLS = WALLS; B.SHELVES = SHELVES; B.VOLUMES = VOLUMES; B.PAGES = PAGES; B.SLOTS = SLOTS;

  var CODE = {};                                        // char -> digit
  for (var i = 0; i < ALPHABET.length; i++) CODE[ALPHABET[i]] = i;

  /* ---------- small seeded generator (mulberry32 over a string hash) ---------- */
  function hashString(s) {
    var h1 = 0xdeadbeef ^ 0x9e3779b9, h2 = 0x41c6ce57 ^ 0x9e3779b9;
    for (var i = 0, ch; i < s.length; i++) {
      ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 >>> 0) ^ Math.imul(h2 >>> 0, 0x1b873593);
  }
  function rng(seed) {
    var a = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  B.rng = rng;
  B.hashString = hashString;

  /* ---------- base conversions ---------- */
  // 3200-character page -> BigInt (first character is the most significant digit)
  function textToBig(text) {
    var big = 0n;
    for (var i = 0; i < text.length; i += CHUNK) {
      var end = Math.min(i + CHUNK, text.length), v = 0;
      for (var j = i; j < end; j++) v = v * 29 + (CODE[text[j]] | 0);
      big = big * (end - i === CHUNK ? CHUNK29 : BIG29 ** BigInt(end - i)) + BigInt(v);
    }
    return big;
  }
  // BigInt -> 3200-character page, zero ("a") padded on the left
  function bigToText(big) {
    var chunks = new Array(PAGE_LEN / CHUNK), k = chunks.length;
    while (k-- > 0) {
      var v = Number(big % CHUNK29); big /= CHUNK29;
      var s = '';
      for (var j = 0; j < CHUNK; j++) { s = ALPHABET[v % 29] + s; v = Math.floor(v / 29); }
      chunks[k] = s;
    }
    return chunks.join('');
  }
  B.textToBig = textToBig;
  B.bigToText = bigToText;

  // hexagon names: base 36, lowercase, no leading zeros, "0" for zero
  function hexToBig(name) {
    var s = canonicalHexName(name), big = 0n;
    for (var i = 0; i < s.length; i += CHUNK) {
      var part = s.slice(i, i + CHUNK);
      big = big * (part.length === CHUNK ? CHUNK36 : 36n ** BigInt(part.length)) + BigInt(parseInt(part, 36));
    }
    return big;
  }
  function bigToHex(big) { return big.toString(36); }
  function canonicalHexName(name) {
    var s = String(name || '').toLowerCase().replace(/[^0-9a-z]/g, '').replace(/^0+/, '');
    return s || '0';
  }
  B.hexToBig = hexToBig; B.bigToHex = bigToHex; B.canonicalHexName = canonicalHexName;

  /* ---------- the fixed constants a, c and the inverse of a ---------- */
  function randomDigits(seedName, n) {
    var r = rng(seedName), s = '';
    for (var i = 0; i < n; i++) s += ALPHABET[Math.floor(r() * 29)];
    return s;
  }
  var A_CONST = textToBig(randomDigits('babel hexagon: multiplier', PAGE_LEN));
  if (A_CONST % BIG29 === 0n) A_CONST += 1n;                 // make it a unit
  var C_CONST = textToBig(randomDigits('babel hexagon: offset', PAGE_LEN));

  // a' with a * a' = 1 (mod 29^3200), by Hensel lifting from the inverse mod 29
  function inverseMod29Power(a) {
    var a29 = Number(a % BIG29), x = 1n;
    for (var t = 1; t < 29; t++) if ((a29 * t) % 29 === 1) { x = BigInt(t); break; }
    var k = 1;
    while (k < PAGE_LEN) {
      k *= 2;
      var M = BIG29 ** BigInt(k);
      x = (x * (2n - ((a * x) % M))) % M;
      if (x < 0n) x += M;
    }
    return x % N;
  }
  var A_INV = inverseMod29Power(A_CONST);

  B.constants = { N: N, a: A_CONST, c: C_CONST, aInverse: A_INV };

  /* ---------- the bijection ---------- */
  function pageNumberFromAddressNumber(A) {           // P = a A + c
    var P = (A_CONST * (A % N) + C_CONST) % N;
    return P < 0n ? P + N : P;
  }
  function addressNumberFromPageNumber(P) {           // A = a' (P - c)
    var A = (A_INV * (((P % N) - C_CONST) % N)) % N;
    return A < 0n ? A + N : A;
  }

  /* ---------- addresses ---------- */
  // {hex, wall, shelf, volume, page}; all four small fields are 1-based
  function slotOf(addr) {
    return ((addr.wall - 1) * SHELVES + (addr.shelf - 1)) * VOLUMES * PAGES + (addr.volume - 1) * PAGES + (addr.page - 1);
  }
  function addressToNumber(addr) {
    return hexToBig(addr.hex) * BIGSLOTS + BigInt(slotOf(addr));
  }
  function numberToAddress(A) {
    if (A < 0n) A = ((A % N) + N) % N;
    var hexBig = A / BIGSLOTS, slot = Number(A % BIGSLOTS);
    var page = slot % PAGES; slot = (slot - page) / PAGES;
    var volume = slot % VOLUMES; slot = (slot - volume) / VOLUMES;
    var shelf = slot % SHELVES; slot = (slot - shelf) / SHELVES;
    return { hex: bigToHex(hexBig), wall: slot + 1, shelf: shelf + 1, volume: volume + 1, page: page + 1 };
  }
  function normalizeAddress(addr) {
    var clamp = function (v, hi) { v = parseInt(v, 10); return isNaN(v) ? 1 : Math.min(hi, Math.max(1, v)); };
    return {
      hex: canonicalHexName(addr && addr.hex),
      wall: clamp(addr && addr.wall, WALLS), shelf: clamp(addr && addr.shelf, SHELVES),
      volume: clamp(addr && addr.volume, VOLUMES), page: clamp(addr && addr.page, PAGES)
    };
  }
  function sameAddress(x, y) {
    return x && y && canonicalHexName(x.hex) === canonicalHexName(y.hex) && +x.wall === +y.wall &&
      +x.shelf === +y.shelf && +x.volume === +y.volume && +x.page === +y.page;
  }
  B.slotOf = slotOf; B.addressToNumber = addressToNumber; B.numberToAddress = numberToAddress;
  B.normalizeAddress = normalizeAddress; B.sameAddress = sameAddress;

  // the canonical form of an address: hexagon names past the end of the Library wrap around
  function canonicalAddress(addr) { return numberToAddress(addressToNumber(normalizeAddress(addr)) % N); }
  B.canonicalAddress = canonicalAddress;

  /* ---------- page <-> address ---------- */
  B.pageFromAddress = function (addr) {
    return bigToText(pageNumberFromAddressNumber(addressToNumber(normalizeAddress(addr))));
  };
  B.addressFromPage = function (text) {
    if (text.length !== PAGE_LEN) throw new Error('a page has exactly ' + PAGE_LEN + ' characters');
    return numberToAddress(addressNumberFromPageNumber(textToBig(text)));
  };

  // step forward or back by a number of pages (crossing volumes, shelves, walls and hexagons)
  B.step = function (addr, pages) {
    return numberToAddress(addressToNumber(normalizeAddress(addr)) + BigInt(pages));
  };
  B.stepVolume = function (addr, volumes) { return B.step(addr, volumes * PAGES); };

  // a random address with a short hexagon name (the page still looks random: a is full-size)
  B.randomAddress = function (r, hexLen) {
    r = r || Math.random;
    var len = hexLen || (1 + Math.floor(r() * 10)), s = '';
    for (var i = 0; i < len; i++) s += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(r() * 36)];
    return {
      hex: canonicalHexName(s), wall: 1 + Math.floor(r() * WALLS), shelf: 1 + Math.floor(r() * SHELVES),
      volume: 1 + Math.floor(r() * VOLUMES), page: 1 + Math.floor(r() * PAGES)
    };
  };

  /* ---------- text ---------- */
  // fold anything into the 29-symbol alphabet: lowercase, strip accents, line breaks become
  // spaces, ! ? ; : become periods and commas, everything else is dropped
  B.normalize = function (text) {
    var s = String(text || '').toLowerCase();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* old engine */ }
    s = s.replace(/[\r\n\t]+/g, ' ').replace(/[!?]/g, '.').replace(/[;:]/g, ',').replace(/[-–—\/]/g, ' ');
    s = s.replace(/[^a-z ,.]/g, '').replace(/ +/g, ' ');
    return s.slice(0, PAGE_LEN);
  };

  // search: an address whose page contains exactly `text`
  //   mode 'exact'  : the text somewhere on the page, padded with seeded pseudo-random symbols
  //   mode 'title'  : the text at the top of the page, padded the same way
  //   mode 'spaces' : the text at the top of the page and nothing else but spaces
  B.search = function (text, mode) {
    var t = B.normalize(text);
    if (!t) return null;
    var r = rng('search:' + mode + ':' + t), page;
    var offset = 0;
    if (mode === 'spaces') {
      page = t + repeat(' ', PAGE_LEN - t.length);
    } else {
      if (mode === 'exact') {
        var freeLines = Math.floor((PAGE_LEN - t.length) / COLS);
        offset = COLS * Math.floor(r() * (freeLines + 1));
      }
      var before = '', after = '';
      for (var i = 0; i < offset; i++) before += ALPHABET[Math.floor(r() * 29)];
      for (var j = offset + t.length; j < PAGE_LEN; j++) after += ALPHABET[Math.floor(r() * 29)];
      page = before + t + after;
    }
    return { address: B.addressFromPage(page), page: page, offset: offset, length: t.length, text: t, mode: mode };
  };
  function repeat(ch, n) { var s = ''; while (n-- > 0) s += ch; return s; }

  /* ---------- hash codec: #hex:wall:shelf:volume:page ---------- */
  B.formatHash = function (addr) {
    addr = normalizeAddress(addr);
    return addr.hex + ':' + addr.wall + ':' + addr.shelf + ':' + addr.volume + ':' + addr.page;
  };
  B.parseHash = function (hash) {
    var s = String(hash || '').replace(/^#/, '');
    if (!s) return null;
    var parts = s.split(':');
    if (parts.length !== 5) return null;
    return normalizeAddress({ hex: parts[0], wall: parts[1], shelf: parts[2], volume: parts[3], page: parts[4] });
  };

  /* ---------- the English finder ---------- */
  // Find runs that are words from `set` (a Set of lowercase words), longest match first, no
  // overlaps. Returns [[start, end), ...] in page order.
  B.findWords = function (page, set, minLen, maxLen) {
    minLen = minLen || 4; maxLen = maxLen || 15;
    var spans = [], n = page.length, i = 0;
    while (i < n) {
      var ch = page.charCodeAt(i);
      if (ch < 97 || ch > 122) { i++; continue; }
      var runEnd = i;
      while (runEnd < n) { var c = page.charCodeAt(runEnd); if (c < 97 || c > 122) break; runEnd++; }
      var p = i;
      while (p + minLen <= runEnd) {
        var hit = 0;
        for (var len = Math.min(maxLen, runEnd - p); len >= minLen; len--) {
          if (set.has(page.substr(p, len))) { hit = len; break; }
        }
        if (hit) { spans.push([p, p + hit]); p += hit; } else p++;
      }
      i = runEnd;
    }
    return spans;
  };

  /* ---------- the longest canonical hexagon name ---------- */
  MAX_HEX_LEN = bigToHex((N - 1n) / BIGSLOTS).length;
  B.MAX_HEX_LEN = MAX_HEX_LEN;

  if (typeof module !== 'undefined' && module.exports) module.exports = B;
  root.Babel = B;
})(typeof self !== 'undefined' ? self : globalThis);
