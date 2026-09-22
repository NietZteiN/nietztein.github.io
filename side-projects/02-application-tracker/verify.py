"""Smoke test for the tracker page with Playwright (Chromium).

Run from this folder:  python3 verify.py
It serves the repository root with python3 -m http.server on a free port,
opens the page, checks for console errors, exercises the filters, tests the
file:// fallback with pasted CSV, and writes screenshot.png.
"""
import os
import glob
import pathlib
import socket
import subprocess
import sys
import time
from datetime import datetime

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent  # served root, so relative paths mirror python3 -m http.server from the repo root


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def chromium_path():
    """Use the preinstalled Chromium under /opt/pw-browsers when present, else Playwright's default."""
    for candidate in ["/opt/pw-browsers/chromium", *sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome"))]:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        sys.exit(1)


def main():
    port = free_port()
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        time.sleep(0.8)
        url = f"http://127.0.0.1:{port}/{HERE.name}/index.html"
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=chromium_path(), args=["--disable-background-networking"])
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            errors = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))

            # 1. Served over http: CSVs load, no console errors.
            page.goto(url)
            page.wait_for_selector("#apps tbody tr[data-id]")
            check(not errors, f"no console errors on load ({errors})")
            rows = page.locator("#apps tbody tr[data-id]").count()
            check(rows == 15, f"table shows all 15 sample applications (got {rows})")
            check(page.locator("#today").inner_text().strip() != "", "header shows today's date")

            # 2. Countdowns render in the Next up strip and in the table.
            cards = page.locator("#nextup .card .count")
            check(cards.count() == 3, "three Next up cards")
            first = cards.first.inner_text()
            check("h" in first and "m" in first, f"countdown has hours and minutes ({first})")
            rels = page.locator("td.deadline .rel").all_inner_texts()
            check(any("in " in r and "d " in r for r in rels), "table rows show live countdowns")

            # 3. Rows are sorted by deadline.
            dates = page.evaluate("""() => [...document.querySelectorAll('#apps tbody tr[data-id]')]
                .map(tr => tr.querySelector('td.deadline').firstChild.textContent)""")
            parsed = [datetime.strptime(d, "%a, %b %d, %Y") for d in dates]
            check(parsed == sorted(parsed), "rows are sorted by deadline")

            # 4. Filters.
            page.select_option("#f-type", "phd")
            n_phd = page.locator("#apps tbody tr[data-id]").count()
            check(n_phd == 7, f"type filter: 7 PhD rows (got {n_phd})")
            page.select_option("#f-type", "all")
            page.select_option("#f-status", "in_progress")
            n_ip = page.locator("#apps tbody tr[data-id]").count()
            check(n_ip == 5, f"status filter: 5 in-progress rows (got {n_ip})")
            pills = set(page.locator("#apps tbody .pill").all_inner_texts())
            check(pills == {"In progress"}, f"only In progress pills visible ({pills})")
            page.select_option("#f-status", "all")

            # 5. Past deadlines are dimmed and can be hidden.
            check(page.locator("#apps tbody tr.past").count() == 1, "one past deadline row is dimmed")
            page.check("#f-hidepast")
            check(page.locator("#apps tbody tr.past").count() == 0, "hide past deadlines removes it")
            check(page.locator("#apps tbody tr[data-id]").count() == 14, "14 rows remain")
            page.uncheck("#f-hidepast")

            # 6. Recommender dots and panel.
            check(page.locator("#apps .dot.submitted").count() > 0, "green (submitted) dots present")
            check(page.locator("#apps .dot.requested").count() > 0, "amber (requested) dots present")
            check(page.locator("#apps .dot.not_requested").count() > 0, "gray (not requested) dots present")
            tip = page.locator("#apps .dot").first.get_attribute("data-tip")
            check(tip and "Recommender" in tip, f"dot tooltip text ({tip!r})")
            check(page.locator("#recs .rec").count() == 4, "four recommender panels")
            owed = page.locator("#recs .rec li").count()
            check(owed > 0, f"recommender panel lists owed letters ({owed})")

            page.screenshot(path=str(HERE / "screenshot.png"), full_page=True)
            size = os.path.getsize(HERE / "screenshot.png")
            check(size < 1_000_000, f"screenshot.png is {size} bytes")

            # 7. file:// fallback: pickers show, pasted CSV loads, no console errors.
            errors.clear()
            page.goto("file://" + str(HERE / "index.html"))
            page.wait_for_selector("#loader:not([hidden])")
            check(page.locator("#apps-file").is_visible(), "file pickers shown when opened as file://")
            page.fill("#apps-text", (HERE / "applications.csv").read_text())
            page.fill("#recs-text", (HERE / "recommenders.csv").read_text())
            page.click("#load-btn")
            page.wait_for_selector("#apps tbody tr[data-id]")
            check(page.locator("#apps tbody tr[data-id]").count() == 15, "pasted CSV renders 15 rows")
            check(not errors, f"no console errors on file:// path ({errors})")

            # 8. Tab-separated paste works in ?tsv mode.
            page.goto("file://" + str(HERE / "index.html") + "?tsv")
            page.wait_for_selector("#loader:not([hidden])")
            page.fill("#apps-text", (HERE / "applications.csv").read_text().replace(",", "\t"))
            page.click("#load-btn")
            page.wait_for_selector("#apps tbody tr[data-id]")
            check(page.locator("#apps tbody tr[data-id]").count() == 15, "TSV paste renders 15 rows in ?tsv mode")
            check(not errors, f"no console errors after TSV load ({errors})")
            # 9. Deadlines under 7 days away are highlighted (clock pinned to 2026-10-18 by the browser).
            page.clock.set_fixed_time("2026-10-18T12:00:00")
            page.goto(url)
            page.wait_for_selector("#apps tbody tr[data-id]")
            soon_cards = page.locator("#nextup .card.soon").count()
            check(soon_cards == 2, f"two Next up cards highlighted as due within 7 days (got {soon_cards})")
            check(page.locator("td.deadline .rel.soon").count() == 2, "matching table rows highlighted")
            check(page.locator("#apps tbody tr.past").count() == 2, "two past rows dimmed at the pinned date")
            check(not errors, f"no console errors with pinned clock ({errors})")
            browser.close()
    finally:
        server.terminate()
    print("all checks passed")


if __name__ == "__main__":
    main()
