// Fetches the two files this kit vendors: the stories260K checkpoint and its
// 512-token tokenizer, from karpathy/tinyllamas on Hugging Face (MIT).
//
//   node misc/_llm/build-fetch-weights.mjs           download, verify, write weights/
//   node misc/_llm/build-fetch-weights.mjs --check   verify the files on disk, no network
//
// The revision is pinned, and each file must have the size and SHA-256 written
// below, or nothing is written. The site serves the files itself afterwards:
// no page ever asks huggingface.co for anything.
//
// What to record in LICENSES.md is printed at the end.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'weights');

// The request says which site it is for and nothing else: no email address.
const USER_AGENT = 'nietztein.github.io weights fetch (+https://nietztein.github.io)';

const REPO = 'https://huggingface.co/karpathy/tinyllamas';
const REVISION = '0bd21da7698eaf29a0d7de3992de8a46ef624add'; // main, last changed 2023-08-15

const FILES = [
	{
		name: 'stories260K.bin',
		url: `${REPO}/resolve/${REVISION}/stories260K/stories260K.bin`,
		bytes: 1056540,
		sha256: 'b0a507e7ad0f626624f17112325e66691f9076d622e1d3274d103d00299f2696',
	},
	{
		name: 'tok512.bin',
		url: `${REPO}/resolve/${REVISION}/stories260K/tok512.bin`,
		bytes: 6227,
		sha256: '037cb335abb25d1fa9e8ecae30ed2a3a8ace9302862ebcdc05d51a6bbb10c312',
	},
];

function sha256(buf) {
	return createHash('sha256').update(buf).digest('hex');
}

function verify(file, buf) {
	const problems = [];
	if (buf.length !== file.bytes) problems.push(`size ${buf.length}, expected ${file.bytes}`);
	const sum = sha256(buf);
	if (sum !== file.sha256) problems.push(`sha256 ${sum}, expected ${file.sha256}`);
	return problems;
}

async function check() {
	let bad = 0;
	for (const file of FILES) {
		let buf;
		try {
			buf = await readFile(path.join(OUT, file.name));
		} catch (err) {
			console.log(`FAIL ${file.name}: not on disk (${err.code})`);
			bad++;
			continue;
		}
		const problems = verify(file, buf);
		if (problems.length) {
			console.log(`FAIL ${file.name}: ${problems.join('; ')}`);
			bad++;
		} else {
			console.log(`PASS ${file.name}: ${buf.length} bytes, sha256 ${file.sha256}`);
		}
	}
	return bad === 0;
}

async function download() {
	const fetched = new Date().toISOString().slice(0, 10);
	const got = [];
	for (const file of FILES) {
		const res = await fetch(file.url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
		if (!res.ok) throw new Error(`${file.name}: HTTP ${res.status} from ${file.url}`);
		const buf = Buffer.from(await res.arrayBuffer());
		const problems = verify(file, buf);
		if (problems.length) throw new Error(`${file.name}: ${problems.join('; ')} (nothing written)`);
		got.push({ file, buf });
	}
	await mkdir(OUT, { recursive: true });
	for (const { file, buf } of got) {
		await writeFile(path.join(OUT, file.name), buf);
	}
	console.log('Wrote ' + path.relative(process.cwd(), OUT) + path.sep);
	console.log('');
	console.log('For LICENSES.md:');
	for (const { file, buf } of got) {
		console.log(`  ${file.name}`);
		console.log(`    url     ${file.url}`);
		console.log(`    fetched ${fetched}`);
		console.log(`    bytes   ${buf.length}`);
		console.log(`    sha256  ${sha256(buf)}`);
	}
}

const wantCheck = process.argv.includes('--check');
try {
	if (wantCheck) {
		process.exitCode = (await check()) ? 0 : 1;
	} else {
		await download();
		process.exitCode = (await check()) ? 0 : 1;
	}
} catch (err) {
	console.error('FAIL ' + (err && err.message ? err.message : String(err)));
	process.exitCode = 1;
}
