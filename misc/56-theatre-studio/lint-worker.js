/*
 * Theatre Studio lint worker: parse, lint and walk a .vn script off the main thread.
 *
 *   in   { type: 'lint', text, version, id }
 *   out  { type: 'program', program, issues, walk, version, ms }     (plain JSON)
 *        { type: 'error', version, message }                          (the engine threw)
 *
 * @include paths are fetched from ../55-paper-theatre/stories/ (as the stage does for a draft) and kept for the
 * session: they are repo files and do not change while the Studio is open. One level of nested includes, like the stage.
 */
/* global importScripts, VN */
'use strict';

var engineError = null;
try { importScripts('../55-paper-theatre/vn.js'); } catch (e) { engineError = String(e && e.message || e); }

var STORIES = '../55-paper-theatre/stories/';
var includeCache = {};      // name -> text, or null when the file is missing
var pending = null;         // the latest request while one is being handled
var busy = false;

function includeNames(text) {
	var names = [];
	String(text).replace(/^\s*@include\s+(\S+)/gm, function (m, p) { if (names.indexOf(p) < 0) names.push(p); return m; });
	return names;
}

function fetchOne(name) {
	if (Object.prototype.hasOwnProperty.call(includeCache, name)) return Promise.resolve(includeCache[name]);
	return fetch(STORIES + name).then(function (r) {
		if (!r.ok) { if (r.body && r.body.cancel) r.body.cancel(); return null; }
		return r.text();
	}).catch(function () { return null; }).then(function (t) { includeCache[name] = t; return t; });
}

function fetchIncludes(text) {
	var names = includeNames(text), out = {};
	return Promise.all(names.map(function (n) {
		return fetchOne(n).then(function (t) {
			if (t == null) return null;
			out[n] = t;
			var nested = includeNames(t).filter(function (q) { return !(q in out) && names.indexOf(q) < 0; });
			return Promise.all(nested.map(function (q) { return fetchOne(q).then(function (u) { if (u != null) out[q] = u; }); }));
		});
	})).then(function () { return out; });
}

function byLine(a, b) { return (a.line - b.line) || (a.level === b.level ? 0 : a.level === 'fatal' ? -1 : 1); }

function handle(req) {
	var t0 = Date.now();
	if (engineError || typeof VN === 'undefined') {
		postMessage({ type: 'error', version: req.version, message: 'The Paper Theatre engine (vn.js) could not be loaded in the worker' + (engineError ? ': ' + engineError : '') });
		return Promise.resolve();
	}
	return fetchIncludes(req.text).then(function (includes) {
		var program = VN.parse(req.text, { id: req.id || 'studio', includes: includes });
		var issues = VN.lint(program);
		var walk = null;
		if (!issues.some(function (i) { return i.level === 'fatal'; })) {
			walk = VN.walk(program);
			var seen = {};
			issues.forEach(function (i) { seen[i.code + ':' + i.line + ':' + i.msg] = 1; });
			(walk.issues || []).forEach(function (i) { if (!seen[i.code + ':' + i.line + ':' + i.msg]) issues.push(i); });
			issues.sort(byLine);
		}
		postMessage({ type: 'program', program: JSON.parse(JSON.stringify(program)), issues: issues, walk: walk, version: req.version, ms: Date.now() - t0 });
	}).catch(function (err) {
		postMessage({ type: 'error', version: req.version, message: String(err && err.message || err) });
	});
}

function next() {
	if (busy || !pending) return;
	var req = pending; pending = null; busy = true;
	handle(req).then(function () { busy = false; next(); });
}

onmessage = function (ev) {
	var m = ev.data;
	if (!m || m.type !== 'lint') return;
	pending = m;     // only the newest text matters
	next();
};
