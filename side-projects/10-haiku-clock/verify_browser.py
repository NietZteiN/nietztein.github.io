"""Browser check with Playwright (Chromium).

Opens index.html from file://, clicks through every language and control,
fails on any console error or page error, and saves screenshot.png.

    pip install playwright   (Chromium must already be installed)
    python3 verify_browser.py
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = "file://" + os.path.join(HERE, "index.html")
# Set CHROMIUM to a chrome binary if the Playwright download is not the version the package expects.
CHROMIUM = os.environ.get("CHROMIUM") or next(
    (p for p in [os.path.join("/opt/pw-browsers", d, "chrome-linux", "chrome") for d in sorted(os.listdir("/opt/pw-browsers"))]
     if os.path.exists(p)), None) if os.path.isdir("/opt/pw-browsers") else None


def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM) if CHROMIUM else p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("console", lambda m: errors.append(m.text) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL)
        page.wait_for_selector("#verse .line")

        # every language renders three lines that sum to 5-7-5 according to the page itself
        for i in range(4):
            page.click(f"#langs button >> nth={i}")
            counts = page.eval_on_selector_all("#verse .count", "els => els.map(e => +e.textContent)")
            assert counts == [5, 7, 5], (i, counts)
            page.click("#btn-new")
            counts = page.eval_on_selector_all("#verse .count", "els => els.map(e => +e.textContent)")
            assert counts == [5, 7, 5], ("new verse", i, counts)

        # toggles
        page.click("#btn-tr")
        assert page.is_visible("#translation")
        page.click("#btn-counts")
        page.click("#btn-lock")
        page.click("#langs button >> nth=1")  # Japanese
        for reading in ("kanji", "furigana", "romaji"):
            page.click(f"#reading button:has-text('{reading}')")
        page.click("#btn-vertical")
        assert page.eval_on_selector("#verse", "e => getComputedStyle(e).writingMode") == "vertical-rl"
        page.click("#btn-vertical")
        page.click("#reading button:has-text('furigana')")
        assert page.locator("#verse ruby").count() > 0
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowLeft")
        assert page.get_attribute("#verse", "lang") == "ja"

        # the same minute gives the same verse across reloads ("new verse" counts reset on reload)
        texts = []
        for _ in range(2):
            page.reload()
            page.wait_for_selector("#verse .line")
            texts.append(page.inner_text("#verse"))
        if texts[0] != texts[1] and time.localtime().tm_sec < 58:
            errors.append("verse changed across reload within the same minute")

        time.sleep(0.5)
        page.screenshot(path=os.path.join(HERE, "screenshot.png"))
        browser.close()

    size = os.path.getsize(os.path.join(HERE, "screenshot.png"))
    print("screenshot.png", size, "bytes")
    if errors:
        print("console/page errors:")
        for e in errors:
            print("  ", e)
        sys.exit(1)
    print("browser check passed, no console errors")


if __name__ == "__main__":
    main()
