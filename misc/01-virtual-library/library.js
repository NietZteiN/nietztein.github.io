/*
 * library.js
 *
 * Shared catalog helpers for the virtual library (project 1). The bookshelf
 * poster (project 14) and Bookshelf Tetris (project 17) load this same file
 * with <script src="../01-virtual-library/library.js">, so it stays a plain
 * script: no modules, no build step, no dependencies. It defines exactly one
 * global, `Library`.
 *
 * The catalog is the CSV written by import_xlsx.py from the workbook: one row
 * per item on a shelf, including objects that are not books, with a Unit
 * (a bookcase), a Shelf (a string such as "A1", "T-W" or "N4 (バガボンド, くず)")
 * and a position counted from the left.
 *
 * Contents, in order:
 *   CONFIG            column mapping, shelf rules and layout constants
 *   parseCSV          CSV or TSV text to an array of row objects
 *   normalizeRows     row objects to typed book records
 *   titleSortKey      the shelving order ("The" grouped after S)
 *   parseShelfRange   "S / The A-E" to letter ranges
 *   groupByShelf      group books by unit and shelf, ordered by position
 *   spineGeometry     width, height and color for one spine
 *   drawSpine         draw one spine into an SVG parent
 *   integrityChecks   find books and shelves that look wrong
 *   stats             counts by author, language, decade, genre, type, ...
 *   describeLocation  "Unit K, shelf T-W, position 12, between X and Y"
 *   loadCatalog       fetch + parse + normalize, with a fallback list
 */
