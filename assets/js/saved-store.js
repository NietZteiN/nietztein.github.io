// One local collection, backed by the existing experiment favorites and reading
// list keys. This module never fetches content or writes a second copy of notes.
(function () {
	'use strict';
	var KEYS = { site: 'site.saved.v1', book: 'bookshelf.reading-list.v1', experiment: 'misc.favorites.v1' };
	var KINDS = ['post', 'publication', 'book', 'experiment'];
	function valid(kind, id) {
		if (KINDS.indexOf(kind) === -1 || typeof id !== 'string' || !id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id)) return false;
		return kind === 'book' ? id.trim() === id : /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
	}
	function clone(value) { return JSON.parse(JSON.stringify(value)); }
	function providerFor(kind) { return kind === 'book' || kind === 'experiment' ? kind : 'site'; }
	function empty(name) { return name === 'experiment' ? [] : { version: 1, items: [] }; }
	function source(options) { return options && typeof options.source === 'string' ? options.source : 'saved-store'; }

	function createStore(options) {
		options = options || {};
		var listeners = [], states = {};
		Object.keys(KEYS).forEach(function (name) {
			states[name] = { name: name, key: KEYS[name], payload: empty(name), baseline: empty(name), pending: Object.create(null), lastRead: null, dirty: false, corrupt: false, issue: '' };
		});
		function storage() {
			try { return typeof options.storage === 'function' ? options.storage() : options.storage; }
			catch (e) { return null; }
		}
		function list(state) { return state.name === 'experiment' ? state.payload : state.payload.items; }
		function tokenFor(name, raw) {
			var kind = name === 'site' ? raw && raw.kind : name;
			if (name === 'site' && kind !== 'post' && kind !== 'publication') return '';
			var id = kind === 'experiment' ? raw : raw && raw.id;
			return valid(kind, id) ? kind + ':' + id : '';
		}
		function itemMap(name, rows) {
			var result = Object.create(null);
			rows.forEach(function (raw, position) {
				var token = tokenFor(name, raw);
				if (token && !result[token]) result[token] = { raw: raw, position: position };
			});
			return result;
		}
		function mergeRecord(base, local, remote) {
			if (!remote || typeof local !== 'object' || local === null) return clone(local);
			var result = clone(remote);
			if (!base) {
				// A pending Save and a remote Save may describe the same book.
				// Keep the remote record, but retain any locally authored note.
				if (typeof local.note === 'string' && local.note) result.note = local.note;
				return result;
			}
			Object.keys(base).concat(Object.keys(local)).filter(function (prop, index, all) { return all.indexOf(prop) === index; }).forEach(function (prop) {
				if (JSON.stringify(base[prop]) === JSON.stringify(local[prop])) return;
				if (Object.prototype.hasOwnProperty.call(local, prop)) {
					Object.defineProperty(result, prop, { value: clone(local[prop]), enumerable: true, configurable: true, writable: true });
				} else delete result[prop];
			});
			return result;
		}
		function rememberChanges(state, before) {
			var name = state.name, old = itemMap(name, name === 'experiment' ? before : before.items);
			var current = itemMap(name, list(state));
			var base = itemMap(name, name === 'experiment' ? state.baseline : state.baseline.items);
			Object.keys(old).concat(Object.keys(current)).filter(function (token, index, all) { return all.indexOf(token) === index; }).forEach(function (token) {
				if (old[token] && current[token] && JSON.stringify(old[token].raw) === JSON.stringify(current[token].raw)) return;
				if (!current[token]) state.pending[token] = { remove: true };
				else state.pending[token] = { raw: clone(current[token].raw), base: base[token] ? clone(base[token].raw) : null, position: current[token].position };
			});
		}
		function rebase(state, remote) {
			var name = state.name, rows = clone(name === 'experiment' ? remote : remote.items);
			// Keep explicit local intentions until a write succeeds. A remote
			// snapshot agreeing temporarily must not acknowledge an unwritten
			// removal, addition, or note edit. Remote-only changes are not journaled.
			Object.keys(state.pending).forEach(function (token) {
				if (state.pending[token].remove) rows = rows.filter(function (raw) { return tokenFor(name, raw) !== token; });
			});
			Object.keys(state.pending).forEach(function (token) {
				var operation = state.pending[token]; if (operation.remove) return;
				var position = -1;
				rows.some(function (raw, index) { if (tokenFor(name, raw) === token) { position = index; return true; } return false; });
				if (position < 0) rows.splice(Math.min(operation.position, rows.length), 0, clone(operation.raw));
				else rows[position] = mergeRecord(operation.base, operation.raw, rows[position]);
			});
			if (name === 'experiment') return rows;
			var result = clone(remote); result.items = rows; return result;
		}
		function parse(state, raw) {
			if (raw === null || raw === '') return empty(state.name);
			var value = JSON.parse(raw);
			if (state.name === 'experiment') {
				if (!Array.isArray(value)) throw new Error('Invalid experiment collection');
			} else if (!value || value.version !== 1 || !Array.isArray(value.items)) throw new Error('Invalid saved collection');
			return value;
		}
		function read(state) {
			var savedStorage = storage(), raw;
			if (!savedStorage) { state.issue = 'unavailable'; return; }
			try {
				raw = savedStorage.getItem(state.key);
				// Do not replace a newer, memory-only change with the same stale disk
				// value after a quota/privacy failure or a legacy bridge update.
				if (state.dirty && raw === state.lastRead) return;
				var remote = parse(state, raw);
				state.corrupt = false;
				if (state.dirty) {
					state.payload = rebase(state, remote);
					state.baseline = clone(remote); state.lastRead = raw;
					state.issue = 'write-failed';
				} else {
					state.payload = remote; state.baseline = clone(remote);
					state.lastRead = raw; state.issue = '';
				}
			} catch (e) {
				if (raw !== undefined) state.corrupt = true;
				state.issue = state.corrupt ? 'corrupt' : 'unavailable';
				if (raw !== undefined) state.lastRead = raw;
				// Keep unreadable bytes intact. A new collection can still work in
				// memory and be exported without overwriting potentially useful data.
			}
		}
		function refreshStates() { Object.keys(states).forEach(function (name) { read(states[name]); }); }
		function record(kind, raw, position) {
			var id = kind === 'experiment' ? raw : raw && raw.id;
			if (!valid(kind, id)) return null;
			var result = { kind: kind, id: id };
			if (kind !== 'experiment') {
				result.addedAt = typeof raw.addedAt === 'string' ? raw.addedAt : '';
				if (kind === 'book' || typeof raw.note === 'string') result.note = typeof raw.note === 'string' ? raw.note : '';
			}
			if (typeof position === 'number') result.position = position;
			return result;
		}
		function snapshot() {
			var result = [], seen = Object.create(null);
			Object.keys(states).forEach(function (name) {
				list(states[name]).forEach(function (raw, index) {
					var kind = name === 'site' ? raw && raw.kind : name;
					if (name === 'site' && kind !== 'post' && kind !== 'publication') return;
					var item = record(kind, raw, index), token = item && item.kind + ':' + item.id;
					if (item && !seen[token]) { seen[token] = true; result.push(item); }
				});
			});
			return result;
		}
		function status() {
			var issues = Object.keys(states).filter(function (name) { return !!states[name].issue || states[name].dirty; }).map(function (name) {
				return { provider: name, key: states[name].key, reason: states[name].corrupt ? 'corrupt' : states[name].issue || 'write-failed' };
			});
			return { persistent: !issues.length, issues: issues };
		}
		function signature() { return JSON.stringify([snapshot(), status()]); }
		function changeKeys(before, after) {
			var values = Object.create(null), changed = [], seen = Object.create(null);
			before.forEach(function (item) { values[item.kind + ':' + item.id] = JSON.stringify(item); });
			after.forEach(function (item) {
				var token = item.kind + ':' + item.id; seen[token] = true;
				if (values[token] !== JSON.stringify(item)) changed.push({ kind: item.kind, id: item.id });
			});
			before.forEach(function (item) { if (!seen[item.kind + ':' + item.id]) changed.push({ kind: item.kind, id: item.id }); });
			return changed;
		}
		function notify(before, previous, opts) {
			if (signature() === previous) return;
			var items = snapshot(), detail = { source: source(opts), items: items, changed: changeKeys(before, items), persistent: status().persistent };
			listeners.slice().forEach(function (listener) { try { listener(clone(detail)); } catch (e) { /* One view cannot break another. */ } });
			if (typeof options.dispatch === 'function') options.dispatch(clone(detail));
		}
		function persist(state, before) {
			if (before) rememberChanges(state, before);
			var savedStorage = storage();
			if (state.corrupt) { state.dirty = true; state.issue = 'corrupt'; return; }
			if (!savedStorage) { state.dirty = true; state.issue = 'unavailable'; return; }
			try {
				var raw = JSON.stringify(state.payload);
				savedStorage.setItem(state.key, raw);
				state.lastRead = raw; state.baseline = clone(state.payload); state.pending = Object.create(null); state.dirty = false; state.issue = '';
			} catch (e) { state.dirty = true; state.issue = 'write-failed'; }
		}
		function get(kind, id) {
			var result = snapshot().filter(function (item) { return item.kind === kind && item.id === id; })[0];
			return result || null;
		}
		function writeItem(item) {
			var state = states[providerFor(item.kind)], items = list(state), raw;
			if (item.kind === 'experiment') raw = item.id;
			else {
				raw = { id: item.id };
				if (item.kind !== 'book') raw.kind = item.kind;
				raw.addedAt = typeof item.addedAt === 'string' ? item.addedAt : (options.now ? options.now() : new Date().toISOString());
				if (item.kind === 'book' || typeof item.note === 'string') raw.note = typeof item.note === 'string' ? item.note : '';
			}
			var position = typeof item.position === 'number' && isFinite(item.position) ? Math.max(0, Math.min(items.length, Math.floor(item.position))) : items.length;
			items.splice(position, 0, raw);
			return state;
		}
		function erase(kind, id) {
			var state = states[providerFor(kind)], items = list(state);
			for (var i = items.length - 1; i >= 0; i--) {
				var raw = items[i];
				if (kind === 'experiment' ? raw === id : raw && raw.id === id && (kind === 'book' || raw.kind === kind)) items.splice(i, 1);
			}
			return state;
		}
		function refresh(opts) {
			var before = snapshot(), previous = signature(); refreshStates();
			Object.keys(states).forEach(function (name) { if (states[name].dirty) persist(states[name]); });
			notify(before, previous, opts); return snapshot();
		}
		function toggle(kind, id, opts) {
			if (!valid(kind, id)) return false;
			var before = snapshot(), previous = signature(); refreshStates();
			var existing = get(kind, id), state = states[providerFor(kind)], prior = clone(state.payload);
			if (existing) state = erase(kind, id);
			else state = writeItem({ kind: kind, id: id, note: opts && opts.note, addedAt: opts && opts.addedAt });
			persist(state, prior); notify(before, previous, opts); return !existing;
		}
		function remove(kind, id, opts) {
			if (!valid(kind, id)) return null;
			var before = snapshot(), previous = signature(); refreshStates(); var existing = get(kind, id);
			var prior = clone(states[providerFor(kind)].payload);
			if (existing) persist(erase(kind, id), prior);
			notify(before, previous, opts); return existing;
		}
		function restore(items, opts) {
			var before = snapshot(), previous = signature(), touched = {}, prior = {}, added = 0, existing = Object.create(null); refreshStates();
			snapshot().forEach(function (item) { existing[item.kind + ':' + item.id] = true; });
			(Array.isArray(items) ? items : []).forEach(function (item) {
				if (!item || !valid(item.kind, item.id) || existing[item.kind + ':' + item.id]) return;
				var name = providerFor(item.kind); if (!prior[name]) prior[name] = clone(states[name].payload);
				var state = writeItem(item); touched[state.name] = state; existing[item.kind + ':' + item.id] = true; added++;
			});
			Object.keys(touched).forEach(function (name) { persist(touched[name], prior[name]); }); notify(before, previous, opts); return added;
		}
		function clear(opts) {
			var before = snapshot(), previous = signature(), touched = {}, prior = {}, removed = []; refreshStates();
			var chosen = opts && Array.isArray(opts.items) ? opts.items : snapshot();
			var original = Object.create(null);
			snapshot().forEach(function (item) { original[item.kind + ':' + item.id] = item; });
			chosen.forEach(function (item) {
				if (!item || !valid(item.kind, item.id)) return;
				var existing = get(item.kind, item.id); if (!existing) return;
				var name = providerFor(item.kind); if (!prior[name]) prior[name] = clone(states[name].payload);
				removed.push(original[item.kind + ':' + item.id]); var state = erase(item.kind, item.id); touched[state.name] = state;
			});
			Object.keys(touched).forEach(function (name) { persist(touched[name], prior[name]); }); notify(before, previous, opts); return removed;
		}
		function adoptLegacy(kind, records, opts) {
			if ((kind !== 'book' && kind !== 'experiment') || !Array.isArray(records)) return;
			var before = snapshot(), previous = signature(), state = states[kind], prior = clone(state.payload);
			if (kind === 'experiment') state.payload = clone(records);
			else { state.payload.items = clone(records); }
			var persistent = !!(opts && opts.persistent);
			if (persistent && state.corrupt) {
				try { var currentRaw = storage().getItem(state.key); parse(state, currentRaw); state.corrupt = false; }
				catch (e) { persistent = false; }
			}
			state.dirty = !persistent; state.issue = state.corrupt ? 'corrupt' : persistent ? '' : 'write-failed';
			if (persistent) {
				state.baseline = clone(state.payload); state.pending = Object.create(null);
				try { state.lastRead = storage().getItem(state.key); }
				catch (e) { state.lastRead = JSON.stringify(state.payload); }
			} else rememberChanges(state, prior);
			notify(before, previous, opts);
		}
		refreshStates();
		return {
			ready: function () { return Promise.resolve(); }, valid: valid, snapshot: snapshot, get: get,
			has: function (kind, id) { return !!get(kind, id); }, toggle: toggle, remove: remove, restore: restore,
			refresh: refresh, clear: clear, adoptLegacy: adoptLegacy, status: status,
			subscribe: function (listener) {
				if (typeof listener !== 'function') return function () {};
				listeners.push(listener);
				return function () { var at = listeners.indexOf(listener); if (at !== -1) listeners.splice(at, 1); };
			}
		};
	}
	if (typeof module !== 'undefined' && module.exports) { module.exports = { createStore: createStore, valid: valid, keys: KEYS }; return; }
	if (typeof window === 'undefined' || window.SavedStore) return;
	window.SavedStore = createStore({ storage: function () { return window.localStorage; }, dispatch: function (detail) {
		document.dispatchEvent(new CustomEvent('saved:change', { detail: detail }));
	} });
	window.addEventListener('storage', function (event) {
		if (event.key === null || Object.keys(KEYS).some(function (name) { return KEYS[name] === event.key; })) window.SavedStore.refresh({ source: 'storage' });
	});
})();
