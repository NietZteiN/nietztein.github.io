// Curated discovery must refer only to public source records. This checks the
// authored data independently, plus invalid/unpublished targets and deduping.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { compile } = require('../assets/js/connections.js');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const model = read('assets/data/connections.json');
const publications = read('assets/data/publications.json');
const posts = read('blog/index.json');
const toys = read('misc/toys.json');
const publicSources = {
	publication: new Map(publications.map((paper) => [paper.id, paper])),
	post: new Map(posts.map((post) => [post.slug, post])),
	experiment: new Map(toys.toys.filter((toy) => toy.status === 'live' && toy.surfaces.some((surface) => surface === 'grid' || surface === 'views')).map((toy) => [toy.slug, toy]))
};
assert.equal(model.version, 1);
assert.equal(model.connections.length, 15, 'Eight publication entries and seven articles have intentionally curated connections');
const seen = new Set();
for (const row of model.connections) {
	const source = row.from.kind + ':' + row.from.id;
	assert.ok(publicSources[row.from.kind]?.has(row.from.id), 'Source is public: ' + source);
	assert.ok(!seen.has(source), 'No duplicate source: ' + source);
	seen.add(source);
	assert.ok(row.to.length >= 1 && row.to.length <= 3, 'Each section stays concise');
	const targets = new Set();
	for (const edge of row.to) {
		const target = edge.kind + ':' + edge.id;
		assert.ok(publicSources[edge.kind]?.has(edge.id), 'Target is public: ' + target);
		assert.notEqual(edge.kind, row.from.kind, 'Every connection crosses media instead of duplicating related writing');
		assert.ok(!targets.has(target), 'No repeated destination: ' + target);
		targets.add(target);
		assert.ok(typeof edge.description === 'string' && edge.description.trim().length > 0 && edge.description.length <= 240);
	}
}
const actual = compile(model, publications, posts, toys);
assert.equal(Object.keys(actual.links).length, 15);
assert.deepEqual(actual.links['post:latentland'].map((edge) => edge.entity.id), [
	'32-latentland-map', '19-tokenizer-aquarium', 'what-does-an-embedding-mean-a-semiotic-account-of-learned-representation'
], 'Latentland has its real map, a text-processing experiment, and public representation research');
assert.deepEqual(actual.links['post:benchmarks-we-actually-need'].map((edge) => edge.entity.kind), ['publication', 'experiment', 'experiment']);
const source = { kind: 'post', id: 'public-post' };
const edge = (kind, id, description = 'A topical connection.') => ({ kind, id, description });
const fixture = { version: 1, connections: [{ from: source, to: [
	edge('experiment', 'unfinished'), edge('experiment', 'unlisted'), edge('experiment', 'missing'),
	edge('publication', 'missing-paper'), edge('post', 'another-post'),
	edge('experiment', '../private'), edge('experiment', 'live-toy', ''), edge('experiment', 'live-toy'),
	edge('experiment', 'live-toy'), edge('publication', 'paper'), edge('experiment', 'another-toy'), edge('experiment', 'fourth-toy')
] }] };
const compiled = compile(fixture,
	[{ id: 'paper', title: 'A public paper' }, { id: 12, title: 'Malformed ID' }],
	[{ slug: 'public-post', title: 'A public post', file: 'public-post.md' }, { slug: 'another-post', title: 'Another', file: 'another.md' }, { slug: 'draft', title: 'Private', file: '../drafts/private.md' }],
	{ toys: [
		{ slug: 'unfinished', title: 'WIP', status: 'wip', surfaces: ['grid'] },
		{ slug: 'unlisted', title: 'Hidden', status: 'live', surfaces: [] },
		...['live-toy', 'another-toy', 'fourth-toy'].map((slug) => ({ slug, title: slug, status: 'live', surfaces: ['grid'] }))
	] });
assert.deepEqual(compiled.links['post:public-post'].map((item) => item.entity.id), ['live-toy', 'paper', 'another-toy'], 'Omit unpublished, invalid, duplicate and same-medium links; cap valid results at three');
assert.equal(compiled.entities['post:draft'], undefined, 'A draft path cannot enter the public registry');
assert.equal(compiled.entities['publication:12'], undefined, 'Source IDs must be strings');
assert.deepEqual(Object.keys(compile({ version: 2, connections: fixture.connections }, [], [], {}).links), []);
assert.deepEqual(Object.keys(compile(null, null, null, null).links), []);
assert.deepEqual(Object.keys(compile({ version: 1, connections: [{ from: { kind: 'post', id: 'missing' }, to: [edge('publication', 'paper')] }] }, [{ id: 'paper', title: 'Paper' }], [], {}).links), []);
console.log('PASS curated connections: 15 public sources, validated targets, unpublished exclusions and bounded cross-media results');
