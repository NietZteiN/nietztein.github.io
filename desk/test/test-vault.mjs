// Tests for desk/vault.js. Run with: node desk/test/test-vault.mjs
// Prints PASS/FAIL lines; exit code 1 on any failure.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Vault = require('../vault.js');

let failed = 0;
let count = 0;
function check(name, ok, detail = '') {
	count++;
	if (!ok) failed++;
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ' : ' + detail : ''}`);
}
async function rejects(promise) {
	try {
		await promise;
		return null;
	} catch (e) {
		return e;
	}
}

// Not a real token: the fake server's spelling.
const TOKEN = 'github_pat_FAKE_owner_full';
const PASS = 'correct horse battery staple';
const session = { token: TOKEN, login: 'NietZteiN', priv: { owner: 'NietZteiN', repo: 'desk', branch: 'main' } };

const t0 = Date.now();
const made = await Vault.newRecord(PASS, session, { who: 'NietZteiN' });
const deriveMs = Date.now() - t0;
const record = made.record;
const stored = JSON.stringify(record);

// ---- parameters -----------------------------------------------------------
check('record: PBKDF2 with SHA-256', record.kdf.name === 'PBKDF2' && record.kdf.hash === 'SHA-256');
check('record: at least 600,000 iterations', record.kdf.iterations >= 600000 && Vault.MIN_ITERATIONS >= 600000, String(record.kdf.iterations));
check('record: 16-byte random salt', Vault.fromBase64(record.kdf.salt).length === 16);
check('record: 12-byte IV', Vault.fromBase64(record.session.iv).length === 12);
check('record: ciphertext is plaintext + 16-byte tag', Vault.fromBase64(record.session.ct).length === Buffer.byteLength(JSON.stringify(session)) + 16);
check('record: the token text is nowhere in what gets stored', !stored.includes(TOKEN) && !stored.includes('github_pat') && !stored.includes(PASS));
check('record: the stored text does not contain the token in base64 either', !stored.includes(Buffer.from(TOKEN).toString('base64').slice(0, 16)));
check('keys: AES-GCM 256 and HMAC, both non-extractable', made.keys.enc.algorithm.name === 'AES-GCM' && made.keys.enc.algorithm.length === 256 && made.keys.enc.extractable === false && made.keys.mac.algorithm.name === 'HMAC' && made.keys.mac.extractable === false);
check('keys: the encryption key cannot be exported', (await rejects(crypto.subtle.exportKey('raw', made.keys.enc))) !== null);

const second = await Vault.newRecord(PASS, session);
check('two records of the same passphrase and token share no salt, IV or ciphertext', second.record.kdf.salt !== record.kdf.salt && second.record.session.iv !== record.session.iv && second.record.session.ct !== record.session.ct);
check('fewer than 600,000 iterations are refused when making a record', (await rejects(Vault.newRecord(PASS, session, { iterations: 100000 })))?.name === 'BadVault');

// ---- round trip -------------------------------------------------------------
const opened = await Vault.openRecord(PASS, Vault.parseRecord(stored));
check('round trip: the session comes back whole', JSON.stringify(opened.session) === JSON.stringify(session));
check('round trip: NFKC, a composed and a decomposed passphrase are the same', await (async () => {
	const a = await Vault.newRecord('café au lait 1234', session);
	const b = await Vault.openRecord('café au lait 1234', a.record);
	return b.session.token === TOKEN;
})());

// ---- wrong passphrase -------------------------------------------------------
const wrong = await rejects(Vault.openRecord('correct horse battery stapl', record));
check('wrong passphrase: rejected as WrongPassphrase', wrong instanceof Vault.WrongPassphrase && wrong.name === 'WrongPassphrase');
check('wrong passphrase: the error reveals nothing', wrong && !wrong.message.includes(TOKEN) && !wrong.message.includes('stapl') && !/github_pat/.test(String(wrong.stack)));
check('empty passphrase: rejected', (await rejects(Vault.openRecord('', record))) instanceof Vault.WrongPassphrase);

// ---- tampering --------------------------------------------------------------
function flip(b64, index) {
	const bytes = Buffer.from(b64, 'base64');
	bytes[index] ^= 1;
	return bytes.toString('base64');
}
const clone = () => JSON.parse(stored);
let t = clone();
t.session.ct = flip(t.session.ct, 3);
check('tampered ciphertext: rejected', (await rejects(Vault.openRecord(PASS, t))) instanceof Vault.WrongPassphrase);
t = clone();
t.session.ct = flip(t.session.ct, Buffer.from(t.session.ct, 'base64').length - 1);
check('tampered tag: rejected', (await rejects(Vault.openRecord(PASS, t))) instanceof Vault.WrongPassphrase);
t = clone();
t.session.iv = flip(t.session.iv, 0);
check('tampered IV: rejected', (await rejects(Vault.openRecord(PASS, t))) instanceof Vault.WrongPassphrase);
t = clone();
t.kdf.salt = flip(t.kdf.salt, 0);
check('tampered salt: rejected', (await rejects(Vault.openRecord(PASS, t))) instanceof Vault.WrongPassphrase);
t = clone();
t.kdf.iterations = 1000;
check('iterations lowered to 1000: refused before any work', (await rejects(Vault.openRecord(PASS, t)))?.name === 'BadVault');
t = clone();
t.kdf.iterations = 600001;
check('iterations changed: the key no longer fits', (await rejects(Vault.openRecord(PASS, t))) instanceof Vault.WrongPassphrase);
t = clone();
t.kdf.hash = 'SHA-1';
check('hash changed to SHA-1: refused', (await rejects(Vault.openRecord(PASS, t)))?.name === 'BadVault');
t = clone();
t.kdf.salt = Buffer.alloc(4).toString('base64');
check('4-byte salt: refused', (await rejects(Vault.openRecord(PASS, t)))?.name === 'BadVault');
t = clone();
t.session.iv = Buffer.alloc(8).toString('base64');
check('8-byte IV: refused', (await rejects(Vault.openRecord(PASS, t)))?.name === 'BadVault');
t = clone();
t.v = 2;
check('unknown version: refused', (await rejects(Vault.openRecord(PASS, t)))?.name === 'BadVault');
check('parseRecord: not JSON is refused', (() => { try { Vault.parseRecord('{nope'); return false; } catch (e) { return e.name === 'BadVault'; } })());
check('parseRecord: nothing stored gives null', Vault.parseRecord(null) === null && Vault.parseRecord('') === null);

// ---- secrets ----------------------------------------------------------------
let r2 = await Vault.setSecret(record, made.keys, 'goatcounter', 'FAKE-goat-token-123');
check('secret: stored encrypted', !JSON.stringify(r2).includes('FAKE-goat-token-123') && !!r2.secrets.goatcounter);
check('secret: read back with the same keys', (await Vault.getSecret(r2, opened.keys, 'goatcounter')) === 'FAKE-goat-token-123');
check('secret: a missing one is null', (await Vault.getSecret(r2, opened.keys, 'nope')) === null);
check('secret: setting does not change the record passed in', !record.secrets.goatcounter);
// A sealed value is bound to its name: the session box cannot be read as a secret.
const swapped = JSON.parse(JSON.stringify(r2));
swapped.secrets.goatcounter = swapped.session;
check('secret: a box moved to another name does not open', (await rejects(Vault.getSecret(swapped, opened.keys, 'goatcounter'))) instanceof Vault.WrongPassphrase);
const otherKeys = (await Vault.newRecord('another passphrase entirely', session)).keys;
check('secret: another passphrase cannot read it', (await rejects(Vault.getSecret(r2, otherKeys, 'goatcounter'))) instanceof Vault.WrongPassphrase);
r2 = await Vault.setSecret(r2, made.keys, 'goatcounter', null);
check('secret: setting null removes it', !('goatcounter' in r2.secrets));

// ---- session replaced (a new token under the same passphrase) --------------
const r3 = await Vault.setSession(record, made.keys, { ...session, token: 'github_pat_FAKE_owner_readonly' });
check('setSession: the same passphrase opens the new session', (await Vault.openRecord(PASS, r3)).session.token === 'github_pat_FAKE_owner_readonly');
check('setSession: the KDF parameters are kept', r3.kdf.salt === record.kdf.salt && r3.session.ct !== record.session.ct);

// ---- names for the local cache ---------------------------------------------
const m1 = await Vault.mac(made.keys, 'notes/inbox/a.md');
const m2 = await Vault.mac(opened.keys, 'notes/inbox/a.md');
const m3 = await Vault.mac(made.keys, 'notes/inbox/b.md');
check('mac: same key and text give the same 64 hex digits', m1 === m2 && /^[0-9a-f]{64}$/.test(m1));
check('mac: another text or another key gives another value', m1 !== m3 && (await Vault.mac(otherKeys, 'notes/inbox/a.md')) !== m1);

// ---- the passphrase guide ----------------------------------------------------
check('judge: short is refused', Vault.judgePassphrase('abc12345').ok === false);
check('judge: repetitive is refused', Vault.judgePassphrase('aaaaaaaaaaaaaa').ok === false);
check('judge: four words are fine', Vault.judgePassphrase(PASS).ok === true);

console.log(`${count - failed} of ${count} passed (one key derivation at ${record.kdf.iterations} rounds took ${deriveMs} ms here)`);
process.exit(failed ? 1 : 0);
