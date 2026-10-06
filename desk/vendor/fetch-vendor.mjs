// Fetches the third-party files the Desk needs into desk/vendor/ and writes
// desk/vendor/LICENSES.md (source URL, licence, size and SHA-256 of every file).
//
// The Desk loads nothing from another origin: a script from a CDN on that page
// could read the GitHub token. So the libraries the public blog loads from
// jsDelivr are copied here once, at the same exact versions, and served from
// the site itself.
//
// Zero dependencies. Run with:
//   node desk/vendor/fetch-vendor.mjs            fetch everything, rewrite LICENSES.md
//   node desk/vendor/fetch-vendor.mjs --check    fetch nothing; compare the files on disk with LICENSES.md
//
// Requests identify themselves by the site URL only.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CDN = 'https://cdn.jsdelivr.net/';
const UA = 'nietztein.github.io desk vendor fetch (https://nietztein.github.io)';

const KATEX_FONTS = [
	'KaTeX_AMS-Regular', 'KaTeX_Caligraphic-Bold', 'KaTeX_Caligraphic-Regular', 'KaTeX_Fraktur-Bold',
	'KaTeX_Fraktur-Regular', 'KaTeX_Main-Bold', 'KaTeX_Main-BoldItalic', 'KaTeX_Main-Italic',
	'KaTeX_Main-Regular', 'KaTeX_Math-BoldItalic', 'KaTeX_Math-Italic', 'KaTeX_SansSerif-Bold',
	'KaTeX_SansSerif-Italic', 'KaTeX_SansSerif-Regular', 'KaTeX_Script-Regular', 'KaTeX_Size1-Regular',
	'KaTeX_Size2-Regular', 'KaTeX_Size3-Regular', 'KaTeX_Size4-Regular', 'KaTeX_Typewriter-Regular',
];

// One entry per library: what it is for, its licence, and its files
// (local path under desk/vendor/ <- path on jsDelivr).
const LIBS = [
	{
		name: 'marked', version: '12.0.2', licence: 'MIT', home: 'https://github.com/markedjs/marked',
		use: 'Markdown to HTML, as on the blog (assets/js/blog.js).',
		base: 'npm/marked@12.0.2/',
		files: [['marked/marked.min.js', 'marked.min.js'], ['marked/LICENSE.md', 'LICENSE.md']],
	},
	{
		name: 'DOMPurify', version: '3.1.6', licence: 'Apache-2.0 OR MPL-2.0', home: 'https://github.com/cure53/DOMPurify',
		use: 'Sanitises every piece of HTML before it is shown.',
		base: 'npm/dompurify@3.1.6/',
		files: [['dompurify/purify.min.js', 'dist/purify.min.js'], ['dompurify/LICENSE', 'LICENSE']],
	},
	{
		name: 'highlight.js', version: '11.9.0', licence: 'BSD-3-Clause', home: 'https://github.com/highlightjs/highlight.js',
		use: 'Code highlighting; the common build and the two themes the blog switches between (github, github-dark).',
		base: 'gh/highlightjs/cdn-release@11.9.0/',
		files: [
			['highlight/highlight.min.js', 'build/highlight.min.js'],
			['highlight/github.min.css', 'build/styles/github.min.css'],
			['highlight/github-dark.min.css', 'build/styles/github-dark.min.css'],
			['highlight/LICENSE', 'LICENSE'],
		],
	},
	{
		name: 'KaTeX', version: '0.16.9', licence: 'MIT (the fonts: SIL OFL 1.1)', home: 'https://github.com/KaTeX/KaTeX',
		use: 'Math rendering with the auto-render extension. Only the .woff2 fonts are copied; the stylesheet also names .woff and .ttf fallbacks, which no current browser asks for.',
		base: 'npm/katex@0.16.9/',
		files: [
			['katex/katex.min.js', 'dist/katex.min.js'],
			['katex/auto-render.min.js', 'dist/contrib/auto-render.min.js'],
			['katex/katex.min.css', 'dist/katex.min.css'],
			['katex/LICENSE', 'LICENSE'],
			...KATEX_FONTS.map((f) => [`katex/fonts/${f}.woff2`, `dist/fonts/${f}.woff2`]),
		],
	},
	{
		name: 'Bootstrap (stylesheet only)', version: '5.3.3', licence: 'MIT', home: 'https://github.com/twbs/bootstrap',
		use: 'The public site is laid out with Bootstrap; the post preview frame needs the same stylesheet to look like the live post. No Bootstrap script is used.',
		base: 'npm/bootstrap@5.3.3/',
		files: [['bootstrap/bootstrap.min.css', 'dist/css/bootstrap.min.css'], ['bootstrap/LICENSE', 'LICENSE']],
	},
	{
		name: 'Inter (variable, latin)', version: '@fontsource-variable/inter 5.3.0', licence: 'SIL OFL 1.1', home: 'https://github.com/rsms/inter',
		use: 'The site\'s text face (the public site gets it from Google Fonts).',
		base: 'npm/@fontsource-variable/inter@5.3.0/',
		files: [['fonts/inter-latin-wght-normal.woff2', 'files/inter-latin-wght-normal.woff2'], ['fonts/LICENSE-inter', 'LICENSE']],
	},
	{
		name: 'JetBrains Mono (variable, latin)', version: '@fontsource-variable/jetbrains-mono 5.3.0', licence: 'SIL OFL 1.1', home: 'https://github.com/JetBrains/JetBrainsMono',
		use: 'The site\'s monospace face (the public site gets it from Google Fonts).',
		base: 'npm/@fontsource-variable/jetbrains-mono@5.3.0/',
		files: [['fonts/jetbrains-mono-latin-wght-normal.woff2', 'files/jetbrains-mono-latin-wght-normal.woff2'], ['fonts/LICENSE-jetbrains-mono', 'LICENSE']],
	},
];

