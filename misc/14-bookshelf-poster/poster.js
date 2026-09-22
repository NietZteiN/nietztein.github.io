/*
 * poster.js
 *
 * Layout and rendering for the bookshelf poster (project 14). The catalog
 * helpers come from project 1: this file expects the global `Library` from
 * ../01-virtual-library/library.js to be loaded first and uses its parsing,
 * shelf grouping and spineGeometry. Everything here is about the poster:
 * paper sizes, palettes, fonts, fitting the shelves to the page, drawing
 * spines with rotated text, and exporting the result as SVG or PNG.
 *
 * Defines one global, `Poster`, with:
 *   PAPERS, PALETTES, FONTS   the option tables shown in the sidebar
 *   render(books, options)     returns a standalone <svg> element in mm
 *   serialize(svg)             the SVG as a standalone XML document string
 *   toPNG(svg, dpi)            promise of { blob, width, height }
 *
 * Coordinates: the SVG viewBox is the paper in millimetres, so header and
 * footer are laid out in mm. The shelf block is laid out in "spine units"
 * (the units Library.spineGeometry uses, where a medium book is 132 tall)
 * and then scaled with a single transform so that it fills the space left
 * between header and footer. The scale is found by a binary search over
 * the wrapping, so any number of books fills the chosen paper.
 *
 * Shelves are grouped by unit (bookcase): each unit starts a new row and
 * carries its letter as a small label; each shelf hangs its name on a pink
 * sticky note. Rows with Status "Not a book" are left out; Unreadable and
 * Partial rows are drawn as grey spines with a question mark.
 */
