// Static Markdown rendering using the site's pinned, already-vendored Marked.
// Raw HTML is excluded. All output-bearing URLs are resolved and allowlisted;
// everything else is emitted by Marked's escaping Markdown renderer.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const marked = require('../desk/vendor/marked/marked.min.js');
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', nbsp: ' ', ndash: '–', mdash: '—', hellip: '…' };

export function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function plainText(html) {
	return String(html).replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name) => {
		if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? entity;
		const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
		return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
	});
}

// Preserve literal examples in fenced/inline code while removing author-hidden
// comments before a list tokenizer can escape a comment's closing marker.
export function stripHiddenComments(markdown) {
	let comment = false;
	let fence = '';
	let fenceLength = 0;
	let codeSpan = 0;
	return markdown.split('\n').map((line) => {
		const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
		if (!comment && !codeSpan && marker) {
			if (!fence) { fence = marker[1][0]; fenceLength = marker[1].length; return line; }
			if (marker[1][0] === fence && marker[1].length >= fenceLength && !marker[2].trim()) { fence = ''; return line; }
		}
		if (fence) return line;
		let output = '';
		for (let i = 0; i < line.length;) {
			if (comment) {
				const end = line.indexOf('-->', i);
				if (end === -1) break;
				comment = false;
				i = end + 3;
			} else if (line[i] === '`') {
				const start = i;
				while (line[i] === '`') i++;
				const length = i - start;
				if (!codeSpan) codeSpan = length;
				else if (codeSpan === length) codeSpan = 0;
				output += line.slice(start, i);
			} else if (!codeSpan && line.slice(i, i + 4) === '<!--') {
				comment = true;
				i += 4;
			} else output += line[i++];
		}
		return output;
	}).join('\n');
}

export function headingSlug(text) {
	return String(text).toLowerCase().trim().replace(/[^\w\u3040-\u30ff\u3400-\u9fff]+/g, '-').replace(/^-|-$/g, '') || 'section';
}

export function renderMarkdown(markdown, { slug, title, siteUrl, publishedSlugs }) {
	const headings = [];
	const used = new Set();
	const aliases = new Map();
	const internalLinks = [];
	const renderer = new marked.Renderer();
	const baseUrl = new URL(siteUrl);
	function safeUrl(href, image = false) {
		try {
			if (!image && /^#[^/]/.test(href)) return href;
			const url = new URL(plainText(href), baseUrl);
			if (!(image ? ['http:', 'https:'] : ['http:', 'https:', 'mailto:']).includes(url.protocol)) return null;
			if (url.origin !== baseUrl.origin) return url.href;
			const post = /^#\/post\/([^?]+)(?:\?(.*))?$/.exec(url.hash);
			if (post && publishedSlugs.has(decodeURIComponent(post[1]))) {
				const section = new URLSearchParams(post[2] || '').get('section');
				return '/writing/' + encodeURIComponent(decodeURIComponent(post[1])) + '/' + (section ? '#' + encodeURIComponent(section) : '');
			}
			return url.pathname + url.search + url.hash;
		} catch { return null; }
	}
	renderer.html = () => '';
	renderer.link = (href, linkTitle, text) => {
		const url = safeUrl(href);
		if (!url) return text;
		const marker = /^#[^/]/.test(url) ? 'article-local-' + internalLinks.push(url.slice(1)) : url;
		return '<a href="' + escapeHtml(marker) + '"' + (linkTitle ? ' title="' + escapeHtml(plainText(linkTitle)) + '"' : '') + '>' + text + '</a>';
	};
	renderer.image = (href, imageTitle, text) => {
		const url = safeUrl(href, true);
		return url ? '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(plainText(text)) + '"' + (imageTitle ? ' title="' + escapeHtml(plainText(imageTitle)) + '"' : '') + ' loading="lazy" decoding="async">' : escapeHtml(plainText(text));
	};
	renderer.heading = (html, level) => {
		const text = plainText(html);
		const key = headingSlug(text);
		const base = 'post-' + headingSlug(slug) + '-' + key;
		let id = base;
		let suffix = 2;
		while (used.has(id)) id = base + '-' + suffix++;
		used.add(id);
		if (!aliases.has(key)) aliases.set(key, id);
		headings.push({ id, text, level });
		return '<h' + level + ' id="' + id + '" tabindex="-1">' + html + '<a class="article-heading-link" href="#' + id + '" aria-label="' + escapeHtml('Link to ' + text) + '">#</a></h' + level + '>\n';
	};
	const table = renderer.table.bind(renderer);
	renderer.table = (header, body) => '<div class="article-table">' + table(header, body) + '</div>\n';
	const tokens = marked.lexer(stripHiddenComments(markdown), { gfm: true, breaks: false });
	const first = tokens.findIndex((token) => token.type !== 'space');
	if (first !== -1 && tokens[first].type === 'heading' && tokens[first].depth === 1 && plainText(tokens[first].text).trim().toLowerCase() === title.trim().toLowerCase()) tokens.splice(first, 1);
	let html = marked.parser(tokens, { renderer, gfm: true, breaks: false });
	internalLinks.forEach((target, i) => {
		let decoded = target;
		try { decoded = decodeURIComponent(target); } catch { /* Keep the literal fragment. */ }
		const id = aliases.get(decoded) || decoded;
		html = html.replace('href="article-local-' + (i + 1) + '"', 'href="#' + escapeHtml(encodeURIComponent(id)) + '"');
	});
	return { html, headings, text: plainText(html).replace(/\s+/g, ' ').trim() };
}
