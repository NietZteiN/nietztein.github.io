// Desk vault: keeps the GitHub token (and other secrets) encrypted at rest.
//
//   passphrase --PBKDF2-SHA-256, 600,000 rounds, random 16-byte salt--> 256 bits
//   256 bits   --HKDF-SHA-256, two labels--> an AES-256-GCM key and an HMAC key
//   every sealed value has its own random 12-byte IV, and its name is bound in
//   as additional data, so one sealed value cannot be passed off as another.
//
// Everything is WebCrypto. The derived keys are non-extractable CryptoKey
// objects that live in memory only; what goes to localStorage is the "record"
// below, which holds nothing but parameters and ciphertext.
//
//   record = { v: 1, kdf: { name, hash, iterations, salt }, session: { iv, ct },
//              secrets: { <name>: { iv, ct } }, who: '<login, for the lock screen>' }
//
// Loads in the browser (window.DeskVault) and in Node (module.exports), where
// desk/test/test-vault.mjs exercises it.

(function (root, factory) {
	'use strict';
	var api = factory(root);
	if (typeof module === 'object' && module.exports) module.exports = api;
	else root.DeskVault = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (root) {
	'use strict';

	var VERSION = 1;
	var MIN_ITERATIONS = 600000;
	var SALT_BYTES = 16;
	var IV_BYTES = 12;
	var AAD_PREFIX = 'desk:v1:';

	function subtle() {
		var c = root.crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
		if (!c || !c.subtle) {
			throw new BadVault('This browser has no WebCrypto here. The Desk needs https (or localhost).');
		}
		return c.subtle;
	}

	function randomBytes(n) {
		var c = root.crypto || globalThis.crypto;
		var out = new Uint8Array(n);
		c.getRandomValues(out);
		return out;
	}

	// ---- errors -------------------------------------------------------------

	function WrongPassphrase() {
		var e = new Error('That passphrase does not open the Desk on this device.');
		e.name = 'WrongPassphrase';
		Object.setPrototypeOf(e, WrongPassphrase.prototype);
		return e;
	}
	WrongPassphrase.prototype = Object.create(Error.prototype);
	WrongPassphrase.prototype.constructor = WrongPassphrase;

	function BadVault(message) {
		var e = new Error(message || 'The saved sign-in on this device is damaged.');
		e.name = 'BadVault';
		Object.setPrototypeOf(e, BadVault.prototype);
		return e;
	}
	BadVault.prototype = Object.create(Error.prototype);
	BadVault.prototype.constructor = BadVault;

	// ---- bytes and text -----------------------------------------------------

	function utf8(text) {
		return new TextEncoder().encode(String(text));
	}

	function fromUtf8(bytes) {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	}

	function toBase64(bytes) {
		var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
		var s = '';
		for (var i = 0; i < u8.length; i += 0x8000) {
			s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
		}
		return btoa(s);
	}

	function fromBase64(text) {
		if (typeof text !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new BadVault();
		var s;
		try {
			s = atob(text);
		} catch (e) {
			throw new BadVault();
		}
		var out = new Uint8Array(s.length);
		for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
		return out;
	}

	function toHex(bytes) {
		var u8 = new Uint8Array(bytes);
		var s = '';
		for (var i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16);
		return s;
	}

	// The same passphrase typed on a phone and on a laptop must give the same
	// bytes, whatever the keyboard does with accents.
	function passphraseBytes(passphrase) {
		var s = String(passphrase == null ? '' : passphrase);
		if (s.normalize) s = s.normalize('NFKC');
		return utf8(s);
	}

	// ---- parameters ---------------------------------------------------------

	function newHeader(iterations) {
		var n = iterations == null ? MIN_ITERATIONS : iterations;
		if (!(n >= MIN_ITERATIONS) || Math.floor(n) !== n) {
			throw new BadVault('The Desk never uses fewer than ' + MIN_ITERATIONS + ' PBKDF2 rounds.');
		}
		return { name: 'PBKDF2', hash: 'SHA-256', iterations: n, salt: toBase64(randomBytes(SALT_BYTES)) };
	}

	// Refuses parameters weaker than, or different from, the ones this code
	// writes: a record someone edited cannot talk the Desk into a cheap key.
	function checkHeader(kdf) {
		if (!kdf || typeof kdf !== 'object') throw new BadVault();
		if (kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256') {
			throw new BadVault('The saved sign-in uses a key derivation this Desk does not accept.');
		}
		if (typeof kdf.iterations !== 'number' || !(kdf.iterations >= MIN_ITERATIONS) || kdf.iterations > 50000000 || Math.floor(kdf.iterations) !== kdf.iterations) {
			throw new BadVault('The saved sign-in uses fewer key-derivation rounds than this Desk accepts.');
		}
		var salt = fromBase64(kdf.salt);
		if (salt.length < SALT_BYTES) throw new BadVault('The saved sign-in has a salt that is too short.');
		return salt;
	}

	function checkBox(box) {
		if (!box || typeof box !== 'object' || typeof box.iv !== 'string' || typeof box.ct !== 'string') throw new BadVault();
		var iv = fromBase64(box.iv);
		var ct = fromBase64(box.ct);
		if (iv.length !== IV_BYTES || ct.length < 16) throw new BadVault();
		return { iv: iv, ct: ct };
	}

	// ---- keys ---------------------------------------------------------------

	// passphrase + header -> { enc, mac }. Both keys are non-extractable.
	function deriveKeys(passphrase, kdf) {
		var s;
		var salt;
		try {
			s = subtle();
			salt = checkHeader(kdf);
		} catch (e) {
			return Promise.reject(e);
		}
		var pw = passphraseBytes(passphrase);
		var bits = null;
		return s
			.importKey('raw', pw, 'PBKDF2', false, ['deriveBits'])
			.then(function (base) {
				return s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: kdf.iterations }, base, 256);
			})
			.then(function (derived) {
				bits = new Uint8Array(derived);
				return s.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
			})
			.then(function (master) {
				var none = new Uint8Array(32);
				return Promise.all([
					s.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: none, info: utf8('desk v1 encryption') }, master, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
					s.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: none, info: utf8('desk v1 names') }, master, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']),
				]);
			})
			.then(function (pair) {
				pw.fill(0);
				if (bits) bits.fill(0);
				return { enc: pair[0], mac: pair[1] };
			});
	}

	// ---- sealing ------------------------------------------------------------

	function sealBytes(keys, name, bytes) {
		var iv = randomBytes(IV_BYTES);
		return subtle()
			.encrypt({ name: 'AES-GCM', iv: iv, additionalData: utf8(AAD_PREFIX + name) }, keys.enc, bytes)
			.then(function (ct) {
				return { iv: iv, ct: new Uint8Array(ct) };
			});
	}

	function unsealBytes(keys, name, iv, ct) {
		return subtle()
			.decrypt({ name: 'AES-GCM', iv: iv, additionalData: utf8(AAD_PREFIX + name) }, keys.enc, ct)
			.then(
				function (plain) {
					return new Uint8Array(plain);
				},
				function () {
					// A wrong key and altered data fail the same way, on purpose.
					throw new WrongPassphrase();
				}
			);
	}

	// text -> { iv, ct } in base64, bound to `name`.
	function seal(keys, name, text) {
		return sealBytes(keys, name, utf8(text)).then(function (box) {
			return { iv: toBase64(box.iv), ct: toBase64(box.ct) };
		});
	}

	function unseal(keys, name, box) {
		var parts;
		try {
			parts = checkBox(box);
		} catch (e) {
			return Promise.reject(e);
		}
		return unsealBytes(keys, name, parts.iv, parts.ct).then(function (bytes) {
			return fromUtf8(bytes);
		});
	}

	// A keyed fingerprint of a name, so the local cache can be looked up by
	// key without storing the key in the clear.
	function mac(keys, text) {
		return subtle()
			.sign('HMAC', keys.mac, utf8(text))
			.then(function (sig) {
				return toHex(sig);
			});
	}

	// ---- the record kept in localStorage ----------------------------------

	// session is a small object: { token, login, priv: { owner, repo, branch } }.
	function newRecord(passphrase, session, opts) {
		var kdf;
		try {
			kdf = newHeader(opts && opts.iterations);
		} catch (e) {
			return Promise.reject(e);
		}
		var keys;
		return deriveKeys(passphrase, kdf)
			.then(function (k) {
				keys = k;
				return seal(keys, 'session', JSON.stringify(session));
			})
			.then(function (box) {
				return {
					keys: keys,
					record: { v: VERSION, kdf: kdf, session: box, secrets: {}, who: String((opts && opts.who) || '') },
				};
			});
	}

	function checkRecord(record) {
		if (!record || typeof record !== 'object' || record.v !== VERSION) {
			throw new BadVault('The saved sign-in on this device is damaged or comes from another version of the Desk.');
		}
		checkHeader(record.kdf);
		checkBox(record.session);
	}

	function parseRecord(text) {
		if (!text) return null;
		var record;
		try {
			record = JSON.parse(text);
		} catch (e) {
			throw new BadVault();
		}
		checkRecord(record);
		return record;
	}

	// -> { keys, session }. Rejects with WrongPassphrase or BadVault.
	function openRecord(passphrase, record) {
		try {
			checkRecord(record);
		} catch (e) {
			return Promise.reject(e);
		}
		var keys;
		return deriveKeys(passphrase, record.kdf)
			.then(function (k) {
				keys = k;
				return unseal(keys, 'session', record.session);
			})
			.then(function (text) {
				var session;
				try {
					session = JSON.parse(text);
				} catch (e) {
					throw new BadVault();
				}
				return { keys: keys, session: session };
			});
	}

	// Each returns a new record object; the caller stores it.
	function setSession(record, keys, session) {
		return seal(keys, 'session', JSON.stringify(session)).then(function (box) {
			var next = copyRecord(record);
			next.session = box;
			return next;
		});
	}

	function setSecret(record, keys, name, value) {
		var next = copyRecord(record);
		if (value == null || value === '') {
			delete next.secrets[name];
			return Promise.resolve(next);
		}
		return seal(keys, 'secret:' + name, String(value)).then(function (box) {
			next.secrets[name] = box;
			return next;
		});
	}

	function getSecret(record, keys, name) {
		var box = record && record.secrets && Object.prototype.hasOwnProperty.call(record.secrets, name) ? record.secrets[name] : null;
		if (!box) return Promise.resolve(null);
		return unseal(keys, 'secret:' + name, box);
	}

	function copyRecord(record) {
		var secrets = {};
		Object.keys(record.secrets || {}).forEach(function (k) {
			secrets[k] = record.secrets[k];
		});
		return { v: record.v, kdf: record.kdf, session: record.session, secrets: secrets, who: record.who || '' };
	}

	// A rough guide for the wizard, not a guarantee: how hard is this to guess?
	// Returns { ok, words } where `words` is one plain sentence.
	function judgePassphrase(passphrase) {
		var s = String(passphrase || '');
		var classes = 0;
		if (/[a-z]/.test(s)) classes++;
		if (/[A-Z]/.test(s)) classes++;
		if (/[0-9]/.test(s)) classes++;
		if (/[^A-Za-z0-9]/.test(s)) classes++;
		var distinct = {};
		for (var i = 0; i < s.length; i++) distinct[s.charAt(i)] = 1;
		var kinds = Object.keys(distinct).length;
		if (s.length < 10) return { ok: false, words: 'Too short: use at least 10 characters. Four unrelated words work well.' };
		if (kinds < 5) return { ok: false, words: 'Too repetitive: use more different characters.' };
		if (/^(?:password|passphrase|qwerty|letmein|12345)/i.test(s)) return { ok: false, words: 'That is one of the first things a guesser tries.' };
		if (s.length >= 20 || (s.length >= 14 && classes >= 3)) return { ok: true, words: 'Good.' };
		return { ok: true, words: 'Acceptable. Longer is better: this is all that protects the token if someone copies this browser\'s storage.' };
	}

	return {
		VERSION: VERSION,
		MIN_ITERATIONS: MIN_ITERATIONS,
		WrongPassphrase: WrongPassphrase,
		BadVault: BadVault,
		newRecord: newRecord,
		openRecord: openRecord,
		parseRecord: parseRecord,
		setSession: setSession,
		setSecret: setSecret,
		getSecret: getSecret,
		deriveKeys: deriveKeys,
		newHeader: newHeader,
		checkHeader: checkHeader,
		seal: seal,
		unseal: unseal,
		sealBytes: sealBytes,
		unsealBytes: unsealBytes,
		mac: mac,
		judgePassphrase: judgePassphrase,
		toBase64: toBase64,
		fromBase64: fromBase64,
	};
});
