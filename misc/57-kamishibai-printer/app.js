/*
 * Kamishibai Printer: the page. Loads a published Paper Theatre story, walks it along the chosen route
 * (boards.js), composes each board's picture as one SVG from the theatre's drawings (art.js), and lays out
 * the print pages (duplex or fold) for window.print().
 */
(function () {
	'use strict';

	ToyKit.init({
		id: '57-kamishibai-printer',
		title: 'Kamishibai Printer',
		sub: 'A Paper Theatre story as paper-theatre boards, ready to print.',
		back: 'misc',
		help: '#help-template',
		footer: '#how'
	});

	var THEATRE = '../55-paper-theatre/';
	var VN = window.VN, ART = window.VNArt, KB = window.KB;
	function $(sel, el) { return (el || document).querySelector(sel); }
	function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
	function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

	var els = {
		story: $('#story'), per: $('#per'), castbreaks: $('#castbreaks'), layout: $('#layout'), paper: $('#paper'),
		summary: $('#summary'), route: $('#route'), routeList: $('#route-list'), routeSum: $('#route-sum'),
		strip: $('#strip'), front: $('#front'), back: $('#back'), frontH: $('#front-h'), backH: $('#back-h'), backNote: $('#back-note'),
		print: $('#print'), pages: $('#pages'), pagesNote: $('#pages-note'), btnPages: $('#btn-pages'), flipNote: $('#flip-note'),
		fan: $('#fan'), pageSize: $('#page-size')
	};

	var saved = ToyKit.thumb ? {} : (ToyKit.load('settings', {}) || {});
	var P = ToyKit.params;
	var settings = {
		story: P.get('story') || saved.story || 'obfuscation',
		per: +(P.get('per') || saved.per || 4),
		castBreaks: saved.castBreaks !== false,
		layout: P.get('layout') === 'fold' ? 'fold' : (P.get('layout') === 'short' ? 'duplex-short' : (P.get('layout') === 'long' ? 'duplex-long' : (saved.layout || 'duplex-long'))),
		paper: P.get('paper') === 'letter' ? 'letter' : (P.get('paper') === 'a4' ? 'a4' : (saved.paper || 'a4'))
	};
	if (ToyKit.thumb) settings = { story: 'obfuscation', per: 4, castBreaks: true, layout: 'duplex-long', paper: 'a4' };
	function remember() { if (!ToyKit.thumb) ToyKit.store('settings', settings); }

	var catalog = [];          // published stories from the manifest
	var posts = null;          // blog index, for the date of blog stories
	var program = null, picks = [], result = null, selected = 0;
	var pictures = {};         // picture key -> { id, svg (inner markup in 1600 x 900) }
	var picCount = 0;

	/* ------------------------------------------------------------------ loading */

	function fetchText(url) {
		return fetch(url).then(function (r) {
			if (!r.ok) { r.body && r.body.cancel && r.body.cancel(); var e = new Error('A story file could not be loaded.'); e.detail = url + ': HTTP ' + r.status; throw e; }
			return r.text();
		});
	}

	function loadCatalog() {
		return fetchText(THEATRE + 'stories/index.json').then(function (t) {
			var list = JSON.parse(t);
			catalog = list.filter(function (e) { return e.status === 'published' && e.file; });
			if (!catalog.length) throw new Error('No published story was found in the theatre\'s manifest.');
		});
	}

	function loadProgram(entry) {
		return fetchText(THEATRE + 'stories/' + entry.file).then(function (text) {
			var names = [];
			text.replace(/^\s*@include\s+(\S+)/gm, function (m, p) { if (names.indexOf(p) < 0) names.push(p); return m; });
			var includes = {};
			return Promise.all(names.map(function (n) {
				return fetchText(THEATRE + 'stories/' + n).then(function (t) { includes[n] = t; }, function () { /* the parser reports it */ });
			})).then(function () {
				var prog = VN.parse(text, { id: entry.id, includes: includes });
				var fatal = VN.lint(prog).filter(function (i) { return i.level === 'fatal'; });
				if (fatal.length) { var e = new Error('This story has an error the theatre would stop at, so it cannot be printed.'); e.detail = fatal[0].msg; throw e; }
				return blogMeta(prog);
			});
		});
	}

	// Blog stories: the date (for the end board, as the theatre's opening words it) and a post read inline.
	function blogMeta(prog) {
		var meta = prog.meta;
		if (meta.sourceKind !== 'blog') return Promise.resolve(prog);
		var p = posts ? Promise.resolve(posts) : ToyKit.posts().then(function (l) { posts = l; return l; }, function () { posts = []; return posts; });
		return p.then(function (list) {
			var post = list.filter(function (x) { return x.slug === meta.sourceRef; })[0];
			if (post) { if (!meta.title) meta.title = post.title; meta.date = post.date || null; }
			var hasRead = prog.ops.some(function (o) { return o.kind === 'read'; });
			if (!hasRead || !post) return prog;
			return ToyKit.post(post.slug).then(function (full) {
				return VN.expand(prog, full.markdown, { title: post.title || meta.title });
			}, function () { return prog; });
		});
	}

	/* ------------------------------------------------------------------ pictures */

	// Colour matrices for the grade (the stage uses CSS filters; an SVG filter does the same to a picture).
	function mmul(a, b) {      // 4x5 matrices as arrays of 20, a after b
		var out = [];
		for (var r = 0; r < 4; r++) for (var c = 0; c < 5; c++) {
			var v = 0;
			for (var k = 0; k < 4; k++) v += a[r * 5 + k] * b[k * 5 + c];
			if (c === 4) v += a[r * 5 + 4];
			out.push(v);
		}
		return out;
	}
	function sepia(a) {
		var i = 1 - a;
		return [0.393 + 0.607 * i, 0.769 - 0.769 * i, 0.189 - 0.189 * i, 0, 0,
			0.349 - 0.349 * i, 0.686 + 0.314 * i, 0.168 - 0.168 * i, 0, 0,
			0.272 - 0.272 * i, 0.534 - 0.534 * i, 0.131 + 0.869 * i, 0, 0, 0, 0, 0, 1, 0];
	}
	function saturate(s) {
		return [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0,
			0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0,
			0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0, 0, 0, 0, 1, 0];
	}
	function bright(b) { return [b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0]; }
	function contrast(c) { var t = (1 - c) / 2; return [c, 0, 0, 0, t, 0, c, 0, 0, t, 0, 0, c, 0, t, 0, 0, 0, 1, 0]; }
	function chain(list) { return list.reduce(function (acc, m) { return mmul(m, acc); }); }
	function fmat(id, m) { return '<filter id="' + id + '" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="' + m.map(function (v) { return +v.toFixed(4); }).join(' ') + '"/></filter>'; }

	var GRADE = {
		flashback: chain([sepia(0.62), saturate(0.62), contrast(0.94), bright(1.07)]),
		memory: chain([sepia(0.45), saturate(0.8)]),
		noon: chain([bright(1.06), contrast(1.04)]),
		cold: chain([saturate(0.72), bright(0.98)]),
		night: saturate(0.8)
	};
	// the stage's .vn-tone overlays (vn.css), as rectangles
	var TONE = {
		dusk: '<rect width="1600" height="900" fill="url(#kpg-dusk)" style="mix-blend-mode:soft-light"/>',
		night: '<rect width="1600" height="900" fill="rgb(28,40,110)" fill-opacity="0.6" style="mix-blend-mode:multiply"/>',
		dawn: '<rect width="1600" height="900" fill="url(#kpg-dawn)" style="mix-blend-mode:soft-light"/>',
		noon: '<rect width="1600" height="900" fill="rgb(255,250,225)" fill-opacity="0.5" style="mix-blend-mode:soft-light"/>',
		cold: '<rect width="1600" height="900" fill="rgb(140,190,255)" fill-opacity="0.55" style="mix-blend-mode:soft-light"/>',
		memory: '<rect width="1600" height="900" fill="rgb(190,140,80)" fill-opacity="0.4" style="mix-blend-mode:soft-light"/>'
	};

	// The stage's canvas tooth (vn.css .vn-world::after): grey noise, soft-light, opacity 0.5, over the whole
	// world and under its grade. The noise is grey 0.5 in linearRGB (187.6 in sRGB) with a mean alpha of 0.45
	// (measured in Chrome), and a soft-light blend is linear in the source alpha, so a flat rectangle of that grey
	// at 0.5 x 0.45 gives the same average tone without printing the speckle. Without it every dark board printed
	// darker than the stage (board 6, window-rain: mean luminance 19.3 against the stage's 23.0).
	var TOOTH = '<rect width="1600" height="900" fill="rgb(188,188,188)" fill-opacity="0.225" style="mix-blend-mode:soft-light"/>';

	function ownDefs() {
		return '<defs>' +
			fmat('kpf-flashback', GRADE.flashback) + fmat('kpf-memory', GRADE.memory) + fmat('kpf-noon', GRADE.noon) +
			fmat('kpf-cold', GRADE.cold) + fmat('kpf-night', GRADE.night) + fmat('kpf-far', chain([bright(0.92), saturate(0.88)])) +
			fmat('kpf-dim', chain([bright(0.7), saturate(0.82)])) + fmat('kpf-fardim', chain([bright(0.66), saturate(0.75)])) +
			'<filter id="kpf-capshadow" x="-10%" y="-60%" width="120%" height="220%"><feDropShadow dx="0" dy="2" stdDeviation="7" flood-color="#000" flood-opacity="0.75"/></filter>' +
			'<linearGradient id="kpg-dusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(255,150,80)" stop-opacity="0.5"/><stop offset="1" stop-color="rgb(120,50,130)" stop-opacity="0.45"/></linearGradient>' +
			'<linearGradient id="kpg-dawn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(190,200,255)" stop-opacity="0.45"/><stop offset="1" stop-color="rgb(255,200,185)" stop-opacity="0.55"/></linearGradient>' +
			'<linearGradient id="kpg-foot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.78"/></linearGradient>' +
			'</defs>';
	}

	function sized(svg, x, y, w, h) {
		return svg.replace(/^<svg\b/, '<svg x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"');
	}
	function artBackground(bg) {
		var s = '';
		try { s = ART.background(bg.name, bg.mod, bg.opts || {}); } catch (e) { s = ''; }
		if (!s) { try { s = ART.background('void', null, {}); } catch (e2) { s = '<svg viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#20242e"/></svg>'; } }
		return s;
	}
	function artCg(cg) {
		var s = '';
		try { s = ART.cg(cg.name, cg.mod, cg.opts || {}); } catch (e) { s = ''; }
		return s || artBackground({ name: 'void' });
	}
	function castDecl(key) {
		return (program && program.cast && program.cast[key]) || { id: key, key: key, name: key, hue: VN.hash(key) % 360, skin: 3, hair: 'short' };
	}

	// The stage's geometry (vn.css): an actor box is 96% of the stage high, 6:10, its foot 1% below the frame,
	// centred at 25 / 50 / 75%; near is scale 1.2 and 9% lower, far scale 0.8 and 3% higher; the reader's
	// own sprite (player) is 100% high with its foot 6% above the frame and stands in front.
	function actorSvg(a, tod, flashback) {
		var decl = castDecl(a.key), s;
		try { s = ART.sprite(decl, a.face || 'neutral'); } catch (e) { s = ''; }
		if (!s) return '';
		var player = /data-kind="player"/.test(s.slice(0, 600));
		var h = player ? 900 : 864, w = h * 0.6, foot = player ? 846 : 909;
		var cx = { left: 400, center: 800, right: 1200 }[a.slot] || 800;
		var sc = 1, ty = 0;
		if (a.dist === 'near') { sc = flashback ? 1.14 : 1.2; ty = (flashback ? 0.15 : 0.09) * h; }
		else if (a.dist === 'far') { sc = 0.8; ty = -0.03 * h; }
		if (tod && tod !== 'day') s = s.replace('filter="url(#vnf-rim)"', 'filter="url(#vnf-rim-' + tod + ')"');
		var z = player ? 4 : a.dist === 'near' ? 3 : a.dist === 'far' ? 1 : 2;
		var body = sized(s, -w / 2, -h, w, h);
		// vn.css .vn-actor.far svg, .vn-actor.dim svg (a listener while someone else on stage speaks), .far.dim
		var dimF = a.dim ? (a.dist === 'far' ? 'kpf-fardim' : 'kpf-dim') : (a.dist === 'far' && !player ? 'kpf-far' : null);
		if (dimF) body = '<g filter="url(#' + dimF + ')">' + body + '</g>';
		return { z: z, svg: '<g transform="translate(' + cx + ' ' + foot + ') scale(' + sc + ') translate(0 ' + ty.toFixed(1) + ')">' + body + '</g>' };
	}

	// Text set in SVG, wrapped by the width the browser measures for the same font (a canvas uses the same
	// fallback chain as the SVG text); without a canvas, by an estimate of the glyph width. `family` is one of
	// SERIF or SANS below; `weight` is optional. A 4% margin covers small differences between the two.
	var measureCtx = null;
	function textWidth(s, size, family, weight) {
		if (measureCtx === null) {
			try { measureCtx = document.createElement('canvas').getContext('2d') || false; } catch (e) { measureCtx = false; }
		}
		if (!measureCtx) return -1;
		var fam = /font-family="([^"]*)"/.exec(family || SERIF);
		measureCtx.font = (weight ? weight + ' ' : '') + size + 'px ' + (fam ? fam[1] : 'serif');
		return measureCtx.measureText(s).width * 1.04;
	}
	function wrap(text, size, maxW, factor, family, weight) {
		var words = String(text || '').split(/\s+/).filter(Boolean), lines = [], line = '';
		var per = Math.max(6, Math.floor(maxW / (size * (factor || 0.52))));
		function fits(s) {
			var w = textWidth(s, size, family, weight);
			return w < 0 ? s.length <= per : w <= maxW;
		}
		words.forEach(function (w) {
			if (!line) line = w;
			else if (fits(line + ' ' + w)) line += ' ' + w;
			else { lines.push(line); line = w; }
		});
		if (line) lines.push(line);
		return lines;
	}
	function textBlock(lines, x, y, size, lead, attrs) {
		return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" ' + attrs + '>' +
			lines.map(function (l, i) { return '<tspan x="' + x + '" dy="' + (i ? lead : 0) + '">' + esc(l) + '</tspan>'; }).join('') + '</text>';
	}
	var SERIF = 'font-family="Cormorant Garamond, Iowan Old Style, Palatino Linotype, Palatino, Book Antiqua, Georgia, serif"';
	var SANS = 'font-family="Inter, system-ui, Segoe UI, Roboto, sans-serif"';

	function sceneMarkup(pic) {
		var tod = 'day';
		if (pic.cg) {
			var c = artCg(pic.cg), m = /data-tod="(\w+)"/.exec(c.slice(0, 600));
			return { tod: m ? m[1] : 'night', body: sized(c, 0, 0, 1600, 900) };
		}
		if (ART.timeOf) { try { tod = ART.timeOf(pic.bg.name, pic.bg.mod) || 'day'; } catch (e) { tod = 'day'; } }
		var out = sized(artBackground(pic.bg), 0, 0, 1600, 900);
		var actors = pic.actors.map(function (a) { return actorSvg(a, tod, !!pic.flashback); }).filter(Boolean);
		actors.sort(function (a, b) { return a.z - b.z; });
		return { tod: tod, body: out, cast: actors.map(function (a) { return a.svg; }).join('') };
	}

	// A caption the way the stage sets one (vn.css .vn-caption): upper left, italic, a thin rule at its left and
	// a dark shadow under it. It starts at x = 110 so it stays whole when a print page crops up to 80 units
	// from each side (frame() below).
	function caption(text, y, size) {
		return '<rect x="110" y="' + (y - size * 0.95) + '" width="2" height="' + Math.round(size * 1.25) + '" fill="#fff7e6" opacity="0.75"/>' +
			'<text x="134" y="' + y + '" font-size="' + size + '" font-style="italic" letter-spacing="2" fill="#fff7e6" ' + SERIF +
			' filter="url(#kpf-capshadow)" paint-order="stroke" stroke="rgba(0,0,0,0.4)" stroke-width="3" stroke-linejoin="round">' + esc(text) + '</text>';
	}

	function pictureInner(board) {
		var pic = board.picture, out = '';
		if (board.kind === 'chapter') {
			var ch = board.chapter || {};
			out = '<rect width="1600" height="900" fill="#0b0b0d"/>' +
				'<text x="800" y="400" text-anchor="middle" font-size="190" fill="#e3c98a" ' + SERIF + '>' + esc(ch.n) + '</text>' +
				'<rect x="700" y="452" width="200" height="2" fill="#e3c98a" opacity="0.7"/>' +
				textBlock(wrap(ch.title, 64, 1300, 0.5, SERIF), 800, 540, 64, 76, 'text-anchor="middle" fill="#f6f1e4" ' + SERIF);
			return out;
		}
		// The stage's layering (vn.css): the tone overlay sits over the background or illustration but under the
		// cast (actors have a z-index, the overlay none), and the grade filters the whole world, overlay included.
		var sc = sceneMarkup(pic), grade = pic.flashback ? 'flashback' : (GRADE[pic.tone] ? pic.tone : null);
		var world = sc.body + (TONE[pic.tone] || '') + (sc.cast || '') + TOOTH;
		out += grade ? '<g filter="url(#kpf-' + grade + ')">' + world + '</g>' : world;
		if (pic.flashback) {
			out += '<rect width="1600" height="54" fill="#000"/><rect y="846" width="1600" height="54" fill="#000"/>';
			if (pic.flashback.caption) out += caption(pic.flashback.caption, 120, 34);
		} else if (pic.cg && pic.cg.caption) {
			out += caption(pic.cg.caption, 82, 30);
		}
		if (board.kind === 'title') {
			var it = board.items[0], tl = wrap(it.title, 92, 1300, 0.48, SERIF, 600);
			var y0 = 900 - 120 - tl.length * 100 - (it.authors ? 60 : 0);
			out += '<rect width="1600" height="900" fill="url(#kpg-foot)"/>' +
				textBlock(tl, 150, y0 + 80, 92, 100, 'fill="#fffaf0" font-weight="600" ' + SERIF) +
				(it.authors ? textBlock(wrap(it.authors, 34, 1300, 0.5, SANS).slice(0, 2), 152, y0 + 80 + tl.length * 100 + 6, 34, 42, 'fill="#efe4cf" ' + SANS) : '');
		} else if (board.kind === 'end') {
			var e = board.items[0], cl = wrap(e.origin, 38, 1180, 0.5, SERIF);
			var h = cl.length * 50 + (e.dramatized ? 110 : 40) + 120;
			var top = (900 - h) / 2;
			out += '<rect width="1600" height="900" fill="#000" opacity="0.62"/>' +
				'<rect x="150" y="' + top + '" width="1300" height="' + h + '" rx="14" fill="#fbf8f1" opacity="0.96"/>' +
				'<text x="210" y="' + (top + 70) + '" font-size="28" letter-spacing="5" fill="#7a6a50" ' + SANS + '>' + (e.origin ? 'SOURCE' : '') + '</text>' +
				textBlock(cl, 210, top + 130, 38, 50, 'fill="#1b1a17" ' + SERIF) +
				(e.dramatized ? '<text x="210" y="' + (top + 130 + cl.length * 50 + 40) + '" font-size="34" font-style="italic" fill="#5a3f22" ' + SERIF + '>Dialogue is dramatized</text>' : '');
		} else if (board.scene) {
			out += '<rect x="0" y="380" width="1600" height="140" fill="#000" opacity="0.38"/>' +
				'<text x="800" y="470" text-anchor="middle" font-size="62" fill="#f6f1e4" ' + SERIF + '>' + esc(board.scene) + '</text>';
		}
		return out;
	}

	function pictureId(board) {
		var key = JSON.stringify([board.kind, board.picture, board.chapter || null, board.scene || null, board.kind === 'title' || board.kind === 'end' ? board.items[0] : null]);
		var p = pictures[key];
		if (!p) {
			p = pictures[key] = { id: 'kp-p' + (++picCount), inner: pictureInner(board) };
			symbolsOut.push('<symbol id="' + p.id + '" viewBox="0 0 1600 900">' + p.inner + '</symbol>');
		}
		return p;
	}
	var symbolsOut = [];

	// A board's front: the picture with the board number small in a corner. `aspect` crops the picture to the
	// page the way a slice would (wider than 16:9: the picture is letterboxed instead).
	// A page narrower than 16:9 crops the sides a little (never more than 80 units a side, so the cast in the
	// left and right slots stays whole) and fills the rest above and below with dark paper; a wider one gets
	// dark bands at the sides.
	function frame(aspect) {
		var x0 = 0, y0 = 0, vw = 1600, vh = 900;
		if (aspect && aspect < 16 / 9) {
			vw = Math.max(1440, 900 * aspect); x0 = (1600 - vw) / 2;
			vh = vw / aspect; y0 = (900 - vh) / 2;
		} else if (aspect && aspect > 16 / 9) {
			vw = 900 * aspect; x0 = (1600 - vw) / 2;
		}
		return { x: Math.round(x0), y: Math.round(y0), w: Math.round(vw), h: Math.round(vh) };
	}
	function frontSvg(board, aspect, label, paperBands) {
		var p = pictureId(board), f = frame(aspect);
		var n = String(board.n), bw = 30 + n.length * 20;
		var bx = Math.min(1600, f.x + f.w) - 22 - bw, by = Math.min(846, f.y + f.h - 54);
		// side bands, and any band on the fold layout's half page, stay white paper: dark ones cost ink for nothing
		var band = paperBands || f.w > 1600 ? '#fff' : '#141414';
		return '<svg viewBox="' + f.x + ' ' + f.y + ' ' + f.w + ' ' + f.h + '" role="img" aria-label="' + esc(label || ('Board ' + board.n)) + '">' +
			(f.w !== 1600 || f.h !== 900 ? '<rect x="' + f.x + '" y="' + f.y + '" width="' + f.w + '" height="' + f.h + '" fill="' + band + '"/>' : '') +
			'<use href="#' + p.id + '" width="1600" height="900"/>' +
			'<rect x="' + bx + '" y="' + by + '" width="' + bw + '" height="36" rx="18" fill="#000" opacity="0.45"/>' +
			'<text x="' + (bx + bw / 2) + '" y="' + (by + 25) + '" text-anchor="middle" font-size="24" fill="#fff" ' + SANS + '>' + n + '</text></svg>';
	}
	function thumbSvg(board, label) {
		var p = pictureId(board);
		return '<svg viewBox="0 0 1600 900" role="img" aria-label="' + esc(label) + '"><use href="#' + p.id + '" width="1600" height="900"/></svg>';
	}

	var defsEl = null;
	function flushSymbols() {
		if (!defsEl) {
			defsEl = document.createElement('div');
			defsEl.className = 'defs';
			defsEl.setAttribute('aria-hidden', 'true');
			defsEl.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
			defsEl.innerHTML = (ART.sharedDefs ? ART.sharedDefs() : '') + '<svg width="0" height="0" style="position:absolute" id="kp-defs">' + ownDefs() + '</svg>';
			$('main').appendChild(defsEl);
		}
		if (symbolsOut.length) {
			var holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			holder.setAttribute('width', '0'); holder.setAttribute('height', '0');
			holder.style.position = 'absolute';
			holder.innerHTML = symbolsOut.join('');
			defsEl.appendChild(holder);
			symbolsOut = [];
		}
	}
	function resetSymbols() {
		pictures = {}; symbolsOut = [];
		if (defsEl) $$('svg:not(.vn-defs):not(#kp-defs)', defsEl).forEach(function (s) { s.remove(); });
	}

	/* ------------------------------------------------------------------ the performer's text */

	function inline(text) {
		var parts = VN.markup ? VN.markup(text) : [{ type: 'text', text: text }];
		return parts.map(function (p) {
			if (p.type === 'em') return '<em>' + esc(p.text) + '</em>';
			if (p.type === 'code') return '<code>' + esc(p.text) + '</code>';
			return esc(p.text);
		}).join('');
	}
	function chips(refs) {
		return (refs || []).map(function (r) {
			var t = VN.describeRef ? VN.describeRef(r) : r;
			return '<abbr class="chip" title="' + esc(t) + '">' + esc(r) + '</abbr>';
		}).join('');
	}
	function itemHtml(it) {
		switch (it.kind) {
			case 'say':
				return '<p' + (it.thought ? ' class="thought"' : '') + '><span class="who">' + esc(it.who) + '</span>' + inline(it.text) + chips(it.refs) + '</p>';
			case 'narrate':
				return '<p' + (it.thought ? ' class="thought"' : '') + '>' + inline(it.text) + chips(it.refs) + '</p>';
			case 'scene':
				return '<p class="scene">' + inline(it.title) + '</p>';
			case 'chapter':
				return '<p class="chap"><span class="num">' + esc(it.n) + '</span>' + inline(it.title) + '</p>';
			case 'pause':
				return '<p class="beat" role="img" aria-label="a pause">&middot; &middot; &middot;</p>';
			case 'card':
				return '<div class="card"><b>' + inline(it.title) + chips(it.refs) + '</b><dl>' + it.cells.map(function (c) {
					return '<dt>' + (c.label ? inline(c.label) : '') + '</dt><dd>' + inline(c.value) + chips(c.refs) + '</dd>';
				}).join('') + '</dl></div>';
			case 'chart':
				return '<div class="card"><b>' + inline(it.title) + (it.unit ? ' (' + esc(it.unit) + ')' : '') + chips(it.refs) + '</b><dl>' + it.series.map(function (s) {
					return '<dt>' + inline(s.label) + '</dt><dd>' + esc(s.value) + chips(s.refs) + '</dd>';
				}).join('') + '</dl></div>';
			case 'code':
				return '<pre><code>' + it.lines.map(esc).join('\n') + '</code></pre>';
			case 'withheld':
				return '<p class="thought">' + inline(it.text) + '</p>';
			case 'menu':
				return '<ul class="menu">' + it.options.map(function (o, i) {
					return '<li' + (i === it.chosen ? ' class="taken"' : '') + '>' + inline(o.text) + (i === it.chosen ? '<span class="tag">this route</span>' : '') + '</li>';
				}).join('') + '</ul>';
			case 'title':
				return '<p class="title">' + inline(it.title) + '</p>' + (it.authors ? '<p>' + inline(it.authors) + '</p>' : '');
			case 'end':
				var el = KB.endLines(it);
				return (el.origin ? '<p>' + inline(el.origin) + '</p>' : '') + (el.dramatized ? '<p class="thought">Dialogue is dramatized</p>' : '') + (el.note ? '<p class="small">' + inline(el.note) + '</p>' : '');
			case 'read':
				return '<p class="small">(The post is read here; it could not be loaded.)</p>';
			default:
				return it.text ? '<p>' + inline(it.text) + '</p>' : '';
		}
	}

	// The back of board j: the text of board t = backOf(j), a small copy of picture t, a pull mark.
	function backHtml(j) {
		var n = result.boards.length, t = KB.backOf(j, n), bt = result.boards[t - 1];
		var pull = t === n ? 'Pull <span>board ' + n + ' out: the end</span>' : 'Pull <span>board ' + t + ' out: board ' + (t + 1) + ' shows</span>';
		return '<div class="bk">' +
			'<div class="bk-head"><span>Back of board <b>' + j + '</b></span><span>Read while board <b>' + t + '</b> shows</span></div>' +
			'<div class="bk-thumb">' + thumbSvg(bt, 'Board ' + t + ', the picture the audience sees') + '<p>Board ' + t + ' of ' + n + '</p></div>' +
			'<div class="bk-text">' + bt.items.map(itemHtml).join('') + '</div>' +
			'<div class="bk-pull">' + pull + '</div>' +
			'</div>';
	}

	// Shrink each text block until it fits its page (all blocks per pass, so the layout is read only a few times).
	function fit(root, base) {
		var blocks = $$('.bk-text', root);
		var size = blocks.map(function () { return base; });
		blocks.forEach(function (b) { b.style.setProperty('--fit', base + 'em'); });
		for (var pass = 0; pass < 14; pass++) {
			var over = blocks.map(function (b) { return b.scrollHeight > b.clientHeight + 1; });
			var any = false;
			over.forEach(function (o, i) {
				if (o && size[i] > 0.75) { size[i] = Math.max(0.75, size[i] * 0.9); blocks[i].style.setProperty('--fit', size[i].toFixed(3) + 'em'); any = true; }
			});
			if (!any) break;
		}
		return blocks.filter(function (b) { return b.scrollHeight > b.clientHeight + 1; }).length;
	}

	/* ------------------------------------------------------------------ print pages */

	var PAPER = { a4: [297, 210], letter: [279.4, 215.9] };
	function layoutOpts() { return settings.layout === 'fold' ? { layout: 'fold' } : { layout: 'duplex', flip: settings.layout === 'duplex-short' ? 'short' : 'long' }; }

	var printBuilt = false, overflowCount = 0;
	function buildPrint() {
		var n = result.boards.length, o = layoutOpts(), pages = KB.impose(n, o);
		var size = PAPER[settings.paper], aspect = (size[0] - 12) / (size[1] - 12);
		var flipWord = o.layout === 'fold' ? 'fold in half, text behind' : (o.flip === 'long' ? 'two-sided, flip on long edge' : 'two-sided, flip on short edge');
		var title = (program.meta.title || '').slice(0, 60);
		var html = pages.map(function (p) {
			var b = result.boards[(p.front || p.sheet) - 1];
			var foot = '<div class="flipnote">' + esc(title) + ' &middot; sheet ' + p.sheet + ' of ' + n + ' &middot; ' + flipWord + '</div>';
			if (p.side === 'front') {
				return '<section class="sheet" data-label="Page ' + p.page + ': front of board ' + p.sheet + '"><div class="face">' + frontSvg(b, aspect, 'Board ' + p.sheet) + '</div>' + foot + '</section>';
			}
			if (p.side === 'back') {
				return '<section class="sheet' + (p.rotate ? ' turn' : '') + '" data-label="Page ' + p.page + ': back of board ' + p.sheet + (p.rotate ? ', upside down' : '') + '"><div class="face text">' + backHtml(p.sheet) + '</div>' + foot + '</section>';
			}
			// the fold page is portrait (short side across): each half is the sheet's short side by half its long side
			var halfAspect = (size[1] - 12) / (size[0] / 2 - 10);
			return '<section class="sheet turn fold-sheet" data-label="Page ' + p.page + ': board ' + p.sheet + ', fold"><div class="half pic">' + frontSvg(b, halfAspect, 'Board ' + p.sheet, true) + '</div>' +
				'<div class="fold"><span>fold</span></div><div class="half text">' + backHtml(p.sheet) + '</div>' + foot + '</section>';
		}).join('');
		flushSymbols();
		els.print.className = (els.pages.hidden ? 'offstage' : 'preview') + (settings.paper === 'letter' ? ' paper-letter' : '');
		els.print.innerHTML = html;
		// measure at full size, off the screen if the preview is closed
		overflowCount = fit(els.print, o.layout === 'fold' ? 2.3 : 2.8);
		printBuilt = true;
		els.pagesNote.textContent = pages.length + ' pages, ' + n + ' sheets of ' + (settings.paper === 'letter' ? 'Letter' : 'A4') + ', ' + orientation() + '. ' +
			(o.layout === 'fold' ? 'Each page is one board: picture above, text below, turned so that it reads upright once the page is folded with the text behind.' :
				'Odd pages are fronts, even pages are backs' + (o.flip === 'long' ? ', printed upside down.' : '.')) +
			(overflowCount ? ' ' + overflowCount + ' back' + (overflowCount > 1 ? 's are' : ' is') + ' too long to fit even in small type; choose fewer lines per board.' : '');
	}

	function flipText() {
		var o = layoutOpts();
		if (o.layout === 'fold') return 'Assumes one-sided printing: fold each page along the dashed line with the text half behind the picture.';
		if (o.flip === 'long') return 'Assumes the printer flips on the long edge: backs are printed upside down so they read upright from behind the board.';
		return 'Assumes the printer flips on the short edge: backs are printed upright.';
	}

	function orientation() { return settings.layout === 'fold' ? 'portrait' : 'landscape'; }
	function setPaper() {
		els.pageSize.textContent = '@page { size: ' + (settings.paper === 'letter' ? 'letter' : 'A4') + ' ' + orientation() + '; margin: 0; }';
	}

	/* ------------------------------------------------------------------ the page */

	function renderRoute() {
		var menus = result.menus;
		els.routeList.innerHTML = '';
		if (!menus.length) { els.routeSum.textContent = 'this story has no choices'; return; }
		var changed = 0;
		menus.forEach(function (m) {
			if (m.chosen !== 0) changed++;
			var lab = document.createElement('label');
			lab.className = 'field';
			lab.appendChild(document.createTextNode('Choice ' + (m.m + 1) + ' (script line ' + m.line + ')'));
			var sel = document.createElement('select');
			sel.className = 'kit-input';
			m.options.forEach(function (t, i) {
				var o = document.createElement('option');
				o.value = String(i);
				o.textContent = VN.interpolate(t, {}, program.cast);
				sel.appendChild(o);
			});
			sel.value = String(m.chosen);
			sel.addEventListener('change', function () {
				picks = picks.slice(0, m.m);
				while (picks.length < m.m) picks.push(menus[picks.length].chosen);
				picks.push(+sel.value);
				rebuild(true);
				var again = $$('select', els.routeList)[m.m];
				if (again) again.focus();
			});
			lab.appendChild(sel);
			els.routeList.appendChild(lab);
		});
		els.routeSum.textContent = menus.length + ' choice' + (menus.length > 1 ? 's' : '') + ', ' + (changed ? changed + ' changed from the first option' : 'first option each time');
	}

	function renderStrip() {
		var n = result.boards.length;
		els.strip.innerHTML = result.boards.map(function (b, i) {
			var cap = b.kind === 'title' ? 'Title' : b.kind === 'end' ? 'End' : b.kind === 'chapter' ? 'Chapter ' + esc(b.chapter.n) :
				(function (k) { return k + (k === 1 ? ' line' : ' lines'); })(b.items.filter(function (x) { return KB.TEXT_KINDS[x.kind]; }).length);
			return '<button type="button" data-i="' + i + '" tabindex="' + (i === selected ? '0' : '-1') + '" aria-current="' + (i === selected ? 'true' : 'false') + '" aria-label="Board ' + b.n + ' of ' + n + ', ' + cap + '">' +
				thumbSvg(b, '') + '<span class="cap"><b>' + b.n + '</b><span>' + cap + '</span></span></button>';
		}).join('');
		flushSymbols();
	}

	var backSheet = null;
	function renderDetail(scroll) {
		var n = result.boards.length, b = result.boards[selected];
		$$('button', els.strip).forEach(function (x, i) { x.setAttribute('aria-current', i === selected ? 'true' : 'false'); x.tabIndex = i === selected ? 0 : -1; });
		els.frontH.textContent = 'Front of board ' + b.n + ' of ' + n + ': what the audience sees';
		els.front.innerHTML = frontSvg(b, null, 'Board ' + b.n + ', front');
		var t = KB.backOf(b.n, n);
		els.backH.textContent = 'Back of board ' + b.n + ': the text for board ' + t;
		els.back.innerHTML = '<div class="sheet' + (settings.paper === 'letter' ? ' paper-letter' : '') + '"><div class="face text">' + backHtml(b.n) + '</div></div>';
		flushSymbols();
		backSheet = $('.sheet', els.back);
		sizeBack();
		fit(els.back, 2.8);
		els.backNote.textContent = 'Shown upright. ' + (b.n === n ? 'The last board carries the text for board 1, the title.' : 'Board ' + b.n + '\'s back carries board ' + t + '\'s text, because the performer reads from behind the stack.');
		if (scroll) {
			var btn = $$('button', els.strip)[selected];
			if (btn) btn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: ToyKit.reducedMotion ? 'auto' : 'smooth' });
		}
	}
	// The sheet is a fixed paper width (297 or 279.4 mm at 96 px to the inch), so the zoom is computed from that
	// rather than by clearing the zoom and measuring: a measurement taken inside the ResizeObserver callback
	// could come back already zoomed (seen with reduced motion on a phone), which left the zoom at 1 and the
	// page scrolling sideways.
	// The width comes from the same PAPER table the CSS sheet sizes use (.sheet.paper-letter is 279.4 mm). As a
	// guard against the two ever disagreeing again, the zoomed sheet is then measured as drawn (a bounding box
	// is the drawn size, never the unzoomed one) and the zoom is brought down if it still overhangs.
	function sizeBack() {
		if (!backSheet) return;
		var w = els.back.clientWidth;
		if (!w) return;
		var full = PAPER[settings.paper === 'letter' ? 'letter' : 'a4'][0] * 96 / 25.4;
		var zf = Math.max(0.1, Math.min(1, w / full));
		var z = zf.toFixed(4);
		if (backSheet.style.zoom !== z) backSheet.style.zoom = z;
		var drawn = backSheet.getBoundingClientRect().width;
		if (drawn > w + 0.5) {
			z = Math.max(0.1, Math.floor(zf * w / drawn * 1e4) / 1e4).toFixed(4);
			backSheet.style.zoom = z;
		}
		els.back.style.height = '';
	}

	function select(i, scroll) {
		if (!result) return;
		var n = result.boards.length;
		selected = (i + n) % n;
		renderDetail(scroll);
	}

	function rebuild(keepSelection) {
		var t0 = Date.now();
		result = KB.build(VN, program, picks, { perBoard: settings.per, castBreaks: settings.castBreaks });
		resetSymbols();
		if (!keepSelection || selected >= result.boards.length) selected = 0;
		renderRoute();
		renderStrip();
		renderDetail(false);
		printBuilt = false;
		if (!els.pages.hidden) buildPrint();
		var o = layoutOpts();
		var n = result.boards.length;
		els.summary.innerHTML = '<b>' + n + ' boards</b> from ' + result.stops + ' stops of “' + esc(program.meta.title || '') + '”; ' +
			(o.layout === 'fold' ? n + ' pages, one per board.' : (2 * n) + ' pages, ' + n + ' sheets printed on both sides.') +
			(result.truncated ? ' The route stopped early (a loop or an error in the script).' : '');
		els.flipNote.textContent = flipText();
		return Date.now() - t0;
	}

	function openStory(id) {
		var entry = catalog.filter(function (e) { return e.id === id; })[0] || catalog.filter(function (e) { return e.id === 'obfuscation'; })[0] || catalog[0];
		settings.story = entry.id;
		els.story.value = entry.id;
		els.summary.textContent = 'Loading “' + entry.title + '”…';
		return loadProgram(entry).then(function (prog) {
			program = prog;
			picks = [];
			rebuild(false);
		});
	}

	/* ------------------------------------------------------------------ the thumbnail: a fan of three boards */

	function renderFan() {
		var bs = result.boards;
		// the title, an event illustration, and on top the first board with two people on stage
		var story = bs.filter(function (b) { return b.kind === 'story'; });
		var mid = story.filter(function (b) { return b.picture.cg; })[0] || bs.filter(function (b) { return b.kind === 'chapter'; })[0];
		var top = story.filter(function (b) { return b.picture.actors.length >= 2; })[0] || story.filter(function (b) { return b.picture.actors.length; })[0];
		var pick = [bs[0], mid || bs[1], top || bs[2]];
		els.fan.innerHTML = pick.map(function (b) { return '<div class="card">' + frontSvg(b, null, 'Board ' + b.n) + '</div>'; }).join('') +
			'<div class="label">Kamishibai Printer</div>';
		flushSymbols();
	}

	/* ------------------------------------------------------------------ controls */

	els.per.value = String(settings.per);
	if (!els.per.value) { els.per.value = '4'; settings.per = 4; }
	els.castbreaks.checked = settings.castBreaks;
	els.layout.value = settings.layout;
	els.paper.value = settings.paper;
	setPaper();

	els.story.addEventListener('change', function () {
		remember();
		openStory(els.story.value).then(function () { settings.story = els.story.value; remember(); }).catch(failed);
	});
	els.per.addEventListener('change', function () { settings.per = +els.per.value; remember(); if (program) rebuild(true); });
	els.castbreaks.addEventListener('change', function () { settings.castBreaks = els.castbreaks.checked; remember(); if (program) rebuild(true); });
	els.layout.addEventListener('change', function () {
		settings.layout = els.layout.value; remember(); setPaper();
		if (program) { rebuild(true); ToyKit.toast(flipText()); }
	});
	els.paper.addEventListener('change', function () {
		settings.paper = els.paper.value; remember(); setPaper();
		if (program) rebuild(true);
	});
	els.strip.addEventListener('click', function (e) {
		var b = e.target.closest && e.target.closest('button[data-i]');
		if (b) select(+b.getAttribute('data-i'), false);
	});
	els.strip.addEventListener('keydown', function (e) {
		if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
			e.preventDefault();
			var n = result ? result.boards.length : 0;
			select(e.key === 'ArrowRight' ? selected + 1 : e.key === 'ArrowLeft' ? selected - 1 : e.key === 'Home' ? 0 : n - 1, true);
			var btn = $$('button', els.strip)[selected];
			if (btn) btn.focus({ preventScroll: true });
		}
	});
	$('#btn-prev').addEventListener('click', function () { select(selected - 1, true); });
	$('#btn-next').addEventListener('click', function () { select(selected + 1, true); });

	els.btnPages.addEventListener('click', function () {
		var open = els.pages.hidden;
		els.pages.hidden = !open;
		els.btnPages.setAttribute('aria-expanded', open ? 'true' : 'false');
		els.btnPages.textContent = open ? 'Hide the print pages' : 'Show the print pages';
		if (!program) return;
		if (open) { if (!printBuilt) buildPrint(); else els.print.className = 'preview' + (settings.paper === 'letter' ? ' paper-letter' : ''); }
		else els.print.className = 'offstage' + (settings.paper === 'letter' ? ' paper-letter' : '');
	});

	$('#btn-print').addEventListener('click', function () {
		if (!program) return;
		if (!printBuilt) buildPrint();
		ToyKit.toast(flipText());
		window.print();
	});
	window.addEventListener('beforeprint', function () { if (program && !printBuilt) buildPrint(); });

	$('#btn-svg').addEventListener('click', function () {
		if (!result) return;
		var b = result.boards[selected], p = pictureId(b);
		var shared = ART.sharedDefs ? ART.sharedDefs().replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '') : '';
		var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900">' + shared + ownDefs() + p.inner +
			'<text x="1560" y="872" text-anchor="end" font-size="24" fill="#fff" ' + SANS + '>' + b.n + '</text></svg>';
		ToyKit.download((settings.story + '-board-' + b.n + '.svg'), svg, 'image/svg+xml');
		ToyKit.toast('Saved board ' + b.n + ' as an SVG.');
	});

	if (window.ResizeObserver) new ResizeObserver(sizeBack).observe(els.back);
	else window.addEventListener('resize', sizeBack);

	function failed(err) {
		ToyKit.fail(err);
		els.summary.textContent = 'Nothing to print: ' + (err && err.message ? err.message : 'the story did not load.');
		ToyKit.ready();
	}

	/* ------------------------------------------------------------------ start */

	if (!VN || !ART || !KB) {
		failed(new Error('The Paper Theatre engine did not load, so there is nothing to print.'));
		return;
	}
	loadCatalog().then(function () {
		els.story.innerHTML = catalog.map(function (e) {
			return '<option value="' + esc(e.id) + '">' + esc(e.title) + (e.kind === 'blog' ? ' (post)' : '') + '</option>';
		}).join('');
		return openStory(settings.story);
	}).then(function () {
		if (ToyKit.thumb) renderFan();
		ToyKit.ready();
	}).catch(failed);
})();
