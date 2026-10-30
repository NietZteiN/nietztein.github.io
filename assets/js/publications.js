// Progressive publication discovery. index.html remains the source of truth for
// titles, authors, venues and links; the questions below only restate each title.
// Filters live in #/publications?topic=... and never change the printed CV.
(function () {
	'use strict';

	var TOPICS = [
		{ id: 'comprehension', label: 'Code comprehension' },
		{ id: 'adaptation', label: 'Training & unlearning' },
		{ id: 'reasoning', label: 'Reasoning' },
		{ id: 'science', label: 'Science mapping' },
		{ id: 'meaning', label: 'Meaning & representation' }
	];
	var DETAILS = {
		'do-machines-struggle-where-humans-do-obfuscation-as-a-probe-of-human-and-machine-code-comprehension': {
			topics: ['comprehension'],
			question: 'Where do humans and language models struggle when code is deliberately made harder to read?'
		},
		'attributing-gains-in-paired-training-objective-or-data-direction': {
			topics: ['adaptation'],
			question: 'Are gains from paired training tied to the training objective or to the direction of the data?'
		},
		'directional-collapse-in-fine-tuning-preserving-the-way-back': {
			topics: ['adaptation'],
			question: 'How can fine-tuning preserve the ability to work in the reverse direction?'
		},
		'correct-values-can-be-recovered-before-wrong-reasoning-steps': {
			topics: ['reasoning'],
			question: 'When do correct values appear relative to incorrect steps in a model\'s reasoning?'
		},
		'composing-obfuscation-specialists-by-merging': {
			topics: ['comprehension', 'adaptation'],
			question: 'Can models specialized in different code obfuscations be combined by merging?'
		},
		'router-free-modular-storage-for-knowledge-unlearning-in-large-language-models': {
			topics: ['adaptation'],
			question: 'How can modular storage support removing knowledge from language models without a router?'
		},
		'fast-errors-or-slow-effort-divergent-dual-process-signatures-of-code-obfuscation-in-humans-and-language-models': {
			topics: ['comprehension', 'reasoning'],
			question: 'Do code obfuscations produce different patterns of fast errors and slow effort in humans and language models?'
		},
		'extreme-summarization-of-worldwide-scientific-and-patent-document-clusters-for-landscape-analysis': {
			topics: ['science'],
			question: 'How can large groups of scientific and patent documents be condensed for research landscape analysis?'
		},
		'do-machines-struggle-where-humans-do-llm-and-human-comprehension-of-obfuscated-code': {
			topics: ['comprehension'],
			question: 'Do humans and language models find the same kinds of obfuscated code difficult?'
		},
		'the-effect-of-code-obfuscation-on-human-program-comprehension': {
			topics: ['comprehension'],
			question: 'How does deliberately obscuring code affect human understanding?'
		},
		'what-does-an-embedding-mean-a-semiotic-account-of-learned-representation': {
			topics: ['meaning'],
			question: 'What does it mean for a learned numerical representation to carry meaning?'
		},
		'code-as-embedding-as-ai': {
			topics: ['meaning'],
			question: 'How are code, embeddings, and artificial intelligence connected?'
		}
	};

	var section, container, toolbar, count, empty;
	var items = [], groups = [], buttons = [];
	var topic = '';

	function text(node) {
		return node ? String(node.textContent || '').replace(/\s+/g, ' ').trim() : '';
	}

	function slug(value) {
		return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	}

	function el(tag, className, value) {
		var node = document.createElement(tag);
		if (className) node.className = className;
		if (value) node.textContent = value;
		return node;
	}

	function topicLabel(id) {
		for (var i = 0; i < TOPICS.length; i++) {
			if (TOPICS[i].id === id) return TOPICS[i].label;
		}
		return '';
	}

	function readTopic() {
		var match = /^#\/publications\/?(?:\?(.*))?$/.exec(window.location.hash);
		if (!match) return '';
		var params = new URLSearchParams(match[1] || '');
		var value = params.get('topic') || '';
		return topicLabel(value) ? value : '';
	}

	function setTopic(value) {
		topic = value;
		var match = /^#\/publications\/?(?:\?(.*))?$/.exec(window.location.hash);
		var params = new URLSearchParams(match ? match[1] || '' : '');
		if (topic) params.set('topic', topic);
		else params.delete('topic');
		var suffix = params.toString();
		try {
			window.history.replaceState(null, '', '#/publications' + (suffix ? '?' + suffix : ''));
		} catch (e) {
			window.location.hash = '#/publications' + (suffix ? '?' + suffix : '');
		}
		apply();
	}

	function statusFor(category, venue) {
		if (/refereed abstracts/i.test(category)) return { label: 'Peer-reviewed abstract', kind: 'reviewed' };
		if (/workshop papers/i.test(category)) {
			return { label: /non-archival/i.test(venue) ? 'Workshop paper / non-archival' : 'Workshop paper', kind: 'workshop' };
		}
		if (/\bsubmitted\b/i.test(venue)) return { label: 'Submitted / preprint', kind: 'submitted' };
		if (/preprint/i.test(category + ' ' + venue)) return { label: 'Preprint', kind: 'preprint' };
		return { label: category || 'Publication', kind: 'other' };
	}

	function venueText(node) {
		if (!node) return '';
		var copy = node.cloneNode(true);
		Array.prototype.forEach.call(copy.querySelectorAll('a'), function (a) { a.remove(); });
		return text(copy);
	}

	function paperLabel(href) {
		if (/\.pdf(?:[?#]|$)/i.test(href)) return 'Paper (PDF)';
		if (/arxiv\.org\//i.test(href)) return 'arXiv';
		if (/philarchive\.org\//i.test(href)) return 'PhilArchive';
		return 'Paper';
	}

	function action(source, label, title) {
		var a = source.cloneNode(true);
		a.className = 'publication-action';
		a.removeAttribute('id');
		a.textContent = label || text(source);
		a.setAttribute('aria-label', a.textContent + ': ' + title);
		return a;
	}

	function citation(item, title, referenceLink, authors, venue, year) {
		var details = el('details', 'publication-cite');
		var summary = el('summary', '', 'Cite');
		summary.setAttribute('aria-label', 'Citation for ' + title);
		details.appendChild(summary);
		var panel = el('div', 'publication-cite-panel');
		var reference = authors.replace(new RegExp(String.fromCharCode(0x2020), 'g'), '') +
			(year ? ' (' + year + ')' : '') + '. ' + title + '. ' + venue;
		if (referenceLink) {
			var href = referenceLink.getAttribute('href');
			var canonical = document.querySelector('link[rel="canonical"]');
			try { href = new URL(href, canonical ? canonical.href : window.location.href).href; } catch (e) { }
			reference += ' ' + href;
		}
		var field = el('textarea', 'publication-reference');
		field.readOnly = true;
		field.rows = 4;
		field.value = reference;
		field.setAttribute('aria-label', 'Plain-text citation for ' + title);
		var copy = el('button', 'publication-copy', 'Copy citation');
		copy.type = 'button';
		var feedback = el('span', 'publication-copy-feedback');
		feedback.setAttribute('role', 'status');
		function fallback() {
			field.focus();
			field.select();
			var copied = false;
			try { copied = document.execCommand('copy'); } catch (e) { }
			feedback.textContent = copied ? 'Copied.' : 'Citation selected. Copy it with your keyboard or selection menu.';
			if (copied) copy.focus();
		}
		copy.addEventListener('click', function () {
			if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(reference).then(function () {
					feedback.textContent = 'Copied.';
				}, fallback);
			} else fallback();
		});
		panel.appendChild(field);
		panel.appendChild(copy);
		panel.appendChild(feedback);
		details.appendChild(panel);
		item.appendChild(details);
	}

	function enhance(block, category, year) {
		var titleNode = block.querySelector('.lucida-console.h5');
		if (!titleNode) return null;
		var title = text(titleNode);
		var id = slug(title);
		var detail = DETAILS[id];
		var source = block.querySelector('.pub-congress');
		var venue = venueText(source);
		var status = statusFor(category, venue);
		var meta = el('div', 'publication-meta');
		var badge = el('span', 'publication-status is-' + status.kind, status.label);
		meta.appendChild(badge);
		(detail ? detail.topics : []).forEach(function (id) {
			meta.appendChild(el('span', 'publication-topic', topicLabel(id)));
		});
		block.insertBefore(meta, titleNode);
		if (detail) {
			var question = el('p', 'publication-question', detail.question);
			titleNode.parentNode.insertBefore(question, titleNode.nextSibling);
		}
		var actions = el('div', 'publication-actions');
		var paper = titleNode.querySelector('a[href]');
		if (paper) actions.appendChild(action(paper, paperLabel(paper.getAttribute('href')), title));
		if (source) {
			Array.prototype.forEach.call(source.querySelectorAll('a[href]'), function (a) {
				var label = a.classList.contains('pub-play') ? 'Visual novel' : text(a);
				actions.appendChild(action(a, label, title));
			});
		}
		var referenceLink = source && source.querySelector('a[href*="doi.org/"]');
		citation(actions, title, referenceLink || paper, text(block.querySelector('.pub-authors')), venue, year);
		block.appendChild(actions);
		block.setAttribute('data-publication-id', id);
		return { el: block, topics: detail ? detail.topics : [] };
	}

	function apply() {
		var shown = 0;
		items.forEach(function (item) {
			item.el.hidden = !!topic && item.topics.indexOf(topic) === -1;
			if (!item.el.hidden) shown++;
		});
		groups.forEach(function (group) {
			var visible = false;
			group.rows.forEach(function (row) {
				var matches = row.items.some(function (item) { return !item.el.hidden; });
				row.el.hidden = !matches;
				if (matches) visible = true;
			});
			group.heading.hidden = !visible;
		});
		buttons.forEach(function (button) {
			button.setAttribute('aria-pressed', button.getAttribute('data-topic') === topic ? 'true' : 'false');
		});
		count.textContent = (topic ? shown + ' of ' + items.length : String(items.length)) +
			(items.length === 1 ? ' publication' : ' publications');
		empty.hidden = shown !== 0;
	}

	function init() {
		section = document.getElementById('publicationsContent');
		if (!section || section.classList.contains('publications-enhanced')) return;
		container = section.querySelector('.container');
		if (!container) return;
		var group = null;
		Array.prototype.forEach.call(container.children, function (child) {
			if (child.tagName === 'H3') {
				group = { heading: child, category: text(child), rows: [] };
				groups.push(group);
			} else if (group && child.classList.contains('row')) {
				var row = { el: child, items: [] };
				var year = text(child.querySelector('.pub-year-h2'));
				Array.prototype.forEach.call(child.querySelectorAll('.pub-block'), function (block) {
					var item = enhance(block, group.category, year);
					if (item) { items.push(item); row.items.push(item); }
				});
				if (row.items.length) group.rows.push(row);
			}
		});
		if (!items.length) return;
		toolbar = el('div', 'publication-tools');
		var label = el('p', 'publication-tools-label', 'Browse by topic');
		label.id = 'publication-topics-label';
		toolbar.appendChild(label);
		var choices = el('div', 'publication-filters');
		choices.setAttribute('role', 'group');
		choices.setAttribute('aria-labelledby', label.id);
		[{ id: '', label: 'All' }].concat(TOPICS).forEach(function (t) {
			var total = items.filter(function (item) { return !t.id || item.topics.indexOf(t.id) !== -1; }).length;
			if (!total) return;
			var button = el('button', 'publication-filter', t.label);
			button.type = 'button';
			button.setAttribute('data-topic', t.id);
			button.appendChild(el('span', 'publication-filter-count', String(total)));
			button.addEventListener('click', function () { setTopic(t.id); });
			buttons.push(button);
			choices.appendChild(button);
		});
		toolbar.appendChild(choices);
		count = el('p', 'publication-count');
		count.setAttribute('role', 'status');
		count.setAttribute('aria-live', 'polite');
		count.setAttribute('aria-atomic', 'true');
		toolbar.appendChild(count);
		empty = el('p', 'publication-empty', 'No publications match this topic. ');
		var reset = el('button', 'publication-reset', 'Show all publications');
		reset.type = 'button';
		reset.addEventListener('click', function () {
			setTopic('');
			if (buttons.length) buttons[0].focus();
		});
		empty.appendChild(reset);
		toolbar.appendChild(empty);
		container.insertBefore(toolbar, container.firstChild);
		section.classList.add('publications-enhanced');
		topic = readTopic();
		apply();
		window.addEventListener('hashchange', function () { topic = readTopic(); apply(); });
		window.addEventListener('popstate', function () { topic = readTopic(); apply(); });
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
	else init();
})();
