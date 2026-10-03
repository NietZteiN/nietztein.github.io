// Reads the pixel size of a JPEG without decoding it, by walking the marker
// segments to the first start-of-frame header. shot.mjs uses it to check that
// a thumbnail really is 800x500.
//
// Zero dependencies. As a library:
//   import { jpegSize } from './jpeg.mjs';
//   const { width, height } = jpegSize(fs.readFileSync(file));
// As a command (prints "WxH  KB  path" per file, exit 1 if any is not a JPEG):
//   node scripts/qa/jpeg.mjs assets/img/misc/44-text-tartan.jpg [more.jpg ...]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Returns { width, height }. Throws when the buffer is not a JPEG or has no
// frame header.
export function jpegSize(buffer) {
	const b = buffer;
	if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw new Error('not a JPEG (no SOI marker)');
	let i = 2;
	while (i + 3 < b.length) {
		if (b[i] !== 0xff) {
			i++; // stray byte between segments
			continue;
		}
		const marker = b[i + 1];
		if (marker === 0xff) {
			i++; // fill byte
			continue;
		}
		// Markers that stand alone, with no length field.
		if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
			i += 2;
			continue;
		}
		if (marker === 0xd9) break; // end of image
		const length = b.readUInt16BE(i + 2);
		if (length < 2) throw new Error('corrupt JPEG (bad segment length)');
		// SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC) which share the range.
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			if (i + 9 > b.length) break;
			return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
		}
		i += 2 + length;
	}
	throw new Error('no frame header found in the JPEG');
}

// ---- CLI ----------------------------------------------------------------------

// Real paths, compared without case on Windows: an oddly spelled path must not
// turn the command into a silent no-op.
function isMain() {
	if (!process.argv[1]) return false;
	const norm = (p) => {
		let s = path.resolve(p);
		try {
			s = fs.realpathSync.native(s);
		} catch (e) {
			/* keep the resolved path */
		}
		return process.platform === 'win32' ? s.toLowerCase() : s;
	};
	return norm(process.argv[1]) === norm(fileURLToPath(import.meta.url));
}

if (isMain()) {
	const files = process.argv.slice(2);
	if (!files.length || files.includes('--help') || files.includes('-h')) {
		console.log('Usage: node scripts/qa/jpeg.mjs <file.jpg> [more.jpg ...]');
		process.exit(files.length ? 0 : 2);
	}
	let bad = 0;
	for (const file of files) {
		try {
			const buf = fs.readFileSync(file);
			const { width, height } = jpegSize(buf);
			console.log(`${width}x${height}  ${(buf.length / 1024).toFixed(1)} KB  ${file}`);
		} catch (e) {
			bad++;
			console.log(`ERROR  ${file}: ${e.message}`);
		}
	}
	process.exit(bad ? 1 : 0);
}
