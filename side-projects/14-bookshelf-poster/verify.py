"""
Checks for the bookshelf poster, run with Playwright against a local server.

    cd /home/user/side-projects
    python3 14-bookshelf-poster/verify.py

What it does:
  1. serves /home/user/side-projects with http.server on a free port,
  2. opens the poster page in headless Chromium and collects console errors,
  3. checks that every book in the sample catalog is drawn as a spine
     (rows with Status "Not a book" are left out),
  4. clicks Download SVG, parses the file with xml.etree and checks the root,
  5. emulates print media and checks that the sidebar is hidden,
  6. renders a PNG through the page's own Poster.toPNG,
  7. saves example-a2.svg and screenshot.png next to this script, and one
     screenshot per palette in a scratch folder for a visual look,
  8. when 01-virtual-library/data/my-library.csv exists (the real export),
     opens the page again without ?catalog=sample and checks that it draws
     that catalog and downloads a valid SVG for it.

Needs: pip install playwright. Uses the Chromium at /opt/pw-browsers/chromium if it
exists (set POSTER_CHROMIUM to point elsewhere), otherwise Playwright's own.
"""
import csv
import http.server
import os
import socketserver
import sys
import threading
import xml.etree.ElementTree as ET

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.join(ROOT, '14-bookshelf-poster')
SCRATCH = os.environ.get('POSTER_SCRATCH', os.path.join(HERE, 'cache'))
DATA = os.path.join(ROOT, '01-virtual-library', 'data')
# The preinstalled Chromium; when the path does not exist Playwright's own copy is used.
CHROMIUM = os.environ.get('POSTER_CHROMIUM', '/opt/pw-browsers/chromium')


def serve():
    handler = http.server.SimpleHTTPRequestHandler
    handler.log_message = lambda *a, **k: None
    httpd = socketserver.TCPServer(('127.0.0.1', 0), lambda *a, **k: handler(*a, directory=ROOT, **k))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def count_books(csv_path):
    """Rows of a catalog CSV that the poster draws: everything but objects."""
    with open(csv_path, encoding='utf-8', newline='') as fh:
        return sum(1 for r in csv.DictReader(fh) if r.get('Status', '').strip() != 'Not a book')


