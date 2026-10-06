/*
 * Theatre Studio: scaffolds and small pure helpers for the Files panel (files.js).
 * UMD: window.StudioScaffold in the browser, module.exports in Node (tested by test-scaffold.js).
 *
 * A scaffold is the shape of a story, never its content. A paper scaffold is a header copied verbatim from
 * assets/data/publications.json plus structural comments; it holds no sentence, figure, result or venue claim.
 * A post scaffold mirrors scripts/build-vn-index.mjs --scaffold-post: the post's own paragraphs as narration with
 * ^¶n chips, each under a "# from:" comment that keeps the original Markdown.
 */
(function (root, factory) {
	'use strict';
	var api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else root.StudioScaffold = api;
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	var JACK = '@cast Jack hue=210 skin=2 masc hairhue=25 hairtone=dark glasses short hoodie';
	var LIST_RE = /^([-*+]|\d+[.)])\s+/;

	function oneLine(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

	function pad2(n) { return (n < 10 ? '0' : '') + n; }
	function isoDay(d) {
		d = d instanceof Date ? d : new Date(d == null ? Date.now() : d);
		return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
	}

	// the same wrapping as build-vn-index.mjs: a first line plus two-space continuation lines
	function wrapLine(text, width) {
		width = width || 100;
		var words = String(text).split(/\s+/).filter(Boolean), lines = [], cur = '';
		words.forEach(function (w) {
			if (cur && (cur + ' ' + w).length > width) { lines.push(cur); cur = w; }
			else cur = cur ? cur + ' ' + w : w;
		});
		if (cur) lines.push(cur);
		return lines.map(function (l, i) { return i === 0 ? l : '  ' + l; }).join('\n');
	}

	function commentFrom(label, text, width) {
		width = width || 100;
		var words = String(text).split(/\s+/).filter(Boolean), lines = [], cur = '';
		words.forEach(function (w) {
			if (cur && (cur + ' ' + w).length > width) { lines.push(cur); cur = w; }
			else cur = cur ? cur + ' ' + w : w;
		});
		if (cur) lines.push(cur);
		return lines.map(function (l, i) { return i === 0 ? '# ' + label + ' ' + l : '#   ' + l; }).join('\n');
	}

	function decodeEntities(s) {
		return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
	}

	// inline Markdown -> .vn inline markup (*em* and `code` survive, links keep their text); as build-vn-index.mjs
	function inlineToVn(s) {
		return decodeEntities(String(s)
			.replace(/<[^>\n]+>/g, '')
			.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
			.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
			.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
			.replace(/(\*\*|__)([\s\S]*?)\1/g, '$2')
			.replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1*$2*')
			.replace(/~~([^~]*)~~/g, '$1')
			.replace(/[{}]/g, function (c) { return c === '{' ? '(' : ')'; })
		).replace(/\s+/g, ' ').trim();
	}

	// the post's blocks the way VN.blog() and @read count them (so the ^¶n chips agree)
	function blogBlocks(body) {
		var s = String(body).replace(/\r/g, '');
		s = s.replace(/<!--[\s\S]*?-->/g, '');
		s = s.replace(/```[\s\S]*?```/g, '');
		s = s.replace(/^[ \t]*\[[^\]]+\]:[ \t]*\S+.*$/gm, '');
		s = s.replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, '');
		var blocks = [];
		s.split(/\n[ \t]*\n+/).forEach(function (blk) {
			var prev = blocks.length ? blocks[blocks.length - 1] : null;
			if (prev !== null && LIST_RE.test(prev) && (LIST_RE.test(blk) || /^[ \t]+\S/.test(blk))) blocks[blocks.length - 1] = prev + '\n' + blk;
			else blocks.push(blk);
		});
		return blocks;
	}

	/* ---------------------------------------------------------------- paper */

	var CHAPTERS = [
		['the question', 'what the paper asks, and why it matters; the title often is the question'],
		['the bet', 'a menu for the reader; branches hold reactions only, never figures, then reconverge (== label)'],
		['the method', 'what was done, in the paper\'s words; every number as a {fact}'],
		['the result', 'the figures as the paper printed them, each a {fact} with a chip; @withheld until public'],
		['what it means', 'the claim the paper itself makes, no larger'],
		['the citation', 'the end card: @cite, @link and @end']
	];

	// pub: an entry of assets/data/publications.json. Returns the .vn text.
	function paperScaffold(pub, opts) {
		opts = opts || {};
		if (!pub || typeof pub.title !== 'string' || !oneLine(pub.title)) throw new Error('The publication has no title.');
		var title = oneLine(pub.title);
		var authors = oneLine(pub.authorsText || (Array.isArray(pub.authors) ? pub.authors.join(', ') : ''));
		var hasPdf = (pub.links || []).some(function (l) { return l && /\.pdf$/i.test(String(l.href || '')); });
		var L = [
			'@title ' + title,
			'@kind paper',
			'@source paper:' + title
		];
		if (authors) L.push('@authors ' + authors);
		else L.push('# @authors: publications.json lists no authors for this entry; add them in paper order.');
		L.push(
			'@status draft',
			'@verify',
			JACK,
			'',
			'# Scaffolded in Theatre Studio from assets/data/publications.json, entry',
			'#   "' + oneLine(pub.id) + '".',
			'# The title and authors above are copied verbatim. Copy @cite (authors, year, venue) verbatim from the',
			'# publication list too, never upgraded. Coauthors are credited in @authors and never voiced.',
			'# Every figure goes in a @fact line with a ^§ chip; @verify stays until each one is checked.',
			hasPdf
				? '# The PDF of this paper is in the repo: draft only from its text.'
				: '# This entry has no PDF in the repo: until you paste the paper\'s text, the story ships\n#   as @status embargo with @withheld at the result (stories/README.md, Status lifecycle).',
			'# Declare the other roles the story needs here (stories/README.md, Cast).',
			''
		);
		CHAPTERS.forEach(function (c, i) {
			L.push(
				'# chapter ' + (i + 1) + ': ' + c[0],
				'# ' + c[1],
				'# from: paste a sentence of the paper here, then write the line under it',
				''
			);
		});
		return L.join('\n');
	}

	/* ---------------------------------------------------------------- post */

	// meta: {slug, title, date, summary, file} (an entry of blog/index.json); markdown: the body (ToyKit.post().markdown)
	function postScaffold(meta, markdown, opts) {
		opts = opts || {};
		if (!meta || !meta.slug) throw new Error('The post has no slug.');
		var post = { slug: String(meta.slug), title: oneLine(meta.title || meta.slug), date: meta.date || '', summary: oneLine(meta.summary || ''), file: meta.file || '' };
		var blocks = blogBlocks(markdown || '');
		var normTitle = post.title.toLowerCase();
		var casts = [JACK, '@cast You player hue=120'];
		var castNames = { jack: 1, you: 1 };
		var body = [], para = 0, needPage = false;

		blocks.forEach(function (block, b) {
			var rawLines = block.split('\n').filter(function (l) { return l.trim(); });
			if (!rawLines.length) return;
			para = b + 1;
			var chip = ' ^¶' + para;
			var first = rawLines[0].trim();
			function fromLines() { return rawLines.map(function (l) { return commentFrom('from:', l.trim()); }); }

			if (/^#{1,6}\s/.test(first)) {
				var h = inlineToVn(first.replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, ''));
				body.push('');
				body.push.apply(body, fromLines());
				if (h && h.toLowerCase() !== normTitle) body.push('@scene ' + h);
				var rest = inlineToVn(rawLines.slice(1).join(' '));
				if (rest) body.push(wrapLine(rest + chip));
				return;
			}
			var im = /^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)\s*$/.exec(first);
			if (im && rawLines.length === 1) {
				body.push('');
				body.push.apply(body, fromLines());
				body.push('# TODO ¶' + para + ' is an image (' + im[2] + '); v1 has no @img. Describe it in narration or drop it.');
				return;
			}
			if (/^>/.test(first)) {
				var q = inlineToVn(rawLines.map(function (l) { return l.replace(/^\s*>\s?/, ''); }).join(' '));
				if (!q) return;
				needPage = true;
				body.push('');
				body.push.apply(body, fromLines());
				body.push('@show Page center', wrapLine('Page: ' + q + chip), '@hide Page');
				return;
			}
			if (LIST_RE.test(first)) {
				var items = [];
				rawLines.forEach(function (l) {
					var top = /^([-*+]|\d+[.)])\s+(.*)$/.exec(l);
					if (top && !/^\s/.test(l)) items.push([top[2]]);
					else if (items.length) items[items.length - 1].push(l.replace(/^\s*([-*+]|\d+[.)])\s+/, '').trim());
					else items.push([l.trim()]);
				});
				var texts = items.map(function (it) {
					return it.map(function (x) { return inlineToVn(x.replace(/^\[[ xX]\]\s*/, '')); })
						.filter(Boolean)
						.map(function (x) { return /[.!?:;,)]$/.test(x) ? x : x + '.'; })
						.join(' ');
				}).filter(Boolean);
				if (!texts.length) return;
				body.push('');
				body.push.apply(body, fromLines());
				if (texts.length > 1) body.push('# TODO ¶' + para + ' is a list of ' + texts.length + ' items; @read would make a (once) hub menu of it. Consider one here.');
				texts.forEach(function (t) { body.push(wrapLine(t + chip)); });
				return;
			}
			if (/^\|/.test(first)) {
				var cells = rawLines
					.filter(function (l) { return !/^\|[\s:|-]+\|$/.test(l.trim()); })
					.map(function (l) { return l.trim().replace(/^\||\|$/g, '').split('|').map(inlineToVn).filter(Boolean).join(', '); })
					.filter(Boolean).join(' ');
				if (cells) { body.push(''); body.push.apply(body, fromLines()); body.push(wrapLine(cells + chip)); }
				return;
			}
			if (b === 0 && rawLines.length === 2 && /^["“«]/.test(first) && !/[.!?]$/.test(rawLines[1].trim())) {
				var attribution = inlineToVn(rawLines[1]);
				var who = attribution.split(/[,(—–-]/)[0].trim();
				var token = (who.split(/\s+/).pop() || 'Epigraph').replace(/[^A-Za-z0-9_]/g, '') || 'Epigraph';
				if (castNames[token.toLowerCase()]) token = 'Epigraph';
				castNames[token.toLowerCase()] = 1;
				casts.push('@cast ' + token + ' page name="' + who.replace(/"/g, "'") + '"');
				body.push('');
				body.push.apply(body, fromLines());
				body.push('@show ' + token + ' center', wrapLine(token + ': ' + inlineToVn(first) + chip), wrapLine(attribution + chip), '@hide ' + token);
				return;
			}
			var text = inlineToVn(rawLines.join(' '));
			if (text) { body.push(''); body.push.apply(body, fromLines()); body.push(wrapLine(text + chip)); }
		});
		if (needPage && !castNames.page) casts.push('@cast Page page');

		var L = [
			'@title ' + post.title,
			'@kind blog',
			'@source blog:' + post.slug,
			'@link ../../#/post/' + post.slug + ' Read the post',
			'@status draft',
			'@palette paper'
		].concat(casts, [
			'',
			'# Scaffolded in Theatre Studio from the published post "' + post.slug + '" on ' + isoDay(opts.date) + ',',
			'# the way scripts/build-vn-index.mjs --scaffold-post does' + (post.file ? ' (blog/posts/' + post.file + (post.date ? ', ' + post.date : '') + ')' : '') + '.',
			'# Every paragraph is a narration line with a ^¶n chip (n counts the post\'s',
			'# blocks the way @read does: headings included, code fences dropped); "# from:"',
			'# keeps the original sentence so rewrites can be checked against the post. Replace',
			'# narration with speakers (Jack:, You:), add @bg/@show, and give the reader',
			'# one choice whose branches hold reactions, then reconverge (== label).',
			'# Remove @status draft only after a read-through; keep every ^¶ chip honest.',
			'',
			'@bg paper',
			'@thumb'
		]);
		if (post.summary) L.push(commentFrom('summary:', post.summary));
		L = L.concat(body, ['', '@end', '']);
		return { text: L.join('\n'), paragraphs: para };
	}

	/* ---------------------------------------------------------------- helpers for files.js */

	// a short draft name for a publication: the part of the title before a colon or question mark, at most 80 characters (the toolbar's Rename allows 80)
	function paperDraftName(pub) {
		var t = oneLine(pub && pub.title);
		var head = t.split(/[:?]/)[0].trim() || t;
		return head.length > 80 ? head.slice(0, 80).replace(/\s+\S*$/, '') : head;
	}

	// FNV-1a over UTF-16 code units, as 8 hex digits: enough to tell "same text as on disk" from "changed"
	function hash(text) {
		var s = String(text == null ? '' : text), h = 0x811c9dc5;
		for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
		return ('0000000' + h.toString(16)).slice(-8);
	}

	// UTF-8 byte length without TextEncoder
	function byteLength(text) {
		var s = String(text == null ? '' : text), n = 0;
		for (var i = 0; i < s.length; i++) {
			var c = s.charCodeAt(i);
			if (c < 0x80) n += 1;
			else if (c < 0x800) n += 2;
			else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++; }
			else n += 3;
		}
		return n;
	}

	function formatBytes(n) {
		n = +n || 0;
		if (n < 1000) return n + ' B';
		if (n < 1e6) return (n / 1000).toFixed(n < 1e4 ? 1 : 0) + ' kB';
		return (n / 1e6).toFixed(1) + ' MB';
	}

	// "just now", "5 min ago", "3 h ago", "yesterday", else the date; "" when unknown
	function relTime(ts, now) {
		ts = +ts; now = now == null ? Date.now() : +now;
		if (!ts) return '';
		var s = Math.max(0, Math.round((now - ts) / 1000));
		if (s < 45) return 'just now';
		var m = Math.round(s / 60);
		if (m < 60) return m + ' min ago';
		var h = Math.round(m / 60);
		if (h < 24) return h + ' h ago';
		var d = new Date(ts), n = new Date(now);
		var y = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
		if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()) return 'yesterday';
		return isoDay(d);
	}

	// a safe file name for a draft: "<name>.vn"
	function fileName(name) {
		var base = String(name == null ? '' : name).replace(/\.vn$/i, '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
		return (base.slice(0, 80) || 'draft') + '.vn';
	}

	// the .vn files of a folder listing, sorted, underscore files (like _demo-effects.vn) last
	function vnFiles(names) {
		return (names || []).filter(function (n) { return typeof n === 'string' && /\.vn$/i.test(n); }).sort(function (a, b) {
			var ua = a.charAt(0) === '_', ub = b.charAt(0) === '_';
			return ua !== ub ? (ua ? 1 : -1) : a.localeCompare(b);
		});
	}

	// the state of a draft against its file: 'none' (never written to disk), 'saved', 'changed'
	function diskState(link, text) {
		if (!link || !link.hash) return 'none';
		return link.hash === hash(text) ? 'saved' : 'changed';
	}

	return {
		JACK_CAST: JACK,
		CHAPTERS: CHAPTERS,
		paperScaffold: paperScaffold,
		postScaffold: postScaffold,
		paperDraftName: paperDraftName,
		blogBlocks: blogBlocks,
		inlineToVn: inlineToVn,
		wrapLine: wrapLine,
		commentFrom: commentFrom,
		isoDay: isoDay,
		hash: hash,
		byteLength: byteLength,
		formatBytes: formatBytes,
		relTime: relTime,
		fileName: fileName,
		vnFiles: vnFiles,
		diskState: diskState
	};
});
