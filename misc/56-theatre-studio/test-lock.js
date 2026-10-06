// node misc/56-theatre-studio/test-lock.js : one writer per draft (H.lockState, H.tabId) and the page wiring around it.
'use strict';
var fs = require('fs');
var path = require('path');
var H = require('./studio.js');

var pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }
function eq(a, b, name) { var A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, name + (A === B ? '' : '  got ' + A + ' want ' + B)); }

var STALE = 9000, NOW = 1700000000000;

// ---- the record
eq(H.lockState(null, 't-a', NOW, STALE), 'free', 'no record is free');
eq(H.lockState(undefined, 't-a', NOW, STALE), 'free', 'undefined record is free');
eq(H.lockState('t-b', 't-a', NOW, STALE), 'free', 'a string is not a record');
eq(H.lockState({ tab: 't-b' }, 't-a', NOW, STALE), 'free', 'a record without a time is free');
eq(H.lockState({ tab: 't-b', at: 'soon' }, 't-a', NOW, STALE), 'free', 'a record with a text time is free');
eq(H.lockState({ tab: 't-b', at: NaN }, 't-a', NOW, STALE), 'free', 'NaN time is free');
eq(H.lockState({ tab: 5, at: NOW }, 't-a', NOW, STALE), 'free', 'a numeric tab id is not a record');
eq(H.lockState({ tab: 't-a', at: NOW }, 't-a', NOW, STALE), 'mine', 'this tab\'s own record');
eq(H.lockState({ tab: 't-a', at: NOW - 60000 }, 't-a', NOW, STALE), 'mine', 'own record, however old, is still mine');
eq(H.lockState({ tab: 't-b', at: NOW }, 't-a', NOW, STALE), 'held', 'another tab, just renewed');
eq(H.lockState({ tab: 't-b', at: NOW - 2000 }, 't-a', NOW, STALE), 'held', 'another tab, one beat ago');
eq(H.lockState({ tab: 't-b', at: NOW - 8999 }, 't-a', NOW, STALE), 'held', 'another tab, just inside the limit');
eq(H.lockState({ tab: 't-b', at: NOW - 9000 }, 't-a', NOW, STALE), 'free', 'stale at the limit (a crashed tab)');
eq(H.lockState({ tab: 't-b', at: NOW - 3600000 }, 't-a', NOW, STALE), 'free', 'an hour old is free');
eq(H.lockState({ tab: 't-b', at: NOW + 1000 }, 't-a', NOW, STALE), 'held', 'a little in the future (clock skew) still counts');
eq(H.lockState({ tab: 't-b', at: NOW + 86400000 }, 't-a', NOW, STALE), 'free', 'a day in the future does not lock for ever');

// ---- a heartbeat at LOCK_BEAT keeps the record fresh; LOCK_STALE leaves room for missed beats
var src = fs.readFileSync(path.join(__dirname, 'studio.js'), 'utf8');
var beat = +(/LOCK_BEAT\s*=\s*(\d+)/.exec(src) || [])[1], stale = +(/LOCK_STALE\s*=\s*(\d+)/.exec(src) || [])[1];
ok(beat > 0 && stale >= 4 * beat, 'LOCK_STALE (' + stale + ') allows at least three missed beats of ' + beat + ' ms');
ok(stale <= 15000, 'a crashed tab lets go within 15 s');

// ---- a simulated pair of tabs on one shared store, following the protocol in studio.js
function Store() { this.v = {}; }
function Tab(id, store) { this.id = id; this.s = store; this.state = null; }
Tab.prototype.open = function (k, now) { var st = H.lockState(this.s.v[k], this.id, now, STALE); this.state = st === 'held' ? 'held' : 'own'; if (this.state === 'own') this.s.v[k] = { tab: this.id, at: now }; return this.state; };
Tab.prototype.canWrite = function (k, now) { if (this.state !== 'own') return false; if (H.lockState(this.s.v[k], this.id, now, STALE) === 'held') { this.state = 'lost'; return false; } this.s.v[k] = { tab: this.id, at: now }; return true; };
Tab.prototype.take = function (k, now) { this.state = 'own'; this.s.v[k] = { tab: this.id, at: now }; };
var shared = new Store(), A = new Tab(H.tabId(), shared), B = new Tab(H.tabId(), shared);
eq(A.open('d', NOW), 'own', 'first tab holds the draft');
eq(B.open('d', NOW + 500), 'held', 'second tab opens it read-only');
ok(A.canWrite('d', NOW + 1000), 'first tab may save');
ok(!B.canWrite('d', NOW + 1000), 'second tab may not save');
B.take('d', NOW + 1500);
ok(!A.canWrite('d', NOW + 2000), 'after Take over the first tab may not save');
eq(A.state, 'lost', 'and knows it lost the draft');
ok(B.canWrite('d', NOW + 2000), 'the second tab saves');
var C = new Tab(H.tabId(), shared);
eq(C.open('d', NOW + 2000 + STALE), 'own', 'a third tab takes a draft whose holder stopped beating');

// ---- ids
var ids = {};
for (var i = 0; i < 500; i++) ids[H.tabId()] = 1;
eq(Object.keys(ids).length, 500, '500 tab ids are all different');
ok(/^t-[a-z0-9]{12}$/.test(H.tabId()), 'tab id shape');
var seq = [0.1, 0.5, 0.9], j = 0;
eq(H.tabId(function () { return seq[(j++) % 3]; }), H.tabId((function () { var k = 0; return function () { return seq[(k++) % 3]; }; })()), 'tab id from a given random source is repeatable');

// ---- the page wiring that makes the lock matter
ok(/function commit\(opts\)[\s\S]{0,600}if \(!canWrite\(\)\) return;/.test(src), 'commit checks the lock before it saves');
ok(/addEventListener\('storage', onStorage\)/.test(src), 'the page listens for other tabs\' writes');
ok(/addEventListener\('pagehide'/.test(src), 'closing a tab lets go of its draft');
ok(/refuseReadOnly\(\)\) return;/.test(src), 'panel edits are refused in a read-only tab');
var files = fs.readFileSync(path.join(__dirname, 'files.js'), 'utf8');
ok(/api\.isReadOnly && api\.isReadOnly\(\)/.test(files), 'the Files panel\'s save on leaving respects read-only');
var ed = fs.readFileSync(path.join(__dirname, 'editor.js'), 'utf8');
ok(/if \(ta\.readOnly\)/.test(ed), 'the editor\'s own keys do nothing in a read-only tab');
var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
ok(/id="st-lock-take"/.test(html) && /id="st-lock"[^>]*role="alert"/.test(html), 'the notice and its Take over button are on the page');
ok(!/cannot be undone/i.test(src + html), 'no "cannot be undone" where Undo exists');

console.log((fail ? 'FAIL' : 'PASS') + ' test-lock: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
