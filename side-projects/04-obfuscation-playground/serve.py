#!/usr/bin/env python3
"""A tiny local server for the obfuscation playground.

No third party packages. GET / serves the UI and its static assets; POST
/api/ladder runs the Python transforms server side and returns the ladder.
JavaScript ladders are built in the browser, so the API only handles Python.

The server binds to 127.0.0.1 only.

    python3 serve.py [--port 8000]
    then open http://127.0.0.1:8000/
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # make the obfusc package importable

import obfusc  # noqa: E402

# Static files we are willing to serve, mapped to a content type.
_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".md": "text/plain; charset=utf-8",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "ObfuscPlayground/1.0"

    def log_message(self, fmt, *args):
        # Quiet by default; uncomment to debug.
        # sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))
        pass

    # -- helpers ---------------------------------------------------------- #
    def _send(self, code, body, content_type="text/plain; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _safe_path(self, url_path):
        """Resolve a URL path to a file inside this folder, or None if unsafe."""
        rel = url_path.lstrip("/")
        if rel == "":
            rel = "static/index.html"
        target = os.path.normpath(os.path.join(HERE, rel))
        if not target.startswith(HERE + os.sep):
            return None
        if not os.path.isfile(target):
            return None
        return target

    # -- routes ----------------------------------------------------------- #
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/":
            # Redirect so the browser base URL is /static/, which keeps the
            # page's relative asset paths (examples.js, ../vendor/...) working
            # exactly as they do under file:// and python3 -m http.server.
            self.send_response(302)
            self.send_header("Location", "/static/index.html")
            self.end_headers()
            return
        target = self._safe_path(path)
        if target is None:
            self._send(404, "not found")
            return
        ext = os.path.splitext(target)[1].lower()
        ctype = _CONTENT_TYPES.get(ext, "application/octet-stream")
        with open(target, "rb") as fh:
            self._send(200, fh.read(), ctype)

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/ladder":
            self._send(404, "not found")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, TypeError):
            self._send(400, json.dumps({"error": "invalid JSON"}),
                       "application/json; charset=utf-8")
            return

        language = payload.get("language", "python")
        if language != "python":
            self._send(400, json.dumps(
                {"error": "the API only builds Python ladders; JavaScript is "
                          "handled in the browser"}),
                "application/json; charset=utf-8")
            return

        source = payload.get("source", "")
        transforms = payload.get("transforms", [])
        seed = payload.get("seed", 0)
        try:
            seed = int(seed)
        except (ValueError, TypeError):
            seed = 0

        try:
            rungs = obfusc.ladder(source, transforms, seed=seed)
        except SyntaxError as exc:
            self._send(200, json.dumps(
                {"error": "could not parse source: {}".format(exc)}),
                "application/json; charset=utf-8")
            return
        except KeyError as exc:
            self._send(200, json.dumps(
                {"error": "unknown transform: {}".format(exc)}),
                "application/json; charset=utf-8")
            return
        except Exception as exc:  # keep the server alive on transform errors
            self._send(200, json.dumps(
                {"error": "transform failed: {}".format(exc)}),
                "application/json; charset=utf-8")
            return

        self._send(200, json.dumps({"rungs": rungs}),
                   "application/json; charset=utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Obfuscation playground server")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args(argv)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print("Serving the obfuscation playground on http://127.0.0.1:{}/".format(
        args.port))
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
        server.shutdown()


if __name__ == "__main__":
    main()
