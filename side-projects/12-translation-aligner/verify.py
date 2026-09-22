"""Playwright check for the translation aligner.

Opens index.html from file://, exercises alignment, moving, drag and drop,
undo, save, load, autosave and the dropped-word nudge, then writes
screenshot.png. Exits non-zero on the first failed check.

Run:  pip install playwright   (Chromium must already be installed)
      python3 verify.py
"""
import glob
import json
import os
import sys
import tempfile

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = "file://" + os.path.join(HERE, "index.html")

PROSE_JA = (
    "吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。"
    "何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。"
    "吾輩はここで始めて人間というものを見た。"
)
PROSE_EN = (
    "I am a cat. As yet I have no name. I have no idea where I was born. "
    "All I remember is that I was crying in a dim, damp place. "
    "It was there that I saw a human being for the first time. Mr. Smith was not there."
)


def check(cond, msg):
    if not cond:
        print("FAIL:", msg)
        sys.exit(1)
    print("ok:", msg)


def rows(page):
    return page.evaluate("state.beads.map(b => ({source: b.source, target: b.target}))")


with sync_playwright() as p:
    # Use the preinstalled Chromium when the Playwright package version does
    # not match the browsers on disk (set CHROMIUM_PATH to override).
    exe = os.environ.get("CHROMIUM_PATH")
    if not exe:
        for cand in sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")):
            exe = cand
    browser = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_selector("tr.bead")

    # 1. sample loads and aligns one to one
    r = rows(page)
    check(len(r) == 8, f"sample aligned into {len(r)} rows")
    check(all(len(b["source"]) == 1 and len(b["target"]) == 1 for b in r), "sample beads are 1-1")

    # 2. sentence splitting and length based DP with mismatched counts
    page.select_option("#splitMode", "sentences")
    page.fill("#src", PROSE_JA)
    page.fill("#tgt", PROSE_EN)
    page.click("#btnAlign")
    r = rows(page)
    n_src = sum(len(b["source"]) for b in r)
    n_tgt = sum(len(b["target"]) for b in r)
    check(n_src == 5 and n_tgt == 6, f"split into {n_src} ja and {n_tgt} en sentences (Mr. guard held)")
    check(len(r) >= 4, f"DP alignment produced {len(r)} rows")
    check(any(len(b["source"]) != len(b["target"]) for b in r), "DP produced at least one non 1-1 bead")
    en_split = page.evaluate("splitEnSentences('Dr. Who came. He said hi! Really? Yes.')")
    check(en_split == ["Dr. Who came.", "He said hi!", "Really?", "Yes."], f"english splitter: {en_split}")
    ja_split = page.evaluate("splitJaSentences('「行くよ。」と言った。本当？')")
    check(ja_split == ["「行くよ。」", "と言った。", "本当？"], f"japanese splitter: {ja_split}")

    # 3. move buttons change rows, undo restores
    before = rows(page)
    page.hover("tr.bead[data-row='0'] td.tgt .seg")
    page.click("tr.bead[data-row='0'] td.tgt .seg button[data-act='down']")
    after = rows(page)
    check(after != before and len(after[1]["target"]) == len(before[1]["target"]) + 1, "move-down button moved a target segment into row 2")
    page.click("#btnUndo")
    check(rows(page) == before, "undo restored the previous alignment")

    # merge and split
    page.click("tr.bead[data-row='0'] td.ctrl button[data-act='merge']")
    merged = rows(page)
    check(len(merged) == len(before) - 1 and len(merged[0]["source"]) == 2, "merge with row below")
    page.hover("tr.bead[data-row='0'] td.src .seg[data-idx='1']")
    page.click("tr.bead[data-row='0'] td.src .seg[data-idx='1'] button[data-act='split']")
    split = rows(page)
    check(len(split) == len(merged) + 1 and split[1]["source"] == [merged[0]["source"][1]] and split[1]["target"] == [], "split off into a new row")
    page.click("tr.bead[data-row='1'] td.ctrl button[data-act='insert']")
    check(rows(page)[2] == {"source": [], "target": []}, "insert empty row")
    page.click("#btnUndo"); page.click("#btnUndo"); page.click("#btnUndo")
    check(rows(page) == before, "three undos back to the aligned state")

    # 4. HTML5 drag and drop across rows
    before = rows(page)
    page.drag_and_drop("tr.bead[data-row='1'] td.src .seg", "tr.bead[data-row='0'] td.src")
    after = rows(page)
    check(len(after[0]["source"]) == len(before[0]["source"]) + 1, "drag and drop moved a source segment to row 1")
    page.drag_and_drop("tr.bead[data-row='0'] td.src .seg[data-idx='1']", "td[data-gap='1']")
    after2 = rows(page)
    check(len(after2) == len(after) + 1 and after2[1]["source"] == [after[0]["source"][1]] and after2[1]["target"] == [], "drop into a gap created a new row")
    page.click("#btnUndo"); page.click("#btnUndo")
    check(rows(page) == before, "undo after drag and drop")

    # 5. save produces JSON
    page.fill("#title", "Neko test")
    with page.expect_download() as dl:
        page.click("#btnSave")
    path = os.path.join(tempfile.mkdtemp(), dl.value.suggested_filename)
    dl.value.save_as(path)
    saved = json.load(open(path, encoding="utf-8"))
    for key in ("title", "source_text", "target_text", "split_mode", "beads", "saved_at"):
        check(key in saved, f"saved JSON has {key}")
    check(saved["title"] == "Neko test" and saved["split_mode"] == "sentences" and saved["beads"] == before, "saved JSON content matches view")
    check(dl.value.suggested_filename.endswith(".align.json"), f"download name {dl.value.suggested_filename}")

    # markdown and tsv exports
    with page.expect_download() as dl_md:
        page.click("#btnMd")
    md = open(dl_md.value.path(), encoding="utf-8").read()
    check(md.startswith("# Neko test") and "| 1 |" in md, "markdown export")
    with page.expect_download() as dl_tsv:
        page.click("#btnTsv")
    tsv = open(dl_tsv.value.path(), encoding="utf-8").read().splitlines()
    check(tsv[0] == "index\tsource\ttarget" and len(tsv) == len(before) + 1, "tsv export")

    # 6. autosave survives a reload
    page.reload()
    page.wait_for_selector("tr.bead")
    check(rows(page) == before and page.input_value("#title") == "Neko test", "reload restored state from localStorage")

    # 7. load restores a file exactly
    page.click("#btnSample")
    check(len(rows(page)) == 8, "sample reloaded (state changed before load)")
    page.set_input_files("#fileInput", path)
    page.wait_for_function("state.title === 'Neko test'")
    check(rows(page) == before and page.input_value("#src") == PROSE_JA and page.select_option("#splitMode", "sentences"), "load JSON restored the saved view")

    # 8. dropped-word nudge on the sample
    page.click("#btnSample")
    page.click("#btnNudge")
    maybe = page.locator(".tok.maybe").count()
    ok = page.locator(".tok:not(.maybe):not(.covered)").count()
    check(maybe > 0 and ok > 0, f"nudge: {maybe} possibly dropped, {ok} reflected")
    check(page.locator(".tok.maybe[data-tok='狐']").count() == 0, "glossary entry 狐 -> fox counts as reflected")
    first = page.locator(".tok.maybe").first
    word = first.get_attribute("data-tok")
    first.click()
    check(page.evaluate("state.covered").count(word) == 1 and page.locator(f".tok.covered[data-tok='{word}']").count() >= 1, f"clicking '{word}' marked it covered")
    page.click("#btnGlossary")
    page.fill("#glossary", '{"狐": ["cat"]}')
    page.click("#btnGlossaryApply")
    check(page.locator(".tok.maybe[data-tok='狐']").count() == 1, "editing the glossary changes reflection")
    page.fill("#glossary", "{bad json")
    page.click("#btnGlossaryApply")
    check("Invalid JSON" in page.text_content("#glStatus"), "invalid glossary JSON is reported")
    page.click("#btnGlossaryReset")
    page.click("#btnGlossary")

    # romaji heuristic
    check(page.evaluate("isReflected('コーヒー', 'he drank coffee', ['he','drank','coffee'])"), "katakana コーヒー matches coffee")
    check(page.evaluate("isReflected('テーブル', 'on the table', ['on','the','table'])"), "katakana テーブル matches table")
    check(page.evaluate("isReflected('三', 'three cats', ['three','cats'])"), "kanji numeral 三 matches three")
    check(not page.evaluate("isReflected('狐', 'a dog', ['a','dog'])"), "unrelated word is not reflected")

    page.screenshot(path=os.path.join(HERE, "screenshot.png"), full_page=False)
    size = os.path.getsize(os.path.join(HERE, "screenshot.png"))
    check(size < 1_000_000, f"screenshot.png written ({size} bytes)")

    check(not errors, f"no console or page errors: {errors}")
    browser.close()
    print("all checks passed")
