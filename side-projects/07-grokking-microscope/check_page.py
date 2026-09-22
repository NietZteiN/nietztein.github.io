"""Open viz/index.html headlessly, report console errors, exercise the
controls, and save a screenshot. Optional: needs the playwright package and
a Chromium build.

Usage:
    python3 check_page.py                       # writes screenshot.png
    python3 check_page.py --chromium /path/to/chrome
"""

import argparse
import os

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chromium", default=os.environ.get("PW_CHROMIUM"),
                    help="Chromium executable; default is Playwright's own browser")
    ap.add_argument("--out", default=os.path.join(HERE, "screenshot.png"))
    args = ap.parse_args()

    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chromium) if args.chromium else p.chromium.launch()
        page = browser.new_page(viewport={"width": 1240, "height": 1480})
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}")
                if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.goto("file://" + os.path.join(HERE, "viz", "index.html"))
        page.wait_for_timeout(300)
        n_frames = page.evaluate("DATA.frames.length")

        # Keyboard stepping, play/pause, the toggles and a hover.
        page.keyboard.press("End")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("Shift+ArrowLeft")
        page.keyboard.press("Home")
        page.keyboard.press(" ")
        page.wait_for_timeout(700)
        page.keyboard.press(" ")
        page.click("text=x log")
        page.click("text=neurons")
        page.hover("svg rect")
        page.wait_for_timeout(100)

        # Screenshot the first frame where the model has generalized.
        target = page.evaluate(
            "(() => { const i = DATA.frames.findIndex(f => f.test_acc > 0.99); return i < 0 ? DATA.frames.length - 1 : i; })()")
        page.evaluate(f"(() => {{ const s = document.querySelector('input[type=range]'); "
                      f"s.value = {target}; s.dispatchEvent(new Event('input')); }})()")
        page.click("text=embedding")
        page.click("text=x linear")
        page.mouse.move(0, 0)
        page.wait_for_timeout(200)
        page.screenshot(path=args.out)

        # Phone width must not scroll sideways.
        page.set_viewport_size({"width": 390, "height": 800})
        page.wait_for_timeout(200)
        overflow = page.evaluate(
            "document.documentElement.scrollWidth > document.documentElement.clientWidth")
        browser.close()

    print(f"frames: {n_frames}, screenshot frame: {target}, phone overflow: {overflow}")
    print("console errors:", errors if errors else "none")
    print("screenshot:", args.out, f"({os.path.getsize(args.out) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
