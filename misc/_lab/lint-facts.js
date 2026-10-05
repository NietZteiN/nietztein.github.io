/*
 * lint-facts: keeps the numbers of the owner's study in one place.
 *
 *     node misc/_lab/lint-facts.js misc/NN-slug [another folder ...]
 *
 * The figures live in misc/55-paper-theatre/stories/_facts/obfuscation.vn and a
 * toy shows them through Facts.cite (facts.js). This check FAILS a folder when
 *
 *   1. a fact VALUE that contains a percent sign, a decimal point or the letter
 *      rho is written out in one of the folder's .js, .html or .svg files, in
 *      a content: rule of its CSS, or in the card text of its toy.json (title,
 *      desc, note). A count with a thousands comma is guarded too: it is as
 *      recognisable. Spelling it another way does not get past the check: an
 *      escape (backslash-u03c1), an entity (&rho;, &minus;), "rho" for the
 *      letter, a hyphen for the minus sign, "percent" for the sign, a dash for
 *      "to", a count without its comma, a decimal without its last zero and any
 *      spacing all count as written out, and so does the range inside a longer
 *      value;
 *   2. the folder's toy.json lists a key under "facts" that is not in the facts
 *      file;
 *   3. the code asks Facts.cite, Facts.get or Facts.fill for a key that is not
 *      in the facts file (it would throw in the page).
 *
 * It WARNS (without failing) when the bare number of such a figure appears
 * (the percentage without its sign, or as a share of one), when a figure is
 * written out in a .json data file (JSON has no comments, so it could not
 * carry the marker below), and when a key the code uses is missing from
 * toy.json's "facts" list.
 *
 * What is not a figure, and is not read (see layout() below): CSS, wherever it
 * is written (a <style> block, a style attribute, a .css file, a declaration
 * in a string, element.style and cssText in a script, the style and
 * attribute calls of the DOM, d3 and jQuery), a size or position attribute of
 * HTML or SVG whose whole value is numbers, a CSS colour or gradient function,
 * and the remainder operator between two numbers in a code stimulus. Also
 * skipped: node_modules, and any line that carries the marker lint-facts-ok
 * (say why next to it).
 *
 * Exit code 0 when every folder passes, 1 when one fails, 2 for a bad command
 * line. test.js uses lint() directly.
 *
 * This file is plain ASCII: the special characters are built from their codes.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var Facts = require('./facts.js');

var C = String.fromCharCode;
var RHO = C(0x3C1), MINUS = C(0x2212), APPROX = C(0x2248), SECTION = C(0xA7);
var ENDASH = C(0x2013), EMDASH = C(0x2014);
var BOM_RE = new RegExp('^' + C(0xFEFF));       // the byte-order mark some Windows tools put first
var ROOT = path.resolve(__dirname, '..', '..');
var MARKER = 'lint-facts-ok';
// How each kind of file is read: 'text' in full (after layout() has blanked
// what is layout), 'css' for its content: rules alone, 'data' in full but
// only ever warned about.
var EXTENSIONS = { '.js': 'text', '.mjs': 'text', '.html': 'text', '.htm': 'text', '.svg': 'text', '.css': 'css', '.json': 'data' };
var CARD_FIELDS = ['title', 'desc', 'note'];    // the text of toy.json that is printed on the public card

var ENTITIES = {
	rho: RHO, minus: MINUS, percnt: '%', sect: SECTION, asymp: APPROX, ap: APPROX, approx: APPROX, thickapprox: APPROX,
	ndash: ENDASH, mdash: EMDASH, nbsp: ' ', thinsp: ' ', ensp: ' ', emsp: ' ', numsp: ' ', hairsp: ' ',
	lt: '<', gt: '>', equals: '=', period: '.', comma: ','
};
// no-break, figure, thin, narrow and the other typographic spaces
var SPACES = new RegExp('[' + C(0xA0) + C(0x2002) + '-' + C(0x200A) + C(0x202F) + C(0x205F) + ']', 'g');

function fromCode(hex, base) {
	var code = parseInt(hex, base);
	// A newline written as an escape must not move the line numbers.
	if (!(code > 0 && code < 0x110000) || code === 10 || code === 13) return ' ';
	return String.fromCodePoint(code);
}

// The text as a reader would see it: escapes and entities become their
// characters, typographic spaces become plain ones, the minus sign a hyphen.
function decode(text) {
	return String(text)
		.replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, function (m, h) { return fromCode(h, 16); })
		.replace(/\\u([0-9a-fA-F]{4})/g, function (m, h) { return fromCode(h, 16); })
		.replace(/\\x([0-9a-fA-F]{2})/g, function (m, h) { return fromCode(h, 16); })
		.replace(/&#x([0-9a-fA-F]{1,6});/g, function (m, h) { return fromCode(h, 16); })
		.replace(/&#(\d{1,7});/g, function (m, d) { return fromCode(d, 10); })
		.replace(/&([A-Za-z]{2,12});/g, function (m, name) { return Object.prototype.hasOwnProperty.call(ENTITIES, name) ? ENTITIES[name] : m; })
		.replace(SPACES, ' ')
		.split(MINUS).join('-');
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }

// A value as a pattern that also matches its other spellings.
function valuePattern(value) {
	var v = decode(value).trim();
	var parts = v.split(/\s+/).map(function (tok) {
		if (tok.toLowerCase() === 'to') return '(?:to|-|' + ENDASH + '|' + EMDASH + ')';
		if (tok === RHO) return '(?:' + RHO + '|rho)';
		if (tok === APPROX) return '(?:' + APPROX + '|~|=)';
		var comma = /,$/.test(tok), percent = false;
		if (comma) tok = tok.slice(0, -1);
		if (/%$/.test(tok)) { percent = true; tok = tok.slice(0, -1); }
		// a decimal may be written without its last zeros (a made-up 0.70 as 0.7)
		var zeros = /^(-?\d[\d,]*\.\d*[1-9])0+$/.exec(tok);
		var body = zeros ? escapeRe(zeros[1]) + '0*' : escapeRe(tok);
		// a thousands comma may be missing, or be a space
		return body.replace(/(\d),(?=\d{3}(?!\d))/g, '$1[, ]?') + (percent ? '\\s*(?:%|percent|per cent)' : '') + (comma ? ',?' : '');
	});
	var before = /^-?\d/.test(v) ? '(?<![\\d.])' : '';
	var after = /\d$/.test(v) ? '(?!\\d|\\.\\d)' : '';
	return new RegExp(before + parts.join('\\s*') + after, 'gi');
}

var NUM = '-?\\d[\\d,]*(?:\\.\\d+)?';
var RANGE_IN = new RegExp(NUM + '[A-Za-z%]{0,3}\\s+to\\s+' + NUM + '[A-Za-z%]{0,3}', 'g');
var HAS_DECIMAL = /\d\.\d/;
var HAS_THOUSANDS = /\d,\d{3}(?!\d)/;

// Is this value one the lint guards? A percent sign, a decimal point, a rho,
// or a thousands comma.
function guarded(value) {
	return value.indexOf('%') !== -1 || HAS_DECIMAL.test(value) || value.indexOf(RHO) !== -1 || HAS_THOUSANDS.test(value);
}

// What to look for, from the parsed facts.
//   { key, ref, value, shown, re, fails, share }
function patterns(facts) {
	var out = [];
	Object.keys(facts).forEach(function (key) {
		var f = facts[key], value = f.value;
		if (!guarded(value)) return;
		var plain = decode(value).trim();
		out.push({ key: key, ref: f.ref, value: value, shown: value, re: valuePattern(value), fails: true });
		// the range inside a longer value (the "a to b" of a line that also has a label and a p value)
		(plain.match(RANGE_IN) || []).forEach(function (range) {
			if (range !== plain && HAS_DECIMAL.test(range)) out.push({ key: key, ref: f.ref, value: value, shown: range, re: valuePattern(range), fails: true });
		});
		// warnings: the bare number of a percentage with a decimal point, the same
		// percentage as a share of one, and a negative correlation on its own
		var m = /^(-?\d[\d,]*\.(\d+))%$/.exec(plain);
		if (m) {
			out.push({ key: key, ref: f.ref, value: value, shown: m[1], re: new RegExp('(?<![\\d.])' + escapeRe(m[1]) + '(?!\\d|\\.\\d|\\s*(?:%|percent|per cent))', 'g'), fails: false });
			var share = (Number(m[1].replace(/,/g, '')) / 100).toFixed(m[2].length + 2);
			if (/^0\.\d+$/.test(share)) out.push({ key: key, ref: f.ref, value: value, shown: share, re: new RegExp('(?<![\\d.])0?' + escapeRe(share.slice(1)) + '(?!\\d)', 'g'), fails: false, share: true });
		}
		m = new RegExp('^' + RHO + '\\s*=\\s*(-\\d[\\d,]*\\.\\d+)$').exec(plain);
		if (m) out.push({ key: key, ref: f.ref, value: value, shown: m[1], re: new RegExp('(?<![\\w.)\\]])' + escapeRe(m[1]) + '(?!\\d)', 'g'), fails: false });
	});
	return out;
}

// ---- What is layout, not a figure -------------------------------------------------
//
// A percentage in a stylesheet is a width, not a result. layout(text) returns
// the text with every such place blanked out (each character but a line break
// becomes a space, so line numbers hold), and the patterns are then run on
// what is left. The examples use made-up numbers. Blanked:
//
//   a. <style> blocks, except the values of content: rules (those are text);
//   b. style attributes: style="width: 12%", style='...', style=width:12%,
//      and the escaped quotes of markup inside a script string;
//   c. CSS colour, gradient and calc functions, to the closing bracket:
//      hsl(210 40% 60%), linear-gradient(90deg, #000 12%, #fff 60%);
//   d. what a script assigns to a style: el.style.width = "12%",
//      el.style["width"] = ..., el.style.cssText = "left: 12%; top: 60%";
//   e. the value in a style or attribute call: .style('width', '12%'),
//      .css(...), .setProperty(...), and .attr('cx', '12%') or
//      .setAttribute('width', '12%') for the size and position attributes;
//   f. a size or position attribute whose whole value is numbers:
//      width="12%", offset="60%", cx='25%' (and x = "25%" in a script);
//   g. a declaration of a CSS property that takes a length, when its whole
//      value is CSS: "left: 12%; top: 60%" and { width: '12%' }, but not
//      "Width: 12% of the screen";
//   h. the remainder operator between two numbers, spaced the way an
//      operator is: 27 % 4 and 27%4 (but "27% 4" stays a percentage).

var GEOMETRY = 'width|height|x|y|cx|cy|r|rx|ry|x1|x2|y1|y2|dx|dy|fx|fy|fr|offset|startOffset|refX|refY|markerWidth|markerHeight|textLength|' +
	'stroke-width|stroke-dasharray|stroke-dashoffset|font-size|opacity|fill-opacity|stroke-opacity|stop-opacity|flood-opacity';
// CSS properties that take a length, a percentage or a colour, in both spellings (margin-left and marginLeft)
var CSS_PROP = '--[\\w-]+|(?:min-?|max-?)?(?:width|height)|top|right|bottom|left|inset(?:-?[a-z]+)*|margin(?:-?[a-z]+)*|padding(?:-?[a-z]+)*|' +
	'flex(?:-?basis)?|font-?size|line-?height|background(?:-?[a-z]+)*|border(?:-?[a-z]+)*-?radius|transform(?:-?origin)?|opacity|' +
	'(?:row-?|column-?)?gap|grid(?:-?[a-z]+)*|stroke-?dash(?:array|offset)|stroke-?width|text-?indent|vertical-?align|object-?position|' +
	'mask(?:-?[a-z]+)*|clip-?path|backdrop-?filter|filter';
var CSS_FUNCTION = 'hsla?|rgba?|hwb|oklab|oklch|lch|color-mix|(?:repeating-)?(?:linear|radial|conic)-gradient|calc|minmax|fit-content|' +
	'translate(?:[XYZ]|3d)|brightness|saturate|grayscale|sepia|hue-rotate|drop-shadow';
// One CSS value: numbers with units, a few keywords, colours, functions.
var CSS_NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:%|[a-z]{1,4})?';
var CSS_TOKEN = '(?:' + CSS_NUMBER + '|auto|none|inherit|initial|unset|center|left|right|top|bottom|transparent|currentColor|#[0-9a-f]{3,8}|!important|[a-z-]+\\([^()\\n]*(?:\\([^()\\n]*\\)[^()\\n]*)*\\))';
var CSS_VALUE = CSS_TOKEN + '(?:[\\s,/]+' + CSS_TOKEN + ')*';
var NUMBER_LIST = CSS_NUMBER + '(?:[\\s,;]+' + CSS_NUMBER + ')*';

var STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi;
var STYLE_ATTR = /\bstyle\s*=\s*(\\?)(["'])([\s\S]{0,2000}?)\1\2/gi;
var STYLE_BARE = /\bstyle=([^\s"'>\\][^\s>]*)/gi;
var FUNCTION_RE = new RegExp('(?<![\\w$.])(?:' + CSS_FUNCTION + ')\\(', 'g');      // lower case only: these are CSS's own spellings
var ASSIGN_RE = /\.\s*(?:style\s*(?:\.\s*[\w$]+|\[\s*(["'])[-\w]+\1\s*\])|cssText)\s*=(?!=)/g;
var STYLE_CALL = /\.\s*(?:style|css|setProperty)\s*\(\s*(["'])[-\w]+\1\s*,/g;
var ATTR_CALL = new RegExp('\\.\\s*(?:setAttribute|setAttributeNS|attr)\\s*\\(\\s*(?:null\\s*,\\s*)?(["\'])(?:' + GEOMETRY + '|style)\\1\\s*,', 'g');
var ATTR_QUOTED = new RegExp('(?<![\\w$-])(?:' + GEOMETRY + ')\\s*=\\s*(\\\\?)(["\'])(\\s*' + NUMBER_LIST + '\\s*)\\1\\2', 'gi');
var ATTR_BARE = new RegExp('(?<![\\w$-])(?:' + GEOMETRY + ')=(' + CSS_NUMBER + ')(?=[\\s/>])', 'gi');
var DECL_PLAIN = new RegExp('(?<![\\w$.-])(?:' + CSS_PROP + ')\\s*:(\\s*' + CSS_VALUE + ')\\s*(?=;|\\}|\\\\?["\'`]|$)', 'gim');
var DECL_QUOTED = new RegExp('(?<![\\w$.-])(?:' + CSS_PROP + ')\\s*:\\s*(["\'`])(\\s*' + CSS_VALUE + '\\s*)\\1', 'gi');
var CONTENT_RULE = /(?<![\w-])content\s*:\s*([^;{}]*)/gi;
var MODULO_SPACED = /(\d\s+)%(?=\s*\d)/g;
var MODULO_TIGHT = /(\d)%(?=\d)/g;

function blank(s) { return s.replace(/[^\n\r]/g, ' '); }

// Where the string that opens at text[i] (a quote or a backquote) ends: the
// index after its closing quote, or the end of the line it never closed on.
function stringEnd(text, i) {
	var q = text.charAt(i), j = i + 1;
	for (; j < text.length; j++) {
		var c = text.charAt(j);
		if (c === '\\') { j++; continue; }
		if (c === q) return j + 1;
		if (c === '\n' && q !== '`') return j;
	}
	return text.length;
}
// Where the statement that is running at text[i] ends: at a semicolon or a
// line break outside any string or bracket, or at the bracket that closes
// what it sits in. Never further than 2,000 characters on.
function statementEnd(text, i) {
	var depth = 0, stop = Math.min(text.length, i + 2000);
	for (var j = i; j < stop; j++) {
		var c = text.charAt(j);
		if (c === '"' || c === '\'' || c === '`') { j = stringEnd(text, j) - 1; continue; }
		if (c === '(' || c === '[' || c === '{') depth++;
		else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return j; depth--; }
		else if ((c === ';' || c === '\n') && depth === 0) return j;
	}
	return stop;
}
// The index of the bracket that closes the one at text[open], or -1 when there
// is none within `reach` characters. With `strings`, brackets inside a string
// do not count (a call in a script); without, they do (a CSS function, which
// may be put together from pieces of string).
function closing(text, open, reach, strings) {
	var depth = 0, stop = Math.min(text.length, open + reach);
	for (var j = open; j < stop; j++) {
		var c = text.charAt(j);
		if (strings && (c === '"' || c === '\'' || c === '`')) { j = stringEnd(text, j) - 1; continue; }
		if (c === '(') depth++;
		else if (c === ')' && --depth === 0) return j;
	}
	return -1;
}

// A stylesheet with everything blanked but the values of its content: rules.
function cssText(css) {
	var out = blank(css).split(''), m;
	CONTENT_RULE.lastIndex = 0;
	while ((m = CONTENT_RULE.exec(css))) {
		var start = m.index + m[0].length - m[1].length;
		for (var i = 0; i < m[1].length; i++) out[start + i] = m[1].charAt(i);
	}
	return out.join('');
}

// layout(text) -> the text with what is layout blanked out (the list above).
function layout(text) {
	var out = text.split(''), m, end;
	function wipe(from, to) {
		for (var i = Math.max(0, from); i < to && i < out.length; i++) if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' ';
	}
	function each(re, fn) {
		re.lastIndex = 0;
		while ((m = re.exec(text))) {
			if (!m[0]) { re.lastIndex++; continue; }
			fn(m);
		}
	}
	// a. <style> blocks keep their content: rules only
	each(STYLE_BLOCK, function (m) {
		var start = m.index + m[1].length, kept = cssText(m[2]);
		for (var i = 0; i < kept.length; i++) out[start + i] = kept.charAt(i);
	});
	// b. style attributes
	each(STYLE_ATTR, function (m) { wipe(m.index + m[0].length - m[3].length - m[1].length - 1, m.index + m[0].length - m[1].length - 1); });
	each(STYLE_BARE, function (m) { wipe(m.index + m[0].length - m[1].length, m.index + m[0].length); });
	// c. CSS functions
	each(FUNCTION_RE, function (m) {
		var open = m.index + m[0].length - 1;
		end = closing(text, open, 400, false);
		if (end !== -1) wipe(open + 1, end);
	});
	// d. what a script assigns to a style
	each(ASSIGN_RE, function (m) { wipe(m.index + m[0].length, statementEnd(text, m.index + m[0].length)); });
	// e. the value in a style or attribute call
	[STYLE_CALL, ATTR_CALL].forEach(function (re) {
		each(re, function (m) {
			end = closing(text, text.indexOf('(', m.index), 600, true);
			if (end !== -1) wipe(m.index + m[0].length, end);
		});
	});
	// f. size and position attributes
	each(ATTR_QUOTED, function (m) { wipe(m.index + m[0].length - m[3].length - m[1].length - 1, m.index + m[0].length - m[1].length - 1); });
	each(ATTR_BARE, function (m) { wipe(m.index + m[0].length - m[1].length, m.index + m[0].length); });
	// g. CSS declarations
	each(DECL_PLAIN, function (m) { var at = m.index + m[0].indexOf(':') + 1; wipe(at, at + m[1].length); });
	each(DECL_QUOTED, function (m) { wipe(m.index + m[0].length - m[2].length - 1, m.index + m[0].length - 1); });
	// h. the remainder operator
	each(MODULO_SPACED, function (m) { wipe(m.index + m[1].length, m.index + m[1].length + 1); });
	each(MODULO_TIGHT, function (m) { wipe(m.index + 1, m.index + 2); });
	return out.join('');
}

function listFiles(dir) {
	var out = [];
	(function walk(d) {
		var entries;
		try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
		entries.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
		entries.forEach(function (ent) {
			var full = path.join(d, ent.name);
			if (ent.isDirectory()) { if (ent.name !== 'node_modules' && ent.name !== '.git') walk(full); }
			else if (ent.isFile() && EXTENSIONS[path.extname(ent.name).toLowerCase()]) out.push(full);
		});
	})(dir);
	return out;
}

function lineOf(text, index) {
	var n = 1;
	for (var i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
	return n;
}

var CALL_RE = /\bFacts\s*\.\s*(cite|get)\s*\(\s*(['"])([A-Za-z_][\w\-]*)\2/g;
var FILL_RE = /\bFacts\s*\.\s*fill\s*\(\s*(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;

// lint(dir, { factsFile }) -> { ok, dir, files, guarded, failures, warnings, listed, used }
// failures and warnings are [{ file, line, message }] with `file` relative to dir.
// `files` counts the .js, .html, .svg and .css files read; .json files are
// read too (they can only warn) and are not counted.
function lint(dir, opts) {
	opts = opts || {};
	var factsFile = opts.factsFile || path.join(ROOT, Facts.FILE);
	var facts = Facts.parse(fs.readFileSync(factsFile, 'utf8'));
	var pats = patterns(facts);
	var ordered = pats.filter(function (p) { return p.fails; }).concat(pats.filter(function (p) { return !p.fails; }));
	var result = { ok: true, dir: dir, files: 0, guarded: pats.filter(function (p) { return p.shown === p.value; }).length, failures: [], warnings: [], listed: null, used: [] };
	function fail(file, line, message) { result.failures.push({ file: file, line: line, message: message }); }
	function warn(file, line, message) { result.warnings.push({ file: file, line: line, message: message }); }
	var used = {};
	var manifestFile = path.join(dir, 'toy.json');

	listFiles(dir).forEach(function (full) {
		var rel = path.relative(dir, full).replace(/\\/g, '/');
		var kind = EXTENSIONS[path.extname(full).toLowerCase()];
		if (kind === 'data' && path.resolve(full) === path.resolve(manifestFile)) return;        // the manifest is read below
		var raw;
		try { raw = fs.readFileSync(full, 'utf8'); } catch (e) { fail(rel, 0, 'could not be read: ' + e.message); return; }
		if (kind !== 'data') result.files++;
		var text = decode(kind === 'css' ? cssText(raw) : layout(raw));
		var lines = raw.split('\n');
		function allowed(line) { return (lines[line - 1] || '').indexOf(MARKER) !== -1; }
		// One report per figure and line; a line that already fails for a figure is
		// not also warned about (the failing patterns come first).
		var seen = {};
		ordered.forEach(function (p) {
			var m;
			p.re.lastIndex = 0;
			while ((m = p.re.exec(text))) {
				if (!m[0]) { p.re.lastIndex++; continue; }
				var line = lineOf(text, m.index);
				var tag = line + ':' + p.key;
				if (allowed(line) || seen[tag]) continue;
				seen[tag] = true;
				var where = p.ref ? ' (' + p.ref + ')' : '', found = m[0].replace(/\s+/g, ' ');
				if (p.fails && kind === 'data') {
					warn(rel, line, 'the study\'s figure ' + p.key + where + ' is written out ("' + found + '") in a JSON file, which cannot carry the marker ' + MARKER +
						', so this only warns; if the page shows it, show it with Facts.cite(\'' + p.key + '\') instead');
				} else if (p.fails) {
					fail(rel, line, 'the study\'s figure ' + p.key + where + ' is written out ("' + found + '"); show it with Facts.cite(\'' + p.key + '\'). ' +
						'If this is not the study\'s figure, put ' + MARKER + ' and the reason in a comment on that line');
				} else {
					warn(rel, line, '"' + m[0] + '" is the number in the study\'s figure ' + p.key + where + (p.share ? ', as a share of one' : '') +
						'; if that is what it is, show it with Facts.cite(\'' + p.key + '\')');
				}
			}
		});
		if (kind !== 'text') return;
		// keys the code asks for
		var call;
		CALL_RE.lastIndex = 0;
		while ((call = CALL_RE.exec(text))) note(call[3], lineOf(text, call.index));
		FILL_RE.lastIndex = 0;
		while ((call = FILL_RE.exec(text))) {
			var keyRe = /\{([A-Za-z_][\w\-]*)\}/g, k;
			while ((k = keyRe.exec(call[2]))) note(k[1], lineOf(text, call.index));
		}
		function note(key, line) {
			if (allowed(line)) return;
			if (!Object.prototype.hasOwnProperty.call(facts, key)) fail(rel, line, 'Facts is asked for "' + key + '", which is not in the facts file');
			else if (!used[key]) used[key] = { file: rel, line: line };
		}
	});
	result.used = Object.keys(used).sort();

	// toy.json
	if (fs.existsSync(manifestFile)) {
		var manifest = null, manifestRaw = '';
		try {
			manifestRaw = fs.readFileSync(manifestFile, 'utf8').replace(BOM_RE, '');
			manifest = JSON.parse(manifestRaw);
		} catch (e) { fail('toy.json', 0, 'does not parse as JSON: ' + e.message); }
		if (manifest && manifest.facts !== undefined) {
			if (!Array.isArray(manifest.facts)) fail('toy.json', 0, '"facts" must be a list of keys from the facts file');
			else {
				result.listed = [];
				manifest.facts.forEach(function (key) {
					if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(facts, key)) fail('toy.json', 0, '"facts" lists ' + JSON.stringify(key) + ', which is not in the facts file');
					else result.listed.push(key);
				});
			}
		}
		if (manifest) {
			// The card text is printed on the public Misc tab, where nothing can be
			// cited, so a figure of the study has no place in it at all.
			CARD_FIELDS.forEach(function (field) {
				if (typeof manifest[field] !== 'string') return;
				var text = decode(layout(manifest[field]));
				var at = new RegExp('"' + field + '"\\s*:').exec(manifestRaw);
				var line = at ? lineOf(manifestRaw, at.index) : 0, told = {};
				pats.forEach(function (p) {
					if (!p.fails || told[p.key]) return;
					p.re.lastIndex = 0;
					var m = p.re.exec(text);
					if (!m || !m[0]) return;
					told[p.key] = true;
					fail('toy.json', line, 'the card text "' + field + '" writes out the study\'s figure ' + p.key + (p.ref ? ' (' + p.ref + ')' : '') + ' ("' + m[0].replace(/\s+/g, ' ') +
						'"); a card cannot cite, so leave the figure to the page, or say it another way if it is not the study\'s');
				});
			});
			result.used.forEach(function (key) {
				if (!result.listed || result.listed.indexOf(key) === -1) warn(used[key].file, used[key].line, 'the page cites ' + key + '; add it to "facts" in toy.json');
			});
		}
	}
	result.ok = result.failures.length === 0;
	return result;
}

function main(argv) {
	var dirs = argv.filter(function (a) { return a.charAt(0) !== '-'; });
	if (!dirs.length || argv.indexOf('--help') !== -1 || argv.indexOf('-h') !== -1) {
		console.log('Usage: node misc/_lab/lint-facts.js misc/NN-slug [another folder ...]');
		return dirs.length ? 0 : 2;
	}
	var failed = 0;
	for (var i = 0; i < dirs.length; i++) {
		var dir = path.resolve(dirs[i]);
		var shown = path.relative(ROOT, dir).replace(/\\/g, '/') || '.';
		if (shown.indexOf('..') === 0) shown = dir;
		var stat = null;
		try { stat = fs.statSync(dir); } catch (e) { stat = null; }
		if (!stat || !stat.isDirectory()) {
			console.error('lint-facts: ' + dirs[i] + ' is not a folder');
			return 2;
		}
		var r;
		try { r = lint(dir); }
		catch (e) { console.error('lint-facts: ' + e.message); return 2; }
		r.failures.forEach(function (f) { console.log('FAIL  ' + shown + '/' + f.file + (f.line ? ':' + f.line : '') + '  ' + f.message); });
		r.warnings.forEach(function (w) { console.log('WARN  ' + shown + '/' + w.file + (w.line ? ':' + w.line : '') + '  ' + w.message); });
		var listed = r.listed ? 'toy.json lists ' + r.listed.length + ' fact' + (r.listed.length === 1 ? '' : 's') : 'toy.json lists no facts';
		var summary = r.files + ' file' + (r.files === 1 ? '' : 's') + ' checked against ' + r.guarded + ' guarded figures; ' + listed +
			'; the code cites ' + r.used.length + (r.used.length ? ' (' + r.used.join(', ') + ')' : '');
		if (r.ok) console.log('PASS  ' + shown + '  ' + summary);
		else { failed++; console.log('FAIL  ' + shown + '  ' + r.failures.length + ' problem' + (r.failures.length === 1 ? '' : 's') + '; ' + summary); }
	}
	return failed ? 1 : 0;
}

module.exports = { lint: lint, patterns: patterns, guarded: guarded, decode: decode, valuePattern: valuePattern, layout: layout, cssText: cssText, MARKER: MARKER };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
