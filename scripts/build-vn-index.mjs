// Builds misc/55-paper-theatre/stories/index.json from the .vn script headers,
// and scaffolds new .vn drafts from a blog post or a paper abstract.
//
// Zero dependencies. Run with the full Node path on this machine:
//   "C:\Program Files\nodejs\node.exe" scripts/build-vn-index.mjs
//
// Subcommands:
//   (none)                               regenerate stories/index.json
//   --dry-run                            print the manifest instead of writing it
//   --scaffold-post <slug>               write stories/blog-<slug>.vn from blog/posts
//   --scaffold-paper <id> --title "..." [--abstract file.txt]
//                                        write stories/<id>.vn (seven-beat embargo skeleton)
//
// The scaffolders never overwrite an existing .vn. The default command is also
// run by .github/workflows/build-blog.yml on every push touching stories/**.
//
// Manifest shape (ENGINE-DESIGN.md section 6), one object per top-level .vn:
//   { id, file, title, kind, status, source, pub, slug, date, arxiv, links,
//     authors, blurb, verify, withheld, chips }
// Papers come first in index.html .pub-block order, then blog stories by date
// descending. Output is LF, two-space JSON, trailing newline.

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, '..');
const theatreDir = join(root, 'misc', '55-paper-theatre');
const storiesDir = join(theatreDir, 'stories');
const outFile = join(storiesDir, 'index.json');
const indexHtml = join(root, 'index.html');
const blogIndex = join(root, 'blog', 'index.json');
const postsDir = join(root, 'blog', 'posts');

// Same trailing-chip grammar as vn.js: one chip, at the end of the line.
const CHIP_RE = /\s*\^(§[\w.\-:]+|p\.\s?[\w.\-]+|¶\d+|para)\s*$/;
const LIST_RE = /^([-*+]|\d+[.)])\s+/;

// ---- .vn header parsing -----------------------------------------------------

