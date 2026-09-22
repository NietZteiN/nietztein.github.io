# Vendored JavaScript libraries

These are single-file browser builds used by `static/js_transforms.js` so the
JavaScript transforms run entirely in the browser with no build step. All three
are MIT licensed. They were fetched from the npm registry (the jsdelivr CDN was
blocked in the build environment, so the identical `dist/` files were taken from
the published npm tarballs).

| File             | Package     | Version | License | Global exposed     |
|------------------|-------------|---------|---------|--------------------|
| `acorn.js`       | acorn       | 8.18.0  | MIT     | `window.acorn`     |
| `walk.js`        | acorn-walk  | 8.3.5   | MIT     | `window.acorn.walk`|
| `astring.min.js` | astring     | 1.9.0   | MIT     | `window.astring`   |

`acorn` parses JavaScript to an ESTree AST, `acorn-walk` walks it, and `astring`
generates source from an ESTree AST.

License texts are kept alongside as `acorn.LICENSE` and `astring.LICENSE`.
acorn-walk ships in the same repository and under the same MIT license as acorn.

## How to refresh

    curl -sSL https://cdn.jsdelivr.net/npm/acorn/dist/acorn.js        -o vendor/acorn.js
    curl -sSL https://cdn.jsdelivr.net/npm/acorn-walk/dist/walk.js    -o vendor/walk.js
    curl -sSL https://cdn.jsdelivr.net/npm/astring/dist/astring.min.js -o vendor/astring.min.js

If the CDN is unreachable, pull the same files from the npm tarballs instead:

    npm pack acorn acorn-walk astring
    # then copy each package/dist/<file> into vendor/
