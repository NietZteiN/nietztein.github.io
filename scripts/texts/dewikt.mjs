/*
 * How build-glosses.mjs asks the German Wiktionary for the pages of word forms: fifty titles
 * per request, in the order of the frequency list. Shared with build-docs.mjs, which lists the
 * same requests in LICENSES.md without their having to be stored, one by one, in the data file.
 */
export const WIKT_API = 'https://de.wiktionary.org/w/api.php?action=query&prop=revisions&rvprop=content%7Cids&rvslots=main&format=json&formatversion=2&titles=';
export const WIKT_PATTERN = WIKT_API + '{titles}';
export const BATCH = 50;

/** The forms of one request: characters a page title cannot hold, or that mean something to the API, are left out. */
export function batchesOf(forms) {
	const out = [];
	for (let i = 0; i < forms.length; i += BATCH) out.push(forms.slice(i, i + BATCH).filter((f) => !/[|#<>\[\]{}_:]/.test(f)));
	return out;
}

export function batchUrl(titles) {
	return WIKT_API + encodeURIComponent(titles.join('|'));
}