// Splits a script into logical lines: indented lines continue the previous
// one (joined with a space), comments and blank lines are dropped. Each entry
// is { text, line } with the 1-based line number of its first physical line.
function logicalLines(text) {
	const raw = text.replace(/^\uFEFF/, '').split(/\r?\n/);
	const out = [];
	for (let i = 0; i < raw.length; i++) {
		const line = raw[i];
		if (!line.trim()) continue;
		if (/^\s*#/.test(line)) continue;
		if (/^[ \t]/.test(line) && out.length) {
			out[out.length - 1].text += ' ' + line.trim();
			continue;
		}
		out.push({ text: line.trim(), line: i + 1 });
	}
	return out;
}

// Reads only the @fact lines of a file (for @include).
function readFacts(file) {
	const facts = {};
	if (!existsSync(file)) return facts;
	for (const { text } of logicalLines(readFileSync(file, 'utf8'))) {
		const m = /^@fact\s+([A-Za-z_][\w-]*)\s*=\s*(.*)$/.exec(text);
		if (!m) continue;
		facts[m[1]] = m[2].replace(CHIP_RE, '').trim();
	}
	return facts;
}

// Parses the header directives plus just enough of the body for the manifest:
// the first text line in file order (blurb) and the number of citation chips.
function parseStory(file) {
	const text = readFileSync(file, 'utf8');
	const meta = {
		title: '',
		kind: '',
		source: '',
		cite: '',
		arxiv: '',
		links: [],
		authors: '',
		status: '',
		verify: false,
		withheld: false,
		includes: [],
		facts: {},
	};
	const cast = new Set();
	let blurbLine = '';
	let firstSay = '';
	let chips = 0;

	const lines = logicalLines(text);

	// Directives and facts first, so {key} interpolation below can see them.
	for (const { text: l } of lines) {
		if (!l.startsWith('@')) continue;
		const sp = l.search(/\s/);
		const name = (sp === -1 ? l : l.slice(0, sp)).slice(1).toLowerCase();
		const arg = sp === -1 ? '' : l.slice(sp + 1).trim();
		switch (name) {
			case 'title': meta.title = arg; break;
			case 'kind': meta.kind = arg.toLowerCase(); break;
			case 'source': meta.source = arg; break;
			case 'cite': meta.cite = arg; break;
			case 'arxiv': meta.arxiv = arg.replace(/^arxiv:/i, ''); break;
			case 'link': {
				const parts = arg.split(/\s+/);
				if (parts[0] && meta.links.length < 2) meta.links.push(parts[0]);
				break;
			}
			case 'authors': meta.authors = arg; break;
			case 'status': meta.status = arg.toLowerCase(); break;
			case 'verify': meta.verify = true; break;
			case 'withheld': meta.withheld = true; break;
			case 'include': {
				meta.includes.push(arg);
				Object.assign(meta.facts, readFacts(join(dirname(file), arg)));
				break;
			}
			case 'fact': {
				const m = /^([A-Za-z_][\w-]*)\s*=\s*(.*)$/.exec(arg);
				if (m) meta.facts[m[1]] = m[2].replace(CHIP_RE, '').trim();
				break;
			}
			case 'cast': {
				const nm = arg.split(/\s+/)[0];
				if (nm) cast.add(nm.toLowerCase());
				break;
			}
			default: break;
		}
	}

	const factKeys = Object.keys(meta.facts);
	const factRe = factKeys.length
		? new RegExp('\\{(' + factKeys.map((k) => k.replace(/[-]/g, '\\-')).join('|') + ')\\}', 'g')
		: null;

	function countChips(s) {
		let n = CHIP_RE.test(s) ? 1 : 0;
		if (factRe) n += (s.match(factRe) || []).length;
		return n;
	}

	// "chips" counts chipped lines (ops with at least one ref), the same number
	// test.js asserts with VN.refs(op): a line with a trailing ^§ chip or any
	// {fact} counts once, however many figures it carries.
	for (const { text: l } of lines) {
		if (l.startsWith('@')) {
			// Boards carry figures too (@card / @chart / @code cells).
			if (/^@(card|chart|code)\b/i.test(l) && countChips(l)) chips += 1;
			continue;
		}
		if (/^(==|\*|->)/.test(l)) continue;
		const sp = /^([^\s:]+(?:\s*\([a-z]+\))?)\s*:\s*(.*)$/.exec(l);
		const speaker = sp ? sp[1].replace(/\s*\([a-z]+\)$/, '').toLowerCase() : '';
		if (sp && cast.has(speaker)) {
			if (countChips(sp[2])) chips += 1;
			if (!firstSay) firstSay = sp[2];
			continue;
		}
		if (countChips(l)) chips += 1;
		// The blurb is the first text line in file order: a narration line, or the
		// first speaker line when someone speaks before any narration.
		if (!blurbLine && !firstSay) blurbLine = l;
	}

	const blurbSrc = blurbLine || firstSay || '';
	return { meta, blurb: makeBlurb(blurbSrc, meta.facts), chips };
}

function makeBlurb(s, facts) {
	let t = s
		.replace(CHIP_RE, '')
		.replace(/\{([A-Za-z_][\w-]*)\}/g, (m, k) => (facts && k in facts ? facts[k] : m))
		.replace(/`([^`]*)`/g, '$1')
		.replace(/\*([^*]+)\*/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
	if (t.length <= 140) return t;
	t = t.slice(0, 139);
	const cut = t.lastIndexOf(' ');
	if (cut > 80) t = t.slice(0, cut);
	return t.replace(/[,;:\s]+$/, '') + '…';
}

// ---- index.html publication order ------------------------------------------

function decodeEntities(s) {
	return s
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ');
}

function normTitle(s) {
	return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().toLowerCase();
}

// Every .pub-block title (the .h5 line) in document order; press blocks count
// too, which is how the ETO Map of Science story finds its slot.
export function pubTitles(html) {
	const re = /<div class="pub-block[^"]*">\s*<div class="[^"]*\bh5\b[^"]*">([\s\S]*?)<\/div>/g;
	const out = [];
	let m;
	while ((m = re.exec(html))) out.push(normTitle(m[1]));
	return out;
}

function pubOrder(titles, source) {
	const m = /^paper:\s*(.+)$/i.exec(source || '');
	if (!m) return { index: -1, pub: '' };
	const needle = m[1].replace(/\s+/g, ' ').trim();
	const key = needle.toLowerCase();
	const index = titles.findIndex((t) => t.includes(key));
	return { index, pub: needle };
}

// ---- default command: build the manifest ----------------------------------

function loadBlogDates() {
	const dates = {};
	if (existsSync(blogIndex)) {
		try {
			for (const p of JSON.parse(readFileSync(blogIndex, 'utf8'))) {
				if (p && p.slug) dates[p.slug] = p.date || '';
			}
		} catch (e) {
			/* unreadable index: fall back to file names below */
		}
	}
	if (existsSync(postsDir)) {
		for (const f of readdirSync(postsDir)) {
			const m = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/i.exec(f);
			if (m && !(m[2] in dates)) dates[m[2]] = m[1];
		}
	}
	return dates;
}

export function buildManifest() {
	if (!existsSync(storiesDir)) mkdirSync(storiesDir, { recursive: true });
	const files = readdirSync(storiesDir)
		.filter((f) => /\.vn$/i.test(f) && !f.startsWith('_'))
		.sort();
	const titles = existsSync(indexHtml) ? pubTitles(readFileSync(indexHtml, 'utf8')) : [];
	const dates = loadBlogDates();

	const entries = files.map((file, fileIndex) => {
		const { meta, blurb, chips } = parseStory(join(storiesDir, file));
		const id = file.replace(/\.vn$/i, '');
		const kind = meta.kind === 'blog' ? 'blog' : 'paper';
		const status = /^(draft|embargo|published)$/.test(meta.status) ? meta.status : 'draft';
		const entry = {
			id,
			file,
			title: meta.title || id,
			kind,
			status,
			source: meta.source,
		};
		let order = fileIndex;
		if (kind === 'blog') {
			const sm = /^blog:\s*(\S+)/i.exec(meta.source || '');
			if (sm) {
				entry.slug = sm[1];
				if (dates[sm[1]]) entry.date = dates[sm[1]];
			}
		} else {
			const po = pubOrder(titles, meta.source);
			if (po.pub) entry.pub = po.pub;
			order = po.index === -1 ? titles.length + fileIndex : po.index;
		}
		if (meta.arxiv) entry.arxiv = meta.arxiv;
		if (meta.links.length) entry.links = meta.links;
		if (meta.authors) entry.authors = meta.authors;
		entry.blurb = blurb;
		if (meta.verify) entry.verify = true;
		if (meta.withheld) entry.withheld = true;
		entry.chips = chips;
		return { entry, order, fileIndex };
	});

	const papers = entries.filter((e) => e.entry.kind === 'paper').sort((a, b) => a.order - b.order || a.fileIndex - b.fileIndex);
	const blogs = entries
		.filter((e) => e.entry.kind === 'blog')
		.sort((a, b) => (b.entry.date || '').localeCompare(a.entry.date || '') || a.fileIndex - b.fileIndex);
	return papers.concat(blogs).map((e) => e.entry);
}

function build(dryRun) {
	const manifest = buildManifest();
	const json = JSON.stringify(manifest, null, 2) + '\n';
	if (dryRun) {
		process.stdout.write(json);
		return;
	}
	writeFileSync(outFile, json);
	console.log(`Wrote ${manifest.length} stor${manifest.length === 1 ? 'y' : 'ies'} to misc/55-paper-theatre/stories/index.json`);
}

// ---- shared scaffold helpers ----------------------------------------------

function today() {
	const d = new Date();
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function refuseIfExists(file) {
	if (existsSync(file)) {
		console.error(`Refusing to overwrite ${file}. Delete or rename it first.`);
		process.exit(1);
	}
}

// Wrap text onto a first line plus two-space continuation lines (the DSL joins
// indented lines with a space), so scaffolds stay readable in an editor.
function wrapLine(text, width = 100) {
	const words = text.split(/\s+/).filter(Boolean);
	const lines = [];
	let cur = '';
	for (const w of words) {
		if (cur && (cur + ' ' + w).length > width) {
			lines.push(cur);
			cur = w;
		} else {
			cur = cur ? cur + ' ' + w : w;
		}
	}
	if (cur) lines.push(cur);
	return lines.map((l, i) => (i === 0 ? l : '  ' + l)).join('\n');
}

function commentFrom(label, text, width = 100) {
	const words = text.split(/\s+/).filter(Boolean);
	const lines = [];
	let cur = '';
	for (const w of words) {
		if (cur && (cur + ' ' + w).length > width) {
			lines.push(cur);
			cur = w;
		} else {
			cur = cur ? cur + ' ' + w : w;
		}
	}
	if (cur) lines.push(cur);
	return lines.map((l, i) => (i === 0 ? `# ${label} ${l}` : `#   ${l}`)).join('\n');
}

