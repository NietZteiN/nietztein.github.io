// Desk: blog post files, exactly as the site reads them.
//
// Pure logic, no DOM: front matter to and from text, slugs, file names, word
// counts, the private-image links of a draft, and the checks that run before
// anything is published. Loaded by desk/views/write.js in the browser
// (window.DeskPostfile) and by desk/test/test-postfile.mjs in Node.
//
// The site has two readers of a post file and they agree:
//   assets/js/blog.js           parsePost()        (the post page)
//   scripts/build-blog-index.mjs parseFrontMatter() (blog/index.json, run by the Action)
// Both take a block that starts the file:
//   ---
//   key: value          one line each; the value is trimmed and ONE leading and
//   tags: [a, b]        ONE trailing quote (" or ') are dropped; a value that
//   ---                 starts with [ and ends with ] is a list split on commas
// Anything else is the body. The slug and (as a fallback) the date come from
// the file name: YYYY-MM-DD-slug.md. The index uses fm.title || slug,
// fm.date || the file's date, fm.summary || '', and tags as a list.
//
// build() writes values so that those readers give back exactly what was
// meant: a value that starts or ends with a quote, or looks like a list, is
// wrapped in quotes (the readers drop one quote at each end and keep the rest).

(function (root, factory) {
	'use strict';
	var api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else root.DeskPostfile = api;
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	var FM_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/;
	var POST_KEYS = ['title', 'date', 'summary', 'tags'];
	// Keys a draft in the private repository carries besides the post's own.
	var DRAFT_KEYS = ['slug', 'published', 'publishedSha'];
	var SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
	var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
	var POSTS_DIR = 'blog/posts/';
	var SITE_IMG_DIR = 'assets/img/blog/';
	var DRAFT_IMG_DIR = 'drafts/images/';
	var MAX_SLUG = 60;

	// ---- reading: the site's own rules --------------------------------------------

	// -> { fm, body }. The same code as parsePost() in assets/js/blog.js.
	function parse(text) {
		var fm = {};
		var body = String(text == null ? '' : text);
		var m = FM_RE.exec(body);
		if (m) {
			body = body.slice(m[0].length);
			m[1].split(/\r?\n/).forEach(function (line) {
				var idx = line.indexOf(':');
				if (idx === -1) return;
				var key = line.slice(0, idx).trim();
				var val = line.slice(idx + 1).trim();
				if (val.charAt(0) === '[' && val.charAt(val.length - 1) === ']') {
					fm[key] = val
						.slice(1, -1)
						.split(',')
						.map(function (s) {
							return s.trim().replace(/^["']|["']$/g, '');
						})
						.filter(Boolean);
				} else {
					fm[key] = val.replace(/^["']|["']$/g, '');
				}
			});
		}
		return { fm: fm, body: body, hasFrontMatter: !!m };
	}

	// "2026-07-14-hello-world.md" -> "hello-world" (build-blog-index.mjs)
	function slugFromFile(file) {
		return String(file || '')
			.replace(/^.*\//, '')
			.replace(/\.md$/i, '')
			.replace(/^\d{4}-\d{2}-\d{2}-/, '');
	}

	function dateFromFile(file) {
		return (String(file || '').replace(/^.*\//, '').match(/^(\d{4}-\d{2}-\d{2})-/) || [])[1] || '';
	}

	// The entry scripts/build-blog-index.mjs would write for this file.
	function indexEntry(file, text) {
		var name = String(file).replace(/^.*\//, '');
		var fm = parse(text).fm;
		var slug = slugFromFile(name);
		return {
			slug: slug,
			title: fm.title || slug,
			date: fm.date || dateFromFile(name) || '',
			summary: fm.summary || '',
			tags: Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : [],
			file: name,
		};
	}

	// ---- writing ----------------------------------------------------------------

	function cc(n) {
		return String.fromCharCode(n);
	}
	// Built from code points so that no invisible character sits in this file.
	var COMBINING = new RegExp('[' + cc(0x300) + '-' + cc(0x36f) + ']', 'g');
	var APOSTROPHES = new RegExp("['`" + cc(0x2018) + cc(0x2019) + ']', 'g');
	var LATINISH = new RegExp('[A-Za-z0-9' + cc(0xc0) + '-' + cc(0x24f) + cc(0x1e00) + '-' + cc(0x1eff) + ']');
	var LINE_BREAKS =new RegExp('\\r\\n?|\\n|' + String.fromCharCode(0x2028) + '|' + String.fromCharCode(0x2029), 'g');

	function oneLine(v) {
		return String(v == null ? '' : v)
			.replace(LINE_BREAKS, ' ')
			.trim();
	}

	// A scalar written so that parse() gives it back unchanged.
	function formatValue(v) {
		var s = oneLine(v);
		if (!s) return '';
		var first = s.charAt(0);
		var last = s.charAt(s.length - 1);
		var quoteAtEnd = first === '"' || first === "'" || last === '"' || last === "'";
		var looksLikeList = first === '[' && last === ']';
		if (quoteAtEnd || looksLikeList) return '"' + s + '"';
		return s;
	}

	function formatList(list) {
		return (
			'[' +
			(list || [])
				.map(function (t) {
					return oneLine(t).replace(/[\[\],]/g, ' ').replace(/^["']+|["']+$/g, '').replace(/\s+/g, ' ').trim();
				})
				.filter(Boolean)
				.join(', ') +
			']'
		);
	}

	// build(fm, body, { keys }) -> the file's text. Known keys come first in the
	// order the blog's README shows (title, date, summary, tags), then the draft's
	// own keys, then anything else that was in fm. Empty values are left out,
	// except tags, which is always written (as [] when empty) for post keys.
	function build(fm, body, opts) {
		fm = fm || {};
		opts = opts || {};
		var order = opts.keys || POST_KEYS.concat(DRAFT_KEYS).concat(
			Object.keys(fm).filter(function (k) {
				return POST_KEYS.indexOf(k) === -1 && DRAFT_KEYS.indexOf(k) === -1;
			})
		);
		var lines = [];
		order.forEach(function (key) {
			if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) return;
			var v = fm[key];
			if (key === 'tags') {
				lines.push('tags: ' + formatList(Array.isArray(v) ? v : v ? [v] : []));
				return;
			}
			if (v === undefined || v === null) return;
			if (Array.isArray(v)) {
				lines.push(key + ': ' + formatList(v));
				return;
			}
			var s = formatValue(v);
			if (s === '') return;
			lines.push(key + ': ' + s);
		});
		return '---\n' + lines.join('\n') + '\n---\n\n' + normalizeBody(body);
	}

	// Line ends as \n, no byte-order mark, no blank lines at the top, one \n at the end.
	function normalizeBody(body) {
		var text = String(body == null ? '' : body).replace(/\r\n?/g, '\n');
		if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
		text = text.replace(/^(?:[ \t]*\n)+/, '');
		if (text && !/\n$/.test(text)) text += '\n';
		return text;
	}

	// The public file: only the keys the site reads.
	function buildPost(fields, body) {
		return build({ title: fields.title, date: fields.date, summary: fields.summary, tags: fields.tags || [] }, body, { keys: POST_KEYS });
	}

	// A draft in the private repository: the post's keys plus slug and published.
	function buildDraft(fields, body) {
		return build(
			{
				title: fields.title,
				date: fields.date,
				summary: fields.summary,
				tags: fields.tags || [],
				slug: fields.slug,
				published: fields.published,
				publishedSha: fields.publishedSha,
			},
			body,
			{ keys: POST_KEYS.concat(DRAFT_KEYS) }
		);
	}

	// A draft file (or any .md) -> the fields the editor works with.
	function readDraft(text, fileName) {
		var p = parse(text);
		var fm = p.fm;
		var tags = Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : [];
		var slug = typeof fm.slug === 'string' ? fm.slug : '';
		if (!slug && fileName && /^\d{4}-\d{2}-\d{2}-/.test(String(fileName).replace(/^.*\//, ''))) slug = slugFromFile(fileName);
		return {
			title: typeof fm.title === 'string' ? fm.title : '',
			date: typeof fm.date === 'string' ? fm.date : '',
			summary: typeof fm.summary === 'string' ? fm.summary : '',
			tags: cleanTags(tags),
			slug: slug,
			published: typeof fm.published === 'string' ? fm.published : '',
			publishedSha: typeof fm.publishedSha === 'string' ? fm.publishedSha : '',
			body: p.fm && p.hasFrontMatter ? p.body.replace(/^(?:[ \t]*\r?\n)+/, '') : p.body,
		};
	}

	// ---- slugs, dates, file names --------------------------------------------------

	var FOLD = { 'ß': 'ss', 'æ': 'ae', 'Æ': 'ae', 'œ': 'oe', 'Œ': 'oe', 'ø': 'o', 'Ø': 'o', 'đ': 'd', 'Đ': 'd', 'ð': 'd', 'Ð': 'd', 'þ': 'th', 'Þ': 'th', 'ł': 'l', 'Ł': 'l', 'ı': 'i' };

	// "Benchmarks We Actually Need" -> "benchmarks-we-actually-need".
	// ASCII words only; '' when the title has no ASCII letter or digit.
	function slugify(title) {
		var s = String(title == null ? '' : title);
		s = s.replace(/[ßæÆœŒøØđĐðÐþÞłŁı]/g, function (c) {
			return FOLD[c] || c;
		});
		if (s.normalize) s = s.normalize('NFKD');
		s = s
			.replace(COMBINING, '')
			.toLowerCase()
			.replace(APOSTROPHES, '')
			.replace(/&/g, ' and ')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');
		if (s.length > MAX_SLUG) {
			var cut = s.slice(0, MAX_SLUG + 1);
			var at = cut.lastIndexOf('-');
			s = (at > 20 ? cut.slice(0, at) : s.slice(0, MAX_SLUG)).replace(/-+$/, '');
		}
		return s;
	}

	// The slug to offer for a title: { slug, fromTitle, needsName }.
	// A title with no ASCII words keeps a date-based slug, and the owner is asked
	// to name the address himself.
	function suggestSlug(title, date) {
		var s = slugify(title);
		if (s) return { slug: s, fromTitle: true, needsName: false };
		return { slug: dateSlug(date), fromTitle: false, needsName: true };
	}

	function dateSlug(date) {
		var d = isValidDate(date) ? date : '';
		return 'post-' + (d ? d.replace(/-/g, '') : 'untitled');
	}

	function isDateSlug(slug) {
		return /^post-(\d{8}|untitled)(-\d+)?$/.test(String(slug || ''));
	}

	function isValidSlug(slug) {
		return typeof slug === 'string' && slug.length <= 100 && SLUG_RE.test(slug);
	}

	// A real calendar day written YYYY-MM-DD.
	function isValidDate(s) {
		var m = DATE_RE.exec(String(s == null ? '' : s));
		if (!m) return false;
		var y = +m[1];
		var mo = +m[2];
		var d = +m[3];
		if (mo < 1 || mo > 12 || d < 1) return false;
		var days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
		return d <= days[mo - 1] && y >= 1900 && y <= 2999;
	}

	function fileName(date, slug) {
		return date + '-' + slug + '.md';
	}

	function postPath(date, slug) {
		return POSTS_DIR + fileName(date, slug);
	}

	function isPostPath(p) {
		return /^blog\/posts\/[^/]+\.md$/i.test(String(p || ''));
	}

	// ---- tags -------------------------------------------------------------------

	// Lowercase with dashes, as the existing posts have them.
	function normalizeTag(t) {
		var s = String(t == null ? '' : t);
		if (s.normalize) s = s.normalize('NFKC');
		return s
			.trim()
			.replace(/^#+/, '')
			.toLowerCase()
			.replace(/[\[\],"'\s_]+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-+|-+$/g, '');
	}

	function cleanTags(list) {
		var seen = {};
		var out = [];
		(Array.isArray(list) ? list : String(list || '').split(',')).forEach(function (t) {
			var n = normalizeTag(t);
			if (!n || seen[n]) return;
			seen[n] = true;
			out.push(n);
		});
		return out;
	}

	// ---- words ------------------------------------------------------------------

	function range(a, b) {
		return String.fromCharCode(a) + '-' + String.fromCharCode(b);
	}
	// Han, kana, CJK punctuation-free letters: each character counts as a word.
	var CJK_CLASS = '[' + range(0x3040, 0x30ff) + range(0x3400, 0x4dbf) + range(0x4e00, 0x9fff) + range(0xf900, 0xfaff) + range(0xff66, 0xff9f) + ']';
	var CJK_RE = new RegExp(CJK_CLASS, 'g');
	var WORDISH = (function () {
		try {
			return new RegExp('[\\p{L}\\p{N}]', 'u');
		} catch (e) {
			return LATINISH;
		}
	})();

	// -> { words, chars }: words in the text, where each Japanese or Chinese
	// character counts as one; fenced code is left out of words.
	function wordCount(text) {
		var s = String(text == null ? '' : text);
		var chars = s.replace(/\s/g, '').length;
		var prose = s.replace(/^(```|~~~)[\s\S]*?^\1[ \t]*$/gm, ' ');
		var words = 0;
		prose.split(/\s+/).forEach(function (tok) {
			if (!tok) return;
			var cjk = tok.match(CJK_RE);
			if (cjk) {
				words += cjk.length;
				tok = tok.replace(CJK_RE, ' ');
				tok.split(/\s+/).forEach(function (rest) {
					if (rest && WORDISH.test(rest)) words++;
				});
				return;
			}
			if (WORDISH.test(tok)) words++;
		});
		return { words: words, chars: chars };
	}

	// ---- images -----------------------------------------------------------------

	// Every private image path a text points at (drafts/images/...), in order, once each.
	var PRIVATE_IMG_RE = /(?:\.\/|\/)?(drafts\/images\/[^\s)"'<>\]]+)/g;

	function privateImages(text) {
		var out = [];
		var seen = {};
		String(text || '').replace(PRIVATE_IMG_RE, function (all, p) {
			var clean = cleanImagePath(p);
			if (clean && !seen[clean]) {
				seen[clean] = true;
				out.push(clean);
			}
			return all;
		});
		return out;
	}

	function cleanImagePath(p) {
		var s = String(p || '');
		try {
			s = decodeURI(s);
		} catch (e) {
			/* leave as is */
		}
		return s.replace(/[.,;:!?]+$/, '');
	}

	// Site images of a published post (assets/img/blog/...), once each.
	function siteImages(text) {
		var out = [];
		var seen = {};
		String(text || '').replace(/(?:\.\/|\/)?(assets\/img\/blog\/[^\s)"'<>\]]+)/g, function (all, p) {
			var clean = cleanImagePath(p);
			if (!seen[clean]) {
				seen[clean] = true;
				out.push(clean);
			}
			return all;
		});
		return out;
	}

	// A file name that is safe in a URL and on GitHub Pages (case-exact).
	function imageName(original, mime, taken) {
		var ext = extFor(original, mime);
		var base = String(original || '')
			.replace(/^.*[\\/]/, '')
			.replace(/\.[A-Za-z0-9]+$/, '');
		if (base.normalize) base = base.normalize('NFKD');
		base = base
			.replace(COMBINING, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40)
			.replace(/-+$/, '');
		if (!base || base === 'image') base = 'image';
		var name = base + '.' + ext;
		var n = 2;
		taken = taken || {};
		while (taken[name]) name = base + '-' + n++ + '.' + ext;
		return name;
	}

	var EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif' };
	var MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' };

	function extFor(name, mime) {
		var m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
		var e = m ? m[1].toLowerCase() : '';
		if (e === 'jpeg') e = 'jpg';
		if (MIME_BY_EXT[e]) return e;
		return EXT_BY_MIME[String(mime || '').toLowerCase()] || 'png';
	}

	function mimeFor(name) {
		var m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
		return (m && MIME_BY_EXT[m[1].toLowerCase()]) || 'application/octet-stream';
	}

	function isImageType(mime) {
		return !!EXT_BY_MIME[String(mime || '').toLowerCase()];
	}

	// Where each private image goes on the site: drafts/images/x/a.png ->
	// assets/img/blog/<slug>/a.png. Two images with the same name get -2, -3.
	//   siteHas(path) -> blob sha on the site or null: a name already on the site
	//   is reused only when sameAs(privatePath, siteSha) says it is the same picture.
	function planImages(privatePaths, slug, siteHas, sameAs) {
		var taken = {};
		var plan = [];
		privatePaths.forEach(function (p) {
			var name = p.replace(/^.*\//, '');
			var dot = name.lastIndexOf('.');
			var base = dot > 0 ? name.slice(0, dot) : name;
			var ext = dot > 0 ? name.slice(dot) : '';
			var target;
			var n = 1;
			for (;;) {
				var candidate = SITE_IMG_DIR + slug + '/' + (n === 1 ? name : base + '-' + n + ext);
				var onSite = siteHas ? siteHas(candidate) : null;
				if (!taken[candidate] && (!onSite || (sameAs && sameAs(p, onSite)))) {
					target = candidate;
					plan.push({ from: p, to: candidate, existing: onSite || null });
					break;
				}
				n++;
			}
			taken[target] = true;
		});
		return plan;
	}

	// Replace each private path with its site path. -> text
	function rewriteImages(text, plan) {
		var map = {};
		plan.forEach(function (x) {
			map[x.from] = x.to;
		});
		return String(text || '').replace(PRIVATE_IMG_RE, function (all, p) {
			var clean = cleanImagePath(p);
			var tail = p.slice(clean.length);
			var to = map[clean] || map[p];
			return to ? to + tail : all;
		});
	}

	// The reverse, for a post taken back into the drafts: site path -> private path.
	function rewriteToPrivate(text, map) {
		return String(text || '').replace(/(?:\.\/|\/)?(assets\/img\/blog\/[^\s)"'<>\]]+)/g, function (all, p) {
			var clean = cleanImagePath(p);
			var tail = p.slice(clean.length);
			return map[clean] ? map[clean] + tail : all;
		});
	}

	// ---- before publishing --------------------------------------------------------

	// checkPublish({ title, date, summary, tags, slug, body, existing, ownFile, today, imagePlan, missingImages })
	//   existing: { slug: fileName } of every post on the site now (blog/posts/)
	//   ownFile:  the file name this post has on the site already (an update), or ''
	//   body:     the body as it will be published (private images rewritten)
	// -> { ok, errors: [{ code, text }], warnings: [{ code, text }], file, path, text, entry }
	function checkPublish(o) {
		var errors = [];
		var warnings = [];
		function err(code, text) {
			errors.push({ code: code, text: text });
		}
		function warn(code, text) {
			warnings.push({ code: code, text: text });
		}
		var title = oneLine(o.title);
		var date = oneLine(o.date);
		var summary = oneLine(o.summary);
		var tags = cleanTags(o.tags || []);
		var slug = String(o.slug || '').trim();
		var body = String(o.body == null ? '' : o.body).replace(/\r\n?/g, '\n');
		var existing = o.existing || {};
		var ownFile = o.ownFile || '';

		if (!title) err('title', 'The title is empty. The post list and the post page show it.');
		if (!date) err('date', 'The date is empty. It goes in the file name and above the post.');
		else if (!isValidDate(date)) err('date', 'The date "' + date + '" is not a real day written YYYY-MM-DD.');
		if (!summary) err('summary', 'The summary is empty. It is the one line shown under the title in the post list.');
		else if (summary.length > 220) warn('summary-long', 'The summary is ' + summary.length + ' characters long. The blog README asks for one line.');
		if (String(o.summary || '').trim() !== summary || String(o.title || '').trim() !== title) warn('one-line', 'Line breaks in the title or summary become spaces: front matter is one line per field.');
		if (!tags.length) warn('tags', 'No tags. The post will be listed without any.');

		if (!slug) err('slug', 'The address (slug) is empty.');
		else if (!isValidSlug(slug)) err('slug', 'The address "' + slug + '" may only have lowercase letters a to z, digits and single dashes between them.');
		else {
			var file = ownFile && slugFromFile(ownFile) === slug ? ownFile : fileName(date || 'YYYY-MM-DD', slug);
			Object.keys(existing).forEach(function (s) {
				if (s === slug && existing[s] !== ownFile) err('slug-taken', 'Another post already uses the address "' + slug + '" (' + existing[s] + '). Choose another slug.');
			});
			if (isDateSlug(slug)) warn('slug-date', 'The address is "' + slug + '", made from the date because the title has no ASCII words. Give it a name of your own (lowercase a to z, digits, dashes) before publishing if you can.');
		}

		if (!body.replace(/\s/g, '')) err('body', 'The post has no text.');
		var left = privateImages(body);
		if (left.length) err('private-image', 'These links still point at private images, which readers cannot see: ' + left.join(', ') + '.');
		(o.missingImages || []).forEach(function (p) {
			err('missing-image', 'The image ' + p + ' is not in the private repository or on this device.');
		});
		if (/\]\(\s*<?blob:|src\s*=\s*["']?blob:/i.test(body)) err('blob-link', 'A link points at a blob: address, which exists only in this browser.');
		if (/\]\(\s*<?data:|src\s*=\s*["']?data:/i.test(body)) warn('data-link', 'An image is embedded as a data: address. It works, but it makes the post file large.');
		if (/!\[[^\]]*\]\(\s*<?https?:/i.test(body)) warn('remote-image', 'An image is loaded from another site. It shows on the live post but not in the Desk preview.');

		var finalFile = '';
		var finalPath = '';
		var text = '';
		var entry = null;
		if (!errors.length) {
			finalFile = ownFile && slugFromFile(ownFile) === slug ? ownFile : fileName(date, slug);
			finalPath = POSTS_DIR + finalFile;
			text = buildPost({ title: title, date: date, summary: summary, tags: tags }, body);
			// Read it back exactly as the site will.
			entry = indexEntry(finalFile, text);
			var back = parse(text);
			var wantBody = normalizeBody(body).replace(/^\s+/, '');
			var same =
				back.hasFrontMatter &&
				entry.slug === slug &&
				entry.title === title &&
				entry.date === date &&
				entry.summary === summary &&
				JSON.stringify(entry.tags) === JSON.stringify(tags) &&
				back.body === wantBody;
			if (!same) err('parse', 'The file would not read back the same with the site\'s front-matter rules. Simplify the title, summary or tags.');
			if (/^[ \t]+\S/.test(normalizeBody(body))) warn('leading-space', 'The text starts with spaces. The site drops them, so an indented first line will not show as code.');
			if (ownFile && finalFile !== ownFile) warn('rename', 'The address changes from "' + slugFromFile(ownFile) + '" to "' + slug + '".');
			if (ownFile && dateFromFile(ownFile) !== date) warn('date-differs', 'The file keeps its name ' + ownFile + '; the date shown on the site becomes ' + date + '.');
			if (o.today && date > o.today) warn('future', 'The date ' + date + ' is in the future. The post is published now all the same.');
		}

		return { ok: !errors.length, errors: errors, warnings: warnings, file: finalFile, path: finalPath, text: text, entry: entry };
	}

	return {
		POSTS_DIR: POSTS_DIR,
		SITE_IMG_DIR: SITE_IMG_DIR,
		DRAFT_IMG_DIR: DRAFT_IMG_DIR,
		POST_KEYS: POST_KEYS,
		parse: parse,
		indexEntry: indexEntry,
		slugFromFile: slugFromFile,
		dateFromFile: dateFromFile,
		formatValue: formatValue,
		build: build,
		buildPost: buildPost,
		buildDraft: buildDraft,
		readDraft: readDraft,
		slugify: slugify,
		suggestSlug: suggestSlug,
		dateSlug: dateSlug,
		isDateSlug: isDateSlug,
		isValidSlug: isValidSlug,
		isValidDate: isValidDate,
		fileName: fileName,
		postPath: postPath,
		isPostPath: isPostPath,
		normalizeTag: normalizeTag,
		cleanTags: cleanTags,
		wordCount: wordCount,
		privateImages: privateImages,
		siteImages: siteImages,
		imageName: imageName,
		mimeFor: mimeFor,
		isImageType: isImageType,
		planImages: planImages,
		rewriteImages: rewriteImages,
		rewriteToPrivate: rewriteToPrivate,
		checkPublish: checkPublish,
	};
});
