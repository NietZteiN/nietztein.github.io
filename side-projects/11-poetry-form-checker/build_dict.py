#!/usr/bin/env python3
"""Build cmudict.min.json from the CMU Pronouncing Dictionary.

Standard library only. Downloads cmudict.dict (a static file) and writes a
compact JSON map used by index.html:

    word -> "STRESS:RHYME"

STRESS is one digit per syllable (0 no stress, 1 primary, 2 secondary), so
"poet" becomes "10". RHYME is the tail of the pronunciation from the last
stressed vowel onward, with each ARPAbet phoneme encoded as a single letter
(see PHONE_CODES). Two words rhyme when their RHYME parts are equal. Only the
first pronunciation of each word is kept; "(2)" style variants are dropped.

If the JSON is above 3 MB a gzipped copy is written as well; the page loads
whichever file exists. Run:

    python3 build_dict.py            # download and build
    python3 build_dict.py --top 40000  # keep only the first 40k entries

Outputs land next to this script.
"""

import gzip
import json
import os
import sys
import urllib.request

SOURCES = [
    "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict",
    "https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/cmudict.zip",
]
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_JSON = os.path.join(HERE, "cmudict.min.json")
OUT_GZ = OUT_JSON + ".gz"
GZIP_THRESHOLD = 3 * 1024 * 1024

# One letter per ARPAbet phoneme. Vowels are lowercase, consonants uppercase.
PHONE_CODES = {
    "AA": "a", "AE": "b", "AH": "c", "AO": "d", "AW": "e", "AY": "f",
    "EH": "g", "ER": "h", "EY": "i", "IH": "j", "IY": "k", "OW": "l",
    "OY": "m", "UH": "n", "UW": "o",
    "B": "B", "CH": "C", "D": "D", "DH": "E", "F": "F", "G": "G", "HH": "H",
    "JH": "J", "K": "K", "L": "L", "M": "M", "N": "N", "NG": "Q", "P": "P",
    "R": "R", "S": "S", "SH": "X", "T": "T", "TH": "I", "V": "V", "W": "W",
    "Y": "Y", "Z": "Z", "ZH": "A",
}


def download(url):
    """Fetch a URL and return its bytes. Raises on failure."""
    req = urllib.request.Request(url, headers={"User-Agent": "poetry-form-checker"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def fetch_dict_text():
    """Try each source in turn (with one retry each) and return the text."""
    import io
    import zipfile

    for url in SOURCES:
        for attempt in (1, 2):
            try:
                print(f"downloading {url} (attempt {attempt})")
                data = download(url)
                if url.endswith(".zip"):
                    with zipfile.ZipFile(io.BytesIO(data)) as zf:
                        name = [n for n in zf.namelist() if n.endswith("cmudict")][0]
                        data = zf.read(name)
                return data.decode("utf-8", errors="replace")
            except Exception as exc:  # network errors, HTTP errors, bad zip
                print(f"  failed: {exc}")
    sys.exit("could not download CMUdict from any source")


def encode_entry(phones):
    """Return the compact STRESS:RHYME string for a list of ARPAbet phones."""
    stress = ""
    last_stressed = None  # index of the last vowel carrying stress 1 or 2
    last_vowel = None
    for i, ph in enumerate(phones):
        if ph[-1].isdigit():
            stress += ph[-1]
            last_vowel = i
            if ph[-1] in "12":
                last_stressed = i
    start = last_stressed if last_stressed is not None else last_vowel
    if start is None:  # no vowel at all (rare abbreviations); no rhyme tail
        return stress + ":"
    rhyme = "".join(PHONE_CODES.get(ph.rstrip("012"), "?") for ph in phones[start:])
    return stress + ":" + rhyme


def build(text, top=None):
    """Parse cmudict text into {word: 'STRESS:RHYME'}."""
    out = {}
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()  # drop trailing comments
        if not line or line.startswith(";;;"):
            continue
        parts = line.split()
        word, phones = parts[0], parts[1:]
        if "(" in word:  # alternative pronunciation such as read(2)
            continue
        word = word.lower()
        if not phones or word in out:
            continue
        out[word] = encode_entry(phones)
        if top and len(out) >= top:
            break
    return out


def main():
    top = None
    if "--top" in sys.argv:
        top = int(sys.argv[sys.argv.index("--top") + 1])
    text = fetch_dict_text()
    table = build(text, top)
    payload = json.dumps(table, ensure_ascii=False, separators=(",", ":"))
    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        fh.write(payload)
    size = os.path.getsize(OUT_JSON)
    print(f"wrote {OUT_JSON}: {len(table)} words, {size / 1e6:.2f} MB")
    if size > GZIP_THRESHOLD:
        with gzip.open(OUT_GZ, "wb", compresslevel=9) as fh:
            fh.write(payload.encode("utf-8"))
        print(f"wrote {OUT_GZ}: {os.path.getsize(OUT_GZ) / 1e6:.2f} MB")
    elif os.path.exists(OUT_GZ):
        os.remove(OUT_GZ)
        print("removed stale gzip copy")


if __name__ == "__main__":
    main()
