// Optional enhancements; the generated article is readable without JavaScript.
(function () {
	'use strict';
	var root = document.documentElement;
	var themeButton = document.querySelector('.article-theme');
	var body = document.querySelector('.article-body');
	var interaction = 0, decoration = 0;
	['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach(function (name) {
		window.addEventListener(name, function () { interaction++; }, { capture: true, passive: true });
	});
	function enhance(realign) {
		if (!body || !window.ReaderLibs) return;
		var started = interaction, serial = ++decoration, hash = window.location.hash;
		window.ReaderLibs.enhance(body, { active: function () { return serial === decoration; } }).then(function (result) {
			if (serial !== decoration) return;
			var notice = document.querySelector('.article-format-notice');
			if (result.highlight === 'failed' || result.math === 'failed') {
				if (!notice) {
					notice = document.createElement('div');
					notice.className = 'article-share article-format-notice';
					notice.innerHTML = '<span role="status">Some code or math formatting is unavailable.</span><button class="article-copy" type="button">Retry formatting</button>';
					body.insertAdjacentElement('afterend', notice);
					notice.querySelector('button').addEventListener('click', function () { this.disabled = true; enhance(); });
				}
				notice.querySelector('button').disabled = false;
			} else if (notice) {
				var restoreFocus = notice.contains(document.activeElement);
				notice.remove();
				if (restoreFocus) {
					var title = document.querySelector('.article-title');
					title.setAttribute('tabindex', '-1');
					title.focus({ preventScroll: true });
				}
			}
			if (realign && hash && hash === window.location.hash && started === interaction) {
				var id;
				try { id = decodeURIComponent(hash.slice(1)); } catch (e) { return; }
				var heading = document.getElementById(id);
				if (heading && body.contains(heading)) heading.scrollIntoView();
			}
		});
	}
	function applyTheme(theme, remember) {
		root.setAttribute('data-theme', theme);
		if (window.ReaderLibs) window.ReaderLibs.setTheme(theme === 'dark');
		if (themeButton) {
			themeButton.textContent = theme === 'dark' ? 'Light' : 'Dark';
			themeButton.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' theme');
		}
		if (remember) {
			try { localStorage.setItem('theme', theme); } catch (e) { /* Storage can be unavailable. */ }
		}
		enhance(!remember);
	}
	applyTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light', false);
	if (themeButton) themeButton.addEventListener('click', function () { applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true); });

	var share = document.querySelector('.article-share');
	if (share) {
		share.hidden = false;
		share.querySelector('button').addEventListener('click', function () {
			var status = share.querySelector('[role="status"]');
			var input = share.querySelector('input');
			var url = window.location.href;
			function fallback() {
				input.value = url;
				input.hidden = false;
				input.focus();
				input.select();
				status.textContent = 'Select and copy this link.';
			}
			if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(url).then(function () { input.hidden = true; status.textContent = 'Link copied'; }).catch(fallback);
			} else fallback();
		});
	}
})();
