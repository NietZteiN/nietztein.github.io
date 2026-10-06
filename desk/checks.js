// Desk checks: the parts of the To-dos and Health views that need no browser.
//
//   DeskChecks.extractLinks(markdown)        every link and image in a post's Markdown
//   DeskChecks.classifyLink(url)             external, a hash route of the site, or a file of the site
//   DeskChecks.postLinks(file, md, known)    the internal links of one post, with what is wrong with each
//   DeskChecks.comparePostsIndex(index, files)   blog/index.json against the files in blog/posts
//   DeskChecks.toyTargets / postTargets / storyTargets   what the live checks must ask for
//   DeskChecks.comparePublications(json, html)   publications.json against the Publications section
//   DeskChecks.rollUp(results) / summaryText(roll)       one status for many checks
//   DeskChecks.notYetLive / groupRuns / runState / lastGoodBuild   deploys
//   DeskChecks.todos.*                       the to-do list: parse, serialise, import, merge, reorder
//   DeskChecks.stories.board(...)            publications and posts joined with the Paper Theatre stories
//   DeskChecks.drafts.*                      titles and "oldest untouched"
//
// Nothing here touches the DOM, the network or the clock (functions that need
// "now" take it as an argument), so desk/test/test-checks.mjs can run all of
// it in Node against this repository's real files.
//
// Every string that comes from a file is treated as untrusted text: paths are
// checked with safeSitePath before anything asks for them, and nothing here
// builds HTML.
//
// Loads in the browser (window.DeskChecks) and in Node (module.exports).