var Poster = (function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* ------------------------------------------------------------------ */
  /* Option tables                                                       */
  /* ------------------------------------------------------------------ */

  // Paper sizes in mm, portrait. Orientation swaps width and height.
  var PAPERS = {
    a2: { label: 'A2 (420 x 594 mm)', width: 420, height: 594 },
    a1: { label: 'A1 (594 x 841 mm)', width: 594, height: 841 },
    a0: { label: 'A0 (841 x 1189 mm)', width: 841, height: 1189 },
    arch: { label: '24 x 36 in (609.6 x 914.4 mm)', width: 609.6, height: 914.4 },
    custom: { label: 'Custom', width: 500, height: 700 }
  };

  // Each palette: paper and text colors, the wood of the bookcase, the pink
  // sticky note, and ten spine colors handed out to genres (or types, or languages)
  // in order of frequency. darkInk and lightInk are the two possible text
  // colors on a spine; the one with more contrast against the fill is used.
  var PALETTES = {
    pastel: {
      label: 'Muted pastels',
      paper: '#f7f3ec', ink: '#3b3733', muted: '#8a837a', rule: '#c9c1b4',
      board: '#dccbb2', boardEdge: '#b89f7f', frame: '#cbb391', shadow: '#000000',
      tag: '#f9b4cc', tagInk: '#7a2d4c',
      darkInk: '#2f2a26', lightInk: '#fbf7f0',
      spines: ['#e5b0b5', '#a9c4b3', '#a7bfd9', '#e8d59a', '#c3b3d6', '#efc2a0', '#b5d4c9', '#d3a58c', '#a9b4be', '#d9cd9f']
    },
    ink: {
      label: 'Ink on cream',
      paper: '#f3ead6', ink: '#2a2521', muted: '#7d7263', rule: '#c9bb9c',
      board: '#d8c8a6', boardEdge: '#a8916a', frame: '#c2ac83', shadow: '#000000',
      tag: '#f4a9c2', tagInk: '#6b2340',
      darkInk: '#2a2521', lightInk: '#f3ead6',
      spines: ['#1f2a44', '#3d2b2b', '#24423a', '#463659', '#2b2b2f', '#5a3426', '#2f4658', '#5b4b1e', '#1c3b45', '#6b2a35']
    },
    jewel: {
      label: 'Deep jewel tones',
      paper: '#16141d', ink: '#efe8d8', muted: '#9a9285', rule: '#4a4556',
      board: '#3a2a24', boardEdge: '#1f1512', frame: '#2c1f1a', shadow: '#000000',
      tag: '#f6a3c1', tagInk: '#5e1c38',
      darkInk: '#16141d', lightInk: '#f4eee2',
      spines: ['#0f7a5c', '#1f4e9a', '#9c1f3d', '#5c3a8c', '#c98a1b', '#7f1f2c', '#2c8f7f', '#c7a02a', '#8a3f8f', '#274e6b']
    }
  };

  // Font stacks. They are written into the SVG as font-family attributes,
  // so a viewer without the first name falls through the list. Each stack
  // ends with a Japanese family so kanji titles render upright and clean.
  var FONTS = {
    serif: {
      label: 'Serif (Georgia)',
      family: "Georgia, 'Palatino Linotype', 'Book Antiqua', 'Noto Serif', 'Liberation Serif', 'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif CJK JP', serif"
    },
    sans: {
      label: 'Sans (Helvetica)',
      family: "'Helvetica Neue', Helvetica, Arial, 'Noto Sans', 'Liberation Sans', 'Hiragino Sans', 'Yu Gothic', 'Noto Sans CJK JP', sans-serif"
    },
    mono: {
      label: 'Mono (Menlo)',
      family: "Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', 'Noto Sans Mono CJK JP', monospace"
    }
  };

  // Proportions of the shelf block, in spine units. Only ratios matter
  // because the whole block is scaled to the paper.
  var U = {
    minWidth: 13,        // narrowest spine, wide enough for one line of text
    maxWidth: 42,
    widthExtra: 3,       // added to Library.spineGeometry's width so text fits
    board: 7,            // thickness of a shelf board and of the top rail
    frame: 6,            // thickness of the side panels
    innerPad: 10,        // space between a side panel and the first book
    shelfGap: 30,        // space between two shelves on the same row
    rowGap: 36,          // clearance above the tallest book in a row (unit labels sit here)
    maxRowGap: 64,       // rows are spread out at most this much to fill the page
    tag: 15,             // height of the pink sticky note; its width follows the shelf name
    tagMaxWidth: 96,     // longer shelf names are shortened with an ellipsis
    unitLabel: 9,        // font size of the unit label
    pad: 6,              // space between the top of a spine and its text
    heightJitter: 0.08,  // +/- 4 percent of the band height
    leanChance: 0.07,    // share of books that lean on their neighbor
    leanMin: 5,          // degrees
    leanMax: 9
  };

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  // Deterministic random numbers (mulberry32), so a seed always gives the
  // same wobble.
  function makeRandom(seed) {
    var a = (Number(seed) || 0) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }
  function round(v) { return Math.round(v * 100) / 100; }

  function hexToRgb(hex) {
    var c = hex.replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
  }
  function rgbToHex(rgb) {
    return '#' + rgb.map(function (v) {
      v = Math.max(0, Math.min(255, Math.round(v)));
      return (v < 16 ? '0' : '') + v.toString(16);
    }).join('');
  }
  // Mix `t` (0 to 1) of color b into color a.
  function mix(a, b, t) {
    var ra = hexToRgb(a), rb = hexToRgb(b);
    return rgbToHex(ra.map(function (v, i) { return v + (rb[i] - v) * t; }));
  }
  function luminance(hex) {
    var rgb = hexToRgb(hex).map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }
  function inkFor(fill, palette) {
    return luminance(fill) > 0.3 ? palette.darkInk : palette.lightInk;
  }

  var CJK = /[⺀-鿿가-힯豈-﫿＀-￯]/;
  function hasCJK(s) { return CJK.test(String(s || '')); }

  function el(name, attrs, parent) {
    var node = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(node);
    return node;
  }
  function textEl(parent, str, attrs) {
    var t = el('text', attrs, parent);
    t.textContent = str;
    return t;
  }

  function formatNumber(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  /* ------------------------------------------------------------------ */
  /* Text measurement                                                    */
  /* ------------------------------------------------------------------ */

  // Measures text with a canvas in the chosen font so titles are cut to fit
  // their spine. The width is padded by four percent because the file may
  // be opened where the same font is not installed. Without a canvas (for
  // example in a test harness) a per-character estimate is used.
  function makeMeasurer(family) {
    var ctx = null;
    try { ctx = document.createElement('canvas').getContext('2d'); } catch (e) { ctx = null; }
    return function measure(text, size, weight, letterSpacing) {
      var s = String(text || '');
      var w = 0;
      if (ctx) {
        ctx.font = (weight || 'normal') + ' ' + size + 'px ' + family;
        w = ctx.measureText(s).width;
      } else {
        for (var i = 0; i < s.length; i++) w += CJK.test(s[i]) ? size : size * 0.56;
      }
      if (letterSpacing) w += letterSpacing * s.length;
      return w * 1.04;
    };
  }

  // Length of text set vertically: one upright glyph per line, so every
  // character (CJK or not) advances by about one em.
  function verticalLength(text, size) {
    return Array.from(String(text || '')).length * size * 1.02;
  }

  // Cut `text` so that `lengthOf(text)` is at most maxLength, adding an
  // ellipsis when something was removed. Returns '' if not even one
  // character fits.
  function fitText(text, maxLength, lengthOf) {
    var s = String(text || '').trim();
    if (lengthOf(s) <= maxLength) return s;
    var lo = 0, hi = s.length;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      if (lengthOf(s.slice(0, mid).replace(/\s+$/, '') + '…') <= maxLength) lo = mid; else hi = mid - 1;
    }
    return lo === 0 ? '' : s.slice(0, lo).replace(/\s+$/, '') + '…';
  }

  /* ------------------------------------------------------------------ */
  /* Colors for genres, types or languages                               */
  /* ------------------------------------------------------------------ */

  // Hand the palette's spine colors to the values of `colorBy` in order of
  // frequency, so the most common genre gets the first color. Past ten
  // values the colors repeat, shifted toward the ink or the paper. Unread
  // rows are not counted: they are drawn grey.
  function assignColors(books, colorBy, palette) {
    var counts = {};
    books.forEach(function (b) {
      if (b.isUnread) return;
      var k = Library.colorKeyOf(b, colorBy);
      counts[k] = (counts[k] || 0) + 1;
    });
    var keys = Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || (a < b ? -1 : a > b ? 1 : 0);
    });
    var map = {};
    var entries = keys.map(function (k, i) {
      var base = palette.spines[i % palette.spines.length];
      var cycle = Math.floor(i / palette.spines.length);
      var color = cycle === 0 ? base : mix(base, cycle % 2 ? palette.ink : palette.paper, 0.3);
      map[k] = color;
      return { key: k, label: labelFor(colorBy, k), count: counts[k], color: color };
    });
    return { map: map, entries: entries };
  }

  function labelFor(colorBy, key) {
    if (!key) return 'No ' + colorBy;
    if (colorBy === 'language') return Library.languageName(key);
    return key;
  }

  /* ------------------------------------------------------------------ */
  /* Shelf layout in spine units                                         */
  /* ------------------------------------------------------------------ */

  // Give every book its size, color and wobble. Uses Library.spineGeometry
  // for the size band (from the Type column, or the page count when there
  // is one) and the color key; the width gets a little extra so the
  // thinnest spine still carries a line of text. Objects are skipped.
  function prepareShelves(units, options, colors, palette, random) {
    var shelves = [];
    units.forEach(function (unit) {
      unit.shelves.forEach(function (group, i) {
        var books = group.books.filter(function (b) { return !b.isObject; });
        if (!books.length) return;
        var items = books.map(function (book) {
          var geo = Library.spineGeometry(book, { colorBy: options.colorBy });
          var width = clamp(U.minWidth, U.maxWidth, geo.width + U.widthExtra);
          var jitter = (random() - 0.5) * U.heightJitter;
          var toward = random() < 0.5 ? '#000000' : '#ffffff';
          var amount = random() * 0.06;
          var bands = !book.isUnread && random() < 0.4;
          var leans = !book.isUnread && random() < U.leanChance;
          var angle = U.leanMin + random() * (U.leanMax - U.leanMin);
          var fill = book.isUnread ? mix(palette.paper, palette.ink, 0.22) : mix(colors.map[geo.colorKey], toward, amount);
          return {
            book: book,
            width: width,
            height: round(geo.height * (1 + jitter)),
            fill: fill,
            ink: inkFor(fill, palette),
            bands: bands,
            lean: leans ? round(angle) : 0
          };
        });
        // A book can lean only onto an upright neighbor that is about as tall.
        items.forEach(function (item, j) {
          var next = items[j + 1];
          if (item.lean && (!next || next.lean || next.height < item.height - 3)) item.lean = 0;
        });
        shelves.push({ unit: unit.unit, unitDescription: unit.description, unitStart: shelves.length === 0 || shelves[shelves.length - 1].unit !== unit.unit, shelf: group.shelf, items: items });
      });
    });
    return shelves;
  }

  // Horizontal space a book takes: a leaning book's top rests on the next
  // book, so it needs width * cos + height * sin.
  function stride(item, lean) {
    if (!lean) return item.width;
    var a = lean * Math.PI / 180;
    return item.width * Math.cos(a) + item.height * Math.sin(a);
  }

  // Width of items[from..to) as a segment: the last book never leans.
  function segmentWidth(items, from, to) {
    var w = 0;
    for (var i = from; i < to; i++) w += stride(items[i], i === to - 1 ? 0 : items[i].lean);
    return w;
  }

  // How many books from `from` fit in `space`.
  function countFit(items, from, space) {
    var n = 0;
    while (from + n < items.length && segmentWidth(items, from, from + n + 1) <= space) n++;
    return n;
  }

  // Greedy wrapping of shelves into rows of at most `availWidth` units.
  // A shelf stays whole when it fits on a row; only a shelf wider than an
  // entire row is split, and the continuation gets a marked tag. Every
  // unit starts a new row, and that row carries the unit label.
  function wrapRows(shelves, availWidth) {
    var rows = [];
    var row;
    function newRow(unit) { row = { segments: [], width: 0, unit: unit || null }; rows.push(row); }
    newRow(null);
    shelves.forEach(function (shelf) {
      var items = shelf.items;
      var index = 0;
      var continued = false;
      if (shelf.unitStart) {
        if (row.segments.length) newRow(shelf);
        row.unit = shelf;
      }
      while (index < items.length) {
        var gap = row.segments.length ? U.shelfGap : 0;
        var remaining = availWidth - row.width - gap;
        var fitsWhole = segmentWidth(items, index, items.length) <= remaining;
        if (!fitsWhole && row.segments.length) { newRow(null); continue; }
        var take = fitsWhole ? items.length - index : Math.max(1, countFit(items, index, remaining));
        var entries = [];
        var cursor = 0;
        for (var i = index; i < index + take; i++) {
          var lean = i === index + take - 1 ? 0 : items[i].lean;
          entries.push({ item: items[i], x: cursor, lean: lean });
          cursor += stride(items[i], lean);
        }
        row.segments.push({ shelf: shelf.shelf, unit: shelf.unit, continued: continued, x: row.width + gap, width: cursor, entries: entries });
        row.width = row.width + gap + cursor;
        index += take;
        continued = true;
      }
    });
    return rows;
  }

  // Height of the whole bookcase in units for n rows.
  function blockHeight(n, maxH, rowGap) {
    return U.board + n * (rowGap + maxH + U.board) + U.tag * 0.9;
  }

  // Largest scale (mm per unit) at which the wrapped rows fit the box.
  function solveScale(shelves, boxW, boxH, maxH) {
    function rowsAt(s) {
      var avail = boxW / s - 2 * (U.frame + U.innerPad);
      return avail < U.maxWidth ? null : wrapRows(shelves, avail);
    }
    function fits(s) {
      var rows = rowsAt(s);
      return !!rows && blockHeight(rows.length, maxH, U.rowGap) * s <= boxH;
    }
    var lo = 0.005, hi = 20;
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid; else hi = mid;
    }
    return { scale: lo, rows: rowsAt(lo) || [] };
  }

  /* ------------------------------------------------------------------ */
  /* Drawing                                                             */
  /* ------------------------------------------------------------------ */

  // One line of spine text made of `pieces` [{ text, size, gap, opacity }],
  // for example a title followed by the author in a smaller size. Latin
  // text is rotated a quarter turn clockwise (read top to bottom, as on an
  // English spine). Text with CJK characters is stacked one upright glyph
  // per line, as on a Japanese spine; the glyphs are positioned one by one
  // so the file does not depend on a viewer's vertical writing support.
  // `center` is the distance across the spine at which the line is centred.
  function spineLine(parent, pieces, center, top, vertical, attrs) {
    var a = { 'font-size': round(pieces[0].size) };
    Object.keys(attrs || {}).forEach(function (k) { a[k] = attrs[k]; });
    var t;
    if (vertical) {
      a.x = round(center);
      a['text-anchor'] = 'middle';
      t = el('text', a, parent);
      var y = top;
      pieces.forEach(function (piece, i) {
        if (i > 0) y += piece.gap;
        Array.from(piece.text).forEach(function (ch) {
          var span = el('tspan', { x: round(center), y: round(y + piece.size * 0.88), 'font-size': round(piece.size) }, t);
          if (piece.opacity) span.setAttribute('opacity', piece.opacity);
          span.textContent = ch;
          y += piece.size * 1.02;
        });
      });
    } else {
      // For rotated text the baseline runs down the spine and the glyphs
      // rise toward +x, so the baseline sits 0.35 em left of the centre.
      a.transform = 'translate(' + round(center - pieces[0].size * 0.35) + ' ' + round(top) + ') rotate(90)';
      t = el('text', a, parent);
      t.appendChild(document.createTextNode(pieces[0].text));
      pieces.slice(1).forEach(function (piece) {
        var span = el('tspan', { dx: round(piece.gap), 'font-size': round(piece.size) }, t);
        if (piece.opacity) span.setAttribute('opacity', piece.opacity);
        span.textContent = piece.text;
      });
    }
    return t;
  }

  function drawSpine(parent, entry, x, bottom, ctx) {
    var item = entry.item;
    var w = item.width, h = item.height;
    var g = el('g', {
      'class': 'spine',
      transform: 'translate(' + round(x) + ' ' + round(bottom) + ')' + (entry.lean ? ' rotate(' + entry.lean + ')' : '')
    }, parent);

    el('rect', { x: 0, y: round(-h), width: w, height: round(h), rx: 1, fill: item.fill }, g);
    // Shading: a darker strip on the left edge and a lighter one at the top
    // suggest the curve of the spine.
    el('rect', { x: 0, y: round(-h), width: round(Math.max(1, w * 0.11)), height: round(h), fill: ctx.palette.shadow, opacity: 0.16 }, g);
    el('rect', { x: 0, y: round(-h), width: w, height: 1.2, fill: '#ffffff', opacity: 0.22 }, g);
    if (item.bands) {
      // Two thin rules near the head and tail, like blind tooling on cloth.
      var bandY = [-h + h * 0.07, -h * 0.07 - 0.8];
      bandY.forEach(function (y) {
        el('rect', { x: round(w * 0.15), y: round(y), width: round(w * 0.7), height: 0.8, fill: item.ink, opacity: 0.35 }, g);
      });
    }

    var book = item.book;
    var tip = el('title', {}, g);
    tip.textContent = book.title + (book.author ? ' / ' + book.author : '') + (book.isUnread ? ' [' + book.status + ']' : '');
    if (book.isUnread) {
      // An unreadable or partial row: a dashed outline and a question mark.
      el('rect', { x: 0.6, y: round(-h + 0.6), width: round(w - 1.2), height: round(h - 1.2), rx: 1, fill: 'none', stroke: item.ink, 'stroke-width': 0.5, 'stroke-dasharray': '2 1.4', opacity: 0.7 }, g);
      textEl(g, '?', { x: round(w / 2), y: round(-h / 2 + w * 0.3), 'font-size': round(w * 0.8), 'font-family': ctx.fontFamily, 'font-weight': 'bold', 'text-anchor': 'middle', fill: item.ink, opacity: 0.8 });
      return g;
    }
    var textTop = -h + U.pad + (item.bands ? h * 0.07 : 0);
    var maxLen = h - U.pad * 2 - (item.bands ? h * 0.14 : 0);
    var titleSize = clamp(6.5, 10.5, w * 0.42);
    var authorSize = titleSize * 0.74;
    var titleVertical = hasCJK(book.title);
    var authorVertical = hasCJK(book.author);
    var lengthOf = function (size, vertical) {
      return function (s) { return vertical ? verticalLength(s, size) : ctx.measure(s, size); };
    };
    var titleLength = lengthOf(titleSize, titleVertical);
    var authorLength = lengthOf(authorSize, authorVertical);
    var textAttrs = { fill: item.ink, 'font-family': ctx.fontFamily };

    var wantAuthor = ctx.options.showAuthors && book.author;
    var twoLines = wantAuthor && w >= titleSize + authorSize + 5;
    if (twoLines) {
      var total = titleSize + 1.5 + authorSize;
      var start = (w - total) / 2;
      spineLine(g, [{ text: fitText(book.title, maxLen, titleLength), size: titleSize }],
        start + titleSize / 2, textTop, titleVertical, textAttrs);
      spineLine(g, [{ text: fitText(book.author, maxLen, authorLength), size: authorSize, opacity: 0.8 }],
        start + titleSize + 1.5 + authorSize / 2, textTop, authorVertical, textAttrs);
    } else {
      var label = fitText(book.title, maxLen, titleLength);
      var pieces = [{ text: label, size: titleSize }];
      // Author after the title on the same line, when both fit untruncated
      // and are written the same way.
      if (wantAuthor && label === book.title.trim() && titleVertical === authorVertical) {
        var gap = titleSize * 0.9;
        var author = fitText(book.author, maxLen - titleLength(label) - gap, authorLength);
        if (author === book.author.trim()) pieces.push({ text: author, size: authorSize, gap: gap, opacity: 0.8 });
      }
      spineLine(g, pieces, w / 2, textTop, titleVertical, textAttrs);
    }
    return g;
  }

  // The pink sticky note with the shelf name, hung on the front edge of
  // the board. Its width follows the name; a continued shelf gets a small
  // arrow after the name.
  function drawTag(parent, segment, x, boardTop, ctx) {
    var size = U.tag;
    var fontSize = 7;
    var label = segment.shelf ? String(segment.shelf) : '?';
    var measure = function (s) { return ctx.measure(s, fontSize, 'bold'); };
    label = fitText(label, U.tagMaxWidth - 8, measure);
    var arrow = segment.continued ? 4 : 0;
    var width = Math.max(size, measure(label) + 8 + arrow);
    var g = el('g', { transform: 'translate(' + round(x) + ' ' + round(boardTop + 1.5) + ') rotate(-3)' }, parent);
    el('rect', { x: 0.8, y: 1, width: round(width), height: size, fill: ctx.palette.shadow, opacity: 0.15 }, g);
    el('rect', { x: 0, y: 0, width: round(width), height: size, fill: ctx.palette.tag }, g);
    textEl(g, label, {
      x: round(4), y: round(size / 2 + fontSize * 0.36),
      'font-size': fontSize, 'font-family': ctx.fontFamily, 'font-weight': 'bold', fill: ctx.palette.tagInk
    });
    if (segment.continued) {
      var ax = width - 3.8, ay = size / 2;
      el('path', { d: 'M' + round(ax) + ' ' + round(ay - 1.6) + ' L' + round(ax + 2.2) + ' ' + round(ay) + ' L' + round(ax) + ' ' + round(ay + 1.6) + ' Z', fill: ctx.palette.tagInk }, g);
    }
  }

  // The unit label at the top left of a unit's first row: "UNIT K" and the
  // first sentence of the shelf description, in the clearance above the
  // books.
  function drawUnitLabel(parent, shelf, x, y, maxWidth, ctx) {
    var size = U.unitLabel;
    var label = shelf.unit ? 'UNIT ' + shelf.unit.toUpperCase() : 'NO UNIT';
    var spacing = size * 0.14;
    textEl(parent, label, {
      x: round(x), y: round(y), 'font-size': size, 'font-family': ctx.fontFamily, 'font-weight': 'bold',
      'letter-spacing': round(spacing), fill: ctx.palette.ink
    });
    if (shelf.unitDescription) {
      var used = ctx.measure(label, size, 'bold', spacing) + size * 0.8;
      var small = size * 0.7;
      var text = fitText(shelf.unitDescription, maxWidth - used, function (s) { return ctx.measure(s, small); });
      if (text) textEl(parent, text, { x: round(x + used), y: round(y), 'font-size': round(small), 'font-family': ctx.fontFamily, fill: ctx.palette.muted });
    }
  }

  // The whole bookcase: side panels, top rail, boards, dividers, books.
  function drawBookcase(parent, layout, ctx) {
    var p = ctx.palette;
    var rows = layout.rows;
    var iw = layout.innerWidth;
    var rowGap = layout.rowGap;
    var maxH = layout.maxH;
    var totalH = blockHeight(rows.length, maxH, rowGap);
    var caseBottom = totalH - U.tag * 0.9;

    var g = el('g', {
      transform: 'translate(' + round(layout.x) + ' ' + round(layout.y) + ') scale(' + round(layout.scale * 1000) / 1000 + ')'
    }, parent);

    // Frame.
    el('rect', { x: 0, y: 0, width: round(iw), height: U.board, fill: p.frame }, g);
    el('rect', { x: 0, y: 0, width: U.frame, height: round(caseBottom), fill: p.frame }, g);
    el('rect', { x: round(iw - U.frame), y: 0, width: U.frame, height: round(caseBottom), fill: p.frame }, g);

    rows.forEach(function (row, r) {
      var boardTop = U.board + rowGap + r * (maxH + U.board + rowGap) + maxH;
      if (row.unit && ctx.options.showUnits) {
        drawUnitLabel(g, row.unit, U.frame + U.innerPad, boardTop - maxH - rowGap + U.unitLabel + 4, iw - 2 * (U.frame + U.innerPad), ctx);
      }
      var books = el('g', {}, g);
      row.segments.forEach(function (seg, s) {
        var segX = U.frame + U.innerPad + seg.x;
        if (s > 0) {
          // A divider between two shelves on the same row, board to board.
          el('rect', {
            x: round(segX - U.shelfGap / 2 - 1.25), y: round(boardTop - maxH - rowGap),
            width: 2.5, height: round(maxH + rowGap), fill: p.frame
          }, g);
        }
        seg.entries.forEach(function (entry) {
          drawSpine(books, entry, segX + entry.x, boardTop, ctx);
        });
      });
      // Board, drawn after the books so a leaning book's base sits on it.
      el('rect', { x: U.frame, y: round(boardTop), width: round(iw - 2 * U.frame), height: U.board, fill: p.board }, g);
      el('rect', { x: U.frame, y: round(boardTop + U.board - 1.4), width: round(iw - 2 * U.frame), height: 1.4, fill: p.boardEdge }, g);
      el('rect', { x: U.frame, y: round(boardTop + U.board), width: round(iw - 2 * U.frame), height: 2.5, fill: p.shadow, opacity: 0.08 }, g);
      if (ctx.options.showTags) {
        row.segments.forEach(function (seg) {
          drawTag(g, seg, U.frame + U.innerPad + seg.x - 1, boardTop, ctx);
        });
      }
    });
    return g;
  }

  /* ------------------------------------------------------------------ */
  /* Header and footer in mm                                             */
  /* ------------------------------------------------------------------ */

  function drawHeader(svg, ctx, W, margin, cw) {
    var p = ctx.palette;
    var titleSize = 0.04 * ctx.H;
    var title = String(ctx.options.title || '').trim();
    var subtitle = String(ctx.options.subtitle || '').trim();
    var y = margin;
    if (title) {
      // Shrink a long title so it stays inside the margins.
      while (titleSize > 6 && ctx.measure(title, titleSize) > cw * 0.92) titleSize *= 0.92;
      y += titleSize * 0.95;
      textEl(svg, title, {
        x: round(W / 2), y: round(y), 'font-size': round(titleSize), 'font-family': ctx.fontFamily,
        'text-anchor': 'middle', fill: p.ink
      });
      y += titleSize * 0.55;
    }
    var subSize = Math.max(2.6, 0.011 * ctx.H);
    var spacing = subSize * 0.22;
    y += subSize;
    if (subtitle) {
      var text = subtitle.toUpperCase();
      var half = ctx.measure(text, subSize, 'normal', spacing) / 2 + subSize * 1.2;
      textEl(svg, text, {
        x: round(W / 2), y: round(y), 'font-size': round(subSize), 'font-family': ctx.fontFamily,
        'letter-spacing': round(spacing), 'text-anchor': 'middle', fill: p.muted
      });
      // A hairline on either side of the subtitle.
      var ly = y - subSize * 0.35;
      var reach = cw * 0.32;
      el('line', { x1: round(W / 2 - half - reach), y1: round(ly), x2: round(W / 2 - half), y2: round(ly), stroke: p.rule, 'stroke-width': 0.3 }, svg);
      el('line', { x1: round(W / 2 + half), y1: round(ly), x2: round(W / 2 + half + reach), y2: round(ly), stroke: p.rule, 'stroke-width': 0.3 }, svg);
    } else {
      el('line', { x1: round(margin + cw * 0.18), y1: round(y - subSize * 0.35), x2: round(margin + cw * 0.82), y2: round(y - subSize * 0.35), stroke: p.rule, 'stroke-width': 0.3 }, svg);
    }
    return y + subSize * 0.5;
  }

  // Counts line and the legend. Drawn with its bottom at `bottom`; returns
  // the height used. When `dryRun` is true nothing is drawn.
  function drawFooter(svg, ctx, W, bottom, cw, dryRun) {
    var p = ctx.palette;
    var size = Math.max(2.4, 0.0085 * ctx.H);
    var sq = size * 0.85;
    var gapItem = size * 1.6;
    var lineH = size * 1.7;

    // Wrap the legend entries into centred lines.
    var lines = [[]];
    var widths = [0];
    ctx.legend.forEach(function (e) {
      var w = sq + size * 0.5 + ctx.measure(e.label, size);
      var last = lines.length - 1;
      var add = widths[last] === 0 ? w : gapItem + w;
      if (widths[last] + add > cw && widths[last] > 0) { lines.push([]); widths.push(0); last++; add = w; }
      lines[last].push({ entry: e, width: w });
      widths[last] += add;
    });
    var counts = ctx.counts;
    var height = lineH * (lines.length + 1);
    if (dryRun) return height;

    var y = bottom - height + size;
    textEl(svg, counts, {
      x: round(W / 2), y: round(y), 'font-size': round(size), 'font-family': ctx.fontFamily,
      'letter-spacing': round(size * 0.12), 'text-anchor': 'middle', fill: p.ink
    });
    lines.forEach(function (line, i) {
      var x = W / 2 - widths[i] / 2;
      var ly = y + lineH * (i + 1);
      line.forEach(function (it) {
        el('rect', { x: round(x), y: round(ly - sq * 0.85), width: round(sq), height: round(sq), rx: 0.4, fill: it.entry.color }, svg);
        textEl(svg, it.entry.label, {
          x: round(x + sq + size * 0.5), y: round(ly), 'font-size': round(size), 'font-family': ctx.fontFamily, fill: p.muted
        });
        x += it.width + gapItem;
      });
    });
    return height;
  }

  /* ------------------------------------------------------------------ */
  /* render                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Build the poster. `books` are normalized records from Library.
   * options:
   *   paper       { width, height } in mm (already oriented)
   *   title       poster title (default 'A Library')
   *   subtitle    small line under the title (may be empty)
   *   colorBy     'genre' | 'type' | 'language'
   *   palette     key of PALETTES
   *   font        key of FONTS
   *   showAuthors boolean
   *   showTags    boolean
   *   showUnits   boolean
   *   seed        integer for the wobble
   * Returns a detached <svg> element with xmlns, width/height in mm and a
   * matching viewBox, so its serialization is a valid standalone file.
   */
  function render(rows, options) {
    options = options || {};
    var palette = PALETTES[options.palette] || PALETTES.pastel;
    var font = FONTS[options.font] || FONTS.serif;
    var W = options.paper && options.paper.width || PAPERS.a2.width;
    var H = options.paper && options.paper.height || PAPERS.a2.height;
    var colorBy = options.colorBy === 'language' || options.colorBy === 'type' ? options.colorBy : 'genre';
    var opts = {
      title: options.title === undefined ? 'A Library' : options.title,
      subtitle: options.subtitle === undefined ? 'Arranged in shelf order' : options.subtitle,
      colorBy: colorBy,
      showAuthors: options.showAuthors !== false,
      showTags: options.showTags !== false,
      showUnits: options.showUnits !== false,
      seed: options.seed === undefined ? 1 : options.seed
    };

    // Objects (Status "Not a book") are not drawn and not counted.
    var books = rows.filter(function (b) { return !b.isObject; });
    var colors = assignColors(books, colorBy, palette);
    var units = Library.groupByUnit(books);
    var shelves = prepareShelves(units, opts, colors, palette, makeRandom(opts.seed));
    var maxH = shelves.reduce(function (m, s) {
      return s.items.reduce(function (m2, it) { return Math.max(m2, it.height); }, m);
    }, 0);

    var st = Library.stats(books);
    var pages = books.reduce(function (sum, b) { return sum + (b.pages || 0); }, 0);
    var unitCount = units.filter(function (u) { return u.unit !== ''; }).length;
    var counts = [plural(st.books, 'book'), plural(shelves.length, 'shelf').replace('shelfs', 'shelves')];
    if (unitCount > 1) counts.push(plural(unitCount, 'bookcase'));
    counts.push(plural(st.languages.length, 'language'));
    if (pages > 0) counts.push(formatNumber(pages) + ' pages');

    var ctx = {
      palette: palette, fontFamily: font.family, measure: makeMeasurer(font.family),
      options: opts, H: H, legend: colors.entries, counts: counts.join('  ·  ')
    };

    var svg = el('svg', {
      xmlns: SVG_NS, width: W + 'mm', height: H + 'mm', viewBox: '0 0 ' + W + ' ' + H
    });
    var docTitle = el('title', {}, svg);
    docTitle.textContent = opts.title || 'Bookshelf poster';
    var desc = el('desc', {}, svg);
    desc.textContent = 'Bookshelf poster: ' + st.books + ' books as spines in shelf order, grouped by bookcase, ' +
      W + ' x ' + H + ' mm. Colors by ' + colorBy + ', palette "' + palette.label +
      '". Text uses the font stack: ' + font.family + '. Made with the bookshelf poster (side project 14).';
    el('rect', { x: 0, y: 0, width: W, height: H, fill: palette.paper }, svg);

    var margin = 0.045 * Math.min(W, H);
    var cw = W - 2 * margin;
    var headerBottom = drawHeader(svg, ctx, W, margin, cw);
    var footerHeight = drawFooter(svg, ctx, W, H - margin, cw, true);
    var footerTop = H - margin - footerHeight;
    drawFooter(svg, ctx, W, H - margin, cw, false);

    // The bookcase fills the box between header and footer.
    var boxTop = headerBottom + 0.02 * H;
    var boxBottom = footerTop - 0.025 * H;
    var boxH = boxBottom - boxTop;
    if (books.length && boxH > 10) {
      var solved = solveScale(shelves, cw, boxH, maxH);
      var s = solved.scale;
      var n = solved.rows.length;
      // Spread the rows to use leftover height, up to a limit; the rest
      // centres the block vertically.
      var leftover = boxH / s - blockHeight(n, maxH, U.rowGap);
      var rowGap = Math.min(U.maxRowGap, U.rowGap + Math.max(0, leftover) / Math.max(1, n));
      var used = blockHeight(n, maxH, rowGap) * s;
      drawBookcase(svg, {
        rows: solved.rows, scale: s, maxH: maxH, rowGap: rowGap,
        innerWidth: cw / s, x: margin, y: boxTop + (boxH - used) / 2
      }, ctx);
    }
    return svg;
  }

  /* ------------------------------------------------------------------ */
  /* Export                                                              */
  /* ------------------------------------------------------------------ */

  /** The SVG as a standalone XML document. */
  function serialize(svg) {
    var xml = new XMLSerializer().serializeToString(svg);
    return '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + xml + '\n';
  }

  /**
   * Rasterize the poster at `dpi`. Resolves with { blob, width, height }.
   * The browser limits canvas size, so very large papers at high dpi can
   * fail; the caller reports that.
   */
  function toPNG(svg, dpi) {
    return new Promise(function (resolve, reject) {
      var vb = svg.getAttribute('viewBox').split(/\s+/).map(Number);
      var width = Math.round(vb[2] / 25.4 * dpi);
      var height = Math.round(vb[3] / 25.4 * dpi);
      var url = URL.createObjectURL(new Blob([serialize(svg)], { type: 'image/svg+xml;charset=utf-8' }));
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        var c = canvas.getContext('2d');
        if (!c) { reject(new Error('The browser refused a canvas of ' + width + ' x ' + height + ' pixels.')); return; }
        c.drawImage(img, 0, 0, width, height);
        canvas.toBlob(function (blob) {
          if (!blob) reject(new Error('The browser could not encode a PNG of ' + width + ' x ' + height + ' pixels.'));
          else resolve({ blob: blob, width: width, height: height });
        }, 'image/png');
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('The SVG could not be drawn to a canvas.')); };
      img.src = url;
    });
  }

  return {
    PAPERS: PAPERS,
    PALETTES: PALETTES,
    FONTS: FONTS,
    render: render,
    serialize: serialize,
    toPNG: toPNG
  };
})();
