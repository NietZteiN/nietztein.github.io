// Desk reading log: the shape of the private log, the projection of it that
// may become public, the statistics, and the book finder.
//
// The log is private: reading/log.json in the private repository.
//
//   {
//   	"<book id>": {
//   		"status": "read" | "reading" | "want" | "abandoned" | null,
//   		"started": "2026-09-01" | null,
//   		"finished": "2026-09-20" | null,
//   		"rating": 1..5 | null,
//   		"note": "private text",
//   		"public": { "status": false, "dates": false, "rating": false }
//   	}
//   }
//
// The book ids are those of the public catalogue (assets/data/library.json).
//
// publicProjection() is the ONLY way anything of the log leaves for the public
// site (assets/data/reading-log.json). It does not copy the log and remove
// what is private; it builds a new object from nothing and puts in only
//   - a status taken from the STATUSES list of this file,
//   - dates rebuilt from three checked numbers,
//   - a rating that is one of the numbers 1 to 5,
// and only where that book's own "public" box for that field is exactly true.
// There is no line of code that could carry the note, or any other string of
// the log, across. desk/test/test-readinglog.mjs checks that over random and
// hostile logs.
//
// Nothing here touches the DOM, the network or the clock. Loads in the
// browser (window.DeskReadingLog) and in Node (module.exports).

