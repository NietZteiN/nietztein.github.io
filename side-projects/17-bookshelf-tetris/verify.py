"""Browser check for Bookshelf Tetris using Playwright.

Run with:  python3 verify.py
Needs the playwright package (pip install playwright) and a Chromium build.
Set CHROMIUM_PATH to a Chromium executable if the bundled browser is not
installed (the default is the Playwright download).

Starts python3 -m http.server from the repository root (the parent of this
folder) so the page can fetch ../01-virtual-library/data/library.csv (opened
with ?catalog=sample so the checks below see the sample titles), then drives
the game through window.__game:
  - no console errors, the catalog loads from the CSV with the playable
    count (rows that are not objects, unreadable or partial)
  - a book falls one shelf per gravity step and locks at the bottom
  - a full shelf in shelving order clears, a misordered one stays and is tinted
  - the "The after S" convention decides which of two shelves clears
  - reshelving sorts a misordered shelf so it clears, and costs a use
  - hold and flip work, the file:// fallback uses the built-in sample
  - when 01-virtual-library/data/my-library.csv exists (the real export,
    gitignored), the page loads it by default and a game starts from it
Saves screenshot.png next to the page.
"""
import csv
import glob
import os
import socket
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FOLDER = os.path.basename(HERE)

ORDERED = ["Anna Karenina", "Beloved", "Dubliners", "Ethics", "Frankenstein", "Hamlet"]
MISORDERED = ["Beloved", "Anna Karenina", "Dubliners", "Ethics", "Frankenstein", "Hamlet"]
THE_RIGHT = ["Ethics", "Sein und Zeit", "The Great Gatsby", "The Trial", "Tristram Shandy", "Ulysses"]
THE_NAIVE = ["Ethics", "Sein und Zeit", "Tristram Shandy", "The Great Gatsby", "The Trial", "Ulysses"]


