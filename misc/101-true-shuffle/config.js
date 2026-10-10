/*
 * True Shuffle: the settings the owner fills in.
 *
 * clientId is the OAuth 2.0 client id of a Google Cloud project that the
 * person running this page created for it (README.md, "Setup in Google
 * Cloud", lists the steps). A client id is not a secret: it only names the
 * project, and Google sends tokens for it nowhere but to the redirect URI
 * registered with it. While it is empty the page explains the setup and
 * offers the demo.
 *
 * UMD: window.TrueShuffle.config in the browser, module.exports in Node.
 */
(function (root, factory) {
	var api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else { root.TrueShuffle = root.TrueShuffle || {}; root.TrueShuffle.config = api; }
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';
	return {
		// Paste the client id here, for example
		// '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com'.
		clientId: '861802714380-06eimebr80l6fqc45qlu9as5gfh6sm6u.apps.googleusercontent.com',

		// 'redirect': the plain OAuth redirect to accounts.google.com and back
		//             (no third-party script runs on this page).
		// 'gis':      Google Identity Services in a popup. Loads
		//             https://accounts.google.com/gsi/client when Sign in is
		//             pressed. Only for the case that Google refuses the plain
		//             flow for this client; not tested (README.md says why).
		signIn: 'redirect',

		// Read-only access to the signed-in account's YouTube data.
		scope: 'https://www.googleapis.com/auth/youtube.readonly',

		// The address registered as "Authorised redirect URI" in Google Cloud.
		// The page uses its own address when this is empty, which is right for
		// https://nietztein.github.io/misc/101-true-shuffle/ and for localhost.
		redirectUri: '',

		// Stored API data older than this is refreshed at the next sign-in
		// (YouTube API terms: refresh or delete within 30 days).
		refreshDays: 30,

		// Optional: a browser API key from the same Google Cloud project, restricted
		// to the YouTube Data API v3 and to this site's address. With it, a
		// channel's uploads, YouTube search and video details work without signing
		// in (adding to a playlist still needs the sign-in). Empty: sign in for those.
		// Settings can also keep one for this browser only.
		apiKey: '',

		// Google's default daily quota for a project, for the meter.
		dailyQuota: 10000
	};
});