(function (root, factory) {
	'use strict';
	var api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else root.DeskChecks = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	// ---- small things ---------------------------------------------------------

	function text(v) {
		return v === undefined || v === null ? '' : String(v);
	}

	function isObject(v) {
		return !!v && typeof v === 'object' && !Array.isArray(v);
	}

	function hasControl(s) {
		for (var i = 0; i < s.length; i++) {
			var c = s.charCodeAt(i);
			if (c < 32 || c === 127) return true;
		}
		return false;
	}

	function decode(s) {
		try {
			return decodeURIComponent(s);
		} catch (e) {
			return s;
		}
	}

	function plural(n, one, many) {
		return n + ' ' + (n === 1 ? one : many || one + 's');
	}

	// The routes of the site's shell (assets/js/main.js, ROUTES). The test
	// compares this list with that file.
	var SITE_ROUTES = ['about', 'education', 'publications', 'press', 'blog', 'post', 'teaching', 'presentations', 'experience', 'bookshelf', 'misc'];
	var SITE_HOSTS = ['nietztein.github.io'];

	// A path inside the site, as found in one of the site's JSON files
	// ('misc/01-x/', 'assets/img/a.jpg?v=2'). Anything that could lead away from
	// the site (a scheme, '//host', '..', a backslash, a control character)
	// gives null, so the checker only ever asks its own origin.
	function safeSitePath(value) {
		var p = text(value).trim();
		if (!p || hasControl(p) || p.indexOf('\\') !== -1) return null;
		if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(p)) return null;
		if (p.slice(0, 2) === '//') return null;
		var hash = p.indexOf('#');
		if (hash !== -1) p = p.slice(0, hash);
		var q = p.indexOf('?');
		var query = q === -1 ? '' : p.slice(q);
		var path = q === -1 ? p : p.slice(0, q);
		var out = [];
		var parts = path.split('/');
		for (var i = 0; i < parts.length; i++) {
			if (parts[i] === '' || parts[i] === '.') continue;
			if (parts[i] === '..') return null;
			out.push(parts[i]);
		}
		if (!out.length) return null;
		return out.join('/') + (/\/$/.test(path) ? '/' : '') + query;
	}

	// A file name directly inside a folder: 'obfuscation.vn', never 'a/b' or '..'.
	function safeFileName(value) {
		var n = text(value).trim();
		if (!n || n === '.' || n === '..' || hasControl(n) || /[\\/?#]/.test(n)) return null;
		return n;
	}

	// ---- links in Markdown ----------------------------------------------------

	function blank(chars, from, to) {
		for (var i = Math.max(0, from); i < to && i < chars.length; i++) {
			if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
		}
	}

	function escapedAt(s, i) {
		var n = 0;
		for (var j = i - 1; j >= 0 && s.charAt(j) === '\\'; j--) n++;
		return n % 2 === 1;
	}

	// The post with everything that cannot hold a link blanked out (same length,
	// same line breaks): the front matter, fenced code, HTML comments, code spans.
	function maskMarkdown(source) {
		var src = text(source);
		var chars = src.split('');
		var i;

		// Front matter, exactly as assets/js/blog.js cuts it off.
		var fm = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/.exec(src);
		if (fm) blank(chars, 0, fm[0].length);

		// Fenced code: ``` or ~~~, closed by a fence of the same kind at least as long.
		var pos = 0;
		var fence = null;
		var fenceStart = 0;
		var lines = src.split('\n');
		for (i = 0; i < lines.length; i++) {
			var line = lines[i];
			var m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
			if (!fence) {
				if (m && pos >= (fm ? fm[0].length : 0) && !(m[1].charAt(0) === '`' && line.slice(m[0].length).indexOf('`') !== -1)) {
					fence = m[1];
					fenceStart = pos;
				}
			} else if (m && m[1].charAt(0) === fence.charAt(0) && m[1].length >= fence.length && /^\s*$/.test(line.slice(m[0].length))) {
				blank(chars, fenceStart, pos + line.length);
				fence = null;
			}
			pos += line.length + 1;
		}
		if (fence) blank(chars, fenceStart, src.length);

		// HTML comments.
		var s = chars.join('');
		var re = /<!--[\s\S]*?-->/g;
		var c;
		while ((c = re.exec(s))) blank(chars, c.index, c.index + c[0].length);
		s = chars.join('');

		// Code spans: a run of backticks up to the next run of the same length,
		// inside one paragraph.
		i = 0;
		while (i < s.length) {
			var ch = s.charAt(i);
			if (ch === '\\') {
				i += 2;
				continue;
			}
			if (ch !== '`') {
				i++;
				continue;
			}
			var j = i;
			while (j < s.length && s.charAt(j) === '`') j++;
			var run = j - i;
			var k = j;
			var found = -1;
			while (k < s.length) {
				if (s.charAt(k) === '\n' && /^[ \t\r]*(\n|$)/.test(s.slice(k + 1, k + 200))) break; // a blank line ends the paragraph
				if (s.charAt(k) === '`') {
					var e = k;
					while (e < s.length && s.charAt(e) === '`') e++;
					if (e - k === run) {
						found = e;
						break;
					}
					k = e;
				} else k++;
			}
			if (found !== -1) {
				blank(chars, i, found);
				i = found;
			} else i = j;
		}
		return chars.join('');
	}

	function skipSpace(s, i) {
		while (i < s.length && /[ \t\r\n]/.test(s.charAt(i))) i++;
		return i;
	}

	function unescapeMarkdown(s) {
		return text(s)
			.replace(/\\([!-\/:-@\[-`{-~])/g, '$1')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, '\'');
	}

	// The "[" that the "]" at `close` closes, or -1. Stays inside the paragraph.
	function matchOpen(s, close) {
		var depth = 1;
		for (var i = close - 1; i >= 0; i--) {
			var c = s.charAt(i);
			if (c === '\n') {
				var before = s.slice(Math.max(0, i - 200), i);
				if (/(^|\n)[ \t\r]*$/.test(before)) return -1;
			}
			if ((c === ']' || c === '[') && !escapedAt(s, i)) {
				depth += c === ']' ? 1 : -1;
				if (depth === 0) return i;
			}
		}
		return -1;
	}

	// Reads "(destination "title")" starting just after the "(".
	// -> { url, end } (end: the index after the closing parenthesis) or null.
	function readDestination(s, start) {
		var n = s.length;
		var i = skipSpace(s, start);
		var url;
		var j;
		var c;
		if (s.charAt(i) === '<') {
			j = i + 1;
			while (j < n && s.charAt(j) !== '>' && s.charAt(j) !== '\n' && s.charAt(j) !== '<') {
				if (s.charAt(j) === '\\') j++;
				j++;
			}
			if (s.charAt(j) !== '>') return null;
			url = s.slice(i + 1, j);
			i = j + 1;
		} else {
			var depth = 0;
			j = i;
			while (j < n) {
				c = s.charAt(j);
				if (c === '\\' && j + 1 < n) {
					j += 2;
					continue;
				}
				if (c === '(') depth++;
				else if (c === ')') {
					if (depth === 0) break;
					depth--;
				} else if (c === ' ' || c === '\t' || c === '\n' || c === '\r') break;
				j++;
			}
			if (depth !== 0) return null;
			url = s.slice(i, j);
			i = j;
		}
		var k = skipSpace(s, i);
		c = s.charAt(k);
		if (k > i && (c === '"' || c === '\'' || c === '(')) {
			var endc = c === '(' ? ')' : c;
			var t = k + 1;
			while (t < n && s.charAt(t) !== endc) {
				if (s.charAt(t) === '\\') t++;
				t++;
			}
			if (t >= n) return null;
			k = skipSpace(s, t + 1);
		}
		if (s.charAt(k) !== ')') return null;
		return { url: unescapeMarkdown(url), end: k + 1 };
	}

	// Every link and image of a post: [{ url, kind, line }], in the order they
	// appear. kind is 'link', 'image', 'ref' (a "[label]: url" definition),
	// 'autolink' (<https://...> or a bare URL) or 'html' (href= or src= of a tag).
	// `markdown` may be the whole file: the front matter is skipped, and so is
	// everything inside code.
	function extractLinks(markdown) {
		var src = text(markdown);
		var s = maskMarkdown(src);
		var found = [];
		var used = []; // [from, to) ranges already claimed by a link

		function claimed(i) {
			for (var u = 0; u < used.length; u++) if (i >= used[u][0] && i < used[u][1]) return true;
			return false;
		}

		var starts = [0];
		for (var p = 0; p < src.length; p++) if (src.charAt(p) === '\n') starts.push(p + 1);
		function lineOf(index) {
			var lo = 0;
			var hi = starts.length - 1;
			while (lo < hi) {
				var mid = (lo + hi + 1) >> 1;
				if (starts[mid] <= index) lo = mid;
				else hi = mid - 1;
			}
			return lo + 1;
		}

		function add(url, kind, index, from, to) {
			found.push({ url: url, kind: kind, index: index });
			used.push([from, to]);
		}

		// [text](destination "title") and ![alt](source)
		var at = 0;
		while ((at = s.indexOf('](', at)) !== -1) {
			var close = at;
			at += 2;
			if (escapedAt(s, close)) continue;
			var open = matchOpen(s, close);
			if (open === -1) continue;
			var dest = readDestination(s, close + 2);
			if (!dest) continue;
			var image = open > 0 && s.charAt(open - 1) === '!' && !escapedAt(s, open - 1);
			add(dest.url, image ? 'image' : 'link', image ? open - 1 : open, image ? open - 1 : open, dest.end);
		}

		var m;
		// [label]: destination
		var refRe = /^ {0,3}\[([^\]\n]+)\]:[ \t]*(?:<([^<>\n]*)>|(\S+))/gm;
		while ((m = refRe.exec(s))) {
			if (m[1].charAt(0) === '^') continue; // a footnote
			add(unescapeMarkdown(m[2] !== undefined ? m[2] : m[3]), 'ref', m.index, m.index, m.index + m[0].length);
		}

		// <tag href="..." src="...">
		var tagRe = /<[a-zA-Z][a-zA-Z0-9\-]*\b([^<>]*)>/g;
		while ((m = tagRe.exec(s))) {
			if (claimed(m.index)) continue;
			var attrRe = /(?:^|\s)(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
			var a;
			var any = false;
			while ((a = attrRe.exec(m[1]))) {
				var value = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4];
				found.push({ url: unescapeMarkdown(value).trim(), kind: 'html', index: m.index });
				any = true;
			}
			if (any) used.push([m.index, m.index + m[0].length]);
		}

		// <https://example.org>
		var autoRe = /<([a-zA-Z][a-zA-Z0-9+.\-]{1,31}:[^\s<>]*)>/g;
		while ((m = autoRe.exec(s))) {
			if (claimed(m.index)) continue;
			add(m[1], 'autolink', m.index, m.index, m.index + m[0].length);
		}

		// A bare https://... in running text (GitHub-flavoured Markdown links it).
		var bareRe = /https?:\/\/[^\s<>]+/gi;
		while ((m = bareRe.exec(s))) {
			if (claimed(m.index)) continue;
			if (m.index > 0 && /[A-Za-z0-9]/.test(s.charAt(m.index - 1))) continue;
			var url = m[0];
			for (;;) {
				var last = url.charAt(url.length - 1);
				if ('?!.,:;*_\'"~'.indexOf(last) !== -1) url = url.slice(0, -1);
				else if (last === ')' && url.split(')').length > url.split('(').length) url = url.slice(0, -1);
				else break;
			}
			if (url.length > 8) add(url, 'autolink', m.index, m.index, m.index + url.length);
		}

		found.sort(function (x, y) {
			return x.index - y.index;
		});
		return found.map(function (f) {
			return { url: f.url, kind: f.kind, line: lineOf(f.index) };
		});
	}

	function hashLink(hash, out) {
		if (hash.slice(0, 2) !== '#/') {
			out.type = 'anchor';
			return out;
		}
		var body = hash.slice(2);
		var q = body.indexOf('?');
		if (q !== -1) body = body.slice(0, q);
		var slash = body.indexOf('/');
		out.type = 'route';
		out.route = decode(slash === -1 ? body : body.slice(0, slash));
		out.arg = decode(slash === -1 ? '' : body.slice(slash + 1)).replace(/\/+$/, '');
		return out;
	}

	// What a link in a post points at. Posts are shown inside the site's
	// index.html, so a relative link is relative to the site root.
	// -> { raw, type, host, absolute, route, arg, path, fetchPath }
	//    type: 'external'  another site
	//          'route'     a page of the shell: #/misc, #/post/<slug>   (route, arg)
	//          'file'      a file or folder of the site                 (path decoded, fetchPath as written)
	//          'anchor'    #section on the same page
	//          'mail'      mailto: or tel:
	//          'other'     javascript:, data: and the like
	//          'empty'
	//    absolute: the link spelled out the site's own address
	function classifyLink(url, opts) {
		opts = opts || {};
		var hosts = (opts.siteHosts || SITE_HOSTS).map(function (h) {
			return String(h).toLowerCase();
		});
		var raw = text(url).trim();
		var out = { raw: raw, type: 'empty', host: '', absolute: false, route: '', arg: '', path: '', fetchPath: '' };
		if (!raw) return out;
		if (raw.charAt(0) === '#') return hashLink(raw, out);

		var rest = raw;
		var scheme = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(raw);
		if (scheme || raw.slice(0, 2) === '//') {
			var name = scheme ? scheme[1].toLowerCase() : 'https';
			if (name !== 'http' && name !== 'https') {
				out.type = name === 'mailto' || name === 'tel' ? 'mail' : 'other';
				return out;
			}
			var m = /^(?:[a-zA-Z][a-zA-Z0-9+.\-]*:)?\/\/([^\/?#]*)(.*)$/.exec(raw);
			if (!m) {
				out.type = 'other';
				return out;
			}
			out.host = m[1].replace(/^[^@]*@/, '').replace(/:\d+$/, '').toLowerCase();
			if (hosts.indexOf(out.host) === -1) {
				out.type = 'external';
				return out;
			}
			out.absolute = true;
			rest = m[2] || '/';
		}

		var hashAt = rest.indexOf('#');
		var hash = hashAt === -1 ? '' : rest.slice(hashAt);
		if (hashAt !== -1) rest = rest.slice(0, hashAt);
		var qAt = rest.indexOf('?');
		var query = qAt === -1 ? '' : rest.slice(qAt);
		if (qAt !== -1) rest = rest.slice(0, qAt);
		var segs = [];
		rest.split('/').forEach(function (seg) {
			if (seg === '' || seg === '.') return;
			if (seg === '..') segs.pop();
			else segs.push(seg);
		});
		var path = segs.join('/') + (segs.length && /\/$/.test(rest) ? '/' : '');
		if ((path === '' || path === 'index.html') && hash.slice(0, 2) === '#/') return hashLink(hash, out);
		out.type = 'file';
		out.path = decode(path);
		out.fetchPath = path + query;
		return out;
	}

	// What is wrong with a route link, or '' when it is fine.
	// known: { routes: [...], slugs: [...] }
	function routeProblem(link, known) {
		known = known || {};
		var routes = known.routes || SITE_ROUTES;
		if (!link.route) return '';
		if (routes.indexOf(link.route) === -1) return 'the site has no page "#/' + link.route + '"';
		if (link.route === 'post') {
			if (!link.arg) return 'the link names no post';
			if (known.slugs && known.slugs.indexOf(link.arg) === -1) return 'there is no post "' + link.arg + '" in blog/index.json';
		}
		return '';
	}

	// The internal links of one post.
	// -> { total, external, internal: [{ url, line, kind, type, route, arg, path, fetchPath, absolute, problem }] }
	// `problem` is filled for a route that does not exist; files are for the
	// caller to ask for (it knows how).
	function postLinks(file, markdown, known) {
		var links = extractLinks(markdown);
		var out = { file: text(file), total: links.length, external: 0, internal: [] };
		links.forEach(function (l) {
			var c = classifyLink(l.url, known);
			if (c.type === 'external') {
				out.external++;
				return;
			}
			if (c.type !== 'route' && c.type !== 'file') return;
			var item = { url: l.url, line: l.line, kind: l.kind, type: c.type, route: c.route, arg: c.arg, path: c.path, fetchPath: c.fetchPath, absolute: c.absolute, problem: '' };
			if (c.type === 'route') item.problem = routeProblem(c, known);
			else if (c.fetchPath && safeSitePath(c.fetchPath) === null) item.problem = 'the link is not a usable path';
			out.internal.push(item);
		});
		return out;
	}

	// ---- what the live checks ask for ---------------------------------------------

	// misc/toys.json -> { targets: [{ slug, title, page, thumb }], problems: [{ what, where }] }
	function toyTargets(toysJson) {
		var list = Array.isArray(toysJson) ? toysJson : toysJson && Array.isArray(toysJson.toys) ? toysJson.toys : null;
		var out = { targets: [], problems: [] };
		if (!list) {
			out.problems.push({ what: 'misc/toys.json has no "toys" list', where: 'misc/toys.json' });
			return out;
		}
		list.forEach(function (t, i) {
			if (!isObject(t)) {
				out.problems.push({ what: 'entry ' + (i + 1) + ' is not an object', where: 'misc/toys.json' });
				return;
			}
			var slug = text(t.slug) || 'entry ' + (i + 1);
			var page = safeSitePath(t.href);
			var thumb = safeSitePath(t.thumbnail);
			if (!page) out.problems.push({ what: 'the toy "' + slug + '" has no usable href' + (t.href ? ' (' + text(t.href) + ')' : ''), where: 'misc/toys.json' });
			if (!thumb) out.problems.push({ what: 'the toy "' + slug + '" has no usable thumbnail' + (t.thumbnail ? ' (' + text(t.thumbnail) + ')' : ''), where: 'misc/toys.json' });
			out.targets.push({ slug: slug, title: text(t.title) || slug, page: page, thumb: thumb });
		});
		return out;
	}

	// blog/index.json -> { targets: [{ slug, title, file, path }], problems }
	function postTargets(index) {
		var out = { targets: [], problems: [] };
		if (!Array.isArray(index)) {
			out.problems.push({ what: 'blog/index.json is not a list', where: 'blog/index.json' });
			return out;
		}
		var seen = {};
		index.forEach(function (p, i) {
			if (!isObject(p)) {
				out.problems.push({ what: 'entry ' + (i + 1) + ' is not an object', where: 'blog/index.json' });
				return;
			}
			var slug = text(p.slug);
			var file = safeFileName(p.file);
			if (!slug) out.problems.push({ what: 'entry ' + (i + 1) + ' has no slug', where: 'blog/index.json' });
			if (!file) {
				out.problems.push({ what: 'the post "' + (slug || 'entry ' + (i + 1)) + '" has no usable file name', where: 'blog/index.json' });
				return;
			}
			if (slug && seen[slug]) out.problems.push({ what: 'the slug "' + slug + '" appears twice (' + seen[slug] + ' and ' + file + ')', where: 'blog/index.json' });
			if (slug) seen[slug] = file;
			out.targets.push({ slug: slug, title: text(p.title) || slug, file: file, path: 'blog/posts/' + file });
		});
		return out;
	}

	// The Paper Theatre's stories/index.json -> { targets: [{ id, title, file, path }], problems }
	var STORIES_DIR = 'misc/55-paper-theatre/stories/';
	function storyTargets(index) {
		var out = { targets: [], problems: [] };
		if (!Array.isArray(index)) {
			out.problems.push({ what: 'the stories index is not a list', where: STORIES_DIR + 'index.json' });
			return out;
		}
		index.forEach(function (s, i) {
			if (!isObject(s)) {
				out.problems.push({ what: 'entry ' + (i + 1) + ' is not an object', where: STORIES_DIR + 'index.json' });
				return;
			}
			var id = text(s.id) || 'entry ' + (i + 1);
			var file = safeFileName(s.file);
			if (!file) {
				out.problems.push({ what: 'the story "' + id + '" has no usable file name', where: STORIES_DIR + 'index.json' });
				return;
			}
			out.targets.push({ id: id, title: text(s.title) || id, file: file, path: STORIES_DIR + file });
		});
		return out;
	}

	// blog/index.json against the names of the files in blog/posts.
	// -> { missingFromIndex: [file], missingFiles: [{ slug, file }], indexed, files }
	// Only .md files count, as in scripts/build-blog-index.mjs.
	function comparePostsIndex(index, fileNames) {
		var files = (fileNames || []).map(text).filter(function (f) {
			return /\.md$/i.test(f);
		});
		var inIndex = {};
		var entries = [];
		(Array.isArray(index) ? index : []).forEach(function (p) {
			if (!isObject(p) || !p.file) return;
			inIndex[text(p.file)] = true;
			entries.push({ slug: text(p.slug), file: text(p.file) });
		});
		var onDisk = {};
		files.forEach(function (f) {
			onDisk[f] = true;
		});
		return {
			missingFromIndex: files
				.filter(function (f) {
					return !inIndex[f];
				})
				.sort(),
			missingFiles: entries.filter(function (e) {
				return !onDisk[e.file];
			}),
			indexed: entries.length,
			files: files.length,
		};
	}

	// How many publications the Publications section of index.html shows:
	// the .pub-block elements inside <section id="publicationsContent">.
	// -> { found, count }
	function countPublicationBlocks(html) {
		var src = text(html);
		var open = /<section\b[^>]*\bid\s*=\s*["']publicationsContent["'][^>]*>/i.exec(src);
		if (!open) return { found: false, count: 0 };
		var from = open.index + open[0].length;
		// The section has no section inside it; should that change, count depth.
		var depth = 1;
		var re = /<(\/?)section\b[^>]*>/gi;
		re.lastIndex = from;
		var end = src.length;
		var m;
		while ((m = re.exec(src))) {
			depth += m[1] ? -1 : 1;
			if (depth === 0) {
				end = m.index;
				break;
			}
		}
		var body = src.slice(from, end).replace(/<!--[\s\S]*?-->/g, '');
		var count = 0;
		var tag = /<[a-zA-Z][^<>]*\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')[^<>]*>/g;
		while ((m = tag.exec(body))) {
			var classes = (m[1] !== undefined ? m[1] : m[2]).split(/\s+/);
			if (classes.indexOf('pub-block') !== -1) count++;
		}
		return { found: true, count: count };
	}

	// -> { ok, jsonCount, htmlCount, found, what }
	function comparePublications(json, html) {
		var blocks = countPublicationBlocks(html);
		var jsonCount = Array.isArray(json) ? json.length : -1;
		var out = { ok: false, jsonCount: jsonCount, htmlCount: blocks.count, found: blocks.found, what: '' };
		if (jsonCount < 0) out.what = 'assets/data/publications.json is not a list';
		else if (!blocks.found) out.what = 'index.html has no section with id "publicationsContent"';
		else if (jsonCount !== blocks.count) out.what = 'assets/data/publications.json lists ' + plural(jsonCount, 'entry', 'entries') + ', the Publications section of index.html shows ' + blocks.count;
		else out.ok = true;
		return out;
	}

	// ---- one status for many checks ------------------------------------------------

	var WORST = { ok: 0, skip: 1, warn: 2, fail: 3 };

	// The state of one check from its problems: a problem with level 'warn'
	// (or 'skip') is not a failure.
	function stateOf(problems, skipped) {
		if (skipped) return 'skip';
		var state = 'ok';
		(problems || []).forEach(function (p) {
			var level = p && (p.level === 'warn' || p.level === 'skip') ? p.level : 'fail';
			if (WORST[level] > WORST[state]) state = level;
		});
		return state === 'skip' ? 'warn' : state;
	}

	// results: [{ id, title, state: 'ok' | 'warn' | 'fail' | 'skip', checked, problems: [...] }]
	// -> { state, total, ok, warn, fail, skip, problems, checked }
	// The overall state is the worst one; skipped checks do not make it worse
	// than 'ok', but they are counted.
	function rollUp(results) {
		var out = { state: 'ok', total: 0, ok: 0, warn: 0, fail: 0, skip: 0, problems: 0, checked: 0 };
		(results || []).forEach(function (r) {
			if (!r) return;
			var state = WORST[r.state] === undefined ? 'fail' : r.state;
			out.total++;
			out[state]++;
			out.checked += Number(r.checked) || 0;
			if (state === 'fail' || state === 'warn') out.problems += (r.problems || []).length || 1;
			if (state !== 'skip' && WORST[state] > WORST[out.state]) out.state = state;
		});
		if (!out.total) out.state = 'skip';
		return out;
	}

	// "All green", "2 of 7 checks failing", ... : the words before "2 hours ago".
	function summaryText(roll) {
		if (!roll || !roll.total) return 'No checks have run';
		var parts = [];
		if (roll.fail) parts.push(roll.fail + ' of ' + plural(roll.total, 'check') + ' failing');
		if (roll.warn) parts.push(plural(roll.warn, 'warning'));
		if (!roll.fail && !roll.warn) parts.push(roll.skip === roll.total ? 'Nothing could be checked' : 'All green');
		if (roll.skip && roll.skip !== roll.total) parts.push(roll.skip + ' skipped');
		return parts.join(', ');
	}

	// The single line for Home: "All green 2 hours ago".
	// summary: { state, text, at } as the Health view stores it; ago: the words for `at`.
	function homeLine(summary, ago) {
		if (!summary || !summary.text) return '';
		return summary.text + (ago ? ' ' + ago : '');
	}

	// ---- deploys ---------------------------------------------------------------------

	// Only links to github.com are shown as links; anything else from the API is text.
	function gitHubUrl(url) {
		var u = text(url);
		return /^https:\/\/github\.com\/[^\s<>"']*$/.test(u) ? u : '';
	}

	function shortSha(sha) {
		var s = text(sha);
		return /^[0-9a-f]{7,64}$/i.test(s) ? s.slice(0, 7) : s.slice(0, 12);
	}

	// GET /repos/{o}/{r}/commits -> [{ sha, short, message, author, date, url }]
	function commitList(data) {
		return (Array.isArray(data) ? data : []).filter(isObject).map(function (c) {
			var inner = isObject(c.commit) ? c.commit : {};
			var who = isObject(inner.committer) ? inner.committer : isObject(inner.author) ? inner.author : {};
			var author = (isObject(c.author) && c.author.login) || (isObject(inner.author) && inner.author.name) || '';
			return {
				sha: text(c.sha),
				short: shortSha(c.sha),
				message: text(inner.message).split('\n')[0],
				author: text(author),
				date: text(who.date),
				url: gitHubUrl(c.html_url),
			};
		});
	}

	// GET /repos/{o}/{r}/pages/builds -> the same, tidied: [{ status, commit, short, created, updated, durationMs, error }]
	function buildList(data) {
		var list = Array.isArray(data) ? data : isObject(data) ? [data] : [];
		return list.filter(isObject).map(function (b) {
			return {
				status: text(b.status),
				commit: text(b.commit),
				short: shortSha(b.commit),
				created: text(b.created_at),
				updated: text(b.updated_at),
				durationMs: Number(b.duration) || 0,
				error: isObject(b.error) && b.error.message ? text(b.error.message) : '',
			};
		});
	}

	// The newest build that finished well ('built'), or null.
	function lastGoodBuild(builds) {
		for (var i = 0; i < (builds || []).length; i++) if (builds[i] && builds[i].status === 'built') return builds[i];
		return null;
	}

	// -> { kind: 'ok' | 'bad' | 'warn' | 'run', label }
	function buildState(build) {
		if (!build) return { kind: 'warn', label: 'no build' };
		var s = text(build.status).toLowerCase();
		if (s === 'built') return { kind: 'ok', label: 'built' };
		if (s === 'errored') return { kind: 'bad', label: 'failed' };
		if (s === 'building' || s === 'queued') return { kind: 'run', label: s };
		return { kind: 'warn', label: s || 'unknown' };
	}

	// One Actions run -> { kind, label }
	function runState(run) {
		var status = text(run && run.status).toLowerCase();
		var conclusion = text(run && run.conclusion).toLowerCase();
		if (status && status !== 'completed') return { kind: 'run', label: status.replace(/_/g, ' ') };
		if (conclusion === 'success') return { kind: 'ok', label: 'success' };
		if (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'startup_failure') return { kind: 'bad', label: conclusion.replace(/_/g, ' ') };
		if (conclusion === 'cancelled' || conclusion === 'action_required' || conclusion === 'stale') return { kind: 'warn', label: conclusion.replace(/_/g, ' ') };
		if (conclusion === 'skipped' || conclusion === 'neutral') return { kind: 'muted', label: conclusion };
		return { kind: 'warn', label: conclusion || status || 'unknown' };
	}

	// GET /repos/{o}/{r}/actions/runs -> one group per workflow, newest run first:
	// [{ key, name, path, runs: [{ id, title, event, state, sha, short, date, url, number }] }]
	function groupRuns(data, perWorkflow) {
		var runs = isObject(data) && Array.isArray(data.workflow_runs) ? data.workflow_runs : Array.isArray(data) ? data : [];
		var keep = perWorkflow || 5;
		var groups = [];
		var byKey = {};
		runs.filter(isObject).forEach(function (r) {
			var key = text(r.path) || text(r.workflow_id) || text(r.name) || 'workflow';
			var g = byKey[key];
			if (!g) {
				g = byKey[key] = { key: key, name: text(r.name) || key, path: text(r.path), runs: [], total: 0 };
				groups.push(g);
			}
			g.total++;
			if (g.runs.length >= keep) return;
			g.runs.push({
				id: text(r.id),
				number: Number(r.run_number) || 0,
				title: text(r.display_title) || text(r.name),
				event: text(r.event),
				state: runState(r),
				sha: text(r.head_sha),
				short: shortSha(r.head_sha),
				date: text(r.updated_at || r.run_started_at || r.created_at),
				url: gitHubUrl(r.html_url),
			});
		});
		return groups;
	}

	// The commit of the newest successful "pages build and deployment" run:
	// what is live when the Pages builds themselves cannot be read.
	// -> { sha, date } or null
	function liveFromRuns(data) {
		var runs = isObject(data) && Array.isArray(data.workflow_runs) ? data.workflow_runs : Array.isArray(data) ? data : [];
		for (var i = 0; i < runs.length; i++) {
			var r = runs[i];
			if (!isObject(r)) continue;
			var pages = /pages-build-deployment/.test(text(r.path)) || /^pages build and deployment$/i.test(text(r.name));
			if (pages && text(r.status) === 'completed' && text(r.conclusion) === 'success' && r.head_sha) return { sha: text(r.head_sha), date: text(r.updated_at || r.created_at) };
		}
		return null;
	}

	// commits: newest first; liveSha: the commit of the last successful build.
	// -> { known, found, pending: [commit, ...] }
	//    known: false when there is no live commit to compare with
	//    found: false when the live commit is older than the list (pending is then the whole list)
	function notYetLive(commits, liveSha) {
		var list = commits || [];
		var live = text(liveSha);
		if (!live) return { known: false, found: false, pending: [] };
		var pending = [];
		for (var i = 0; i < list.length; i++) {
			if (list[i].sha === live) return { known: true, found: true, pending: pending };
			pending.push(list[i]);
		}
		return { known: true, found: false, pending: pending };
	}

	// ---- to-dos ------------------------------------------------------------------------

	var TODO_VERSION = 1;
	var TODO_PATH = 'todos.json';
	var DECISIONS = 'decisions';

	function cleanTag(t) {
		return text(t)
			.trim()
			.replace(/^#+/, '')
			.replace(/[\[\],\s]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.toLowerCase()
			.slice(0, 40);
	}

	// 'a, B  c' or ['a', '#B'] -> ['a', 'b', 'c'] (lowercase, dashes, no repeats)
	function cleanTags(input) {
		var list = Array.isArray(input) ? input : text(input).split(/[,\s]+/);
		var seen = {};
		var out = [];
		list.forEach(function (t) {
			var tag = cleanTag(t);
			if (!tag || seen[tag]) return;
			seen[tag] = true;
			out.push(tag);
		});
		return out;
	}

	// '2026-10-12' (or anything that starts with such a day) -> '2026-10-12', else ''
	function isoDay(v) {
		var m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(text(v).trim());
		if (!m) return '';
		var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
		if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return '';
		return m[1] + '-' + m[2] + '-' + m[3];
	}

	// Any date -> '2026-10-05T14:03:22Z', else the fallback
	function isoStamp(v, fallback) {
		if (v === undefined || v === null || v === '') return fallback || '';
		var d = v instanceof Date ? v : new Date(v);
		if (isNaN(d.getTime())) return fallback || '';
		return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
	}

	function makeId(now, random) {
		var r = Math.floor((random || Math.random)() * 1679616)
			.toString(36);
		while (r.length < 4) r = '0' + r;
		return 't' + Number(now || Date.now()).toString(36) + r;
	}

	// One item as the file keeps it. Returns null when there is no text.
	// Accepts what a hand-written file is likely to hold: a plain string, or an
	// object with text (or title, task, name), done, created, due, tags, link (or url).
	function normalizeItem(raw, now) {
		var stamp = isoStamp(now || new Date());
		if (typeof raw === 'string') raw = { text: raw };
		if (!isObject(raw)) return null;
		var body = text(raw.text || raw.title || raw.task || raw.name || raw.what)
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 2000);
		if (!body) return null;
		var done = raw.done === true || raw.done === 'true' || raw.done === 1 || raw.completed === true || text(raw.status).toLowerCase() === 'done';
		var item = {
			id: /^[A-Za-z0-9_\-]{1,64}$/.test(text(raw.id)) ? text(raw.id) : '',
			text: body,
			done: done,
			created: isoStamp(raw.created || raw.createdAt || raw.added, stamp),
			due: isoDay(raw.due || raw.dueDate || raw.deadline),
			tags: cleanTags(raw.tags !== undefined ? raw.tags : raw.tag !== undefined ? raw.tag : raw.labels),
			link: text(raw.link || raw.url || raw.href).trim().slice(0, 2000),
			doneAt: done ? isoStamp(raw.doneAt || raw.completedAt, '') : '',
			updated: isoStamp(raw.updated || raw.updatedAt, ''),
		};
		if (hasControl(item.link)) item.link = '';
		return item;
	}

	// The file's text (or an already parsed value) -> { items, problems }.
	// Accepts { items: [...] }, { todos: [...] } or a bare list. Items without an
	// id get one; a repeated id gets a new one.
	function parseTodos(input, opts) {
		opts = opts || {};
		var now = opts.now || new Date();
		var out = { items: [], problems: [] };
		var value = input;
		if (typeof input === 'string') {
			var src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
			if (!src.trim()) return out;
			try {
				value = JSON.parse(src);
			} catch (e) {
				out.problems.push('This is not valid JSON: ' + e.message);
				out.invalid = true;
				return out;
			}
		}
		var list = Array.isArray(value) ? value : isObject(value) && Array.isArray(value.items) ? value.items : isObject(value) && Array.isArray(value.todos) ? value.todos : null;
		if (!list) {
			out.problems.push('No list was found: the file should hold { "items": [ ... ] } or a plain list.');
			out.invalid = true;
			return out;
		}
		var seen = {};
		var n = 0;
		list.forEach(function (raw, i) {
			var item = normalizeItem(raw, now);
			if (!item) {
				out.problems.push('Entry ' + (i + 1) + ' has no text and was left out.');
				return;
			}
			if (!item.id || seen[item.id]) {
				item.id = opts.makeId ? opts.makeId() : makeId(new Date(now).getTime() + n++, opts.random);
				while (seen[item.id]) item.id = makeId(new Date(now).getTime() + n++, opts.random);
			}
			seen[item.id] = true;
			out.items.push(item);
		});
		return out;
	}

	function fileItem(item) {
		var o = { id: item.id, text: item.text, done: !!item.done, created: item.created };
		if (item.due) o.due = item.due;
		o.tags = (item.tags || []).slice();
		if (item.link) o.link = item.link;
		if (item.done && item.doneAt) o.doneAt = item.doneAt;
		if (item.updated) o.updated = item.updated;
		return o;
	}

	// items -> the text of todos.json
	function serializeTodos(items) {
		return JSON.stringify({ version: TODO_VERSION, items: (items || []).map(fileItem) }, null, '\t') + '\n';
	}

	// What the quick-add box understands: "#tag" words, "due:2026-10-12", a URL.
	// 'Email Tien about the draft #decisions due:2026-10-12 https://x.org/a'
	//   -> { text: 'Email Tien about the draft', tags: ['decisions'], due: '2026-10-12', link: 'https://x.org/a' }
	function parseQuick(input) {
		var tags = [];
		var due = '';
		var link = '';
		var words = text(input)
			.replace(/\s+/g, ' ')
			.trim()
			.split(' ');
		var kept = [];
		words.forEach(function (w) {
			var m;
			if (/^#[A-Za-z][A-Za-z0-9_\-]*$/.test(w)) tags.push(w);
			else if ((m = /^due:(\S+)$/i.exec(w)) && isoDay(m[1])) due = isoDay(m[1]);
			else if (!link && /^https?:\/\/\S+$/i.test(w)) {
				link = w;
				kept.push(null);
			} else kept.push(w);
		});
		var body = kept
			.filter(function (w) {
				return w !== null;
			})
			.join(' ')
			.trim();
		if (!body && link) body = link;
		return { text: body, tags: cleanTags(tags), due: due, link: link };
	}

	// -> [{ tag, open, total }]: "decisions" first, then by name
	function tagCounts(items) {
		var by = {};
		(items || []).forEach(function (it) {
			(it.tags || []).forEach(function (t) {
				var c = by[t] || (by[t] = { tag: t, open: 0, total: 0 });
				c.total++;
				if (!it.done) c.open++;
			});
		});
		return Object.keys(by)
			.sort(function (a, b) {
				if (a === DECISIONS) return -1;
				if (b === DECISIONS) return 1;
				return a < b ? -1 : a > b ? 1 : 0;
			})
			.map(function (k) {
				return by[k];
			});
	}

	// filter: { tag: 'decisions' | '', done: true | false | undefined }
	function filterTodos(items, filter) {
		filter = filter || {};
		return (items || []).filter(function (it) {
			if (filter.tag && (it.tags || []).indexOf(filter.tag) === -1) return false;
			if (filter.done !== undefined && !!it.done !== !!filter.done) return false;
			return true;
		});
	}

	// Moves one item among the items that are on screen.
	//   delta: -1 up, 1 down, 'top', 'bottom'
	//   visibleIds: the ids on screen, in order (default: all)
	// -> a new list (the same list when nothing can move)
	function moveTodo(items, id, delta, visibleIds) {
		var list = (items || []).slice();
		var ids = visibleIds || list.map(function (it) {
			return it.id;
		});
		var at = ids.indexOf(id);
		if (at === -1) return items;
		var targetAt = delta === 'top' ? 0 : delta === 'bottom' ? ids.length - 1 : at + (delta < 0 ? -1 : 1);
		if (targetAt < 0 || targetAt >= ids.length || targetAt === at) return items;
		var from = -1;
		for (var i = 0; i < list.length; i++) if (list[i].id === id) from = i;
		if (from === -1) return items;
		var item = list.splice(from, 1)[0];
		var to = -1;
		for (i = 0; i < list.length; i++) if (list[i].id === ids[targetAt]) to = i;
		if (to === -1) return items;
		list.splice(targetAt > at ? to + 1 : to, 0, item);
		return list;
	}

	function sameText(a, b) {
		return text(a).toLowerCase().replace(/\s+/g, ' ').trim() === text(b).toLowerCase().replace(/\s+/g, ' ').trim();
	}

	// Adds a list read from a file to the list on screen.
	//   mode 'merge':   entries that are already there (same id, or the same text) are skipped;
	//                   the new ones go after the existing ones, in the file's order
	//   mode 'replace': the file's list takes the place of the list
	// -> { items, added, skipped }
	function importTodos(existing, incoming, mode) {
		var have = (existing || []).slice();
		if (mode === 'replace') return { items: (incoming || []).slice(), added: (incoming || []).length, skipped: 0 };
		var ids = {};
		have.forEach(function (it) {
			ids[it.id] = true;
		});
		var added = 0;
		var skipped = 0;
		(incoming || []).forEach(function (it) {
			var dup =
				ids[it.id] ||
				have.some(function (h) {
					return sameText(h.text, it.text);
				});
			if (dup) {
				skipped++;
				return;
			}
			ids[it.id] = true;
			have.push(it);
			added++;
		});
		return { items: have, added: added, skipped: skipped };
	}

	function fieldsOf(item) {
		return JSON.stringify([item.text, !!item.done, item.due || '', (item.tags || []).slice().sort(), item.link || '']);
	}

	function newer(a, b) {
		return text(a.updated || a.created) >= text(b.updated || b.created);
	}

	// Two devices changed the list. base: the list both started from (may be
	// empty when unknown); mine: this device's; theirs: what GitHub has now.
	//   - an item changed on one side only keeps that change;
	//   - changed on both, the later change wins (this device on a tie);
	//   - deleted on one side and untouched on the other, it stays deleted;
	//     deleted on one side and edited on the other, the edit wins;
	//   - new items of both sides are kept; the order is this device's, with
	//     the other side's new items placed after the item they followed there.
	// -> the merged list
	function mergeTodos(base, mine, theirs) {
		var b = {};
		var m = {};
		var t = {};
		(base || []).forEach(function (it) {
			b[it.id] = it;
		});
		(mine || []).forEach(function (it) {
			m[it.id] = it;
		});
		(theirs || []).forEach(function (it) {
			t[it.id] = it;
		});

		function pick(id) {
			var mi = m[id];
			var ti = t[id];
			var bi = b[id];
			if (mi && ti) {
				var mineChanged = !bi || fieldsOf(mi) !== fieldsOf(bi);
				var theirsChanged = !bi || fieldsOf(ti) !== fieldsOf(bi);
				if (mineChanged && !theirsChanged) return mi;
				if (theirsChanged && !mineChanged) return ti;
				if (!mineChanged && !theirsChanged) return mi;
				return newer(mi, ti) ? mi : ti;
			}
			if (mi) {
				// Not on GitHub: new here, or deleted there.
				if (!bi) return mi;
				return fieldsOf(mi) !== fieldsOf(bi) ? mi : null;
			}
			if (ti) {
				// Not here: new there, or deleted here.
				if (!bi) return ti;
				return fieldsOf(ti) !== fieldsOf(bi) ? ti : null;
			}
			return null;
		}

		var out = [];
		var placed = {};
		(mine || []).forEach(function (it) {
			var keep = pick(it.id);
			if (keep && !placed[it.id]) {
				placed[it.id] = true;
				out.push(keep);
			}
		});
		// The other side's items that are not placed yet, each after the nearest
		// earlier item of their list that is.
		var prev = null;
		(theirs || []).forEach(function (it) {
			if (placed[it.id]) {
				prev = it.id;
				return;
			}
			var keep = pick(it.id);
			if (!keep) return;
			var at = -1;
			if (prev !== null) for (var i = 0; i < out.length; i++) if (out[i].id === prev) at = i;
			out.splice(at + 1, 0, keep);
			placed[it.id] = true;
			prev = it.id;
		});
		return out;
	}

	// due: '2026-10-12', today: '2026-10-05' -> '', 'overdue', 'today', 'soon' (within a week) or 'later'
	function dueState(due, today) {
		var d = isoDay(due);
		var now = isoDay(today);
		if (!d || !now) return '';
		if (d < now) return 'overdue';
		if (d === now) return 'today';
		var days = (Date.parse(d + 'T00:00:00Z') - Date.parse(now + 'T00:00:00Z')) / 86400000;
		return days <= 7 ? 'soon' : 'later';
	}

	// A to-do's link, if it is one that may be followed:
	//   https://..., http://..., mailto:...  -> { href, external: true }
	//   #/write?draft=...                     -> { href, external: false } (a page of the Desk)
	// anything else -> null (shown as plain text)
	function safeLink(link) {
		var l = text(link).trim();
		if (!l || hasControl(l) || /\s/.test(l)) return null;
		if (/^https?:\/\/[^\s]+$/i.test(l) || /^mailto:[^\s]+$/i.test(l)) return { href: l, external: true };
		if (/^#\/[a-z][a-z0-9\-]*(\?[^\s]*)?$/.test(l)) return { href: l, external: false };
		return null;
	}

	// ---- drafts -----------------------------------------------------------------------

	// The title of a draft: its front matter's title, else its first heading,
	// else its file name without the date and the extension.
	function draftTitle(body, name) {
		var src = text(body);
		var fm = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/.exec(src);
		if (fm) {
			var lines = fm[1].split(/\r?\n/);
			for (var i = 0; i < lines.length; i++) {
				var m = /^title\s*:\s*(.*)$/.exec(lines[i]);
				if (m) {
					var t = m[1].trim().replace(/^["']|["']$/g, '');
					if (t) return t;
				}
			}
			src = src.slice(fm[0].length);
		}
		var h = /^\s{0,3}#\s+(.+?)\s*#*\s*$/m.exec(src);
		if (h && h[1].trim()) return h[1].trim();
		return text(name)
			.replace(/^.*\//, '')
			.replace(/\.(md|markdown|txt)$/i, '')
			.replace(/^\d{4}-\d{2}-\d{2}-/, '')
			.replace(/[-_]+/g, ' ')
			.trim() || text(name);
	}

	function wordCount(body) {
		var src = text(body).replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/, '');
		var m = src.match(/[A-Za-z0-9À-￿]+(?:['’\-][A-Za-z0-9À-￿]+)*/g);
		return m ? m.length : 0;
	}

	// drafts: [{ path, name, title, at (ISO, when last changed, '' if unknown), pending }]
	// -> { count, oldest (the one untouched longest, or null), sorted (oldest first, unknown dates last) }
	function draftSummary(drafts) {
		var list = (drafts || []).slice();
		list.sort(function (a, b) {
			var x = text(a.at);
			var y = text(b.at);
			if (!x && !y) return text(a.name) < text(b.name) ? -1 : 1;
			if (!x) return 1;
			if (!y) return -1;
			return x < y ? -1 : x > y ? 1 : 0;
		});
		return { count: list.length, oldest: list.length && list[0].at ? list[0] : null, sorted: list };
	}

	// ---- the stories board ---------------------------------------------------------------

	function norm(s) {
		return text(s)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, ' ')
			.trim();
	}

	function storyCell(s) {
		var status = text(s.status).toLowerCase() || 'draft';
		return {
			id: text(s.id),
			title: text(s.title),
			status: status,
			known: status === 'published' || status === 'draft' || status === 'embargo',
			verify: s.verify === true,
			href: s.id ? 'misc/55-paper-theatre/?story=' + encodeURIComponent(text(s.id)) : '',
		};
	}

	// One row per publication and per published post, each with its Paper
	// Theatre story or null.
	//   publications: assets/data/publications.json
	//   posts:        blog/index.json
	//   stories:      misc/55-paper-theatre/stories/index.json
	// -> { papers: [{ title, venue, year, section, story }], posts: [{ title, slug, date, story }],
	//      orphans: [story, ...] (stories that belong to no row), counts }
	// A paper's story is the one its "story" field names, else the paper story
	// whose "pub" text appears in the paper's title (the longest such text).
	// Titles and venues are passed through exactly as the files have them.
	function storyBoard(publications, posts, stories) {
		var list = (Array.isArray(stories) ? stories : []).filter(isObject);
		var taken = {};
		var byId = {};
		list.forEach(function (s) {
			if (s.id) byId[text(s.id)] = s;
		});

		var pubs = (Array.isArray(publications) ? publications : []).filter(isObject);
		var paperRows = pubs.map(function (p) {
			return { title: text(p.title), venue: text(p.venue), year: text(p.year), section: text(p.section), story: null, _named: text(p.story) };
		});
		// First the stories a publication names, then the ones found by title.
		paperRows.forEach(function (row) {
			var s = row._named && byId[row._named];
			if (s && !taken[row._named]) {
				taken[row._named] = true;
				row.story = storyCell(s);
			}
		});
		paperRows.forEach(function (row) {
			if (row.story) return;
			var title = ' ' + norm(row.title) + ' ';
			var best = null;
			list.forEach(function (s) {
				if (text(s.kind) !== 'paper' || taken[text(s.id)]) return;
				var key = norm(s.pub || text(s.source).replace(/^paper:/, ''));
				if (!key || title.indexOf(' ' + key + ' ') === -1) return;
				if (!best || key.length > best.key.length) best = { key: key, story: s };
			});
			if (best) {
				taken[text(best.story.id)] = true;
				row.story = storyCell(best.story);
			}
		});
		paperRows.forEach(function (row) {
			delete row._named;
		});

		var postRows = (Array.isArray(posts) ? posts : []).filter(isObject).map(function (p) {
			var slug = text(p.slug);
			var row = { title: text(p.title), slug: slug, date: text(p.date), story: null };
			for (var i = 0; i < list.length; i++) {
				var s = list[i];
				if (text(s.kind) !== 'blog' || taken[text(s.id)]) continue;
				if ((s.slug && text(s.slug) === slug) || text(s.source) === 'blog:' + slug) {
					taken[text(s.id)] = true;
					row.story = storyCell(s);
					break;
				}
			}
			return row;
		});

		var orphans = list
			.filter(function (s) {
				return !taken[text(s.id)];
			})
			.map(function (s) {
				var cell = storyCell(s);
				cell.kind = text(s.kind);
				return cell;
			});

		var counts = { rows: paperRows.length + postRows.length, withStory: 0, published: 0, verify: 0, none: 0 };
		paperRows.concat(postRows).forEach(function (row) {
			if (!row.story) {
				counts.none++;
				return;
			}
			counts.withStory++;
			if (row.story.status === 'published') counts.published++;
			if (row.story.verify) counts.verify++;
		});
		return { papers: paperRows, posts: postRows, orphans: orphans, counts: counts };
	}

	return {
		SITE_ROUTES: SITE_ROUTES,
		SITE_HOSTS: SITE_HOSTS,
		STORIES_DIR: STORIES_DIR,
		safeSitePath: safeSitePath,
		safeFileName: safeFileName,
		maskMarkdown: maskMarkdown,
		extractLinks: extractLinks,
		classifyLink: classifyLink,
		routeProblem: routeProblem,
		postLinks: postLinks,
		toyTargets: toyTargets,
		postTargets: postTargets,
		storyTargets: storyTargets,
		comparePostsIndex: comparePostsIndex,
		countPublicationBlocks: countPublicationBlocks,
		comparePublications: comparePublications,
		stateOf: stateOf,
		rollUp: rollUp,
		summaryText: summaryText,
		homeLine: homeLine,
		plural: plural,
		gitHubUrl: gitHubUrl,
		shortSha: shortSha,
		commitList: commitList,
		buildList: buildList,
		lastGoodBuild: lastGoodBuild,
		buildState: buildState,
		runState: runState,
		groupRuns: groupRuns,
		liveFromRuns: liveFromRuns,
		notYetLive: notYetLive,
		todos: {
			VERSION: TODO_VERSION,
			PATH: TODO_PATH,
			DECISIONS: DECISIONS,
			cleanTag: cleanTag,
			cleanTags: cleanTags,
			isoDay: isoDay,
			isoStamp: isoStamp,
			makeId: makeId,
			normalizeItem: normalizeItem,
			parse: parseTodos,
			serialize: serializeTodos,
			parseQuick: parseQuick,
			tagCounts: tagCounts,
			filter: filterTodos,
			move: moveTodo,
			importItems: importTodos,
			merge: mergeTodos,
			dueState: dueState,
			safeLink: safeLink,
		},
		drafts: {
			title: draftTitle,
			wordCount: wordCount,
			summary: draftSummary,
		},
		stories: {
			board: storyBoard,
		},
	};
});
