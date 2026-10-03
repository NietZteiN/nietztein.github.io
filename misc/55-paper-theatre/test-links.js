// Link-consistency check for Paper Theatre (ENGINE-DESIGN.md sections 8-9).
//
// The "Play the visual novel" links in index.html are static HTML, so this
// check keeps them honest against each story's @status:
//   - every paper story with @status published has an <a class="pub-play">
//     whose ?story=<id> matches, and that link sits inside the .pub-block
//     whose title contains the story's "@source paper:" substring;
//   - no draft or embargo story has a pub-play link;
//   - no pub-play link points at a story that does not exist.
// Blog stories are never required to have a link (blog markup is left alone).
//
// Run alone:   "C:\Program Files\nodejs\node.exe" misc/55-paper-theatre/test-links.js
// From test.js: require('./test-links.js').run() returns true when clean.

(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.VNLinkCheck = factory();
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	var fs = typeof require === 'function' ? require('fs') : null;
	var path = typeof require === 'function' ? require('path') : null;

	// Same trailing-chip grammar as vn.js.
	var CHIP_RE = /\s*\^(§[\w.\-:]+|p\.\s?[\w.\-]+|¶\d+|para)\s*$/;

	function logicalLines(text) {
		var raw = text.replace(/^\uFEFF/, '').split(/\r?\n/);
		var out = [];
		for (var i = 0; i < raw.length; i++) {
			var line = raw[i];
			if (!line.trim() || /^\s*#/.test(line)) continue;
			if (/^[ \t]/.test(line) && out.length) {
				out[out.length - 1] += ' ' + line.trim();
				continue;
			}
			out.push(line.trim());
		}
		return out;
	}

	// Only the header fields the check needs.
	function readHeader(text) {
		var h = { kind: '', status: 'draft', source: '', title: '' };
		logicalLines(text).forEach(function (l) {
			var m = /^@(kind|status|source|title)\s+(.*)$/.exec(l);
			if (!m) return;
			var v = m[2].replace(CHIP_RE, '').trim();
			if (m[1] === 'kind' || m[1] === 'status') v = v.toLowerCase();
			h[m[1]] = v;
		});
		if (!/^(draft|embargo|published)$/.test(h.status)) h.status = 'draft';
		return h;
	}

	function decodeEntities(s) {
		return s
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&nbsp;/g, ' ');
	}

	function textOf(html) {
		return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
	}

	// Splits index.html into .pub-block chunks: [{ title, playIds[], anchors[] }].
	function pubBlocks(html) {
		var parts = html.split(/<div class="pub-block[^"]*">/);
		var blocks = [];
		for (var i = 1; i < parts.length; i++) {
			var chunk = parts[i];
			var tm = /<div class="[^"]*\bh5\b[^"]*">([\s\S]*?)<\/div>/.exec(chunk);
			blocks.push({
				title: tm ? textOf(tm[1]) : '',
				anchors: playAnchors(chunk),
			});
		}
		return blocks;
	}

	// Every <a ... class="...pub-play..."> tag with its ?story= id.
	function playAnchors(html) {
		var out = [];
		var re = /<a\b[^>]*>/g;
		var m;
		while ((m = re.exec(html))) {
			var tag = m[0];
			var cm = /class="([^"]*)"/.exec(tag);
			if (!cm || !/\bpub-play\b/.test(cm[1])) continue;
			var hm = /href="([^"]*)"/.exec(tag);
			var href = hm ? decodeEntities(hm[1]) : '';
			var im = /[?&]story=([^&#"]+)/.exec(href);
			out.push({
				tag: tag,
				href: href,
				id: im ? decodeURIComponent(im[1]) : '',
				newTab: /target="_blank"/.test(tag) && /rel="[^"]*noopener/.test(tag),
			});
		}
		return out;
	}

	function run(opts) {
		opts = opts || {};
		var dir = opts.storiesDir || path.join(__dirname, 'stories');
		var indexHtml = opts.indexHtml || path.join(__dirname, '..', '..', 'index.html');
		var log = opts.log || console.log;
		var failures = [];
		var warnings = [];

		if (!fs.existsSync(indexHtml)) {
			failures.push('index.html not found at ' + indexHtml);
			return report(failures, warnings, log);
		}
		var html = fs.readFileSync(indexHtml, 'utf8');
		var blocks = pubBlocks(html);
		var anchors = playAnchors(html);

		var stories = {};
		if (fs.existsSync(dir)) {
			fs.readdirSync(dir)
				.filter(function (f) {
					return /\.vn$/i.test(f) && f.charAt(0) !== '_';
				})
				.sort()
				.forEach(function (f) {
					var id = f.replace(/\.vn$/i, '');
					stories[id] = readHeader(fs.readFileSync(path.join(dir, f), 'utf8'));
				});
		}

		var linked = {};
		anchors.forEach(function (a) {
			if (!a.id) {
				failures.push('pub-play link without ?story=<id>: ' + a.href);
				return;
			}
			linked[a.id] = (linked[a.id] || 0) + 1;
			if (!a.newTab) warnings.push('pub-play link for "' + a.id + '" should open in a new tab (target="_blank" rel="noopener")');
			if (!stories[a.id]) {
				failures.push('pub-play link points at "' + a.id + '" but stories/' + a.id + '.vn does not exist');
			} else if (stories[a.id].status !== 'published') {
				failures.push('pub-play link for "' + a.id + '" but its @status is ' + stories[a.id].status + ' (only published stories may be linked)');
			}
		});

		Object.keys(stories).forEach(function (id) {
			var s = stories[id];
			if (s.status !== 'published') return;
			if (s.kind !== 'paper') return;
			var count = linked[id] || 0;
			if (count === 0) {
				failures.push('published paper story "' + id + '" has no <a class="pub-play" href="misc/55-paper-theatre/?story=' + id + '"> in index.html');
				return;
			}
			if (count > 1) warnings.push('story "' + id + '" has ' + count + ' pub-play links');
			var sm = /^paper:\s*(.+)$/i.exec(s.source);
			if (!sm) {
				warnings.push('published paper story "' + id + '" has no "@source paper:<title substring>", so its link cannot be matched to a .pub-block');
				return;
			}
			var needle = sm[1].replace(/\s+/g, ' ').trim().toLowerCase();
			var home = blocks.filter(function (b) {
				return b.title.toLowerCase().indexOf(needle) !== -1;
			});
			if (!home.length) {
				failures.push('"' + id + '": @source paper substring "' + sm[1] + '" matches no .pub-block title in index.html');
				return;
			}
			var inHome = home.some(function (b) {
				return b.anchors.some(function (a) {
					return a.id === id;
				});
			});
			if (!inHome) failures.push('"' + id + '": its pub-play link is not inside the .pub-block titled "' + home[0].title + '"');
		});

		return report(failures, warnings, log, Object.keys(stories).length, anchors.length);
	}

	function report(failures, warnings, log, nStories, nLinks) {
		warnings.forEach(function (w) {
			log('  warn  ' + w);
		});
		failures.forEach(function (f) {
			log('  FAIL  ' + f);
		});
		var ok = failures.length === 0;
		log(
			(ok ? 'ok' : 'FAILED') +
				'  pub-play links: ' +
				(nStories || 0) +
				' stor' +
				(nStories === 1 ? 'y' : 'ies') +
				', ' +
				(nLinks || 0) +
				' link' +
				(nLinks === 1 ? '' : 's') +
				', ' +
				failures.length +
				' failure' +
				(failures.length === 1 ? '' : 's') +
				', ' +
				warnings.length +
				' warning' +
				(warnings.length === 1 ? '' : 's')
		);
		return ok;
	}

	var api = { run: run, readHeader: readHeader, pubBlocks: pubBlocks, playAnchors: playAnchors };

	if (typeof require === 'function' && typeof module === 'object' && require.main === module) {
		process.exitCode = run() ? 0 : 1;
	}

	return api;
});
