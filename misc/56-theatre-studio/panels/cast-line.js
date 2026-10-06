/* Theatre Studio, cast designer: an @cast line <-> a form, with no DOM.
 *
 * parse(line)      -> form | null      the @cast line as the form holds it (null = not an @cast line)
 * format(form)     -> '@cast ...'      the line back, traits in one fixed order, unknown tokens kept at the end
 * toDecl(x, VN)    -> declaration      what the theatre's own parser (VN.parse) makes of a line or a form
 * issuesFor(x, VN) -> [issue]          what VN.parse says about that line on its own
 * logical(text)    -> [{text, line, end}]   logical lines (indented lines joined), as vn.js reads them
 * castAt(text, n)  -> {line, end, text, form} | null   the @cast statement that physical line n belongs to
 * findCast(text, id) -> {line, end, ...} | null
 * insertAfter(text) -> n               the physical line a new @cast goes after (0 = before line 1):
 *                                     after the last @cast, else after the last header directive, else at the top
 * checkId(id)      -> '' | message     whether a name can stand before a colon in a speaker line
 *
 * A form: { id, name, hue, skin, build, hair, hairhue, hairtone, clothes, glasses, hat,
 *           lattice, player, page, coauthor, extra: [] }; null means "not written" (the engine picks).
 * The token rules mirror parseCastDecl in ../../55-paper-theatre/vn.js: the last of a repeated trait wins,
 * a bare `lattice` is sparse, an unknown `hairtone=` is dropped, anything else unknown is kept as written.
 */
