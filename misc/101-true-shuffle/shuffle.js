/*
 * True Shuffle: the listening modes and the queue.
 *
 * Everything here is a pure function. A mode takes the tracks (library.js
 * records; only a few fields are read), a random source and its options, and
 * returns an order: a list of track ids. Nothing reads the clock or
 * Math.random(): the random source is rng(seed), which gives the same numbers
 * for the same seed for ever, or cryptoRng(), which asks the browser.
 *
 *   select(tracks, sel, now)        which tracks: facets, text, length, recency
 *   trueShuffle(ids, rand)          a uniformly random order (Fisher-Yates)
 *   bagCreate / bagNext / bagSync   the same, as a bag that survives reloads
 *   spreadShuffle(tracks, rand)     random, artists kept apart and spread evenly
 *   freshFirst / newestFirst        never played first; newest additions first
 *   favourites / neglected          weighted by rating and plays, or against
 *   artistRotation / genreBlocks    one per artist in turn; n of a genre at a time
 *   keepRuns(order, byId)           numbered parts stay together, in order
 *   limit(order, byId, lim)         stop after n tracks or m minutes
 *   build(tracks, plan, ctx)        all of the above, composed
 *   queue(state, action)            the play queue, as a reducer
 *
 * README.md states the property each mode keeps; test.js checks them.
 *
 * UMD: window.TrueShuffle.shuffle in the browser, module.exports in Node.
 */