// Written by this script, not fetched: the @font-face rules for the two faces.
const FONTS_CSS = `/* Written by desk/vendor/fetch-vendor.mjs. The two faces the public site loads
   from Google Fonts, served from the site itself (latin subset, variable weight). */
@font-face {
	font-family: 'Inter';
	font-style: normal;
	font-weight: 100 900;
	font-display: swap;
	src: url(inter-latin-wght-normal.woff2) format('woff2');
}
@font-face {
	font-family: 'JetBrains Mono';
	font-style: normal;
	font-weight: 100 800;
	font-display: swap;
	src: url(jetbrains-mono-latin-wght-normal.woff2) format('woff2');
}
`;

function sha256(buf) {
	return crypto.createHash('sha256').update(buf).digest('hex');
}

async function fetchBytes(url) {
	let lastError = null;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const res = await fetch(url, { headers: { 'User-Agent': UA } });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return Buffer.from(await res.arrayBuffer());
		} catch (e) {
			lastError = e;
		}
	}
	throw new Error(`could not fetch ${url}: ${lastError.message}`);
}

function listing() {
	const rows = [];
	for (const lib of LIBS) for (const [local, remote] of lib.files) rows.push({ lib, local, url: CDN + lib.base + remote });
	return rows;
}

function licencesDoc(rows, date) {
	const out = [];
	out.push('# Third-party files in desk/vendor/');
	out.push('');
	out.push('Written by `node desk/vendor/fetch-vendor.mjs`; do not edit by hand. `node desk/vendor/fetch-vendor.mjs --check` compares the files on disk with the hashes below.');
	out.push('');
	out.push('The Desk loads no script, style or font from another origin, so everything it needs is copied here, unchanged, at the exact versions the public blog loads from jsDelivr.');
	out.push('');
	out.push(`Fetched: ${date}`);
	out.push('');
	for (const lib of LIBS) {
		out.push(`## ${lib.name} ${lib.version}`);
		out.push('');
		out.push(`- Licence: ${lib.licence}`);
		out.push(`- Project: ${lib.home}`);
		out.push(`- Used for: ${lib.use}`);
		out.push('- Changed: nothing.');
		out.push('');
		out.push('| File | Source | Bytes | SHA-256 |');
		out.push('| --- | --- | ---: | --- |');
		for (const r of rows.filter((x) => x.lib === lib)) out.push(`| \`${r.local}\` | ${r.url} | ${r.bytes} | \`${r.sha}\` |`);
		out.push('');
	}
	out.push('## fonts/fonts.css');
	out.push('');
	out.push('Not fetched: the two `@font-face` rules for Inter and JetBrains Mono, written by the fetch script.');
	out.push('');
	out.push('| File | Source | Bytes | SHA-256 |');
	out.push('| --- | --- | ---: | --- |');
	const css = Buffer.from(FONTS_CSS);
	out.push(`| \`fonts/fonts.css\` | desk/vendor/fetch-vendor.mjs | ${css.length} | \`${sha256(css)}\` |`);
	out.push('');
	return out.join('\n');
}

async function main() {
	const check = process.argv.includes('--check');
	const rows = listing();

	if (check) {
		const doc = fs.readFileSync(path.join(here, 'LICENSES.md'), 'utf8');
		let bad = 0;
		const all = rows.map((r) => r.local).concat('fonts/fonts.css');
		for (const local of all) {
			const file = path.join(here, local);
			if (!fs.existsSync(file)) {
				console.log(`FAIL ${local}: missing`);
				bad++;
				continue;
			}
			const sha = sha256(fs.readFileSync(file));
			if (!doc.includes('`' + local + '`') || !doc.includes(sha)) {
				console.log(`FAIL ${local}: its SHA-256 ${sha} is not the one in LICENSES.md`);
				bad++;
			}
		}
		console.log(bad ? `${bad} of ${all.length} files differ` : `PASS ${all.length} files match LICENSES.md`);
		process.exit(bad ? 1 : 0);
	}

	for (const r of rows) {
		const buf = await fetchBytes(r.url);
		const file = path.join(here, r.local);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, buf);
		r.bytes = buf.length;
		r.sha = sha256(buf);
		console.log(`${String(buf.length).padStart(8)}  ${r.local}`);
	}
	fs.writeFileSync(path.join(here, 'fonts', 'fonts.css'), FONTS_CSS);
	fs.writeFileSync(path.join(here, 'LICENSES.md'), licencesDoc(rows, new Date().toISOString().slice(0, 10)));
	const total = rows.reduce((n, r) => n + r.bytes, 0);
	console.log(`${rows.length} files, ${total} bytes; wrote LICENSES.md`);
}

main().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
