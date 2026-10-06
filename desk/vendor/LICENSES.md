# Third-party files in desk/vendor/

Written by `node desk/vendor/fetch-vendor.mjs`; do not edit by hand. `node desk/vendor/fetch-vendor.mjs --check` compares the files on disk with the hashes below.

The Desk loads no script, style or font from another origin, so everything it needs is copied here, unchanged, at the exact versions the public blog loads from jsDelivr.

Fetched: 2026-10-05

## marked 12.0.2

- Licence: MIT
- Project: https://github.com/markedjs/marked
- Used for: Markdown to HTML, as on the blog (assets/js/blog.js).
- Changed: nothing.

| File | Source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `marked/marked.min.js` | https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js | 35479 | `15fabce5b65898b32b03f5ed25e9f891a729ad4c0d6d877110a7744aa847a894` |
| `marked/LICENSE.md` | https://cdn.jsdelivr.net/npm/marked@12.0.2/LICENSE.md | 2942 | `8e3a3f82f59a60958f56ca08f445647c32a4733dc7ca6c2c46f6eb898471ab9c` |

## DOMPurify 3.1.6

- Licence: Apache-2.0 OR MPL-2.0
- Project: https://github.com/cure53/DOMPurify
- Used for: Sanitises every piece of HTML before it is shown.
- Changed: nothing.

| File | Source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `dompurify/purify.min.js` | https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js | 21496 | `c0845096a7c4a6741f362ac506c94c1c7d27dc603bcc1bf64a587f76f2dbe3a1` |
| `dompurify/LICENSE` | https://cdn.jsdelivr.net/npm/dompurify@3.1.6/LICENSE | 27729 | `7de658e2401fe36e2a3965a5a11a560d2fffe768194849718a4b58c75bf84bda` |

## highlight.js 11.9.0

- Licence: BSD-3-Clause
- Project: https://github.com/highlightjs/highlight.js
- Used for: Code highlighting; the common build and the two themes the blog switches between (github, github-dark).
- Changed: nothing.

| File | Source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `highlight/highlight.min.js` | https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js | 121727 | `837a6fa5b0c736b52bbde2b2b6190f305da3fc9ed41681db5321507057b5c846` |
| `highlight/github.min.css` | https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github.min.css | 1309 | `3a9a5def8b9c311e5ae43abde85c63133185eed4f0d9f67fea4b00a8308cf066` |
| `highlight/github-dark.min.css` | https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css | 1315 | `9f208d022102b1d0c7aebfecd8e42ca7997d5de636649d2b31ea63093d809019` |
| `highlight/LICENSE` | https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/LICENSE | 1519 | `5f289f36595e0ef6c53d9f4b4e51d7cc1efc5e2b3ba6130a875d177c54789eaf` |

## KaTeX 0.16.9

- Licence: MIT (the fonts: SIL OFL 1.1)
- Project: https://github.com/KaTeX/KaTeX
- Used for: Math rendering with the auto-render extension. Only the .woff2 fonts are copied; the stylesheet also names .woff and .ttf fallbacks, which no current browser asks for.
- Changed: nothing.