def main():
    os.makedirs(SCRATCH, exist_ok=True)
    httpd = serve()
    port = httpd.server_address[1]
    url = f'http://127.0.0.1:{port}/14-bookshelf-poster/?catalog=sample'
    EXPECTED_BOOKS = count_books(os.path.join(DATA, 'library.csv'))
    failures = []

    def check(cond, msg):
        print(('ok   ' if cond else 'FAIL ') + msg)
        if not cond:
            failures.append(msg)

    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM if os.path.exists(CHROMIUM) else None)
        page = browser.new_page(viewport={'width': 1400, 'height': 1000}, device_scale_factor=1)
        errors = []
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(url)
        page.wait_for_selector('#poster svg')
        page.wait_for_timeout(300)

        check(not errors, f'no console errors ({errors})')
        spines = page.evaluate("document.querySelectorAll('#poster svg g.spine').length")
        check(spines == EXPECTED_BOOKS, f'{spines} spines drawn, expected {EXPECTED_BOOKS}')
        catalog = page.text_content('#catalog')
        check(f'{EXPECTED_BOOKS} books' in catalog, f'catalog line: {catalog}')

        # Every title should appear as spine text (possibly shortened).
        titles = page.evaluate("Array.from(document.querySelectorAll('#poster svg title')).map(t => t.textContent)")
        check(len(titles) >= EXPECTED_BOOKS + 1, f'{len(titles)} title elements (books plus the document title)')

        # Download the SVG and parse it.
        with page.expect_download() as dl:
            page.click('#download-svg')
        path = os.path.join(HERE, 'example-a2.svg')
        dl.value.save_as(path)
        size = os.path.getsize(path)
        check(size < 2_000_000, f'example-a2.svg is {size / 1024:.0f} KB')
        tree = ET.parse(path)
        root = tree.getroot()
        check(root.tag == '{http://www.w3.org/2000/svg}svg', f'root element is {root.tag}')
        check(root.get('width') == '420mm' and root.get('height') == '594mm', f'size attributes {root.get("width")} x {root.get("height")}')
        check(root.get('viewBox') == '0 0 420 594', f'viewBox {root.get("viewBox")}')
        texts = root.findall('.//{http://www.w3.org/2000/svg}text')
        check(len(texts) > EXPECTED_BOOKS, f'{len(texts)} text elements in the file')
        with open(path, encoding='utf-8') as fh:
            head = fh.read(200)
        check(head.startswith('<?xml'), 'file starts with an XML declaration')

        # Print: sidebar hidden, poster at physical size, @page present.
        page.emulate_media(media='print')
        aside = page.evaluate("getComputedStyle(document.querySelector('aside')).display")
        check(aside == 'none', f'sidebar display in print media is "{aside}"')
        svg_w = page.evaluate("getComputedStyle(document.querySelector('#poster svg')).width")
        expected_px = 420 / 25.4 * 96
        check(abs(float(svg_w.replace('px', '')) - expected_px) < 1, f'svg width in print media is {svg_w} (420 mm)')
        page_rule = page.evaluate("document.getElementById('print-style').textContent")
        check('@page { size: 420mm 594mm' in page_rule, '@page rule carries the paper size')
        pdf_path = os.path.join(SCRATCH, 'print-a2.pdf')
        page.pdf(path=pdf_path, prefer_css_page_size=True)
        check(os.path.getsize(pdf_path) > 10_000, f'print to PDF produced {os.path.getsize(pdf_path) / 1024:.0f} KB')
        page.emulate_media(media='screen')

        # PNG rendering through the page's own function.
        png = page.evaluate("""() => Poster.toPNG(document.querySelector('#poster svg'), 150)
            .then(r => ({ w: r.width, h: r.height, bytes: r.blob.size }))""")
        check(png['w'] == 2480 and png['h'] == 3508 and png['bytes'] > 50_000, f'PNG at 150 dpi: {png}')

        # Screenshot for the README, then one per palette and one landscape.
        page.set_viewport_size({'width': 1300, 'height': 1000})
        page.wait_for_timeout(100)
        page.locator('#poster svg').screenshot(path=os.path.join(HERE, 'screenshot.png'))
        shot = os.path.getsize(os.path.join(HERE, 'screenshot.png'))
        check(shot < 1_000_000, f'screenshot.png is {shot / 1024:.0f} KB')

        for key in ('pastel', 'ink', 'jewel'):
            page.select_option('#palette', key)
            page.wait_for_timeout(100)
            check(not errors, f'no console errors after palette {key}')
            page.locator('#poster svg').screenshot(path=os.path.join(SCRATCH, f'palette-{key}.png'))
        page.select_option('#color-by', 'language')
        page.select_option('#orientation', 'landscape')
        page.select_option('#paper', 'arch')
        page.select_option('#font', 'sans')
        page.wait_for_timeout(100)
        spines2 = page.evaluate("document.querySelectorAll('#poster svg g.spine').length")
        check(spines2 == EXPECTED_BOOKS and not errors, f'{spines2} spines after switching to landscape 24x36, language colors, sans')
        page.locator('#poster svg').screenshot(path=os.path.join(SCRATCH, 'landscape-language.png'))
        page.select_option('#color-by', 'type')
        page.wait_for_timeout(100)
        check(not errors, 'no console errors after coloring by type')
        tags = page.evaluate("Array.from(document.querySelectorAll('#poster svg text')).map(t => t.textContent)")
        check('A to D' in tags and 'UNIT K' in tags, 'shelf name tags and unit labels are drawn')

        # The real export, when it is present (it is gitignored, so it may not be).
        real = os.path.join(DATA, 'my-library.csv')
        if os.path.exists(real):
            expected_real = count_books(real)
            page2 = browser.new_page(viewport={'width': 1400, 'height': 1000}, device_scale_factor=1)
            errors2 = []
            page2.on('console', lambda m: errors2.append(m.text) if m.type == 'error' else None)
            page2.on('pageerror', lambda e: errors2.append(str(e)))
            page2.goto(f'http://127.0.0.1:{port}/14-bookshelf-poster/')
            page2.wait_for_selector('#poster svg')
            page2.wait_for_timeout(300)
            check(not errors2, f'real catalog: no console errors ({errors2})')
            spines3 = page2.evaluate("document.querySelectorAll('#poster svg g.spine').length")
            check(spines3 == expected_real, f'real catalog: {spines3} spines drawn, expected {expected_real}')
            check('my-library.csv' in page2.text_content('#catalog'), 'real catalog: loaded from data/my-library.csv')
            with page2.expect_download() as dl2:
                page2.click('#download-svg')
            real_svg = os.path.join(SCRATCH, 'real-a2.svg')
            dl2.value.save_as(real_svg)
            root2 = ET.parse(real_svg).getroot()
            check(root2.tag == '{http://www.w3.org/2000/svg}svg' and root2.get('viewBox') == '0 0 420 594',
                  f'real catalog: downloaded SVG parses ({os.path.getsize(real_svg) / 1024:.0f} KB)')
            page2.close()
        else:
            print('skip real catalog pass (no data/my-library.csv)')
        browser.close()

    httpd.shutdown()
    if failures:
        print(f'\n{len(failures)} check(s) failed.')
        sys.exit(1)
    print('\nAll checks passed.')


if __name__ == '__main__':
    main()
