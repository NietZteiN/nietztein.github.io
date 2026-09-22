"""Browser check for the daylight clock using Playwright.

Run with:  python3 verify.py
Needs the playwright package (pip install playwright) and a Chromium
build. Set CHROMIUM_PATH to a Chromium executable if the bundled
browser is not installed (the default is the Playwright download).

Opens index.html from file://, confirms there are no console errors, that
the three clocks advance over two seconds, that the horizon arcs and the
shared strip rendered, that the test panel appears with ?test=1, and
saves screenshot.png next to the page.
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = "file://" + os.path.join(HERE, "index.html")


def main():
    errors = []
    with sync_playwright() as p:
        exe = os.environ.get("CHROMIUM_PATH")
        browser = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(URL)
        page.wait_for_selector(".city .hm")
        cities = page.eval_on_selector_all(".city h2", "els => els.map(e => e.textContent)")
        assert len(cities) == 3, cities

        first = page.eval_on_selector_all(".city .seconds", "els => els.map(e => e.textContent)")
        time.sleep(2.2)
        second = page.eval_on_selector_all(".city .seconds", "els => els.map(e => e.textContent)")
        assert all(a != b for a, b in zip(first, second)), (first, second)

        arcs = page.eval_on_selector_all(".horizon path.arc", "els => els.map(e => e.getAttribute('d').length)")
        assert len(arcs) == 3 and all(n > 1000 for n in arcs), arcs
        dots = page.eval_on_selector_all(".horizon .now-dot", "els => els.map(e => e.getAttribute('cx'))")
        assert len(dots) == 3 and all(d not in (None, "0") for d in dots), dots
        shared = page.eval_on_selector_all("#shared-svg rect", "els => els.length")
        assert shared >= 6, shared
        assert not page.is_visible("#test-panel")

        # Settings toggles
        page.click("label:has(#opt-noon)")
        assert page.is_visible(".city .noon")
        page.click("label:has(#opt-24h)")
        ampm = page.eval_on_selector_all(".city .ampm", "els => els.map(e => e.textContent)")
        assert all(a in ("am", "pm") for a in ampm), ampm
        page.click("label:has(#opt-24h)")
        page.click("label:has(#opt-noon)")

        page.screenshot(path=os.path.join(HERE, "screenshot.png"), full_page=True)

        # Narrow layout should stack without horizontal scroll
        page.set_viewport_size({"width": 390, "height": 844})
        time.sleep(0.3)
        overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
        assert not overflow, "horizontal overflow at phone width"

        # Test mode
        page.goto(URL + "?test=1")
        page.wait_for_selector("#test-panel table")
        rows = page.eval_on_selector_all("#test-panel tr", "els => els.length")
        assert rows == 7, rows
        browser.close()

    if errors:
        print("console errors:", errors)
        sys.exit(1)
    size = os.path.getsize(os.path.join(HERE, "screenshot.png"))
    print("ok: cities", cities, "| seconds advanced", first, "->", second,
          "| arc path lengths", arcs, "| screenshot", size, "bytes")
    assert size < 1_000_000, "screenshot too large"


if __name__ == "__main__":
    main()