(function (root, factory) {
	'use strict';
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.CastLine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	// the token lists come from the engine when it is there (browser: window.VN; Node: require)
	function engine(VN) {
		if (VN) return VN;
		if (typeof window !== 'undefined' && window.VN) return window.VN;
		if (typeof require === 'function') { try { return require('../../55-paper-theatre/vn.js'); } catch (e) { /* no engine */ } }
		return null;
	}

	var HEADER = /^@(title|kind|source|cite|arxiv|link|authors|note|status|palette|cast|fact|include|verify|file)(\s|$)/;
	var CAST = /^@cast\s+(.+)$/;

	// Same tokenizer as vn.js: "double quotes" keep spaces, and drop the quotes.
	function tokens(s) {
		var out = [], re = /([^\s"]*)"([^"]*)"|(\S+)/g, m;
		while ((m = re.exec(s))) out.push(m[2] != null ? m[1] + m[2] : m[3]);
		return out;
	}
	function mod360(v) { return ((parseInt(v, 10) || 0) % 360 + 360) % 360; }

	function blank() {
		return { id: '', name: null, hue: null, skin: null, build: null, hair: null, hairhue: null, hairtone: null, clothes: null,
			glasses: false, hat: false, lattice: null, player: false, page: false, coauthor: false, extra: [] };
	}

	function parse(line, VN) {
		VN = engine(VN);
		var m = CAST.exec(String(line == null ? '' : line).trim());
		if (!m) return null;
		var toks = tokens(m[1]);
		if (!toks.length) return null;
		var HAIR = VN.HAIR, CLOTHES = VN.CLOTHES, TONES = VN.HAIRTONES;
		var f = blank();
		f.id = toks[0];
		for (var i = 1; i < toks.length; i++) {
			var t = toks[i], kv = /^([a-z]+)=(.*)$/.exec(t);
			if (kv) {
				var k = kv[1], v = kv[2].replace(/^"|"$/g, '');
				if (k === 'name') f.name = v;
				else if (k === 'hue') f.hue = mod360(v);
				else if (k === 'skin') f.skin = Math.min(5, Math.max(1, parseInt(v, 10) || 1));
				else if (k === 'hairhue') f.hairhue = mod360(v);
				else if (k === 'hairtone') { if (TONES.indexOf(v) >= 0) f.hairtone = v; }
				else if (k === 'lattice') f.lattice = v === 'dense' ? 'dense' : 'sparse';
				else f.extra.push(t);
			} else if (HAIR.indexOf(t) >= 0) f.hair = t;
			else if (CLOTHES.indexOf(t) >= 0) f.clothes = t;
			else if (t === 'glasses') f.glasses = true;
			else if (t === 'hat') f.hat = true;
			else if (t === 'fem' || t === 'masc') f.build = t;
			else if (t === 'player') f.player = true;
			else if (t === 'page') f.page = true;
			else if (t === 'coauthor') f.coauthor = true;
			else if (t === 'lattice') f.lattice = 'sparse';
			else f.extra.push(t);
		}
		return f;
	}

	function quoteName(s) { return 'name="' + String(s).replace(/"/g, "'").replace(/\s+/g, ' ') + '"'; }

	// The order: what the figure is, its name tag, colours, build, hair, accessories, clothes, the coauthor flag.
	// '@cast Jack hue=210 skin=2 masc hairhue=25 hairtone=dark glasses short hoodie' comes back as written.
	function format(f) {
		f = f || blank();
		var out = ['@cast', String(f.id || '').replace(/[\s"]+/g, '') || 'Name'];
		if (f.player) out.push('player');
		if (f.page) out.push('page');
		if (f.name != null) out.push(quoteName(f.name));
		if (f.lattice) out.push('lattice=' + (f.lattice === 'dense' ? 'dense' : 'sparse'));
		if (f.hue != null) out.push('hue=' + mod360(f.hue));
		if (f.skin != null) out.push('skin=' + Math.min(5, Math.max(1, f.skin | 0)));
		if (f.build) out.push(f.build);
		if (f.hairhue != null) out.push('hairhue=' + mod360(f.hairhue));
		if (f.hairtone) out.push('hairtone=' + f.hairtone);
		if (f.glasses) out.push('glasses');
		if (f.hat) out.push('hat');
		if (f.hair) out.push(f.hair);
		if (f.clothes) out.push(f.clothes);
		if (f.coauthor) out.push('coauthor');
		(f.extra || []).forEach(function (t) { if (t) out.push(/\s/.test(t) ? t.replace(/=(.*)$/, '="$1"') : t); });
		return out.join(' ');
	}

	function lineOf(x) { return typeof x === 'string' ? x.trim() : format(x); }
	function parsed(x, VN) {
		VN = engine(VN);
		return VN.parse('@title t\n@kind blog\n' + lineOf(x) + '\n');
	}
	function toDecl(x, VN) {
		var p = parsed(x, VN), keys = Object.keys(p.cast);
		for (var i = 0; i < keys.length; i++) if (keys[i] !== 'page' || p.cast[keys[i]].line) return p.cast[keys[i]];
		return null;
	}
	function issuesFor(x, VN) {
		return parsed(x, VN).issues.filter(function (i) { return i.line === 3; }).map(function (i) { return { level: i.level, msg: i.msg, hint: i.hint, code: i.code }; });
	}

	function checkId(id) {
		id = String(id || '');
		if (!id) return 'Give the character a name: it is what you type before the colon.';
		if (!/^[A-Za-z][\w\-]*$/.test(id)) return 'Use one word of letters, digits, - or _ that starts with a letter; the display name can have spaces.';
		return '';
	}

	function physical(text) {
		text = String(text == null ? '' : text);
		if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
		return text.split(/\r\n|\r|\n/);
	}
	// [{text, line, end}] with 1-based first and last physical line; blank lines dropped (vn.js logicalLines)
	function logical(text) {
		var ph = physical(text), out = [], prevBlank = true;
		for (var i = 0; i < ph.length; i++) {
			var raw = ph[i];
			if (/^[ \t]+\S/.test(raw) && out.length && !prevBlank) {
				var last = out[out.length - 1];
				last.text += ' ' + raw.trim(); last.end = i + 1;
				continue;
			}
			if (!raw.trim()) { prevBlank = true; continue; }
			prevBlank = false;
			out.push({ text: raw.trim(), line: i + 1, end: i + 1 });
		}
		return out;
	}

	function castAt(text, n, VN) {
		var ls = logical(text);
		for (var i = 0; i < ls.length; i++) {
			if (n >= ls[i].line && n <= ls[i].end) {
				var f = CAST.test(ls[i].text) ? parse(ls[i].text, VN) : null;
				return f ? { line: ls[i].line, end: ls[i].end, text: ls[i].text, form: f } : null;
			}
		}
		return null;
	}
	function findCast(text, id, VN) {
		var key = String(id || '').toLowerCase(), ls = logical(text);
		for (var i = 0; i < ls.length; i++) {
			if (!CAST.test(ls[i].text)) continue;
			var f = parse(ls[i].text, VN);
			if (f && f.id.toLowerCase() === key) return { line: ls[i].line, end: ls[i].end, text: ls[i].text, form: f };
		}
		return null;
	}
	function allCast(text, VN) {
		return logical(text).filter(function (l) { return CAST.test(l.text); }).map(function (l) {
			return { line: l.line, end: l.end, text: l.text, form: parse(l.text, VN) };
		}).filter(function (c) { return c.form; });
	}
	// The header ends at the first logical line that is neither a comment nor a header directive.
	function insertAfter(text) {
		var ls = logical(text), lastCast = 0, lastHead = 0;
		for (var i = 0; i < ls.length; i++) {
			var t = ls[i].text;
			if (t.charAt(0) === '#') continue;
			if (!HEADER.test(t)) break;
			lastHead = ls[i].end;
			if (/^@cast(\s|$)/.test(t)) lastCast = ls[i].end;
		}
		return lastCast || lastHead;
	}

	function presets() {
		return [
			{ label: 'Jack', line: '@cast Jack hue=210 skin=2 masc hairhue=25 hairtone=dark glasses short hoodie' },
			{ label: 'A model (sparse lattice)', line: '@cast Model lattice=sparse hue=192' },
			{ label: 'A model (dense lattice)', line: '@cast Model lattice=dense hue=192' },
			{ label: 'The reader (from behind)', line: '@cast You player hue=20' },
			{ label: 'A page (for quotations)', line: '@cast Page page' }
		];
	}

	// Keep only the declaration fields that matter when two declarations are compared.
	function declFields(d) {
		if (!d) return null;
		var o = {};
		['id', 'key', 'name', 'hue', 'skin', 'hair', 'clothes', 'glasses', 'hat', 'lattice', 'player', 'page', 'coauthor', 'build', 'hairhue', 'hairtone'].forEach(function (k) {
			o[k] = d[k] === undefined ? null : d[k];
		});
		return o;
	}

	return {
		tokens: tokens, blank: blank, parse: parse, format: format, toDecl: toDecl, issuesFor: issuesFor, checkId: checkId,
		logical: logical, castAt: castAt, findCast: findCast, allCast: allCast, insertAfter: insertAfter,
		presets: presets, declFields: declFields
	};
});
