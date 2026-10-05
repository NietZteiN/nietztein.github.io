// Rebuilds every data file of misc/_lang in dependency order, then brings the
// generated parts of misc/_lang/README.md and LICENSES.md (sizes, counts,
// source hashes, fetch dates, credit lines) in line with the files.
//
//   node scripts/lang/build-all.mjs             from the cache; downloads only what is missing
//   node scripts/lang/build-all.mjs --refresh   first forget the cached EDRDG files, so the
//                                               newest KANJIDIC2, KRADFILE, RADKFILE and JMdict
//                                               are downloaded (the EDRDG licence asks that data
//                                               in use is kept up to date)
//   node scripts/lang/build-all.mjs --relock    also pin the newest revisions of the wiki pages
//   node scripts/lang/build-all.mjs --docs      only rewrite the generated parts of the two documents
//
// Afterwards: node misc/_lang/test.js

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scriptDir, cacheDir, outDir, loadDataFile } from './lib.mjs';

const args = process.argv.slice(2);
const known = ['--refresh', '--relock', '--docs'];
for (const a of args) {
	if (!known.includes(a)) {
		console.error(`Unknown option ${a}\nUsage: node scripts/lang/build-all.mjs [--refresh] [--relock] [--docs]`);
		process.exit(2);
	}
}

// file, global, build script, what the README table says it holds
const DATASETS = [
	['hyakunin.js', 'LANG_HYAKUNIN', 'build-hyakunin.mjs', "The 100 poems of the Ogura Hyakunin Isshu: text, reading, kimariji, Porter's romanised text and English verse; what was corrected and what the sources disagree on"],
	['kanji.js', 'LANG_KANJI', 'build-kanji.mjs', 'The 2,136 joyo kanji: meanings, readings, components, grade, strokes, frequency; and the other forms of them'],
	['kanji-grades.js', 'LANG_KANJI_GRADES', 'build-kanji-grades.mjs', 'The same kanji in school order with stroke counts'],
	['jmdict-core.js', 'LANG_JMDICT', 'build-jmdict-core.mjs', 'The common words of JMdict: written form, reading, first gloss, tags, frequency band'],
	['jmdict-tech.js', 'LANG_JMDICT_TECH', 'build-jmdict-tech.mjs', 'All-kanji words with a computing or mathematics sense, common or not'],
	['accents.js', 'LANG_ACCENT', 'build-accents.mjs', 'Pitch accents of the words in jmdict-core, and groups that differ only in accent'],
	['freq-ja.js', 'LANG_FREQ_JA', 'build-freq-ja.mjs', 'Two-kanji words with two frequency counts, and every attested two-kanji string'],
	['texts/yume-juya-1.js', 'LANG_TEXT_YUMEJUYA1', 'build-yume-juya-1.mjs', 'Soseki, Ten Nights of Dreams, the First Night, with the furigana of the source'],
];

if (!args.includes('--docs')) {
	if (args.includes('--refresh')) {
		for (const name of ['edrdg-kanjidic2.xml.gz', 'edrdg-kradfile.gz', 'edrdg-radkfile.gz', 'edrdg-JMdict_e.gz']) {
			for (const f of [path.join(cacheDir, name), path.join(cacheDir, name + '.meta.json')]) if (fs.existsSync(f)) fs.rmSync(f);
		}
		console.log('forgot the cached EDRDG files');
	}
	for (const [, , script] of DATASETS) {
		const extra = script === 'build-hyakunin.mjs' && args.includes('--relock') ? ['--relock'] : [];
		console.log(`\n== ${script} ${extra.join(' ')}`);
		const r = spawnSync(process.execPath, [path.join(scriptDir, script), ...extra], { stdio: 'inherit' });
		if (r.status !== 0) {
			console.error(`${script} failed; stopping.`);
			process.exit(1);
		}
	}
}

// ---- the generated parts of the documents -----------------------------------------

function replaceBlock(text, name, content, file) {
	const open = `<!-- generated:${name} -->`;
	const close = `<!-- /generated:${name} -->`;
	const a = text.indexOf(open);
	const b = text.indexOf(close);
	if (a < 0 || b < a) throw new Error(`${file} has no block ${open} ... ${close}`);
	return text.slice(0, a + open.length) + '\n' + content + '\n' + text.slice(b);
}
function servedBytes(file) {
	// The size with LF line ends, which is what the site serves.
	return Buffer.byteLength(fs.readFileSync(path.join(outDir, file), 'utf8').replace(/\r\n/g, '\n'), 'utf8');
}
function sourceLine(s) {
	const extras = [];
	if (s.file) extras.push(s.file);
	if (s.version) extras.push('version ' + s.version);
	if (s.created) extras.push('dated ' + s.created);
	if (s.pages) extras.push(s.pages);
	if (s.upstream) extras.push('which names as its own source ' + s.upstream);
	if (s.sha256Of) extras.push('the hash is of ' + s.sha256Of);
	return `- <${s.url}>${extras.length ? ' (' + extras.join('; ') + ')' : ''}  \n  SHA-256 \`${s.sha256}\`, fetched ${s.fetched}${s.gives ? '. Gives: ' + s.gives + '.' : ''}`;
}

const loaded = DATASETS.map(([file, global, script, holds]) => ({ file, global, script, holds, data: loadDataFile(file, global), bytes: servedBytes(file) }));

const table = ['| File | Global | Bytes | Holds |', '| --- | --- | ---: | --- |', ...loaded.map((d) => `| \`${d.file}\` | \`${d.global}\` | ${d.bytes.toLocaleString('en-US')} | ${d.holds} |`)].join('\n');
const credits = loaded.map((d) => `- \`${d.file}\`: ${d.data.meta.credit}`).join('\n');

for (const doc of ['README.md', 'LICENSES.md']) {
	const full = path.join(outDir, doc);
	if (!fs.existsSync(full)) {
		console.log(`${doc} is not there yet; nothing to update`);
		continue;
	}
	const before = fs.readFileSync(full, 'utf8');
	let text = before;
	if (doc === 'README.md') {
		text = replaceBlock(text, 'files', table, doc);
		text = replaceBlock(text, 'credits', credits, doc);
	} else {
		for (const d of loaded) {
			const m = d.data.meta;
			const block = [
				`Built by \`scripts/lang/${d.script}\`. ${d.bytes.toLocaleString('en-US')} bytes.`,
				'',
				'Sources as fetched:',
				'',
				...m.sources.map(sourceLine),
				'',
				`Licence: ${m.licence}`,
				'',
				'Credit a page must show, word for word:',
				'',
				`> ${m.credit}`,
				'',
				`Kept: \`${JSON.stringify(m.kept)}\``,
				'',
				'Left out or changed:',
				'',
				...m.dropped.map((x) => `- ${x}`),
			].join('\n');
			text = replaceBlock(text, d.file, block, doc);
		}
	}
	if (text !== before) fs.writeFileSync(full, text);
	console.log(`${text === before ? 'unchanged' : 'updated  '} misc/_lang/${doc}`);
}