| File | Source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `katex/katex.min.js` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js | 277038 | `dc84b296ec3e884de093158f760fd9d45b6c7abe58b5381557f4e138f46a58ae` |
| `katex/auto-render.min.js` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js | 3478 | `9cb8dacfc086c2966c9ec4ba54f4a2dc43b7cbe2b33cec1a2743d886c7fb47a7` |
| `katex/katex.min.css` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css | 23196 | `505d5f829022bb7b4f24dfee0aa1141cd7bba67afe411d1240335f820960b5c3` |
| `katex/LICENSE` | https://cdn.jsdelivr.net/npm/katex@0.16.9/LICENSE | 1107 | `766ccc1f306c885aa45542a9846bbd0a505b27a0374f146778171c2254ce18e3` |
| `katex/fonts/KaTeX_AMS-Regular.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_AMS-Regular.woff2 | 28076 | `0cdd387c9590a1a9f9794560022dbb59654a7d86f187aa0c81495ad42d3a7308` |
| `katex/fonts/KaTeX_Caligraphic-Bold.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Caligraphic-Bold.woff2 | 6912 | `de7701e42cf1f4cf0b766c03fb27977207eee2f4fd5d76fa82188406da43ea4c` |
| `katex/fonts/KaTeX_Caligraphic-Regular.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Caligraphic-Regular.woff2 | 6908 | `5d53e70ad607c2352162dec9e0923fb54ecdafaccbf604cd8dcf7d00facb989b` |
| `katex/fonts/KaTeX_Fraktur-Bold.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Fraktur-Bold.woff2 | 11348 | `74444efd593c005e3f4573b44524704c0af0a937fe911cca9e94068d0d140d3f` |
| `katex/fonts/KaTeX_Fraktur-Regular.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Fraktur-Regular.woff2 | 11316 | `51814d270d06ff0255dba0799994fa4d8c84d11f09951d47595f4abb1f3602dc` |
| `katex/fonts/KaTeX_Main-Bold.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Main-Bold.woff2 | 25324 | `0f60d1b897938ec918c8ce073092411baf9438f6739465693ff18b0f9d20b021` |
| `katex/fonts/KaTeX_Main-BoldItalic.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Main-BoldItalic.woff2 | 16780 | `99cd42a3c072d918f2f44984a807cf7aa16e13545fd0875fc07c6c65f99e715b` |
| `katex/fonts/KaTeX_Main-Italic.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Main-Italic.woff2 | 16988 | `97479ca6cce906abc961ecac96faa5f9ca2e61b8e7670d475826bcdee9a7c267` |
| `katex/fonts/KaTeX_Main-Regular.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Main-Regular.woff2 | 26272 | `c2342cd8b869e01752a9321dc17213fc40d4d04c79688c1d43f2cf316abd7866` |
| `katex/fonts/KaTeX_Math-BoldItalic.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Math-BoldItalic.woff2 | 16400 | `dc47344dbb6cb5b655c8460d561f4df5f501b90c804ad3c6cec65fe322351ab1` |
| `katex/fonts/KaTeX_Math-Italic.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Math-Italic.woff2 | 16440 | `7af58c5ec8f132a2ddde9027c6d7814decce4d3b822a11192a42a20e2e973264` |
| `katex/fonts/KaTeX_SansSerif-Bold.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_SansSerif-Bold.woff2 | 12216 | `e99ae51144bf1232efcc1bfe5add36262c6866b0faab24fa75740e1b98577a62` |
| `katex/fonts/KaTeX_SansSerif-Italic.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_SansSerif-Italic.woff2 | 12028 | `00b26ac825e2095056396e0553b8ac26d3f8ad158c3826e28b4c45b385c4714a` |
| `katex/fonts/KaTeX_SansSerif-Regular.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_SansSerif-Regular.woff2 | 10344 | `68e8c73ef42afd3ccec58bf0fba302cce448938e7fc020a5e31f8a952eee1342` |
| `katex/fonts/KaTeX_Script-Regular.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Script-Regular.woff2 | 9644 | `036d4e95149b69ff9bcc0cd55771efeb25ffa3947293e69acd78d5ac328c684b` |
| `katex/fonts/KaTeX_Size1-Regular.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Size1-Regular.woff2 | 5468 | `6b47c40166b6dbe21a5dfca7718413f2147fd2399be1ba605d8ad39cedf25dfe` |
| `katex/fonts/KaTeX_Size2-Regular.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Size2-Regular.woff2 | 5208 | `d04c54219f9eaec6d4d4fd42dfb28785975a4794d6b2fc71e566b9cd6db842dd` |
| `katex/fonts/KaTeX_Size3-Regular.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Size3-Regular.woff2 | 3624 | `73d591271b1604960cb10bb90fee021670af7297017e0e98480b332d11f51995` |
| `katex/fonts/KaTeX_Size4-Regular.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Size4-Regular.woff2 | 4928 | `a4af7d414440a1c1790825cfb700cf9cf43b0f2c4b04f0ebc523011ad9853ec0` |
| `katex/fonts/KaTeX_Typewriter-Regular.woff2` | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Typewriter-Regular.woff2 | 13568 | `71d517d67827787cfabdf186914cc3358eda539e37931941f2b2fd4a21f68c0b` |

## Bootstrap (stylesheet only) 5.3.3

- Licence: MIT
- Project: https://github.com/twbs/bootstrap
- Used for: The public site is laid out with Bootstrap; the post preview frame needs the same stylesheet to look like the live post. No Bootstrap script is used.
- Changed: nothing.

| File | Source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `bootstrap/bootstrap.min.css` | https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css | 232803 | `3c8f27e6009ccfd710a905e6dcf12d0ee3c6f2ac7da05b0572d3e0d12e736fc8` |
| `bootstrap/LICENSE` | https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/LICENSE | 1093 | `8c14611ae41ac6fd543c13349f22188eb12c69b3e59105c5eca3925a8e4eca3e` |

## Inter (variable, latin) @fontsource-variable/inter 5.3.0

- Licence: SIL OFL 1.1
- Project: https://github.com/rsms/inter
- Used for: The site's text face (the public site gets it from Google Fonts).
- Changed: nothing.

| File | Source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `fonts/inter-latin-wght-normal.woff2` | https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/files/inter-latin-wght-normal.woff2 | 48256 | `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62` |
| `fonts/LICENSE-inter` | https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/LICENSE | 4477 | `3b0a5fca3d17942cde889069889dedbbbd075e9b599968c82a95f4d944e9b345` |

## JetBrains Mono (variable, latin) @fontsource-variable/jetbrains-mono 5.3.0

- Licence: SIL OFL 1.1
- Project: https://github.com/JetBrains/JetBrainsMono
- Used for: The site's monospace face (the public site gets it from Google Fonts).
- Changed: nothing.

| File | Source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `fonts/jetbrains-mono-latin-wght-normal.woff2` | https://cdn.jsdelivr.net/npm/@fontsource-variable/jetbrains-mono@5.3.0/files/jetbrains-mono-latin-wght-normal.woff2 | 40404 | `18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e` |
| `fonts/LICENSE-jetbrains-mono` | https://cdn.jsdelivr.net/npm/@fontsource-variable/jetbrains-mono@5.3.0/LICENSE | 4524 | `403581b69dac5cff4079205e01c6b467e56af449ecbd7247693ddb1baafa005b` |

## fonts/fonts.css

Not fetched: the two `@font-face` rules for Inter and JetBrains Mono, written by the fetch script.

| File | Source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `fonts/fonts.css` | desk/vendor/fetch-vendor.mjs | 506 | `02ef113c6e60865b787f419b6a3e1f2c6ee4bd26a0984e7c57e4a409ceda7492` |
