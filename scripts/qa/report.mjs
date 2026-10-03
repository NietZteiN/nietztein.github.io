// Writes scripts/qa/out/report.html: one row per toy with its manifest
// (title, group, status, kit), its thumbnail (size and a small preview), the
// result of the last `smoke.mjs --all` and the outside hosts it contacted.
// A plain static page for a quick look over all the toys at once.
//
// Zero dependencies, no browser. Run with:
//   node scripts/qa/report.mjs
// It reads misc/*/toy.json, assets/img/misc/*.jpg and scripts/qa/out/smoke-last.json
// (run `node scripts/qa/smoke.mjs --all` first for that column), then open
// scripts/qa/out/report.html in a browser. The folder is gitignored.

import fs from 'node:fs';
import path from 'node:path';
import { jpegSize } from './jpeg.mjs';
import { listToys, loadBaseline, outDir } from './smoke.mjs';
import { repoRoot } from '../serve.mjs';

function esc(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

const toys = listToys(repoRoot);
const baseline = loadBaseline();
const thumbDir = path.join(repoRoot, 'assets', 'img', 'misc');
const thumbNames = new Set(fs.existsSync(thumbDir) ? fs.readdirSync(thumbDir) : []);

let smoke = null;
try {
	smoke = JSON.parse(fs.readFileSync(path.join(outDir, 'smoke-last.json'), 'utf8'));
} catch (e) {
	smoke = null;
}
const smokeBySlug = new Map((smoke ? smoke.toys : []).map((t) => [t.slug, t]));

let problems = 0;
const rows = toys.map((toy) => {
	// Thumbnail: exact file name (Pages is case-sensitive), size, weight.
	const name = `${toy.slug}.jpg`;
	let thumb = '<span class="bad">missing</span>';
	let thumbBad = true;
	if (thumbNames.has(name)) {
		const buf = fs.readFileSync(path.join(thumbDir, name));
		let dims = '?';
		let sizeOk = false;
		try {
			const s = jpegSize(buf);
			dims = `${s.width}x${s.height}`;
			sizeOk = (s.width === 800 && s.height === 500) || toy.thumb.legacy;
		} catch (e) {
			dims = 'not a JPEG';
		}
		const kb = buf.length / 1024;
		const weightOk = kb <= 150 && (kb >= 6 || toy.thumb.legacy);
		thumbBad = !sizeOk || !weightOk;
		thumb = `<img src="../../../assets/img/misc/${esc(name)}" alt="" loading="lazy"> <span class="${thumbBad ? 'bad' : ''}">${esc(dims)}, ${kb.toFixed(0)} KB${toy.thumb.legacy ? ' (legacy)' : ''}</span>`;
	}

	const s = smokeBySlug.get(toy.slug);
	let result = '<span class="dim">not run</span>';
	let hosts = '';
	let smokeBad = false;
	if (s) {
		if (s.skipped) result = `<span class="dim">skipped (${esc(s.skipped)})</span>`;
		else if (s.ok) result = `<span class="ok">PASS</span> <span class="dim">${s.ms} ms${s.tolerated && s.tolerated.length ? `, ${s.tolerated.length} known` : ''}${s.retried ? ', retried' : ''}</span>`;
		else {
			smokeBad = true;
			result = `<span class="bad">FAIL</span><ul>${(s.failures || []).map((f) => `<li>${esc(f.kind)}: ${esc(f.text)}${f.passes && f.passes.length ? ` <span class="dim">[${esc(f.passes.join(', '))}]</span>` : ''}</li>`).join('')}</ul>`;
		}
		hosts = (s.hosts || []).map(esc).join('<br>');
	}
	const known = baseline.toys[toy.slug];
	if (known && known.hosts && known.hosts.length) hosts += `${hosts ? '<br>' : ''}<span class="dim">baseline: ${known.hosts.map(esc).join(', ')}</span>`;
	if (toy.manifestError) smokeBad = true;
	if (thumbBad || smokeBad) problems++;

	return `<tr${thumbBad || smokeBad ? ' class="flag"' : ''}>
<td><a href="../../../${esc(toy.path)}/">${esc(toy.slug)}</a></td>
<td>${toy.manifestError ? `<span class="bad">toy.json: ${esc(toy.manifestError)}</span>` : esc(toy.title) || '<span class="dim">no toy.json</span>'}</td>
<td>${esc(toy.group)}</td>
<td>${toy.wip ? 'wip' : toy.manifest ? 'live' : ''}</td>
<td>${toy.kit ? 'yes' : 'no'}</td>
<td class="thumb">${thumb}</td>
<td>${result}</td>
<td>${hosts}</td>
</tr>`;
});

const when = smoke ? `${smoke.startedAt.replace('T', ' ').slice(0, 16)} UTC, ${smoke.browser}, ${smoke.counts.passed} passed, ${smoke.counts.failed} failed, ${smoke.counts.skipped} skipped, ${(smoke.ms / 1000).toFixed(0)} s` : 'never run (node scripts/qa/smoke.mjs --all)';
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Toy QA report</title>
<style>
body { font: 14px/1.4 system-ui, sans-serif; margin: 20px; color: #1b1f24; background: #fff; }
h1 { font-size: 20px; margin: 0 0 4px; }
p { margin: 2px 0 12px; color: #57606a; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; vertical-align: top; padding: 6px 10px; border-bottom: 1px solid #d8dee4; }
th { position: sticky; top: 0; background: #f6f8fa; }
tr.flag { background: #fff5f5; }
td.thumb img { width: 96px; height: 60px; object-fit: cover; vertical-align: middle; border: 1px solid #d8dee4; margin-right: 6px; }
ul { margin: 4px 0 0; padding-left: 18px; }
.ok { color: #1a7f37; font-weight: 600; }
.bad { color: #b42318; font-weight: 600; }
.dim { color: #6e7781; font-weight: 400; }
a { color: #0550ae; }
</style>
</head>
<body>
<h1>Toy QA report</h1>
<p>${toys.length} toys, ${toys.filter((t) => t.kit).length} on the kit, ${problems} flagged. Written ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC. Last smoke --all: ${esc(when)}.</p>
<table>
<thead><tr><th>Toy</th><th>Title</th><th>Group</th><th>Status</th><th>Kit</th><th>Thumbnail</th><th>Last smoke</th><th>Outside hosts</th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table>
</body>
</html>
`;

fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, 'report.html');
fs.writeFileSync(file, html);
console.log(`wrote scripts/qa/out/report.html  (${toys.length} toys, ${problems} flagged, ${(html.length / 1024).toFixed(0)} KB)`);
