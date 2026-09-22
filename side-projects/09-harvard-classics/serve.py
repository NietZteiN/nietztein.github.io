#!/usr/bin/env python3
"""Serve this folder so index.html can read data/calendar.json.

  python3 serve.py            # http://localhost:8765/
  python3 serve.py --port 9000
"""
import argparse
import functools
import http.server
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=HERE)
    with http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler) as srv:
        print(f"Serving {HERE} at http://localhost:{args.port}/  (Ctrl+C to stop)")
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
