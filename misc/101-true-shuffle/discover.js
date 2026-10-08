/*
 * True Shuffle: discovering songs that are not in the library yet.
 *
 * Deezer's public API knows which artists are related and what their best
 * songs are, with 30-second previews. It sends no CORS header, only JSONP,
 * and JSONP runs the answering server's script. So the script runs inside
 * a sandboxed iframe (sandbox="allow-scripts", no same-origin): it cannot
 * reach this page, its storage or the sign-in token, and it hands back
 * plain data by postMessage, which the page treats as untrusted text.
 *
 *   var D = TrueShuffle.discover;
 *   var dz = D.createDeezer({ transport: D.sandboxTransport() });
 *   D.suggest(dz, { names: ['Yorushika', '\u30E8\u30EB\u30B7\u30AB'], titles: ['\u591C\u306B\u99C6\u3051\u308B'], known: fn, hidden: {} })
 *     -> Promise<{ artist, verified, related: [{ id, name, picture, fans, known, tracks: [...] }] }>
 *
 * UMD: window.TrueShuffle.discover in the browser, module.exports in Node
 * (where the transport is a function the tests pass in).
 */
(function (root, factory) {
	var node = typeof module === 'object' && module.exports;
	var api = factory(root);
	if (node) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.discover = api; }
})(typeof self !== 'undefined' ? self : this, function (root) {
	'use strict';

	var API = 'https://api.deezer.com/';

	function str(v) { return v == null ? '' : String(v); }
	// Names compared without case, accents, punctuation or a leading "the".
	function norm(s) {
		return str(s).normalize('NFKC').normalize('NFKD').replace(/[\u0300-\u036F]/g, '').toLowerCase()
			.replace(/&/g, ' and ').replace(/^\s*the\s+/, '').replace(/[^\p{L}\p{N}]+/gu, '');
	}

	// ---- The sandboxed JSONP transport (browser only) ----------------------------------------

	var FRAME = '<!doctype html><meta charset="utf-8"><script>' +
		'var n=0;' +
		'addEventListener("message",function(e){var d=e.data;if(!d||d.kind!=="ts-jsonp")return;' +
		'var u=String(d.url);if(u.indexOf("' + API + '")!==0)return;' +
		'var cb="__ts"+(++n),s=document.createElement("script"),t=setTimeout(function(){done({error:"timeout"})},12000);' +
		'function done(m){clearTimeout(t);try{delete window[cb]}catch(x){}if(s.parentNode)s.parentNode.removeChild(s);m.kind="ts-jsonp-result";m.id=d.id;parent.postMessage(m,"*")}' +
		'window[cb]=function(x){var c;try{c=JSON.parse(JSON.stringify(x))}catch(err){done({error:"bad"});return}done({data:c})};' +
		's.onerror=function(){done({error:"network"})};' +
		's.src=u+(u.indexOf("?")<0?"?":"&")+"output=jsonp&callback="+cb;document.head.appendChild(s)});' +
		'parent.postMessage({kind:"ts-jsonp-ready"},"*");' +
		'<\/script>';
	// -> function(url) -> Promise<data>. The frame is made on the first call.
	function sandboxTransport(doc) {
		doc = doc || root.document;
		var frame = null, ready = null, waiting = {}, seq = 0;
		function make() {
			if (ready) return ready;
			frame = doc.createElement('iframe');
			frame.setAttribute('sandbox', 'allow-scripts');
			frame.setAttribute('aria-hidden', 'true');
			frame.setAttribute('tabindex', '-1');
			frame.title = 'Deezer lookups (sandboxed)';
			frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
			ready = new Promise(function (resolve) {
				root.addEventListener('message', function (e) {
					if (!frame || e.source !== frame.contentWindow) return;
					var m = e.data;
					if (!m || typeof m !== 'object') return;
					if (m.kind === 'ts-jsonp-ready') { resolve(); return; }
					if (m.kind !== 'ts-jsonp-result' || !waiting[m.id]) return;
					var w = waiting[m.id];
					delete waiting[m.id];
					if (m.error) w.reject(new Error('Deezer could not be reached (' + m.error + ').'));
					else w.resolve(m.data);
				});
			});
			frame.srcdoc = FRAME;
			doc.body.appendChild(frame);
			return ready;
		}
		return function (url) {
			return make().then(function () {
				return new Promise(function (resolve, reject) {
					var id = ++seq;
					waiting[id] = { resolve: resolve, reject: reject };
					frame.contentWindow.postMessage({ kind: 'ts-jsonp', id: id, url: url }, '*');
				});
			});
		};
	}

	// ---- A small Deezer client -----------------------------------------------------------------

	function createDeezer(opts) {
		var transport = opts.transport, cache = {};
		function call(path) {
			if (cache[path]) return cache[path];
			var p = transport(API + path).then(function (d) {
				if (d && d.error) throw new Error('Deezer: ' + (d.error.message || 'error'));
				return d;
			});
			cache[path] = p;
			p.catch(function () { delete cache[path]; });
			return p;
		}
		return {
			searchArtists: function (name) { return call('search/artist?q=' + encodeURIComponent(str(name)) + '&limit=6').then(function (d) { return (d && d.data) || []; }); },
			related: function (id) { return call('artist/' + id + '/related?limit=20').then(function (d) { return (d && d.data) || []; }); },
			top: function (id, n) { return call('artist/' + id + '/top?limit=' + (n || 5)).then(function (d) { return (d && d.data) || []; }); }
		};
	}

	// ---- Finding the artist and the suggestions --------------------------------------------------

	// The Deezer artist for one of the names. Verified when one of its top
	// songs is a title the library has by that artist.
	function findArtist(dz, names, titles) {
		names = (names || []).filter(Boolean);
		var want = titles ? titles.map(norm).filter(Boolean) : [];
		var i = 0, fallback = null;
		function next() {
			if (i >= names.length) return Promise.resolve(fallback);
			var name = names[i++], key = norm(name);
			return dz.searchArtists(name).then(function (list) {
				var same = list.filter(function (a) { return norm(a.name) === key; });
				if (!same.length) return next();
				var tries = same.slice(0, 3);
				return Promise.all(tries.map(function (a) { return want.length ? dz.top(a.id, 25).catch(function () { return []; }) : Promise.resolve([]); })).then(function (tops) {
					for (var k = 0; k < tries.length; k++) {
						var hit = tops[k].some(function (t) { var tt = norm(t.title_short || t.title); return want.some(function (w) { return w && (tt === w || (tt.length > 3 && (tt.indexOf(w) >= 0 || w.indexOf(tt) >= 0))); }); });
						if (hit) return { artist: tries[k], verified: true };
					}
					// with titles to check and none matching, it is another artist of that name
					if (!fallback && !want.length) fallback = { artist: same.sort(function (a, b) { return (b.nb_fan || 0) - (a.nb_fan || 0); })[0], verified: false };
					return next();
				});
			}).catch(function () { return next(); });
		}
		return next();
	}

	function trackOf(t, artist) {
		return {
			id: t.id, title: str(t.title_short || t.title), version: str(t.title_version), artist: str((t.artist && t.artist.name) || (artist && artist.name)),
			preview: /^https:\/\/[a-z0-9-]+\.dzcdn\.net\//.test(str(t.preview)) ? str(t.preview) : '',
			cover: t.album && /^https:\/\/[a-z0-9-]+\.dzcdn\.net\//.test(str(t.album.cover_medium)) ? str(t.album.cover_medium) : '',
			album: str(t.album && t.album.title), duration: +t.duration || 0, link: /^https:\/\/www\.deezer\.com\//.test(str(t.link)) ? str(t.link) : ''
		};
	}
	// ctx: { names: [artist names to try], titles: [the artist's titles in the library],
	//        known(name) -> true when the library has that artist, hidden: { normName: true },
	//        perArtist (3), artists (12) }
	function suggest(dz, ctx) {
		ctx = ctx || {};
		return findArtist(dz, ctx.names, ctx.titles).then(function (found) {
			if (!found) return { artist: null, verified: false, related: [] };
			return dz.related(found.artist.id).then(function (rel) {
				var self = {};
				(ctx.names || []).concat([found.artist.name]).forEach(function (n) { self[norm(n)] = true; });
				rel = rel.filter(function (a) { return !self[norm(a.name)] && !(ctx.hidden && ctx.hidden[norm(a.name)]); }).slice(0, ctx.artists || 12);
				return Promise.all(rel.map(function (a) {
					return dz.top(a.id, ctx.perArtist || 3).catch(function () { return []; }).then(function (tops) {
						return {
							id: a.id, name: str(a.name), fans: +a.nb_fan || 0,
							picture: /^https:\/\/[a-z0-9-]+\.dzcdn\.net\//.test(str(a.picture_medium)) ? str(a.picture_medium) : '',
							known: !!(ctx.known && ctx.known(a.name)),
							tracks: tops.map(function (t) { return trackOf(t, a); })
						};
					});
				}));
			}).then(function (related) {
				// artists the library does not have first, then by fans
				related.sort(function (x, y) { return (x.known - y.known) || (y.fans - x.fans); });
				return { artist: { id: found.artist.id, name: str(found.artist.name) }, verified: found.verified, related: related };
			});
		});
	}
	// The YouTube query for a Deezer track, and the best of a search's results:
	// the artist's Topic channel, else a title that names the song, else the first.
	function youtubeQuery(t) { return (t.artist + ' ' + t.title).trim(); }
	function bestVideo(results, t) {
		var a = norm(t.artist), ti = norm(t.title);
		var score = function (r) {
			var s = 0, rt = norm(r.title), ch = norm(r.channel);
			if (ch === a + 'topic') s += 5;
			if (ch.indexOf(a) >= 0) s += 3;
			if (ti && rt.indexOf(ti) >= 0) s += 3;
			if (/cover|\u6B4C\u3063\u3066\u307F\u305F|karaoke|\u30AB\u30E9\u30AA\u30B1|reaction|lyrics/i.test(r.title)) s -= 2;
			return s;
		};
		var best = null, bs = -Infinity;
		(results || []).forEach(function (r) { var s = score(r); if (s > bs) { bs = s; best = r; } });
		return best;
	}

	return { API: API, norm: norm, sandboxTransport: sandboxTransport, createDeezer: createDeezer, findArtist: findArtist, suggest: suggest, youtubeQuery: youtubeQuery, bestVideo: bestVideo };
});