function splitSentences(text) {
	return text
		.replace(/\s+/g, ' ')
		.trim()
		.split(/(?<=[.!?]["”’)]?)\s+(?=["“(]?[A-Z0-9])/)
		.map((s) => s.trim())
		.filter(Boolean);
}

// Inline Markdown -> .vn inline markup (*em*, `code` survive; links keep text).
function inlineToVn(s) {
	return decodeEntities(
		s
			.replace(/<[^>\n]+>/g, '')
			.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
			.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
			.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
			.replace(/(\*\*|__)([\s\S]*?)\1/g, '$2')
			.replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1*$2*')
			.replace(/~~([^~]*)~~/g, '$1')
			.replace(/[{}]/g, (c) => (c === '{' ? '(' : ')'))
	)
		.replace(/\s+/g, ' ')
		.trim();
}

// ---- --scaffold-post <slug> --------------------------------------------------

function parseFrontMatter(text) {
	const fm = {};
	const m = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/.exec(text);
	if (!m) return { fm, body: text };
	for (const line of m[1].split(/\r?\n/)) {
		const idx = line.indexOf(':');
		if (idx === -1) continue;
		fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
	}
	return { fm, body: text.slice(m[0].length) };
}

function findPost(slug) {
	let entry = null;
	if (existsSync(blogIndex)) {
		try {
			entry = JSON.parse(readFileSync(blogIndex, 'utf8')).find((p) => p && p.slug === slug) || null;
		} catch (e) {
			entry = null;
		}
	}
	let file = entry && entry.file ? join(postsDir, entry.file) : '';
	if (!file || !existsSync(file)) {
		const cand = existsSync(postsDir)
			? readdirSync(postsDir).find((f) => f.replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, '') === slug)
			: null;
		if (!cand) return null;
		file = join(postsDir, cand);
	}
	const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
	const { fm, body } = parseFrontMatter(text);
	return {
		slug,
		file: basename(file),
		title: (entry && entry.title) || fm.title || slug,
		date: (entry && entry.date) || fm.date || (basename(file).match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || '',
		summary: (entry && entry.summary) || fm.summary || '',
		body,
	};
}

// Mirrors VN.blog() in vn.js so the ^¶n chips a scaffold writes are the same
// numbers the engine assigns under @read: blocks are blank-line separated
// after dropping HTML comments, fenced code, link definitions and rules;
// loose list items merge into one block; headings count as blocks; ¶n = b+1.
function blogBlocks(body) {
	let s = body.replace(/\r/g, '');
	s = s.replace(/<!--[\s\S]*?-->/g, '');
	s = s.replace(/```[\s\S]*?```/g, '');
	s = s.replace(/^[ \t]*\[[^\]]+\]:[ \t]*\S+.*$/gm, '');
	s = s.replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, '');
	const blocks = [];
	for (const blk of s.split(/\n[ \t]*\n+/)) {
		const prev = blocks.length ? blocks[blocks.length - 1] : null;
		if (prev !== null && LIST_RE.test(prev) && (LIST_RE.test(blk) || /^[ \t]+\S/.test(blk))) blocks[blocks.length - 1] = prev + '\n' + blk;
		else blocks.push(blk);
	}
	return blocks;
}