def chromium_path():
    """CHROMIUM_PATH if set, else a preinstalled build under /opt/pw-browsers, else Playwright's default."""
    if os.environ.get("CHROMIUM_PATH"):
        return os.environ["CHROMIUM_PATH"]
    for candidate in ["/opt/pw-browsers/chromium", *sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome"))]:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def playable_count(csv_path):
    """Rows the game deals: titled, not objects, not unreadable or partial."""
    with open(csv_path, encoding="utf-8", newline="") as fh:
        return sum(1 for r in csv.DictReader(fh)
                   if r.get("Title", "").strip() and r.get("Status", "").strip() not in ("Not a book", "Unreadable", "Partial"))


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def main():
    port = free_port()
    server = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
                              cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=chromium_path(), args=["--disable-background-networking", "--disable-component-update", "--no-first-run"])
            page = browser.new_page(viewport={"width": 1240, "height": 900})
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))

            data = os.path.join(ROOT, "01-virtual-library", "data")
            expected = playable_count(os.path.join(data, "library.csv"))
            url = "http://127.0.0.1:%d/%s/?catalog=sample" % (port, FOLDER)
            for _ in range(20):
                try:
                    page.goto(url)
                    break
                except Exception:
                    time.sleep(0.25)
            page.wait_for_function("document.getElementById('source').textContent.indexOf('books from') >= 0")
            source = page.text_content("#source")
            assert source.startswith("%d books from 01-virtual-library/data/library.csv" % expected), source
            widths = page.evaluate("['Gedichte', 'Anna Karenina', 'Introduction to Algorithms'].map(t => __game.bookWidth(__game.findBook(t)))")
            assert widths == [1, 2, 3], widths   # poetry, fiction, textbook
            assert page.is_visible("#start")

            # Slow gravity to a crawl so the checks below are deterministic.
            page.evaluate("__game.CONFIG.gravityMs = 1e9")
            page.click("#btn-start")
            assert not page.is_visible("#start")
            assert page.evaluate("__game.state.status") == "running"
            assert page.evaluate("__game.state.piece !== null")

            # A one-cell book falls one shelf per step and locks on the bottom shelf.
            page.evaluate("__game.setPiece('Gedichte', 0)")
            rows = []
            for _ in range(20):
                moved = page.evaluate("__game.fall()")
                rows.append(page.evaluate("__game.state.piece && __game.state.piece.row"))
                if not moved:
                    break
            assert rows[:7] == [1, 2, 3, 4, 5, 6, 7], rows
            grid = page.evaluate("__game.grid()")
            assert grid[7][0] == "Gedichte" and grid[7][1] is None, grid[7]
            # Hard drop lands a two-cell book on the same shelf.
            page.evaluate("__game.setPiece('Hamlet', 5)")
            page.evaluate("__game.hardDrop()")
            grid = page.evaluate("__game.grid()")
            assert grid[7][5] == "Hamlet" and grid[7][6] == "Hamlet" and grid[7][7] is None, grid[7]

            # Ordered shelf clears.
            page.evaluate("__game.start(); __game.state.piece = null")
            status = page.evaluate("__game.placeRow(7, %s)" % ORDERED)
            assert status["full"] and status["ordered"], status
            page.evaluate("__game.resolveRows()")
            assert page.evaluate("__game.state.status") == "clearing"
            assert page.evaluate("document.querySelectorAll('#board rect.clearing').length") == 1
            page.wait_for_function("__game.state.status === 'running'")
            grid = page.evaluate("__game.grid()")
            assert all(c is None for c in grid[7]), grid[7]
            assert page.evaluate("__game.state.lines") == 1
            score_after_clear = page.evaluate("__game.state.score")
            assert score_after_clear == 150, score_after_clear   # 100 clear + 50 one-pass bonus at level 1

            # Misordered shelf stays and is tinted.
            status = page.evaluate("__game.placeRow(7, %s)" % MISORDERED)
            assert status["full"] and not status["ordered"] and status["misordered"], status
            page.evaluate("__game.resolveRows()")
            time.sleep(0.5)
            grid = page.evaluate("__game.grid()")
            assert grid[7][0] == "Beloved" and all(c for c in grid[7]), grid[7]
            assert page.evaluate("__game.state.lines") == 1
            assert page.evaluate("document.querySelectorAll('#board rect.misordered').length") == 1
            assert "out of order" in page.text_content("#message")

            # "The" after S: the naive T ordering stays, the shelving order clears.
            naive = page.evaluate("__game.placeRow(6, %s)" % THE_NAIVE)
            right = page.evaluate("__game.placeRow(5, %s)" % THE_RIGHT)
            assert naive["misordered"] and right["ordered"], (naive, right)
            page.evaluate("__game.resolveRows()")
            page.wait_for_function("__game.state.status === 'running'")
            grid = page.evaluate("__game.grid()")
            assert page.evaluate("__game.state.lines") == 2
            assert grid[6][0] == "Ethics" and grid[6][4] == "Tristram Shandy", grid[6]
            assert all(c is None for c in grid[5]), grid[5]
            assert page.evaluate("document.querySelectorAll('#board rect.misordered').length") == 2

            # Reshelve sorts the bottom shelf, which then clears and costs a use.
            before = page.evaluate("__game.state.score")
            page.evaluate("__game.reshelve(7)")
            page.wait_for_function("__game.state.status === 'running'")
            assert page.evaluate("__game.state.lines") == 3
            assert page.evaluate("__game.state.reshelvesLeft") == 1
            after = page.evaluate("__game.state.score")
            assert after == max(0, before - 300) + 100, (before, after)
            assert page.evaluate("document.querySelectorAll('#board rect.misordered').length") == 1

            # Hint (next to a book it should file before), flip and hold.
            page.evaluate("__game.placeRow(6, ['Ulysses'])")
            page.evaluate("__game.setPiece('The Trial', 3)")
            hint = page.text_content("#hint")
            assert "The Trial" in hint and 'Not here: it files before "Ulysses"' in hint, hint
            assert page.evaluate("document.querySelector('#board path.marker-left').getAttribute('fill')") == "#e8635a"
            assert page.evaluate("document.querySelector('#board path.marker-right').getAttribute('fill')") == "#5fd08a"
            page.evaluate("__game.setPiece('War and Peace', 3)")
            assert 'Fits here, after "Ulysses"' in page.text_content("#hint")
            page.evaluate("__game.handleKey('f')")
            assert page.evaluate("__game.state.piece.flipped") is True
            page.evaluate("__game.handleKey('c')")
            assert page.evaluate("__game.state.hold.title") == "War and Peace"
            page.evaluate("__game.handleKey('p')")
            assert page.is_visible("#paused")
            page.evaluate("__game.handleKey('p')")
            assert not page.is_visible("#paused")

            # Help panel draws the example shelf with a Japanese spine.
            page.click("#btn-help")
            assert page.is_visible("#help")
            titles = page.eval_on_selector_all("#help-shelf g.spine text", "els => els.map(e => e.textContent)")
            assert titles == ["Also sprach Zarathustra", "Sein und Zeit", "The Trial", "Tristram Shandy", "堕落論"], titles
            page.click("#btn-help-close")
            assert not page.is_visible("#help")

            # A tidy board for the screenshot.
            page.evaluate("__game.start(); __game.state.piece = null")
            page.evaluate("__game.placeRow(7, ['Also sprach Zarathustra', 'Gedichte', 'Hamlet', '堕落論', '雪国'])")
            page.evaluate("__game.placeRow(6, ['Die Verwandlung', 'Moby-Dick', 'Sein und Zeit', 'The Trial', 'Ulysses'])")
            page.evaluate("__game.placeRow(5, ['Beloved', 'Invisible Cities', 'Số đỏ'])")
            page.evaluate("__game.setPiece('The Great Gatsby', 6)")
            page.evaluate("__game.state.piece.row = 2")
            page.evaluate("__game.state.score = 1450; __game.state.level = 2; __game.state.lines = 6; __game.state.combo = 2")
            page.evaluate("__game.state.hold = __game.findBook('Kritik der reinen Vernunft')")
            page.evaluate("__game.handleKey('ArrowLeft')")
            page.screenshot(path=os.path.join(HERE, "screenshot.png"))

            # Narrow layout should not scroll sideways.
            page.set_viewport_size({"width": 390, "height": 844})
            time.sleep(0.3)
            overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
            assert not overflow, "horizontal overflow at phone width"

            # file:// falls back to the built-in sample and still runs.
            page.goto("file://" + os.path.join(HERE, "index.html"))
            page.wait_for_function("document.getElementById('source').textContent.indexOf('Built-in sample') >= 0")
            page.evaluate("__game.CONFIG.gravityMs = 1e9; __game.start()")
            assert page.evaluate("__game.state.catalog.length") == 30
            assert page.evaluate("__game.state.piece !== null")

            # The real export, when present: loaded by default, and a game starts from it.
            real = os.path.join(data, "my-library.csv")
            if os.path.exists(real):
                page.set_viewport_size({"width": 1240, "height": 900})
                page.goto("http://127.0.0.1:%d/%s/" % (port, FOLDER))
                page.wait_for_function("document.getElementById('source').textContent.indexOf('books from') >= 0")
                real_source = page.text_content("#source")
                assert real_source.startswith("%d books from 01-virtual-library/data/my-library.csv" % playable_count(real)), real_source
                page.evaluate("__game.CONFIG.gravityMs = 1e9")
                page.click("#btn-start")
                assert page.evaluate("__game.state.status") == "running"
                assert page.evaluate("__game.state.piece !== null")
                assert page.evaluate("document.querySelectorAll('#board g.spine').length") >= 1
                source += " | real: " + real_source
            browser.close()
    finally:
        server.terminate()

    if errors:
        print("console errors:", errors)
        sys.exit(1)
    size = os.path.getsize(os.path.join(HERE, "screenshot.png"))
    assert size < 1_000_000, "screenshot too large"
    print("ok: catalog '%s' | fall rows %s | ordered shelf cleared, misordered stayed, The-after-S honored, "
          "reshelve cleared | screenshot %d bytes" % (source, rows, size))


if __name__ == "__main__":
    main()
