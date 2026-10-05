/*
 * Builds every data file of misc/_texts, then the documents.
 *
 *     node scripts/texts/build-all.mjs [--offline]
 *
 * Each step is its own script and can be run alone. The order matters twice: the glosses
 * are made for the forms of freq-de.js, and the documents are written from the finished
 * data files. A step that fails stops the run.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { HERE } from './lib.mjs';

const STEPS = ['build-zarathustra.mjs', 'build-freq.mjs', 'build-kieu.mjs', 'build-sentences.mjs', 'build-cmu.mjs', 'build-glosses.mjs', 'build-docs.mjs'];
const pass = process.argv.slice(2).filter((a) => a === '--offline');

for (const step of STEPS) {
	console.log('== ' + step);
	const r = spawnSync(process.execPath, [path.join(HERE, step)].concat(pass), { stdio: 'inherit' });
	if (r.status !== 0) {
		console.error(step + ' failed' + (r.status === null ? '' : ' with exit code ' + r.status));
		process.exit(1);
	}
}
console.log('== done. Now run: node misc/_texts/test.js');
