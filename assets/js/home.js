// Latest writing follows the public blog index; the static links remain if it
// cannot be loaded. No private drafts or owner-only data is read here.
(function () {
	'use strict';
	var list = document.getElementById('home-updates');
	if (!list) return;
	var posts = [];
	function render() {
		if (!posts.length) return;
		var fragment = document.createDocumentFragment();
		var locale = document.documentElement.lang === 'ja' ? 'ja-JP' : 'en-US';
		posts.forEach(function (post) {
			var item = document.createElement('li');
			var time = document.createElement('time');
			time.dateTime = post.date;
			time.textContent = new Date(post.date + 'T00:00:00Z').toLocaleDateString(locale, {
				year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'
			});
			var link = document.createElement('a');
			link.href = '#/post/' + encodeURIComponent(post.slug);
			link.textContent = post.title;
			item.appendChild(time);
			item.appendChild(link);
			fragment.appendChild(item);
		});
		list.textContent = '';
		list.appendChild(fragment);
	}
	fetch('blog/index.json', { cache: 'no-cache' }).then(function (response) {
		if (!response.ok) throw new Error('Writing index unavailable');
		return response.json();
	}).then(function (items) {
		if (!Array.isArray(items)) return;
		posts = items.filter(function (item) {
			return item && typeof item.slug === 'string' && item.slug && typeof item.title === 'string' &&
				/^\d{4}-\d{2}-\d{2}$/.test(item.date) && !isNaN(Date.parse(item.date + 'T00:00:00Z'));
		}).sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 3);
		render();
	}).catch(function () { /* The static recent links remain useful offline. */ });
	document.addEventListener('i18n:change', render);
})();
