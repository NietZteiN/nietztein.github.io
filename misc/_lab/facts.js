/*
 * Facts: the cited figures of the owner's obfuscation study, read at run time
 * from the one file that holds them:
 *     misc/55-paper-theatre/stories/_facts/obfuscation.vn
 * (lines of the form "@fact key = value ^ref", the same file the Paper Theatre
 * stories include). A toy shows a figure from that study ONLY through this
 * module, so the numbers live in one place and always carry their reference.
 * `node misc/_lab/lint-facts.js misc/NN-slug` fails a toy that writes one out.
 *
 * UMD: window.Facts in a page (needs ToyKit for load and cite), module.exports
 * under Node (parse and the constants; lint-facts.js and test.js use them).
 *
 *     Facts.load().then(function () {
 *         el.appendChild(Facts.cite('human_l0'));         // the value, its section mark, a link to the PDF
 *         // a sentence of the published story obfuscation-src.vn, with its figures cited:
 *         el.appendChild(Facts.fill('Human accuracy falls from {human_l0} at L0 to {human_l3} at L3.'));
 *         Facts.get('human_l0').num;                      // a number, where the value is one
 *     });
 *
 * This file is plain ASCII: the few special characters are built from their codes.
 */
(function () {
	'use strict';

	var C = String.fromCharCode;
	var SECTION = C(0xA7), PILCROW = C(0xB6), RHO = C(0x3C1), MINUS = C(0x2212), APPROX = C(0x2248);

	var FILE = 'misc/55-paper-theatre/stories/_facts/obfuscation.vn';
	var PDF = 'assets/documents/publications/2026SPLASH-SRC.pdf';
	var SOURCE = 'the SPLASH SRC abstract';

	// ---- Parsing (pure) ---------------------------------------------------------

	// The reference at the end of a fact: ^(section sign)3.2, ^p.2, ^(pilcrow)4 or
	// ^para. The same pattern as CHIP_RE in misc/55-paper-theatre/vn.js.
	var CHIP_RE = new RegExp('\\s*\\^(' + SECTION + '[\\w.\\-:]+|p\\.\\s?[\\w.\\-]+|' + PILCROW + '\\d+|para)\\s*$');
	var FACT_RE = /^@fact\s+(.+)$/;
	var PAIR_RE = /^([A-Za-z_][\w\-]*)\s*=\s*(.*)$/;

	var WORDS = {
		zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
		eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
		nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
	};
	var NUM = '[+\\-' + MINUS + ']?\\d[\\d,]*(?:\\.\\d+)?';
	var ONE_RE = new RegExp('^(' + NUM + ')(%|[A-Za-z]{1,3})?$');
	var RANGE_RE = new RegExp('^(' + NUM + ')(%|[A-Za-z]{1,3})?\\s+to\\s+(' + NUM + ')(%|[A-Za-z]{1,3})?(?=$|[\\s,;])');
	var RHO_RE = new RegExp('^(?:mean\\s+)?' + RHO + '\\s*[=' + APPROX + ']\\s*');

	function toNumber(s) {
		var n = Number(String(s).replace(new RegExp(MINUS, 'g'), '-').replace(/,/g, ''));
		return isFinite(n) ? n : null;
	}

	// What a value is as a number, if it is one. (The examples are made up: the
	// study's own figures are written nowhere but in the facts file.)
	//     '12.5%'           -> { num: 12.5, unit: '%', range: null }
	//     '1,234'           -> { num: 1234, unit: '', range: null }
	//     'Forty'           -> { num: 40, unit: '', range: null }       (a number word up to ninety)
	//     'rho = -0.25'     -> { num: -0.25, unit: rho, range: null }   (with the real rho and minus signs)
	//     'rho = 0.10 to 0.20, p < 0.05' -> { num: null, unit: rho, range: [0.1, 0.2] }
	//     'a long while', '2026-01-02'   -> { num: null, unit: '', range: null }
	// The value itself is never changed: show `value`, compute with `num`.
	function describe(value) {
		var v = String(value == null ? '' : value).trim();
		var out = { num: null, unit: '', range: null };
		var word = WORDS[v.toLowerCase()];
		if (word != null) { out.num = word; return out; }
		var rest = v, rho = RHO_RE.exec(v);
		if (rho) { rest = v.slice(rho[0].length); out.unit = RHO; }
		var m = ONE_RE.exec(rest);
		if (m) {
			out.num = toNumber(m[1]);
			if (m[2]) out.unit = m[2];
			return out;
		}
		m = RANGE_RE.exec(rest);
		if (m) {
			var lo = toNumber(m[1]), hi = toNumber(m[3]);
			if (lo != null && hi != null) out.range = [lo, hi];
			if (!out.unit && (m[2] || m[4])) out.unit = m[4] || m[2];
		}
		return out;
	}

	// The file as logical lines, the way the story engine reads it: a line that
	// starts with blank space continues the line before it; blank lines go.
	function logicalLines(text) {
		text = String(text == null ? '' : text);
		if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
		var out = [], physical = text.split(/\r\n|\r|\n/);
		for (var i = 0; i < physical.length; i++) {
			var raw = physical[i];
			if (/^[ \t]+\S/.test(raw) && out.length && !out[out.length - 1].blank) {
				out[out.length - 1].text += ' ' + raw.trim();
				continue;
			}
			var t = raw.trim();
			out.push({ text: t, line: i + 1, blank: !t });
		}
		return out.filter(function (l) { return !l.blank; });
	}

	// parse(text) -> { key: { key, value, ref, num, unit, range, line } }
	// One entry per "@fact key = value ^ref" line. `value` is the text between
	// the equals sign and the reference, verbatim; `ref` is the reference without
	// its caret. Lines that start with # are comments. A later line with the
	// same key replaces an earlier one, as in the story engine.
	function parse(text) {
		var facts = {}, lines = logicalLines(text);
		for (var i = 0; i < lines.length; i++) {
			var t = lines[i].text;
			if (t.charAt(0) === '#') continue;
			var m = FACT_RE.exec(t);
			if (!m) continue;
			var pair = PAIR_RE.exec(m[1]);
			if (!pair || pair[1] === '__proto__') continue;
			var body = pair[2], chip = CHIP_RE.exec(body), ref = null;
			if (chip) {
				ref = chip[1].replace(/^p\.\s+/, 'p.');
				body = body.slice(0, chip.index).replace(/\s+$/, '');
			}
			var d = describe(body);
			facts[pair[1]] = { key: pair[1], value: body, ref: ref, num: d.num, unit: d.unit, range: d.range, line: lines[i].line };
		}
		return facts;
	}

	// A reference in words, for a title or a screen reader: 'section 3.2', 'page 2'.
	function refWords(ref) {
		ref = String(ref == null ? '' : ref);
		if (ref.charAt(0) === SECTION) return 'section ' + ref.slice(1);
		if (/^p\./.test(ref)) return 'page ' + ref.slice(2).trim();
		if (ref.charAt(0) === PILCROW) return 'paragraph ' + ref.slice(1);
		return ref;
	}

	var pure = { FILE: FILE, PDF: PDF, SOURCE: SOURCE, parse: parse, describe: describe, refWords: refWords };
	if (typeof module === 'object' && module && module.exports) module.exports = pure;
	if (typeof window === 'undefined' || typeof document === 'undefined') return;

	// ---- Browser part -----------------------------------------------------------

	var facts = null, loading = null;

	function root() {
		if (window.ToyKit && window.ToyKit.root) return window.ToyKit.root;
		try { return new URL('../../', window.location.href).href; } catch (e) { return '/'; }
	}
	function plain(message, detail) {
		var err = new Error(message);
		err.plain = true;          // ToyKit.fail(err) shows the message as it is
		err.detail = detail || '';
		return err;
	}

	// load() -> Promise of the facts ({ key: fact }). One request for the page,
	// however many callers. Rejects with an Error that ToyKit.fail(err) can show.
	function load() {
		if (facts) return Promise.resolve(all());
		if (loading) return loading;
		var url = root() + FILE;
		var what = 'The figures quoted from the study';
		if (typeof window.fetch !== 'function') {
			return Promise.reject(plain(what + ' could not be loaded because this browser is too old for this page.', 'window.fetch is missing'));
		}
		loading = window.fetch(url).then(function (res) {
			if (!res.ok) {
				if (res.body && res.body.cancel) res.body.cancel();
				throw plain(what + ' could not be loaded (the server answered ' + res.status + ').', 'GET ' + url + ' -> HTTP ' + res.status);
			}
			return res.text();
		}).then(function (text) {
			var parsed = parse(text);
			if (!Object.keys(parsed).length) throw plain(what + ' arrived damaged and could not be read.', 'no @fact line in ' + url);
			facts = parsed;
			return all();
		}, function (err) {
			if (err && err.plain) throw err;
			throw plain(what + ' could not be loaded. The connection may be down; reloading the page usually fixes it.', 'GET ' + url + ' failed: ' + (err && err.message ? err.message : String(err)));
		});
		loading.then(null, function () { loading = null; });       // a failed load can be tried again
		return loading;
	}

	// get(key) -> the fact, or null when there is none (or load() has not finished).
	function get(key) {
		return facts && Object.prototype.hasOwnProperty.call(facts, key) ? copy(facts[key]) : null;
	}
	function copy(f) {
		return { key: f.key, value: f.value, ref: f.ref, num: f.num, unit: f.unit, range: f.range ? f.range.slice() : null, line: f.line };
	}
	// all() -> { key: fact }, a copy; empty before load() has finished.
	function all() {
		var out = {};
		if (facts) Object.keys(facts).forEach(function (k) { out[k] = copy(facts[k]); });
		return out;
	}
	function need(key) {
		if (!facts) throw new Error('Facts: call Facts.load() and wait for it before Facts.cite("' + key + '")');
		if (!Object.prototype.hasOwnProperty.call(facts, key)) throw new Error('Facts: there is no fact called "' + key + '" in ' + FILE);
		return facts[key];
	}

	// cite(key) -> <span class="lab-fact">: the value exactly as the abstract
	// prints it, followed by its section or page mark, which links to the
	// published abstract (a PDF, opened in a new tab). Throws on an unknown key.
	function cite(key) {
		var f = need(key);
		var span = document.createElement('span');
		span.className = 'lab-fact';
		span.setAttribute('data-fact', f.key);
		var value = document.createElement('span');
		value.className = 'lab-fact-value';
		value.textContent = f.value;
		span.appendChild(value);
		if (f.ref) {
			var where = SOURCE + ', ' + refWords(f.ref);
			var a = document.createElement('a');
			a.className = 'lab-fact-ref';
			a.href = root() + PDF;
			a.target = '_blank';
			a.rel = 'noopener';
			a.textContent = f.ref;
			a.title = 'Quoted from ' + where + ' (PDF)';
			a.setAttribute('aria-label', 'source: ' + where + ', PDF');
			span.appendChild(document.createTextNode(C(0xA0)));       // a no-break space: the mark never wraps away from its figure
			span.appendChild(a);
		}
		return span;
	}

	// fill('From {human_l0} to {human_l3}.') -> a DocumentFragment in which every
	// {key} is the cited fact and everything else is plain text (never HTML).
	// The words around a figure are a claim about the study too: take them from
	// the abstract or a published story. Throws on an unknown key.
	function fill(template) {
		var frag = document.createDocumentFragment();
		var re = /\{([A-Za-z_][\w\-]*)\}/g, s = String(template == null ? '' : template), at = 0, m;
		while ((m = re.exec(s))) {
			if (m.index > at) frag.appendChild(document.createTextNode(s.slice(at, m.index)));
			frag.appendChild(cite(m[1]));
			at = m.index + m[0].length;
		}
		if (at < s.length) frag.appendChild(document.createTextNode(s.slice(at)));
		return frag;
	}

	// source() -> <p class="lab-source">: one line that says where the marked
	// figures come from, with the link. Put it under anything that cites.
	function source() {
		var p = document.createElement('p');
		p.className = 'lab-source';
		p.appendChild(document.createTextNode('Figures with a ' + SECTION + ' or p. mark are quoted from '));
		var a = document.createElement('a');
		a.href = root() + PDF;
		a.target = '_blank';
		a.rel = 'noopener';
		a.textContent = SOURCE;
		p.appendChild(a);
		p.appendChild(document.createTextNode(' (PDF); the mark is the section or page.'));
		return p;
	}

	var api = {
		FILE: FILE, PDF: PDF, SOURCE: SOURCE,
		parse: parse, describe: describe, refWords: refWords,
		load: load, get: get, all: all, cite: cite, fill: fill, source: source
	};
	Object.defineProperty(api, 'loaded', { enumerable: true, get: function () { return !!facts; } });
	window.Facts = api;
})();