function scaffoldPost(slug) {
	const post = findPost(slug);
	if (!post) {
		console.error(`No post with slug "${slug}" in blog/index.json or blog/posts/.`);
		process.exit(1);
	}
	if (!existsSync(storiesDir)) mkdirSync(storiesDir, { recursive: true });
	const out = join(storiesDir, `blog-${slug}.vn`);
	refuseIfExists(out);

	const blocks = blogBlocks(post.body);
	const normTitleText = post.title.trim().toLowerCase();
	const lines = [];
	const casts = ['@cast Jack hue=28 glasses', '@cast You player hue=120'];
	const castNames = new Set(['jack', 'you']);
	const body = [];
	let para = 0;
	let needPage = false;

	blocks.forEach((block, b) => {
		const rawLines = block.split('\n').filter((l) => l.trim());
		if (!rawLines.length) return;
		para = b + 1;
		const chip = ` ^¶${para}`;
		const first = rawLines[0].trim();
		const fromLines = () => rawLines.map((l) => commentFrom('from:', l.trim()));

		// Heading (plus any lines that share its block) -> @scene; the post title is skipped.
		if (/^#{1,6}\s/.test(first)) {
			const h = inlineToVn(first.replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, ''));
			body.push('', ...fromLines());
			if (h && h.toLowerCase() !== normTitleText) body.push(`@scene ${h}`);
			const rest = inlineToVn(rawLines.slice(1).join(' '));
			if (rest) body.push(wrapLine(rest + chip));
			return;
		}

		// Image alone: v1 has no @img.
		const im = /^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)\s*$/.exec(first);
		if (im && rawLines.length === 1) {
			body.push('', ...fromLines(), `# TODO ¶${para} is an image (${im[2]}); v1 has no @img. Describe it in narration or drop it.`);
			return;
		}

		// Blockquote -> the Page speaker, as the engine does under @read.
		if (/^>/.test(first)) {
			const q = inlineToVn(rawLines.map((l) => l.replace(/^\s*>\s?/, '')).join(' '));
			if (!q) return;
			needPage = true;
			body.push('', ...fromLines(), '@show Page center', wrapLine(`Page: ${q}${chip}`), '@hide Page');
			return;
		}

		// List -> one narration line per item (same ¶), with a hub-menu reminder.
		if (LIST_RE.test(first)) {
			const items = [];
			for (const l of rawLines) {
				const top = /^([-*+]|\d+[.)])\s+(.*)$/.exec(l);
				if (top && !/^\s/.test(l)) items.push([top[2]]);
				else if (items.length) items[items.length - 1].push(l.replace(/^\s*([-*+]|\d+[.)])\s+/, '').trim());
				else items.push([l.trim()]);
			}
			const texts = items
				.map((it) =>
					it
						.map((x) => inlineToVn(x.replace(/^\[[ xX]\]\s*/, '')))
						.filter(Boolean)
						.map((x) => (/[.!?:;,)]$/.test(x) ? x : x + '.'))
						.join(' ')
				)
				.filter(Boolean);
			if (!texts.length) return;
			body.push('', ...fromLines());
			if (texts.length > 1) body.push(`# TODO ¶${para} is a list of ${texts.length} items; @read would make a (once) hub menu of it. Consider one here.`);
			texts.forEach((t) => body.push(wrapLine(t + chip)));
			return;
		}

		// Table -> cells joined, one line.
		if (/^\|/.test(first)) {
			const cells = rawLines
				.filter((l) => !/^\|[\s:|-]+\|$/.test(l.trim()))
				.map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inlineToVn(c)).filter(Boolean).join(', '))
				.filter(Boolean)
				.join(' ');
			if (cells) body.push('', ...fromLines(), wrapLine(cells + chip));
			return;
		}

		// Epigraph: quoted first line plus an attribution with no final period -> page speaker.
		if (b === 0 && rawLines.length === 2 && /^["“«]/.test(first) && !/[.!?]$/.test(rawLines[1].trim())) {
			const attribution = inlineToVn(rawLines[1]);
			const who = attribution.split(/[,(—–-]/)[0].trim();
			let token = (who.split(/\s+/).pop() || 'Epigraph').replace(/[^A-Za-z0-9_]/g, '') || 'Epigraph';
			if (castNames.has(token.toLowerCase())) token = 'Epigraph';
			castNames.add(token.toLowerCase());
			casts.push(`@cast ${token} page name="${who.replace(/"/g, "'")}"`);
			body.push(
				'',
				...fromLines(),
				`@show ${token} center`,
				wrapLine(`${token}: ${inlineToVn(first)}${chip}`),
				wrapLine(attribution + chip),
				`@hide ${token}`
			);
			return;
		}

		const text = inlineToVn(rawLines.join(' '));
		if (text) body.push('', ...fromLines(), wrapLine(text + chip));
	});
	if (needPage && !castNames.has('page')) casts.push('@cast Page page');

	lines.push(
		`@title ${post.title}`,
		'@kind blog',
		`@source blog:${post.slug}`,
		`@link ../../#/post/${post.slug} Read the post`,
		'@status draft',
		'@palette paper',
		...casts,
		'',
		`# Scaffolded by scripts/build-vn-index.mjs --scaffold-post ${post.slug} on ${today()}`,
		`# from blog/posts/${post.file}${post.date ? ` (${post.date})` : ''}.`,
		'# Every paragraph is a narration line with a ^¶n chip (n counts the post\'s',
		'# blocks the way @read does: headings included, code fences dropped); "# from:"',
		'# keeps the original sentence so rewrites can be checked against the post. Replace',
		'# narration with speakers (Jack:, You:), add @bg/@show, and give the reader',
		'# one choice whose branches hold reactions, then reconverge (== label).',
		'# Remove @status draft only after a read-through; keep every ^¶ chip honest.',
		'',
		'@bg paper',
		'@thumb'
	);
	if (post.summary) lines.push(commentFrom('summary:', post.summary));
	lines.push(...body, '', '@end', '');

	writeFileSync(out, lines.join('\n'));
	console.log(`Wrote ${out.replace(root, '').replace(/^[\\/]/, '')} (${para} paragraph${para === 1 ? '' : 's'}). Preview with ?src=stories/blog-${post.slug}.vn`);
}