var Library = (function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* CONFIG                                                              */
  /* ------------------------------------------------------------------ */

  var CONFIG = {
    // Maps each field the apps use to the column header in the CSV. The
    // right-hand sides are the headers import_xlsx.py writes (the workbook's
    // own headers plus Year, YearParsed, Description, Shelf description and
    // sort_title). Matching ignores case and surrounding spaces. A column
    // that is missing from the file simply yields blanks: pages and
    // sort_title are optional.
    columns: {
      id: 'ID',
      unit: 'Unit',
      shelf: 'Shelf',
      position: 'Pos (L to R)',
      title: 'Title',
      author: 'Author / Editor',
      publisher: 'Publisher / Series',
      language: 'Language',
      type: 'Type',
      photo: 'Photo #',
      photoFiles: 'Photo file(s)',
      leftNeighbor: 'Left neighbor',
      rightNeighbor: 'Right neighbor',
      status: 'Status',
      confidence: 'Confidence',
      notes: 'Notes',
      genre: 'Genre',
      year: 'Year',
      yearParsed: 'YearParsed',
      description: 'Description',
      shelfDescription: 'Shelf description',
      pages: 'Pages',          // optional; overrides the Type-based spine size
      sortTitle: 'sort_title'  // optional; overrides the title for ordering only
    },

    // Files tried in order, relative to project 1. The real export comes
    // first (it is gitignored), then the committed sample.
    catalogUrls: ['data/my-library.csv', 'data/library.csv'],

    // Values of the Status column that change how a row is treated.
    status: { object: 'Not a book', unreadable: 'Unreadable', partial: 'Partial' },
    lowConfidence: 'Low',

    // Which shelves are alphabetized by title. `unit` limits the check to
    // one bookcase (null for any unit). `shelves` is either a regular
    // expression the shelf name must match or an array of shelf names.
    // The default pattern matches the letter-range names of the pine
    // bookcase: "A to D", "T-W", "S / The A-E", "The F-O".
    alphabetized: {
      unit: 'K',
      shelves: /^(?:[A-Z](?: to |-)[A-Z]|[A-Z] \/ The [A-Z]-[A-Z]|The [A-Z]-[A-Z])$/
    },

    // The Harvard Classics shelves: volumes must run in numeric order and
    // all volumes 1..volumes should be present somewhere on these shelves.
    harvardClassics: {
      shelves: /^HC\b/,
      title: /^Harvard Classics,?\s+Vol(?:ume|\.)?\s*(\d+)/i,
      volumes: 51
    },

    // Spine sizing in SVG user units. There is no page count in the catalog,
    // so a size band comes from the Type column (and a bunko publisher);
    // a Pages column, when present, overrides it.
    spine: {
      bands: {
        small: { width: 12, height: 104 },
        medium: { width: 18, height: 132 },
        large: { width: 26, height: 164 },
        object: { width: 16, height: 16 }      // rows with Status "Not a book"
      },
      typeBands: {
        'Manga': 'small', 'Light novel': 'small', 'Comics': 'small', 'Poetry': 'small',
        'Magazine': 'small', 'Picture book': 'small', "Children's": 'small', 'Calendar': 'small',
        'Documents': 'small', 'Game': 'small', 'Games': 'small',
        'Art': 'large', 'Textbook': 'large', 'Reference': 'large', 'Anthology': 'large',
        'Nursing & medical': 'large', 'Technical': 'large', 'Math journal': 'large', 'Test prep': 'large'
      },
      defaultBand: 'medium',
      bunkoPattern: /文庫|bunko/i,   // publisher match: pocket size, so "small"
      jitter: 0.08,                   // deterministic size variation per row, as a fraction
      // Used only when a Pages column is present.
      pages: { minWidth: 9, maxWidth: 46, pagesPerUnit: 24,
        heightBands: [[120, 104], [250, 120], [450, 136], [800, 152], [Infinity, 168]] }
    },

    // Colors for spines. Keys are looked up by genre, type or language
    // (the first language of a combined value like "EN/JA"); any value not
    // listed gets a stable color from `fallback` chosen by hashing it.
    palette: {
      genre: {
        'Literature (English & European)': '#2a78d6',
        'Japanese literature': '#eb6834',
        'Manga & comics': '#e87ba4',
        'Light novels': '#f2a83b',
        'Philosophy & political theory': '#4a3aa7',
        'Religion & theology': '#8a6d3b',
        'History & biography': '#7a6a58',
        'Art & visual culture': '#1baf7a',
        'Writing, film & literary craft': '#008a8a',
        'Language study & reference': '#e34948',
        'Math, CS & engineering': '#008300',
        'Science': '#2fa0c8',
        'Games & other objects': '#9a9087',
        'Unidentified': '#b8b0a6'
      },
      type: {
        'Fiction': '#2a78d6', 'Manga': '#e87ba4', 'Light novel': '#f2a83b', 'Anthology': '#8a6d3b',
        'Art': '#1baf7a', 'Poetry': '#eb6834', 'Philosophy': '#4a3aa7', 'Textbook': '#008300',
        'Reference': '#e34948', 'History': '#7a6a58', '?': '#b8b0a6'
      },
      language: {
        EN: '#2a78d6', JA: '#eb6834', DE: '#1baf7a', VI: '#eda100', IT: '#4a3aa7', LA: '#8a6d3b', '?': '#b8b0a6'
      },
      fallback: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948',
        '#008a8a', '#c26b1f', '#6b8e23', '#a0522d']
    }
  };

  var LANGUAGE_NAMES = {
    EN: 'English', JA: 'Japanese', DE: 'German', VI: 'Vietnamese', IT: 'Italian', LA: 'Latin',
    FR: 'French', ZH: 'Chinese', KO: 'Korean', ES: 'Spanish', RU: 'Russian', TH: 'Thai', '?': 'Unknown'
  };
  function languageName(code) {
    code = String(code || '').toUpperCase();
    return LANGUAGE_NAMES[code] ? LANGUAGE_NAMES[code] + (code === '?' ? '' : ' (' + code + ')') : code;
  }

  /* ------------------------------------------------------------------ */
  /* CSV parsing                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Parse CSV or TSV text into an array of objects keyed by header name.
   * Handles quoted fields, doubled quotes, embedded newlines, CRLF line
   * endings and a leading byte order mark. The delimiter is chosen by
   * counting tabs and commas in the header line, so a spreadsheet pasted as
   * TSV works without any option. Blank lines are skipped.
   */
  function parseCSV(text) {
    if (typeof text !== 'string') return [];
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    var firstLine = text.split(/\r?\n/, 1)[0] || '';
    var delimiter = countChar(firstLine, '\t') > countChar(firstLine, ',') ? '\t' : ',';

    var records = [];
    var field = '';
    var record = [];
    var inQuotes = false;
    var i = 0;
    var ch;

    while (i < text.length) {
      ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      // A quote opens a quoted field only at the start of the field.
      if (ch === '"' && field === '') { inQuotes = true; i++; continue; }
      if (ch === delimiter) { record.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') {
        record.push(field); field = '';
        records.push(record); record = [];
        i++; continue;
      }
      field += ch; i++;
    }
    if (field !== '' || record.length > 0) { record.push(field); records.push(record); }

    // Drop blank lines (a single empty field).
    records = records.filter(function (r) { return !(r.length === 1 && r[0].trim() === ''); });
    if (records.length === 0) return [];

    var header = records[0].map(function (h) { return h.trim(); });
    return records.slice(1).map(function (r) {
      var obj = {};
      header.forEach(function (name, idx) { obj[name] = r[idx] === undefined ? '' : r[idx]; });
      return obj;
    });
  }

  function countChar(s, c) {
    var n = 0;
    for (var i = 0; i < s.length; i++) if (s[i] === c) n++;
    return n;
  }

  /* ------------------------------------------------------------------ */
  /* Normalization                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Turn raw row objects into book records with fixed field names and typed
   * values. Numbers that are blank or unreadable become null. Every record
   * keeps the original row in `raw` so nothing is lost. Fields:
   *
   *   id, unit, shelf, position, title, author, publisher, language (as
   *   written, "EN/JA"), languages (split, ["EN", "JA"]), type, genre,
   *   status, confidence, notes, photo, photoFiles, leftNeighbor,
   *   rightNeighbor, yearText, year (integer or null), description,
   *   shelfDescription, pages (or null), sortTitle, isObject (Status "Not a
   *   book"), isUnread (Unreadable or Partial), raw
   */
  function normalizeRows(rows, config) {
    config = config || CONFIG;
    var cols = config.columns;
    var lookup = buildHeaderLookup(rows[0] || {});

    function cell(row, field) {
      var header = lookup[String(cols[field] || '').trim().toLowerCase()];
      var v = header === undefined ? '' : row[header];
      return v === undefined || v === null ? '' : String(v).trim();
    }

    return rows.map(function (row, index) {
      var id = cell(row, 'id');
      var status = cell(row, 'status');
      var language = cell(row, 'language');
      var yearText = cell(row, 'year');
      var yearParsed = toInt(cell(row, 'yearParsed'));
      return {
        id: id === '' ? 'row-' + (index + 1) : id,
        unit: cell(row, 'unit'),
        shelf: cell(row, 'shelf'),
        position: toInt(cell(row, 'position')),
        title: cell(row, 'title'),
        author: cell(row, 'author'),
        publisher: cell(row, 'publisher'),
        language: language,
        languages: splitLanguages(language),
        type: cell(row, 'type'),
        genre: cell(row, 'genre'),
        status: status,
        confidence: cell(row, 'confidence'),
        notes: cell(row, 'notes'),
        photo: cell(row, 'photo'),
        photoFiles: cell(row, 'photoFiles'),
        leftNeighbor: cell(row, 'leftNeighbor'),
        rightNeighbor: cell(row, 'rightNeighbor'),
        yearText: yearText,
        year: yearParsed !== null ? yearParsed : parseYear(yearText),
        description: cell(row, 'description'),
        shelfDescription: cell(row, 'shelfDescription'),
        pages: toInt(cell(row, 'pages')),
        sortTitle: cell(row, 'sortTitle'),
        isObject: status === config.status.object,
        isUnread: status === config.status.unreadable || status === config.status.partial,
        raw: row
      };
    });
  }

  // Map lowercased, trimmed header -> actual header key of the row objects.
  function buildHeaderLookup(sampleRow) {
    var lookup = {};
    Object.keys(sampleRow).forEach(function (k) { lookup[k.trim().toLowerCase()] = k; });
    return lookup;
  }

  function toInt(s) {
    if (s === '' || s === null || s === undefined) return null;
    var n = parseInt(String(s).replace(/[,\s]/g, ''), 10);
    return isNaN(n) ? null : n;
  }

  // "1989 (4th ed.)" -> 1989; "5th c. BC" -> null.
  function parseYear(text) {
    var m = /(?:^|\D)(\d{4})(?!\d)/.exec(String(text || ''));
    return m ? parseInt(m[1], 10) : null;
  }

  // "EN/JA" -> ["EN", "JA"]; "" -> []. Codes are upper-cased.
  function splitLanguages(value) {
    return String(value || '').split(/[\/,;+]/).map(function (s) { return s.trim().toUpperCase(); })
      .filter(function (s) { return s !== ''; });
  }

  /* ------------------------------------------------------------------ */
  /* Shelving order                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Sort key for the alphabetical order on the pine bookcase, as observed:
   *   1. Case and accents are ignored ("Số đỏ" files as "so do").
   *   2. A leading "The " is special: those titles form their own block that
   *      sits after every title starting with S and before every title
   *      starting with T. Within the block they order by the rest of the
   *      title. This is done by replacing "the " with the prefix "s{",
   *      because "{" sorts after "z" in code point order.
   *   3. No other article is special. "A History of Japan" files under A
   *      and "An Introduction to Zen Training" under A, exactly as written.
   *   4. Titles starting with a digit ("1984") sort before A.
   *   5. Titles in non-Latin scripts sort after all Latin titles, in code
   *      point order. Fill the optional sort_title column when the real
   *      shelf files a book by a keyword instead of its first word.
   */
  function titleSortKey(title) {
    var t = String(title || '').trim().toLowerCase();
    t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
    // Vietnamese đ is a separate letter, not a base letter plus accent.
    t = t.replace(/đ/g, 'd');
    var m = /^the\s+(.*)$/.exec(t);
    if (m) return 's{' + m[1];
    return t;
  }

  function compareTitles(a, b) {
    var ka = titleSortKey(a);
    var kb = titleSortKey(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  }

  // The title used for ordering: the optional sort_title wins when present.
  function orderingTitle(book) {
    return book.sortTitle ? book.sortTitle : book.title;
  }

  function sortKeyOf(book) {
    return titleSortKey(orderingTitle(book));
  }

  /** Return a new array of books in shelving order. Ties keep input order. */
  function sortForShelf(books) {
    return books
      .map(function (b, i) { return { b: b, i: i, k: sortKeyOf(b) }; })
      .sort(function (x, y) {
        if (x.k < y.k) return -1;
        if (x.k > y.k) return 1;
        return x.i - y.i;
      })
      .map(function (x) { return x.b; });
  }

  /**
   * Parse a letter-range shelf name into segments of the shelving order.
   *   "A to D"      -> [{ block: 'plain', from: 'a', to: 'd' }]
   *   "T-W"         -> [{ block: 'plain', from: 't', to: 'w' }]
   *   "The F-O"     -> [{ block: 'the', from: 'f', to: 'o' }]
   *   "S / The A-E" -> [{ plain s..s }, { the a..e }]
   * Each segment carries `lo` and `hi`: a title belongs to it when
   * lo <= sortKey < hi. Returns null when the name is not a letter range.
   */
  function parseShelfRange(shelf) {
    var parts = String(shelf || '').split('/');
    var segments = [];
    for (var i = 0; i < parts.length; i++) {
      var m = /^\s*(The\s+)?([A-Za-z])(?:\s*(?:to|-)\s*([A-Za-z]))?\s*$/.exec(parts[i]);
      if (!m) return null;
      var block = m[1] ? 'the' : 'plain';
      var from = m[2].toLowerCase();
      var to = (m[3] || m[2]).toLowerCase();
      segments.push({ block: block, from: from, to: to, lo: rangeLo(block, from), hi: rangeHi(block, to) });
    }
    return segments.length ? segments : null;
  }

  // Lower bound of the keys that start with `letter` in a block. A range
  // that starts at A also takes titles starting with a digit.
  function rangeLo(block, letter) {
    var prefix = block === 'the' ? 's{' : '';
    return letter === 'a' ? prefix : prefix + letter;
  }
  // Upper bound (exclusive). Plain S stops where the "The" block begins.
  function rangeHi(block, letter) {
    if (block === 'plain' && letter === 's') return 's{';
    return (block === 'the' ? 's{' : '') + letter + '￿';
  }

  /** Does a sort key fall inside one of the segments of a shelf range? */
  function keyInRange(key, segments) {
    for (var i = 0; i < segments.length; i++) {
      if (key >= segments[i].lo && key < segments[i].hi) return true;
    }
    return false;
  }
  function minKey(a, b) { return a < b ? a : b; }
  function maxKey(a, b) { return a > b ? a : b; }

  // Human wording for a segment: "A to D", "The F to The O".
  function describeRange(segments) {
    return segments.map(function (s) {
      var a = s.block === 'the' ? 'The ' + s.from.toUpperCase() : s.from.toUpperCase();
      var b = s.block === 'the' ? 'The ' + s.to.toUpperCase() : s.to.toUpperCase();
      return a === b ? a : a + ' to ' + b;
    }).join(' and ');
  }

  /** Is this book on a shelf that is alphabetized by title? */
  function isAlphabetizedShelf(book, config) {
    var rule = (config || CONFIG).alphabetized;
    if (!rule || !book || !book.shelf) return false;
    if (rule.unit && book.unit !== rule.unit) return false;
    if (rule.shelves instanceof RegExp) return rule.shelves.test(book.shelf);
    if (Array.isArray(rule.shelves)) return rule.shelves.indexOf(book.shelf) !== -1;
    return false;
  }

  function isHarvardShelf(book, config) {
    var rule = (config || CONFIG).harvardClassics;
    return !!rule && !!book.shelf && rule.shelves.test(book.shelf);
  }

  function harvardVolume(book, config) {
    var rule = (config || CONFIG).harvardClassics;
    var m = rule && rule.title.exec(book.title || '');
    return m ? parseInt(m[1], 10) : null;
  }

  /* ------------------------------------------------------------------ */
  /* Grouping                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Group books by unit and shelf, in the order they first appear in the
   * data. Returns [{ unit, shelf, key, description, books }]; inside each
   * group books are ordered by position, with missing positions at the
   * end. Books with no shelf go into a final group whose shelf is ''.
   */
  function groupByShelf(books) {
    var groups = [];
    var byKey = {};
    books.forEach(function (b) {
      var key = (b.unit || '') + '\u0000' + (b.shelf || '');
      var g = byKey[key];
      if (!g) {
        g = byKey[key] = { unit: b.unit || '', shelf: b.shelf || '', key: key, description: '', books: [] };
        groups.push(g);
      }
      if (!g.description && b.shelfDescription) g.description = b.shelfDescription;
      g.books.push(b);
    });
    groups.forEach(function (g) { g.books.sort(byPosition); });
    // Unshelved rows last.
    return groups.filter(function (g) { return g.shelf !== ''; })
      .concat(groups.filter(function (g) { return g.shelf === ''; }));
  }

  /** [{ unit, description, shelves: [groups] }] in order of first appearance. */
  function groupByUnit(books) {
    var units = [];
    var byUnit = {};
    groupByShelf(books).forEach(function (g) {
      var u = byUnit[g.unit];
      if (!u) {
        u = byUnit[g.unit] = { unit: g.unit, description: firstSentence(g.description), shelves: [] };
        units.push(u);
      }
      u.shelves.push(g);
    });
    return units;
  }

  // The first sentence of a shelf description usually names the bookcase.
  function firstSentence(text) {
    var m = /^(.*?[.。])(\s|$)/.exec(String(text || ''));
    return m ? m[1] : String(text || '');
  }

  function byPosition(a, b) {
    if (a.position === null && b.position === null) return 0;
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    return a.position - b.position;
  }

  /* ------------------------------------------------------------------ */
  /* Spines                                                              */
  /* ------------------------------------------------------------------ */

  /** Size band name for a book: 'small', 'medium', 'large' or 'object'. */
  function sizeBand(book, config) {
    var sp = (config || CONFIG).spine;
    if (book.isObject) return 'object';
    var band = sp.typeBands[book.type];
    if (!band && sp.bunkoPattern && sp.bunkoPattern.test(book.publisher || '')) band = 'small';
    return band || sp.defaultBand;
  }

  /**
   * Geometry for one spine. Width and height come from the size band of
   * the Type (or from the page count when a Pages column exists), with a
   * small deterministic variation per row so a shelf does not look like a
   * row of identical blocks. Color follows genre (default), type or
   * language. Returns { width, height, color, textColor, colorKey, band }.
   *
   * options.colorBy  'genre' | 'type' | 'language'
   * options.size     { width, height } to force exact dimensions
   * options.config   an alternative CONFIG
   */
  function spineGeometry(book, options) {
    options = options || {};
    var config = options.config || CONFIG;
    var sp = config.spine;
    var band = sizeBand(book, config);
    var width, height;

    if (options.size) {
      width = options.size.width;
      height = options.size.height;
    } else if (book.pages !== null && book.pages !== undefined && !book.isObject) {
      var pg = sp.pages;
      width = Math.max(pg.minWidth, Math.min(pg.maxWidth, Math.round(pg.minWidth + book.pages / pg.pagesPerUnit)));
      height = pg.heightBands[pg.heightBands.length - 1][1];
      for (var i = 0; i < pg.heightBands.length; i++) {
        if (book.pages <= pg.heightBands[i][0]) { height = pg.heightBands[i][1]; break; }
      }
    } else {
      var base = sp.bands[band];
      var j = band === 'object' || !sp.jitter ? 0 : ((hashString(String(book.id)) % 1000) / 1000 - 0.5) * 2 * sp.jitter;
      width = Math.round(base.width * (1 + j * 0.6));
      height = Math.round(base.height * (1 + j));
    }

    var colorBy = options.colorBy === 'type' || options.colorBy === 'language' ? options.colorBy : 'genre';
    var key = colorKeyOf(book, colorBy);
    var color = book.isObject ? '#b8b0a6' : book.isUnread ? '#d8d2c8' : colorFor(colorBy, key, config);

    return { width: width, height: height, color: color, textColor: inkFor(color), colorKey: key, band: band };
  }

  /** The value a book is colored by: its genre, type or first language. */
  function colorKeyOf(book, colorBy) {
    if (colorBy === 'language') return book.languages && book.languages.length ? book.languages[0] : '';
    return book[colorBy] || '';
  }

  /** Stable color for a genre, type or language value. */
  function colorFor(colorBy, value, config) {
    config = config || CONFIG;
    var table = config.palette[colorBy] || {};
    if (table[value]) return table[value];
    var fallback = config.palette.fallback;
    return fallback[hashString(value) % fallback.length];
  }

  // Small deterministic string hash (FNV-1a, 32 bit).
  function hashString(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h;
  }

  // White or near-black text depending on the fill's luminance.
  function inkFor(hex) {
    var c = hex.replace('#', '');
    var r = parseInt(c.slice(0, 2), 16) / 255;
    var g = parseInt(c.slice(2, 4), 16) / 255;
    var b = parseInt(c.slice(4, 6), 16) / 255;
    var lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return lum > 0.25 ? '#111111' : '#ffffff';
  }
  function lin(v) { return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(name, attrs) {
    var el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  /**
   * Draw one spine into `svgParent` with its bottom-left corner at (x, y).
   * The title runs down the spine (rotated 90 degrees, top to bottom, the
   * way English spines read on a shelf). A row with Status "Not a book" is
   * drawn as a small grey box; an Unreadable or Partial row as a dashed
   * grey spine with a question mark. Returns the <g> element, which carries
   * data-id, data-shelf and data-position attributes and the classes
   * "spine", "object" and "unread" for styling.
   *
   * options:
   *   colorBy   'genre' | 'type' | 'language'
   *   size      { width, height } to force exact dimensions
   *   fontSize  in user units (default 10)
   *   onClick   function(book, event)
   *   config    an alternative CONFIG
   */
  function drawSpine(svgParent, book, x, y, options) {
    options = options || {};
    var geo = spineGeometry(book, options);
    var fontSize = options.fontSize || 10;
    var top = y - geo.height;

    var cls = 'spine' + (book.isObject ? ' object' : '') + (book.isUnread ? ' unread' : '');
    var g = svgEl('g', { 'class': cls, 'data-id': book.id });
    if (book.shelf) g.setAttribute('data-shelf', book.shelf);
    if (book.position !== null) g.setAttribute('data-position', book.position);

    if (book.isObject) {
      g.appendChild(svgEl('rect', { x: x, y: top, width: geo.width, height: geo.height, rx: 2, fill: geo.color, stroke: '#8f867c', 'stroke-width': 1 }));
    } else if (book.isUnread) {
      g.appendChild(svgEl('rect', {
        x: x + 0.75, y: top + 0.75, width: geo.width - 1.5, height: geo.height - 1.5, rx: 1.5,
        fill: geo.color, stroke: '#8f867c', 'stroke-width': 1.5, 'stroke-dasharray': '4 3'
      }));
      var q = svgEl('text', {
        x: x + geo.width / 2, y: top + geo.height / 2, 'font-size': Math.min(geo.width * 0.9, fontSize * 1.6),
        fill: '#6b625a', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-weight': 'bold'
      });
      q.textContent = '?';
      g.appendChild(q);
    } else {
      g.appendChild(svgEl('rect', { x: x, y: top, width: geo.width, height: geo.height, rx: 1.5, fill: geo.color }));
      // A slightly darker strip on the left edge suggests the spine's curve.
      g.appendChild(svgEl('rect', {
        x: x, y: top, width: Math.max(1, geo.width * 0.12), height: geo.height, fill: '#000', opacity: 0.18
      }));
      var pad = 6;
      var label = fitText(book.title, geo.height - pad * 2, fontSize);
      var text = svgEl('text', {
        transform: 'translate(' + (x + geo.width / 2) + ' ' + (top + pad) + ') rotate(90)',
        'font-size': fontSize,
        fill: geo.textColor,
        'dominant-baseline': 'central'
      });
      text.textContent = label;
      g.appendChild(text);
    }

    var tip = svgEl('title');
    tip.textContent = book.title + (book.author ? ' / ' + book.author : '') + (book.status && book.status !== 'OK' ? ' [' + book.status + ']' : '');
    g.appendChild(tip);

    if (typeof options.onClick === 'function') {
      g.style.cursor = 'pointer';
      g.addEventListener('click', function (ev) { options.onClick(book, ev); });
    }

    svgParent.appendChild(g);
    return g;
  }

  // Shorten a title so its estimated width fits in `maxLength` user units.
  // CJK characters are counted as square (one em); others as 0.56 em.
  function fitText(title, maxLength, fontSize) {
    var s = String(title || '');
    var total = 0;
    for (var i = 0; i < s.length; i++) {
      var w = isWide(s.charCodeAt(i)) ? fontSize : fontSize * 0.56;
      if (total + w > maxLength - fontSize * 0.8) return s.slice(0, Math.max(0, i - 1)).replace(/\s+$/, '') + '…';
      total += w;
    }
    return s;
  }

  function isWide(code) {
    return (code >= 0x1100 && code <= 0x115F) || (code >= 0x2E80 && code <= 0xA4CF) ||
      (code >= 0xAC00 && code <= 0xD7A3) || (code >= 0xF900 && code <= 0xFAFF) ||
      (code >= 0xFE30 && code <= 0xFE4F) || (code >= 0xFF00 && code <= 0xFF60) ||
      (code >= 0xFFE0 && code <= 0xFFE6);
  }

  /* ------------------------------------------------------------------ */
  /* Integrity checks                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Look for catalog problems. Returns an array of findings, each
   *   { kind, message, book }
   * where `book` is the record the finding is attached to (null for a
   * finding with no single book). Kinds, in the order they are produced:
   *   missing-title       no title
   *   missing-shelf       no unit or shelf
   *   missing-position    on a shelf but no position
   *   duplicate-id        the same id appears twice
   *   duplicate-position  two rows claim the same position on one shelf
   *   position-gap        positions on a shelf do not run 1, 2, 3, ...
   *   out-of-order        breaks the alphabetical order on an alphabetized
   *                       shelf (only rows with Status OK are compared)
   *   outside-range       a book whose first letter is not in the letter
   *                       range of its shelf name
   *   hc-order            Harvard Classics volumes not in numeric order
   *   hc-duplicate        the same volume number twice on the HC shelves
   *   hc-missing          volumes of 1..51 absent from the HC shelves
   *   second-look         Unreadable, Partial or Low confidence rows
   *   possible-duplicate  the same title in more than one place
   */
  function integrityChecks(books, config) {
    config = config || CONFIG;
    var findings = [];
    function add(kind, message, book) { findings.push({ kind: kind, message: message, book: book }); }

    var seenIds = {};
    books.forEach(function (b) {
      if (!b.title) add('missing-title', 'Row ' + b.id + ' (' + place(b) + ') has no title.', b);
      if (seenIds[b.id]) add('duplicate-id', 'Id "' + b.id + '" is used more than once (' + short(b) + ').', b);
      seenIds[b.id] = true;
      if (!b.shelf) add('missing-shelf', short(b) + ' has no shelf.', b);
      else if (b.position === null) add('missing-position', short(b) + ' is on ' + place(b) + ' but has no position.', b);
    });

    var groups = groupByShelf(books);
    groups.forEach(function (group) {
      if (group.shelf === '') return;
      var placed = group.books.filter(function (b) { return b.position !== null; });

      // Duplicate positions: report every row after the first at a position.
      var atPosition = {};
      placed.forEach(function (b) {
        if (atPosition[b.position]) {
          add('duplicate-position', short(b) + ' and ' + short(atPosition[b.position]) +
            ' both claim ' + place(b) + '.', b);
        } else {
          atPosition[b.position] = b;
        }
      });

      // Gaps: positions should run 1..n with nothing skipped.
      var expected = 1;
      var positions = Object.keys(atPosition).map(Number).sort(function (a, b) { return a - b; });
      for (var i = 0; i < positions.length; i++) {
        if (positions[i] > expected) {
          var missing = positions[i] - expected === 1 ? 'position ' + expected :
            'positions ' + expected + ' to ' + (positions[i] - 1);
          add('position-gap', shelfName(group) + ' skips ' + missing + ' (next item is ' +
            short(atPosition[positions[i]]) + ').', atPosition[positions[i]]);
        }
        expected = positions[i] + 1;
      }
    });

    checkAlphabetical(groups, config, add);
    checkHarvardClassics(groups, config, add);

    // Rows worth a second look at the shelf: unreadable, partial, low confidence.
    books.forEach(function (b) {
      var reasons = [];
      if (b.isUnread) reasons.push(b.status.toLowerCase());
      if (b.confidence === config.lowConfidence) reasons.push('low confidence');
      if (!reasons.length) return;
      add('second-look', place(b) + ': ' + short(b) + ', ' + reasons.join(', ') + '.' +
        (b.notes ? ' Notes: ' + b.notes : ''), b);
    });

    // Possible duplicates: the same title (case and accents ignored) in
    // more than one place. Objects and unread rows are skipped because
    // their titles are descriptions.
    var byTitle = {};
    books.forEach(function (b) {
      if (!b.title || b.isObject || b.isUnread) return;
      var k = titleSortKey(b.title);
      (byTitle[k] = byTitle[k] || []).push(b);
    });
    Object.keys(byTitle).forEach(function (k) {
      var list = byTitle[k];
      if (list.length < 2) return;
      add('possible-duplicate', short(list[0]) + ' appears ' + list.length + ' times: ' +
        list.map(function (b) { return place(b); }).join('; ') + '.', list[0]);
    });

    return findings;
  }

  // Alphabetical order and letter ranges on the alphabetized shelves.
  function checkAlphabetical(groups, config, add) {
    var alpha = groups.filter(function (g) { return g.books.length && isAlphabetizedShelf(g.books[0], config); });
    alpha.forEach(function (group, gi) {
      // Only identified books take part: objects and unread rows have
      // descriptions instead of titles.
      var seq = group.books.filter(function (b) { return b.position !== null && !b.isObject && !b.isUnread && b.title; });
      var keys = seq.map(sortKeyOf);

      // (a) Order: books not in the longest non-decreasing run are the
      // ones out of place, so a single misfiled book gives one finding.
      var keep = longestNonDecreasing(keys);
      seq.forEach(function (b, i) {
        if (keep[i]) return;
        var before = null, after = null, j;
        for (j = i - 1; j >= 0; j--) if (keep[j]) { before = seq[j]; break; }
        for (j = i + 1; j < seq.length; j++) if (keep[j]) { after = seq[j]; break; }
        var where = before && keys[i] < keys[seq.indexOf(before)] ?
          'files before ' + short(before) + ' (position ' + before.position + ')' :
          'files after ' + short(after) + ' (position ' + after.position + ')';
        add('out-of-order', short(b) + ' at ' + place(b) + ' is out of order: it ' + where + '.' +
          (/^the\s/i.test(orderingTitle(b)) ? ' Titles starting with "The" sit after S.' : ''), b);
      });

      // (b) Letter range from the shelf name. Consecutive names overlap
      // ("D to I", "H to L") or leave a gap ("The P-T" is followed by
      // "T-W", so The U to The Z are on T-W), and a run spills from the
      // end of one shelf to the start of the next. The span accepted for
      // a shelf therefore runs from the end letter of the previous shelf
      // (or its own start) to the start letter of the next shelf (or its
      // own end), taking neighbors in the same unit in data order.
      var segments = parseShelfRange(group.shelf);
      if (!segments) return;
      var prev = gi > 0 && alpha[gi - 1].unit === group.unit ? parseShelfRange(alpha[gi - 1].shelf) : null;
      var next = gi < alpha.length - 1 && alpha[gi + 1].unit === group.unit ? parseShelfRange(alpha[gi + 1].shelf) : null;
      var lo = segments[0].lo, hi = segments[segments.length - 1].hi;
      if (prev) {
        var pl = prev[prev.length - 1];
        lo = minKey(lo, rangeLo(pl.block, pl.to));
      }
      if (next) {
        var nf = next[0];
        hi = maxKey(hi, rangeHi(nf.block, nf.from));
      }
      seq.forEach(function (b, i) {
        if (keys[i] >= lo && keys[i] < hi) return;
        add('outside-range', short(b) + ' at ' + place(b) + ' starts outside ' + describeRange(segments) +
          (b.sortTitle ? ' (sort_title "' + b.sortTitle + '").' : '. If it is filed by a keyword, put that keyword in sort_title.'), b);
      });
    });
  }

  // Boolean mask of a longest non-decreasing subsequence (O(n^2), n is small).
  function longestNonDecreasing(keys) {
    var n = keys.length, len = [], prev = [], best = -1, i, j;
    for (i = 0; i < n; i++) {
      len[i] = 1; prev[i] = -1;
      for (j = 0; j < i; j++) {
        if (keys[j] <= keys[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
      }
      if (best < 0 || len[i] > len[best]) best = i;
    }
    var keep = keys.map(function () { return false; });
    for (i = best; i >= 0; i = prev[i]) keep[i] = true;
    return keep;
  }

  // Harvard Classics: numeric order across the HC shelves, and missing volumes.
  function checkHarvardClassics(groups, config, add) {
    var rule = config.harvardClassics;
    if (!rule) return;
    var seq = [];
    groups.forEach(function (g) {
      if (!g.books.length || !isHarvardShelf(g.books[0], config)) return;
      g.books.forEach(function (b) {
        if (b.isObject || b.isUnread) return;
        var v = harvardVolume(b, config);
        if (v !== null) seq.push({ book: b, volume: v });
      });
    });
    if (!seq.length) return;
    var keep = longestNonDecreasing(seq.map(function (s) { return s.volume; }));
    seq.forEach(function (s, i) {
      if (!keep[i]) add('hc-order', 'Harvard Classics volume ' + s.volume + ' at ' + place(s.book) + ' is out of numeric order.', s.book);
    });
    var present = {};
    seq.forEach(function (s) {
      if (present[s.volume]) add('hc-duplicate', 'Harvard Classics volume ' + s.volume + ' appears twice (' + place(present[s.volume]) + ' and ' + place(s.book) + ').', s.book);
      else present[s.volume] = s.book;
    });
    var missing = [];
    for (var v = 1; v <= rule.volumes; v++) if (!present[v]) missing.push(v);
    if (missing.length) {
      add('hc-missing', 'Harvard Classics ' + (missing.length === 1 ? 'volume ' : 'volumes ') + listNumbers(missing) +
        ' ' + (missing.length === 1 ? 'is' : 'are') + ' not on the HC shelves.', null);
    }
  }

  // "8, 9, 13 to 19" for a sorted list of integers.
  function listNumbers(nums) {
    var parts = [], start = nums[0], prev = nums[0];
    for (var i = 1; i <= nums.length; i++) {
      if (i < nums.length && nums[i] === prev + 1) { prev = nums[i]; continue; }
      parts.push(start === prev ? String(start) : start + ' to ' + prev);
      start = prev = nums[i];
    }
    return parts.join(', ');
  }

  function short(book) {
    return '"' + (book.title || 'untitled') + '"';
  }
  function shelfName(group) {
    return (group.unit ? 'Unit ' + group.unit + ', ' : '') + 'shelf ' + group.shelf;
  }
  // "Unit K, shelf T-W, position 12"
  function place(book) {
    var s = book.unit ? 'Unit ' + book.unit : '';
    if (book.shelf) s += (s ? ', ' : '') + 'shelf ' + book.shelf;
    if (book.position !== null) s += (s ? ', ' : '') + 'position ' + book.position;
    return s || 'no location';
  }

  /* ------------------------------------------------------------------ */
  /* Stats                                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Counts for the dashboard. Each list is [{ label, count }] sorted by
   * count (or by label for decades). Objects (Status "Not a book") are
   * left out of everything except `statuses` and `confidences`.
   *   { total, objects, books, authors, languages, decades, genres, types,
   *     statuses, confidences, withYear }
   */
  function stats(rows) {
    var books = rows.filter(function (b) { return !b.isObject; });
    function tally(list, getKeys) {
      var counts = {};
      list.forEach(function (b) {
        var ks = getKeys(b);
        if (!Array.isArray(ks)) ks = [ks];
        ks.forEach(function (k) {
          if (k === null || k === undefined || k === '') return;
          counts[k] = (counts[k] || 0) + 1;
        });
      });
      return Object.keys(counts).map(function (k) { return { label: k, count: counts[k] }; });
    }
    function byCount(a, b) { return b.count - a.count || (a.label < b.label ? -1 : 1); }

    var decades = tally(books, function (b) { return b.year === null ? null : Math.floor(b.year / 10) * 10; })
      .map(function (d) { return { label: d.label + 's', decade: Number(d.label), count: d.count }; })
      .sort(function (a, b) { return a.decade - b.decade; });

    return {
      total: rows.length,
      objects: rows.length - books.length,
      books: books.length,
      withYear: books.filter(function (b) { return b.year !== null; }).length,
      authors: tally(books, function (b) { return b.author === '?' ? null : b.author; }).sort(byCount),
      languages: tally(books, function (b) { return b.languages; }).sort(byCount),
      decades: decades,
      genres: tally(books, function (b) { return b.genre; }).sort(byCount),
      types: tally(books, function (b) { return b.type; }).sort(byCount),
      statuses: tally(rows, function (b) { return b.status || 'blank'; }).sort(byCount),
      confidences: tally(rows, function (b) { return b.confidence || 'blank'; }).sort(byCount)
    };
  }

  /* ------------------------------------------------------------------ */
  /* Words                                                               */
  /* ------------------------------------------------------------------ */

  var ORDINALS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth',
    'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth',
    'seventeenth', 'eighteenth', 'nineteenth', 'twentieth'];
  var TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  var TENS_ORD = ['', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth', 'seventieth', 'eightieth', 'ninetieth'];

  /** 5 -> "fifth", 23 -> "twenty-third". Falls back to "101st" past 99. */
  function ordinalWords(n) {
    if (n === null || n === undefined || isNaN(n)) return '';
    if (n <= 20) return ORDINALS[n];
    if (n < 100) {
      var tens = Math.floor(n / 10), ones = n % 10;
      return ones === 0 ? TENS_ORD[tens] : TENS[tens] + '-' + ORDINALS[ones];
    }
    var s = String(n), last2 = n % 100, last = n % 10;
    var suffix = (last2 >= 11 && last2 <= 13) ? 'th' : last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th';
    return s + suffix;
  }

  // A neighbor cell that is a sentinel rather than a title.
  function isShelfEdge(neighbor) {
    return /^\(shelf (start|end)\)$/i.test(String(neighbor || '').trim());
  }

  /**
   * Where a book sits, in words, using the neighbor columns:
   * "Unit K, shelf T-W, position 12 (twelfth from the left), between
   * "They Say / I Say" and "This Is Your Brain on Music"."
   */
  function describeLocation(book, config) {
    config = config || CONFIG;
    if (!book.shelf) return 'No shelf recorded.';
    var s = place(book);
    if (book.position !== null) s += ' (' + ordinalWords(book.position) + ' from the left)';
    var left = book.leftNeighbor, right = book.rightNeighbor;
    var leftEdge = !left || isShelfEdge(left), rightEdge = !right || isShelfEdge(right);
    if (!leftEdge && !rightEdge) s += ', between "' + left + '" and "' + right + '"';
    else if (leftEdge && !rightEdge) s += ', at the left end, before "' + right + '"';
    else if (!leftEdge && rightEdge) s += ', at the right end, after "' + left + '"';
    else if (book.position === null) s += ', position not recorded';
    s += '.';
    if (isAlphabetizedShelf(book, config)) s += ' This shelf is alphabetized by title.';
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* Loading                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Fetch a CSV by URL and return a promise of normalized books. Rejects
   * when the fetch fails (for example on a file:// origin), so callers can
   * fall back to the next file or a file picker.
   */
  function loadCatalog(url, config) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
      return res.text();
    }).then(function (text) {
      var rows = parseCSV(text);
      if (!rows.length) throw new Error('No rows in ' + url);
      return normalizeRows(rows, config);
    });
  }

  /**
   * The list of catalog files to try, in order, for a page in another
   * folder: catalogUrls('../01-virtual-library/'). A `?catalog=sample`
   * query on the page skips the real export; `?catalog=<url>` names a file.
   */
  function catalogUrls(prefix, config) {
    config = config || CONFIG;
    prefix = prefix || '';
    var forced = null;
    try { forced = new URLSearchParams(window.location.search).get('catalog'); } catch (e) { forced = null; }
    if (forced === 'sample') return [prefix + config.catalogUrls[config.catalogUrls.length - 1]];
    if (forced) return [forced];
    return config.catalogUrls.map(function (u) { return prefix + u; });
  }

  /**
   * Try each URL in turn; resolves with { books, url } for the first one
   * that loads, rejects with the last error when none does.
   */
  function loadFirstCatalog(urls, config) {
    var i = 0;
    function next(lastErr) {
      if (i >= urls.length) return Promise.reject(lastErr || new Error('No catalog file to load.'));
      var url = urls[i++];
      return loadCatalog(url, config).then(function (books) { return { books: books, url: url }; }, next);
    }
    return next(null);
  }

  return {
    CONFIG: CONFIG,
    LANGUAGE_NAMES: LANGUAGE_NAMES,
    languageName: languageName,
    parseCSV: parseCSV,
    normalizeRows: normalizeRows,
    splitLanguages: splitLanguages,
    parseYear: parseYear,
    titleSortKey: titleSortKey,
    compareTitles: compareTitles,
    sortKeyOf: sortKeyOf,
    sortForShelf: sortForShelf,
    parseShelfRange: parseShelfRange,
    keyInRange: keyInRange,
    describeRange: describeRange,
    isAlphabetizedShelf: isAlphabetizedShelf,
    isHarvardShelf: isHarvardShelf,
    harvardVolume: harvardVolume,
    groupByShelf: groupByShelf,
    groupByUnit: groupByUnit,
    sizeBand: sizeBand,
    spineGeometry: spineGeometry,
    colorKeyOf: colorKeyOf,
    colorFor: colorFor,
    drawSpine: drawSpine,
    integrityChecks: integrityChecks,
    stats: stats,
    ordinalWords: ordinalWords,
    describeLocation: describeLocation,
    placeOf: place,
    loadCatalog: loadCatalog,
    catalogUrls: catalogUrls,
    loadFirstCatalog: loadFirstCatalog
  };
})();