(function (root, factory) {
	var api = factory(root);
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.shuffle = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
	'use strict';

	var DAY = 86400000, HOUR = 3600000;

	// ---- Random sources ----------------------------------------------------------

	// A 128-bit hash of a string (cyrb128) seeding a 128-bit generator (sfc32,
	// from PractRand). Both are public domain. With 128 bits of state a seed
	// can reach far more orders than a 32-bit generator could.
	function hash128(text) {
		text = String(text);
		var h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
		for (var i = 0, k; i < text.length; i++) {
			k = text.charCodeAt(i);
			h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
			h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
			h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
			h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
		}
		h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
		h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
		h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
		h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
		h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
		return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
	}

	// Dress a function that returns unsigned 32-bit integers as a source:
	//   r()        a number in [0, 1)
	//   r.u32()    an unsigned 32-bit integer
	//   r.int(n)   an integer in 0..n-1, every value equally likely (values that
	//              would favour the low numbers are thrown away and drawn again)
	function dress(u32, seed) {
		var r = function () { return u32() / 4294967296; };
		r.u32 = u32;
		r.int = function (n) {
			n = Math.floor(n);
			if (!(n > 1)) return 0;
			if (n > 4294967296) throw new Error('int(n): n is too large');
			var limit = 4294967296 - (4294967296 % n), x;
			do { x = u32(); } while (x >= limit);
			return x % n;
		};
		r.seed = seed;
		return r;
	}

	// rng('2026-10-05') gives the same numbers on every machine, every time.
	function rng(seed) {
		var s = hash128(seed == null ? '' : seed), a = s[0], b = s[1], c = s[2], d = s[3];
		function u32() {
			a |= 0; b |= 0; c |= 0; d |= 0;
			var t = (a + b | 0) + d | 0;
			d = d + 1 | 0;
			a = b ^ b >>> 9;
			b = c + (c << 3) | 0;
			c = (c << 21 | c >>> 11);
			c = c + t | 0;
			return t >>> 0;
		}
		for (var i = 0; i < 15; i++) u32();
		return dress(u32, String(seed == null ? '' : seed));
	}

	// Numbers from the browser's (or Node's) cryptographic generator.
	function cryptoRng() {
		var c = root.crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
		if (!c || !c.getRandomValues) throw new Error('No cryptographic random source here.');
		var buf = new Uint32Array(64), at = 64;
		return dress(function () {
			if (at >= 64) { c.getRandomValues(buf); at = 0; }
			return buf[at++];
		}, null);
	}

	// A seed gives rng(seed); no seed gives the cryptographic source.
	function source(seed) { return seed == null || seed === '' ? cryptoRng() : rng(seed); }

	// A short random seed, for "shuffle again" when the order should still be
	// reproducible afterwards.
	function newSeed() {
		var r = cryptoRng();
		return (r.u32().toString(36) + r.u32().toString(36)).slice(0, 10);
	}

	// ---- Small helpers --------------------------------------------------------------

	function ids(tracks) { return tracks.map(function (t) { return typeof t === 'string' ? t : t.id; }); }
	function index(tracks) { var m = {}; tracks.forEach(function (t) { m[t.id] = t; }); return m; }
	function time(v) { var t = v ? Date.parse(v) : NaN; return isNaN(t) ? 0 : t; }
	function fold(s) {
		return String(s == null ? '' : s).normalize('NFKD').replace(/[\u0300-\u036F]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
	}
	function lastAdded(t) {
		var best = 0;
		for (var k in (t.addedAt || {})) { var x = time(t.addedAt[k]); if (x > best) best = x; }
		return best;
	}
	// When the track first came into the library (its earliest playlist addition).
	function firstAdded(t) {
		var best = 0;
		for (var k in (t.addedAt || {})) { var x = time(t.addedAt[k]); if (x && (!best || x < best)) best = x; }
		return best;
	}
	// Its year and month, as the keys the 'added' choice takes: '2021', '2021-05' (UTC).
	function addedKeys(t) {
		var f = firstAdded(t);
		if (!f) return ['', ''];
		var iso = new Date(f).toISOString();
		return [iso.slice(0, 4), iso.slice(0, 7)];
	}
	// The same classes as library.js's lengthClass (test.js checks they agree).
	function lengthClass(sec) {
		sec = +sec || 0;
		if (sec <= 0) return 'unknown';
		return sec < 150 ? 'short' : sec <= 300 ? 'medium' : sec <= 600 ? 'long' : 'epic';
	}
	function channelKey(t) { return t.channelId || (t.channel ? 'name:' + fold(t.channel).replace(/ /g, '') : ''); }
	// Who a track counts as for "not the same artist twice": library.js's
	// spreadKey (its sure artist, or its channel marked "~" when the artist is
	// a guess or unknown), worked out here for tracks that lack the field.
	function artistKey(t) { return t.spreadKey || t.artistKey || ('~' + (channelKey(t) || t.id)); }
	// The key the artist filter matches: a sure artist, or a guess's channel
	// (the facet library.js lists as "Channel (guess)"), or '' for unknown.
	function artistFacetKey(t) { return t.artistKey || (t.artistGuess ? artistKey(t) : ''); }
	function playable(t) { return !t.removed && t.embeddable !== false && !t.playerError; }

	// ---- Choosing the tracks ------------------------------------------------------------

	function has(list, v) { return list.indexOf(v) >= 0; }
	function any(list, values) { for (var i = 0; i < values.length; i++) if (has(list, values[i])) return true; return false; }
	function on(list) { return Array.isArray(list) && list.length > 0; }

	function facetMatch(t, f) {
		if (on(f.artists) && !has(f.artists, artistFacetKey(t))) return false;
		if (on(f.genres) && !(t.genres && t.genres.length ? any(f.genres, t.genres) : has(f.genres, ''))) return false;
		if (on(f.decades) && !has(f.decades, t.decade || '')) return false;
		if (on(f.playlists) && !any(f.playlists, t.playlists || [])) return false;
		if (on(f.channels) && !has(f.channels, channelKey(t))) return false;
		if (on(f.lengths) && !has(f.lengths, lengthClass(t.durationSec))) return false;
		if (on(f.tags) && !any(f.tags, t.tags || [])) return false;
		for (var i = 0; i < LABEL_FACETS.length; i++) {
			var k = LABEL_FACETS[i];
			if (on(f[k[0]]) && !has(f[k[0]], t[k[1]] || '')) return false;
		}
		if (on(f.added) && !any(f.added, addedKeys(t))) return false;
		return true;
	}
	// The label facets: the selection's key and the track's field.
	var LABEL_FACETS = [['scenes', 'scene'], ['works', 'work'], ['langs', 'lang'], ['moods', 'mood'], ['kinds', 'kind'], ['roles', 'role']];
	function labelHit(t, f) {
		for (var i = 0; i < LABEL_FACETS.length; i++) {
			var k = LABEL_FACETS[i];
			if (on(f[k[0]]) && has(f[k[0]], t[k[1]] || '')) return true;
		}
		return false;
	}
	function facetHit(t, f) {
		return (on(f.artists) && has(f.artists, artistFacetKey(t))) ||
			(on(f.genres) && (t.genres && t.genres.length ? any(f.genres, t.genres) : has(f.genres, ''))) ||
			(on(f.decades) && has(f.decades, t.decade || '')) ||
			(on(f.playlists) && any(f.playlists, t.playlists || [])) ||
			(on(f.channels) && has(f.channels, channelKey(t))) ||
			(on(f.tags) && any(f.tags, t.tags || [])) ||
			(on(f.added) && any(f.added, addedKeys(t))) ||
			labelHit(t, f);
	}

	// The tracks a selection picks. Within one facet the choices are
	// alternatives (rock OR jazz); different facets must all hold (rock or
	// jazz, AND the 1990s, AND this playlist). sel:
	//   artists, genres, decades, playlists, channels, lengths, tags   lists of facet keys
	//   scenes, works, langs, moods, kinds, roles                      the labels' values ('' unlabelled)
	//   added                               years ('2021') or months ('2021-05') a track was first added in
	//   addedFrom, addedTo                  first added between these days (ISO dates, both included)
	//   not: { artists, genres, decades, playlists, channels, tags, scenes, works, langs, moods, kinds, roles }   leave these out
	//   neverPlayed, addedThisMonth         true to require
	//   addedWithinDays, minRating          numbers
	//   text                                words that must all occur
	//   minSec, maxSec                      skip shorter or longer tracks
	//   notPlayedWithinHours                skip what was played that recently
	//   includeBlocked, includeUnplayable   false by default: blocked, removed and
	//                                       non-embeddable tracks are skipped
	function select(tracks, sel, now) {
		sel = sel || {};
		now = now == null ? Date.now() : now;
		var terms = sel.text ? fold(sel.text).split(' ').filter(Boolean) : [];
		var month = new Date(now);
		return tracks.filter(function (t) {
			if (!sel.includeBlocked && t.blocked) return false;
			if (!sel.includeUnplayable && !playable(t)) return false;
			if (!facetMatch(t, sel)) return false;
			if (sel.not && facetHit(t, sel.not)) return false;
			if (sel.neverPlayed && t.plays > 0) return false;
			if (sel.minRating && !((t.rating || 0) >= sel.minRating)) return false;
			if (sel.minSec != null && !(t.durationSec >= sel.minSec)) return false;
			if (sel.maxSec != null && !(t.durationSec <= sel.maxSec)) return false;
			if (sel.addedFrom || sel.addedTo) {
				var fa = firstAdded(t);
				if (!fa || (sel.addedFrom && fa < time(sel.addedFrom)) || (sel.addedTo && fa >= time(sel.addedTo) + DAY)) return false;
			}
			if (sel.notPlayedWithinHours && t.lastPlayed && now - time(t.lastPlayed) < sel.notPlayedWithinHours * HOUR) return false;
			if (sel.addedThisMonth || sel.addedWithinDays) {
				var added = lastAdded(t);
				if (!added) return false;
				if (sel.addedThisMonth) { var d = new Date(added); if (d.getFullYear() !== month.getFullYear() || d.getMonth() !== month.getMonth()) return false; }
				if (sel.addedWithinDays && now - added > sel.addedWithinDays * DAY) return false;
			}
			if (terms.length) {
				var hay = ' ' + fold([t.title, t.titleAlt || '', t.artist, t.artistNative || '', t.work || '', (t.feat || []).join(' '), t.album, t.channel, t.versionText || t.version, (t.genres || []).join(' '), (t.tags || []).join(' ')].join(' ')) + ' ';
				for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) < 0) return false;
			}
			return true;
		});
	}

	// ---- True shuffle -------------------------------------------------------------------

	// Fisher-Yates: every order of the list is equally likely. Returns a copy.
	function trueShuffle(list, rand) {
		var out = ids(list);
		for (var i = out.length - 1; i > 0; i--) {
			var j = rand.int(i + 1);
			var t = out[i]; out[i] = out[j]; out[j] = t;
		}
		return out;
	}

	// The bag: one shuffled pass through the selection, remembered. Nothing
	// repeats until everything has played; then the bag is refilled. It is a
	// plain object, so it can be stored and picked up in another session.
	//   { v, order: [ids], pos, cycle, last, gone? }
	// gone: ids drawn this round that have since left the bag (blocked, found
	// unplayable, out of the selection). If one comes back during the round it
	// goes back among the played, not among what is still to come.
	function bagCreate(list, rand) {
		return { v: 1, order: trueShuffle(list, rand), pos: 0, cycle: 1, last: null };
	}
	function bagCopy(bag) {
		var b = { v: 1, order: bag.order.slice(), pos: bag.pos, cycle: bag.cycle, last: bag.last };
		if (bag.gone && bag.gone.length) b.gone = bag.gone.slice();
		return b;
	}
	function bagRemaining(bag) { return bag.order.slice(bag.pos); }
	function bagPlayed(bag) { return bag.order.slice(0, bag.pos); }

	// Draw the next track. -> { id, bag } (a new bag; the one passed in is not
	// changed). id is null for an empty bag. When a pass is finished the bag is
	// shuffled again; the new pass never opens with the track that closed the
	// last one.
	function bagNext(bag, rand) {
		var b = bagCopy(bag);
		if (!b.order.length) return { id: null, bag: b };
		if (b.pos >= b.order.length) {
			b.order = trueShuffle(b.order, rand);
			if (b.order.length > 1 && b.order[0] === b.last) {
				var j = 1 + rand.int(b.order.length - 1);
				var t = b.order[0]; b.order[0] = b.order[j]; b.order[j] = t;
			}
			b.pos = 0;
			b.cycle++;
			delete b.gone;
		}
		var id = b.order[b.pos++];
		b.last = id;
		return { id: id, bag: b };
	}
	// Draw up to n tracks at once (to fill a queue). -> { ids, bag }
	function bagTake(bag, n, rand) {
		var out = [], b = bag;
		for (var i = 0; i < n; i++) {
			var r = bagNext(b, rand);
			if (r.id == null) break;
			out.push(r.id);
			b = r.bag;
		}
		return { ids: out, bag: b };
	}
	// New tracks go in at random places among what is still to come, so they
	// are neither all next nor all last. Ids already in the bag are ignored.
	// A track that was drawn this round and left (bag.gone) goes back among
	// the played ones.
	function bagAdd(bag, list, rand) {
		var b = bagCopy(bag), have = {};
		b.order.forEach(function (id) { have[id] = true; });
		ids(list).forEach(function (id) {
			if (have[id]) return;
			have[id] = true;
			var g = b.gone ? b.gone.indexOf(id) : -1;
			if (g >= 0) {
				b.gone.splice(g, 1);
				if (!b.gone.length) delete b.gone;
				b.order.splice(rand.int(b.pos + 1), 0, id);
				b.pos++;
				return;
			}
			var at = b.pos + rand.int(b.order.length - b.pos + 1);
			b.order.splice(at, 0, id);
		});
		return b;
	}
	// Take tracks out. Those already drawn this round are remembered in
	// bag.gone, unless forget is true.
	function bagRemove(bag, list, forget) {
		var b = bagCopy(bag), gone = {}, order = [], pos = b.pos, memo = b.gone ? b.gone.slice() : [], inMemo = {};
		memo.forEach(function (id) { inMemo[id] = true; });
		ids(list).forEach(function (id) { gone[id] = true; });
		b.order.forEach(function (id, i) {
			if (gone[id]) {
				if (i < b.pos) { pos--; if (!forget && !inMemo[id]) { inMemo[id] = true; memo.push(id); } }
				return;
			}
			order.push(id);
		});
		b.order = order;
		b.pos = pos;
		if (memo.length) b.gone = memo; else delete b.gone;
		return b;
	}
	// Tracks drawn but never heard (a queue that was replaced) go back among
	// what is still to come, at random places.
	function bagReturn(bag, list, rand) {
		var played = {}, back = [];
		bagPlayed(bag).forEach(function (id) { played[id] = true; });
		ids(list).forEach(function (id) { if (played[id] && back.indexOf(id) < 0) back.push(id); });
		return back.length ? bagAdd(bagRemove(bag, back, true), back, rand) : bagCopy(bag);
	}
	// With keep-runs on: the track just drawn (bag.order[pos - 1]) belongs to
	// a run whose parts in the bag are members, in part order. The run plays
	// where its first unplayed part falls: drawing that part pulls the other
	// unplayed parts in right behind it; drawing a later part first moves it
	// to just after the first one and draws nothing. Only the order of what is
	// still to come changes, so nothing repeats within a round.
	// -> { bag, id } with id null when the draw was put off.
	function bagRunDraw(bag, members) {
		var b = bagCopy(bag), at = b.pos - 1, drawn = b.order[at];
		var rest = (members || []).filter(function (id) { return b.order.indexOf(id) >= at; });
		if (at < 0 || rest.length < 2 || rest.indexOf(drawn) < 0) return { bag: b, id: drawn == null ? null : drawn };
		if (drawn !== rest[0]) {
			b.order.splice(at, 1);
			b.order.splice(b.order.indexOf(rest[0]) + 1, 0, drawn);
			b.pos = at;
			b.last = at > 0 ? b.order[at - 1] : null;
			return { bag: b, id: null };
		}
		var others = rest.slice(1);
		b.order = b.order.filter(function (id) { return others.indexOf(id) < 0; });
		Array.prototype.splice.apply(b.order, [at + 1, 0].concat(others));
		return { bag: b, id: drawn };
	}
	// Make the bag hold exactly this selection: what left the selection leaves
	// the bag, what is new goes in at random places among what is left.
	// -> { bag, added: [ids], removed: [ids] }
	function bagSync(bag, list, rand) {
		var want = {}, have = {}, added = [], removed = [], listed = ids(list);
		listed.forEach(function (id) { want[id] = true; });
		bag.order.forEach(function (id) { have[id] = true; if (!want[id]) removed.push(id); });
		// `have` doubles as the set of ids already added: linear, not quadratic
		// (8,800 new tracks took 0.7 s with a list search)
		listed.forEach(function (id) { if (!have[id]) { have[id] = true; added.push(id); } });
		var b = removed.length ? bagRemove(bag, removed) : bagCopy(bag);
		if (added.length) b = bagAdd(b, added, rand);
		return { bag: b, added: added, removed: removed };
	}

	// ---- Spread shuffle -----------------------------------------------------------------

	// Random, but an artist's tracks are spaced evenly through the order, and
	// the same artist never plays twice in a row as long as some order without
	// such a repeat exists (that is, unless one artist has more than half of
	// the tracks, rounded up). When no such order exists the repeats cannot be
	// avoided: they are spread out, and every other track is used to separate
	// two tracks of the dominant artist.
	//
	// How: each artist's tracks are shuffled and given evenly spaced target
	// positions with a random offset; the tracks are then taken in order of
	// target, skipping any pick that would repeat the artist or leave a
	// remainder that cannot be arranged without a repeat.
	//
	// opts: { key: function (track) -> group key, after: key of the track that
	// plays just before this order }
	function spreadShuffle(tracks, rand, opts) {
		opts = opts || {};
		var keyOf = opts.key || artistKey;
		var groups = {}, names = [], n = tracks.length, i;
		tracks.forEach(function (t) {
			var k = keyOf(t);
			if (!groups[k]) { groups[k] = []; names.push(k); }
			groups[k].push(t.id);
		});
		// Targets in [0, 1): member i of a group of k sits at (i + offset) / k.
		var slots = [];
		names.forEach(function (k) {
			var members = trueShuffle(groups[k], rand), size = members.length, offset = rand();
			for (var j = 0; j < size; j++) {
				var jitter = (rand() - 0.5) * 0.3 / size;
				slots.push({ id: members[j], key: k, at: (j + offset) / size + jitter, tie: rand() });
			}
		});
		slots.sort(function (a, b) { return a.at - b.at || a.tie - b.tie; });

		var left = {}, byCount = [], maxCount = 0;
		names.forEach(function (k) {
			var c = groups[k].length;
			left[k] = c;
			byCount[c] = (byCount[c] || 0) + 1;
			if (c > maxCount) maxCount = c;
		});
		function take(k) {
			var c = left[k];
			byCount[c]--;
			left[k] = c - 1;
			byCount[c - 1] = (byCount[c - 1] || 0) + 1;
			while (maxCount > 0 && !byCount[maxCount]) maxCount--;
		}
		// The largest count among the groups other than k.
		function maxOther(k) {
			if (left[k] !== maxCount || byCount[maxCount] > 1) return maxCount;
			for (var c = maxCount - 1; c > 0; c--) if (byCount[c]) return c;
			return 0;
		}
		// After playing k with R tracks left in all, can the rest be arranged
		// without a repeat? The rest has R-1 tracks and may not start with k.
		function okAfter(k, R) {
			var rest = R - 1;
			return left[k] - 1 <= Math.floor(rest / 2) && maxOther(k) <= Math.ceil(rest / 2);
		}

		var out = [], used = new Array(n), head = 0, last = opts.after == null ? null : opts.after, R = n;
		while (R > 0) {
			while (used[head]) head++;
			var pick = -1;
			for (i = head; i < n; i++) {
				if (used[i]) continue;
				var k = slots[i].key;
				if (k === last) continue;
				if (okAfter(k, R)) { pick = i; break; }
			}
			if (pick < 0) {
				// No pick keeps the rest arrangeable: one artist dominates.
				// After a track of another artist comes the dominant one;
				// otherwise the earliest target wins, whoever it is.
				var dominant = null;
				for (i = head; i < n; i++) if (!used[i] && left[slots[i].key] === maxCount) { dominant = slots[i].key; break; }
				if (last !== dominant) { for (i = head; i < n; i++) if (!used[i] && slots[i].key === dominant) { pick = i; break; } }
				if (pick < 0) pick = head;
			}
			used[pick] = true;
			out.push(slots[pick].id);
			last = slots[pick].key;
			take(last);
			R--;
		}
		return out;
	}

	// How many times an order plays the same artist twice in a row.
	function adjacentRepeats(order, byId, keyOf) {
		keyOf = keyOf || artistKey;
		var count = 0;
		for (var i = 1; i < order.length; i++) if (keyOf(byId[order[i]]) === keyOf(byId[order[i - 1]])) count++;
		return count;
	}
	// Can these tracks be ordered with no artist twice in a row?
	function canSeparate(tracks, keyOf) {
		keyOf = keyOf || artistKey;
		var counts = {}, max = 0;
		tracks.forEach(function (t) { var k = keyOf(t); counts[k] = (counts[k] || 0) + 1; if (counts[k] > max) max = counts[k]; });
		return max <= Math.ceil(tracks.length / 2);
	}

	// ---- Fresh, favourites ------------------------------------------------------------------

	// Shuffle, then a stable sort: ties come out in random order.
	function shuffledSort(tracks, rand, compare) {
		var byId = index(tracks);
		var order = trueShuffle(tracks, rand).map(function (id, i) { return { t: byId[id], i: i }; });
		order.sort(function (a, b) { return compare(a.t, b.t) || a.i - b.i; });
		return order.map(function (o) { return o.t.id; });
	}

	// Never played first (in random order), then the rest from the one played
	// longest ago to the one played most recently.
	function freshFirst(tracks, rand) {
		return shuffledSort(tracks, rand, function (a, b) {
			var pa = a.plays > 0 ? 1 : 0, pb = b.plays > 0 ? 1 : 0;
			if (pa !== pb) return pa - pb;
			return pa ? time(a.lastPlayed) - time(b.lastPlayed) : 0;
		});
	}
	// Newest additions first (by the date a track was last added to a
	// playlist); tracks added at the same moment come in random order.
	function newestFirst(tracks, rand) {
		return shuffledSort(tracks, rand, function (a, b) { return lastAdded(b) - lastAdded(a); });
	}

	// A random order in which a track with weight 2 tends to come before one
	// with weight 1: each position is drawn from what is left with probability
	// proportional to weight (Efraimidis and Spirakis's keys).
	function weightedOrder(tracks, rand, weight) {
		var keyed = tracks.map(function (t) {
			var w = Math.max(1e-9, +weight(t) || 0), u = rand();
			return { id: t.id, key: -Math.log(u > 0 ? u : 1e-300) / w };
		});
		keyed.sort(function (a, b) { return a.key - b.key || (a.id < b.id ? -1 : 1); });
		return keyed.map(function (k) { return k.id; });
	}

	var RATING_WEIGHT = [1, 0.1, 0.4, 1, 2.5, 6];   // unrated, then one to five stars
	// What he likes: the rating, lifted by plays, lowered by skips.
	function favouriteWeight(t) {
		var plays = t.plays || 0, skips = t.skips || 0;
		return RATING_WEIGHT[t.rating || 0] * (1 + Math.log(1 + plays) / Math.LN2) / (1 + skips / (plays + 1));
	}
	// What he has neglected: few plays, long since the last one. A low rating
	// still counts against a track (it was neglected on purpose).
	function neglectedWeight(t, now) {
		var plays = t.plays || 0;
		var idle = !plays || !t.lastPlayed ? 4 : Math.min(4, 1 + (now - time(t.lastPlayed)) / (30 * DAY));
		var liked = t.rating === 1 ? 0.2 : t.rating === 2 ? 0.6 : 1;
		return liked * idle / (1 + plays);
	}
	function favourites(tracks, rand) { return weightedOrder(tracks, rand, favouriteWeight); }
	function neglected(tracks, rand, now) {
		now = now == null ? Date.now() : now;
		return weightedOrder(tracks, rand, function (t) { return neglectedWeight(t, now); });
	}

	// ---- Rotation ---------------------------------------------------------------------------

	// One track per artist in turn: the artists in a random order, each
	// artist's tracks in a random order, round after round until all are out.
	function artistRotation(tracks, rand, opts) {
		var keyOf = (opts && opts.key) || artistKey, groups = {}, names = [];
		tracks.forEach(function (t) {
			var k = keyOf(t);
			if (!groups[k]) { groups[k] = []; names.push(k); }
			groups[k].push(t.id);
		});
		names = trueShuffle(names, rand);
		var most = 0;
		names.forEach(function (k) { groups[k] = trueShuffle(groups[k], rand); most = Math.max(most, groups[k].length); });
		var out = [];
		for (var round = 0; round < most; round++) names.forEach(function (k) { if (round < groups[k].length) out.push(groups[k][round]); });
		return out;
	}

	// Blocks of one genre: `size` tracks of a genre, then another genre, and so
	// on. A track with several genres is filed under one of them at random; a
	// track with none is filed under ''. The next genre is drawn with a chance
	// proportional to what it has left, never the same genre twice running
	// while another has tracks. -> [{ genre, ids }]
	function genreBlockList(tracks, rand, opts) {
		var size = Math.max(1, Math.floor((opts && opts.size) || 3)), pools = {}, names = [];
		tracks.forEach(function (t) {
			var g = t.genres && t.genres.length ? t.genres[rand.int(t.genres.length)] : '';
			if (!pools[g]) { pools[g] = []; names.push(g); }
			pools[g].push(t.id);
		});
		names.sort();
		names.forEach(function (g) { pools[g] = trueShuffle(pools[g], rand); });
		var blocks = [], last = null, left = tracks.length;
		while (left > 0) {
			var open = names.filter(function (g) { return pools[g].length > 0 && g !== last; });
			if (!open.length) open = names.filter(function (g) { return pools[g].length > 0; });
			var total = 0, i;
			for (i = 0; i < open.length; i++) total += pools[open[i]].length;
			var x = rand.int(total), g = open[open.length - 1];
			for (i = 0; i < open.length; i++) { x -= pools[open[i]].length; if (x < 0) { g = open[i]; break; } }
			var take = pools[g].splice(0, size);
			blocks.push({ genre: g, ids: take });
			left -= take.length;
			last = g;
		}
		return blocks;
	}
	function genreBlocks(tracks, rand, opts) {
		var out = [];
		genreBlockList(tracks, rand, opts).forEach(function (b) { out = out.concat(b.ids); });
		return out;
	}

	// Numbered runs stay together: where the first track of a run comes up, the
	// whole run plays there, in order (part 1, 2, 3). A run is the tracks that
	// share track.run.key; library.js sets it for numbered parts of one work.
	// A run of more than MAX_RUN parts (a series of forty episodes) is not a
	// work to hear in one sitting and is shuffled like separate tracks.
	var MAX_RUN = 10;
	function keepRuns(order, byId) {
		var runs = {};
		order.forEach(function (id) {
			var t = byId[id];
			if (t && t.run && t.run.key) (runs[t.run.key] || (runs[t.run.key] = [])).push(t);
		});
		var out = [], done = {};
		order.forEach(function (id) {
			if (done[id]) return;
			var t = byId[id], run = t && t.run && runs[t.run.key];
			if (!run || run.length < 2 || run.length > MAX_RUN) { out.push(id); done[id] = true; return; }
			run.slice().sort(function (a, b) { return a.run.n - b.run.n || (a.id < b.id ? -1 : 1); }).forEach(function (m) { out.push(m.id); done[m.id] = true; });
		});
		return out;
	}

	// The same idea before the shuffle instead of after it: each run of two or
	// more is folded into its first part. -> { units: [tracks], members: {
	// id of the first part: [ids of the whole run, in order] } }
	function foldRuns(tracks) {
		var runs = {}, units = [], members = {};
		tracks.forEach(function (t) { if (t.run && t.run.key) (runs[t.run.key] || (runs[t.run.key] = [])).push(t); });
		Object.keys(runs).forEach(function (k) { runs[k].sort(function (a, b) { return a.run.n - b.run.n || (a.id < b.id ? -1 : 1); }); });
		tracks.forEach(function (t) {
			var run = t.run && t.run.key ? runs[t.run.key] : null;
			if (!run || run.length < 2 || run.length > MAX_RUN) { units.push(t); return; }
			if (run[0] !== t) return;
			units.push(t);
			members[t.id] = run.map(function (m) { return m.id; });
		});
		return { units: units, members: members };
	}
	function unfoldRuns(order, members) {
		var out = [];
		order.forEach(function (id) { if (members[id]) out = out.concat(members[id]); else out.push(id); });
		return out;
	}

	// ---- Limits -----------------------------------------------------------------------------

	// Stop after `maxTracks` tracks or `maxMinutes` minutes, whichever comes
	// first. A track is in only if it ends within the minutes; the order stops
	// at the first track that would run over.
	// -> { order, seconds, stoppedBy: 'tracks' | 'minutes' | null }
	function limit(order, byId, lim) {
		lim = lim || {};
		var maxTracks = lim.maxTracks > 0 ? Math.floor(lim.maxTracks) : Infinity;
		var maxSec = lim.maxMinutes > 0 ? lim.maxMinutes * 60 : Infinity;
		var out = [], seconds = 0, stoppedBy = null;
		for (var i = 0; i < order.length; i++) {
			if (out.length >= maxTracks) { stoppedBy = 'tracks'; break; }
			var d = (byId[order[i]] && +byId[order[i]].durationSec) || 0;
			if (seconds + d > maxSec) { stoppedBy = 'minutes'; break; }
			out.push(order[i]);
			seconds += d;
		}
		return { order: out, seconds: seconds, stoppedBy: stoppedBy };
	}

	// ---- All of it, composed --------------------------------------------------------------------

	var MODES = [
		{ key: 'true', name: 'True shuffle', blurb: 'Every order equally likely. Nothing repeats until everything has played.' },
		{ key: 'spread', name: 'Spread shuffle', blurb: 'Random, but an artist never plays twice in a row and is spread evenly.' },
		{ key: 'fresh', name: 'Fresh first', blurb: 'Never played first, then what you have not heard for longest.' },
		{ key: 'newest', name: 'Newest first', blurb: 'The latest additions to your playlists first.' },
		{ key: 'favourites', name: 'Favourites', blurb: 'Random, weighted toward what you rate highly and play often.' },
		{ key: 'neglected', name: 'Neglected', blurb: 'Random, weighted toward what you rarely play.' },
		{ key: 'artists', name: 'Artist rotation', blurb: 'One track per artist, in turn.' },
		{ key: 'genres', name: 'Genre blocks', blurb: 'A few tracks of one genre, then another genre.' },
		{ key: 'flow', name: 'Mood flow', blurb: 'Each song leads to one that sounds close to it, so the mood drifts instead of jumping.' }
	];

	// One listening plan, start to finish:
	//   1. select(tracks, plan.select, now)      which tracks
	//   2. the mode                               in what order (with plan.keepRuns each
	//                                             numbered run goes through the mode as one
	//                                             unit and is unfolded after it)
	//   3. limit(plan.limits)                     where to stop
	// plan: { select, mode, blockSize, keepRuns, limits: { maxTracks, maxMinutes }, seed }
	// ctx:  { now, rand, after }. With a seed the same plan over the same
	// tracks gives the same order; without one the cryptographic source is
	// used. -> { order, mode, seed, selected, seconds, stoppedBy, blocks }
	// ---- Works apart, one version, mood flow --------------------------------------------------

	// The work a track comes from, as a key ('' for none): two songs of one
	// anime are kept apart like two songs of one artist.
	function workKey(t) { return t && t.work ? 'w:' + fold(t.work).replace(/ /g, '') : ''; }
	// One song in all its versions (the original, a piano cover, a live take,
	// an orchestral arrangement): the folded title and the original artist,
	// else the artist, else the channel.
	function songKey(t) {
		var who = t.origArtist ? fold(t.origArtist).replace(/ /g, '') : (t.artistKey || artistKey(t));
		return fold(t.title || (t.raw && t.raw.title) || t.id).replace(/ /g, '') + '|' + who;
	}
	// Repair an order so that no two neighbours share any of the keys (an
	// artist, a work) where a swap with a track up to `reach` places later can
	// fix it. The order stays a permutation; what cannot be fixed stays.
	function apart(order, byId, keys, reach) {
		var out = order.slice(), n = out.length, R = reach || 60;
		keys = keys || [artistKey, workKey];
		function clash(a, b) {
			var x = byId[a], y = byId[b];
			if (!x || !y) return false;
			for (var k = 0; k < keys.length; k++) { var p = keys[k](x), q = keys[k](y); if (p && p === q) return true; }
			return false;
		}
		for (var i = 1; i < n; i++) {
			if (!clash(out[i - 1], out[i])) continue;
			for (var j = i + 1; j < Math.min(n, i + R); j++) {
				if (clash(out[i - 1], out[j])) continue;
				if (i + 1 < n && j !== i + 1 && clash(out[j], out[i + 1])) continue;
				var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
				break;
			}
		}
		return out;
	}
	// Keep one version of each song (songKey): the plain recording twice as
	// likely as a cover or arrangement, a rated one more likely still.
	function oneVersion(tracks, rand) {
		var groups = {}, keys = [];
		tracks.forEach(function (t) { var k = songKey(t); if (!groups[k]) { groups[k] = []; keys.push(k); } groups[k].push(t); });
		return keys.map(function (k) {
			var g = groups[k];
			if (g.length === 1) return g[0];
			var w = g.map(function (t) { return (t.version ? 1 : 2) * (1 + (t.rating || 0) / 2); }), sum = 0, i;
			for (i = 0; i < w.length; i++) sum += w[i];
			var r = rand() * sum;
			for (i = 0; i < g.length; i++) { r -= w[i]; if (r <= 0) return g[i]; }
			return g[g.length - 1];
		});
	}
	// How alike two tracks are by their labels: shared genres most, then the
	// mood (the same, or a neighbour on the ring), scene and language.
	var MOOD_RING = ['tender', 'wistful', 'dark', 'driving', 'bright', 'quirky'];
	function moodDistance(a, b) {
		var i = MOOD_RING.indexOf(a), j = MOOD_RING.indexOf(b);
		if (i < 0 || j < 0) return 2;
		var d = Math.abs(i - j);
		return Math.min(d, MOOD_RING.length - d);
	}
	function labelSimilarity(a, b) {
		var s = 0, ga = a.genres || [], gb = b.genres || [];
		for (var i = 0; i < ga.length; i++) if (gb.indexOf(ga[i]) >= 0) s += i === 0 ? 3 : 2;
		var md = moodDistance(a.mood, b.mood);
		s += md === 0 ? 2 : md === 1 ? 1 : md >= 3 ? -1 : 0;
		if (a.scene && a.scene === b.scene) s += 1;
		if (a.lang && a.lang === b.lang) s += 1;
		return s;
	}
	// How often each other song was played right before or after `id`: neighbouring
	// entries of the history (skips left out) less than `gapMs` (20 minutes) apart.
	// -> { otherId: count }
	function coPlays(history, id, opts) {
		var gap = (opts && opts.gapMs) || 1200000, out = {};
		var ms = function (x) { return typeof x === 'number' ? x : Date.parse(x) || 0; };
		var hs = (history || []).filter(function (e) { return e && e.id && e.kind !== 'skip'; }).slice().sort(function (a, b) { return ms(a.at) - ms(b.at); });
		for (var i = 0; i < hs.length; i++) {
			if (hs[i].id !== id) continue;
			[hs[i - 1], hs[i + 1]].forEach(function (e) {
				if (!e || e.id === id || Math.abs(ms(e.at) - ms(hs[i].at)) > gap) return;
				out[e.id] = (out[e.id] || 0) + 1;
			});
		}
		return out;
	}
	// Songs like `seed` among `tracks`, each with the reasons why, most telling first.
	// Other uploads of the same song (S.songKey) and sets are left out; each song comes once.
	// opts: { history (for coPlays), people(t) -> [{ key, name }] credited, limit (12),
	// perArtist (2), perWork (2), min (4) }.
	// -> { close: [{ t, score, why: [[kind, value]] }], work: [tracks of the same work,
	// OP first], together: [{ t, n }] }. Kinds: 'together' (n), 'singer' (key), 'work',
	// 'artist', 'genre' (name), 'mood', 'era' (decade), 'scene'; 'singer' carries the name.
	var ROLE_ORDER = ['OP', 'ED', 'insert', 'theme', 'image', 'OST'];
	function similar(seed, tracks, opts) {
		opts = opts || {};
		var co = coPlays(opts.history, seed.id), ppl = opts.people || function () { return []; };
		var mine = {}, sg = seed.genres || [], sy = +seed.year || 0, own = songKey(seed), songs = {};
		ppl(seed).forEach(function (p) { mine[p.key] = true; });
		var scored = [], work = [], together = [];
		(tracks || []).forEach(function (c) {
			if (!c || c.id === seed.id || c.blocked || c.kind === 'clip' || c.kind === 'set') return;
			var sk = songKey(c);
			if (sk === own) return;
			var s = 0, why = [], n = co[c.id] || 0;
			if (n) { s += Math.min(4, 1.5 * n); why.push(['together', n]); together.push({ t: c, n: n }); }
			var same = !!(seed.artistKey && c.artistKey === seed.artistKey);
			var shared = same ? [] : ppl(c).filter(function (p) { return mine[p.key]; });
			if (shared.length) { s += 2; why.push(['singer', shared[0].name]); }
			if (seed.work && c.work === seed.work) { s += 2; why.push(['work', c.work]); work.push(c); }
			if (same) { s += 1.5; why.push(['artist', c.artist]); }
			var g = '';
			for (var i = 0; i < sg.length; i++) if ((c.genres || []).indexOf(sg[i]) >= 0) { s += i === 0 ? 3 : 2; if (!g) g = sg[i]; }
			if (g) why.push(['genre', g]);
			var md = seed.mood && c.mood ? moodDistance(seed.mood, c.mood) : 2;
			if (md === 0) { s += 2; why.push(['mood', c.mood]); } else if (md === 1) s += 1; else if (md >= 3) s -= 1;
			var cy = +c.year || 0;
			if (sy && cy && Math.abs(sy - cy) <= 2) { s += 1; why.push(['era', Math.floor(cy / 10) * 10]); }
			if (seed.scene && c.scene === seed.scene) { s += 1; why.push(['scene', c.scene]); }
			if (seed.lang && c.lang === seed.lang) s += 1;
			if (c.rating >= 4) s += 0.5;
			scored.push({ t: c, score: s, why: why, song: sk });
		});
		scored.sort(function (a, b) { return b.score - a.score || (a.t.id < b.t.id ? -1 : 1); });
		var limit = opts.limit || 12, perA = {}, perW = {}, close = [];
		var maxA = opts.perArtist || 2, maxW = opts.perWork || 2, min = opts.min == null ? 4 : opts.min;
		for (var j = 0; j < scored.length && close.length < limit; j++) {
			var x = scored[j];
			if (x.score < min) break;
			var ak = artistKey(x.t), wk = workKey(x.t);
			if (songs[x.song] || (perA[ak] || 0) >= maxA || (wk && (perW[wk] || 0) >= maxW)) continue;
			songs[x.song] = true;
			perA[ak] = (perA[ak] || 0) + 1;
			if (wk) perW[wk] = (perW[wk] || 0) + 1;
			close.push(x);
		}
		var ro = function (t) { var i = ROLE_ORDER.indexOf(t.role); return i < 0 ? ROLE_ORDER.length : i; };
		var wseen = {};
		work = work.filter(function (t) { var k = songKey(t); if (wseen[k]) return false; wseen[k] = true; return true; });
		work.sort(function (a, b) { return ro(a) - ro(b) || String(a.title).localeCompare(String(b.title)); });
		together.sort(function (a, b) { return b.n - a.n; });
		return { close: close, work: work, together: together };
	}
	// Mood flow: a walk where each next track is drawn among the closest of a
	// random sample of what is left (opts.sim(a, b), or the labels), never the
	// same artist or work as the last two. The mood drifts instead of jumping.
	function flowOrder(tracks, rand, opts) {
		opts = opts || {};
		var sim = opts.sim || labelSimilarity, left = tracks.slice(), out = [], SAMPLE = opts.sample || 48;
		if (!left.length) return out;
		var cur = left.splice(rand.int(left.length), 1)[0], prev = null;
		out.push(cur.id);
		while (left.length) {
			var best = -1, bestScore = -Infinity, tries = Math.min(SAMPLE, left.length);
			for (var k = 0; k < tries; k++) {
				var at = tries === left.length ? k : rand.int(left.length), c = left[at];
				var s = sim(cur, c) + rand() * 1.5;
				if (artistKey(c) === artistKey(cur) || (prev && artistKey(c) === artistKey(prev))) s -= 6;
				var wk = workKey(c);
				if (wk && (wk === workKey(cur) || (prev && wk === workKey(prev)))) s -= 4;
				if (s > bestScore) { bestScore = s; best = at; }
			}
			prev = cur;
			cur = left.splice(best, 1)[0];
			out.push(cur.id);
		}
		return out;
	}

	function build(tracks, plan, ctx) {
		plan = plan || {};
		ctx = ctx || {};
		var now = ctx.now == null ? Date.now() : ctx.now;
		var rand = ctx.rand || source(plan.seed);
		var mode = plan.mode || 'true';
		var chosen = select(tracks, plan.select, now);
		// The order of `tracks` must not matter: start from a sorted list.
		chosen = chosen.slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
		if (plan.oneVersion) chosen = oneVersion(chosen, rand);
		var byId = index(chosen), order, blocks = null;
		// With keepRuns each numbered run goes through the mode as one unit (its
		// first part stands for it) and is unfolded afterwards. So a spread
		// shuffle still keeps artists apart from unit to unit, and only the
		// parts of one run sit side by side.
		var runs = plan.keepRuns ? foldRuns(chosen) : null;
		var pool = runs ? runs.units : chosen;
		if (mode === 'true') order = trueShuffle(pool, rand);
		else if (mode === 'spread') order = spreadShuffle(pool, rand, { after: ctx.after });
		else if (mode === 'fresh') order = freshFirst(pool, rand);
		else if (mode === 'newest') order = newestFirst(pool, rand);
		else if (mode === 'favourites') order = favourites(pool, rand);
		else if (mode === 'neglected') order = neglected(pool, rand, now);
		else if (mode === 'artists') order = artistRotation(pool, rand);
		else if (mode === 'flow') order = flowOrder(pool, rand, { sim: ctx.sim });
		else if (mode === 'genres') {
			blocks = genreBlockList(pool, rand, { size: plan.blockSize });
			if (runs) blocks.forEach(function (b) { b.ids = unfoldRuns(b.ids, runs.members); });
			order = [];
			blocks.forEach(function (b) { order = order.concat(b.ids); });
		} else throw new Error('Unknown mode: ' + mode);
		// plan.apart: keep works (and artists) apart in the orders that are not
		// about being random or blocked; the true shuffle keeps its promise.
		if (plan.apart && mode !== 'true' && mode !== 'genres' && mode !== 'artists') order = apart(order, byId, [artistKey, workKey]);
		if (runs && mode !== 'genres') order = unfoldRuns(order, runs.members);
		var lim = limit(order, byId, plan.limits);
		return { order: lim.order, mode: mode, seed: plan.seed == null ? null : plan.seed, selected: chosen.length, seconds: lim.seconds, stoppedBy: lim.stoppedBy, blocks: blocks };
	}

	// A short stable name for a selection (or any plain value), for keying a
	// stored bag: the same choices give the same name whatever order they
	// were ticked in.
	function signature(value) {
		function stable(v) {
			if (Array.isArray(v)) return '[' + v.map(stable).sort().join(',') + ']';
			if (v && typeof v === 'object') {
				return '{' + Object.keys(v).sort().filter(function (k) {
					var x = v[k];
					return !(x == null || x === false || x === '' || (Array.isArray(x) && !x.length));
				}).map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
			}
			return JSON.stringify(v === undefined ? null : v);
		}
		var h = hash128(stable(value == null ? {} : value));
		return (h[0].toString(36) + h[1].toString(36)).slice(0, 12);
	}

	// ---- The queue ----------------------------------------------------------------------------------

	var HISTORY_MAX = 500;

	//   { items: [ids], index, history: [ids], done, repeat }
	// index is the place of the current track; -1 before anything plays,
	// items.length (with done: true) after the last one. history is every
	// track that was current and then left, oldest first.
	function queueInit() { return { items: [], index: -1, history: [], done: false, repeat: false }; }
	function current(state) { return state.index >= 0 && state.index < state.items.length ? state.items[state.index] : null; }
	function upcoming(state) { return state.items.slice(Math.max(0, state.index + 1)); }

	function leave(state, history) {
		var cur = current(state);
		if (cur == null) return history;
		history = history.concat([cur]);
		return history.length > HISTORY_MAX ? history.slice(history.length - HISTORY_MAX) : history;
	}

	// The reducer. It never changes the state it is given. Actions:
	//   { type: 'load', ids, index }     a new queue; index (default 0) is current
	//   { type: 'next' }                 the next track; past the end: done, or
	//                                    back to the first when repeat is on
	//   { type: 'previous' }             one back
	//   { type: 'jump', index }          make another place current
	//   { type: 'playNext', ids }        put these right after the current track
	//                                    (taking them out of where they were later)
	//   { type: 'enqueue', ids }         add at the end
	//   { type: 'remove', index }        or { type: 'remove', id }: take one out;
	//                                    removing the current track makes the
	//                                    one after it current
	//   { type: 'move', from, to }       reorder; the current track stays current
	//   { type: 'clearUpcoming' }        drop everything after the current track
	//   { type: 'setRepeat', value }
	//   { type: 'reset' }
	function queue(state, action) {
		state = state || queueInit();
		if (!action || !action.type) return state;
		var items = state.items, i, cur = current(state), next;
		switch (action.type) {
		case 'reset':
			return queueInit();
		case 'load':
			items = (action.ids || []).slice();
			i = items.length ? Math.max(0, Math.min(items.length - 1, action.index == null ? 0 : action.index | 0)) : -1;
			return { items: items, index: i, history: leave(state, state.history), done: false, repeat: state.repeat };
		case 'next':
			if (!items.length) return state;
			if (state.index >= items.length) return state;
			i = state.index + 1;
			if (i >= items.length) {
				if (state.repeat) return { items: items, index: 0, history: leave(state, state.history), done: false, repeat: true };
				return { items: items, index: items.length, history: leave(state, state.history), done: true, repeat: false };
			}
			return { items: items, index: i, history: leave(state, state.history), done: false, repeat: state.repeat };
		case 'previous':
			if (!items.length || state.index <= 0) return state;
			return { items: items, index: Math.min(state.index, items.length) - 1, history: state.history, done: false, repeat: state.repeat };
		case 'jump':
			i = action.index | 0;
			if (!(i >= 0 && i < items.length) || i === state.index) return state;
			return { items: items, index: i, history: leave(state, state.history), done: false, repeat: state.repeat };
		case 'playNext':
			next = (action.ids || []).filter(function (id) { return id !== cur; });
			if (!next.length) return state;
			var head = items.slice(0, Math.max(0, state.index + 1));
			var tail = items.slice(Math.max(0, state.index + 1)).filter(function (id) { return next.indexOf(id) < 0; });
			return { items: head.concat(next, tail), index: state.index, history: state.history, done: false, repeat: state.repeat };
		case 'enqueue':
			if (!action.ids || !action.ids.length) return state;
			// A finished queue that gets more tracks is no longer finished: its
			// index already points at the first new one.
			return { items: items.concat(action.ids), index: state.index, history: state.history, done: false, repeat: state.repeat };
		case 'remove':
			i = action.index != null ? action.index | 0 : items.indexOf(action.id);
			if (!(i >= 0 && i < items.length)) return state;
			items = items.slice(0, i).concat(items.slice(i + 1));
			if (!items.length) return { items: items, index: -1, history: state.history, done: false, repeat: state.repeat };
			next = Math.min(i < state.index ? state.index - 1 : state.index, items.length);
			return { items: items, index: next, history: state.history, done: next >= items.length, repeat: state.repeat };
		case 'move':
			var from = action.from | 0, to = action.to | 0;
			if (!(from >= 0 && from < items.length) || !(to >= 0 && to < items.length) || from === to) return state;
			items = items.slice();
			var moved = items.splice(from, 1)[0];
			items.splice(to, 0, moved);
			i = state.index;
			if (from === state.index) i = to;
			else if (from < state.index && to >= state.index) i = state.index - 1;
			else if (from > state.index && to <= state.index) i = state.index + 1;
			return { items: items, index: i, history: state.history, done: state.done, repeat: state.repeat };
		case 'clearUpcoming':
			if (state.index + 1 >= items.length) return state;
			return { items: items.slice(0, Math.max(0, state.index + 1)), index: state.index, history: state.history, done: state.done, repeat: state.repeat };
		case 'setRepeat':
			return { items: items, index: state.index, history: state.history, done: state.done, repeat: !!action.value };
		default:
			return state;
		}
	}

	return {
		rng: rng, cryptoRng: cryptoRng, source: source, newSeed: newSeed, hash128: hash128,
		select: select, lengthClass: lengthClass, artistKey: artistKey,
		trueShuffle: trueShuffle,
		bagCreate: bagCreate, bagNext: bagNext, bagTake: bagTake, bagAdd: bagAdd, bagRemove: bagRemove, bagSync: bagSync, bagRemaining: bagRemaining, bagPlayed: bagPlayed,
		bagReturn: bagReturn, bagRunDraw: bagRunDraw, MAX_RUN: MAX_RUN,
		spreadShuffle: spreadShuffle, adjacentRepeats: adjacentRepeats, canSeparate: canSeparate,
		freshFirst: freshFirst, newestFirst: newestFirst,
		weightedOrder: weightedOrder, favouriteWeight: favouriteWeight, neglectedWeight: neglectedWeight, favourites: favourites, neglected: neglected,
		artistRotation: artistRotation, genreBlockList: genreBlockList, genreBlocks: genreBlocks, keepRuns: keepRuns, foldRuns: foldRuns, unfoldRuns: unfoldRuns,
		limit: limit, build: build, signature: signature, MODES: MODES,
		firstAdded: firstAdded, addedKeys: addedKeys,
		workKey: workKey, songKey: songKey, apart: apart, oneVersion: oneVersion, flowOrder: flowOrder, labelSimilarity: labelSimilarity, coPlays: coPlays, similar: similar, moodDistance: moodDistance, MOOD_RING: MOOD_RING,
		queueInit: queueInit, queue: queue, current: current, upcoming: upcoming
	};
});
