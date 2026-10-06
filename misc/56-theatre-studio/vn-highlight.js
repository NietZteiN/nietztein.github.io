/*
 * Theatre Studio: syntax colouring and completion for Paper Theatre .vn scripts.
 * Pure: no DOM. window.VNHighlight in the browser (after vn.js), module.exports in Node.
 *
 *   tokenize(line, {cast, cont})  -> [{type, text}]   the tokens concatenate back to exactly `line`
 *   toHTML(tokens)                -> string            spans with class "t-<type>" ("text" and "ws" are bare)
 *   castOf(text | lines)          -> {lowercase name: name as written}   from the @cast lines
 *   suggest(before, data, force)  -> {from, partial, items: [{label, insert, kind}]} | null
 *
 * The grammar is the one vn.js parses (stories/README.md). A line that starts with blanks right after a line that is
 * not blank continues it (`cont`); every other line is one statement. `cast`, when given, decides which "Name:" lines
 * are speaker lines, as it does in the engine.
 */
(function (root, factory) {
	'use strict';
	var node = typeof module === 'object' && module.exports;
	var VN = node ? require('../55-paper-theatre/vn.js') : root.VN;
	var api = factory(VN || null);
	if (node) module.exports = api;
	else root.VNHighlight = api;
})(typeof self !== 'undefined' ? self : this, function (VN) {
	'use strict';

	function list(k, d) { return VN && VN[k] ? (Array.isArray(VN[k]) ? VN[k].slice() : Object.keys(VN[k])) : (d || []); }

	var FACES = list('FACES'), BACKGROUNDS = list('BACKGROUNDS'), BG_MODS = list('BG_MODS'), CG_MODS = list('CG_MODS');
	var TRANSITIONS = list('TRANSITIONS'), FX = list('FX'), FX_ONESHOT = list('FX_ONESHOT'), CGS = list('CGS'), TONES = list('TONES');
	var MUSIC = list('MUSIC'), AMBIENCE = list('AMBIENCE'), SFX = list('SFX'), SLOTS = list('SLOTS'), DISTANCES = list('DISTANCES');
	var MODES = list('MODES'), PALETTES = list('PALETTES'), HAIR = list('HAIR'), CLOTHES = list('CLOTHES'), HAIRTONES = list('HAIRTONES');
	var BOARDS = VN && VN.BG_OPTS && VN.BG_OPTS.board ? VN.BG_OPTS.board.slice() : [];

	// every directive vn.js knows, with whether it takes words after it (for completion)
	var DIRECTIVES = {
		title: 1, kind: 1, source: 1, cite: 1, arxiv: 1, link: 1, authors: 1, note: 1, status: 1, palette: 1, cast: 1, fact: 1,
		include: 1, verify: 0, file: 1, bg: 1, show: 1, move: 1, hide: 1, chapter: 1, scene: 1, transition: 1, flashback: 1,
		mode: 1, page: 0, fx: 1, cg: 1, pause: 1, tone: 1, music: 1, ambience: 1, sfx: 1, card: 1, chart: 1, code: 1, set: 1,
		add: 1, 'if': 1, thumb: 0, withheld: 1, read: 1, end: 0
	};
	var DIRECTIVE_ORDER = ['bg', 'show', 'hide', 'move', 'chapter', 'scene', 'cg', 'transition', 'tone', 'fx', 'music', 'ambience',
		'sfx', 'mode', 'page', 'pause', 'flashback', 'card', 'chart', 'code', 'set', 'add', 'if', 'end', 'thumb', 'withheld', 'read',
		'title', 'kind', 'source', 'cite', 'arxiv', 'link', 'authors', 'note', 'status', 'palette', 'cast', 'fact', 'include', 'verify', 'file'];
	var CAST_FLAGS = HAIR.concat(CLOTHES, ['glasses', 'hat', 'fem', 'masc', 'player', 'page', 'coauthor']);
	var CAST_KEYS = ['name', 'hue', 'skin', 'hairhue', 'hairtone', 'lattice'];

	var CHIP_RE = /\s*\^(§[\w.\-:]+|p\.\s?[\w.\-]+|¶\d+|para)\s*$/;
	var SPEAKER_RE = /^([A-Za-zÀ-ɏ][\wÀ-ɏ'.\-]*(?:\s+[A-Za-zÀ-ɏ][\wÀ-ɏ'.\-]*){0,2})(\s*)(?:(\()([a-z]+)(\)))?(:)(\s+)([\s\S]*)$/;
	var SINGLE_CAP = /^[A-Z][\wÀ-ɏ'.\-]*$/;
	var WORD_RE = /\s+|[^\s"]*"[^"]*"?[^\s"]*|\S+/g;

	function has(arr, x) { return arr.indexOf(x) >= 0; }

	/* ------------------------------------------------------------------ tokenize */

	function tokenize(line, opts) {
		opts = opts || {};
		var out = [];
		var cast = opts.cast || null;

		function push(type, s) {
			if (!s) return;
			var last = out[out.length - 1];
			if (last && last.type === type) last.text += s;
			else out.push({ type: type, text: s });
		}

		// inline markup inside text: `code`, *em*, {key}; `base` is the type of plain runs ('text' or 'thought')
		function inline(s, base) {
			var i = 0, buf = '';
			function flush() { if (buf) { push(base, buf); buf = ''; } }
			while (i < s.length) {
				var ch = s.charAt(i);
				if (ch === '`') {
					var j = s.indexOf('`', i + 1);
					if (j > i + 1) { flush(); push('code', s.slice(i, j + 1)); i = j + 1; continue; }
				}
				if (ch === '*' && i + 1 < s.length && s.charAt(i + 1) !== ' ' && s.charAt(i + 1) !== '*') {
					var k = s.indexOf('*', i + 1);
					if (k > i + 1 && s.charAt(k - 1) !== ' ') { flush(); emText(s.slice(i, k + 1)); i = k + 1; continue; }
				}
				if (ch === '{') {
					var f = /^\{[A-Za-z_][\w\-]*\}/.exec(s.slice(i));
					if (f) { flush(); push('fact', f[0]); i += f[0].length; continue; }
				}
				buf += ch; i++;
			}
			flush();
		}
		// *emphasis* keeps its {fact} placeholders visible
		function emText(s) {
			var re = /\{[A-Za-z_][\w\-]*\}/g, last = 0, m;
			while ((m = re.exec(s))) { push('em', s.slice(last, m.index)); push('fact', m[0]); last = m.index + m[0].length; }
			push('em', s.slice(last));
		}
		// a run of story text with an optional trailing chip
		function body(s, thoughtOk) {
			var m = CHIP_RE.exec(s), main = m ? s.slice(0, m.index) : s;
			var base = thoughtOk && VN && VN.isThought && VN.isThought(main) ? 'thought' : 'text';
			inline(main, base);
			if (m) {
				var chip = s.slice(m.index), lead = /^\s*/.exec(chip)[0], tail = /\s*$/.exec(chip.slice(lead.length))[0];
				push('ws', lead);
				push('chip', chip.slice(lead.length, chip.length - tail.length));
				push('ws', tail);
			}
		}
		// split on whitespace (keeping it), quotes kept with their word; fn(word, index) pushes the word
		function words(s, fn) {
			var m, n = 0;
			WORD_RE.lastIndex = 0;
			while ((m = WORD_RE.exec(s))) {
				if (!m[0]) { WORD_RE.lastIndex++; continue; }
				if (/^\s/.test(m[0])) push('ws', m[0]);
				else fn(m[0], n++);
			}
		}
		function kv(w, keyOk) {
			var e = w.indexOf('=');
			push(keyOk ? 'arg' : 'unknown', w.slice(0, e));
			push('punct', '=');
			var v = w.slice(e + 1);
			push(/^"/.test(v) ? 'string' : /^-?\d/.test(v) ? 'number' : 'value', v);
		}
		function nameType(w) { return !cast || cast[w.toLowerCase()] ? 'name' : 'unknown'; }
		function inList(w, arr) { return has(arr, w) ? 'arg' : 'unknown'; }
		function face(w) {
			var m = /^\(([a-z]*)\)$/.exec(w);
			if (!m) return false;
			push('punct', '('); push(has(FACES, m[1]) ? 'face' : 'unknown', m[1]); push('punct', ')');
			return true;
		}
		// "a | b | c": fn(segment, index) for each segment, the bars as punctuation
		function bars(s, fn) {
			var parts = s.split('|');
			for (var i = 0; i < parts.length; i++) {
				if (i) push('punct', '|');
				fn(parts[i], i);
			}
		}

		function directive(t) {
			var m = /^@([a-z]+)\b/.exec(t);
			if (!m) { push('unknown', t); return; }
			var d = m[1], rest = t.slice(m[0].length);
			if (!DIRECTIVES.hasOwnProperty(d)) { push('unknown', m[0]); push('text', rest); return; }
			push('directive', m[0]);
			var r;
			switch (d) {
				case 'title': case 'cite': case 'authors': case 'note': case 'withheld':
					push('text', rest); break;
				case 'source':
					if ((r = /^(\s*)(paper|blog)(:)([\s\S]*)$/.exec(rest))) { push('ws', r[1]); push('arg', r[2]); push('punct', r[3]); push('text', r[4]); }
					else push('text', rest);
					break;
				case 'link':
					r = /^(\s*)(\S*)([\s\S]*)$/.exec(rest);
					push('ws', r[1]); push('string', r[2]); push('text', r[3]);
					break;
				case 'arxiv': case 'include': case 'file':
					words(rest, function (w) { push('string', w); }); break;
				case 'verify': case 'page': case 'end': case 'thumb':
					words(rest, function (w) { push('unknown', w); }); break;
				case 'kind': words(rest, function (w, i) { push(i ? 'unknown' : inList(w, ['paper', 'blog']), w); }); break;
				case 'status': words(rest, function (w, i) { push(i ? 'unknown' : inList(w, ['draft', 'embargo', 'published']), w); }); break;
				case 'palette':
					words(rest, function (w, i) { if (/^hue=/.test(w)) kv(w, true); else push(i ? 'unknown' : inList(w, PALETTES), w); });
					break;
				case 'mode': words(rest, function (w, i) { push(i ? 'unknown' : inList(w, MODES), w); }); break;
				case 'tone': words(rest, function (w, i) { push(i ? 'unknown' : inList(w, TONES), w); }); break;
				case 'music': words(rest, function (w, i) { push(i ? 'unknown' : inList(w, MUSIC.concat(['auto', 'off'])), w); }); break;
				case 'ambience': words(rest, function (w, i) { push(i ? 'unknown' : inList(w, AMBIENCE.concat(['auto', 'off'])), w); }); break;
				case 'sfx': words(rest, function (w, i) { push(i ? 'unknown' : inList(w, SFX), w); }); break;
				case 'pause': words(rest, function (w, i) { push(!i && /^\d+$/.test(w) ? 'number' : 'unknown', w); }); break;
				case 'transition':
					words(rest, function (w, i) { push(i === 0 ? inList(w, TRANSITIONS) : i === 1 && /^\d+$/.test(w) ? 'number' : 'unknown', w); });
					break;
				case 'fx':
					words(rest, function (w, i) { push(i === 0 ? inList(w, FX.concat(FX_ONESHOT, ['none'])) : i === 1 ? inList(w, ['on', 'off']) : 'unknown', w); });
					break;
				case 'read':
					words(rest, function (w) { if (/^max=/.test(w)) kv(w, true); else push(w === 'post' ? 'arg' : 'unknown', w); });
					break;
				case 'bg':
					words(rest, function (w, i) {
						if (i === 0) { push(inList(w, BACKGROUNDS), w); return; }
						var b = /^board=(.*)$/.exec(w);
						if (b) { kv(w, true); if (!has(BOARDS, b[1])) out[out.length - 1].type = 'unknown'; return; }
						push(has(BG_MODS, w) || w === 'overcast' ? 'arg' : 'unknown', w);
					});
					break;
				case 'cg':
					bars(rest, function (seg, si) {
						if (si === 0) {
							words(seg, function (w, i) {
								if (i === 0) { push(w === 'off' ? 'arg' : inList(w, CGS), w); return; }
								if (/^text=/.test(w)) { kv(w, true); return; }
								push(has(CG_MODS, w) || w === 'overcast' ? 'arg' : 'unknown', w);
							});
						} else body(seg, false);
					});
					break;
				case 'flashback':
					r = /^(\s*)(\S*)([\s\S]*)$/.exec(rest);
					push('ws', r[1]); push(inList(r[2], ['on', 'off']), r[2]);
					if (r[3]) { var lead = /^\s*/.exec(r[3])[0]; push('ws', lead); body(r[3].slice(lead.length), false); }
					break;
				case 'chapter':
					r = /^(\s*)(\S*)(\s*)([\s\S]*)$/.exec(rest);
					push('ws', r[1]); push('number', r[2]); push('ws', r[3]); body(r[4], false);
					break;
				case 'scene': body(rest, false); break;
				case 'card': bars(rest, function (seg) { body(seg, false); }); break;
				case 'chart':
					bars(rest, function (seg, si) {
						if (si === 0) {
							var h = /^(\s*)(\S*)([\s\S]*)$/.exec(seg);
							push('ws', h[1]); push(inList(h[2], ['bar', 'range']), h[2]); body(h[3], false);
						} else body(seg, false);
					});
					break;
				case 'code':
					bars(rest, function (seg, si) {
						if (si === 0) { var h = /^(\s*)(\S*)([\s\S]*)$/.exec(seg); push('ws', h[1]); push('arg', h[2]); push('ws', h[3]); }
						else push('code', seg);
					});
					break;
				case 'set':
					if ((r = /^(\s*)([A-Za-z_][\w\-]*)(\s*=\s*|\s+)([\s\S]*)$/.exec(rest))) { push('ws', r[1]); push('var', r[2]); push('punct', r[3]); push('value', r[4]); }
					else push('unknown', rest);
					break;
				case 'add':
					if ((r = /^(\s*)([A-Za-z_][\w\-]*)(\s*=?\s*)(-?\d+(?:\.\d+)?)?(\s*)$/.exec(rest))) { push('ws', r[1]); push('var', r[2]); push('punct', r[3]); push('number', r[4] || ''); push('ws', r[5]); }
					else push('unknown', rest);
					break;
				case 'if':
					if ((r = /^(\s*)([\s\S]*?)(\s*)(->)(\s*)(\S+)(\s*)$/.exec(rest))) {
						push('ws', r[1]); cond(r[2]); push('ws', r[3]); push('arrow', r[4]); push('ws', r[5]); push('target', r[6]); push('ws', r[7]);
					} else push('unknown', rest);
					break;
				case 'fact':
					if ((r = /^(\s*)([A-Za-z_][\w\-]*)(\s*)(=)(\s*)([\s\S]*)$/.exec(rest))) {
						push('ws', r[1]); push('fact', r[2]); push('ws', r[3]); push('punct', r[4]); push('ws', r[5]); body(r[6], false);
					} else push('unknown', rest);
					break;
				case 'cast':
					words(rest, function (w, i) {
						if (i === 0) { push('name', w); return; }
						var e = /^([a-z]+)=/.exec(w);
						if (e) { kv(w, has(CAST_KEYS, e[1])); return; }
						push(has(CAST_FLAGS, w) ? 'arg' : 'unknown', w);
					});
					break;
				case 'show':
					words(rest, function (w, i) {
						if (i === 0) { push(nameType(w), w); return; }
						if (face(w)) return;
						push(has(SLOTS, w) || has(DISTANCES, w) ? 'arg' : 'unknown', w);
					});
					break;
				case 'move':
					words(rest, function (w, i) { push(i === 0 ? nameType(w) : i === 1 ? inList(w, SLOTS) : 'unknown', w); });
					break;
				case 'hide':
					words(rest, function (w, i) { push(i === 0 ? (w === 'all' ? 'arg' : nameType(w)) : 'unknown', w); });
					break;
				default:
					push('text', rest);
			}
		}
		// x == v, x != v, x, !x  (also inside an option's "(if ...)")
		function cond(s) {
			var c = /^(!?)(\s*)([A-Za-z_][\w\-]*)(?:(\s*)(==|!=)(\s*)([\s\S]*))?$/.exec(s);
			if (!c) { push('unknown', s); return; }
			push('punct', c[1]); push('ws', c[2]); push('var', c[3]);
			if (c[5]) { push('ws', c[4]); push('punct', c[5]); push('ws', c[6]); push('value', c[7]); }
			else push('ws', c[4] || '');
		}

		function statement(t) {
			var m;
			if (t.charAt(0) === '#') { push(/^#\s*note:/i.test(t) ? 'note' : 'comment', t); return; }
			if ((m = /^(\*)(\s+)([\s\S]*)$/.exec(t))) {
				push('option', m[1]); push('ws', m[2]);
				var rest = m[3], p;
				while ((p = /^(\()(once|if\s+[^)]*)(\))(\s*)/.exec(rest))) {
					push('punct', p[1]);
					if (p[2] === 'once') push('cond', 'once');
					else { push('cond', 'if'); var after = p[2].slice(2), lead = /^\s*/.exec(after)[0]; push('ws', lead); cond(after.slice(lead.length)); }
					push('punct', p[3]); push('ws', p[4]);
					rest = rest.slice(p[0].length);
				}
				var a = /^([\s\S]*?)(\s*)(->)(\s*)(\S+)(\s*)$/.exec(rest);
				if (a) { body(a[1], false); push('ws', a[2]); push('arrow', a[3]); push('ws', a[4]); push('target', a[5]); push('ws', a[6]); }
				else body(rest, false);
				return;
			}
			if ((m = /^(==)(\s*)(\S+)(\s*)$/.exec(t))) { push('label-mark', m[1]); push('ws', m[2]); push('label', m[3]); push('ws', m[4]); return; }
			if ((m = /^(->)(\s*)(\S+)(\s*)$/.exec(t))) { push('arrow', m[1]); push('ws', m[2]); push('target', m[3]); push('ws', m[4]); return; }
			if (t.charAt(0) === '@') { directive(t); return; }
			m = SPEAKER_RE.exec(t);
			if (m && !/^https?$/i.test(m[1])) {
				var declared = cast ? !!cast[m[1].toLowerCase()] : SINGLE_CAP.test(m[1]);
				if (declared) {
					push('speaker', m[1]); push('ws', m[2]);
					if (m[3]) { push('punct', m[3]); push(has(FACES, m[4]) ? 'face' : 'unknown', m[4]); push('punct', m[5]); }
					push('punct', m[6]); push('ws', m[7]);
					body(m[8], true);
					return;
				}
				if (cast && SINGLE_CAP.test(m[1])) {
					// vn.js reads it as narration and warns: the name is not in @cast
					push('unknown', m[1]);
					body(t.slice(m[1].length), true);
					return;
				}
			}
			body(t, true);
		}

		var s = String(line == null ? '' : line);
		if (!s.trim()) { push('ws', s); return out; }
		var lead = /^[ \t]*/.exec(s)[0];
		if (lead && opts.cont) {
			// a continuation: joined to the line above, so it is text whatever it starts with
			push('ws', lead);
			var rest = s.slice(lead.length), tail = /\s*$/.exec(rest)[0];
			body(rest.slice(0, rest.length - tail.length), false);
			push('ws', tail);
			return out;
		}
		var lws = /^\s*/.exec(s)[0];
		push('ws', lws);
		var t = s.slice(lws.length), trail = /\s*$/.exec(t)[0];
		statement(t.slice(0, t.length - trail.length));
		push('ws', trail);
		return out;
	}

	/* ------------------------------------------------------------------ html */

	var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
	function esc(s) { return s.replace(/[&<>"]/g, function (c) { return ESC[c]; }); }
	function toHTML(tokens) {
		var h = '';
		for (var i = 0; i < tokens.length; i++) {
			var k = tokens[i];
			h += k.type === 'text' || k.type === 'ws' ? esc(k.text) : '<span class="t-' + k.type + '">' + esc(k.text) + '</span>';
		}
		return h;
	}

	/* ------------------------------------------------------------------ cast */

	function castOf(text) {
		var lines = Array.isArray(text) ? text : String(text == null ? '' : text).split(/\r\n|\r|\n/);
		var out = {};
		for (var i = 0; i < lines.length; i++) {
			var m = /^\s*@cast\s+(?:([^\s"]*)"([^"]*)"|(\S+))/.exec(lines[i]);
			// an indented line under a line that is not blank is a continuation, not a statement
			if (m && (!/^[ \t]/.test(lines[i]) || i === 0 || !lines[i - 1].trim())) {
				var id = m[3] != null ? m[3] : m[1] + m[2];
				if (id) out[id.toLowerCase()] = id;
			}
		}
		return out;
	}

	/* ------------------------------------------------------------------ completion */

	function argChoices(d, idx, prevWords, data) {
		var names = data.cast || [];
		switch (d) {
			case 'bg': return idx === 0 ? BACKGROUNDS : BG_MODS.concat(['overcast'], BOARDS.map(function (b) { return 'board=' + b; }));
			case 'cg': return idx === 0 ? CGS.concat(['off']) : CG_MODS.filter(function (m) { return m !== 'noon'; }).concat(['overcast', 'text=']);
			case 'tone': return idx === 0 ? TONES : [];
			case 'fx': return idx === 0 ? FX.concat(FX_ONESHOT, ['none']) : idx === 1 && has(FX, prevWords[0]) ? ['on', 'off'] : [];
			case 'transition': return idx === 0 ? TRANSITIONS : [];
			case 'music': return idx === 0 ? MUSIC.concat(['auto', 'off']) : [];
			case 'ambience': return idx === 0 ? AMBIENCE.concat(['auto', 'off']) : [];
			case 'sfx': return idx === 0 ? SFX : [];
			case 'mode': return idx === 0 ? MODES : [];
			case 'flashback': return idx === 0 ? ['on', 'off'] : [];
			case 'palette': return idx === 0 ? PALETTES.concat(['hue=']) : [];
			case 'status': return idx === 0 ? ['draft', 'embargo', 'published'] : [];
			case 'kind': return idx === 0 ? ['paper', 'blog'] : [];
			case 'chart': return idx === 0 ? ['bar', 'range'] : [];
			case 'read': return idx === 0 ? ['post'] : ['max='];
			case 'hide': return idx === 0 ? names.concat(['all']) : [];
			case 'move': return idx === 0 ? names : idx === 1 ? SLOTS : [];
			case 'show': return idx === 0 ? names : SLOTS.concat(FACES.map(function (f) { return '(' + f + ')'; }), DISTANCES);
			case 'cast': return idx === 0 ? [] : CAST_FLAGS.concat(CAST_KEYS.map(function (k) { return k + '='; }));
		}
		return [];
	}

	function pick(choices, partial, kind, exactOk) {
		var p = partial.toLowerCase(), seen = {}, items = [];
		for (var i = 0; i < choices.length; i++) {
			var c = choices[i];
			if (c == null || seen[c]) continue;
			seen[c] = 1;
			if (c.toLowerCase().indexOf(p) === 0 && (exactOk || c !== partial)) items.push({ label: c, insert: c, kind: kind });
		}
		return items;
	}
	function result(from, partial, items) { return items.length ? { from: from, partial: partial, items: items } : null; }

	// `before` is the line up to the caret; data = {cast: [names as written], facts: [keys], labels: [names]}
	function suggest(before, data, force) {
		data = data || {};
		var s = String(before == null ? '' : before), m;
		var cast = data.cast || [];
		// {fact} (an unclosed brace before the caret)
		if ((m = /\{([A-Za-z_][\w\-]*)?$/.exec(s))) {
			var part = m[1] || '';
			var items = pick(data.facts || [], part, 'fact', true).concat(pick(cast, part, 'name', true));
			return result(s.length - part.length, part, items);
		}
		// a comment: nothing
		if (/^\s*#/.test(s)) return null;
		// labels after "->" in a jump, an option or an @if
		if ((m = /^\s*(?:\*|->|@if\b).*?->\s*([\w\-]*)$/.exec(s)) || (m = /^\s*->\s*([\w\-]*)$/.exec(s))) {
			return result(s.length - m[1].length, m[1], pick((data.labels || []).concat(['end']), m[1], 'label', false));
		}
		// directives after "@" at the start of a statement
		if ((m = /^\s*@([a-z]*)$/.exec(s))) {
			var ds = pick(DIRECTIVE_ORDER, m[1], 'directive', false);
			ds.forEach(function (it) { if (DIRECTIVES[it.label]) it.insert = it.label + ' '; });
			return result(s.length - m[1].length, m[1], ds);
		}
		// directive arguments
		if ((m = /^\s*@([a-z]+)\s+([\s\S]*)$/.exec(s))) {
			var d = m[1], rest = m[2];
			if ((d === 'cg' || d === 'card' || d === 'chart' || d === 'code') && rest.indexOf('|') >= 0) return null;
			var ws = rest.split(/\s+/), partial = /\s$/.test(rest) ? '' : ws.pop();
			ws = ws.filter(Boolean);
			if (/"/.test(partial)) return null;
			return result(s.length - partial.length, partial, pick(argChoices(d, ws.length, ws, data), partial, 'arg', false));
		}
		// a face after "Name (" at the start of a line
		if ((m = /^\s*([A-Za-zÀ-ɏ][\wÀ-ɏ'.\-]*(?:\s+[A-Za-zÀ-ɏ][\wÀ-ɏ'.\-]*){0,2})\s*\(([a-z]*)$/.exec(s))) {
			var known = cast.some(function (c) { return c.toLowerCase() === m[1].toLowerCase(); });
			if (!known) return null;
			var fs = pick(FACES, m[2], 'face', false);
			fs.forEach(function (it) { it.insert = it.label + '): '; });
			return result(s.length - m[2].length, m[2], fs);
		}
		// a cast name at the very start of a line
		if ((m = /^([A-Za-zÀ-ɏ][\wÀ-ɏ'.\-]*)$/.exec(s)) || (force && (m = /^()$/.exec(s)))) {
			return result(0, m[1], pick(cast, m[1], 'name', false));
		}
		return null;
	}

	return {
		tokenize: tokenize,
		toHTML: toHTML,
		castOf: castOf,
		suggest: suggest,
		DIRECTIVES: DIRECTIVE_ORDER.slice(),
		TYPES: ['ws', 'text', 'thought', 'em', 'code', 'fact', 'chip', 'comment', 'note', 'directive', 'arg', 'value', 'string', 'number',
			'name', 'speaker', 'face', 'punct', 'option', 'cond', 'arrow', 'target', 'label-mark', 'label', 'var', 'unknown'],
		hasEngine: !!VN
	};
});