(function (root, factory) {
	'use strict';
	var api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else root.DeskReadingLog = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	var LOG_PATH = 'reading/log.json';
	var PUBLIC_PATH = 'assets/data/reading-log.json';
	var PUBLIC_VERSION = 1;
	var STATUSES = ['reading', 'want', 'read', 'abandoned'];
	var STATUS_LABEL = { reading: 'Reading', want: 'Want to read', read: 'Read', abandoned: 'Abandoned' };
	var NOTE_MAX = 20000;
	// Catalogue ids carry the shelf's label, which may hold brackets, commas and
	// Japanese ('N-N4(バガボンド,くず)-01' is spelled with code points below).
	var ID_RE = new RegExp('^[A-Za-z0-9][A-Za-z0-9._(),' + chr(0x3040) + '-' + chr(0x30ff) + chr(0x3400) + '-' + chr(0x9fff) + '-]{0,63}$');

	function has(obj, key) {
		return obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
	}

	function pad(n, width) {
		var s = String(n);
		while (s.length < width) s = '0' + s;
		return s;
	}

	// ---- the checks every value goes through ---------------------------------

	// A book id: what the catalogue uses ("A-A2-17"). Names that every object
	// already has (constructor, toString ...) are refused, so an id can always
	// be used as a plain key.
	function isId(id) {
		return typeof id === 'string' && ID_RE.test(id) && !(id in Object.prototype);
	}

	// -> one of STATUSES (the string from this file, not the caller's), or null
	function cleanStatus(v) {
		var i = typeof v === 'string' ? STATUSES.indexOf(v) : -1;
		return i === -1 ? null : STATUSES[i];
	}

	// -> 'YYYY-MM-DD' rebuilt from the three numbers, or null. Only real
	// calendar days between 1900 and 2199.
	function cleanDate(v) {
		if (typeof v !== 'string') return null;
		var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
		if (!m) return null;
		var y = Number(m[1]);
		var mo = Number(m[2]);
		var d = Number(m[3]);
		if (y < 1900 || y > 2199 || mo < 1 || mo > 12 || d < 1) return null;
		var leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
		var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
		if (d > days) return null;
		return pad(y, 4) + '-' + pad(mo, 2) + '-' + pad(d, 2);
	}

	// -> 1, 2, 3, 4 or 5 (a number), or null
	function cleanRating(v) {
		if (typeof v === 'string' && /^[1-5]$/.test(v)) v = Number(v);
		if (typeof v !== 'number' || v !== Math.floor(v) || v < 1 || v > 5) return null;
		return [1, 2, 3, 4, 5][v - 1];
	}

	function cleanNote(v) {
		if (typeof v !== 'string') return '';
		return v.replace(/\r\n?/g, '\n').replace(/\s+$/, '').slice(0, NOTE_MAX);
	}

	// Only the boolean true ticks a box. "yes", 1 and {} do not.
	function cleanPublic(p) {
		return {
			status: has(p, 'status') && p.status === true,
			dates: has(p, 'dates') && p.dates === true,
			rating: has(p, 'rating') && p.rating === true,
		};
	}

	function blank() {
		return { status: null, started: null, finished: null, rating: null, note: '', public: { status: false, dates: false, rating: false } };
	}

	function isEmpty(e) {
		return !e.status && !e.started && !e.finished && !e.rating && !e.note;
	}

	// -> a clean entry, or null when there is nothing in it
	function cleanEntry(raw) {
		if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
		var e = {
			status: cleanStatus(has(raw, 'status') ? raw.status : null),
			started: cleanDate(has(raw, 'started') ? raw.started : null),
			finished: cleanDate(has(raw, 'finished') ? raw.finished : null),
			rating: cleanRating(has(raw, 'rating') ? raw.rating : null),
			note: cleanNote(has(raw, 'note') ? raw.note : ''),
			public: cleanPublic(has(raw, 'public') ? raw.public : null),
		};
		return isEmpty(e) ? null : e;
	}

	// ---- the log ---------------------------------------------------------------

	// Anything -> { log, dropped }. `log` has only valid ids (sorted) and clean
	// entries; `dropped` lists the keys that were thrown away.
	function normalize(raw) {
		var log = {};
		var dropped = [];
		if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { log: log, dropped: dropped };
		Object.keys(raw)
			.sort()
			.forEach(function (id) {
				var e = isId(id) ? cleanEntry(raw[id]) : null;
				if (e) log[id] = e;
				else dropped.push(id);
			});
		return { log: log, dropped: dropped };
	}

	// The text of reading/log.json -> { log, dropped }. Throws an Error in plain
	// words when the text is not JSON or not an object.
	function parse(text) {
		var s = String(text == null ? '' : text);
		if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
		if (!s.trim()) return { log: {}, dropped: [] };
		var data;
		try {
			data = JSON.parse(s);
		} catch (e) {
			throw new Error('reading/log.json is not valid JSON (' + e.message + ').');
		}
		if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('reading/log.json does not hold a reading log: it should be an object with one entry per book id.');
		return normalize(data);
	}

	// The text to save: ids sorted, fields in a fixed order, tabs, a final newline.
	function serialize(log) {
		var clean = normalize(log).log;
		var out = {};
		Object.keys(clean).forEach(function (id) {
			var e = clean[id];
			out[id] = {
				status: e.status,
				started: e.started,
				finished: e.finished,
				rating: e.rating,
				note: e.note,
				public: { status: e.public.status, dates: e.public.dates, rating: e.public.rating },
			};
		});
		return JSON.stringify(out, null, '\t') + '\n';
	}

	// The entry of a book (a copy), or a blank one.
	function get(log, id) {
		var e = has(log, id) ? cleanEntry(log[id]) : null;
		return e || blank();
	}

	function inLog(log, id) {
		return has(log, id) && cleanEntry(log[id]) !== null;
	}

	// A new log with `patch` applied to one book. The old log is not changed.
	//   patch: { status, started, finished, rating, note, public: { status, dates, rating } }
	//   today: 'YYYY-MM-DD'. Marking a book "reading" fills in an empty start date,
	//          marking it "read" an empty finish date. Nothing is ever cleared
	//          by a change of status.
	// An entry with no status, no dates, no rating and no note is removed.
	function set(log, id, patch, today) {
		var next = normalize(log).log;
		if (!isId(id)) return next;
		var e = get(next, id);
		patch = patch || {};
		if (has(patch, 'status')) {
			var st = cleanStatus(patch.status);
			var day = cleanDate(today);
			if (st !== e.status && day) {
				if (st === 'reading' && !e.started) e.started = day;
				if (st === 'read' && !e.finished) e.finished = day;
			}
			e.status = st;
		}
		if (has(patch, 'started')) e.started = cleanDate(patch.started);
		if (has(patch, 'finished')) e.finished = cleanDate(patch.finished);
		if (has(patch, 'rating')) e.rating = cleanRating(patch.rating);
		if (has(patch, 'note')) e.note = cleanNote(patch.note);
		if (has(patch, 'public') && patch.public !== null && typeof patch.public === 'object') {
			['status', 'dates', 'rating'].forEach(function (k) {
				if (has(patch.public, k)) e.public[k] = patch.public[k] === true;
			});
		}
		if (isEmpty(e)) delete next[id];
		else next[id] = e;
		return next;
	}

	// A new log with the book's entry replaced by `entry` exactly (null removes
	// it). This is what "Undo" uses.
	function put(log, id, entry) {
		var next = normalize(log).log;
		if (!isId(id)) return next;
		var e = entry ? cleanEntry(entry) : null;
		if (e) next[id] = e;
		else delete next[id];
		return normalize(next).log;
	}

	function remove(log, id) {
		return put(log, id, null);
	}

	function sameEntry(a, b) {
		if (!a || !b) return !a && !b;
		return a.status === b.status && a.started === b.started && a.finished === b.finished && a.rating === b.rating && a.note === b.note && a.public.status === b.public.status && a.public.dates === b.public.dates && a.public.rating === b.public.rating;
	}

	// The ids whose entries differ between two logs, sorted.
	function changedIds(a, b) {
		var x = normalize(a).log;
		var y = normalize(b).log;
		var seen = {};
		var out = [];
		Object.keys(x)
			.concat(Object.keys(y))
			.forEach(function (id) {
				if (has(seen, id)) return;
				seen[id] = true;
				if (!sameEntry(has(x, id) ? x[id] : null, has(y, id) ? y[id] : null)) out.push(id);
			});
		return out.sort();
	}

	// Two devices changed the log. `theirs` is what GitHub has now, `mine` is
	// this device's log, `ids` are the books changed here since this device
	// last agreed with GitHub. -> theirs, with those books as they are here.
	function merge(theirs, mine, ids) {
		var out = normalize(theirs).log;
		var own = normalize(mine).log;
		(ids || []).forEach(function (id) {
			if (!isId(id)) return;
			if (has(own, id)) out[id] = own[id];
			else delete out[id];
		});
		return normalize(out).log;
	}

	// ---- what may become public -------------------------------------------------

	function idSet(list) {
		if (!list) return null;
		var set = {};
		if (Array.isArray(list)) {
			list.forEach(function (id) {
				if (isId(id)) set[id] = true;
			});
		} else if (typeof list === 'object') {
			Object.keys(list).forEach(function (id) {
				if (isId(id) && list[id]) set[id] = true;
			});
		}
		return set;
	}

	// The public file's content, as an object:
	//   { version: 1, books: { "<id>": { status?, started?, finished?, rating? } } }
	// A book appears only if at least one of its boxes is ticked AND that field
	// has a value. opts.knownIds (an array, or an object keyed by id) limits the
	// result to books of the catalogue.
	function publicProjection(log, opts) {
		var known = idSet(opts && opts.knownIds);
		var clean = normalize(log).log;
		var books = {};
		Object.keys(clean)
			.sort()
			.forEach(function (id) {
				if (known && !has(known, id)) return;
				var e = clean[id];
				var out = {};
				var any = false;
				if (e.public.status === true) {
					var st = cleanStatus(e.status);
					if (st) {
						out.status = st;
						any = true;
					}
				}
				if (e.public.dates === true) {
					var a = cleanDate(e.started);
					var b = cleanDate(e.finished);
					if (a) {
						out.started = a;
						any = true;
					}
					if (b) {
						out.finished = b;
						any = true;
					}
				}
				if (e.public.rating === true) {
					var r = cleanRating(e.rating);
					if (r) {
						out.rating = r;
						any = true;
					}
				}
				if (any) books[id] = out;
			});
		return { version: PUBLIC_VERSION, books: books };
	}

	// The exact text of assets/data/reading-log.json. It holds no date of its
	// own, so the same log always gives the same bytes.
	function publicText(log, opts) {
		return JSON.stringify(publicProjection(log, opts), null, '\t') + '\n';
	}

	// What the confirm dialog says: how many books, how many of each field, the
	// rows themselves, and what stays behind.
	function publicSummary(log, opts) {
		var known = idSet(opts && opts.knownIds);
		var clean = normalize(log).log;
		var books = publicProjection(log, opts).books;
		var rows = Object.keys(books).map(function (id) {
			var b = books[id];
			return { id: id, status: b.status || null, started: b.started || null, finished: b.finished || null, rating: b.rating || null };
		});
		var count = function (field) {
			return rows.filter(function (r) {
				return r[field] !== null;
			}).length;
		};
		var ids = Object.keys(clean);
		return {
			books: rows.length,
			status: count('status'),
			dates: rows.filter(function (r) {
				return r.started !== null || r.finished !== null;
			}).length,
			rating: count('rating'),
			rows: rows,
			inLog: ids.length,
			keptPrivate: ids.length - rows.length,
			notesKeptPrivate: ids.filter(function (id) {
				return !!clean[id].note;
			}).length,
			// ticked, but not a book of the catalogue: never published
			unknown: ids.filter(function (id) {
				var p = clean[id].public;
				return known && !has(known, id) && (p.status || p.dates || p.rating);
			}),
		};
	}

	// The text of a published file -> the same shape as publicProjection(), with
	// every value checked again; null when the text is not such a file.
	function readPublic(text) {
		var data;
		try {
			data = JSON.parse(String(text == null ? '' : text));
		} catch (e) {
			return null;
		}
		if (!has(data, 'books') || data.books === null || typeof data.books !== 'object' || Array.isArray(data.books)) return null;
		var books = {};
		Object.keys(data.books)
			.sort()
			.forEach(function (id) {
				var b = data.books[id];
				if (!isId(id) || b === null || typeof b !== 'object') return;
				var out = {};
				var st = cleanStatus(has(b, 'status') ? b.status : null);
				var a = cleanDate(has(b, 'started') ? b.started : null);
				var f = cleanDate(has(b, 'finished') ? b.finished : null);
				var r = cleanRating(has(b, 'rating') ? b.rating : null);
				if (st) out.status = st;
				if (a) out.started = a;
				if (f) out.finished = f;
				if (r) out.rating = r;
				if (Object.keys(out).length) books[id] = out;
			});
		return { version: PUBLIC_VERSION, books: books };
	}

	// What publishing `next` over `prev` changes: { added, removed, changed, same }
	// (lists of ids; `same` is a count). prev may be null (no file yet).
	function diffPublic(prev, next) {
		var a = (prev && prev.books) || {};
		var b = (next && next.books) || {};
		var out = { added: [], removed: [], changed: [], same: 0 };
		Object.keys(b)
			.sort()
			.forEach(function (id) {
				if (!has(a, id)) out.added.push(id);
				else if (JSON.stringify([a[id].status, a[id].started, a[id].finished, a[id].rating]) !== JSON.stringify([b[id].status, b[id].started, b[id].finished, b[id].rating])) out.changed.push(id);
				else out.same++;
			});
		Object.keys(a)
			.sort()
			.forEach(function (id) {
				if (!has(b, id)) out.removed.push(id);
			});
		return out;
	}

	// ---- statistics ---------------------------------------------------------------

	function byDateDesc(log, field, fallback) {
		return function (x, y) {
			var a = log[x][field] || (fallback ? log[x][fallback] : null) || '';
			var b = log[y][field] || (fallback ? log[y][fallback] : null) || '';
			if (a !== b) return a > b ? -1 : 1; // an empty date sorts last
			return x < y ? -1 : x > y ? 1 : 0;
		};
	}

	// The ids with this status, in the order a list shows them: what is being
	// read by start date (newest first), what was read or abandoned by finish
	// date (newest first), the rest by id. status null: entries without one.
	function listByStatus(log, status) {
		var clean = normalize(log).log;
		var ids = Object.keys(clean).filter(function (id) {
			return clean[id].status === (status || null);
		});
		if (status === 'reading') return ids.sort(byDateDesc(clean, 'started'));
		if (status === 'read' || status === 'abandoned') return ids.sort(byDateDesc(clean, 'finished', 'started'));
		return ids.sort();
	}

	// -> { total, byStatus: { reading, want, read, abandoned, none }, rated,
	//      averageRating (two decimals, or null), notes, finishedByYear: { '2026': 3 },
	//      reading: [ids], publicBooks, publicFields: { status, dates, rating } }
	function stats(log, opts) {
		var clean = normalize(log).log;
		var ids = Object.keys(clean);
		var by = { reading: 0, want: 0, read: 0, abandoned: 0, none: 0 };
		var rated = 0;
		var sum = 0;
		var notes = 0;
		var years = {};
		ids.forEach(function (id) {
			var e = clean[id];
			by[e.status || 'none']++;
			if (e.rating) {
				rated++;
				sum += e.rating;
			}
			if (e.note) notes++;
			if (e.status === 'read' && e.finished) {
				var y = e.finished.slice(0, 4);
				years[y] = (has(years, y) ? years[y] : 0) + 1;
			}
		});
		var pub = publicSummary(clean, opts);
		return {
			total: ids.length,
			byStatus: by,
			rated: rated,
			averageRating: rated ? Math.round((sum / rated) * 100) / 100 : null,
			notes: notes,
			finishedByYear: years,
			reading: listByStatus(clean, 'reading'),
			publicBooks: pub.books,
			publicFields: { status: pub.status, dates: pub.dates, rating: pub.rating },
		};
	}

	// How the books with one status (default 'read') spread over a property of
	// the catalogue: breakdown(log, books, function (b) { return b.g; }) ->
	// [{ key, count }], largest first.
	function breakdown(log, books, keyOf, status) {
		var clean = normalize(log).log;
		var want = status === undefined ? 'read' : status;
		var counts = {};
		var order = [];
		(books || []).forEach(function (b) {
			if (!b || !has(clean, b.id) || clean[b.id].status !== want) return;
			var key = String(keyOf(b) || '');
			if (!has(counts, key)) {
				counts[key] = 0;
				order.push(key);
			}
			counts[key]++;
		});
		return order
			.map(function (key) {
				return { key: key, count: counts[key] };
			})
			.sort(function (a, b) {
				return b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
			});
	}

	// ---- finding a book ----------------------------------------------------------

	function chr(code) {
		return String.fromCharCode(code);
	}

	// Built from code points, so that no invisible character has to sit in this file.
	var COMBINING = new RegExp('[' + chr(0x300) + '-' + chr(0x36f) + ']', 'g');
	var APOSTROPHES = new RegExp("['" + chr(0x2018) + chr(0x2019) + chr(0x2032) + ']', 'g');
	// ASCII punctuation, Latin-1 punctuation, general punctuation, CJK brackets
	// and stops, the katakana middle dot (full-width forms are already folded by
	// NFKC). The iteration mark (U+3005) and the long-vowel mark (U+30FC) are
	// letters and stay.
	var PUNCT = new RegExp('[!-/:-@\\[-`{-~' + chr(0xa1) + '-' + chr(0xbf) + chr(0x2010) + '-' + chr(0x2027) + chr(0x2030) + '-' + chr(0x205e) + chr(0x3000) + '-' + chr(0x3004) + chr(0x3008) + '-' + chr(0x301f) + chr(0x30fb) + ']', 'g');

	// One spelling for comparing: no accents (Soseki finds Sōseki), lower case,
	// full-width and half-width forms alike, katakana as hiragana, punctuation
	// as spaces.
	function fold(text) {
		var t = String(text == null ? '' : text);
		if (t.normalize) t = t.normalize('NFKD').replace(COMBINING, '').normalize('NFKC');
		t = t.toLowerCase();
		var out = '';
		for (var i = 0; i < t.length; i++) {
			var c = t.charCodeAt(i);
			out += c >= 0x30a1 && c <= 0x30f6 ? chr(c - 0x60) : t.charAt(i);
		}
		return out.replace(APOSTROPHES, '').replace(PUNCT, ' ').replace(/\s+/g, ' ').trim();
	}

	// books: the catalogue's records ({ id, t, a, d, pub, ty, g ... }).
	// opts.aliases: the catalogue's AUTHOR_ALIAS table ('太宰治' -> 'Osamu Dazai'),
	// so that an author is found under every spelling the catalogue knows.
	function makeIndex(books, opts) {
		var aliases = (opts && opts.aliases) || {};
		var groups = {};
		Object.keys(aliases).forEach(function (name) {
			var key = aliases[name];
			if (!has(groups, key)) groups[key] = [key];
			groups[key].push(name);
		});
		return (books || []).map(function (b, i) {
			var author = b.a || '';
			var key = has(aliases, author) ? aliases[author] : author;
			var names = has(groups, key) ? groups[key].concat([author]) : [author];
			return {
				book: b,
				at: i,
				title: fold(b.t),
				author: fold(names.join(' ')),
				more: fold([b.d, b.pub, b.ty, b.g, b.yr].join(' ')),
			};
		});
	}

	function scoreIn(hay, token, atStart, atWord, inside) {
		var pos = hay.indexOf(token);
		if (pos === -1) return 0;
		if (pos === 0) return atStart;
		// a later occurrence may start a word although the first one does not
		while (pos !== -1) {
			if (hay.charAt(pos - 1) === ' ') return atWord;
			pos = hay.indexOf(token, pos + 1);
		}
		return inside;
	}

	// Every word of the query must be found in the title, the author or the
	// catalogue's description of the book. Titles weigh most, then authors.
	// -> the matching records, best first (ties in shelf order).
	// opts.limit caps the result; an empty query returns everything in order.
	function search(index, query, opts) {
		var q = fold(query);
		var tokens = q ? q.split(' ') : [];
		var hits = [];
		(index || []).forEach(function (entry) {
			var score = 0;
			for (var i = 0; i < tokens.length; i++) {
				var t = tokens[i];
				var best = Math.max(scoreIn(entry.title, t, 120, 100, 70), scoreIn(entry.author, t, 90, 90, 60), entry.more.indexOf(t) !== -1 ? 15 : 0);
				if (!best) return;
				score += best;
			}
			if (tokens.length && entry.title === q) score += 50;
			hits.push({ entry: entry, score: score });
		});
		hits.sort(function (a, b) {
			return b.score - a.score || a.entry.at - b.entry.at;
		});
		var out = hits.map(function (h) {
			return h.entry.book;
		});
		return opts && opts.limit > 0 ? out.slice(0, opts.limit) : out;
	}

	return {
		LOG_PATH: LOG_PATH,
		PUBLIC_PATH: PUBLIC_PATH,
		PUBLIC_VERSION: PUBLIC_VERSION,
		STATUSES: STATUSES.slice(),
		STATUS_LABEL: STATUS_LABEL,
		NOTE_MAX: NOTE_MAX,
		isId: isId,
		cleanDate: cleanDate,
		cleanRating: cleanRating,
		cleanStatus: cleanStatus,
		blank: blank,
		normalize: normalize,
		parse: parse,
		serialize: serialize,
		get: get,
		inLog: inLog,
		set: set,
		put: put,
		remove: remove,
		changedIds: changedIds,
		merge: merge,
		publicProjection: publicProjection,
		publicText: publicText,
		publicSummary: publicSummary,
		readPublic: readPublic,
		diffPublic: diffPublic,
		listByStatus: listByStatus,
		stats: stats,
		breakdown: breakdown,
		fold: fold,
		makeIndex: makeIndex,
		search: search,
	};
});
