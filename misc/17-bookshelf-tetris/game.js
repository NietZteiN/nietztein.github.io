/*
 * game.js  (Bookshelf Tetris, project 17)
 *
 * Falling books from the catalog, one shelf high and one to three cells wide
 * by size band (the Type column: manga and bunko narrow, art books and
 * textbooks wide; a Pages column overrides it when present). A full shelf
 * clears only when its titles read left to right in shelving order, which
 * is the same order the virtual library uses (Library.titleSortKey from
 * ../01-virtual-library/library.js: "The" titles group after S). Spines are
 * drawn with Library.drawSpine so the game looks like the same library.
 * Rows that are objects ("Not a book"), unreadable or partial are not dealt.
 *
 * Contents:
 *   CONFIG           sizes, speeds, points, catalog source (edit this first)
 *   FALLBACK_ROWS    30 books used when the CSV cannot be fetched
 *   state            the whole game state in one object
 *   catalog + bag    loading books and dealing them out
 *   grid rules       placement, locking, ordering, clearing, reshelving
 *   rendering        board, previews, side panel, help shelf
 *   input            keyboard and on-screen buttons
 *   window.__game    a small hook used by verify.py
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* CONFIG                                                              */
  /* ------------------------------------------------------------------ */

  var CONFIG = {
    cols: 12,                 // cells per shelf
    rows: 8,                  // shelves
    cellW: 40,                // SVG units per cell
    rowH: 92,                 // SVG units per shelf, including the plank
    plank: 9,                 // plank thickness at the bottom of each shelf
    gap: 4,                   // air between a spine's top and the shelf above

    // Width in cells by size band (Library.sizeBand: small, medium or
    // large, from the Type column and a bunko publisher).
    widthBands: { small: 1, medium: 2, large: 3 },
    // When the catalog has a Pages column it wins: [maxPages, cells]. The
    // first band that the page count is below is used.
    pageWidthBands: [[200, 1], [500, 2], [Infinity, 3]],

    gravityMs: 800,           // fall interval at level 1
    gravityFactor: 0.85,      // multiplied in per level
    minGravityMs: 110,
    linesPerLevel: 5,         // shelves cleared per level

    reshelvesPerLevel: 2,     // reshelve uses, refilled at each level
    reshelveCost: 300,        // points taken per reshelve (score floors at 0)

    points: { clear: 100, onePass: 50, combo: 50, softDrop: 1, hardDrop: 2 },
    previewCount: 3,
    clearFlashMs: 320,

    // Limits on how many books matching a pattern appear per bag (one bag is
    // one shuffled pass through the catalog). The catalog has 51 Harvard
    // Classics volumes; without a limit a good share of the pieces would be
    // the same width and the same series.
    bagRules: [{ pattern: /^Harvard Classics,?\s+Vol/i, maxPerBag: 3 }],

    // Catalog files, tried in order: the real export, then the sample.
    catalogUrls: Library.catalogUrls('../01-virtual-library/'),
    storageKey: 'bookshelf-tetris-best'
  };

  // Used when fetch is blocked (file://) or the CSV is missing. The fields
  // are title, author, language, type, genre and publisher, turned into rows
  // with the project 1 column headers so Library.normalizeRows handles them.
  var FALLBACK_ROWS = [
    ['Also sprach Zarathustra', 'Friedrich Nietzsche', 'DE', 'Philosophy', 'Philosophy & political theory', 'Reclam'],
    ['Anna Karenina', 'Leo Tolstoy', 'EN', 'Fiction', 'Literature (English & European)', 'Penguin Classics'],
    ['Beloved', 'Toni Morrison', 'EN', 'Fiction', 'Literature (English & European)', 'Vintage'],
    ['Die Verwandlung', 'Franz Kafka', 'DE', 'Fiction', 'Literature (English & European)', 'Reclam'],
    ['Dubliners', 'James Joyce', 'EN', 'Fiction', 'Literature (English & European)', 'Penguin'],
    ['Duineser Elegien', 'Rainer Maria Rilke', 'DE', 'Poetry', 'Literature (English & European)', 'Insel'],
    ['Ethics', 'Baruch Spinoza', 'EN', 'Philosophy', 'Philosophy & political theory', 'Penguin Classics'],
    ['Frankenstein', 'Mary Shelley', 'EN', 'Fiction', 'Literature (English & European)', 'Penguin Classics'],
    ['Gedichte', 'Friedrich Hölderlin', 'DE', 'Poetry', 'Literature (English & European)', 'Reclam'],
    ['Gödel, Escher, Bach', 'Douglas R. Hofstadter', 'EN', 'Nonfiction', 'Math, CS & engineering', 'Basic Books'],
    ['Hamlet', 'William Shakespeare', 'EN', 'Drama', 'Literature (English & European)', 'Folger'],
    ['In the Blink of an Eye', 'Walter Murch', 'EN', 'Film', 'Writing, film & literary craft', 'Silman-James'],
    ['Invisible Cities', 'Italo Calvino', 'EN', 'Fiction', 'Literature (English & European)', 'Harvest'],
    ['Moby-Dick', 'Herman Melville', 'EN', 'Fiction', 'Literature (English & European)', 'Penguin Classics'],
    ['Mrs Dalloway', 'Virginia Woolf', 'EN', 'Fiction', 'Literature (English & European)', 'Harcourt'],
    ['Pride and Prejudice', 'Jane Austen', 'EN', 'Fiction', 'Literature (English & European)', 'Penguin Classics'],
    ['Sein und Zeit', 'Martin Heidegger', 'DE', 'Philosophy', 'Philosophy & political theory', 'Niemeyer'],
    ['Số đỏ', 'Vũ Trọng Phụng', 'VI', 'Fiction', 'Literature (English & European)', 'Nhà xuất bản Văn học'],
    ['The Great Gatsby', 'F. Scott Fitzgerald', 'EN', 'Fiction', 'Literature (English & European)', 'Scribner'],
    ['The Left Hand of Darkness', 'Ursula K. Le Guin', 'EN', 'Fiction', 'Literature (English & European)', 'Ace'],
    ['The Trial', 'Franz Kafka', 'EN', 'Fiction', 'Literature (English & European)', 'Schocken'],
    ['Tristram Shandy', 'Laurence Sterne', 'EN', 'Fiction', 'Literature (English & European)', 'Penguin Classics'],
    ['Truyện Kiều', 'Nguyễn Du', 'VI', 'Poetry', 'Literature (English & European)', 'Nhà xuất bản Văn học'],
    ['Ulysses', 'James Joyce', 'EN', 'Fiction', 'Literature (English & European)', 'Vintage'],
    ['War and Peace', 'Leo Tolstoy', 'EN', 'Fiction', 'Literature (English & European)', 'Vintage'],
    ['The Story of Art', 'E. H. Gombrich', 'EN', 'Art', 'Art & visual culture', 'Phaidon'],
    ['人間失格', '太宰治', 'JA', 'Fiction', 'Japanese literature', '新潮文庫'],
    ['山羊の歌', '中原中也', 'JA', 'Poetry', 'Japanese literature', '角川文庫'],
    ['堕落論', '坂口安吾', 'JA', 'Essays', 'Japanese literature', '新潮文庫'],
    ['雪国', '川端康成', 'JA', 'Fiction', 'Japanese literature', '新潮文庫']
  ];

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */

  var state = {
    catalog: [],
    catalogLabel: '',
    grid: [],            // grid[row][col] = placed book instance or null
    rowFlags: [],        // rowFlags[row] = { reshelved: bool }
    piece: null,         // { book, width, col, row, flipped }
    queue: [],           // upcoming books
    bag: [],             // shuffled books not yet dealt
    hold: null,
    holdUsed: false,
    score: 0, best: 0, level: 1, lines: 0, combo: 0, reshelvesLeft: 0,
    status: 'idle',      // idle | running | paused | clearing | selecting | over
    clearingRows: [],
    clearTimer: null,
    selectIndex: 0,      // index into misorderedRows() while selecting
    lastFall: 0,
    message: '',
    uid: 0
  };

  var $ = function (id) { return document.getElementById(id); };
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(name, attrs, parent) {
    var el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(el);
    return el;
  }

  /* ------------------------------------------------------------------ */
  /* Catalog and bag                                                     */
  /* ------------------------------------------------------------------ */

  // Row objects keyed by the catalog's column headers, for normalizeRows.
  function rowFromFields(id, title, author, language, type, genre, publisher) {
    var c = Library.CONFIG.columns;
    var row = {};
    row[c.id] = id; row[c.title] = title; row[c.author] = author; row[c.language] = language;
    row[c.type] = type; row[c.genre] = genre; row[c.publisher] = publisher; row[c.status] = 'OK';
    return row;
  }

  function fallbackBooks() {
    return Library.normalizeRows(FALLBACK_ROWS.map(function (r, i) {
      return rowFromFields('sample-' + (i + 1), r[0], r[1], r[2], r[3], r[4], r[5]);
    }));
  }

  // Only identified books are dealt: no objects, no unreadable or partial rows.
  function playable(books) {
    return books.filter(function (b) { return b.title && !b.isObject && !b.isUnread; });
  }

  function setCatalog(books, label) {
    books = playable(books);
    if (books.length === 0) return;
    state.catalog = books;
    state.catalogLabel = label;
    $('source').textContent = label;
    state.bag = [];
    if (state.status === 'idle') state.queue = [];
  }

  function loadCatalog() {
    setCatalog(fallbackBooks(), 'Built-in sample of ' + FALLBACK_ROWS.length + ' books.');
    var unavailable = function () {
      setCatalog(fallbackBooks(), 'Built-in sample of ' + FALLBACK_ROWS.length +
        ' books. The CSV cannot be fetched from here (browsers block fetch on file://), use "Load a CSV" for the full catalog.');
    };
    // Browsers refuse fetch on file:// and log an error, so do not even try.
    if (location.protocol === 'file:') { unavailable(); return; }
    Library.loadFirstCatalog(CONFIG.catalogUrls).then(function (result) {
      setCatalog(result.books, playable(result.books).length + ' books from ' + result.url.replace('../', '') + '.');
    }).catch(unavailable);
  }

  function loadCsvFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var books = Library.normalizeRows(Library.parseCSV(String(reader.result)));
      if (playable(books).length === 0) {
        setMessage('That file had no playable rows (titled, not objects, not unreadable).');
        return;
      }
      setCatalog(books, playable(books).length + ' books from ' + file.name + '.');
      setMessage('Catalog loaded. New books are dealt from it as the bag refills.');
      renderSide();
    };
    reader.readAsText(file);
  }

  // Cells a book takes: from its page count when the catalog has one,
  // otherwise from the size band of its Type.
  function bookWidth(book) {
    if (book.pages !== null && book.pages !== undefined) {
      for (var i = 0; i < CONFIG.pageWidthBands.length; i++) {
        if (book.pages < CONFIG.pageWidthBands[i][0]) return CONFIG.pageWidthBands[i][1];
      }
      return CONFIG.pageWidthBands[CONFIG.pageWidthBands.length - 1][1];
    }
    return CONFIG.widthBands[Library.sizeBand(book)] || CONFIG.widthBands.medium;
  }

  function keyOf(book) {
    return Library.sortKeyOf(book);
  }

  // One bag is one shuffled pass through the catalog, thinned by bagRules.
  function refillBag() {
    var books = state.catalog.slice();
    for (var i = books.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = books[i]; books[i] = books[j]; books[j] = t;
    }
    var counts = CONFIG.bagRules.map(function () { return 0; });
    state.bag = books.filter(function (b) {
      for (var r = 0; r < CONFIG.bagRules.length; r++) {
        if (CONFIG.bagRules[r].pattern.test(b.title)) {
          counts[r]++;
          return counts[r] <= CONFIG.bagRules[r].maxPerBag;
        }
      }
      return true;
    });
  }

  function dealBook() {
    if (state.bag.length === 0) refillBag();
    return state.bag.pop();
  }

  function topUpQueue() {
    while (state.queue.length < CONFIG.previewCount) state.queue.push(dealBook());
  }

  /* ------------------------------------------------------------------ */
  /* Grid rules                                                          */
  /* ------------------------------------------------------------------ */

  function emptyGrid() {
    state.grid = [];
    state.rowFlags = [];
    for (var r = 0; r < CONFIG.rows; r++) {
      state.grid.push(new Array(CONFIG.cols).fill(null));
      state.rowFlags.push({ reshelved: false });
    }
  }

  function canPlace(row, col, width) {
    if (row < 0 || row >= CONFIG.rows || col < 0 || col + width > CONFIG.cols) return false;
    for (var c = col; c < col + width; c++) if (state.grid[row][c]) return false;
    return true;
  }

  // Distinct book instances in a row, left to right.
  function rowPieces(row) {
    var out = [];
    var last = null;
    state.grid[row].forEach(function (cell) {
      if (cell && cell !== last) out.push(cell);
      if (cell) last = cell;
    });
    return out;
  }

  function rowFull(row) {
    return state.grid[row].every(function (cell) { return cell; });
  }

  function rowOrdered(row) {
    var pieces = rowPieces(row);
    for (var i = 1; i < pieces.length; i++) {
      if (keyOf(pieces[i].book) < keyOf(pieces[i - 1].book)) return false;
    }
    return true;
  }

  function rowStatus(row) {
    var full = rowFull(row);
    return { full: full, ordered: rowOrdered(row), misordered: full && !rowOrdered(row) };
  }

  function misorderedRows() {
    var rows = [];
    for (var r = CONFIG.rows - 1; r >= 0; r--) if (rowStatus(r).misordered) rows.push(r);
    return rows;   // bottom first
  }

  function placeInstance(row, col, book, width, flipped) {
    var inst = { uid: ++state.uid, book: book, width: width, col: col, flipped: !!flipped };
    for (var c = col; c < col + width; c++) state.grid[row][c] = inst;
    return inst;
  }

  function spawn() {
    topUpQueue();
    var book = state.queue.shift();
    topUpQueue();
    startPiece(book);
  }

  function startPiece(book) {
    var width = bookWidth(book);
    var col = Math.floor((CONFIG.cols - width) / 2);
    state.piece = { book: book, width: width, col: col, row: 0, flipped: false };
    state.lastFall = performance.now();
    if (!canPlace(0, col, width)) gameOver();
  }

  function gravityMs() {
    return Math.max(CONFIG.minGravityMs, CONFIG.gravityMs * Math.pow(CONFIG.gravityFactor, state.level - 1));
  }

  function move(dx) {
    var p = state.piece;
    if (canPlace(p.row, p.col + dx, p.width)) { p.col += dx; render(); }
  }

  // One gravity step: move down or lock. Returns true if the piece moved.
  function fall() {
    var p = state.piece;
    if (canPlace(p.row + 1, p.col, p.width)) { p.row++; state.lastFall = performance.now(); render(); return true; }
    lock();
    return false;
  }

  function softDrop() {
    if (fall()) addScore(CONFIG.points.softDrop);
  }

  function hardDrop() {
    var p = state.piece;
    var target = ghostRow();
    addScore((target - p.row) * CONFIG.points.hardDrop);
    p.row = target;
    lock();
  }

  function ghostRow() {
    var p = state.piece;
    var row = p.row;
    while (canPlace(row + 1, p.col, p.width)) row++;
    return row;
  }

  function lock() {
    var p = state.piece;
    placeInstance(p.row, p.col, p.book, p.width, p.flipped);
    state.piece = null;
    state.holdUsed = false;
    resolveRows();
  }

  function holdPiece() {
    if (state.holdUsed) { setMessage('Hold was already used for this book.'); return; }
    var current = state.piece.book;
    state.holdUsed = true;
    if (state.hold) {
      var swapped = state.hold;
      state.hold = current;
      startPiece(swapped);
    } else {
      state.hold = current;
      spawn();
    }
    render();
  }

  // After a lock: full ordered rows clear (after a short flash), full
  // misordered rows stay and are tinted. Then the next book spawns.
  function resolveRows() {
    var clearing = [];
    for (var r = 0; r < CONFIG.rows; r++) {
      var s = rowStatus(r);
      if (s.full && s.ordered) clearing.push(r);
    }
    if (clearing.length === 0) {
      state.combo = 0;
      var bad = misorderedRows();
      if (bad.length) setMessage(bad.length + (bad.length === 1 ? ' full shelf is' : ' full shelves are') + ' out of order. Press R to reshelve.');
      state.status = 'running';
      spawn();
      render();
      return;
    }
    state.status = 'clearing';
    state.clearingRows = clearing;
    render();
    state.clearTimer = setTimeout(finishClear, CONFIG.clearFlashMs);
  }

  function finishClear() {
    clearTimeout(state.clearTimer);
    state.clearTimer = null;
    if (state.status !== 'clearing') return;
    var rows = state.clearingRows;
    state.combo++;

    var gained = 0;
    var onePass = 0;
    rows.forEach(function (r) {
      gained += CONFIG.points.clear * state.level;
      if (!state.rowFlags[r].reshelved) { gained += CONFIG.points.onePass * state.level; onePass++; }
    });
    if (state.combo > 1) gained += CONFIG.points.combo * (state.combo - 1) * state.level;
    addScore(gained);

    // Remove cleared rows; everything above shifts down.
    rows.slice().sort(function (a, b) { return b - a; }).forEach(function (r) {
      state.grid.splice(r, 1);
      state.rowFlags.splice(r, 1);
    });
    while (state.grid.length < CONFIG.rows) {
      state.grid.unshift(new Array(CONFIG.cols).fill(null));
      state.rowFlags.unshift({ reshelved: false });
    }

    state.lines += rows.length;
    var newLevel = 1 + Math.floor(state.lines / CONFIG.linesPerLevel);
    var note = rows.length + (rows.length === 1 ? ' shelf' : ' shelves') + ' cleared, +' + gained;
    if (onePass) note += ' (' + onePass + ' in one pass)';
    if (state.combo > 1) note += ', combo x' + state.combo;
    if (newLevel > state.level) {
      state.level = newLevel;
      state.reshelvesLeft = CONFIG.reshelvesPerLevel;
      note += '. Level ' + newLevel + ', reshelves refilled';
    }
    setMessage(note + '.');

    state.clearingRows = [];
    state.status = 'running';
    spawn();
    render();
  }

  /* Reshelve: sort one full misordered shelf into shelving order. */

  function beginReshelve() {
    var rows = misorderedRows();
    if (rows.length === 0) { setMessage('No full shelf is out of order right now.'); return; }
    if (state.reshelvesLeft <= 0) { setMessage('No reshelves left this level. Clear ' +
      (CONFIG.linesPerLevel - state.lines % CONFIG.linesPerLevel) + ' more to refill.'); return; }
    if (rows.length === 1) { reshelve(rows[0]); return; }
    state.status = 'selecting';
    state.selectIndex = 0;
    setMessage('Choose a shelf with the arrow keys, then press R or Enter. Esc cancels.');
    render();
  }

  function reshelve(row) {
    var pieces = rowPieces(row);
    pieces.sort(function (a, b) {
      var ka = keyOf(a.book), kb = keyOf(b.book);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    var col = 0;
    var cells = new Array(CONFIG.cols).fill(null);
    pieces.forEach(function (inst) {
      inst.col = col;
      for (var c = col; c < col + inst.width; c++) cells[c] = inst;
      col += inst.width;
    });
    state.grid[row] = cells;
    state.rowFlags[row].reshelved = true;
    state.reshelvesLeft--;
    state.score = Math.max(0, state.score - CONFIG.reshelveCost);
    setMessage('Reshelved shelf ' + (CONFIG.rows - row) + ' for ' + CONFIG.reshelveCost + ' points.');
    // The falling piece keeps falling; the sorted row clears at once if full.
    var p = state.piece;
    state.status = 'running';
    if (rowFull(row) && rowOrdered(row)) {
      state.piece = null;
      state.status = 'clearing';
      state.clearingRows = [row];
      // Put the falling book back at the front of the queue so it is not lost.
      if (p) state.queue.unshift(p.book);
      state.combo = Math.max(0, state.combo - 1); // a reshelved clear does not extend a combo
      render();
      state.clearTimer = setTimeout(finishClear, CONFIG.clearFlashMs);
      return;
    }
    render();
  }

  /* Fit information for the falling book at its landing row. */

  function fitInfo() {
    var p = state.piece;
    if (!p) return null;
    var row = ghostRow();
    var key = keyOf(p.book);
    var left = null, right = null, c;
    for (c = p.col - 1; c >= 0; c--) if (state.grid[row][c]) { left = state.grid[row][c]; break; }
    for (c = p.col + p.width; c < CONFIG.cols; c++) if (state.grid[row][c]) { right = state.grid[row][c]; break; }
    var leftOK = !left || keyOf(left.book) <= key;
    var rightOK = !right || key <= keyOf(right.book);

    // Where the book belongs among the row's pieces: the left edge of the
    // first piece whose key is greater, or the right end of the last piece.
    var pieces = rowPieces(row);
    var insertX = null;
    if (!(leftOK && rightOK)) {
      insertX = 0;
      for (var i = 0; i < pieces.length; i++) {
        if (keyOf(pieces[i].book) > key) { insertX = pieces[i].col; break; }
        insertX = pieces[i].col + pieces[i].width;
      }
    }
    return { row: row, left: left, right: right, leftOK: leftOK, rightOK: rightOK, fits: leftOK && rightOK, insertX: insertX, empty: pieces.length === 0 };
  }

  /* Score and lifecycle */

  function addScore(n) {
    state.score += n;
    if (state.score > state.best) { state.best = state.score; saveBest(); }
  }

  function loadBest() {
    try { state.best = parseInt(localStorage.getItem(CONFIG.storageKey), 10) || 0; } catch (e) { state.best = 0; }
  }
  function saveBest() {
    try { localStorage.setItem(CONFIG.storageKey, String(state.best)); } catch (e) { /* storage blocked, nothing to do */ }
  }

  function setMessage(text) {
    state.message = text;
    $('message').textContent = text;
  }

  function start() {
    clearTimeout(state.clearTimer);
    emptyGrid();
    state.piece = null;
    state.queue = [];
    state.bag = [];
    state.hold = null;
    state.holdUsed = false;
    state.score = 0; state.level = 1; state.lines = 0; state.combo = 0;
    state.reshelvesLeft = CONFIG.reshelvesPerLevel;
    state.clearingRows = [];
    state.status = 'running';
    setMessage('');
    hideOverlays();
    spawn();
    render();
  }

  function gameOver() {
    state.status = 'over';
    state.piece = null;
    $('final').textContent = 'Score ' + state.score + ', ' + state.lines + ' shelves cleared, level ' + state.level +
      (state.score >= state.best && state.score > 0 ? '. A new best.' : '. Best ' + state.best + '.');
    showOverlay('gameover');
    render();
  }

  function togglePause() {
    if (state.status === 'running') { state.status = 'paused'; showOverlay('paused'); }
    else if (state.status === 'paused') { state.status = 'running'; state.lastFall = performance.now(); hideOverlays(); }
  }

  function showOverlay(id) {
    ['start', 'paused', 'gameover', 'help'].forEach(function (k) { $(k).classList.toggle('show', k === id); });
  }
  function hideOverlays() { showOverlay(null); }

  var helpReturn = null;   // status to return to when help closes
  function toggleHelp() {
    if ($('help').classList.contains('show')) {
      $('help').classList.remove('show');
      if (helpReturn === 'running') { state.status = 'running'; state.lastFall = performance.now(); hideOverlays(); }
      else if (helpReturn === 'paused') showOverlay('paused');
      else if (helpReturn === 'over') showOverlay('gameover');
      else if (helpReturn === 'idle') showOverlay('start');
      else hideOverlays();
      helpReturn = null;
      return;
    }
    helpReturn = state.status;
    if (state.status === 'running') state.status = 'paused';
    drawHelpShelf();
    showOverlay('help');
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  var board = $('board');
  var staticLayer, dynLayer;

  // Estimated text length in user units, the same heuristic drawSpine uses
  // to truncate: CJK characters count as one em, others as 0.56 em.
  function textLength(title, fontSize) {
    var n = 0;
    for (var i = 0; i < title.length; i++) {
      var code = title.charCodeAt(i);
      n += (code >= 0x2E80 && code <= 0xFFE6) ? fontSize : fontSize * 0.56;
    }
    return n;
  }

  // Long titles get a smaller font (down to 80 percent) before drawSpine
  // has to truncate them with an ellipsis.
  function drawBook(parent, book, x, bottom, width, height, fontSize, flipped) {
    var size = fontSize;
    while (size > fontSize * 0.8 && textLength(book.title, size) > height - 12 - size * 0.8) size -= 0.5;
    var g = Library.drawSpine(parent, book, x, bottom, { size: { width: width, height: height }, fontSize: size });
    if (flipped) {
      // Mirror the title so it reads bottom to top. Purely cosmetic.
      var text = g.querySelector('text');
      text.setAttribute('transform', 'translate(' + (x + width / 2) + ' ' + (bottom - 6) + ') rotate(-90)');
    }
    return g;
  }

  function buildBoard() {
    var W = CONFIG.cols * CONFIG.cellW, H = CONFIG.rows * CONFIG.rowH;
    board.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    board.innerHTML = '';
    var defs = svgEl('defs', {}, board);
    var grain = svgEl('pattern', { id: 'grain', width: W, height: 26, patternUnits: 'userSpaceOnUse' }, defs);
    svgEl('rect', { width: W, height: 26, fill: '#4a3323' }, grain);
    svgEl('path', { d: 'M0 13 Q ' + W / 4 + ' 6 ' + W / 2 + ' 13 T ' + W + ' 13', stroke: '#000', 'stroke-width': 1.2, opacity: 0.12, fill: 'none' }, grain);
    svgEl('path', { d: 'M0 22 Q ' + W / 3 + ' 26 ' + W / 1.5 + ' 20 T ' + W + ' 24', stroke: '#fff', 'stroke-width': 0.8, opacity: 0.05, fill: 'none' }, grain);

    staticLayer = svgEl('g', {}, board);
    svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#grain)' }, staticLayer);
    for (var r = 0; r < CONFIG.rows; r++) {
      var y = r * CONFIG.rowH + CONFIG.rowH - CONFIG.plank;
      // Shadow under the shelf above, then the plank with a lit top edge.
      svgEl('rect', { x: 0, y: r * CONFIG.rowH, width: W, height: 10, fill: '#000', opacity: 0.22 }, staticLayer);
      svgEl('rect', { x: 0, y: y, width: W, height: CONFIG.plank, fill: '#b98a5a' }, staticLayer);
      svgEl('rect', { x: 0, y: y, width: W, height: 1.5, fill: '#e2b787', opacity: 0.7 }, staticLayer);
      svgEl('rect', { x: 0, y: y + CONFIG.plank - 3, width: W, height: 3, fill: '#7a5433' }, staticLayer);
    }
    dynLayer = svgEl('g', {}, board);
  }

  function render() {
    if (!dynLayer) buildBoard();
    dynLayer.innerHTML = '';
    var W = CONFIG.cols * CONFIG.cellW;
    var spineH = CONFIG.rowH - CONFIG.plank - CONFIG.gap;
    var r, c;

    // Placed books
    for (r = 0; r < CONFIG.rows; r++) {
      var bottom = r * CONFIG.rowH + CONFIG.rowH - CONFIG.plank;
      var drawn = null;
      for (c = 0; c < CONFIG.cols; c++) {
        var inst = state.grid[r][c];
        if (inst && inst !== drawn) {
          drawBook(dynLayer, inst.book, inst.col * CONFIG.cellW + 1, bottom, inst.width * CONFIG.cellW - 2, spineH, 10.5, inst.flipped);
          drawn = inst;
        }
      }
      var s = rowStatus(r);
      if (s.misordered) {
        svgEl('rect', { x: 0, y: r * CONFIG.rowH, width: W, height: CONFIG.rowH, fill: '#e8635a', opacity: 0.3, 'class': 'misordered' }, dynLayer);
        svgEl('rect', { x: 1, y: r * CONFIG.rowH + 1, width: W - 2, height: CONFIG.rowH - 2, fill: 'none', stroke: '#e8635a', 'stroke-width': 2, opacity: 0.8 }, dynLayer);
      }
      if (state.clearingRows.indexOf(r) >= 0) {
        svgEl('rect', { x: 0, y: r * CONFIG.rowH, width: W, height: CONFIG.rowH, fill: '#f2c14e', opacity: 0.5, 'class': 'clearing' }, dynLayer);
      }
    }

    // Reshelve selection
    if (state.status === 'selecting') {
      var rows = misorderedRows();
      var sel = rows[Math.min(state.selectIndex, rows.length - 1)];
      svgEl('rect', { x: 2, y: sel * CONFIG.rowH + 2, width: W - 4, height: CONFIG.rowH - 4, fill: 'none', stroke: '#f2c14e', 'stroke-width': 3, rx: 4, 'class': 'select' }, dynLayer);
    }

    // Ghost, fit markers and the falling book
    var p = state.piece;
    if (p && state.status !== 'over') {
      var info = fitInfo();
      var gx = p.col * CONFIG.cellW + 1, gw = p.width * CONFIG.cellW - 2;
      var gTop = info.row * CONFIG.rowH + CONFIG.gap;
      var color = info.fits ? '#5fd08a' : '#e8635a';
      if (info.row !== p.row) {
        svgEl('rect', { x: gx, y: gTop, width: gw, height: spineH, fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': '4 3', opacity: 0.9, rx: 1.5, 'class': 'ghost' }, dynLayer);
      }
      var my = gTop + spineH / 2;
      if (!info.empty) {
        svgEl('path', { d: 'M' + (gx + 2) + ' ' + (my - 7) + ' l7 7 l-7 7 z', fill: info.leftOK ? '#5fd08a' : '#e8635a', 'class': 'marker-left' }, dynLayer);
        svgEl('path', { d: 'M' + (gx + gw - 2) + ' ' + (my - 7) + ' l-7 7 l7 7 z', fill: info.rightOK ? '#5fd08a' : '#e8635a', 'class': 'marker-right' }, dynLayer);
      }
      if (info.insertX !== null) {
        var ix = Math.min(W - 6, Math.max(6, info.insertX * CONFIG.cellW));
        svgEl('path', { d: 'M' + (ix - 6) + ' ' + (gTop - 2) + ' l12 0 l-6 9 z', fill: '#f2c14e', 'class': 'marker-insert' }, dynLayer);
      }
      drawBook(dynLayer, p.book, gx, p.row * CONFIG.rowH + CONFIG.rowH - CONFIG.plank, gw, spineH, 10.5, p.flipped);
    }

    renderSide();
  }

  // Small horizontal shelf of spines for the next and hold cards.
  function drawMiniShelf(container, books) {
    container.innerHTML = '';
    var cell = 18, h = 74, W = 3 * cell * CONFIG.previewCount + 8 * (CONFIG.previewCount - 1);
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + (h + 8), xmlns: SVG_NS }, container);
    svgEl('rect', { x: 0, y: h + 2, width: W, height: 5, fill: '#b98a5a' }, svg);
    var x = 0;
    books.forEach(function (b) {
      var w = bookWidth(b) * cell;
      drawBook(svg, b, x, h + 2, w, h, 7.5, false);
      x += w + 8;
    });
    if (books.length === 0) {
      var t = svgEl('text', { x: 4, y: h - 6, 'font-size': 9, fill: '#b8a893' }, svg);
      t.textContent = 'empty';
    }
  }

  function renderSide() {
    drawMiniShelf($('preview'), state.queue.slice(0, CONFIG.previewCount));
    drawMiniShelf($('holdbox'), state.hold ? [state.hold] : []);
    $('score').textContent = state.score;
    $('best').textContent = state.best;
    $('level').textContent = state.level;
    $('lines').textContent = state.lines;
    $('combo').textContent = state.combo;
    $('reshelves').textContent = state.reshelvesLeft + ' / ' + CONFIG.reshelvesPerLevel;

    var hint = $('hint');
    var p = state.piece;
    if (!p) {
      hint.className = '';
      if (state.status === 'idle') hint.textContent = 'Start the game to get a hint for each falling book.';
      return;
    }
    var info = fitInfo();
    var head = document.createElement('div');
    var b = document.createElement('b');
    b.textContent = p.book.title;
    head.appendChild(b);
    var size = p.book.pages !== null ? p.book.pages + ' pages' : (p.book.type || Library.sizeBand(p.book));
    head.appendChild(document.createTextNode((p.book.author ? ', ' + p.book.author : '') +
      ' (' + size + ', ' + p.width + (p.width === 1 ? ' cell)' : ' cells)')));
    var line = document.createElement('div');
    var q = function (inst) { return '"' + inst.book.title + '"'; };
    if (info.empty) line.textContent = 'The landing shelf is empty, any spot works.';
    else if (info.fits) line.textContent = 'Fits here' + (info.left ? ', after ' + q(info.left) : '') + (info.right ? (info.left ? ' and' : ',') + ' before ' + q(info.right) : '') + '.';
    else if (!info.leftOK) line.textContent = 'Not here: it files before ' + q(info.left) + '.' + theNote(p.book, info.left.book);
    else line.textContent = 'Not here: it files after ' + q(info.right) + '.' + theNote(p.book, info.right.book);
    hint.className = info.empty || info.fits ? 'good' : 'bad';
    hint.innerHTML = '';
    hint.appendChild(head);
    hint.appendChild(line);
  }

  function theNote(a, b) {
    return /^the\s/i.test(a.title) || /^the\s/i.test(b.title) ? ' Remember, "The" titles go after S.' : '';
  }

  // The example shelf in the help panel: correct order, with sort keys.
  function drawHelpShelf() {
    var svg = $('help-shelf');
    if (svg.childNodes.length) return;
    var rows = [
      ['Also sprach Zarathustra', 'DE', 'Philosophy', 'Philosophy & political theory', 'Reclam'],
      ['Sein und Zeit', 'DE', 'Philosophy', 'Philosophy & political theory', 'Niemeyer'],
      ['The Trial', 'EN', 'Fiction', 'Literature (English & European)', 'Schocken'],
      ['Tristram Shandy', 'EN', 'Fiction', 'Literature (English & European)', 'Penguin Classics'],
      ['堕落論', 'JA', 'Essays', 'Japanese literature', '新潮文庫']
    ].map(function (r, i) { return rowFromFields('help-' + i, r[0], '', r[1], r[2], r[3], r[4]); });
    var books = Library.normalizeRows(rows);
    var cell = 40, h = 170, x = 4;
    var total = books.reduce(function (n, b) { return n + bookWidth(b) * cell + 6; }, 8);
    svg.setAttribute('viewBox', '0 0 ' + total + ' ' + (h + 34));
    svgEl('rect', { x: 0, y: 0, width: total, height: h + 12, fill: '#4a3323', rx: 4 }, svg);
    svgEl('rect', { x: 0, y: h + 4, width: total, height: 8, fill: '#b98a5a' }, svg);
    books.forEach(function (b) {
      var w = bookWidth(b) * cell;
      drawBook(svg, b, x, h + 4, w, h - 4, 11, false);
      var t = svgEl('text', { x: x + w / 2, y: h + 28, 'font-size': 9, 'text-anchor': 'middle', fill: '#b8a893', 'font-family': 'monospace' }, svg);
      t.textContent = keyOf(b);
      x += w + 6;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Input and loop                                                      */
  /* ------------------------------------------------------------------ */

  function handleKey(key) {
    var k = key.length === 1 ? key.toLowerCase() : key;
    if ($('help').classList.contains('show')) {
      if (k === 'h' || k === '?' || k === 'Escape') toggleHelp();
      return true;
    }
    if (k === 'h' || k === '?') { toggleHelp(); return true; }

    if (state.status === 'idle' || state.status === 'over') {
      if (k === 'Enter') { start(); return true; }
      return false;
    }
    if (k === 'p' || (k === 'Escape' && state.status !== 'selecting')) { togglePause(); return true; }
    if (state.status === 'paused') return false;

    if (state.status === 'selecting') {
      var rows = misorderedRows();
      if (k === 'ArrowUp') state.selectIndex = Math.min(rows.length - 1, state.selectIndex + 1);
      else if (k === 'ArrowDown') state.selectIndex = Math.max(0, state.selectIndex - 1);
      else if (k === 'r' || k === 'Enter') { reshelve(rows[Math.min(state.selectIndex, rows.length - 1)]); return true; }
      else if (k === 'Escape') { state.status = 'running'; state.lastFall = performance.now(); setMessage(''); }
      render();
      return true;
    }
    if (state.status !== 'running' || !state.piece) return false;

    switch (k) {
      case 'ArrowLeft': move(-1); return true;
      case 'ArrowRight': move(1); return true;
      case 'ArrowDown': softDrop(); return true;
      case ' ': hardDrop(); return true;
      case 'ArrowUp': case 'f': state.piece.flipped = !state.piece.flipped; render(); return true;
      case 'c': case 'Shift': holdPiece(); return true;
      case 'r': beginReshelve(); return true;
    }
    return false;
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) return;
    if (!ev.key) return;
    if (ev.repeat && (ev.key === ' ' || ev.key === 'Enter' || ev.key === 'Shift' || ev.key.toLowerCase() === 'c')) return;
    if (handleKey(ev.key)) ev.preventDefault();
  });

  $('touch').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button');
    if (btn) handleKey(btn.getAttribute('data-key'));
  });
  $('btn-start').addEventListener('click', start);
  $('btn-restart').addEventListener('click', start);
  $('btn-resume').addEventListener('click', togglePause);
  $('btn-help').addEventListener('click', toggleHelp);
  $('btn-help-close').addEventListener('click', toggleHelp);
  $('btn-csv').addEventListener('click', function () { $('csv-file').click(); });
  $('csv-file').addEventListener('change', function (ev) {
    if (ev.target.files && ev.target.files[0]) loadCsvFile(ev.target.files[0]);
    ev.target.value = '';
  });

  function loop(now) {
    if (state.status === 'running' && state.piece && now - state.lastFall >= gravityMs()) fall();
    requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------------------ */
  /* Test hook                                                           */
  /* ------------------------------------------------------------------ */

  function findBook(title) {
    for (var i = 0; i < state.catalog.length; i++) if (state.catalog[i].title === title) return state.catalog[i];
    throw new Error('No book titled ' + title + ' in the catalog');
  }

  window.__game = {
    CONFIG: CONFIG,
    state: state,
    start: start,
    findBook: findBook,
    bookWidth: bookWidth,
    keyOf: keyOf,
    rowStatus: rowStatus,
    fall: fall,
    hardDrop: hardDrop,
    resolveRows: resolveRows,
    finishClear: finishClear,
    reshelve: reshelve,
    handleKey: handleKey,
    // Titles per cell, null for empty. Row 0 is the top shelf.
    grid: function () {
      return state.grid.map(function (row) { return row.map(function (cell) { return cell ? cell.book.title : null; }); });
    },
    // Fill one shelf with the given titles, left to right. Widths must add
    // up to the shelf width exactly, or the row is left partly filled.
    placeRow: function (row, titles) {
      var col = 0;
      state.grid[row] = new Array(CONFIG.cols).fill(null);
      state.rowFlags[row] = { reshelved: false };
      titles.forEach(function (t) {
        var book = findBook(t);
        var w = bookWidth(book);
        if (col + w > CONFIG.cols) throw new Error('Row overflow at ' + t);
        placeInstance(row, col, book, w, false);
        col += w;
      });
      render();
      return rowStatus(row);
    },
    // Replace the falling book with a chosen one at a chosen column.
    setPiece: function (title, col) {
      var book = findBook(title);
      state.piece = { book: book, width: bookWidth(book), col: col, row: 0, flipped: false };
      state.lastFall = performance.now();
      render();
      return state.piece;
    }
  };

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  loadBest();
  emptyGrid();
  buildBoard();
  loadCatalog();
  render();
  requestAnimationFrame(loop);
})();