// ---- --scaffold-paper <id> --title "..." [--abstract file.txt] -------------

function scaffoldPaper(id, title, abstractFile) {
	if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
		console.error('The id must be lowercase letters, digits and hyphens, e.g. paired-training.');
		process.exit(1);
	}
	if (!title) {
		console.error('--scaffold-paper needs --title "Paper title as written in index.html".');
		process.exit(1);
	}
	if (!existsSync(storiesDir)) mkdirSync(storiesDir, { recursive: true });
	const out = join(storiesDir, `${id}.vn`);
	refuseIfExists(out);

	let sentences = [];
	if (abstractFile) {
		const p = resolve(process.cwd(), abstractFile);
		if (!existsSync(p)) {
			console.error(`Abstract file not found: ${p}`);
			process.exit(1);
		}
		sentences = splitSentences(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
	}

	const titles = existsSync(indexHtml) ? pubTitles(readFileSync(indexHtml, 'utf8')) : [];
	const matched = titles.some((t) => t.includes(title.replace(/\s+/g, ' ').trim().toLowerCase()));
	const palette = ['slate', 'paper', 'ink', 'night', 'ochre', 'moss'][fnv1a(id) % 6];

	const L = [];
	L.push(
		`@title ${title}`,
		'@kind paper',
		`@source paper:${title}`
	);
	if (!matched) {
		L.push('# TODO @source paper: must be a substring of a .pub-block title in index.html (test.js checks this).');
	}
	L.push(
		'# TODO @cite: authors (year). Title. Venue string copied verbatim from index.html.',
		'@cite TODO',
		'# TODO @arxiv 0000.00000 (only if the paper is on arXiv; enables Copy BibTeX)',
		'# TODO @link https://... Read the paper',
		'# TODO @authors in paper order, with † notes; coauthors are credited here, never voiced.',
		'@authors TODO',
		'@note Dialogue is dramatized; coauthors did not say these lines. Figures marked § are quoted from the source.',
		'@status embargo',
		'@verify',
		`@palette ${palette}`,
		'@cast Jack hue=210 glasses',
		'@cast You player hue=20',
		'# TODO declare the abstract roles the story needs, e.g. @cast Model name="the model" lattice=sparse hue=192',
		'',
		`# Scaffolded by scripts/build-vn-index.mjs --scaffold-paper ${id} on ${today()}.`,
		'# Seven beats: hook, question, bet, method, result, meaning, citation. Every figure',
		'# must come from the source text as a @fact with a ^§ chip; until the paper is',
		'# public the result beat stays @withheld and the story stays @status embargo.'
	);
	if (sentences.length) {
		L.push('', `# Abstract sentences from ${basename(abstractFile)} (source text, for chips and @fact lines):`);
		sentences.forEach((s, i) => L.push(commentFrom(`from [${i + 1}]:`, s)));
	} else {
		L.push('', '# No --abstract given: paste the abstract sentences here as "# from:" comments before drafting.');
	}
	L.push(
		'',
		'# TODO facts: one @fact per figure the story will quote, e.g.',
		'# @fact n_participants = TODO ^§3',
		'',
		'# ---- beat 1: hook ---------------------------------------------------------',
		'@bg lab',
		'@show Jack left',
		'# TODO one sentence from the abstract that states the problem; chip it.',
		'Jack: TODO hook. ^§1',
		'@thumb',
		'',
		'# ---- beat 2: question -------------------------------------------------------',
		'# TODO the research question in Jack\'s voice; the title often is the question.',
		'Jack (thinking): TODO question. ^§1',
		'',
		'# ---- beat 3: bet (branches hold reactions only, never figures) ------------',
		'@show You right',
		'Jack (smile): Before the numbers, place a bet.',
		'* TODO first hypothesis -> bet_a',
		'* TODO second hypothesis -> bet_b',
		'',
		'== bet_a',
		'You: TODO reaction a.',
		'Jack (deadpan): TODO reply a.',
		'@set bet = a',
		'-> method',
		'',
		'== bet_b',
		'You (thinking): TODO reaction b.',
		'Jack (smile): TODO reply b.',
		'@set bet = b',
		'-> method',
		'',
		'# ---- beat 4: method -------------------------------------------------------',
		'== method',
		'# TODO @card Setup | label: value | label: value   (every number as a {fact})',
		'Jack: TODO method sentence. ^§2',
		'',
		'# ---- beat 5: result (withheld while embargoed) -----------------------------',
		'# TODO when the paper is public: replace @withheld with the figures as the',
		'#      paper printed them (@chart / @card with {fact} cells) and set @status draft,',
		'#      then published after a read-through and a .pub-play link in index.html.',
		'@withheld Results withheld until the paper is public.',
		'',
		'# ---- beat 6: meaning --------------------------------------------------------',
		'# @if bet == a -> react_a',
		'# You: TODO reaction for bet b.',
		'# -> meaning',
		'# == react_a',
		'# You: TODO reaction for bet a.',
		'# == meaning',
		'# Jack: TODO the paper in one sentence. ^§5',
		'',
		'# ---- beat 7: citation -------------------------------------------------------',
		'@end',
		''
	);

	writeFileSync(out, L.join('\n'));
	console.log(`Wrote ${out.replace(root, '').replace(/^[\\/]/, '')} (embargo skeleton${sentences.length ? `, ${sentences.length} abstract sentences` : ''}). Preview with ?src=stories/${id}.vn&drafts=1`);
}

function fnv1a(s) {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

// ---- CLI ----------------------------------------------------------------------

function argValue(args, flag) {
	const i = args.indexOf(flag);
	return i === -1 ? '' : args[i + 1] || '';
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const args = process.argv.slice(2);
	if (args.includes('--help') || args.includes('-h')) {
		console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 20).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
	} else if (args.includes('--scaffold-post')) {
		scaffoldPost(argValue(args, '--scaffold-post'));
	} else if (args.includes('--scaffold-paper')) {
		scaffoldPaper(argValue(args, '--scaffold-paper'), argValue(args, '--title'), argValue(args, '--abstract'));
	} else {
		build(args.includes('--dry-run'));
	}
}
